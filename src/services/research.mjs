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
import { defaultNlp } from "../domain/interpret/nlp-registry.mjs";

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

/** The most linked topics any single fan-out may queue — the per-fan-out cap
 *  the request's "limit N" (or the configured `fanoutLimit`) sets, itself
 *  bounded here. */
export const RESEARCH_FANOUT_MAX = 12;

/** How deep the link fan-out may follow: depth 0 is the requested topic, and
 *  each further tier is the previous tier's own lead-section links. The user
 *  knob (page "maximum node depth", CLI `depth D`) is clamped to this. */
export const RESEARCH_MAX_DEPTH = 3;

/** The largest total node budget a run may carry — the page's "maximum
 *  response nodes" upper bound. `maxTopics` caps how many topics one run
 *  fetches and stores in total (depth 0 counts as the first). */
export const RESEARCH_MAX_TOPICS = 50;

export const RESEARCH_DEFAULTS = Object.freeze({
  fanoutLimit: 5,
  maxDepth: 1,
  maxTopics: 12,
  minIntervalMs: 2000,
});

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.floor(n)));

/** A partial `{ fanoutLimit?, maxDepth?, maxTopics?, minIntervalMs? }` (camelCase,
 *  as the page and CLI supply it) folded onto the shipped defaults and clamped
 *  to the engineered ranges: fan-out at RESEARCH_FANOUT_MAX, depth at
 *  RESEARCH_MAX_DEPTH, the node budget at [1, RESEARCH_MAX_TOPICS], and the
 *  polite interval only ever RAISED above its floor, never lowered. Every
 *  non-finite field falls back to its default, so a corrupt/absent value is
 *  the shipped knob, never a crash. */
export function clampResearchConfig(partial = {}) {
  const cfg = { ...RESEARCH_DEFAULTS };
  const fanout = Number(partial.fanoutLimit);
  if (Number.isFinite(fanout)) cfg.fanoutLimit = clampInt(fanout, 0, RESEARCH_FANOUT_MAX);
  const depth = Number(partial.maxDepth);
  if (Number.isFinite(depth)) cfg.maxDepth = clampInt(depth, 0, RESEARCH_MAX_DEPTH);
  const topics = Number(partial.maxTopics);
  if (Number.isFinite(topics)) cfg.maxTopics = clampInt(topics, 1, RESEARCH_MAX_TOPICS);
  const interval = Number(partial.minIntervalMs);
  if (Number.isFinite(interval)) cfg.minIntervalMs = Math.max(RESEARCH_DEFAULTS.minIntervalMs, interval);
  return cfg;
}

/** tmct.toml's `[research]` table → the lane's effective knobs, shipped
 *  defaults filling every unset key (the same posture resolveGameConfig
 *  takes with `[games.*]`). `fanout_limit` caps at RESEARCH_FANOUT_MAX;
 *  `depth_limit`/`max_depth` set how deep the fan-out follows (0 means no
 *  fan-out); `max_topics` sets the total node budget; `min_interval_ms` may
 *  only RAISE the polite floor between round trips, never lower it. */
export function resolveResearchConfig(toml = null) {
  const raw = toml?.research || {};
  return clampResearchConfig({
    fanoutLimit: raw.fanout_limit,
    maxDepth: raw.max_depth ?? raw.depth_limit,
    maxTopics: raw.max_topics,
    minIntervalMs: raw.min_interval_ms,
  });
}

// The verbs that step/inspect/end a run, checked before the start shape so
// "research next" never parses as a topic called "next".
const RESEARCH_NEXT_RE = /^research[,:]?\s+(?:next|continue|more)\s*[.!?]*$/i;
const RESEARCH_STATUS_RE = /^research[,:]?\s+status\s*[.!?]*$/i;
const RESEARCH_STOP_RE = /^research[,:]?\s+(?:stop|cancel|quit|end)\s*[.!?]*$/i;
const RESEARCH_START_RE = /^research[,:]?\s+(.+?)\s*[.!?]*$/i;
// The trailing knob tokens a start request may carry, stripped one at a time
// off the END so "limit N" and "depth D" read in either order: "research owls,
// limit 2 depth 2" and "research owls depth 2, limit 2" both parse the same.
const RESEARCH_OPTION_RE = /[,;]?\s+(?:with\s+)?(limit|depth)\s+(\d{1,3})$/i;
// A bare continuation word steps the queue too, but only when a run is
// actually pending and no plan lane owns the word — parseResearchRequest
// reports it as its own kind so the caller can apply that gate.
const BARE_NEXT_RE = /^(?:next|continue|carry on|keep going)\s*[.!?]*$/i;

/** The research request a line carries, or null. Kinds: start {topic, limit?,
 *  depth?}, next, bareNext, status, stop. The topic keeps the user's own words
 *  minus a leading article and any wrapping quotes; `limit` (per-fan-out cap)
 *  and `depth` (how deep the fan-out follows) are present only when the request
 *  named them. */
export function parseResearchRequest(line) {
  const q = String(line || "").trim();
  if (!q) return null;
  if (BARE_NEXT_RE.test(q)) return { kind: "bareNext" };
  if (RESEARCH_NEXT_RE.test(q)) return { kind: "next" };
  if (RESEARCH_STATUS_RE.test(q)) return { kind: "status" };
  if (RESEARCH_STOP_RE.test(q)) return { kind: "stop" };
  const m = q.match(RESEARCH_START_RE);
  if (!m) return null;
  let rest = m[1].trim();
  const opts = {};
  for (let om = rest.match(RESEARCH_OPTION_RE); om; om = rest.match(RESEARCH_OPTION_RE)) {
    const kind = om[1].toLowerCase();
    if (opts[kind] === undefined) opts[kind] = Number(om[2]);
    rest = rest.slice(0, om.index).trim();
  }
  const topic = rest
    .replace(/^["'‘’“”]+|["'‘’“”]+$/g, "")
    .replace(/^(?:an?|the)\s+/i, "")
    .trim();
  if (!topic) return null;
  const out = { kind: "start", topic };
  if (opts.limit !== undefined) out.limit = opts.limit;
  if (opts.depth !== undefined) out.depth = opts.depth;
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
 *  skips, the two node knobs this run carries, and whether the run is complete
 *  (and, if so, whether the node budget is why). Null for no run. */
export function researchSnapshot(state) {
  if (!state) return null;
  return {
    topic: state.topic,
    limit: state.limit,
    maxDepth: runMaxDepth(state),
    maxTopics: runMaxTopics(state),
    pending: [...state.pending],
    done: state.done.map((d) => ({ title: d.title, facts: d.facts, depth: d.depth })),
    skipped: [...state.skipped],
    complete: state.pending.length === 0,
    nodeCapReached: Boolean(state.nodeCapReached),
  };
}

const totalFacts = (state) => state.done.reduce((sum, d) => sum + d.facts, 0);

/** The run's effective knobs, defaulted so a queue resumed from an older
 *  persisted file (which carried neither field) reads as today's depth-1
 *  behaviour rather than crashing. */
const runMaxDepth = (state) => (Number.isFinite(state?.maxDepth) ? state.maxDepth : RESEARCH_DEFAULTS.maxDepth);
const runMaxTopics = (state) => (Number.isFinite(state?.maxTopics) ? state.maxTopics : RESEARCH_DEFAULTS.maxTopics);
const runFanout = (state) => clampInt(Number.isFinite(state?.limit) ? state.limit : RESEARCH_DEFAULTS.fanoutLimit, 0, RESEARCH_FANOUT_MAX);

/** The depth a queued title carries, or 1 for a queue resumed off an older
 *  file that never recorded per-title depths. */
const pendingDepth = (state, title) => {
  const d = state.depths ? state.depths[normFactTerm(title)] : undefined;
  return Number.isFinite(d) ? d : 1;
};

/** Every folded title this run has already touched — the run key, its grounded
 *  topics, its skips and its still-pending queue — so a fan-out never re-queues
 *  a topic the run has met. */
function queuedFolds(state) {
  const seen = new Set();
  if (state.key) seen.add(state.key);
  for (const d of state.done) { const f = normFactTerm(d.title); if (f) seen.add(f); }
  for (const t of state.skipped) { const f = normFactTerm(t); if (f) seen.add(f); }
  for (const t of state.pending) { const f = normFactTerm(t); if (f) seen.add(f); }
  return seen;
}

// The lexical-token split a fan-out candidate and the seed topic both fold
// through before comparison — lowercased, split on anything that isn't a
// letter or digit, empty pieces dropped.
const LEXICAL_SPLIT_RE = /[^a-z0-9]+/i;
function lexicalTokens(text) {
  return String(text || "").toLowerCase().split(LEXICAL_SPLIT_RE).filter(Boolean);
}
function sharesLexicalToken(title, seedTokens) {
  if (!seedTokens.size) return false;
  for (const tok of lexicalTokens(title)) if (seedTokens.has(tok)) return true;
  return false;
}

// A citation-shaped candidate: an ISBN/DOI prefix, a bare year, or a
// "Nth century" phrase — the shape raw Wikipedia link lists carry for their
// source apparatus rather than a kin article.
const CITATION_PREFIX_RE = /^(isbn|doi)[\s:.-]/i;
const CITATION_BARE_YEAR_RE = /^\d{3,4}$/;
const CITATION_CENTURY_RE = /\b\d{1,2}(?:st|nd|rd|th)\s+century\b/i;
function isCitationShaped(title) {
  const t = String(title || "").trim();
  if (!t) return false;
  return CITATION_PREFIX_RE.test(t) || CITATION_BARE_YEAR_RE.test(t) || CITATION_CENTURY_RE.test(t);
}

const SINGLE_WORD_TITLE_RE = /^[A-Za-z][A-Za-z'-]*$/;
// A short, neutral sentence to tag a bare candidate word inside — wink-nlp
// reads an isolated capitalized word as PROPN with no sentence context to
// tell it otherwise, so the word is lowercased and read at this fixed slot
// inside real subject/verb/object context instead.
const NOUN_CARRIER_PREFIX = ["this", "is", "about", "the"];
const NOUN_CARRIER_SUFFIX = ["and", "its", "history"];
const NOUN_CARRIER_WORD_INDEX = NOUN_CARRIER_PREFIX.length;

/** True when `title` is a single word a general-English POS tagger reads as
 *  a common noun (hub articles like "Earth"/"Geology") rather than a proper
 *  noun (kin articles like "Hawaii") — false whenever `nlp` is unavailable,
 *  never a throw. */
function readsAsCommonNoun(title, nlp) {
  if (!nlp || typeof nlp.posTags !== "function") return false;
  const t = String(title || "").trim();
  if (!SINGLE_WORD_TITLE_RE.test(t)) return false;
  const carrier = [...NOUN_CARRIER_PREFIX, t.toLowerCase(), ...NOUN_CARRIER_SUFFIX];
  let tags;
  try { tags = nlp.posTags(carrier); } catch { return false; }
  return Array.isArray(tags) && tags[NOUN_CARRIER_WORD_INDEX] === "NOUN";
}

/** Stable-sorts fan-out candidates into relevance tiers — never reorders
 *  within a tier, only reprioritizes between them — from information the
 *  runtime actually has (title strings, the seed topic, an optional POS
 *  tagger), never bench-only ground truth:
 *  0. shares a lexical token with `seedTopic` ("Active volcano" ~ "Volcano");
 *  1. everything else, in original document order (the fallback tier);
 *  2. a single-word title a POS tagger reads as a common noun rather than a
 *     proper noun — the hub-article signal ("Earth", "Geology");
 *  3. a citation-shaped title (ISBN/DOI prefix, bare year, "Nth century").
 *  With no `nlp` adapter registered, tier 2 never fires (everything that
 *  would have landed there stays in tier 1) — degrades gracefully, never
 *  throws, never drops a candidate. */
export function relevanceOrder(titles, seedTopic, nlp = null) {
  const list = Array.isArray(titles) ? titles : [];
  const seedTokens = new Set(lexicalTokens(seedTopic));
  const tiers = [[], [], [], []];
  for (const title of list) {
    if (sharesLexicalToken(title, seedTokens)) { tiers[0].push(title); continue; }
    if (isCitationShaped(title)) { tiers[3].push(title); continue; }
    if (readsAsCommonNoun(title, nlp)) { tiers[2].push(title); continue; }
    tiers[1].push(title);
  }
  return [...tiers[0], ...tiers[1], ...tiers[2], ...tiers[3]];
}

/** Queue `article`'s lead-section links at `fromDepth + 1`, subject to the run's
 *  depth ceiling, its per-fan-out cap and — crucially — its TOTAL node budget:
 *  the number added never pushes grounded+pending past `maxTopics`. Sets
 *  `state.nodeCapReached` when the budget (not the depth, not a lack of links)
 *  is what stopped the fan-out, so the progress line can say so. Candidates are
 *  relevance-ordered (relevanceOrder) before the fan-out cap truncates them, so
 *  a capped fetch keeps kin articles over generic hubs. Returns the titles it
 *  enqueued. */
async function enqueueFrom(state, article, fromDepth, provider) {
  const childDepth = fromDepth + 1;
  if (childDepth > runMaxDepth(state)) return [];
  const fanoutCap = runFanout(state);
  if (fanoutCap <= 0 || typeof provider.linkedTitles !== "function") return [];
  const budget = runMaxTopics(state) - (state.done.length + state.pending.length);
  const want = Math.min(fanoutCap, budget);
  if (want <= 0) { state.nodeCapReached = true; return []; }
  let linked = null;
  try { linked = await provider.linkedTitles(article.title, { limit: want + 2 }); } catch { linked = null; }
  const ordered = relevanceOrder(linked || [], article.title, defaultNlp());
  const seen = queuedFolds(state);
  if (!state.depths) state.depths = {};
  const added = [];
  for (const title of ordered) {
    const folded = normFactTerm(title);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    state.pending.push(title);
    state.depths[folded] = childDepth;
    added.push(title);
    if (added.length >= want) break;
  }
  // The budget, not the fan-out cap, was the binding constraint: the run wanted
  // more topics than the node budget would allow and filled to that ceiling.
  if (want < fanoutCap && added.length >= want) state.nodeCapReached = true;
  return added;
}

function progressLine(state) {
  const n = state.done.length;
  const facts = totalFacts(state);
  const done = `${n} topic${n === 1 ? "" : "s"} grounded, ${facts} fact${facts === 1 ? "" : "s"} stored`;
  const skipped = state.skipped.length ? `, ${state.skipped.length} skipped` : "";
  const capped = Boolean(state.nodeCapReached);
  if (!state.pending.length) {
    if (capped) return `research on "${state.topic}" reached its node budget — ${done}${skipped}.`;
    return `research on "${state.topic}" is complete — ${done}${skipped}.`;
  }
  const queued = `${state.pending.length} linked topic${state.pending.length === 1 ? "" : "s"} still queued`;
  if (capped) return `${done}${skipped}; ${queued} — "research next" fetches the next one. Node budget of ${runMaxTopics(state)} reached, so no more topics will be added; "research stop" clears the queue.`;
  return `${done}${skipped}; ${queued} — "research next" fetches the next one.`;
}

async function startRun({ topic, limit, depth }, { holder, provider, ingest, config, notify, lexicon }) {
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
  const maxDepth = Number.isFinite(depth) ? clampInt(depth, 0, RESEARCH_MAX_DEPTH) : config.maxDepth;
  const maxTopics = Number.isFinite(config.maxTopics) ? config.maxTopics : RESEARCH_DEFAULTS.maxTopics;
  holder.state = {
    topic, key, title: article.title, limit: fanout, maxDepth, maxTopics,
    pending: [], depths: {}, done: [{ title: article.title, facts, depth: 0 }],
    skipped: [], nodeCapReached: false,
  };
  const pending = await enqueueFrom(holder.state, article, 0, provider);
  const depthNote = maxDepth > 1 ? ` following links up to depth ${maxDepth}` : "";
  const queueLine = pending.length
    ? `queued ${pending.length} linked topic${pending.length === 1 ? "" : "s"}: ${pending.join(", ")}${depthNote} — "research next" fetches the next one (the page's play button does this for you).`
    : `no linked topics queued — research on "${topic}" is complete.`;
  return {
    text: `${renderResearchAnswer(key, article)}\nstored ${facts} fact${facts === 1 ? "" : "s"} from "${article.title}". ${queueLine}`,
    miss: false,
  };
}

async function stepRun({ holder, provider, ingest, notify }) {
  const state = holder.state;
  const title = state.pending[0];
  const depth = pendingDepth(state, title);
  state.pending = state.pending.slice(1);
  if (state.depths) delete state.depths[normFactTerm(title)];
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
  try { facts = await ingest(key, article, researchProvenanceTag(state.key, depth)); } catch { facts = 0; }
  state.done = [...state.done, { title: article.title, facts, depth }];
  if (depth < runMaxDepth(state)) await enqueueFrom(state, article, depth, provider);
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
