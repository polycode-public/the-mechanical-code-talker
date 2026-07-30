// memory-ask-browser-bundle.test.mjs — proves the checked-in browser
// MEMORY-graph ask-engine bundle (scripts/build-ask-bundle.mjs's output,
// src/surfaces/web/memory-ask-browser.bundle.js, inlined by `tmct viz`'s ledger-page chat
// dock) actually evaluates as a classic script and answers a real
// memory-graph question, end to end, from an embedded payload (the SAME
// mechanism the real page uses, ZERO fs I/O).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(here, "..", "src", "surfaces", "web", "memory-ask-browser.bundle.js");

async function loadBundleContext() {
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  const ctx = vm.createContext({ console });
  vm.runInContext(bundle, ctx);
  return ctx;
}

/** Open the bundle's own session over `payload` and put one question to it,
 *  the way the ledger dock does. */
async function askBundle(ctx, payload, question) {
  ctx.__payload = payload;
  vm.runInContext("globalThis.__opened = tmct.open({ payload: __payload });", ctx);
  return vm.runInContext(`__opened.then(() => tmct.ask(${JSON.stringify(question)}))`, ctx);
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

test("the bundle evaluates as a classic script with no live import/require and publishes the shared tmct surface", async () => {
  const bundle = await readFile(BUNDLE_PATH, "utf8");
  assert.doesNotMatch(bundle, /^import\s/m, "an import statement survived bundling — not a valid classic <script>");
  const ctx = await loadBundleContext();
  assert.equal(typeof vm.runInContext("tmct", ctx), "object", "globalThis.tmct is exposed");
  const keys = vm.runInContext("Object.keys(tmct)", ctx);
  for (const name of ["open", "session", "ask", "turn", "plan", "page"]) {
    assert.ok(keys.includes(name), `tmct.${name} is exposed`);
  }
  const pageKeys = vm.runInContext("Object.keys(tmct.page)", ctx);
  for (const name of ["normFactTerm", "digestTermFromPayloadBrowser"]) {
    assert.ok(pageKeys.includes(name), `tmct.page.${name} is exposed`);
  }
});

test("this bundle publishes as the question-only stand-in, so a page carrying the live engine too keeps the live one", async () => {
  const ctx = await loadBundleContext();
  assert.equal(vm.runInContext("tmct.fallback", ctx), true);
});

test("this bundle holds no conversation and plans nothing, and says so rather than failing", async () => {
  const ctx = await loadBundleContext();
  await askBundle(ctx, { individuals: [], objectProperties: [] }, "anything");
  const spoken = await vm.runInContext('tmct.turn("a dog is an animal")', ctx);
  assert.match(spoken.answer, /no conversational turn/);
  const planned = await vm.runInContext('tmct.plan("assess the graph")', ctx);
  assert.equal(planned.refused, true);
  assert.match(planned.why, /no capability planner/);
});

test("e2e: tmct.ask answers a real memory-graph question from an embedded payload — ZERO fs I/O, the SAME mechanism the real ledger page uses", async () => {
  const ctx = await loadBundleContext();
  const payload = {
    individuals: [
      factIndividual("fact:1", "dog", "rdfs:subClassOf", "animal", "corpus:human"),
      factIndividual("fact:2", "dog", "mgx:hasA", "tail", "corpus:conceptnet /r/HasA"),
    ],
    objectProperties: [],
  };
  const hit = await askBundle(ctx, payload, "what is a dog");
  assert.equal(hit.miss, false, "a real answer comes back — this engine (unlike the code-graph one) knows what a Fact is");
  assert.match(hit.answer, /dog is a kind of animal/);
  assert.match(hit.answer, /dog has tail/);

  const miss = await vm.runInContext('tmct.ask("what is a nonexistent_term_xyz")', ctx);
  assert.equal(miss.miss, true, "an honest miss for a term the graph has no facts about — never a fabricated answer");
  assert.equal(miss.answer, null);
});

test("e2e: an answered question carries the additive goal field the dock renders as its goal line, with chat's own deduced wording", async () => {
  const ctx = await loadBundleContext();
  const hit = await askBundle(ctx, {
    individuals: [factIndividual("fact:1", "dog", "rdfs:subClassOf", "animal", "corpus:human")],
    objectProperties: [],
  }, "what is a dog");
  assert.equal(hit.data.goal, 'understand a vocabulary/definition term ("dog")');
});

test("e2e: normFactTerm inside the bundle normalizes the same way memory/core.mjs's real export does (case-fold, article-strip) — the client-side focus-follows-answer heuristic depends on this matching exactly", async () => {
  const ctx = await loadBundleContext();
  assert.equal(vm.runInContext('tmct.page.normFactTerm("The Dog")', ctx), "dog");
  assert.equal(vm.runInContext('tmct.page.normFactTerm("a horse")', ctx), "horse");
});
