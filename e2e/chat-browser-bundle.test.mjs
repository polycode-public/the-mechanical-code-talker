// The home page's chat bundle (scripts/build-chat-bundle.mjs's output,
// gitignored, rebuilt on every deploy), proven end to end in a vm: it
// evaluates as a classic script, exposes globalThis.tmctChat, and runs REAL
// turns through the full engine — a seeded vocabulary answer with its source,
// a taught syllogism read back with proof, the honest miss, and the
// no-code-graph wall — against an in-memory Backend-B handle, zero fs I/O.
//
// The vm context carries `console` plus `TextEncoder` and nothing else — no
// `process`, no node builtins. TextEncoder is a web global every browser has
// (fact-id hashing encodes UTF-8 through it); `process` is not, and the
// engine defaulting `env` to process.env is exactly the trap the entry's own
// `env: {}` exists to close, so its absence here is the proof.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

import { main as buildChatBundle } from "../scripts/build-chat-bundle.mjs";

const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;

let buildDir;
let bundle;

before(async () => {
  buildDir = await mkdtemp(join(tmpdir(), "tmct-chat-bundle-test-"));
  const { outPath } = await buildChatBundle(buildDir);
  bundle = await readFile(outPath, "utf8");
});

test.after(async () => {
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
});

function browserContext() {
  const ctx = vm.createContext({ console, TextEncoder });
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

function seededSession(ctx) {
  ctx.__payload = {
    individuals: [
      factIndividual("fact:1", "dog", "rdfs:subClassOf", "animal", "corpus:human /r/IsA"),
      factIndividual("fact:2", "dog", "mgx:hasA", "tail", "corpus:human /r/HasA"),
    ],
    objectProperties: [],
  };
  vm.runInContext("globalThis.__s = tmctChat.createChatSession({ seedPayload: __payload, vocabSeeded: true })", ctx);
}

const turn = (ctx, line) => vm.runInContext(`__s.turn(${JSON.stringify(line)})`, ctx);

test("the bundle evaluates as a classic script in a browser-shaped context (console + TextEncoder, NO process) and exposes globalThis.tmctChat", () => {
  assert.ok(bundle.length < MAX_BUNDLE_BYTES, `bundle is ${bundle.length} bytes — under the ${MAX_BUNDLE_BYTES}-byte ceiling`);
  assert.doesNotMatch(bundle, /^import\s/m, "an import statement survived bundling — not a valid classic <script>");
  const ctx = browserContext();
  assert.equal(vm.runInContext("typeof process", ctx), "undefined", "no process global exists — the engine must never reach for one");
  const keys = vm.runInContext("Object.keys(tmctChat)", ctx);
  for (const name of ["createChatSession", "registerWinkModel", "registerReferencePackProvider", "normFactTerm", "vocabExampleHint"]) {
    assert.ok(keys.includes(name), `tmctChat.${name} is exposed`);
  }
});

test("a seeded session answers a vocabulary question with its source line", async () => {
  const ctx = browserContext();
  seededSession(ctx);
  const { answer } = await turn(ctx, "what is a dog");
  assert.match(answer, /dog is a kind of animal \(source: corpus:human/);
});

test("teach + syllogism: 'every dog is a mammal' / 'rex is a dog' / 'is rex a mammal' answers yes with a two-fact proof chain", async () => {
  const ctx = browserContext();
  seededSession(ctx);
  const teach1 = await turn(ctx, "every dog is a mammal");
  assert.match(teach1.answer, /^noted — remembered: dog is a kind of mammal/);
  const teach2 = await turn(ctx, "rex is a dog");
  assert.match(teach2.answer, /^noted — remembered: rex is a kind of dog/);
  const { answer } = await turn(ctx, "is rex a mammal");
  assert.match(answer, /^yes — /);
  assert.match(answer, /rex is a kind of dog \(source: teach:chat/);
  assert.match(answer, /dog is a kind of mammal \(source: teach:chat/);
  assert.match(answer, /so rex is a mammal/);
});

test("an unknown term gets the honest miss, never a fabricated answer", async () => {
  const ctx = browserContext();
  seededSession(ctx);
  const { answer, record } = await turn(ctx, "what is a zorblatt");
  assert.match(answer, /I don't know "zorblatt" yet/);
  assert.equal(record?.miss, true, "the turn records itself as a miss");
});

test("a code-structure question hits the no-code-graph wall — the session's graph is known-empty, not absent", async () => {
  const ctx = browserContext();
  seededSession(ctx);
  const { answer } = await turn(ctx, "which modules import src/core/store.mjs?");
  assert.match(answer, /no code graph is loaded in this session/);
});

test("an unseeded session still turns, and the false vocab hint offers the teach pointer instead of an unanswerable example", async () => {
  const ctx = browserContext();
  vm.runInContext("globalThis.__s = tmctChat.createChatSession({})", ctx);
  const { answer } = await turn(ctx, "what is a dog");
  assert.match(answer, /I don't know "dog" yet/);
  const hint = vm.runInContext("tmctChat.vocabExampleHint(false)", ctx);
  assert.match(hint, /teach me directly/);
});
