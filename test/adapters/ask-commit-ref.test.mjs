// The friendly commit ref ("abc1234 (Ada Lovelace)") degrades to the bare sha
// when the Commit individual carries no author attribute — needs a mutated
// fixture, so it lives in the unit ring while the authored form is pinned by
// the templates corpus lane.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ask } from "../../src/domain/ask.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/schema-docs.mjs";

const FIXTURE = new URL("../fixtures/entities.fixture.json", import.meta.url);

test("'who touched X' degrades gracefully to the sha alone when no author is recorded", async () => {
  const noAuthor = JSON.parse(await readFile(FIXTURE, "utf8"));
  const commit = noAuthor.individuals.find((i) => i.class === "Commit");
  commit.attributes = (commit.attributes || []).filter((a) => a.key !== "author");
  const g = parseEntities(ingestSchemaDocs(noAuthor));
  const r = ask(g, "who touched app/lib/a.mjs");
  assert.equal(r.content, "abc1234.", "no author → the sha stands alone, no empty parens");
});
