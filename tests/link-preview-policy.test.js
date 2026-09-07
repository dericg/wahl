import test from "node:test";
import assert from "node:assert/strict";
import { parseLinkMetadata, safePreviewUrl } from "../supabase/functions/_shared/link-preview-policy.js";

test("link previews accept public web URLs and reject local network targets", () => {
  assert.equal(safePreviewUrl("https://example.com/story#part"), "https://example.com/story");
  for (const value of ["file:///etc/passwd", "http://localhost/test", "http://127.0.0.1/test", "http://192.168.1.2/test", "http://[::1]/test", "https://example.com:8443/test"]) assert.equal(safePreviewUrl(value), null);
});

test("link preview metadata is bounded and resolves relative images", () => {
  const preview = parseLinkMetadata('<title>Fallback</title><meta property="og:title" content="A &amp; B"><meta name="description" content="A useful description"><meta property="og:image" content="/cover.jpg">', "https://example.com/article");
  assert.deepEqual(preview, { title: "A & B", description: "A useful description", siteName: "", imageUrl: "https://example.com/cover.jpg" });
});
