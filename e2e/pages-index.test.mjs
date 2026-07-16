// The hand-maintained homepage (public/index.html, git-tracked, never
// generated) must keep the ledger hero wired: the iframe onto ledger.html is
// the deployed site's primary demo surface, and nothing else guards it.
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
