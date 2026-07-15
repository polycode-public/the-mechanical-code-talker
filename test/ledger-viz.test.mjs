// ledger-viz.test.mjs — unit coverage of computeLedgerData/renderLedgerHtml
// (PLAN_VIZ_LEDGER.md phase 1), mirroring test/viz.test.mjs's split: this file
// owns the data derivation + rendered-page contracts; the CLI flag surface
// lives in test/ledger-viz-cli.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, loadMemory, readFactRows, findContradictions } from "../src/memory/core.mjs";
import {
  computeLedgerData, computeLedgerDataFromPayload, renderLedgerHtml,
  provBucketFor, phraseFor, familyFor,
} from "../src/ledger-viz.mjs";

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
