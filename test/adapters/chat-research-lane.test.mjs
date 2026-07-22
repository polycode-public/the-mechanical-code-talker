// The "research <topic>" chat lane end to end through runTurn: an explicit
// research request reaches simple.wikipedia.org's provider even with the
// /wiki toggle off (the request itself is the consent for its own fetches),
// grounds the depth-0 article as facts under research:<topic>@0, queues the
// linked topics, and "research next" steps the queue one cited turn at a
// time under research:<topic>@1 — with queue state riding the turn result as
// researchState the way planState does. A failed fetch keeps the abstention
// posture: a plain miss, nothing stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { registerResearchProvider, registerLiveReferenceProvider } from "../../src/adapters/corpus/wikipedia-live.mjs";

const noPackEnv = { TMCT_REFERENCE_PACK_DIR: "/nonexistent-reference-pack", TMCT_CHILD_PACK_DIR: "/nonexistent-child-pack" };

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-research-lane-"));
}

async function turn(line, { memoryDir, researchState = null, liveReference = false } = {}) {
  return runTurn(line, { config: null, memoryDir, env: noPackEnv, liveReference, researchState });
}

const ROW = (title, summary) => ({
  term: title.toLowerCase(),
  title,
  text: summary,
  summary,
  url: `https://simple.wikipedia.org/wiki/${title.replace(/ /g, "_")}`,
  revid: 77,
});

function owlProvider() {
  const articles = {
    owl: ROW("Owl", "An owl is a bird. Owls hunt at night."),
    bird: ROW("Bird", "A bird is an animal."),
    night: ROW("Night", "Night is the dark part of the day."),
  };
  const p = {
    calls: [],
    async lookup(key) { p.calls.push(["lookup", key]); return articles[key] ?? null; },
    async pageByTitle(title) { p.calls.push(["pageByTitle", title]); return articles[String(title).toLowerCase()] ?? null; },
    async linkedTitles(title) { p.calls.push(["linkedTitles", title]); return title === "Owl" ? ["Bird", "Night", "Feather"] : []; },
  };
  return p;
}

test("research with /wiki off still fetches (the explicit request is the consent), answers cited, stores facts, and queues the fan-out", async () => {
  const dir = await freshRepo();
  const provider = owlProvider();
  registerResearchProvider(provider);
  registerLiveReferenceProvider({ lookup: async () => { throw new Error("the /wiki provider must not be consulted"); } });
  try {
    const r = await turn("research owl, limit 2", { memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.equal(r.record.via, "research");
    assert.match(r.answer, /^owl — An owl is a bird\./);
    assert.match(r.answer, /\(source: research article "Owl", Simple English Wikipedia, CC BY-SA 4\.0/);
    assert.match(r.answer, /queued 2 linked topics: Bird, Night/);
    assert.ok(provider.calls.some(([m]) => m === "lookup"), "the research provider was consulted despite /wiki off");

    const rows = readFactRows(await loadMemory(dir));
    const isa = rows.find((f) => f.subject === "owl" && f.predicate === "rdfs:subClassOf" && f.object === "bird");
    assert.ok(isa, "the depth-0 article's isa lands as a fact");
    assert.match(isa.provenance, /^research:owl@0/);

    assert.ok(r.researchState, "queue state rides the turn result");
    assert.deepEqual(r.researchState.pending, ["Bird", "Night"]);
    assert.deepEqual(r.record.research.pending, ["Bird", "Night"], "the turn record carries the queue as data for a UI");
    assert.equal(r.research.complete, false);
  } finally {
    registerResearchProvider(null);
    registerLiveReferenceProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("research next steps the queue: one cited depth-1 turn per step, threading researchState, completing on the last topic", async () => {
  const dir = await freshRepo();
  registerResearchProvider(owlProvider());
  try {
    const start = await turn("research owl, limit 2", { memoryDir: dir });
    const step1 = await turn("research next", { memoryDir: dir, researchState: start.researchState });
    assert.equal(step1.record.miss, false);
    assert.match(step1.answer, /^bird — A bird is an animal\./);
    assert.match(step1.answer, /1 linked topic still queued/);
    const step2 = await turn("research next", { memoryDir: dir, researchState: step1.researchState });
    assert.match(step2.answer, /research on "owl" is complete/);
    assert.equal(step2.research.complete, true);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((f) => /^research:owl@1/.test(f.provenance) && f.subject === "bird"), "depth-1 facts stamp the run's topic at depth 1");
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a research turn's stored facts answer the ordinary question that follows, from the store", async () => {
  const dir = await freshRepo();
  registerResearchProvider(owlProvider());
  try {
    const start = await turn("research owl, limit 0", { memoryDir: dir });
    assert.match(start.answer, /no linked topics queued/);
    const asked = await turn("what is an owl", { memoryDir: dir });
    assert.equal(asked.record.miss, false);
    assert.match(asked.answer, /owl is a kind of bird/);
    assert.match(asked.answer, /research:owl@0/, "the read-back cites the research provenance");
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a failed research fetch reports the miss plainly and stores nothing", async () => {
  const dir = await freshRepo();
  registerResearchProvider({ lookup: async () => null });
  try {
    const r = await turn("research owl", { memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /couldn't ground "owl" from Simple English Wikipedia .* Nothing was stored\./);
    assert.equal(r.researchState, null);
    assert.deepEqual(readFactRows(await loadMemory(dir)), []);
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("research status and research stop manage the queue through the lane", async () => {
  const dir = await freshRepo();
  registerResearchProvider(owlProvider());
  try {
    const start = await turn("research owl, limit 2", { memoryDir: dir });
    const status = await turn("research status", { memoryDir: dir, researchState: start.researchState });
    assert.match(status.answer, /2 linked topics still queued/);
    const stop = await turn("research stop", { memoryDir: dir, researchState: start.researchState });
    assert.match(stop.answer, /stopped research on "owl"/);
    assert.equal(stop.researchState, null);
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("an ordinary question is untouched by the lane: no research field rides the result", async () => {
  const dir = await freshRepo();
  const provider = owlProvider();
  registerResearchProvider(provider);
  try {
    const r = await turn("what is an owl", { memoryDir: dir });
    assert.equal(r.research, undefined);
    assert.equal(provider.calls.length, 0, "no research fetch on a non-research line");
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("/help lists the research lane", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("/help", { memoryDir: dir });
    assert.match(r.answer, /research <topic> \[limit N\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
