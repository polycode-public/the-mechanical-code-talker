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
  bundleKeyFor, bundleLabelFor, computeLedgerStats,
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
    // LEDGER embeds as "let" (a post-teach re-render reassigns it wholesale —
    // see ledger-viz.mjs's inline script), PAYLOAD stays "const" — either
    // keyword is accepted here so this helper doesn't care which.
    const grab = (name) => {
      const m = new RegExp(`(?:const|let) ${name} = (.*);`).exec(html);
      assert.ok(m, `const/let ${name} embedded`);
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

test("renderLedgerHtml: the query-only placeholder's example term skips short, stopword-shaped terms even when they outrank everything else by degree", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ledger-placeholder-"));
  try {
    // "os" out-degrees every other term (4 distinct facts touch it) but reads
    // as a stray fragment, not an askable concept — the SAME floor the dock's
    // own miss-tips already apply (LEDGER.terms.filter(t.term.length >= 3)),
    // so the one example a visitor sees should honor it too.
    await appendFact(dir, { subject: "os", predicate: "mgx:hasA", object: "kernel", provenance: "corpus:human" });
    await appendFact(dir, { subject: "os", predicate: "mgx:hasA", object: "shell", provenance: "corpus:human" });
    await appendFact(dir, { subject: "os", predicate: "mgx:hasA", object: "filesystem", provenance: "corpus:human" });
    await appendFact(dir, { subject: "os", predicate: "mgx:capableOf", object: "boot", provenance: "corpus:human" });
    const data = await computeLedgerData(dir);
    assert.equal(data.terms[0].term, "os", "the fixture's own degree ranking puts the short term first");
    const fake = "/* fake-bundle-marker */ globalThis.tmctMemoryAsk = {};";
    const html = renderLedgerHtml({ ...data, memoryAskBundle: fake });
    const placeholder = /placeholder="([^"]*)"[^>]*aria-label="Ask the graph"/.exec(html)?.[1];
    assert.ok(placeholder, "the chat input's placeholder attribute renders");
    assert.doesNotMatch(placeholder, /what is os\b/, "the top-degree term is too short to serve as the example");
    assert.match(placeholder, /what is [a-z-]{3,}/, "a real 3+ character term still fills the example");
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
    const bundle = await readFile(fileURLToPath(new URL("../src/surfaces/web/memory-ask-browser.bundle.js", import.meta.url)), "utf8");
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

// ---- the dashboard strip: real counts over the full graph -----------------

test("bundleKeyFor: folds a source string to its stable family prefix; a closed table with a verbatim fallback", () => {
  assert.equal(bundleKeyFor("teach:chat:019f-abc@2026-07-19T22:00:00.000Z | import:hanoi-3.txt"), "teach:chat");
  assert.equal(bundleKeyFor("corpus:human /r/IsA"), "corpus:human");
  assert.equal(bundleKeyFor("corpus:seon"), "corpus:seon");
  assert.equal(bundleKeyFor("ace:chat:xyz"), "ace:chat");
  assert.equal(bundleKeyFor("entailed: cax-sco"), "entailed:cax-sco");
  assert.equal(bundleKeyFor("operator"), "operator");
  assert.equal(bundleKeyFor("import:hanoi-3.txt"), "import:hanoi-3.txt");
  assert.equal(bundleKeyFor(""), "unrecorded");
  assert.equal(bundleKeyFor("some-unrecognized-tag"), "some-unrecognized-tag", "an unknown tag reads as itself");
});

test("bundleLabelFor: human labels for the curated keys, verbatim fallback otherwise", () => {
  assert.equal(bundleLabelFor("teach:chat"), "taught via chat");
  assert.equal(bundleLabelFor("ace:chat"), "taught (parsed)");
  assert.equal(bundleLabelFor("corpus:human"), "corpus: human");
  assert.equal(bundleLabelFor("import:hanoi-3.txt"), "imported: hanoi-3.txt");
  assert.equal(bundleLabelFor("entailed:cax-sco"), "entailed: cax-sco");
  assert.equal(bundleLabelFor("unrecorded"), "unrecorded");
  assert.equal(bundleLabelFor("some-unrecognized-tag"), "some-unrecognized-tag");
});

test("computeLedgerStats: real counts over the seeded fixture — tiers, bundles, predicates, density, quality", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    const s = data.stats;
    assert.equal(s.totalFacts, 7);
    assert.equal(s.totalTerms, 11);
    assert.deepEqual(s.byProv, { taught: 3, corpus: 4, entailed: 0 });
    assert.deepEqual(s.byTier, { 1: 0, 2: 4, 3: 3 });
    assert.deepEqual(s.bundles.map((b) => [b.key, b.count]), [["corpus:human", 3], ["teach:chat", 3], ["corpus:seon", 1]]);
    assert.equal(s.predicates[0].predicate, "mgx:hasProperty", "the only repeated predicate (logger's two answers) ranks first");
    assert.equal(s.predicates[0].count, 2);
    assert.equal(s.predicates.length, 6, "all six distinct predicates fit under the top-N cap");
    assert.ok(Math.abs(s.density - 14 / 11) < 1e-9, "avg degree = 2*facts / terms, since every row bumps both its subject and object");
    assert.equal(s.contradictionCount, 1);
    assert.equal(s.firstLearned, T_OLD);
    assert.equal(s.lastLearned, T_NEW);
    assert.deepEqual(s.sparkline, [1, 2, 3, 4, 5, 6, 7], "small graphs sample at full resolution — one point per fact");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeLedgerStats: stats stay over the FULL graph even when the ledger view itself is row-capped", async () => {
  const dir = await seededRepo();
  try {
    const payload = await loadMemory(dir);
    const capped = computeLedgerDataFromPayload(payload, { term: "dog", rowLimit: 2 });
    assert.equal(capped.rows.length, 2, "the embedded ledger rows are capped");
    assert.equal(capped.stats.totalFacts, 7, "but the dashboard totals still count the whole graph");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computeLedgerStats: an empty graph reports zeroed stats and an empty sparkline, never a throw", () => {
  const s = computeLedgerStats([], [], []);
  assert.equal(s.totalFacts, 0);
  assert.equal(s.totalTerms, 0);
  assert.deepEqual(s.byProv, { taught: 0, corpus: 0, entailed: 0 });
  assert.deepEqual(s.bundles, []);
  assert.deepEqual(s.predicates, []);
  assert.equal(s.density, 0);
  assert.equal(s.contradictionCount, 0);
  assert.equal(s.firstLearned, null);
  assert.deepEqual(s.sparkline, []);
});

test("renderLedgerHtml: the dashboard strip renders real, non-placeholder numbers over the seeded fixture", async () => {
  const dir = await seededRepo();
  try {
    const data = await computeLedgerData(dir);
    const html = renderLedgerHtml({ ...data, memoryAskBundle: "" });
    assert.match(html, /<section class="dash"/);
    assert.match(html, /facts\.total[\s\S]*?<span class="tile-value">7<\/span>/, "the real total-facts count renders, not a placeholder");
    assert.match(html, /11 terms tracked/);
    assert.match(html, /3 taught/);
    assert.match(html, /4 corpus/);
    assert.match(html, /0 entailed/);
    assert.match(html, /corpus\.bundles/);
    assert.match(html, /corpus: human/);
    assert.match(html, /taught via chat/);
    assert.match(html, /predicate\.top/);
    assert.match(html, /data\.quality/);
    assert.match(html, /<span class="tile-value">1<\/span>\s*<span class="tile-sub">term with more than one answer/);
    assert.match(html, /class="tile tile-alert"/, "a real contradiction count marks the quality tile");
    assert.match(html, /<svg class="spark"/, "the ingestion sparkline renders as inline SVG");
    assert.match(html, /class="line" d="M/, "the sparkline path is a real polyline, not an empty placeholder");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderLedgerHtml: an empty graph's dashboard says so honestly instead of showing a fabricated zero-tile grid", async () => {
  const html = renderLedgerHtml({ rows: [], terms: [], edges: [], focus: null, contradictions: [], worthALook: null, payload: null, meta: { shown: 0, total: 0, truncated: false }, stats: computeLedgerStats([], [], []), memoryAskBundle: "" });
  // Scoped to the rendered <main> markup, before the first <script> tag: the
  // live dock's inline script toString-embeds sparklineSvg's own SOURCE (so a
  // post-teach re-render can call it client-side too — see renderLedgerHtml's
  // inline script), and that source text itself contains the literal string
  // `<svg class="spark"` regardless of what it would render for THIS data —
  // a whole-page substring check would false-positive on the source, not the
  // actual output.
  const bodyOnly = html.slice(0, html.indexOf("<script>"));
  assert.match(bodyOnly, /nothing taught yet/);
  assert.match(bodyOnly, /not enough dated facts yet/);
  assert.doesNotMatch(bodyOnly, /<svg class="spark"/);
});
