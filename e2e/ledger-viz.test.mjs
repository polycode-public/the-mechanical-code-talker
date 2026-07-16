// ledger-viz.test.mjs — unit coverage of computeLedgerData/renderLedgerHtml:
// this file owns the data derivation + rendered-page contracts; the CLI flag
// surface lives in e2e/ledger-viz-cli.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, loadMemory, readFactRows, findContradictions } from "../src/adapters/memory/core.mjs";
import {
  computeLedgerData, computeLedgerDataFromPayload, renderLedgerHtml,
  provBucketFor, phraseFor, familyFor, facetCounts,
} from "../src/services/ledger-viz.mjs";

const T_OLD = "2026-06-01T10:00:00.000Z";
const T_WEEK = "2026-07-12T10:00:00.000Z";
const T_NEW = "2026-07-15T09:00:00.000Z";

async function seededRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ledger-"));
  await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:human /r/IsA", createdAt: T_OLD });
  await appendFact(dir, { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA", createdAt: T_OLD });
  await appendFact(dir, { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf", createdAt: T_WEEK });
  await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat", createdAt: T_NEW });
  await appendFact(dir, { subject: "disk-1", predicate: "mgx:rest-on", object: "peg-a", provenance: "teach:chat", createdAt: T_NEW });
  // A real contradiction pair: same (subject, predicate), two trusted objects.
  await appendFact(dir, { subject: "logger", predicate: "mgx:hasProperty", object: "deprecated", provenance: "teach:chat", createdAt: T_WEEK });
  await appendFact(dir, { subject: "logger", predicate: "mgx:hasProperty", object: "maintained", provenance: "corpus:seon", createdAt: T_OLD });
  return dir;
}

test("computeLedgerData: a missing memory dir yields empty rows and a null focus, never a throw", async () => {
  const data = await computeLedgerData(join(tmpdir(), "tmct-ledger-nonexistent-xyz"));
  assert.deepEqual(data.rows, []);
  assert.equal(data.focus, null);
  assert.equal(data.meta.truncated, false);
});

test("computeLedgerData: rows join createdAt off the Fact individual and carry prov/trustTier/family; counts match readFactRows", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    const factRows = readFactRows(await loadMemory(dir));
    assert.equal(data.rows.length, factRows.length, "one ledger row per fact row");
    const byId = new Map(data.rows.map((r) => [r.id, r]));
    for (const fr of factRows) {
      const row = byId.get(fr.id);
      assert.ok(row, `fact ${fr.id} has a ledger row`);
      assert.ok(row.createdAt, "createdAt joined from the Fact individual");
      assert.ok(["taught", "corpus", "entailed"].includes(row.prov));
      assert.ok([1, 2, 3].includes(row.trustTier));
    }
    const taught = data.rows.find((r) => r.s === "ahab");
    assert.equal(taught.prov, "taught");
    const corpus = data.rows.find((r) => r.p === "rdfs:subClassOf");
    assert.equal(corpus.prov, "corpus");
    assert.equal(corpus.family, "is-a");
    assert.equal(data.rows.find((r) => r.p === "mgx:rest-on").family, "rests-on");
    assert.equal(data.rows.find((r) => r.p === "mgx:hasA").family, "has");
    // Facet counts over the focus's rows agree with a direct readFactRows count.
    const focus = data.focus;
    const mine = data.rows.filter((r) => r.s === focus || r.o === focus);
    const direct = factRows.filter((r) => r.subject === focus || r.object === focus);
    assert.equal(mine.length, direct.length, "focus-touching row count matches readFactRows");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("provBucketFor: source types win over the provenance string; entailed and taught branches classify", () => {
  assert.equal(provBucketFor(["teach"], "corpus:human"), "taught");
  assert.equal(provBucketFor(["operator"], ""), "taught");
  assert.equal(provBucketFor(["entailed"], ""), "entailed");
  assert.equal(provBucketFor(["corpus"], ""), "corpus");
  assert.equal(provBucketFor([], "teach:chat"), "taught");
  assert.equal(provBucketFor([], "ace:chat:xyz"), "taught");
  assert.equal(provBucketFor([], "entailed: cax-sco"), "entailed");
  assert.equal(provBucketFor([], "corpus:human /r/IsA"), "corpus");
});

test("phraseFor/familyFor: curated table, prep-fold, comparative, and verbatim fallback", () => {
  assert.equal(phraseFor("rdfs:subClassOf"), "is a kind of");
  assert.equal(phraseFor("mgx:rest-on"), "rests on");
  assert.equal(phraseFor("mgx:smaller-than"), "is smaller than");
  assert.equal(phraseFor("mgx:unheard_of"), "unheard of");
  assert.equal(familyFor("mgx:rest-on"), "rests-on");
  assert.equal(familyFor("mgx:smaller-than"), "other");
  assert.equal(familyFor("rdf:type"), "is-a");
});

test("computeLedgerData: focus defaults to the newest taught row's subject; --term resolves via normFactTerm; a miss never seeds a phantom", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    // ahab and disk-1 share T_NEW; rows tie-break by id, so accept either.
    assert.ok(["ahab", "disk-1"].includes(data.focus));
    const dog = await computeLedgerData(dir, { term: "Dog" });
    assert.equal(dog.focus, "dog");
    const miss = await computeLedgerData(dir, { term: "nonexistent-word-xyz" });
    assert.ok(["ahab", "disk-1"].includes(miss.focus), "an unresolvable term falls back to the default seed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeLedgerData: contradictions embed findContradictions' real group shape, ids resolving to embedded rows", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    const real = findContradictions(await loadMemory(dir));
    assert.equal(data.contradictions.length, real.length);
    assert.ok(data.contradictions.length >= 1, "the seeded logger pair is found");
    const rowIds = new Set(data.rows.map((r) => r.id));
    for (const group of data.contradictions) {
      assert.ok(group.length > 1);
      for (const id of group) assert.ok(rowIds.has(id), `contradiction id ${id} resolves to an embedded row`);
    }
    assert.equal(data.worthALook.contradictions.count, real.length);
    assert.equal(data.worthALook.contradictions.firstFocusTerm, "logger");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeLedgerDataFromPayload: the row cap keeps the focus 2-hop neighborhood first and reports meta.truncated", async () => {
  const dir = await seededRepo();
  try {
    const payload = await loadMemory(dir);
    const data = computeLedgerDataFromPayload(payload, { term: "dog", rowLimit: 3 });
    assert.equal(data.focus, "dog");
    assert.equal(data.meta.truncated, true);
    assert.equal(data.meta.shown, 3);
    assert.ok(data.meta.total > 3);
    for (const r of data.rows) {
      assert.ok(r.s === "dog" || r.o === "dog" || ["animal", "tail", "bark"].includes(r.s) || ["animal", "tail", "bark"].includes(r.o),
        `capped row ${r.s} ${r.p} ${r.o} stays in dog's neighborhood`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderLedgerHtml: self-contained page with parseable LEDGER/PAYLOAD, both theme schemes, reduced-motion and focus-visible", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    const html = renderLedgerHtml({ ...data, memoryAskBundle: "" });
    assert.ok(!/<(script|link|img)[^>]+(src|href)\s*=\s*["']https?:/i.test(html), "no external resource loads");
    const grab = (name) => {
      const m = new RegExp(`const ${name} = (.*);`).exec(html);
      assert.ok(m, `const ${name} embedded`);
      return JSON.parse(m[1]);
    };
    const ledger = grab("LEDGER");
    grab("PAYLOAD");
    assert.equal(ledger.rows.length, data.rows.length);
    assert.equal(ledger.focus, data.focus);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /data-theme="light"/);
    assert.match(html, /data-theme="dark"/);
    assert.match(html, /prefers-reduced-motion/);
    assert.match(html, /:focus-visible/);
    assert.match(html, /more than one answer on record/);
    assert.match(html, /worth a look/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- phase 2: the chat dock ------------------------------------------------

import { resolveAnsweredTerm } from "../src/services/ledger-viz.mjs";
import { normFactTerm } from "../src/adapters/memory/core.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { runTurn } from "../src/services/chat.mjs";
import { clearCache } from "../src/adapters/source.mjs";

test("resolveAnsweredTerm: the earliest term label in the answer text wins", () => {
  const terms = [{ term: "john" }, { term: "ahab" }, { term: "ishmael" }];
  const hit = resolveAnsweredTerm("ahab — you told me: ahab fathers john", "who is the grandfather of ishmael", terms, normFactTerm);
  assert.equal(hit, "ahab");
});

test("resolveAnsweredTerm: falls back to stripping the question's crust and normalizing", () => {
  const hit = resolveAnsweredTerm("yes", "what is a dog?", [{ term: "dog" }], normFactTerm);
  assert.equal(hit, "dog");
});

test("resolveAnsweredTerm: no term resolves -> null (the answer renders without refocusing)", () => {
  const hit = resolveAnsweredTerm("no idea", "gibberish question", [{ term: "dog" }], normFactTerm);
  assert.equal(hit, null);
});

test("renderLedgerHtml: a non-empty bundle is inlined and the dock renders enabled; an empty one renders the honest disabled note", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    const fake = "/* fake-bundle-marker */ globalThis.tmctMemoryAsk = {};";
    const on = renderLedgerHtml({ ...data, memoryAskBundle: fake });
    assert.ok(on.includes(fake), "the bundle string is embedded verbatim");
    assert.match(on, /id="chatform"/);
    assert.match(on, /resolveAnsweredTerm/, "the answer-to-focus helper ships in the page");
    assert.match(on, /Goal \(inferred\): /, "the dock renders the engine's goal field as chat's own goal line");
    assert.doesNotMatch(on, /chat unavailable/);
    const off = renderLedgerHtml({ ...data, memoryAskBundle: "" });
    assert.match(off, /chat unavailable/);
    assert.match(off, /npm run build:ask-bundle/);
    assert.doesNotMatch(off, /id="chatform"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("chat dock chain: a store taught via runTurn answers through the real bundle in a vm; the canonical exchange upgrades when factReadBack ships on the bundle surface", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ledger-dock-"));
  const FIXTURE = fileURLToPath(new URL("../test/fixtures/entities.fixture.json", import.meta.url));
  try {
    const TEACH = [
      "ahab is the father of john",
      "john is the father of ishmael",
      "a father is a kind of parent",
      "remember that ahab is male",
      "a grandparent is a parent of a parent",
      "a grandfather is a grandparent who is male",
    ];
    for (const line of TEACH) {
      const r = await runTurn(line, { config: { graphFile: FIXTURE }, memoryDir: dir, sessionId: "dock" });
      assert.equal(r.record.miss, false, `"${line}" should teach (got: ${r.answer})`);
    }
    const payload = await loadMemory(dir);
    const bundle = await readFile(fileURLToPath(new URL("../src/surfaces/memory-ask-browser.bundle.js", import.meta.url)), "utf8");
    const ctx = vm.createContext({ console });
    vm.runInContext(bundle, ctx);
    ctx.__payload = payload;
    vm.runInContext("globalThis.__handle = tmctMemoryAsk.createInMemoryStore(); __handle.payload = __payload;", ctx);

    // factAnswer's own surface answers the definition shape from this store.
    const def = await vm.runInContext('tmctMemoryAsk.factAnswer(__handle, "what is a father", null, true, {})', ctx);
    assert.ok(def && def.text, "factAnswer answers a definition question from the taught store");
    assert.match(def.text, /father is a kind of parent/);

    // The canonical exchange is a relation chase, which lives in factReadBack
    // (runAsk's cascade is factAnswer ?? factReadBack). The dock chains both.
    const hasReadBack = vm.runInContext('typeof tmctMemoryAsk.factReadBack === "function"', ctx);
    const fact = hasReadBack
      ? await vm.runInContext('tmctMemoryAsk.factAnswer(__handle, "who is the grandfather of ishmael", null, true, {}).then((f) => f && f.text ? f : tmctMemoryAsk.factReadBack(__handle, "who is the grandfather of ishmael", null, true, null))', ctx)
      : await vm.runInContext('tmctMemoryAsk.factAnswer(__handle, "who is the grandfather of ishmael", null, true, {})', ctx);
    if (hasReadBack) {
      assert.ok(fact && fact.text, "the chained engines answer the canonical exchange");
      assert.match(fact.text, /ahab/);
      assert.equal(fact.goal, "look up a taught fact about a subject/verb/object", "the relation chase carries the additive goal field for the dock's goal line");
      const term = resolveAnsweredTerm(fact.text, "who is the grandfather of ishmael", [{ term: "ahab" }, { term: "john" }, { term: "ishmael" }], normFactTerm);
      assert.equal(term, "ahab", "answer-to-focus lands on the answering term");
    } else {
      assert.equal(fact, null, "without factReadBack on the bundle surface, factAnswer alone misses honestly — never fabricates");
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the segment rail's cross-filter facet counts ---------------------------

const FACET_NOW = Date.parse("2026-07-15T12:00:00.000Z");
const hoursAgo = (h) => new Date(FACET_NOW - h * 3600000).toISOString();
const FACET_ROWS = [
  { s: "logger", o: "module", prov: "taught", family: "is-a", createdAt: hoursAgo(2) },
  { s: "logger", o: "output", prov: "taught", family: "has", createdAt: hoursAgo(3 * 24) },
  { s: "logger", o: "log", prov: "corpus", family: "can", createdAt: hoursAgo(30 * 24) },
  { s: "console", o: "logger", prov: "entail", family: "rests-on", createdAt: hoursAgo(1) },
  { s: "dog", o: "animal", prov: "corpus", family: "is-a", createdAt: hoursAgo(1) },
];
const emptySel = () => ({ prov: new Set(), fam: new Set(), rec: new Set() });

test("facetCounts: an empty selection counts every row touching the focus, subject or object side", () => {
  const counts = facetCounts(FACET_ROWS, "logger", emptySel(), FACET_NOW);
  assert.deepEqual(counts.prov, { taught: 2, corpus: 1, entail: 1 });
  assert.deepEqual(counts.fam, { "is-a": 1, has: 1, can: 1, "rests-on": 1 });
  assert.deepEqual(counts.rec, { today: 2, "this week": 1, older: 1 });
});

test("facetCounts: a selected family narrows the other rails but never its own", () => {
  const sel = emptySel();
  sel.fam.add("has");
  const counts = facetCounts(FACET_ROWS, "logger", sel, FACET_NOW);
  const open = facetCounts(FACET_ROWS, "logger", emptySel(), FACET_NOW);
  assert.deepEqual(counts.fam, open.fam, "the family rail ignores its own selection");
  assert.deepEqual(counts.prov, { taught: 1 });
  assert.deepEqual(counts.rec, { "this week": 1 });
});

test("facetCounts: multi-select unions within a group; two active groups both narrow the third", () => {
  const sel = emptySel();
  sel.prov.add("taught").add("entail");
  const unioned = facetCounts(FACET_ROWS, "logger", sel, FACET_NOW);
  assert.deepEqual(unioned.fam, { "is-a": 1, has: 1, "rests-on": 1 });
  sel.rec.add("today");
  const doubled = facetCounts(FACET_ROWS, "logger", sel, FACET_NOW);
  assert.deepEqual(doubled.fam, { "is-a": 1, "rests-on": 1 });
});

test("facetCounts: an unparseable createdAt buckets as older; no focus counts nothing", () => {
  const rows = [{ s: "logger", o: "x", prov: "taught", family: "has", createdAt: "not-a-date" }];
  const counts = facetCounts(rows, "logger", emptySel(), FACET_NOW);
  assert.deepEqual(counts.rec, { older: 1 });
  const unfocused = facetCounts(FACET_ROWS, null, emptySel(), FACET_NOW);
  assert.deepEqual(unfocused, { prov: {}, fam: {}, rec: {} });
});

test("renderLedgerHtml: the page inlines facetCounts verbatim and the segment rail consumes it", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    const html = renderLedgerHtml({ ...data, memoryAskBundle: "" });
    assert.match(html, /const facetCounts = function facetCounts\(/);
    assert.match(html, /facetCounts\(LEDGER\.rows, focus, sel, Date\.now\(\)\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
