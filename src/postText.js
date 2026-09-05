import { createElement } from "react";

// A small emphasis subset: keep stored text intact and never interpret HTML.
export function formatPostText(text) {
  const parts = [];
  // Underscores within names such as site_owner_id stay literal.
  const pattern = /\*\*([\s\S]+?)\*\*|(?<![\p{L}\p{N}_])_([\s\S]+?)_(?![\p{L}\p{N}_])/gu;
  let offset = 0;

  for (const match of text.matchAll(pattern)) {
    const [source, bold, italic] = match;
    const content = bold ?? italic;
    const end = match.index + source.length;
    if (!content.trim()) continue;
    parts.push(text.slice(offset, match.index));
    parts.push(createElement(bold === undefined ? "em" : "strong", { key: match.index }, formatPostText(content)));
    offset = end;
  }

  parts.push(text.slice(offset));
  return parts;
}
