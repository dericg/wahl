import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { draftDetails, FormattedText, parseFormattedText, readEditor, serializeFormattedText } from "../src/formattedText.js";

test("renders the owner's existing nested formatting", () => {
  assert.equal(renderToStaticMarkup(createElement(FormattedText, { text: "**_Hey look! Formatted text._** #fix" })),
    "<strong><em>Hey look! Formatted text.</em></strong><span> #fix</span>");
});

test("post content remains escaped text, including HTML and links", () => {
  const html = renderToStaticMarkup(createElement(FormattedText, { text: '**<img src=x onerror=alert(1)>** <script>alert(1)</script> [link](javascript:alert(1))' }));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!/<(?:img|script|a)\b/.test(html));
});

test("plain text, punctuation, and line breaks round-trip through the editor format", () => {
  for (const text of ["A small thought.", "*literal* **stars** _underscores_", "snake_case_words", "one\\two", "first\n\nsecond", "<b>text</b>", "🙂 café"]) {
    assert.deepEqual(parseFormattedText(serializeFormattedText([{ text }])), [{ text, bold: false, italic: false }]);
  }
  assert.equal(parseFormattedText("An **unfinished thought").map((run) => run.text).join(""), "An **unfinished thought");
  assert.equal(parseFormattedText("snake_case_words").map((run) => run.text).join(""), "snake_case_words");
});

test("adjacent marks and formatting within a word survive saving and reading", () => {
  const runs = [
    { text: "a", bold: false, italic: false },
    { text: "b", bold: false, italic: true },
    { text: "c", bold: true, italic: true },
    { text: "d", bold: true, italic: false },
    { text: "e", bold: true, italic: true },
    { text: "f", bold: false, italic: true },
  ];
  assert.deepEqual(parseFormattedText(serializeFormattedText(runs)), runs);
});

test("all adjacent style combinations preserve text and marks around literal punctuation", () => {
  const styles = [{ bold: false, italic: false }, { bold: true, italic: false }, { bold: false, italic: true }, { bold: true, italic: true }];
  const characters = (runs) => runs.flatMap(({ text, ...marks }) => [...text].map((text) => ({ text, ...marks })));
  for (const first of styles) for (const middle of styles) for (const last of styles) {
    const runs = [{ text: "a", ...first }, { text: "_*\\", ...middle }, { text: "b", ...last }];
    assert.deepEqual(characters(parseFormattedText(serializeFormattedText(runs))), characters(runs));
  }
});

test("formatting whitespace keeps visible spacing without creating empty posts", () => {
  assert.equal(serializeFormattedText([{ text: " hello ", bold: true, italic: true }]), " _**hello**_ ");
  assert.equal(draftDetails([{ text: " \n ", bold: true }]).valid, false);
  assert.equal(draftDetails([]).valid, false);
});

test("the stored character budget includes marks and matches Postgres Unicode counting", () => {
  assert.equal(draftDetails([{ text: "a".repeat(320) }]).valid, true);
  assert.equal(draftDetails([{ text: "a".repeat(321) }]).valid, false);
  assert.equal(draftDetails([{ text: "a".repeat(316), bold: true }]).valid, true);
  assert.equal(draftDetails([{ text: "a".repeat(317), bold: true }]).valid, false);
  assert.equal(draftDetails([{ text: "🙂".repeat(320) }]).length, 320);
  assert.equal(draftDetails([{ text: "_".repeat(161) }]).valid, false);
});

test("formatting cannot split a visible #fix hashtag or bypass its privacy detection", () => {
  const draft = draftDetails([{ text: "🙂 #F", bold: true }, { text: "i", italic: true }, { text: "X make it quiet" }]);
  assert.equal(draft.hasFix, true);
  assert.match(draft.text, /#fix\b/i);
  assert.equal(parseFormattedText(draft.text).map((run) => run.text).join(""), "🙂 #FiX make it quiet");
  for (const bold of [false, true]) {
    for (const italic of [false, true]) {
      const formatted = draftDetails([{ text: "#fix", bold, italic }]);
      assert.match(formatted.text, /#fix\b/i);
      assert.deepEqual(parseFormattedText(formatted.text), [{ text: "#fix", bold, italic }]);
    }
  }
  assert.match(draftDetails([{ text: "#fix" }, { text: "!", italic: true }]).text, /#fix\b/i);
  assert.equal(draftDetails([{ text: "#fixture" }]).hasFix, false);
});

// DOM-shaped fixtures cover the different line structures produced by native
// contenteditable without starting a browser in the automation workflow.
function node(name, ...children) {
  const childNodes = children.map((child) => typeof child === "string" ? { nodeType: 3, nodeName: "#text", nodeValue: child, childNodes: [] } : child);
  childNodes.forEach((child, index) => { child.nextSibling = childNodes[index + 1] || null; });
  return { nodeType: 1, nodeName: name, childNodes };
}
const editorText = (root) => readEditor(root).map((run) => run.text).join("");

test("reads native bold/italic nodes and ignores executable or embedded content", () => {
  const root = node("DIV", node("B", node("I", "both")), node("SCRIPT", "bad()"), node("IMG"), node("A", "text"));
  assert.equal(serializeFormattedText(readEditor(root)), "_**both**_text");
  assert.equal(serializeFormattedText(readEditor(node("DIV", node("STRONG", node("EM", "both"))))), "_**both**_");
});

test("native editor line breaks and blank lines retain their spacing", () => {
  assert.equal(editorText(node("DIV", "first", node("DIV", "second"))), "first\nsecond");
  assert.equal(editorText(node("DIV", node("DIV", "first"), node("DIV", node("BR")), node("DIV", "third"))), "first\n\nthird");
  assert.equal(editorText(node("DIV", "first", node("BR"), node("BR"), "third")), "first\n\nthird");
  assert.equal(editorText(node("DIV", "first", node("BR"), node("BR"))), "first\n");
  assert.equal(editorText(node("DIV", node("BR"))), "");
});
