// The OPT-IN live Wikipedia lane behind the same clean-miss discipline as the
// shipped packs, with one deliberate difference: no lexicon-membership wall,
// because a word the lexicon has never met is exactly what a live lookup is
// for. Default OFF is the load-bearing half — with the toggle off the
// provider is never consulted at all — and a live failure of any kind leaves
// the honest miss byte-identical to a live-off run. A hit answers cited under
// wikipedia-live provenance, records no miss, and stores the triples the
// article grounds — its isa and every candidate the optimistic tier reads from
// the summary — which trust.mjs parses back to the referenceLive kind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";
import { registerLiveReferenceProvider } from "../../src/adapters/corpus/wikipedia-live.mjs";
import { registerReferencePackProvider } from "../../src/adapters/corpus/reference-pack.mjs";

const FIXTURE_PACK = fileURLToPath(new URL("../fixtures/reference-pack", import.meta.url));

// Both shipped packs pinned absent by default: these tests exercise the LIVE
// hook in isolation. The pack-first test below points at the fixture pack
// explicitly instead.
const noPackEnv = { TMCT_REFERENCE_PACK_DIR: "/nonexistent-reference-pack", TMCT_CHILD_PACK_DIR: "/nonexistent-child-pack" };
const fixturePackEnv = { TMCT_REFERENCE_PACK_DIR: FIXTURE_PACK, TMCT_CHILD_PACK_DIR: "/nonexistent-child-pack" };

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-live-lane-"));
}

async function turn(line, { memoryDir, env = noPackEnv, last = null, liveReference = false, onLiveLookup = null } = {}) {
  return runTurn(line, { config: null, memoryDir, env, last, liveReference, onLiveLookup });
}

const QUASAR_ROW = {
  term: "quasar",
  title: "Quasar",
  text: "A quasar is a very bright object in space. It is powered by a black hole.",
  summary: "A quasar is a very bright object in space.",
  url: "https://en.wikipedia.org/wiki/Quasar",
  revid: 1234567,
  isa: "star",
};

/** A provider that counts every lookup and answers the quasar row. */
function hitProvider() {
  const p = { calls: [], lookup: async (key) => { p.calls.push(key); return key === "quasar" ? QUASAR_ROW : null; } };
  return p;
}

/** A provider that counts every lookup and never answers. */
function nullProvider() {
  const p = { calls: [], lookup: async (key) => { p.calls.push(key); return null; } };
  return p;
}

test("with the toggle OFF (the default), a clean miss never consults the live provider", async () => {
  const dir = await freshRepo();
  const spy = nullProvider();
  registerLiveReferenceProvider(spy);
  try {
    const r = await turn("what is a quasar", { memoryDir: dir });
    assert.equal(spy.calls.length, 0, "default off means zero live lookups");
    assert.equal(r.record.miss, true);
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("toggle ON: a lexicon-unknown clean miss answers from the live article, cited, records no miss, and stores the isa under wikipedia-live provenance", async () => {
  const dir = await freshRepo();
  const provider = hitProvider();
  registerLiveReferenceProvider(provider);
  const notified = [];
  try {
    const r = await turn("what is a quasar", { memoryDir: dir, liveReference: true, onLiveLookup: (key) => notified.push(key) });
    assert.match(r.answer, /^quasar — A quasar is a very bright object in space\./);
    assert.match(r.answer, /\(source: live Wikipedia article "Quasar", English Wikipedia, CC BY-SA 4\.0 — https:\/\/en\.wikipedia\.org\/wiki\/Quasar\?oldid=1234567\)/);
    assert.equal(r.record.via, "reference");
    assert.equal(r.record.miss, false);
    assert.deepEqual(provider.calls, ["quasar"]);
    assert.deepEqual(notified, ["quasar"], "the notify hook fired before the lookup");

    const rows = readFactRows(await loadMemory(dir));
    const stored = rows.find((f) => f.subject === "quasar" && f.predicate === "rdfs:subClassOf" && f.object === "star");
    assert.ok(stored, "the article's isa lands as a subClassOf fact");
    assert.match(stored.provenance, /^reference:wikipedia-live:Quasar@1234567/);
    const src = provenanceTagToSource("reference:wikipedia-live:Quasar@1234567");
    assert.equal(src.kind, "referenceLive", "the live pack scores below the curated pack");
    assert.equal(src.pack, "wikipedia-live");
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a null-answering live provider leaves the miss byte-identical to a toggle-off run", async () => {
  const dirOff = await freshRepo();
  const dirOn = await freshRepo();
  const spy = nullProvider();
  registerLiveReferenceProvider(spy);
  try {
    const off = await turn("what is a quasar", { memoryDir: dirOff });
    const on = await turn("what is a quasar", { memoryDir: dirOn, liveReference: true });
    assert.equal(on.answer, off.answer, "the answer is byte-identical");
    assert.equal(on.record.miss, true);
    assert.ok(spy.calls.length >= 1, "the provider WAS consulted on the live run");
    assert.deepEqual(readFactRows(await loadMemory(dirOn)), [], "no fact is appended on the miss path");
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dirOff, { recursive: true, force: true });
    await rm(dirOn, { recursive: true, force: true });
  }
});

test("a THROWING live provider leaves the miss byte-identical to a toggle-off run", async () => {
  const dirOff = await freshRepo();
  const dirOn = await freshRepo();
  registerLiveReferenceProvider({ lookup: async () => { throw new Error("network down"); } });
  try {
    const off = await turn("what is a quasar", { memoryDir: dirOff });
    const on = await turn("what is a quasar", { memoryDir: dirOn, liveReference: true });
    assert.equal(on.answer, off.answer, "the honest wall stands, byte-identical");
    assert.equal(on.record.miss, true);
    assert.deepEqual(readFactRows(await loadMemory(dirOn)), [], "no fact is appended when the lookup throws");
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dirOff, { recursive: true, force: true });
    await rm(dirOn, { recursive: true, force: true });
  }
});

test("the shipped reference pack answers first: a pack term with live ON never reaches the live provider", async () => {
  const dir = await freshRepo();
  const spy = nullProvider();
  registerLiveReferenceProvider(spy);
  try {
    const r = await turn("what is an otter", { memoryDir: dir, env: fixturePackEnv, liveReference: true });
    assert.equal(r.record.via, "reference");
    assert.match(r.answer, /\(source: reference article "Otter", Simple English Wikipedia/);
    assert.equal(spy.calls.length, 0, "the shipped pack satisfied the miss before the live hook ran");
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("the bare form 'what is quasar' reaches the live provider under the same gate", async () => {
  const dir = await freshRepo();
  const provider = hitProvider();
  registerLiveReferenceProvider(provider);
  try {
    const r = await turn("what is quasar", { memoryDir: dir, liveReference: true });
    assert.match(r.answer, /\(source: live Wikipedia article "Quasar"/);
    assert.equal(r.record.via, "reference");
    assert.equal(r.record.miss, false);
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a remembered fact about the term blocks the live gate entirely", async () => {
  const dir = await freshRepo();
  const spy = hitProvider();
  try {
    await turn("every quasar is a star", { memoryDir: dir });
    registerLiveReferenceProvider(spy);
    const r = await turn("what is a quasar", { memoryDir: dir, liveReference: true });
    assert.equal(spy.calls.length, 0, "memory answered; the live lookup never ran");
    assert.match(r.answer, /quasar is a kind of star/);
    assert.doesNotMatch(r.answer, /live Wikipedia article/);
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a live hit stores every triple the summary grounds, not just the first-sentence isa", async () => {
  const dir = await freshRepo();
  registerLiveReferenceProvider(hitProvider());
  try {
    await turn("what is a quasar", { memoryDir: dir, liveReference: true });
    const rows = readFactRows(await loadMemory(dir));
    const isa = rows.find((f) => f.subject === "quasar" && f.object === "star");
    const fromSummary = rows.find((f) => f.subject === "quasar" && f.object === "object");
    assert.ok(isa, "the first-sentence isa lands");
    assert.ok(fromSummary, "the optimistic tier grounds a second triple from the summary");
    assert.ok(rows.every((f) => /^reference:wikipedia-live:Quasar@1234567/.test(f.provenance)), "every triple carries the article's own source tag");
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("an explicit 'what does wikipedia say about X' reaches the live lookup even when memory already answers", async () => {
  const dir = await freshRepo();
  const spy = hitProvider();
  try {
    await turn("every quasar is a star", { memoryDir: dir });
    registerLiveReferenceProvider(spy);
    const r = await turn("what does wikipedia say about quasar", { memoryDir: dir, liveReference: true });
    assert.deepEqual(spy.calls, ["quasar"], "the explicit ask consults Wikipedia despite the remembered fact");
    assert.match(r.answer, /live Wikipedia article "Quasar"/);
    assert.equal(r.record.via, "reference");
    assert.equal(r.record.miss, false);
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("an explicit Wikipedia ask with the toggle off points at /wiki on and never touches the network", async () => {
  const dir = await freshRepo();
  const spy = nullProvider();
  registerLiveReferenceProvider(spy);
  try {
    const r = await turn("what does wikipedia say about quasar", { memoryDir: dir });
    assert.equal(spy.calls.length, 0, "the network opt-in still gates the request");
    assert.match(r.answer, /\/wiki on/);
    assert.equal(r.record.miss, true);
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("/wiki flips ride the turn result: on, off, and a bare status report that changes nothing", async () => {
  const dir = await freshRepo();
  try {
    const on = await turn("/wiki on", { memoryDir: dir });
    assert.equal(on.liveReference, true);
    assert.match(on.answer, /live Wikipedia supplement on\./);

    const off = await turn("/wiki off", { memoryDir: dir });
    assert.equal(off.liveReference, false);
    assert.match(off.answer, /live Wikipedia supplement off\./);

    const status = await turn("/wiki", { memoryDir: dir, liveReference: true });
    assert.equal(status.liveReference, undefined, "a bare /wiki never flips the state");
    assert.match(status.answer, /live Wikipedia supplement is on — \/wiki on, \/wiki off, or \/wiki supplement/);
    assert.match(status.answer, /en\.wikipedia\.org \(network\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/wiki supplement is the third state and rides the turn result", async () => {
  const dir = await freshRepo();
  try {
    const sup = await turn("/wiki supplement", { memoryDir: dir });
    assert.equal(sup.liveReference, "supplement");
    assert.match(sup.answer, /live Wikipedia supplement supplement\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("supplement mode appends a cited Wikipedia read-out under a grounded vocabulary answer", async () => {
  const dir = await freshRepo();
  registerLiveReferenceProvider(hitProvider());
  try {
    // a remembered fact answers locally; supplement mode still corroborates from Wikipedia
    await turn("every quasar is a star", { memoryDir: dir });
    const r = await turn("what is a quasar", { memoryDir: dir, liveReference: "supplement" });
    assert.match(r.answer, /quasar is a kind of star/, "the local answer still leads");
    assert.match(r.answer, /Wikipedia adds: quasar — A quasar is a very bright object/, "the cited supplement follows");
    assert.equal(r.record.miss, false);
  } finally {
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("/help lists the /wiki toggle with all three states", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("/help", { memoryDir: dir });
    assert.match(r.answer, /\/wiki on\|off\|supplement/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
