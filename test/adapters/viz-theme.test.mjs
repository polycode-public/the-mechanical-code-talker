// viz-theme.test.mjs — direct unit coverage for the shared page-builder
// helpers viz-theme.mjs exports beyond escaping/embedding: the plural-count
// label, the world-provenance row filter, the generic meter bar, the
// cursor-word lookup, and the exported token table.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countLabel, rowsForWorld, meterBarHtml, wordBeforeCursor, TOKENS, escapeHtml,
  demoEyebrowHtml, EYEBROW_LINKS_CSS,
} from "../../src/services/viz-theme.mjs";

test("countLabel: a regular plural noun, singular vs plural count", () => {
  assert.equal(countLabel(1, "fact"), "1 fact");
  assert.equal(countLabel(0, "fact"), "0 facts");
  assert.equal(countLabel(2, "fact"), "2 facts");
  assert.equal(countLabel(3, "disk"), "3 disks");
  assert.equal(countLabel(1, "disk"), "1 disk");
});

test("countLabel: an irregular plural is taken from the explicit `plural` argument, not derived", () => {
  assert.equal(countLabel(1, "child", "children"), "1 child");
  assert.equal(countLabel(2, "child", "children"), "2 children");
});

test("rowsForWorld keeps only rows whose provenance starts with world:<name>", () => {
  const rows = [
    { subject: "a", provenance: "world:mud-garden" },
    { subject: "b", provenance: "world:mud-garden:turn2" },
    { subject: "c", provenance: "world:ashcombe-hall" },
    { subject: "d", provenance: "teach:chat:abc@1" },
    { subject: "e" },
  ];
  const kept = rowsForWorld(rows, "mud-garden");
  assert.deepEqual(kept.map((r) => r.subject), ["a", "b"]);
});

test("rowsForWorld: no rows and no matches both come back as an empty array", () => {
  assert.deepEqual(rowsForWorld([], "mud-garden"), []);
  assert.deepEqual(rowsForWorld(null, "mud-garden"), []);
  assert.deepEqual(rowsForWorld([{ subject: "a", provenance: "world:other" }], "mud-garden"), []);
});

test("meterBarHtml: a clamped-percentage meter, the class riding on the inner fill", () => {
  const html = meterBarHtml("spider", 5, 10);
  assert.match(html, /class="meter-track"/);
  assert.match(html, /class="meter-fill spider"/);
  assert.match(html, /width:50%/);
});

test("meterBarHtml clamps out-of-range values to 0-100%", () => {
  assert.match(meterBarHtml("fly", -5, 10), /width:0%/);
  assert.match(meterBarHtml("fly", 50, 10), /width:100%/);
});

test("meterBarHtml is empty when there is nothing to show", () => {
  assert.equal(meterBarHtml("spider", null, 10), "");
  assert.equal(meterBarHtml("spider", 5, 0), "");
  assert.equal(meterBarHtml("spider", 5, null), "");
});

test("wordBeforeCursor reads the identifier-shaped word immediately before the cursor", () => {
  assert.equal(wordBeforeCursor("the moat is a ditch", 8), "moat");
  assert.equal(wordBeforeCursor("dig-north", 9), "dig-north");
  assert.equal(wordBeforeCursor("hello world", 5), "hello");
});

test("wordBeforeCursor is empty right after whitespace or at the start of the text", () => {
  assert.equal(wordBeforeCursor("hello world", 6), "");
  assert.equal(wordBeforeCursor("hello", 0), "");
  assert.equal(wordBeforeCursor("", 0), "");
});

test("TOKENS exports both theme tiers with the fields the CSS builder reads", () => {
  assert.ok(TOKENS.light && TOKENS.dark);
  for (const tier of [TOKENS.light, TOKENS.dark]) {
    assert.equal(typeof tier.bg, "string");
    assert.equal(typeof tier.ink, "string");
    assert.equal(typeof tier.taught, "string");
    assert.equal(typeof tier.corpus, "string");
    assert.equal(typeof tier.entail, "string");
    assert.equal(typeof tier.alert, "string");
  }
});

test("meterBarHtml escapes its class name the same way every other HTML builder here does", () => {
  const html = meterBarHtml("<script>", 1, 2);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, new RegExp(escapeHtml("<script>").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("demoEyebrowHtml links home, the demo's own page and its about page, in that order", () => {
  const html = demoEyebrowHtml("mud", "mud");
  assert.equal(
    html,
    '<span class="eyebrow-links"><a href="./index.html">tmct</a> &middot; <a href="./mud.html">mud</a> &middot; <a href="./mud-about.html">about</a></span>',
  );
});

test("demoEyebrowHtml derives the about page from the same page key it links to, not a hand-typed suffix", () => {
  const html = demoEyebrowHtml("spider-fly", "spider and fly");
  assert.match(html, /href="\.\/spider-fly\.html"/);
  assert.match(html, /href="\.\/spider-fly-about\.html"/);
});

test("demoEyebrowHtml escapes an untrusted label the same way every other HTML builder here does", () => {
  const html = demoEyebrowHtml("mud", "<script>");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, new RegExp(escapeHtml("<script>").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("EYEBROW_LINKS_CSS scopes its rule to the links demoEyebrowHtml renders", () => {
  assert.match(EYEBROW_LINKS_CSS, /\.eyebrow-links a \{/);
});
