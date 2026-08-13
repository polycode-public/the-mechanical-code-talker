// news.mjs — the news capability's orchestration and library contract
// (PLAN_NEWS_FEED.md section 10, phase 3): poll, ingest, ground, rank,
// enrich, re-process, syllogise, build, evict, measure. Every surface —
// news.html, chat's `/news`, the TUI (via chat), the CLI verb and a JS
// import — consumes the functions exported here; no surface re-implements a
// step.
//
// A ctx is built once per surface: { memoryDir, store, cache, lexicon,
// config, state, providers, now, notify }.
//   memoryDir  a repo path or backend handle, passed straight to the store
//              functions and to ingestText/syllogise.
//   store      { loadMemory, readFactRows, appendFacts, removeFacts } — the
//              syllogise store triple, plus the retraction path eviction
//              uses; injected so this module never imports the memory
//              adapter's I/O itself.
//   cache      optional; when present, cache.rows is cleared after a write
//              (the same invalidation convention chat.mjs's own caches use).
//   lexicon    a loaded lexicon (loadLexicon() when absent).
//   config     resolveNewsConfig()'s shape.
//   state      the news-store shape (news-store.mjs): { items, seenItemKeys,
//              ledger (ledgerPayload form), health, requestLog, metrics,
//              lastPollAt, lastEnrichAt } — always JSON-plain; a live term
//              ledger is built from state.ledger via ledgerFromPayload only
//              for the span of one call, then folded back with ledgerPayload.
//   providers  { newsFetchers: Map<sourceId, { id, fetchItems }>,
//              getResearchProvider({ source }), preflightNewsUrl?(url) } —
//              every fetcher and provider this session may call, already
//              constructed (adapters own I/O construction, never this
//              module).
//   now        a function returning the caller's clock reading (ISO string
//              or ms), or a fixed reading directly. Never read from here —
//              the wall clock enters only through this parameter.
//   notify     an optional, failure-tolerated status hook.
//   shouldAbort an optional predicate the long loops read at every awaited
//              yield point. Once it answers true the cycle stops between
//              whole units of work — never inside one — and reports
//              `aborted: true` alongside whatever it had already finished.
//
// Determinism: given the same fetched payloads and the same `now`, the same
// facts land and the same feed renders, byte for byte (PLAN_NEWS_FEED.md
// section 3). Network lives in the adapters this module is handed, never
// inside it.

import { normFactTerm, normFactPredicate, normText, factIdFor } from "../domain/hash.mjs";
import {
  newsWindowRows, renderNewsParagraph, buildNewsItems, evictNewsFacts,
  conceptTerms, isQuantityTerm, newsItemKeys,
} from "../domain/news-feed.mjs";
import {
  createTermLedger, bumpTerms, rankedTerms, markTerm, groundedSweep, ledgerPayload, ledgerFromPayload,
} from "../domain/term-ledger.mjs";
import { syllogise } from "../domain/syllogise.mjs";
import { loadLexicon, lookupNoun } from "../domain/grammar/lexicon.mjs";
import { pluralOf } from "../domain/inflect.mjs";
import { provenanceTagToSource, SOURCE_PRIOR } from "../domain/memory/trust.mjs";
import {
  NEWS_SOURCE_RECORDS, DEFAULT_NEWS_SOURCE_IDS, DEFAULT_NEWS_KB_IDS,
  newsSourceRecords, normalizeNewsSourceIds, registerNewsSource,
} from "../adapters/corpus/news-sources.mjs";
import { DEFAULT_MIN_INTERVAL_MS } from "../adapters/corpus/courtesy.mjs";
import { researchFacts } from "../adapters/corpus/research-source.mjs";
import { throughSourceBreaker, sourceSkipStatusLine } from "../domain/source-breaker.mjs";
import {
  ingestText, readsAsEntityTerm, ungroundedTermOccurrences, termsUsedOnlyAsVerbs,
} from "./extract-facts.mjs";

export { NEWS_SOURCE_RECORDS, DEFAULT_NEWS_SOURCE_IDS, DEFAULT_NEWS_KB_IDS };

// ---------------------------------------------------------------------------
// 10.1 — config and parsing
// ---------------------------------------------------------------------------

export const NEWS_DEFAULTS = Object.freeze({
  sources: DEFAULT_NEWS_SOURCE_IDS,
  kbSources: DEFAULT_NEWS_KB_IDS,
  extraSources: Object.freeze([]),
  pollMinutes: 15,
  enrichMinutes: 10,
  enrichTermsPerCycle: 3,
  negativeCacheTtlHours: 24,
  syllogismsPerIngest: 12,
  // Per source, not across the whole poll: each enabled source keeps its own
  // window of up to this many snapshots, so one prolific source can never
  // crowd another out of the window before either has been read.
  itemCap: 30,
  newsFactCap: 4000,
  feedTop: 3,
  windowHours: 48,
  // 0 means "no override" — every source keeps its own registry floor
  // (Math.max(sourceFloor, 0) === sourceFloor), never a real interval.
  minIntervalMs: 0,
});

const clampInt = (n, lo, hi, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
};
const clampNonNegInt = (n, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.floor(v));
};

/** `poll_minutes`: 0 (on-demand only) is legal as-is; any other value floors
 *  at 5 — a page-set interval faster than that clamps up, never down. */
function clampPollMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NEWS_DEFAULTS.pollMinutes;
  const floored = Math.max(0, Math.floor(n));
  return floored === 0 ? 0 : Math.max(5, floored);
}

function normalizeExtraSources(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = String(raw?.id ?? "").trim();
    const url = String(raw?.url ?? "").trim();
    if (!id || !url.startsWith("https://") || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, url });
  }
  return out;
}

/** A partial (camelCase) config folded onto NEWS_DEFAULTS and clamped to the
 *  engineered ranges (PLAN_NEWS_FEED.md section 6.4). Every non-finite number
 *  falls back to its default; an unrecognized source id is dropped rather
 *  than rejected, so an older config degrades instead of failing. */
export function clampNewsConfig(partial = {}) {
  const cfg = { ...NEWS_DEFAULTS };
  cfg.sources = normalizeNewsSourceIds(partial.sources ?? NEWS_DEFAULTS.sources);
  cfg.kbSources = normalizeNewsSourceIds(partial.kbSources ?? NEWS_DEFAULTS.kbSources);
  cfg.extraSources = normalizeExtraSources(partial.extraSources ?? NEWS_DEFAULTS.extraSources);
  cfg.pollMinutes = clampPollMinutes(partial.pollMinutes ?? NEWS_DEFAULTS.pollMinutes);
  cfg.enrichMinutes = clampNonNegInt(partial.enrichMinutes, NEWS_DEFAULTS.enrichMinutes);
  cfg.enrichTermsPerCycle = clampInt(partial.enrichTermsPerCycle, 1, 10, NEWS_DEFAULTS.enrichTermsPerCycle);
  cfg.negativeCacheTtlHours = clampNonNegInt(partial.negativeCacheTtlHours, NEWS_DEFAULTS.negativeCacheTtlHours);
  cfg.syllogismsPerIngest = clampInt(partial.syllogismsPerIngest, 0, 50, NEWS_DEFAULTS.syllogismsPerIngest);
  cfg.itemCap = clampInt(partial.itemCap, 1, 200, NEWS_DEFAULTS.itemCap);
  cfg.newsFactCap = clampNonNegInt(partial.newsFactCap, NEWS_DEFAULTS.newsFactCap);
  cfg.feedTop = clampInt(partial.feedTop, 1, 10, NEWS_DEFAULTS.feedTop);
  cfg.windowHours = clampNonNegInt(partial.windowHours, NEWS_DEFAULTS.windowHours);
  cfg.minIntervalMs = clampNonNegInt(partial.minIntervalMs, NEWS_DEFAULTS.minIntervalMs);
  return cfg;
}

/** tmct.toml's `[news]` table -> the capability's effective knobs, following
 *  resolveResearchConfig's precedent. */
export function resolveNewsConfig(toml = null) {
  const raw = toml?.news || {};
  return clampNewsConfig({
    sources: raw.sources,
    kbSources: raw.kb_sources,
    extraSources: raw.extra_sources,
    pollMinutes: raw.poll_minutes,
    enrichMinutes: raw.enrich_minutes,
    enrichTermsPerCycle: raw.enrich_terms_per_cycle,
    negativeCacheTtlHours: raw.negative_cache_ttl_hours,
    syllogismsPerIngest: raw.syllogisms_per_ingest,
    itemCap: raw.item_cap,
    newsFactCap: raw.news_fact_cap,
    feedTop: raw.feed_top,
    windowHours: raw.window_hours,
    minIntervalMs: raw.min_interval_ms,
  });
}

const NEWS_SLASH_RE = /^\/news\b\s*(.*)$/i;
const NEWS_SHOW_RE = /^(?:news|latest news|what'?s in the news\??|show me the news)\s*[.!?]*$/i;
const NEWS_FOCUS_RE = /^(?:any news on|news on|news about)\s+(.+?)\s*\??$/i;

function parseNewsSubcommand(rest) {
  const trimmed = String(rest || "").trim();
  if (!trimmed) return { kind: "show" };
  const [word, ...restWords] = trimmed.split(/\s+/);
  const lower = word.toLowerCase();
  if (lower === "poll") return { kind: "poll" };
  if (lower === "rank") return { kind: "rank" };
  if (lower === "enrich") return { kind: "enrich" };
  if (lower === "sources") return { kind: "sources" };
  if (lower === "add" && restWords[0]) return { kind: "add", url: restWords[0] };
  if (lower === "interval" && /^\d+$/.test(restWords[0] || "")) {
    return { kind: "interval", minutes: Number(restWords[0]) };
  }
  return { kind: "unknown", subcommand: word };
}

/** The news request a line carries, or null. Kinds: show (optionally
 *  {focus}), poll, rank, enrich, sources, add {url}, interval {minutes},
 *  unknown {subcommand}. Both `/news …` and the plain-English phrasings
 *  ("news", "latest news", "any news on X?") resolve to the same kinds. */
export function parseNewsRequest(line) {
  const q = String(line || "").trim();
  if (!q) return null;
  const slash = q.match(NEWS_SLASH_RE);
  if (slash) return parseNewsSubcommand(slash[1]);
  if (NEWS_SHOW_RE.test(q)) return { kind: "show" };
  const focus = q.match(NEWS_FOCUS_RE);
  if (focus) return { kind: "show", focus: focus[1].trim() };
  return null;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function resolveNow(now) {
  if (typeof now === "function") return now();
  return typeof now === "string" || typeof now === "number" ? now : "";
}

// Every quantifier factTermVariants(chat.mjs) also strips, and the same
// -es/-s fold — a small, self-contained widening so this module never
// depends on chat.mjs (chat.mjs will depend on this module in the next
// phase; a reverse edge here would be circular).
const QUANTIFIER_LEAD_RE = /^(?:every|each|all|any)\s+/i;
function newsTermVariants(term) {
  const t = normFactTerm(term);
  const variants = new Set();
  if (!t) return variants;
  const bases = new Set([t]);
  const unquantified = t.replace(QUANTIFIER_LEAD_RE, "").trim();
  if (unquantified && unquantified !== t) bases.add(unquantified);
  for (const base of bases) {
    variants.add(base);
    if (base.endsWith("es")) variants.add(base.slice(0, -2));
    if (base.endsWith("s")) variants.add(base.slice(0, -1));
  }
  return variants;
}

function termFocusOf(facts) {
  const focus = new Set();
  for (const f of facts) {
    for (const v of newsTermVariants(f.subject)) focus.add(v);
    for (const v of newsTermVariants(f.object)) focus.add(v);
  }
  return focus;
}

function invalidateCache(cache) {
  if (cache) cache.rows = null;
}

/** The ctx's own stop signal, or a predicate that never stops. Read once per
 *  call site so a ctx without one costs nothing. */
function abortSignalOf(ctx) {
  return typeof ctx?.shouldAbort === "function" ? ctx.shouldAbort : () => false;
}

// The headline and the item's own description are two separate texts, so they
// reach the ingest as two PARAGRAPHS. Run together on one line they merge into
// one sentence whenever the headline ends on something the sentence splitter
// will not break after — an abbreviation ("… Arrives in the U.S." + "Russia
// released …" reads as one 26-word sentence, and the fact that falls out of it
// has "u.s. russia" for a subject) or a description that opens on a quotation.
// A blank line between them is the boundary ingestText already splits on.
function joinTitleAndSummary(title, summary) {
  const t = String(title || "").trim();
  const s = String(summary || "").trim();
  if (!t) return s;
  if (!s) return t;
  return `${t}\n\n${s}`;
}

function toMs(value) {
  if (typeof value === "number") return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

/** The ranked-terms panel's own display filter (PLAN_NEWSWORTHINESS.md
 *  section 3): a bare class object or a bare quantity is never a useful
 *  "unknown word" entry. The concept-card fallback used to drop both from
 *  its own candidate list before it retired from the feed path; this is
 *  where that filter lives now, so the panel stops leading with bare
 *  classes too. */
export function filterRankedTermEntries(rows, entries) {
  const concepts = conceptTerms(rows);
  return entries.filter(({ term }) => !concepts.has(term) && !isQuantityTerm(term));
}

// filterRankedTermEntries can shrink the ledger's own limited slice, so both
// rank() call sites ask the ledger for more than the display wants and trim
// afterward — the display count stays full even when some entries filter out.
const RANK_OVERFETCH = 4;

function buildSourcesByFactId(items) {
  const map = new Map();
  const recordsById = new Map(newsSourceRecords().map((r) => [r.id, r]));
  for (const snap of items || []) {
    const record = recordsById.get(snap.sourceId);
    const src = {
      title: snap.title || "",
      url: snap.url || "",
      name: record?.name || snap.sourceId || "",
      // The item's own description, carried so a card can show the report it
      // was built from beside the sentences the graph read out of it. Bounded
      // downstream (collectSources), never rewritten here.
      summary: snap.summary || "",
    };
    // A snapshot with no publication timestamp (a source whose own feed never
    // carries one) leaves the key off entirely — never an invented or blank
    // date, and never the fetch's own clock standing in for it.
    if (snap.publishedAt) src.publishedAt = snap.publishedAt;
    for (const factId of snap.factIds || []) map.set(factId, src);
  }
  return map;
}

/** The entity names a card's own article text carries, read through the same
 *  capture the enrichment queue is fed from (`ungroundedTermOccurrences`), so a
 *  name reaches a card's background under exactly the key enrichment stored it
 *  under. The fact set handed in is empty on purpose: that call's own filter
 *  drops a term the graph already holds facts about, and a card wants precisely
 *  those. A single word the lexicon reads as an everyday noun drops out here —
 *  "developer" names nothing a lookup could define — while a name run keeps its
 *  whole spelling, "tim king" and "amigados" alike.
 *
 *  A word the article only ever uses as a clause's verb names no entity either,
 *  however the tagger read it: "many say it is …" is the article saying
 *  something, and "the government moves to assert control" is the government
 *  moving. Either one reaching this list gives a card's background walk an
 *  anchor the article never named. */
export function articleEntityNames(texts, { lexicon } = {}) {
  const lex = lexicon || loadLexicon();
  const verbs = termsUsedOnlyAsVerbs(texts, { lexicon: lex });
  const names = [];
  for (const term of ungroundedTermOccurrences(texts, [], { lexicon: lex }).keys()) {
    if (verbs.has(term)) continue;
    if (term.includes(" ") || !isVocabGroundedTerm(lex, term)) names.push(term);
  }
  return names.sort();
}

// ---------------------------------------------------------------------------
// grounding definitions (10.2)
// ---------------------------------------------------------------------------

/** True when the lexicon resolves `term` as a noun. Answers parseability
 *  only — display for the ranked-terms panel, never a gate on ledger
 *  admission or enrichment eligibility (PLAN_NEWS_FEED.md section 6.3). */
export function isVocabGroundedTerm(lexicon, term) {
  const t = normFactTerm(term);
  if (!t) return false;
  try { return Boolean(lookupNoun(lexicon, t)); } catch { return false; }
}

/** True when `rows` holds at least one fact whose subject or object matches
 *  `term` (through the same variant widening a plural/quantified spelling
 *  needs). THE fact-grounding definition — what ledger admission,
 *  groundedSweep and enrichment eligibility all test. */
export function isFactGroundedTerm(rows, term) {
  const variants = newsTermVariants(term);
  if (!variants.size) return false;
  for (const row of rows) {
    if (variants.has(normFactTerm(row.subject)) || variants.has(normFactTerm(row.object))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ingest (shared by ingestNewsSnapshot and reprocessAfterGrounding)
// ---------------------------------------------------------------------------

/** Grounds one snapshot's title+summary, records the facts it contributed on
 *  the snapshot (content-addressed ids, so a re-run upserts rather than
 *  duplicates) and bumps the fact-ungrounded-term ledger. Does NOT run
 *  syllogise — callers that want one snapshot's own bounded round
 *  (ingestNewsSnapshot) or one combined round over several snapshots
 *  (reprocessAfterGrounding) run it themselves over this function's
 *  returned facts. */
async function ingestSnapshotFacts(ctx, snapshot) {
  const { memoryDir, lexicon, state, now, cache } = ctx;
  const nowVal = resolveNow(now);
  const lex = lexicon || loadLexicon();
  const text = joinTitleAndSummary(snapshot.title, snapshot.summary);
  const sourceTag = `news:${snapshot.sourceId}@${snapshot.id}`;
  const result = await ingestText(text, {
    memoryDir, sourceTag, optimistic: true, lexicon: lex, observedAt: nowVal, findings: true,
    attributeToSource: true,
  });
  invalidateCache(cache);

  const allFacts = [...result.extracted, ...result.optimistic];
  const newFactIds = allFacts.map((f) => factIdFor(normFactTerm(f.subject), normFactPredicate(f.predicate), normFactTerm(f.object)));
  snapshot.factIds = [...new Set([...(snapshot.factIds || []), ...newFactIds])];
  snapshot.processedRounds = (snapshot.processedRounds || 0) + 1;

  const vocabGroundedByTerm = new Map();
  for (const term of result.ungroundedCounts.keys()) vocabGroundedByTerm.set(term, isVocabGroundedTerm(lex, term));
  const ledger = ledgerFromPayload(state.ledger);
  bumpTerms(ledger, result.ungroundedCounts, snapshot.id, nowVal, vocabGroundedByTerm);
  state.ledger = ledgerPayload(ledger);

  return {
    facts: allFacts,
    sentences: result.sentences,
    recognized: result.recognized,
    optimisticCount: result.optimistic.length,
  };
}

/** Grounds one just-fetched snapshot and runs its own bounded syllogism
 *  round, focused on the terms its own new facts touched. */
export async function ingestNewsSnapshot(ctx, snapshot) {
  const { memoryDir, store, config } = ctx;
  const { facts, sentences, recognized, optimisticCount } = await ingestSnapshotFacts(ctx, snapshot);
  let derived = 0;
  if (facts.length && config.syllogismsPerIngest > 0) {
    const focus = [...termFocusOf(facts)];
    const res = await syllogise(memoryDir, { focus, expandFocus: true, budget: config.syllogismsPerIngest, store });
    derived = res?.count || 0;
    if (derived) invalidateCache(ctx.cache);
  }
  return { facts: facts.length, derived, sentences, recognized, optimisticCount };
}

function snapshotMentionsAny(snapshot, terms) {
  const text = `${snapshot.title || ""} ${snapshot.summary || ""}`.toLowerCase();
  return terms.some((term) => term && text.includes(term));
}

/** Re-runs ingestNewsSnapshot's grounding step over every snapshot that
 *  mentions a newly grounded term, then one combined syllogism round over
 *  the union of what that re-run added, then sweeps the ledger by
 *  fact-grounding alone. */
export async function reprocessAfterGrounding(ctx, groundedTerms) {
  const { memoryDir, store, state, config } = ctx;
  const shouldAbort = abortSignalOf(ctx);
  const terms = [...new Set((groundedTerms || []).map((t) => normFactTerm(t)).filter(Boolean))];
  if (!terms.length) return { facts: 0, derived: 0, flipped: [] };

  const touched = (state.items || []).filter((snap) => snapshotMentionsAny(snap, terms));
  let factsTotal = 0;
  const allNewFacts = [];
  for (const snap of touched) {
    if (shouldAbort()) break;
    const { facts } = await ingestSnapshotFacts(ctx, snap);
    factsTotal += facts.length;
    allNewFacts.push(...facts);
  }

  let derived = 0;
  if (allNewFacts.length && config.syllogismsPerIngest > 0) {
    const focus = [...termFocusOf(allNewFacts)];
    const res = await syllogise(memoryDir, { focus, expandFocus: true, budget: config.syllogismsPerIngest, store });
    derived = res?.count || 0;
  }

  const memory = await store.loadMemory(memoryDir);
  const rows = store.readFactRows(memory);
  const ledger = ledgerFromPayload(state.ledger);
  const flipped = groundedSweep(ledger, (term) => isFactGroundedTerm(rows, term));
  state.ledger = ledgerPayload(ledger);
  if (factsTotal || derived) invalidateCache(ctx.cache);

  return { facts: factsTotal, derived, flipped };
}

// ---------------------------------------------------------------------------
// polling
// ---------------------------------------------------------------------------

const BACKOFF_CAP_MS = 6 * 3600000;
const AUTO_DISABLE_THRESHOLD = 3;

function findOrCreateHealth(state, sourceId) {
  const rows = state.health || (state.health = []);
  let row = rows.find((h) => h.sourceId === sourceId);
  if (!row) {
    row = {
      sourceId, lastPolledAt: "", lastStatus: "", consecutiveFailures: 0,
      backoffUntil: "", autoDisabled: false, browserBlocked: false, etag: "", lastModified: "",
    };
    rows.push(row);
  }
  return row;
}

function isBackedOff(health, nowVal) {
  if (health.autoDisabled) return true;
  if (!health.backoffUntil) return false;
  const until = toMs(health.backoffUntil);
  const now = toMs(nowVal);
  return Number.isFinite(until) && Number.isFinite(now) && now < until;
}

/** Doubles the source's effective poll interval per consecutive failure
 *  (base: the configured poll cadence, or the shipped default when polling
 *  is on-demand only), capped at six hours; the third consecutive failure
 *  auto-disables instead of scheduling another backoff. */
function recordFailure(health, config, nowVal) {
  health.lastPolledAt = nowVal;
  health.lastStatus = "failed";
  health.consecutiveFailures += 1;
  if (health.consecutiveFailures >= AUTO_DISABLE_THRESHOLD) {
    health.autoDisabled = true;
    health.backoffUntil = "";
    return;
  }
  const baseMs = Math.max(1, config.pollMinutes || NEWS_DEFAULTS.pollMinutes) * 60000;
  const backoffMs = Math.min(BACKOFF_CAP_MS, baseMs * (2 ** health.consecutiveFailures));
  const nowMs = toMs(nowVal);
  health.backoffUntil = Number.isFinite(nowMs) ? new Date(nowMs + backoffMs).toISOString() : "";
}

function recordSuccess(health, nowVal, status) {
  health.lastPolledAt = nowVal;
  health.lastStatus = status;
  health.consecutiveFailures = 0;
  health.backoffUntil = "";
  health.autoDisabled = false;
}

const fetchedAtMs = (snapshot) => {
  const ms = toMs(snapshot?.fetchedAt);
  return Number.isFinite(ms) ? ms : 0;
};

/** True once a snapshot has been through a grounding round. A snapshot is
 *  filed the moment it arrives, so "known" and "grounded" are two different
 *  states and only this one means the facts landed. */
const isGroundedSnapshot = (snapshot) => (snapshot?.processedRounds || 0) > 0;

const byIdAscending = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byFetchedAtThenId = (a, b) => (fetchedAtMs(a) - fetchedAtMs(b)) || byIdAscending(a, b);
// The item cap's drop order: a snapshot already read is the first to go, since
// its facts are in the graph and its keys are remembered, while one still
// waiting to be read would lose its facts for good.
const alreadyReadFirst = (a, b) => (isGroundedSnapshot(b) - isGroundedSnapshot(a)) || byFetchedAtThenId(a, b);

// How many item keys the de-dupe memory carries. Each grounded item files two
// (its source id and its content key), so this remembers roughly a thousand
// articles — many times the item window itself, which is the point: the window
// forgets an article as soon as newer ones crowd it out, and without this the
// next poll would read that same article as brand new.
const SEEN_ITEM_KEY_CAP = 2000;

const seenEntries = (seen) => (Array.isArray(seen) ? seen : []);

/** Every key `snapshots` and `seen` between them name, newest first and capped
 *  — an entry's `at` is the snapshot's own fetchedAt, never a fresh clock
 *  reading. Ordered off the entries themselves, so the same items produce the
 *  same memory whatever order they arrived in. */
function rememberItemKeys(seen, snapshots) {
  const atByKey = new Map();
  const remember = (key, at) => {
    if (!key) return;
    const previous = atByKey.get(key);
    atByKey.set(key, previous === undefined ? at : Math.max(previous, at));
  };
  for (const entry of seenEntries(seen)) {
    const at = Number(entry?.at);
    remember(String(entry?.key ?? ""), Number.isFinite(at) ? at : 0);
  }
  for (const snap of snapshots || []) {
    for (const key of newsItemKeys(snap)) remember(key, fetchedAtMs(snap));
  }
  return [...atByKey.entries()]
    .map(([key, at]) => ({ key, at }))
    .sort((a, b) => (b.at - a.at) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, SEEN_ITEM_KEY_CAP);
}

/** Merges `incoming` snapshots into `existing` by item identity: a snapshot
 *  whose id or content key already sits in the window, or in the `seen` memory
 *  of what has been grounded, is neither re-added nor re-ingested. Two
 *  incoming snapshots naming one item collapse to the lower id, so the same
 *  fetch read in two orders admits the same snapshot. The merged list sorts by
 *  fetchedAt then id, so the window is a function of which items are in it
 *  rather than of when each arrived, and `cap` then drops the snapshots that
 *  have already been read before any that still have facts to contribute.
 *  Returns the merged list and the genuinely new snapshots the caller still
 *  needs to ingest. */
function mergeSnapshots(existing, incoming, { cap, seen } = {}) {
  const known = new Set();
  for (const snap of existing || []) for (const key of newsItemKeys(snap)) known.add(key);
  for (const entry of seenEntries(seen)) if (entry?.key) known.add(String(entry.key));

  const claimed = new Set();
  const admitted = new Set();
  for (const snap of [...(incoming || [])].sort(byIdAscending)) {
    const keys = newsItemKeys(snap);
    if (!keys.length) continue;
    if (keys.some((key) => known.has(key) || claimed.has(key))) continue;
    for (const key of keys) claimed.add(key);
    admitted.add(snap);
  }

  const added = (incoming || []).filter((snap) => admitted.has(snap));
  const items = [...(existing || []), ...added].sort(byFetchedAtThenId);
  if (items.length <= cap) return { items, added };
  const dropped = new Set(
    items.slice().sort(alreadyReadFirst).slice(0, items.length - cap).map((snap) => snap.id),
  );
  return { items: items.filter((snap) => !dropped.has(snap.id)), added };
}

/** One source's fetched-but-not-yet-grounded snapshots, oldest first. A cycle
 *  that ran out of time leaves its backlog here, so the next cycle works
 *  through that before anything newer and the same article is never ingested
 *  twice. Ordered off the snapshots' own fields, so two cycles reading the same
 *  state take the same work in the same order. */
function pendingSnapshotsFor(items, sourceId) {
  return (items || [])
    .filter((snap) => snap?.sourceId === sourceId && !isGroundedSnapshot(snap))
    .sort(byFetchedAtThenId);
}

function emptyCycleAccumulator(at) {
  return { at, sentences: 0, recognized: 0, optimisticCount: 0, factsAdded: 0, termsResolved: 0, derived: 0 };
}

/** Polls every enabled contemporary source (config order), skipping any
 *  whose health says wait; ingests every genuinely new snapshot; evicts
 *  news-tagged facts past the configured cap. Never touches a source with no
 *  enabled ids — that reads as "nothing to poll", not a failure. A ctx
 *  carrying `shouldAbort` can stop the cycle between sources or between
 *  articles; what already landed stays, and the result says `aborted`. */
export async function pollNewsSources(ctx) {
  const { memoryDir, store, config, state, providers, now } = ctx;
  const shouldAbort = abortSignalOf(ctx);
  const nowVal = resolveNow(now);
  const enabledIds = normalizeNewsSourceIds(config.sources);
  if (!enabledIds.length) {
    return { fetched: 0, newItems: 0, failures: 0, evicted: 0, facts: 0, derived: 0, aborted: false, sources: [] };
  }
  let aborted = false;

  const recordsById = new Map(newsSourceRecords().map((r) => [r.id, r]));
  const perSource = [];
  let fetched = 0;
  let newItemsTotal = 0;
  let failures = 0;
  let factsTotal = 0;
  let derivedTotal = 0;

  for (const sourceId of enabledIds) {
    if (shouldAbort()) { aborted = true; break; }
    const record = recordsById.get(sourceId);
    const health = findOrCreateHealth(state, sourceId);
    if (!record) { perSource.push({ sourceId, status: "unknown-source" }); continue; }
    if (isBackedOff(health, nowVal)) {
      perSource.push({ sourceId, status: health.autoDisabled ? "auto-disabled" : "backed-off" });
      continue;
    }
    const fetcher = providers?.newsFetchers?.get?.(sourceId);
    if (!fetcher) { perSource.push({ sourceId, status: "no-fetcher" }); continue; }

    let result = null;
    try { result = await fetcher.fetchItems(); } catch { result = null; }
    fetched += 1;
    state.requestLog = [
      { url: record.url, at: nowVal, bytes: result?.bytes ?? 0, status: result === null ? "failed" : (result.notModified ? "not-modified" : "ok") },
      ...(state.requestLog || []),
    ];

    if (result === null) {
      recordFailure(health, config, nowVal);
      failures += 1;
      perSource.push({ sourceId, status: "failed" });
      continue;
    }
    let added = [];
    if (result.notModified) {
      recordSuccess(health, nowVal, "not-modified");
    } else {
      recordSuccess(health, nowVal, "ok");
      // itemCap bounds THIS source's own window: mergeSnapshots sees only
      // sourceId's existing snapshots, so one prolific source's window
      // never crowds out another's before either has been read.
      const ownItems = (state.items || []).filter((snap) => snap?.sourceId === sourceId);
      const otherItems = (state.items || []).filter((snap) => snap?.sourceId !== sourceId);
      const merged = mergeSnapshots(ownItems, result.items, {
        cap: config.itemCap, seen: state.seenItemKeys,
      });
      state.items = [...otherItems, ...merged.items].sort(byFetchedAtThenId);
      added = merged.added;
      newItemsTotal += added.length;
    }

    // Everything this source has fetched and not yet grounded, not just what
    // arrived on this fetch: a source that answers 304 still has a backlog to
    // finish, and an aborted cycle's leftovers would otherwise sit in the state
    // marked known and never be read again.
    const before = emptyCycleAccumulator(nowVal);
    const after = emptyCycleAccumulator(nowVal);
    let grounded = 0;
    for (const snapshot of pendingSnapshotsFor(state.items, sourceId)) {
      if (shouldAbort()) { aborted = true; break; }
      const r = await ingestNewsSnapshot(ctx, snapshot);
      grounded += 1;
      after.sentences += r.sentences;
      after.recognized += r.recognized;
      after.optimisticCount += r.optimisticCount;
      after.factsAdded += r.facts;
      after.derived += r.derived;
      factsTotal += r.facts;
      derivedTotal += r.derived;
    }
    if (grounded) {
      state.metrics = [...(state.metrics || []), cycleMetrics(before, after, { source: sourceId })];
    }
    const pendingLeft = pendingSnapshotsFor(state.items, sourceId).length;
    perSource.push({
      sourceId,
      status: result.notModified ? "not-modified" : "ok",
      newItems: added.length,
      grounded,
      pending: pendingLeft,
    });
    if (aborted) break;
  }

  // Only a GROUNDED snapshot is remembered. One the item cap dropped before it
  // was ever read still has its facts to contribute, so the next poll is meant
  // to pick it up again; one whose facts already landed must never be read a
  // second time, however long ago the window forgot it.
  state.seenItemKeys = rememberItemKeys(
    state.seenItemKeys,
    (state.items || []).filter(isGroundedSnapshot),
  );

  const memory = await store.loadMemory(memoryDir);
  const rows = store.readFactRows(memory);
  const evictIds = evictNewsFacts(rows, { cap: config.newsFactCap });
  if (evictIds.length) {
    await store.removeFacts(memoryDir, evictIds, { retractedAt: nowVal });
    invalidateCache(ctx.cache);
  }

  state.lastPollAt = nowVal;
  return {
    fetched, newItems: newItemsTotal, failures, evicted: evictIds.length,
    facts: factsTotal, derived: derivedTotal, aborted, sources: perSource,
  };
}

// ---------------------------------------------------------------------------
// enrichment
// ---------------------------------------------------------------------------

const KB_SOURCE_TO_RESEARCH_CHOICE = Object.freeze({
  "simple-wikipedia": "simple-wikipedia",
  wikidata: "wikidata",
  wiktionary: "wiktionary",
  "dbpedia-lookup": "dbpedia",
});

const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

const WORD_CHARACTER_RE = /[a-z0-9]/;

/** True when `prose` names `term` as a whole word — the test for whether a
 *  looked-up body is a STATEMENT about the term or merely a LABEL for it.
 *
 *  A reference article's summary opens on the word it defines ("AmigaDOS is
 *  the disk operating system of the AmigaOS"). An entity description field
 *  does not: it is a bare noun phrase naming the class instead ("disk
 *  operating system of the AmigaOS"), and a sentence recognizer reading one
 *  finds a subject, a verb and an object inside the phrase itself — "disk
 *  operates a system of the amigaos", a claim about a word the lookup was
 *  never about. The class such a phrase names is what the structured tier
 *  already carries, so there is nothing to lose by leaving it unread. */
function proseNamesTerm(prose, term) {
  const haystack = normText(prose).toLowerCase();
  const needle = normFactTerm(term);
  if (!haystack || !needle) return false;
  for (let from = 0; ; from += 1) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : haystack[at - 1];
    const after = haystack[at + needle.length] ?? "";
    if (!WORD_CHARACTER_RE.test(before) && !WORD_CHARACTER_RE.test(after)) return true;
    from = at;
  }
}

/** Every name the looked-up definition is ABOUT: the term that was asked and
 *  the title the source answered with ("solar eclipse" and "Solar eclipse",
 *  "u.s. virgin islands" and "United States Virgin Islands"), each with its
 *  plural, since a body says "Solar eclipses can only happen during a new
 *  moon" as readily as it says "a solar eclipse". */
function definedTermKeys(term, article) {
  const keys = new Set();
  for (const name of [term, article?.term, article?.title]) {
    const key = normFactTerm(name ?? "");
    if (!key) continue;
    keys.add(key);
    keys.add(normFactTerm(pluralOf(key)));
  }
  return keys;
}

const SENTENCE_WORD_RE = /[a-z0-9][a-z0-9'’-]*/g;

const COPULAS = new Set(["is", "are", "was", "were", "be", "been", "being"]);

// Words that mean the copula opened something other than the term's class:
// a clause ("an earthquake is WHEN tectonic plates shake"), a denial ("Puerto
// Rico is NOT an independent country"), a second phrase ("is one OF the...")
// or a list ("is a state AND a...").
const CLASS_PHRASE_BREAKERS = new Set([
  "not", "no", "never", "n't", "nor",
  "when", "where", "while", "why", "how", "who", "whom", "whose", "which", "that",
  "what", "because", "if", "whether", "unless", "until", "since", "though", "although",
  "of", "in", "on", "at", "from", "with", "by", "to", "for", "about", "into", "onto",
  "over", "under", "between", "among", "during", "near", "across", "through", "against",
  "and", "or", "but",
]);

/** True when `sentence` states `object` as the class the copula introduces —
 *  the test for whether a class claim read out of a definition body is what
 *  the body actually says the term is.
 *
 *  The optimistic tier answers with a class it found somewhere in the
 *  sentence, which is right when the sentence is a definition ("A tsunami is
 *  a natural disaster" -> disaster) and wrong the moment the copula opens
 *  anything else. "An earthquake is when Earth's tectonic plates shake"
 *  yields "an earthquake is an earth"; "Puerto Rico is not an independent
 *  country" yields the exact claim the sentence denies. So the class has to
 *  sit inside the noun phrase the copula introduces: only determiners,
 *  numbers and adjectives may stand between them, never a clause, a
 *  preposition, a conjunction or a negation. A body that states its class
 *  some other way keeps it to itself, which costs a fact and never a wrong
 *  one. */
function bodyStatesClass(sentence, object) {
  const words = String(sentence ?? "").toLowerCase().match(SENTENCE_WORD_RE) || [];
  const head = (normFactTerm(object).match(SENTENCE_WORD_RE) || [])[0];
  if (!head || !words.length) return false;
  const plural = pluralOf(head);
  const namesHead = (word) => {
    const bare = word.replace(/['’]s$/, "");
    return bare === head || bare === plural || pluralOf(bare) === head;
  };
  for (let at = 0; at < words.length; at += 1) {
    if (!namesHead(words[at])) continue;
    for (let back = at - 1; back >= 0; back -= 1) {
      if (CLASS_PHRASE_BREAKERS.has(words[back])) break;
      if (COPULAS.has(words[back])) return true;
    }
  }
  return false;
}

/** The rows a definition body is allowed to give up: those about the term it
 *  defines, and — for a class claim — those the body states as that term's
 *  class. A body is evidence about its own subject, so a row whose subject is
 *  some other term the prose merely mentions ("Every year there are about two
 *  solar eclipses" -> a year is a kind of eclipse; "The Calpine Corporation
 *  operates and owns 19 of the 22 facilities" -> a corporation owns a
 *  facility) is not a definition of anything and is dropped. */
function factsDefinitionBodyStates(rows, termKeys) {
  return rows.filter((row) => {
    if (!termKeys.has(normFactTerm(row.subject))) return false;
    if (!ISA_PREDICATES.has(row.predicate)) return true;
    return bodyStatesClass(row.sentence, row.object);
  });
}

const provenanceHead = (tag) => String(tag ?? "").split(/[\s@]/)[0];

const tripleKeyOf = (row) => `${normFactTerm(row.subject)}\0${normFactPredicate(row.predicate)}\0${normFactTerm(row.object)}`;

/** Retracts rows this call's ingest wrote and the definition-body rule then
 *  turned down. ingestText has already stored them by the time their rows
 *  come back, so they are matched by triple under this ingest's own
 *  provenance and removed — the same retract-after-write path the recognizer
 *  takes for a fragment term. */
async function retractRejectedBodyFacts(ctx, rejected, provenance) {
  const { memoryDir, store, now } = ctx;
  if (!rejected.length) return;
  const keys = new Set(rejected.map(tripleKeyOf));
  const rows = store.readFactRows(await store.loadMemory(memoryDir));
  const ids = rows
    .filter((row) => keys.has(tripleKeyOf(row)) && provenanceHead(row.provenance).endsWith(provenanceHead(provenance)))
    .map((row) => row.id);
  if (!ids.length) return;
  await store.removeFacts(memoryDir, ids, { retractedAt: resolveNow(now) });
  invalidateCache(ctx.cache);
}

/** Grounds `article` under `provider`'s own provenance tag, through the SAME
 *  ingest seam a polled article takes: the structured or isa facts the
 *  research-source seam licenses (researchFacts), then the article's own
 *  prose through ingestText's strict recognizer plus optimistic tier. A
 *  looked-up article therefore reaches the graph with the density of
 *  relations a polled one does, and the feed's paraphrase templates have the
 *  same kind of material to write a card from — a bare isa edge left the
 *  reader with one bald sentence where a polled item got a paragraph.
 *
 *  Two things a definition body is not allowed to do, both of them ways of
 *  restating the lookup's own class claim worse than the lookup already
 *  stated it. It is not read at all unless it names the term (proseNamesTerm,
 *  above). And where the lookup already licensed a class for the term, the
 *  body is read by the strict recognizer only: the optimistic tier's guess at
 *  a class can then only agree with what the structured rows say or truncate
 *  it — "AmigaDOS is the disk operating system" mints "amigados is a disk"
 *  beside the structured "amigados is a disk operating system" — while the
 *  relations the body states ("Rottnest has a lighthouse") are the strict
 *  tier's own work and survive either way.
 *
 *  What the body does give up is then held to what it says about the term it
 *  defines (factsDefinitionBodyStates): a row about some other term the prose
 *  mentions, or a class the sentence never states, is retracted before it can
 *  reach the feed or a syllogism. */
async function ingestResearchArticle(ctx, term, provider, article) {
  const { memoryDir, store, config, lexicon, now } = ctx;
  const provenance = provider.provenanceTag(term);
  const structured = researchFacts(provider, term, article);
  if (structured.length) {
    await store.appendFacts(memoryDir, structured);
    invalidateCache(ctx.cache);
  }
  const lookupStatedClass = structured.some(
    (f) => ISA_PREDICATES.has(f.predicate) && normFactTerm(f.subject) === normFactTerm(term),
  );

  const prose = String(article.summary || article.text || "").trim();
  let fromBody = [];
  if (prose && proseNamesTerm(prose, term)) {
    const ingested = await ingestText(prose, {
      memoryDir, sourceTag: provenance, optimistic: !lookupStatedClass,
      lexicon: lexicon || loadLexicon(), observedAt: resolveNow(now), findings: true,
      attributeToSource: true,
    });
    invalidateCache(ctx.cache);
    const read = [...ingested.extracted, ...ingested.optimistic];
    fromBody = factsDefinitionBodyStates(read, definedTermKeys(term, article));
    await retractRejectedBodyFacts(ctx, read.filter((row) => !fromBody.includes(row)), provenance);
  }

  const facts = [...structured, ...fromBody];
  if (!facts.length) return { facts: 0, derived: 0 };
  const distinct = new Set(facts.map(
    (f) => `${normFactTerm(f.subject)}\0${normFactPredicate(f.predicate)}\0${normFactTerm(f.object)}`,
  ));
  let derived = 0;
  if (config.syllogismsPerIngest > 0) {
    const focus = [...termFocusOf(facts)];
    const res = await syllogise(memoryDir, { focus, expandFocus: true, budget: config.syllogismsPerIngest, store });
    derived = res?.count || 0;
  }
  return { facts: distinct.size, derived };
}

/** One KB lookup behind its source's circuit breaker. A source that has been
 *  timing out or throttling is skipped without a round trip, and the skip is
 *  reported so the cycle can tell "this source had nothing" from "this source
 *  was never asked". The negative cache catches the first; the breaker
 *  catches the second, and neither ever stands in for the other. */
async function lookupThroughBreaker(ctx, provider, sourceId, term, skipped) {
  const source = String(provider?.name || sourceId);
  const systemicFailuresOf = typeof provider?.stats === "function"
    ? () => provider.stats().systemicFailures ?? 0
    : null;
  let asked = false;
  const article = await throughSourceBreaker(source, async () => {
    asked = true;
    try { provider.beginTurn?.(); } catch { /* an older provider has no budget */ }
    try { return await provider.lookup(term); } catch { return null; }
  }, {
    registry: ctx?.sourceBreakers ?? undefined,
    skipped,
    label: provider?.label,
    systemicFailuresOf,
  });
  return { article, asked };
}

/** Takes the top `limit` pending (negative-cache-expired) terms and walks
 *  the enabled KB sources in config order for each; first lookup hit wins.
 *  A grounded term is marked "grounded" and folded into one
 *  reprocessAfterGrounding pass over every term this cycle grounded; an
 *  all-null term enters the negative cache. A term whose sources were all
 *  skipped goes back to pending instead: nothing asked it, so nothing knows
 *  it is missing. */
export async function enrichTopTerms(ctx, { limit } = {}) {
  const { memoryDir, store, state, providers, config, now } = ctx;
  const shouldAbort = abortSignalOf(ctx);
  const nowVal = resolveNow(now);
  const cap = Number.isFinite(limit) ? limit : config.enrichTermsPerCycle;

  const ledger = ledgerFromPayload(state.ledger);
  const candidates = rankedTerms(ledger, {
    limit: cap, status: "pending", now: nowVal, ttlMs: config.negativeCacheTtlHours * 3600000,
  });

  const enriched = [];
  const missed = [];
  const skippedSources = new Set();
  let factsTotal = 0;
  let derivedTotal = 0;
  let aborted = false;

  for (const entry of candidates) {
    if (shouldAbort()) { aborted = true; break; }
    markTerm(ledger, entry.term, "enriching", nowVal);
    let hit = null;
    let askedAnySource = false;
    for (const sourceId of config.kbSources) {
      if (shouldAbort()) { aborted = true; break; }
      const choice = KB_SOURCE_TO_RESEARCH_CHOICE[sourceId];
      if (!choice || typeof providers?.getResearchProvider !== "function") continue;
      const provider = providers.getResearchProvider({ source: choice });
      if (!provider) continue;
      const { article, asked } = await lookupThroughBreaker(ctx, provider, sourceId, entry.term, skippedSources);
      if (asked) askedAnySource = true;
      if (article) { hit = { provider, article }; break; }
    }
    // A stop mid-lookup is not a verdict on the term: it goes back to
    // pending so the next cycle picks it up, never into the negative cache.
    if (aborted) { markTerm(ledger, entry.term, "pending", nowVal); break; }
    if (!hit) {
      // No source was asked, so nothing learned this term is missing —
      // the same posture a stop takes, for the same reason.
      markTerm(ledger, entry.term, askedAnySource ? "missed" : "pending", nowVal);
      if (askedAnySource) missed.push(entry.term);
      continue;
    }
    const res = await ingestResearchArticle(ctx, entry.term, hit.provider, hit.article);
    factsTotal += res.facts;
    derivedTotal += res.derived;
    markTerm(ledger, entry.term, "grounded", nowVal);
    enriched.push(entry.term);
  }
  state.ledger = ledgerPayload(ledger);

  const reprocessResult = enriched.length
    ? await reprocessAfterGrounding(ctx, enriched)
    : { facts: 0, derived: 0, flipped: [] };

  const before = emptyCycleAccumulator(nowVal);
  const after = emptyCycleAccumulator(nowVal);
  after.termsResolved = enriched.length;
  after.factsAdded = factsTotal + reprocessResult.facts;
  after.derived = derivedTotal + reprocessResult.derived;
  if (candidates.length) {
    state.metrics = [...(state.metrics || []), cycleMetrics(before, after, { source: "enrich" })];
  }
  state.lastEnrichAt = nowVal;

  return {
    enriched, missed, aborted,
    skippedSources: [...skippedSources].sort(),
    facts: factsTotal + reprocessResult.facts,
    derived: derivedTotal + reprocessResult.derived,
  };
}

// ---------------------------------------------------------------------------
// feed
// ---------------------------------------------------------------------------

/** Reads the current fact rows and builds the feed: every hub that passes
 *  the newsworthiness gate's test E or test A (PLAN_NEWSWORTHINESS.md
 *  section 2), nothing else. A seed-only graph — or any graph where no
 *  reported row anchors anything new — answers `items: []`; the page renders
 *  its own designed empty state for that case rather than falling back to
 *  concept cards off the whole graph. `seedFallback` stays in the shape at
 *  `false` for one release so an existing consumer does not break.
 *
 *  `newName` is a display-only badge (never a gate): true when the lexicon
 *  has no everyday-noun reading for the hub, computed here rather than in
 *  buildNewsItems because the domain layer carries no lexicon.
 *
 *  `articleEntityNames` is wired in for the same reason: reading the entity
 *  names out of a card's own article text takes the lexicon and the wink
 *  tagger, so the domain asks for them through a seam and this layer answers
 *  with the capture the enrichment queue already uses. It is what puts a
 *  definition and the card that needed it on the same page — a lookup on
 *  "amigados" reaches a card whose only fact is that a site discussed the
 *  headline the name sits inside. */
export async function buildFeed(ctx) {
  const { memoryDir, store, config, state, now, lexicon } = ctx;
  const nowVal = resolveNow(now);
  const memory = await store.loadMemory(memoryDir);
  const rows = store.readFactRows(memory);
  const sourcesByFactId = buildSourcesByFactId(state.items);
  const windowMs = config.windowHours * 3600000;

  const lex = lexicon || loadLexicon();
  const items = buildNewsItems(rows, {
    now: nowVal,
    windowMs,
    limit: config.itemCap,
    sourcesByFactId,
    readsAsEntityTerm,
    articleEntityNames: (texts) => articleEntityNames(texts, { lexicon: lex }),
  }).map((item) => ({ ...item, newName: !isVocabGroundedTerm(lex, item.hub) }));
  return { items, seedFallback: false, builtAt: nowVal };
}

// ---------------------------------------------------------------------------
// uploaded facts (10.2, provenance table 6.5)
// ---------------------------------------------------------------------------

const UPLOAD_PROVENANCE_CEILING = SOURCE_PRIOR.teach;

/** Validate-and-downgrade: a row whose stated provenance sits above the
 *  teach tier (only "operator" does) is re-tagged `teach:upload:<fileLabel>
 *  @<now>`; every other row — at or below teach, or unparseable — keeps its
 *  stated provenance. Pure; the caller appends the returned rows itself. */
export function ingestUploadedFactRows(rows, { fileLabel, now } = {}) {
  const tag = `teach:upload:${fileLabel}@${resolveNow(now)}`;
  return (rows || []).map((row) => {
    const source = provenanceTagToSource(row?.provenance);
    const prior = source?.kind ? (SOURCE_PRIOR[source.kind] ?? 0) : 0;
    if (source?.kind && prior <= UPLOAD_PROVENANCE_CEILING) return { ...row };
    return { ...row, provenance: tag };
  });
}

// ---------------------------------------------------------------------------
// rendering / newsTurn
// ---------------------------------------------------------------------------

const NEWS_USAGE = "usage: /news [poll|rank|enrich|sources|add <url>|interval <minutes>]";

function pluralize(n, word) {
  return `${n} ${n === 1 ? word : pluralOf(word)}`;
}

function renderFeedText(feed, focus) {
  let items = feed.items;
  if (focus) {
    const key = normFactTerm(focus);
    items = items.filter((it) => it.hub === key);
  }
  if (!items.length) return "no news items yet — poll a source or teach something first.";
  return items
    .map((it, i) => {
      const seedTag = feed.seedFallback ? " (from the seed graph — start to poll live sources)" : "";
      const sourceNames = it.sources.map((s) => s.title || s.url).filter(Boolean);
      const sourcesText = sourceNames.length ? ` sources: ${sourceNames.join(", ")}` : "";
      const backgroundText = it.backgroundParagraph ? ` what the graph already knew: ${it.backgroundParagraph}` : "";
      // The report the card was built from, quoted, so a reader can check the
      // graph's own sentences against what the source actually filed.
      const filed = it.sources
        .map((s) => [s.title, s.summary].filter(Boolean).join(" — "))
        .filter(Boolean);
      const filedText = filed.length ? ` as filed: "${filed[0]}"` : "";
      return `${i + 1}. ${it.paragraph} (${it.tier || "unranked"})${filedText}${sourcesText}${seedTag}${backgroundText}`;
    })
    .join("\n");
}

async function renderRankText(ctx) {
  const nowVal = resolveNow(ctx.now);
  const ledger = ledgerFromPayload(ctx.state.ledger);
  const raw = rankedTerms(ledger, { limit: 20 * RANK_OVERFETCH, now: nowVal, ttlMs: ctx.config.negativeCacheTtlHours * 3600000 });
  const memory = await ctx.store.loadMemory(ctx.memoryDir);
  const rows = ctx.store.readFactRows(memory);
  const entries = filterRankedTermEntries(rows, raw).slice(0, 20);
  if (!entries.length) return "no fact-ungrounded terms yet — poll a source or teach something first.";
  return entries
    .map((e, i) => `${i + 1}. ${e.term} (${e.count}) — ${e.vocabGrounded ? "parseable but knowledge-free" : "unknown word"}`)
    .join("\n");
}

function renderSourcesText(ctx) {
  const enabled = new Set(ctx.config.sources);
  const records = newsSourceRecords().filter((r) => r.kind === "contemporary");
  return records
    .map((r) => {
      const health = (ctx.state.health || []).find((h) => h.sourceId === r.id);
      let status;
      if (!enabled.has(r.id)) status = "off";
      else if (health?.autoDisabled) status = "auto-disabled";
      else if (health?.browserBlocked) status = "source does not permit browser access";
      else status = health?.lastStatus || "not yet polled";
      return `${r.name} (${r.id}): ${status}`;
    })
    .join("\n");
}

const STOPPED_SUFFIX = " stopped before the rest.";

function renderPollResult(result) {
  if (!result.sources.length && !result.aborted) return { text: "no sources enabled — nothing to poll.", miss: true };
  const text = `polled ${pluralize(result.fetched, "source")}: ${pluralize(result.newItems, "new item")}, `
    + `${pluralize(result.facts, "fact")} stored, ${result.derived} derived, `
    + `${pluralize(result.failures, "failure")}, ${result.evicted} evicted.`
    + (result.aborted ? STOPPED_SUFFIX : "");
  return { text, miss: false };
}

function renderEnrichResult(result) {
  const enrichedText = result.enriched.length ? ` (${result.enriched.join(", ")})` : "";
  const missedText = result.missed.length ? ` (${result.missed.join(", ")})` : "";
  const skipped = result.skippedSources || [];
  const text = `enriched ${pluralize(result.enriched.length, "term")}${enrichedText}; `
    + `${pluralize(result.missed.length, "miss")}${missedText}; `
    + `${pluralize(result.facts, "fact")} stored, ${result.derived} derived.`
    + (result.aborted ? STOPPED_SUFFIX : "")
    + (skipped.length ? ` ${sourceSkipStatusLine(skipped)}` : "");
  return { text, miss: !result.enriched.length && !result.missed.length && !result.aborted && !skipped.length };
}

async function handleAddSource(ctx, url) {
  const preflight = ctx.providers?.preflightNewsUrl;
  if (typeof preflight !== "function") {
    return { text: "adding a source by url needs a preflight check this session has no way to run.", miss: true };
  }
  const result = await preflight(url);
  if (!result.ok) {
    const reason = result.reason === "browser-blocked" ? "source does not permit browser access"
      : result.reason === "not-https" ? "only https sources are supported"
        : "no readable feed found at that url";
    return { text: `couldn't add ${url}: ${reason}.`, miss: true };
  }
  const id = `custom:${normFactTerm(url)}`;
  registerNewsSource({
    id, name: url, kind: "contemporary", format: result.format, url, homepage: url,
    licence: "unknown", browserVerified: "", minIntervalMs: DEFAULT_MIN_INTERVAL_MS, enabledByDefault: false,
  });
  ctx.config.sources = normalizeNewsSourceIds([...ctx.config.sources, id]);
  return { text: `added ${url} as a ${result.format} source.`, miss: false };
}

function handleInterval(ctx, minutes) {
  ctx.config.pollMinutes = clampPollMinutes(minutes);
  return { text: `poll interval set to ${ctx.config.pollMinutes} minute${ctx.config.pollMinutes === 1 ? "" : "s"}.`, miss: false };
}

/** parseNewsRequest -> the matching engine call -> a rendered text block.
 *  Every surface renders through this one function, so wording stays
 *  identical everywhere it appears. */
export async function newsTurn(line, ctx) {
  const req = parseNewsRequest(line);
  if (!req) return null;

  if (req.kind === "show") {
    const feed = await buildFeed(ctx);
    return { text: renderFeedText(feed, req.focus), miss: false, goal: "surface the news feed built over this graph" };
  }
  if (req.kind === "poll") {
    if (!ctx.config.sources.length) return { text: "no sources enabled — nothing to poll.", miss: true };
    return renderPollResult(await pollNewsSources(ctx));
  }
  if (req.kind === "rank") return { text: await renderRankText(ctx), miss: false };
  if (req.kind === "enrich") return renderEnrichResult(await enrichTopTerms(ctx));
  if (req.kind === "sources") return { text: renderSourcesText(ctx), miss: false };
  if (req.kind === "add") return handleAddSource(ctx, req.url);
  if (req.kind === "interval") return handleInterval(ctx, req.minutes);
  return { text: NEWS_USAGE, miss: true };
}

// ---------------------------------------------------------------------------
// metrics (10.2, the section 16 rig's six numbers)
// ---------------------------------------------------------------------------

/** The rig row: grounding rate (strict and optimistic, two separate
 *  columns, never merged), facts added, terms resolved and derivations, from
 *  two cycle accumulators — pure, no clock read here. */
export function cycleMetrics(before, after, { source } = {}) {
  const sentences = (after.sentences || 0) - (before.sentences || 0);
  const recognized = (after.recognized || 0) - (before.recognized || 0);
  const optimisticCount = (after.optimisticCount || 0) - (before.optimisticCount || 0);
  const factsAdded = (after.factsAdded || 0) - (before.factsAdded || 0);
  const termsResolved = (after.termsResolved || 0) - (before.termsResolved || 0);
  const derived = (after.derived || 0) - (before.derived || 0);
  return {
    at: after.at ?? before.at ?? "",
    sourceId: source ?? "",
    sentences,
    groundedRateStrict: sentences > 0 ? recognized / sentences : 0,
    groundedRateOptimistic: sentences > 0 ? (recognized + optimisticCount) / sentences : 0,
    factsAdded,
    termsResolved,
    derived,
  };
}

// ---------------------------------------------------------------------------
// a fresh, empty state — a small companion to news-store.mjs's persisted
// shape, for a surface (or a test) starting a session with nothing yet.
// ---------------------------------------------------------------------------

export function createNewsState() {
  return {
    items: [], seenItemKeys: [], ledger: ledgerPayload(createTermLedger()), health: [],
    requestLog: [], metrics: [], lastPollAt: "", lastEnrichAt: "",
  };
}
