// ledger-viz: renderLedgerHtml page-structure pins. The digest paragraph
// itself is exercised end to end in ledger-viz-digest.test.mjs; these tests
// cover the page's own heading, independent of any live memory payload.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderLedgerHtml } from "../../src/services/ledger-viz.mjs";

test("renderLedgerHtml: carries exactly one h1, naming the page rather than repeating the eyebrow's nav links", () => {
  const html = renderLedgerHtml();
  const h1s = [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)];
  assert.equal(h1s.length, 1, "exactly one h1 on the page");
  assert.equal(h1s[0][1], "memory ledger");
  assert.ok(html.indexOf(h1s[0][0]) < html.indexOf('class="eyebrow"'), "the h1 lands before the eyebrow it titles");
});

test("renderLedgerHtml: the eyebrow's own nav links carry no heading of their own", () => {
  const html = renderLedgerHtml();
  const eyebrowLine = html.slice(html.indexOf('<div class="eyebrow">'), html.indexOf("</div>", html.indexOf('<div class="eyebrow">')));
  assert.ok(!eyebrowLine.includes("<h1"), "the eyebrow is navigation, not the page title");
});
