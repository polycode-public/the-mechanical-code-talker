// The hand-maintained homepage (public/index.html, git-tracked, with only its
// version stamp generated) must keep the ledger hero wired: the iframe onto
// ledger.html is the deployed site's primary demo surface, and nothing else
// guards it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const INDEX = fileURLToPath(new URL("../public/index.html", import.meta.url));

test("the homepage embeds the ledger hero: iframe onto ledger.html, full-screen link, hero above the lineage prose", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.match(html, /<div class="ledger-hero">/);
  assert.match(html, /<iframe src="\.\/ledger\.html"/);
  assert.match(html, /<a href="\.\/ledger\.html">open full-screen/);
  const hero = html.indexOf('<div class="ledger-hero">');
  const lineage = html.indexOf("<em>ELIZA/PARRY lineage</em>");
  assert.ok(hero !== -1 && lineage !== -1 && hero < lineage, "the ledger hero renders above the ELIZA/PARRY prose");
});

test("the homepage embeds the spider-and-fly hero: a preview iframe onto spider-fly.html, a full-screen link, alongside the other two heroes above the lineage prose", async () => {
  const html = await readFile(INDEX, "utf8");
  assert.match(html, /<div class="spider-fly-hero">/);
  assert.match(html, /<iframe src="\.\/spider-fly\.html\?preview=1"/, "the embedded preview asks for the page's own non-interactive auto-play mode");
  assert.match(html, /<a href="\.\/spider-fly\.html">open full-screen/);

  const ledgerHero = html.indexOf('<div class="ledger-hero">');
  const planHero = html.indexOf('<div class="plan-render">');
  const spiderFlyHero = html.indexOf('<div class="spider-fly-hero">');
  const lineage = html.indexOf("<em>ELIZA/PARRY lineage</em>");
  assert.ok(
    [ledgerHero, planHero, spiderFlyHero, lineage].every((i) => i !== -1),
    "all three heroes and the lineage prose are present",
  );
  assert.ok(
    ledgerHero < planHero && planHero < spiderFlyHero && spiderFlyHero < lineage,
    "the three heroes render in order, all above the ELIZA/PARRY prose",
  );
});
