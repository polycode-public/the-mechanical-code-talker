// research-viz: renderResearchHtml page-structure pins, mirroring
// chat-page-viz.test.mjs's own style for the page heading.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderResearchHtml } from "../../src/services/research-viz.mjs";

test("renderResearchHtml: carries exactly one h1, promoted from the page's own subtitle rather than a second heading beside it", () => {
  const html = renderResearchHtml();
  const h1s = [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)];
  assert.equal(h1s.length, 1, "exactly one h1 on the page");
  assert.equal(h1s[0][1], "Grow one graph three ways. Watch what it learns, then ask a question scoped to the sources you trust.");
});

test("renderResearchHtml: the eyebrow stays a plain nav span, a sibling of the h1 rather than wrapping or being wrapped by it", () => {
  const html = renderResearchHtml();
  const eyebrowStart = html.indexOf('<span class="eyebrow">');
  const eyebrowEnd = html.indexOf("</span></span>", eyebrowStart) + "</span></span>".length;
  const eyebrowBlock = html.slice(eyebrowStart, eyebrowEnd);
  assert.ok(!eyebrowBlock.includes("<h1"), "the eyebrow carries no heading of its own");
  assert.ok(eyebrowEnd < html.indexOf("<h1"), "the eyebrow renders before the h1, as separate elements");
});
