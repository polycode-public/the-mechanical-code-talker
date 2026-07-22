// research.mjs — the "research <topic>" lane: a Simple English Wikipedia
// queue that grounds one topic per turn. Depth 0 is the requested topic
// (opensearch + summary, ingested as graph facts); the topics its lead
// section links to queue at depth 1, capped by the request's own
// "limit N" or the configured default. Every completed search reports back
// as its own chat turn — the queue advances one step per "research next"
// (or a bare "next" while nothing else owns it), which is exactly what the
// web pages' auto-play button submits.
//
// No node builtins — this module ships in the browser bundles unchanged.
// The provider (network) and the ingest step (memory writes) are both
// injected by the caller (chat.mjs), so this file owns only the queue
// mechanics, the request grammar and the reported prose.
//
// Consent posture: an explicit "research <topic>" request IS the network
// consent for its own fetches. Unlike the clean-miss rescue (which fires on
// an ordinary question and therefore hides behind /wiki on), nobody types
// "research owls" without meaning "go and look owls up" — the reply names
// the source it reached either way. The /wiki toggle keeps governing every
// other lane unchanged.
//
// The abstention invariant holds throughout: a topic whose fetch or
// grounding fails reports the miss plainly, stores nothing, and the queue
// moves on. No fact is ever fabricated to keep a research run tidy.

import { normFactTerm } from "../domain/hash.mjs";
import { loadLexicon, lookupNoun } from "../domain/grammar/lexicon.mjs";

/** The search key a topic folds to: normFactTerm, then the lexicon lemma
 *  when the noun is known ("owls" → "owl") — the same fold the live
 *  clean-miss gate applies, and what keeps the provider's topic-drift guard
 *  happy with an inflected request. An unknown word keys on its own folded
 *  form (a topic the lexicon has never met is a fine thing to research). */
export function researchTopicKey(topic, lexicon = null) {
  const t = normFactTerm(topic);
  if (!t) return "";
  try {
    const lex = lexicon ?? loadLexicon();
    const entry = lookupNoun(lex, t);
    if (entry) return normFactTerm(entry.lemma) || t;
  } catch { /* lexicon unavailable — the folded form still works */ }
  return t;
}

/** The most linked topics any request or config may queue at depth 1 —
 *  the fair-use cap on a research run's total round trips. */
export const RESEARCH_FANOUT_MAX = 12;

export const RESEARCH_DEFAULTS = Object.freeze({
  fanoutLimit: 5,
  depthLimit: 1,
  minIntervalMs: 2000,
});

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(n)));

/** tmct.toml's `[research]` table → the lane's effective knobs, shipped
 *  defaults filling every unset key (the same posture resolveGameConfig
 *  takes with `[games.*]`). `fanout_limit` caps at RESEARCH_FANOUT_MAX;
 *  `depth_limit` is 0 (no fan-out) or 1 (the depths engineered today);
 *  `min_interval_ms` may only RAISE the polite floor between round trips,
 *  never lower it. */
export function resolveResearchConfig(toml = null) {
  const raw = toml?.research || {};
  const cfg = { ...RESEARCH_DEFAULTS };
  const fanout = Number(raw.fanout_limit);
  if (Number.isFinite(fanout)) cfg.fanoutLimit = clampInt(fanout, 0, RESEARCH_FANOUT_MAX);
  const depth = Number(raw.depth_limit);
  if (Number.isFinite(depth)) cfg.depthLimit = clampInt(depth, 0, 1);
  const interval = Number(raw.min_interval_ms);
  if (Number.isFinite(interval)) cfg.minIntervalMs = Math.max(RESEARCH_DEFAULTS.minIntervalMs, interval);
  return cfg;
}

// The verbs that step/inspect/end a run, checked before the start shape so
// "research next" never parses as a topic called "next".
const RESEARCH_NEXT_RE = /^research[,:]?\s+(?:next|continue|more)\s*[.!?]*$/i;
const RESEARCH_STATUS_RE = /^research[,:]?\s+status\s*[.!?]*$/i;
const RESEARCH_STOP_RE = /^research[,:]?\s+(?:stop|cancel|quit|end)\s*[.!?]*$/i;
const RESEARCH_START_RE = /^research[,:]?\s+(.+?)(?:[,;]?\s+(?:with\s+)?limit\s+(\d{1,3}))?\s*[.!?]*$/i;
// A bare continuation word steps the queue too, but only when a run is
// actually pending and no plan lane owns the word — parseResearchRequest
// reports it as its own kind so the caller can apply that gate.
const BARE_NEXT_RE = /^(?:next|continue|carry on|keep going)\s*[.!?]*$/i;

/** The research request a line carries, or null. Kinds: start {topic,
 *  limit?}, next, bareNext, status, stop. The topic keeps the user's own
 *  words minus a leading article and any wrapping quotes; limit is only
 *  present when the request named one. */
export function parseResearchRequest(line) {
  const q = String(line || "").trim();
  if (!q) return null;
  if (BARE_NEXT_RE.test(q)) return { kind: "bareNext" };
  if (RESEARCH_NEXT_RE.test(q)) return { kind: "next" };
  if (RESEARCH_STATUS_RE.test(q)) return { kind: "status" };
  if (RESEARCH_STOP_RE.test(q)) return { kind: "stop" };
  const m = q.match(RESEARCH_START_RE);
  if (!m) return null;
  const topic = m[1].trim()
    .replace(/^["'‘’“”]+|["'‘’“”]+$/g, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .trim();
  if (!topic) return null;
  const out = { kind: "start", topic };
  if (m[2] !== undefined) out.limit = Number(m[2]);
  return out;
}

/** The provenance tag every fact a research run stores carries:
 *  `research:<topic>@<depth>` — memory/trust.mjs parses it back to the
 *  referenceLive kind, so live-fetched research content scores exactly like
 *  any other live Wikipedia load, below the curated packs. */
export function researchProvenanceTag(topicKey, depth) {
  return `research:${topicKey}@${depth}`;
}

/** The cited per-topic report — the same title/licence/revision-pinned-URL
 *  discipline renderLiveReferenceAnswer holds, naming this lane's source. */
export function renderResearchAnswer(term, article) {
  return `${term} — ${article.summary} (source: research article "${article.title}", `
    + `Simple English Wikipedia, CC BY-SA 4.0 — ${article.url}?oldid=${article.revid})`;
}

/** The queue as plain data for a UI: pending titles, per-topic fact counts,
 *  skips, and whether the run is complete. Null for no run. */
export function researchSnapshot(state) {
  if (!state) return null;
  return {
    topic: state.topic,
    limit: state.limit,
    pending: [...state.pending],
    done: state.done.map((d) => ({ title: d.title, facts: d.facts, depth: d.depth })),
    skipped: [...state.skipped],
    complete: state.pending.length === 0,
  };
}

const totalFacts = (state) => state.done.reduce((sum, d) => sum + d.facts, 0);

function progressLine(state) {
  const done = `${state.done.length} topic${state.done.length === 1 ? "" : "s"} grounded, ${totalFacts(state)} fact${totalFacts(state) === 1 ? "" : "s"} stored`;
  const skipped = state.skipped.length ? `, ${state.skipped.length} skipped` : "";
  if (!state.pending.length) return `research on "${state.topic}" is complete — ${done}${skipped}.`;
  return `${done}${skipped}; ${state.pending.length} linked topic${state.pending.length === 1 ? "" : "s"} still queued — "research next" fetches the next one.`;
}

async function startRun({ topic, limit }, { holder, provider, ingest, config, notify, lexicon }) {
  const key = researchTopicKey(topic, lexicon);
  if (!key) {
    holder.state = null;
    return { text: `I can't make a search key out of "${topic}".`, miss: true };
  }
  try { if (typeof notify === "function") notify(key); } catch { /* notify-only */ }
  let article = null;
  try { article = await provider.lookup(key); } catch { article = null; }
  if (!article) {
    holder.state = null;
    return {
      text: `I couldn't ground "${topic}" from Simple English Wikipedia just now — no matching article, or the network didn't answer. Nothing was stored.`,
      miss: true,
    };
  }
  let facts = 0;
  try { facts = await ingest(key, article, researchProvenanceTag(key, 0)); } catch { facts = 0; }
  const fanout = clampInt(
    limit !== undefined && Number.isFinite(limit) ? limit : config.fanoutLimit,
    0,
    RESEARCH_FANOUT_MAX,
  );
  let pending = [];
  if (fanout > 0 && config.depthLimit > 0 && typeof provider.linkedTitles === "function") {
    let linked = null;
    try { linked = await provider.linkedTitles(article.title, { limit: fanout + 2 }); } catch { linked = null; }
    const seen = new Set([key, normFactTerm(article.title)]);
    for (const title of linked || []) {
      const folded = normFactTerm(title);
      if (!folded || seen.has(folded)) continue;
      seen.add(folded);
      pending.push(title);
      if (pending.length >= fanout) break;
    }
  }
  holder.state = {
    topic, key, title: article.title, limit: fanout,
    pending, done: [{ title: article.title, facts, depth: 0 }], skipped: [],
  };
  const queueLine = pending.length
    ? `queued ${pending.length} linked topic${pending.length === 1 ? "" : "s"}: ${pending.join(", ")} — "research next" fetches the next one (the page's play button does this for you).`
    : `no linked topics queued — research on "${topic}" is complete.`;
  return {
    text: `${renderResearchAnswer(key, article)}\nstored ${facts} fact${facts === 1 ? "" : "s"} from "${article.title}". ${queueLine}`,
    miss: false,
  };
}

async function stepRun({ holder, provider, ingest, notify }) {
  const state = holder.state;
  const title = state.pending[0];
  state.pending = state.pending.slice(1);
  try { if (typeof notify === "function") notify(title); } catch { /* notify-only */ }
  let article = null;
  try { article = await (provider.pageByTitle ? provider.pageByTitle(title) : provider.lookup(normFactTerm(title))); } catch { article = null; }
  if (!article) {
    state.skipped = [...state.skipped, title];
    return {
      text: `I couldn't fetch "${title}" from Simple English Wikipedia — skipped, nothing stored. ${progressLine(state)}`,
      miss: true,
    };
  }
  const key = normFactTerm(article.title) || normFactTerm(title);
  let facts = 0;
  try { facts = await ingest(key, article, researchProvenanceTag(state.key, 1)); } catch { facts = 0; }
  state.done = [...state.done, { title: article.title, facts, depth: 1 }];
  return {
    text: `${renderResearchAnswer(key, article)}\nstored ${facts} fact${facts === 1 ? "" : "s"} from "${article.title}". ${progressLine(state)}`,
    miss: false,
  };
}

/**
 * The whole lane behind one call — chat.mjs's dispatch stays one thin block.
 * Returns null when the line carries no research request (or carries a bare
 * "next" this lane must not claim), else { text, miss, note, goal } with
 * `holder.state` updated in place; the caller snapshots it for the UI and
 * threads it to the next turn.
 *
 * `ctx`: { holder, provider, ingest(key, article, tag) -> stored count,
 * config (resolveResearchConfig's shape), memoryDir, planActive,
 * pagerActive, notify, lexicon }.
 */
export async function researchTurn(line, ctx) {
  const req = parseResearchRequest(line);
  if (!req) return null;
  const { holder, memoryDir, planActive, pagerActive } = ctx;
  const pendingRun = Boolean(holder.state && holder.state.pending.length);
  // A bare "next" belongs to an active plan first, then to paging — this
  // lane only claims it when a research queue is the one thing running.
  if (req.kind === "bareNext" && (!pendingRun || planActive || pagerActive)) return null;
  const goal = "research a topic on Simple English Wikipedia and remember what it grounds";
  const wrap = (r, note) => ({ ...r, goal, note });
  if (req.kind === "status") {
    if (!holder.state) return wrap({ text: 'no research is running — "research <topic>" starts one.', miss: true }, "RESEARCH — status with no run standing");
    return wrap({ text: progressLine(holder.state), miss: false }, "RESEARCH — queue status read-out");
  }
  if (req.kind === "stop") {
    if (!holder.state) return wrap({ text: 'no research is running — "research <topic>" starts one.', miss: true }, "RESEARCH — stop with no run standing");
    const state = holder.state;
    holder.state = null;
    const dropped = state.pending.length;
    return wrap({
      text: `stopped research on "${state.topic}" — ${state.done.length} topic${state.done.length === 1 ? "" : "s"} grounded, ${totalFacts(state)} fact${totalFacts(state) === 1 ? "" : "s"} stored${dropped ? `, ${dropped} queued topic${dropped === 1 ? "" : "s"} dropped` : ""}.`,
      miss: false,
    }, "RESEARCH — run stopped, queue dropped");
  }
  if (!memoryDir) {
    return wrap({ text: "research needs a memory store to write into, and this session has none.", miss: true }, "RESEARCH — declined, no memory store");
  }
  if (req.kind === "next" || req.kind === "bareNext") {
    if (!pendingRun) {
      if (holder.state) return wrap({ text: progressLine(holder.state), miss: false }, "RESEARCH — next on a completed run reads the summary");
      return wrap({ text: 'no research is running — "research <topic>" starts one.', miss: true }, "RESEARCH — next with no run standing");
    }
    return wrap(await stepRun(ctx), "RESEARCH — one queued topic fetched and grounded");
  }
  return wrap(await startRun(req, ctx), "RESEARCH — depth-0 topic fetched, linked topics queued");
}
