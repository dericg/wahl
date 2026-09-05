import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatPostText } from "../src/postText.js";

const render = (text) => renderToStaticMarkup(createElement("p", null, formatPostText(text)));

test("renders bold and italic, including combined emphasis and line breaks", () => {
  assert.equal(render("A **small** _thought_.\n**_Both_** and _**again**_."), "<p>A <strong>small</strong> <em>thought</em>.\n<strong><em>Both</em></strong> and <em><strong>again</strong></em>.</p>");
});

test("preserves ordinary text, unmatched markers, and underscores within names", () => {
  for (const text of ["A quiet thought.\n\nAnother line.", "**unfinished", "_unfinished", "site_owner_id", "2 * 3 = 6", "** ** and _ _"]) {
    assert.equal(render(text), `<p>${text}</p>`);
  }
  assert.equal(render("site_owners and _words_"), "<p>site_owners and <em>words</em></p>");
});

test("keeps HTML and links inert, including inside formatted text", () => {
  assert.equal(render('**<img src=x onerror="alert(1)">** _<script>alert(1)</script>_'), '<p><strong>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</strong> <em>&lt;script&gt;alert(1)&lt;/script&gt;</em></p>');
  assert.equal(render("[click](javascript:alert(1))"), "<p>[click](javascript:alert(1))</p>");
});
