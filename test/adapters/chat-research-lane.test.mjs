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
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
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

const queueFile = (dir) => join(dir, ".tmct", "research-queue.json");

test("a queue persists under .tmct and resumes in a later session with no in-memory state", async () => {
  const dir = await freshRepo();
  registerResearchProvider(owlProvider());
  try {
    // Session one starts the run, then drops every scrap of in-memory state.
    const start = await turn("research owl, limit 2", { memoryDir: dir });
    assert.deepEqual(start.researchState.pending, ["Bird", "Night"]);
    const raw = JSON.parse(await readFile(queueFile(dir), "utf8"));
    assert.deepEqual(raw.pending, ["Bird", "Night"], "the queue is written through to .tmct");

    // Session two carries no researchState — the queue resumes off disk.
    const step1 = await turn("research next", { memoryDir: dir });
    assert.match(step1.answer, /^bird — A bird is an animal\./);
    assert.match(step1.answer, /1 linked topic still queued/);
    assert.deepEqual(JSON.parse(await readFile(queueFile(dir), "utf8")).pending, ["Night"], "the step is persisted");

    // Session three, still stateless, reports status from the persisted queue.
    const status = await turn("research status", { memoryDir: dir });
    assert.match(status.answer, /1 linked topic still queued/);
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

function twoLevelProvider() {
  const articles = {
    owl: ROW("Owl", "An owl is a bird."),
    bird: ROW("Bird", "A bird is an animal."),
    feather: ROW("Feather", "A feather is a covering."),
    wing: ROW("Wing", "A wing is a limb."),
  };
  const links = { Owl: ["Bird"], Bird: ["Feather", "Wing"] };
  const p = {
    calls: [],
    async lookup(key) { p.calls.push(["lookup", key]); return articles[key] ?? null; },
    async pageByTitle(title) { p.calls.push(["pageByTitle", title]); return articles[String(title).toLowerCase()] ?? null; },
    async linkedTitles(title) { p.calls.push(["linkedTitles", title]); return links[title] ?? null; },
  };
  return p;
}

test("a depth-2 request persists both node knobs, and a later stateless session resumes them so its own step still fans out at depth 2", async () => {
  const dir = await freshRepo();
  registerResearchProvider(twoLevelProvider());
  try {
    // Session one: a depth-2 run. Owl queues Bird at depth 1.
    const start = await turn("research owl, limit 5 depth 2", { memoryDir: dir });
    assert.equal(start.research.maxDepth, 2, "the run carries the requested depth");
    assert.deepEqual(start.researchState.pending, ["Bird"]);
    const raw = JSON.parse(await readFile(queueFile(dir), "utf8"));
    assert.equal(raw.maxDepth, 2, "the persisted queue carries the depth knob");
    assert.ok(Number.isFinite(raw.maxTopics), "the persisted queue carries the node budget");

    // Session two: no in-memory state. The resumed run must keep depth 2, so
    // stepping Bird fans out its own links (Feather, Wing) at depth 2.
    const step1 = await turn("research next", { memoryDir: dir });
    assert.match(step1.answer, /^bird — A bird is an animal\./);
    assert.deepEqual(step1.research.pending, ["Feather", "Wing"], "the resumed depth-2 run fans out from the stepped topic");

    // The depth-2 topic grounds under research:owl@2.
    const step2 = await turn("research next", { memoryDir: dir });
    assert.match(step2.answer, /^feather —/);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((f) => /^research:owl@2/.test(f.provenance)), "a resumed depth-2 topic stamps @2");
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("an older persisted queue with no depth knobs resumes as today's depth-1 behaviour, never a crash", async () => {
  const dir = await freshRepo();
  registerResearchProvider(twoLevelProvider());
  try {
    // A queue file shaped like the pre-knob release: core fields only.
    await mkdir(join(dir, ".tmct"), { recursive: true });
    const legacy = { topic: "owl", key: "owl", title: "Owl", limit: 5, pending: ["Bird"], done: [{ title: "Owl", facts: 1, depth: 0 }], skipped: [] };
    await writeFile(queueFile(dir), JSON.stringify(legacy), "utf8");
    const step = await turn("research next", { memoryDir: dir });
    assert.match(step.answer, /^bird — A bird is an animal\./);
    // Depth defaults to 1, so Bird does NOT fan out — the run completes.
    assert.deepEqual(step.research.pending, [], "a knob-less resume behaves as a depth-1 run");
    assert.match(step.answer, /research on "owl" is complete/);
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("research stop in a later session clears the persisted queue file", async () => {
  const dir = await freshRepo();
  registerResearchProvider(owlProvider());
  try {
    await turn("research owl, limit 2", { memoryDir: dir });
    const stop = await turn("research stop", { memoryDir: dir });
    assert.match(stop.answer, /stopped research on "owl"/);
    assert.equal(stop.researchState, null);
    const gone = await readFile(queueFile(dir), "utf8").then(() => "PRESENT", () => "GONE");
    assert.equal(gone, "GONE", "stop deletes the persisted queue file");
    const after = await turn("research status", { memoryDir: dir });
    assert.match(after.answer, /no research is running/);
  } finally {
    registerResearchProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a corrupt queue file reads as no research running, never a crash", async () => {
  const dir = await freshRepo();
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(queueFile(dir), "{ this is not json", "utf8");
  try {
    const status = await turn("research status", { memoryDir: dir });
    assert.match(status.answer, /no research is running/);
    const next = await turn("research next", { memoryDir: dir });
    assert.match(next.answer, /no research is running/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a session with no memory store neither reads nor writes a persisted queue", async () => {
  const status = await turn("research status", { memoryDir: null });
  assert.match(status.answer, /no research is running/);
  const next = await turn("research next", { memoryDir: null });
  assert.match(next.answer, /needs a memory store/);
});

test("/help lists the research lane", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("/help", { memoryDir: dir });
    assert.match(r.answer, /research <topic> \[limit N\] \[depth D\]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
