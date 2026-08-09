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
//   state      the news-store shape (news-store.mjs): { items, ledger
//              (ledgerPayload form), health, requestLog, metrics, lastPollAt,
//              lastEnrichAt } — always JSON-plain; a live term ledger is
//              built from state.ledger via ledgerFromPayload only for the
//              span of one call, then folded back with ledgerPayload.
//   providers  { newsFetchers: Map<sourceId, { id, fetchItems }>,
//              getResearchProvider({ source }), preflightNewsUrl?(url) } —
//              every fetcher and provider this session may call, already
//              constructed (adapters own I/O construction, never this
//              module).
//   now        a function returning the caller's clock reading (ISO string
//              or ms), or a fixed reading directly. Never read from here —
//              the wall clock enters only through this parameter.
//   notify     an optional, failure-tolerated status hook.
//
// Determinism: given the same fetched payloads and the same `now`, the same
// facts land and the same feed renders, byte for byte (PLAN_NEWS_FEED.md
// section 3). Network lives in the adapters this module is handed, never
// inside it.

import { normFactTerm, normFactPredicate, factIdFor, sha256Bytes } from "../domain/hash.mjs";
import {
  newsWindowRows, scoreHubs, subgraphAround, buildTermAdjacency, renderNewsParagraph, buildNewsItems, evictNewsFacts,
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
import { ingestText, optimisticTriples } from "./extract-facts.mjs";
import { splitSentences } from "./sentences.mjs";

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

// A feed title rarely carries its own terminal punctuation ("Scientists
// Discover New Species"); a fixture built from a full sentence ("A module is
// a component.") already does. Joining unconditionally with ". " doubles the
// period in the second case and corrupts sentence splitting downstream — so
// the separator is a bare space when the title already ends the sentence.
const SENTENCE_END_RE = /[.!?]["')\]]*$/;
function joinTitleAndSummary(title, summary) {
  const t = String(title || "").trim();
  const s = String(summary || "").trim();
  if (!t) return s;
  if (!s) return t;
  return `${t}${SENTENCE_END_RE.test(t) ? " " : ". "}${s}`;
}

function sha256HexPrefix(str, nBytes) {
  const bytes = sha256Bytes(str);
  let hex = "";
  for (let i = 0; i < nBytes; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function toMs(value) {
  if (typeof value === "number") return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function tierOfRows(rows) {
  if (!rows.length) return "";
  let strongest = rows[0];
  for (const row of rows) {
    if (Number(row.trust ?? 0) > Number(strongest.trust ?? 0)) strongest = row;
  }
  const kinds = Array.isArray(strongest.sourceTypes) ? strongest.sourceTypes : [];
  return kinds[0] || "";
}

function collectItemSources(subgraphRows, sourcesByFactId) {
  const seen = new Set();
  const sources = [];
  for (const row of subgraphRows) {
    const src = sourcesByFactId.get(row.id);
    if (!src) continue;
    const key = src.url || src.title || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push({ title: src.title || "", url: src.url || "", name: src.name || "" });
  }
  return sources;
}

/** The item-assembly buildNewsItems runs internally, exposed here so
 *  buildFeed's seed-only fallback (S1: score hubs over the WHOLE graph, not
 *  just news/research-tagged rows) can reuse the same shape without widening
 *  buildNewsItems's own, already-pinned window contract. */
function assembleNewsItems(rows, windowRows, { now, limit, sourcesByFactId }) {
  const hubs = scoreHubs(rows, windowRows, { limit });
  const adjacency = buildTermAdjacency(rows);
  const items = hubs.map(({ term, changed }) => {
    const subgraphRows = subgraphAround(rows, term, { adjacency });
    const factIds = subgraphRows.map((r) => r.id).sort();
    return {
      id: `news-feed:${sha256HexPrefix(`${term}\0${factIds.join(",")}`, 8)}`,
      hub: term,
      factIds,
      changedCount: changed,
      builtAt: now,
      paragraph: renderNewsParagraph(term, subgraphRows),
      tier: tierOfRows(subgraphRows),
      sources: collectItemSources(subgraphRows, sourcesByFactId),
    };
  });
  return items.sort((a, b) => (toMs(b.builtAt) - toMs(a.builtAt)) || byId(a, b));
}

function buildSourcesByFactId(items) {
  const map = new Map();
  const recordsById = new Map(newsSourceRecords().map((r) => [r.id, r]));
  for (const snap of items || []) {
    const record = recordsById.get(snap.sourceId);
    const src = { title: snap.title || "", url: snap.url || "", name: record?.name || snap.sourceId || "" };
    for (const factId of snap.factIds || []) map.set(factId, src);
  }
  return map;
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
  const result = await ingestText(text, { memoryDir, sourceTag, optimistic: true, lexicon: lex });
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
  const terms = [...new Set((groundedTerms || []).map((t) => normFactTerm(t)).filter(Boolean))];
  if (!terms.length) return { facts: 0, derived: 0, flipped: [] };

  const touched = (state.items || []).filter((snap) => snapshotMentionsAny(snap, terms));
  let factsTotal = 0;
  const allNewFacts = [];
  for (const snap of touched) {
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

/** Merges `incoming` snapshots into `existing` by id (an already-seen id is
 *  never re-added or re-ingested), then enforces `cap` by dropping the
 *  oldest-by-fetchedAt entries. Returns the merged list and the genuinely
 *  new snapshots the caller still needs to ingest. */
function mergeSnapshotsById(existing, incoming, cap) {
  const byIdMap = new Map((existing || []).map((s) => [s.id, s]));
  const added = [];
  for (const snap of incoming || []) {
    if (byIdMap.has(snap.id)) continue;
    byIdMap.set(snap.id, snap);
    added.push(snap);
  }
  let items = [...byIdMap.values()];
  if (items.length > cap) {
    items = items
      .slice()
      .sort((a, b) => (toMs(a.fetchedAt) - toMs(b.fetchedAt)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(items.length - cap);
  }
  return { items, added };
}

function emptyCycleAccumulator(at) {
  return { at, sentences: 0, recognized: 0, optimisticCount: 0, factsAdded: 0, termsResolved: 0, derived: 0 };
}

/** Polls every enabled contemporary source (config order), skipping any
 *  whose health says wait; ingests every genuinely new snapshot; evicts
 *  news-tagged facts past the configured cap. Never touches a source with no
 *  enabled ids — that reads as "nothing to poll", not a failure. */
export async function pollNewsSources(ctx) {
  const { memoryDir, store, config, state, providers, now } = ctx;
  const nowVal = resolveNow(now);
  const enabledIds = normalizeNewsSourceIds(config.sources);
  if (!enabledIds.length) {
    return { fetched: 0, newItems: 0, failures: 0, evicted: 0, facts: 0, derived: 0, sources: [] };
  }

  const recordsById = new Map(newsSourceRecords().map((r) => [r.id, r]));
  const perSource = [];
  let fetched = 0;
  let newItemsTotal = 0;
  let failures = 0;
  let factsTotal = 0;
  let derivedTotal = 0;

  for (const sourceId of enabledIds) {
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
    if (result.notModified) {
      recordSuccess(health, nowVal, "not-modified");
      perSource.push({ sourceId, status: "not-modified" });
      continue;
    }
    recordSuccess(health, nowVal, "ok");
    const { items: mergedItems, added } = mergeSnapshotsById(state.items, result.items, config.itemCap);
    state.items = mergedItems;
    newItemsTotal += added.length;

    const before = emptyCycleAccumulator(nowVal);
    const after = emptyCycleAccumulator(nowVal);
    for (const snapshot of added) {
      const r = await ingestNewsSnapshot(ctx, snapshot);
      after.sentences += r.sentences;
      after.recognized += r.recognized;
      after.optimisticCount += r.optimisticCount;
      after.factsAdded += r.facts;
      after.derived += r.derived;
      factsTotal += r.facts;
      derivedTotal += r.derived;
    }
    if (added.length) {
      state.metrics = [...(state.metrics || []), cycleMetrics(before, after, { source: sourceId })];
    }
    perSource.push({ sourceId, status: "ok", newItems: added.length });
  }

  const memory = await store.loadMemory(memoryDir);
  const rows = store.readFactRows(memory);
  const evictIds = evictNewsFacts(rows, { cap: config.newsFactCap });
  if (evictIds.length) {
    await store.removeFacts(memoryDir, evictIds, { retractedAt: nowVal });
    invalidateCache(ctx.cache);
  }

  state.lastPollAt = nowVal;
  return { fetched, newItems: newItemsTotal, failures, evicted: evictIds.length, facts: factsTotal, derived: derivedTotal, sources: perSource };
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

/** Grounds `article` under `provider`'s own provenance tag: the structured
 *  or isa facts the research-source seam licenses (researchFacts), plus the
 *  optimistic tier's read of the summary — the same two-tier posture
 *  chat.mjs's own reference-article ingest takes, reached here through the
 *  shared seam instead of a duplicated private function. */
async function ingestResearchArticle(ctx, term, provider, article) {
  const { memoryDir, store, config, lexicon } = ctx;
  const provenance = provider.provenanceTag(term);
  const facts = researchFacts(provider, term, article);
  const seen = new Set(facts.map((f) => `${f.subject}\0${f.predicate}\0${f.object}`));
  for (const sentence of splitSentences(article.summary || article.text || "")) {
    for (const t of optimisticTriples(sentence, { lexicon: lexicon ?? undefined })) {
      if (!t.subject || !t.object || t.subject === t.object) continue;
      const key = `${t.subject}\0${t.predicate}\0${t.object}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ subject: t.subject, predicate: t.predicate, object: t.object, provenance });
    }
  }
  if (!facts.length) return { facts: 0, derived: 0 };
  await store.appendFacts(memoryDir, facts);
  invalidateCache(ctx.cache);
  let derived = 0;
  if (config.syllogismsPerIngest > 0) {
    const focus = [...termFocusOf(facts)];
    const res = await syllogise(memoryDir, { focus, expandFocus: true, budget: config.syllogismsPerIngest, store });
    derived = res?.count || 0;
  }
  return { facts: facts.length, derived };
}

/** Takes the top `limit` pending (negative-cache-expired) terms and walks
 *  the enabled KB sources in config order for each; first lookup hit wins.
 *  A grounded term is marked "grounded" and folded into one
 *  reprocessAfterGrounding pass over every term this cycle grounded; an
 *  all-null term enters the negative cache. */
export async function enrichTopTerms(ctx, { limit } = {}) {
  const { memoryDir, store, state, providers, config, now } = ctx;
  const nowVal = resolveNow(now);
  const cap = Number.isFinite(limit) ? limit : config.enrichTermsPerCycle;

  const ledger = ledgerFromPayload(state.ledger);
  const candidates = rankedTerms(ledger, {
    limit: cap, status: "pending", now: nowVal, ttlMs: config.negativeCacheTtlHours * 3600000,
  });

  const enriched = [];
  const missed = [];
  let factsTotal = 0;
  let derivedTotal = 0;

  for (const entry of candidates) {
    markTerm(ledger, entry.term, "enriching", nowVal);
    let hit = null;
    for (const sourceId of config.kbSources) {
      const choice = KB_SOURCE_TO_RESEARCH_CHOICE[sourceId];
      if (!choice || typeof providers?.getResearchProvider !== "function") continue;
      const provider = providers.getResearchProvider({ source: choice });
      if (!provider) continue;
      let article = null;
      try { article = await provider.lookup(entry.term); } catch { article = null; }
      if (article) { hit = { provider, article }; break; }
    }
    if (!hit) {
      markTerm(ledger, entry.term, "missed", nowVal);
      missed.push(entry.term);
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
    enriched, missed,
    facts: factsTotal + reprocessResult.facts,
    derived: derivedTotal + reprocessResult.derived,
  };
}

// ---------------------------------------------------------------------------
// feed
// ---------------------------------------------------------------------------

/** Reads the current fact rows and builds the feed. On a seed-only graph
 *  (nothing news/research-tagged yet) scoreHubs falls back to whole-graph
 *  degree so the first paint is never empty — the caller renders every item
 *  in that state with the seed label until pollNewsSources runs once. */
export async function buildFeed(ctx) {
  const { memoryDir, store, config, state, now } = ctx;
  const nowVal = resolveNow(now);
  const memory = await store.loadMemory(memoryDir);
  const rows = store.readFactRows(memory);
  const sourcesByFactId = buildSourcesByFactId(state.items);
  const windowMs = config.windowHours * 3600000;

  let items = buildNewsItems(rows, { now: nowVal, windowMs, limit: config.itemCap, sourcesByFactId });
  let seedFallback = false;
  if (!items.length) {
    items = assembleNewsItems(rows, rows, { now: nowVal, limit: config.itemCap, sourcesByFactId });
    seedFallback = items.length > 0;
  }
  return { items, seedFallback, builtAt: nowVal };
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
      return `${i + 1}. ${it.paragraph} (${it.tier || "unranked"})${sourcesText}${seedTag}`;
    })
    .join("\n");
}

function renderRankText(ctx) {
  const nowVal = resolveNow(ctx.now);
  const ledger = ledgerFromPayload(ctx.state.ledger);
  const entries = rankedTerms(ledger, { limit: 20, now: nowVal, ttlMs: ctx.config.negativeCacheTtlHours * 3600000 });
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

function renderPollResult(result) {
  if (!result.sources.length) return { text: "no sources enabled — nothing to poll.", miss: true };
  const text = `polled ${pluralize(result.fetched, "source")}: ${pluralize(result.newItems, "new item")}, `
    + `${pluralize(result.facts, "fact")} stored, ${result.derived} derived, `
    + `${pluralize(result.failures, "failure")}, ${result.evicted} evicted.`;
  return { text, miss: false };
}

function renderEnrichResult(result) {
  const enrichedText = result.enriched.length ? ` (${result.enriched.join(", ")})` : "";
  const missedText = result.missed.length ? ` (${result.missed.join(", ")})` : "";
  const text = `enriched ${pluralize(result.enriched.length, "term")}${enrichedText}; `
    + `${pluralize(result.missed.length, "miss")}${missedText}; `
    + `${pluralize(result.facts, "fact")} stored, ${result.derived} derived.`;
  return { text, miss: !result.enriched.length && !result.missed.length };
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
  if (req.kind === "rank") return { text: renderRankText(ctx), miss: false };
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
    items: [], ledger: ledgerPayload(createTermLedger()), health: [], requestLog: [], metrics: [],
    lastPollAt: "", lastEnrichAt: "",
  };
}
