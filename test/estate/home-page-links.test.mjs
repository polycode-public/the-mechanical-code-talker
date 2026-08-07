// Every home-page anchor that links to a demo page must open it in a new tab
// rather than navigating the home page away — the home page is the shop
// window, and a demo link should leave it standing behind the tab it opens.
// This checks the anchor tag itself carries both target="_blank" and
// rel="noopener noreferrer" (the latter is required alongside target="_blank"
// so the new tab cannot reach back into the opener via window.opener). It
// also pins the extracted anchor count: a page link added or removed without
// updating this guard should fail here, and a drift in the count is the
// signal to check whether the extraction regex itself still matches reality.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INDEX = fileURLToPath(new URL("../../public/index.html", import.meta.url));

// mudiii is excluded on purpose: it is a full-screen game page, not counted
// in this guard's anchor set.
const DEMO_PAGES = ["chat", "ledger", "sprites", "plan", "adventure"];
const EXPECTED_ANCHOR_COUNT = 20;

function extractDemoPageAnchors(html) {
  const hrefAlternation = DEMO_PAGES.join("|");
  const anchorRe = new RegExp(`<a\\b[^>]*\\bhref="\\./(?:${hrefAlternation})\\.html"[^>]*>`, "g");
  return [...html.matchAll(anchorRe)].map((m) => m[0]);
}

test("every home-page anchor to a demo page opens in a new tab, with noopener/noreferrer", () => {
  const html = readFileSync(INDEX, "utf8");
  const anchors = extractDemoPageAnchors(html);
  assert.equal(anchors.length, EXPECTED_ANCHOR_COUNT, "the number of demo-page anchors found has changed — a link was added or removed, or the extraction regex needs updating");
  for (const anchor of anchors) {
    assert.ok(anchor.includes('target="_blank"'), `anchor missing target="_blank": ${anchor}`);
    assert.ok(anchor.includes('rel="noopener noreferrer"'), `anchor missing rel="noopener noreferrer": ${anchor}`);
  }
});
