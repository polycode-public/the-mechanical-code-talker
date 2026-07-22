// The research queue engine: the request grammar ("research owls",
// "research owls, limit 3", next/status/stop, the gated bare "next"), the
// depth-0 fetch + depth-1 fan-out mechanics over an injected provider, the
// research:<topic>@<depth> provenance stamps handed to the injected ingest,
// the config clamps (fan-out cap, depth 0..1, the interval floor that can
// only rise), and the abstention posture — a failed fetch reports plainly,
// stores nothing, and the queue moves on.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RESEARCH_DEFAULTS,
  RESEARCH_FANOUT_MAX,
  resolveResearchConfig,
  parseResearchRequest,
  researchProvenanceTag,
  renderResearchAnswer,
  researchSnapshot,
  researchTurn,
} from "../../src/services/research.mjs";

const ROW = (title, summary = `${title} is a thing.`) => ({
  term: title.toLowerCase(),
  title,
  text: summary,
  summary,
  url: `https://simple.wikipedia.org/wiki/${title.replace(/ /g, "_")}`,
  revid: 42,
});

/** A canned provider: lookup answers `articles[key]`, pageByTitle answers
 *  `articles` by folded title, linkedTitles answers `links[title]`. Every
 *  call is recorded. */
function cannedProvider({ articles = {}, links = {} } = {}) {
  const byFold = new Map(Object.values(articles).map((row) => [row.title.toLowerCase(), row]));
  const p = {
    calls: [],
    async lookup(key) { p.calls.push(["lookup", key]); return articles[key] ?? null; },
    async pageByTitle(title) { p.calls.push(["pageByTitle", title]); return byFold.get(String(title).toLowerCase()) ?? null; },
    async linkedTitles(title, { limit }) { p.calls.push(["linkedTitles", title, limit]); return links[title] ?? null; },
  };
  return p;
}

/** An ingest recorder that "stores" a fixed count per article. */
function ingestRecorder(count = 2) {
  const fn = async (key, article, tag) => { fn.calls.push({ key, title: article.title, tag }); return count; };
  fn.calls = [];
  return fn;
}

const ctxFor = (provider, ingest, { state = null, planActive = false, config = resolveResearchConfig() } = {}) => ({
  holder: { state },
  provider,
  ingest,
  config,
  memoryDir: "mem",
  planActive,
});

// ---- the request grammar ---------------------------------------------------

test("parseResearchRequest reads the start shape, with and without a limit, article and quotes stripped", () => {
  assert.deepEqual(parseResearchRequest("research owls"), { kind: "start", topic: "owls" });
  assert.deepEqual(parseResearchRequest("research owls, limit 3"), { kind: "start", topic: "owls", limit: 3 });
  assert.deepEqual(parseResearchRequest("research owls limit 3"), { kind: "start", topic: "owls", limit: 3 });
  assert.deepEqual(parseResearchRequest("research the golden gate bridge."), { kind: "start", topic: "golden gate bridge" });
  assert.deepEqual(parseResearchRequest('research "polar bears" with limit 2'), { kind: "start", topic: "polar bears", limit: 2 });
});

test("parseResearchRequest reads the queue verbs before the start shape ever sees them", () => {
  assert.deepEqual(parseResearchRequest("research next"), { kind: "next" });
  assert.deepEqual(parseResearchRequest("research continue"), { kind: "next" });
  assert.deepEqual(parseResearchRequest("research status"), { kind: "status" });
  assert.deepEqual(parseResearchRequest("research stop"), { kind: "stop" });
  assert.deepEqual(parseResearchRequest("next"), { kind: "bareNext" });
  assert.deepEqual(parseResearchRequest("continue"), { kind: "bareNext" });
});

test("parseResearchRequest declines a non-research line", () => {
  assert.equal(parseResearchRequest("what is an owl"), null);
  assert.equal(parseResearchRequest("researching my options"), null);
  assert.equal(parseResearchRequest(""), null);
});

// ---- config ----------------------------------------------------------------

test("resolveResearchConfig ships defaults, clamps the fan-out, caps depth at 1, and only ever raises the interval", () => {
  assert.deepEqual(resolveResearchConfig(null), { ...RESEARCH_DEFAULTS });
  const cfg = resolveResearchConfig({ research: { fanout_limit: 99, depth_limit: 7, min_interval_ms: 250 } });
  assert.equal(cfg.fanoutLimit, RESEARCH_FANOUT_MAX, "the fan-out cap holds against a large config value");
  assert.equal(cfg.depthLimit, 1, "depth clamps to the engineered range");
  assert.equal(cfg.minIntervalMs, RESEARCH_DEFAULTS.minIntervalMs, "the polite interval never drops below the floor");
  assert.equal(resolveResearchConfig({ research: { min_interval_ms: 5000 } }).minIntervalMs, 5000, "raising it is allowed");
  assert.equal(resolveResearchConfig({ research: { fanout_limit: 0 } }).fanoutLimit, 0, "zero fan-out is a legal choice");
});

// ---- the run mechanics -----------------------------------------------------

test("a start fetches depth 0, ingests under research:<topic>@0, and queues the linked topics up to the request's limit", async () => {
  const provider = cannedProvider({
    articles: { owl: ROW("Owl", "An owl is a bird. Owls hunt at night.") },
    links: { Owl: ["Bird", "Night", "Feather", "Mouse"] },
  });
  const ingest = ingestRecorder(3);
  const ctx = ctxFor(provider, ingest);
  const r = await researchTurn("research owl, limit 2", ctx);
  assert.ok(r, "the lane claims the line");
  assert.equal(r.miss, false);
  assert.match(r.text, /^owl — An owl is a bird\./);
  assert.match(r.text, /\(source: research article "Owl", Simple English Wikipedia, CC BY-SA 4\.0 — https:\/\/simple\.wikipedia\.org\/wiki\/Owl\?oldid=42\)/);
  assert.match(r.text, /stored 3 facts from "Owl"/);
  assert.match(r.text, /queued 2 linked topics: Bird, Night/);
  assert.deepEqual(ingest.calls, [{ key: "owl", title: "Owl", tag: "research:owl@0" }]);
  const snap = researchSnapshot(ctx.holder.state);
  assert.deepEqual(snap.pending, ["Bird", "Night"]);
  assert.deepEqual(snap.done, [{ title: "Owl", facts: 3, depth: 0 }]);
  assert.equal(snap.complete, false);
});

test("each next step fetches ONE queued title by exact page, ingests it at depth 1, and reports progress; the last step reports completion", async () => {
  const provider = cannedProvider({
    articles: { owl: ROW("Owl"), bird: ROW("Bird", "A bird is an animal."), night: ROW("Night", "Night is the dark part of the day.") },
    links: { Owl: ["Bird", "Night"] },
  });
  const ingest = ingestRecorder(1);
  const ctx = ctxFor(provider, ingest);
  await researchTurn("research owl", ctx);
  const step1 = await researchTurn("research next", ctx);
  assert.equal(step1.miss, false);
  assert.match(step1.text, /^bird — A bird is an animal\./);
  assert.match(step1.text, /2 topics grounded, 2 facts stored; 1 linked topic still queued/);
  assert.equal(ingest.calls[1].tag, "research:owl@1", "depth-1 facts stamp the run's topic at depth 1");
  assert.ok(provider.calls.some(([m, arg]) => m === "pageByTitle" && arg === "Bird"), "an exact linked title skips the opensearch");
  const step2 = await researchTurn("research next", ctx);
  assert.match(step2.text, /research on "owl" is complete — 3 topics grounded, 3 facts stored\./);
  assert.equal(researchSnapshot(ctx.holder.state).complete, true);
});

test("a bare \"next\" steps a pending queue, but never while a plan is active and never with no run standing", async () => {
  const provider = cannedProvider({
    articles: { owl: ROW("Owl"), bird: ROW("Bird") },
    links: { Owl: ["Bird"] },
  });
  const ctxIdle = ctxFor(provider, ingestRecorder());
  assert.equal(await researchTurn("next", ctxIdle), null, "no run standing — the word stays with paging/plans");
  const ctx = ctxFor(provider, ingestRecorder());
  await researchTurn("research owl", ctx);
  ctx.planActive = true;
  assert.equal(await researchTurn("next", ctx), null, "an active plan owns the bare word");
  ctx.planActive = false;
  const stepped = await researchTurn("next", ctx);
  assert.match(stepped.text, /^bird —/);
});

test("a failed depth-0 fetch reports the miss plainly, stores nothing, and leaves no run standing", async () => {
  const provider = cannedProvider({});
  const ingest = ingestRecorder();
  const ctx = ctxFor(provider, ingest);
  const r = await researchTurn("research owl", ctx);
  assert.equal(r.miss, true);
  assert.match(r.text, /couldn't ground "owl" from Simple English Wikipedia .* Nothing was stored\./);
  assert.equal(ingest.calls.length, 0);
  assert.equal(ctx.holder.state, null);
});

test("a failed depth-1 fetch skips that topic plainly and the queue moves on", async () => {
  const provider = cannedProvider({
    articles: { owl: ROW("Owl"), night: ROW("Night") },
    links: { Owl: ["Bird", "Night"] },
  });
  const ingest = ingestRecorder(1);
  const ctx = ctxFor(provider, ingest);
  await researchTurn("research owl", ctx);
  const skipped = await researchTurn("research next", ctx);
  assert.equal(skipped.miss, true, "the failed topic is an honest miss turn");
  assert.match(skipped.text, /couldn't fetch "Bird" .* skipped, nothing stored/);
  assert.equal(ingest.calls.length, 1, "no fact landed for the failed topic");
  const recovered = await researchTurn("research next", ctx);
  assert.match(recovered.text, /^night —/, "the next queued topic still grounds");
  assert.match(recovered.text, /1 skipped/);
});

test("a throwing ingest degrades to zero stored facts, never a crash", async () => {
  const provider = cannedProvider({ articles: { owl: ROW("Owl") }, links: {} });
  const ctx = ctxFor(provider, async () => { throw new Error("disk gone"); });
  const r = await researchTurn("research owl", ctx);
  assert.equal(r.miss, false, "the cited answer still stands");
  assert.match(r.text, /stored 0 facts/);
});

test("status and stop read and end the run; both decline plainly with none standing", async () => {
  const provider = cannedProvider({ articles: { owl: ROW("Owl") }, links: { Owl: ["Bird", "Night"] } });
  const ctx = ctxFor(provider, ingestRecorder(2));
  assert.match((await researchTurn("research status", ctx)).text, /no research is running/);
  await researchTurn("research owl", ctx);
  assert.match((await researchTurn("research status", ctx)).text, /1 topic grounded, 2 facts stored; 2 linked topics still queued/);
  const stopped = await researchTurn("research stop", ctx);
  assert.match(stopped.text, /stopped research on "owl" — 1 topic grounded, 2 facts stored, 2 queued topics dropped\./);
  assert.equal(ctx.holder.state, null);
  assert.match((await researchTurn("research stop", ctx)).text, /no research is running/);
});

test("config depth_limit 0 and fanout 0 both mean no fan-out: the run completes at depth 0 without a links request", async () => {
  for (const config of [resolveResearchConfig({ research: { depth_limit: 0 } }), resolveResearchConfig({ research: { fanout_limit: 0 } })]) {
    const provider = cannedProvider({ articles: { owl: ROW("Owl") }, links: { Owl: ["Bird"] } });
    const ctx = ctxFor(provider, ingestRecorder(), { config });
    const r = await researchTurn("research owl", ctx);
    assert.match(r.text, /no linked topics queued — research on "owl" is complete\./);
    assert.ok(!provider.calls.some(([m]) => m === "linkedTitles"), "no links round trip is spent when nothing may queue");
  }
});

test("the fan-out never queues the topic itself or a duplicate fold of it", async () => {
  const provider = cannedProvider({
    articles: { owl: ROW("Owl") },
    links: { Owl: ["Owl", "owl", "Bird"] },
  });
  const ctx = ctxFor(provider, ingestRecorder());
  await researchTurn("research owl, limit 3", ctx);
  assert.deepEqual(researchSnapshot(ctx.holder.state).pending, ["Bird"]);
});

test("with no memory store the lane declines plainly instead of pretending to store", async () => {
  const provider = cannedProvider({ articles: { owl: ROW("Owl") } });
  const ctx = { ...ctxFor(provider, ingestRecorder()), memoryDir: null };
  const r = await researchTurn("research owl", ctx);
  assert.equal(r.miss, true);
  assert.match(r.text, /needs a memory store/);
  assert.equal(provider.calls.length, 0, "no network is spent on a run that cannot land");
});

test("a non-research line returns null and touches nothing", async () => {
  const provider = cannedProvider({});
  const ctx = ctxFor(provider, ingestRecorder());
  assert.equal(await researchTurn("what is an owl", ctx), null);
  assert.equal(provider.calls.length, 0);
});

test("the provenance tag and the cited line render the documented shapes", () => {
  assert.equal(researchProvenanceTag("owl", 0), "research:owl@0");
  assert.equal(researchProvenanceTag("golden gate bridge", 1), "research:golden gate bridge@1");
  assert.equal(
    renderResearchAnswer("owl", ROW("Owl", "An owl is a bird.")),
    'owl — An owl is a bird. (source: research article "Owl", Simple English Wikipedia, CC BY-SA 4.0 — https://simple.wikipedia.org/wiki/Owl?oldid=42)',
  );
});
