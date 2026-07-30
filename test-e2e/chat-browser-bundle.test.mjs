// The home page's chat bundle (scripts/build-chat-bundle.mjs's output,
// gitignored, rebuilt on every deploy), proven end to end in a vm: it
// evaluates as a classic script, exposes globalThis.tmct, and runs REAL
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
import { readDigestStructures } from "../src/adapters/corpus/digest-bank.mjs";

const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const DIGEST_STRUCTURES = readDigestStructures();

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

// tmct.open(...) is always async (publishTmctSurface's own contract), so its
// completion value has to be awaited before __s is usable — vm.runInContext
// itself is synchronous and hands back exactly that unresolved promise.
async function openSession(ctx, expr) {
  const opened = vm.runInContext(`(${expr})`, ctx);
  ctx.__s = await opened;
}

async function seededSession(ctx) {
  ctx.__payload = {
    individuals: [
      factIndividual("fact:1", "dog", "rdfs:subClassOf", "animal", "corpus:human /r/IsA"),
      factIndividual("fact:2", "dog", "mgx:hasA", "tail", "corpus:human /r/HasA"),
    ],
    objectProperties: [],
  };
  await openSession(ctx, "tmct.open({ seedPayload: __payload, vocabSeeded: true })");
}

const turn = (ctx, line) => vm.runInContext(`__s.turn(${JSON.stringify(line)})`, ctx);

test("the bundle evaluates as a classic script in a browser-shaped context (console + TextEncoder, NO process) and exposes globalThis.tmct with its verbs and page bag", () => {
  assert.ok(bundle.length < MAX_BUNDLE_BYTES, `bundle is ${bundle.length} bytes — under the ${MAX_BUNDLE_BYTES}-byte ceiling`);
  assert.doesNotMatch(bundle, /^import\s/m, "an import statement survived bundling — not a valid classic <script>");
  const ctx = browserContext();
  assert.equal(vm.runInContext("typeof process", ctx), "undefined", "no process global exists — the engine must never reach for one");
  const verbs = vm.runInContext("Object.keys(tmct)", ctx);
  for (const name of ["open", "turn", "ask", "plan", "page"]) {
    assert.ok(verbs.includes(name), `tmct.${name} is exposed`);
  }
  const pageKeys = vm.runInContext("Object.keys(tmct.page)", ctx);
  for (const name of ["registerWinkModel", "registerReferencePackProvider", "normFactTerm", "vocabExampleHint"]) {
    assert.ok(pageKeys.includes(name), `tmct.page.${name} is exposed`);
  }
});

test("a seeded session answers a vocabulary question with its source line", async () => {
  const ctx = browserContext();
  await seededSession(ctx);
  const { answer } = await turn(ctx, "what is a dog");
  assert.match(answer, /dog is a kind of animal \(source: corpus:human/);
});

test("teach + syllogism: 'every dog is a mammal' / 'rex is a dog' / 'is rex a mammal' answers yes with a two-fact proof chain", async () => {
  const ctx = browserContext();
  await seededSession(ctx);
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
  await seededSession(ctx);
  const { answer, record } = await turn(ctx, "what is a zorblatt");
  assert.match(answer, /I don't know "zorblatt" yet/);
  assert.equal(record?.miss, true, "the turn records itself as a miss");
});

test("a code-structure question hits the no-code-graph wall — the session's graph is known-empty, not absent", async () => {
  const ctx = browserContext();
  await seededSession(ctx);
  const { answer } = await turn(ctx, "which modules import src/core/store.mjs?");
  assert.match(answer, /no code graph is loaded in this session/);
});

test("the guessing game runs in the browser context: bisection guesses land and the win names the number", async () => {
  const ctx = browserContext();
  await seededSession(ctx);
  const opening = await turn(ctx, "I'm thinking of a number between 1 and 100");
  assert.match(opening.answer, /My guess: 50\. Say higher, lower, or correct\./);
  const second = await turn(ctx, "higher");
  assert.match(second.answer, /My guess: 75\./);
  const third = await turn(ctx, "lower");
  assert.match(third.answer, /My guess: 62\./);
  const fourth = await turn(ctx, "higher");
  assert.match(fourth.answer, /My guess: 68\./);
  const win = await turn(ctx, "correct");
  assert.match(win.answer, /Got it — your number is 68, found in 4 guesses/);
});

test("learn-on-miss reaches a registered pack provider from inside the bundle and answers cited", async () => {
  const ctx = browserContext();
  await seededSession(ctx);
  ctx.__article = {
    term: "otter", title: "Otter",
    text: "Otters are water animals. They swim well.",
    summary: "Otters are water animals.",
    url: "https://simple.wikipedia.org/wiki/Otter", revid: 424242, isa: "animal",
  };
  vm.runInContext("tmct.page.registerReferencePackProvider({ lookup: async (t) => (t === 'otter' ? __article : null) })", ctx);
  try {
    const { answer, record } = await turn(ctx, "what is an otter");
    assert.match(answer, /^otter — Otters are water animals\./);
    assert.match(answer, /\(source: reference article "Otter", Simple English Wikipedia, CC BY-SA 4\.0 — https:\/\/simple\.wikipedia\.org\/wiki\/Otter\?oldid=424242\)/);
    assert.equal(record?.miss, false, "the cited answer is not a miss");
    const second = await turn(ctx, "what is an otter");
    assert.match(second.answer, /otter is a kind of animal/, "the stored isa fact answers the second ask from memory");
  } finally {
    vm.runInContext("tmct.page.registerReferencePackProvider(null)", ctx);
  }
});

// A 9-fact isa cluster for one term, one fact over the DIGEST_READBACK_THRESHOLD
// (8) so chat.mjs's own subject-scan answer takes the digest branch.
const DIGEST_OBJECTS = ["apple", "banana", "cherry", "date", "elderberry", "fig", "grape", "honeydew", "indigo"];
function digestFixturePayload() {
  return {
    individuals: DIGEST_OBJECTS.map((obj, i) => factIndividual(`fact:g${i}`, "gizmo", "rdfs:subClassOf", obj, "corpus:test /r/IsA")),
    objectProperties: [],
  };
}

test("a session created with digestStructures answers a long term list with a composed digest lead, not the flat fact-line list", async () => {
  const ctx = browserContext();
  ctx.__digestPayload = digestFixturePayload();
  ctx.__digestStructures = DIGEST_STRUCTURES;
  await openSession(ctx, "tmct.open({ seedPayload: __digestPayload, vocabSeeded: true, digestStructures: __digestStructures })");
  const { answer } = await turn(ctx, "what is a gizmo");
  // termDigestReadBack's own escape line ("Say 'show the facts' for all N
  // stored facts.") only ever appears on the digest path — the flat/grouped
  // fallbacks close with "…and N more — say 'more' to see them." instead
  // (chat.mjs's answerFact), so this pair of assertions is a real structural
  // check, not a wording guess.
  assert.match(answer, /Say 'show the facts' for all 9 stored facts\./, `expected a digest lead, got: ${answer}`);
  assert.doesNotMatch(answer, /…and \d+ more — say 'more' to see them\./);
  assert.match(answer, /gizmos are/i, "the isa 'several' template names the term in its composed sentence");
});

test("a session created with no digestStructures still degrades to the flat fact list for the same long term list, and never throws", async () => {
  const ctx = browserContext();
  ctx.__digestPayload = digestFixturePayload();
  await openSession(ctx, "tmct.open({ seedPayload: __digestPayload, vocabSeeded: true })");
  const { answer } = await turn(ctx, "what is a gizmo");
  assert.doesNotMatch(answer, /Say 'show the facts' for all \d+ stored facts\./, "with no structure table the digest path never fires");
  assert.match(answer, /gizmo is a kind of apple/, "the flat fact-line list still answers, one bracketed line per fact");
});

test("an unseeded session still turns, and the false vocab hint offers the teach pointer instead of an unanswerable example", async () => {
  const ctx = browserContext();
  await openSession(ctx, "tmct.open({})");
  const { answer } = await turn(ctx, "what is a dog");
  assert.match(answer, /I don't know "dog" yet/);
  const hint = vm.runInContext("tmct.page.vocabExampleHint(false)", ctx);
  assert.match(hint, /teach me directly/);
});
