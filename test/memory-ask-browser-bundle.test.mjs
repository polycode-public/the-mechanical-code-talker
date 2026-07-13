// memory-ask-browser-bundle.test.mjs — proves the checked-in browser
// MEMORY-graph ask-engine bundle (scripts/build-ask-bundle.mjs's SECOND
// output, src/memory-ask-browser.bundle.js, inlined by `tmct viz`'s "Ask the
// graph" panel — PLAN_VIZ_MEMORY.md Bug 1 fix) actually evaluates as a
// classic script and answers a real memory-graph question, end to end, given
// an in-memory Backend-B handle carrying an embedded payload (the SAME
// mechanism the real page uses, ZERO fs I/O) — mirroring
// test/ask-browser-bundle.test.mjs's own established pattern for the
// sibling code-graph bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(here, "..", "src", "memory-ask-browser.bundle.js");

async function loadBundleContext() {
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  const ctx = vm.createContext({ console });
  vm.runInContext(bundle, ctx);
  return ctx;
}

function factIndividual(id, subject, predicate, object, provenance) {
  return {
    id, label: `${subject} ${predicate} ${object}`, class: "Fact",
    attributes: [
      { prop: "rdf:type", key: "type", value: "rdf:Statement" },
      { prop: "rdf:subject", key: "subject", value: subject },
      { prop: "rdf:predicate", key: "predicate", value: predicate },
      { prop: "rdf:object", key: "object", value: object },
      { prop: "mgx:factProvenance", key: "provenance", value: provenance },
    ],
  };
}

test("memory-ask-browser.bundle.js exists and is a checked-in build artifact (run `npm run build:ask-bundle` if this fails)", async () => {
  const content = await readFile(BUNDLE_PATH, "utf8").catch(() => null);
  assert.ok(content && content.length > 1000, "the bundle exists and is non-trivial");
});

test("the bundle evaluates as a classic script with no live import/require and exposes globalThis.tmctMemoryAsk", async () => {
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  assert.doesNotMatch(bundle, /^import\s/m, "an import statement survived bundling — not a valid classic <script>");
  const ctx = await loadBundleContext();
  assert.equal(typeof vm.runInContext("tmctMemoryAsk", ctx), "object", "globalThis.tmctMemoryAsk is exposed");
  const keys = vm.runInContext("Object.keys(tmctMemoryAsk)", ctx);
  for (const name of ["factAnswer", "createInMemoryStore", "normFactTerm"]) {
    assert.ok(keys.includes(name), `tmctMemoryAsk.${name} is exposed`);
  }
});

test("e2e: factAnswer answers a real memory-graph question from an in-memory (Backend-B) payload handle — ZERO fs I/O, the SAME mechanism the real viz page uses", async () => {
  const ctx = await loadBundleContext();
  const payload = {
    individuals: [
      factIndividual("fact:1", "dog", "rdfs:subClassOf", "animal", "corpus:human"),
      factIndividual("fact:2", "dog", "mgx:hasA", "tail", "corpus:conceptnet /r/HasA"),
    ],
    objectProperties: [],
  };
  ctx.__payload = payload;
  vm.runInContext("globalThis.__handle = tmctMemoryAsk.createInMemoryStore(); __handle.payload = __payload;", ctx);

  const hitPromise = vm.runInContext('tmctMemoryAsk.factAnswer(__handle, "what is a dog", null, true, {})', ctx);
  const hit = await hitPromise;
  assert.ok(hit && hit.text, "a real answer comes back — Bug 1's whole point: this engine (unlike the code-graph one) knows what a Fact is");
  assert.match(hit.text, /dog is a kind of animal/);
  assert.match(hit.text, /dog has tail/);

  const missPromise = vm.runInContext('tmctMemoryAsk.factAnswer(__handle, "what is a nonexistent_term_xyz", null, true, {})', ctx);
  const miss = await missPromise;
  assert.equal(miss, null, "an honest null for a term the graph has no facts about — never a fabricated answer");
});

test("e2e: normFactTerm inside the bundle normalizes the same way memory/core.mjs's real export does (case-fold, article-strip) — the client-side focus-follows-answer heuristic depends on this matching exactly", async () => {
  const ctx = await loadBundleContext();
  assert.equal(vm.runInContext('tmctMemoryAsk.normFactTerm("The Dog")', ctx), "dog");
  assert.equal(vm.runInContext('tmctMemoryAsk.normFactTerm("a horse")', ctx), "horse");
});
