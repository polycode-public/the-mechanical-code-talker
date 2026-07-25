// digestTermFromPayloadBrowser matches a term against a fact's subject
// through the same spelling-variant fold factTermVariants gives the "what is
// X" fact reader — so a term seeded under its singular/base spelling is still
// found when the browser-side "read a term back" panel queries it under a
// plural or irregular-plural spelling, the way "ask the graph" already does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore, appendFact, loadMemory, normFactTerm } from "../../src/adapters/memory/core.mjs";
import { readDigestStructures } from "../../src/adapters/corpus/digest-bank.mjs";
import { digestTermFromPayloadBrowser, digestTermFromRowsBrowser } from "../../src/surfaces/web/digest-client.mjs";

const STRUCTURES = readDigestStructures();

async function seeded(facts) {
  const handle = createInMemoryStore();
  for (const f of facts) await appendFact(handle, f);
  return loadMemory(handle);
}

test("plural query reaches a term seeded under its singular spelling", async () => {
  const payload = await seeded([
    { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA" },
  ]);
  const view = digestTermFromPayloadBrowser(payload, normFactTerm("dogs"), STRUCTURES);
  assert.ok(view, "expected a non-null digest for the plural spelling");
  assert.match(view.paragraphs.join("\n"), /animal/i);
});

test("an irregular-plural query reaches a term seeded under its singular spelling", async () => {
  const payload = await seeded([
    { subject: "man", predicate: "rdfs:subClassOf", object: "mortal", provenance: "corpus:human /r/IsA" },
  ]);
  const view = digestTermFromPayloadBrowser(payload, normFactTerm("men"), STRUCTURES);
  assert.ok(view, "expected a non-null digest for the irregular-plural spelling");
  assert.match(view.paragraphs.join("\n"), /mortal/i);
});

test("an exact-spelling query still works, unchanged by the variant fold", async () => {
  const payload = await seeded([
    { subject: "aardvark", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:human /r/IsA" },
  ]);
  const view = digestTermFromPayloadBrowser(payload, normFactTerm("aardvark"), STRUCTURES);
  assert.ok(view, "expected a non-null digest for the exact spelling");
  assert.match(view.paragraphs.join("\n"), /mammal/i);
});

test("a term known only as a fact OBJECT still misses — the digest template bank renders the queried term as subject only, so a fact where the term appears only as object has no sentence form to compose into", async () => {
  const payload = await seeded([
    { subject: "ahab", predicate: "mgx:fathers", object: "john", provenance: "corpus:human /r/fathers" },
  ]);
  const view = digestTermFromPayloadBrowser(payload, normFactTerm("john"), STRUCTURES);
  assert.equal(view, null);
});

test("digestTermFromRowsBrowser (the untouched sibling) still trusts caller-filtered termRows and renders nothing when handed none, even though matching rows exist in allRows", () => {
  const allRows = [{ id: "fact:1", subject: "dog", predicate: "rdfs:subClassOf", object: "animal", sourceTypes: ["corpus"], provenance: "corpus:human /r/IsA", trust: 0.5 }];
  const article = digestTermFromRowsBrowser("dogs", [], allRows, STRUCTURES);
  assert.deepEqual(article.paragraphs, [], "an unfiltered empty termRows array yields no narrative — this function does no term matching of its own");
});
