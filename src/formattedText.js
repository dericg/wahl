import { createElement } from "react";

// The stored format is deliberately small: **bold**, *italic* (also _italic_), and escaped
// punctuation. All other text (including HTML) stays text.
export function parseFormattedText(text, marks = {}) {
  const runs = [];
  const append = (value, style = marks) => {
    if (!value) return;
    const last = runs.at(-1);
    if (last && last.bold === Boolean(style.bold) && last.italic === Boolean(style.italic)) last.text += value;
    else runs.push({ text: value, bold: Boolean(style.bold), italic: Boolean(style.italic) });
  };
  for (let index = 0; index < text.length;) {
    if (text[index] === "\\" && /[\\*_]/.test(text[index + 1] || "")) {
      append(text[index + 1]);
      index += 2;
      continue;
    }
    const marker = text.startsWith("**", index) ? "**" : text[index] === "*" ? "*" : text[index] === "_" &&
      (!/[\p{L}\p{N}]/u.test(text[index - 1] || "") || text.startsWith("**", index + 1)) ? "_" : null;
    let end = -1;
    if (marker && text[index + marker.length] && !/\s/.test(text[index + marker.length])) {
      for (let cursor = index + marker.length; cursor < text.length; cursor++) {
        if (text[cursor] === "\\") { cursor++; continue; }
        if (text.startsWith(marker, cursor) && cursor > index + marker.length && !/\s/.test(text[cursor - 1]) &&
          (marker !== "_" || !/[\p{L}\p{N}]/u.test(text[cursor + 1] || "") || text.slice(cursor - 2, cursor) === "**")) {
          end = cursor;
          break;
        }
      }
    }
    if (end !== -1) {
      for (const run of parseFormattedText(text.slice(index + marker.length, end), { ...marks, [marker === "**" ? "bold" : "italic"]: true })) append(run.text, run);
      index = end + marker.length;
    } else {
      append(text[index]);
      index++;
    }
  }
  return runs;
}

export function FormattedText({ text }) {
  return parseFormattedText(text).map((run, index) => {
    let child = run.text;
    if (run.italic) child = createElement("em", null, child);
    return createElement(run.bold ? "strong" : "span", { key: index }, child);
  });
}

export function serializeFormattedText(runs) {
  const plainText = runs.map((run) => run.text).join("");
  // Keep the automation hashtag intact even if formatting splits its letters.
  const tags = [...plainText.matchAll(/#fix\b/gi)].map((match) => ({ start: match.index }));
  const merged = [];
  let offset = 0;
  for (const run of runs) {
    for (const character of run.text) {
      const tag = tags.find(({ start }) => offset >= start && offset < start + 4);
      if (tag && offset === tag.start) { tag.bold = run.bold; tag.italic = run.italic; }
      const bold = Boolean(tag ? tag.bold : run.bold);
      const italic = Boolean(tag ? tag.italic : run.italic);
      const last = merged.at(-1);
      if (last && last.bold === bold && last.italic === italic) last.text += character;
      else merged.push({ text: character, bold, italic });
      offset += character.length;
    }
  }
  return merged.map((run) => {
    const [, leading, content, trailing] = run.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let value = content.replace(/[\\*_]/g, "\\$&");
    if (value && run.bold) value = `**${value}**`;
    // Asterisks next to the text preserve the word boundary after #fix.
    if (value && run.italic) value = run.bold ? `_${value}_` : `*${value}*`;
    return leading + value + trailing;
  }).join("");
}

// Read only text, line breaks, and the two supported marks from the editor.
export function readEditor(node) {
  const runs = [];
  const append = (text, marks) => runs.push({ text, ...marks });
  function visit(current, marks = {}) {
    if (current.nodeType === 3) { append(current.nodeValue, marks); return; }
    const tag = current.nodeName;
    if (["SCRIPT", "STYLE", "IMG", "IFRAME", "OBJECT"].includes(tag)) return;
    if (tag === "BR") { append("\n", marks); return; }
    const block = tag === "DIV" || tag === "P";
    if (block && runs.length && !runs.at(-1).text.endsWith("\n")) append("\n", {});
    const children = [...current.childNodes];
    // Browsers put a lone BR in an empty line and a trailing BR after a real
    // line break to keep the caret visible. Neither is additional content.
    children.forEach((child, index) => {
      if (child.nodeName === "BR" && index === children.length - 1) return;
      visit(child, { bold: marks.bold || tag === "B" || tag === "STRONG", italic: marks.italic || tag === "I" || tag === "EM" });
    });
    if (block && current.nextSibling) append("\n", {});
  }
  [...node.childNodes].forEach((child) => {
    if (child.nodeName === "BR" && !child.nextSibling) return;
    visit(child);
  });
  return runs;
}

export function draftDetails(runs) {
  const text = serializeFormattedText(runs).trim();
  const plainText = runs.map((run) => run.text).join("");
  const length = [...text].length;
  return { text, length, hasFix: /#fix\b/i.test(plainText), valid: Boolean(plainText.trim()) && length <= 320 };
}
