// scripts/news-bench/metrics.mjs — PLAN_NEWS_FEED_QUALITY.md section 3's
// eight metrics, computed purely from what one bench run already produced:
// the news state, the fact rows, the built feed and the materialized feed
// document. No I/O, no clock — every timestamp the caller needs is already
// baked into what it hands in here.
//
// Several of section 3's own definitions need a judgment call this module
// makes and records in DEFINITIONS, exported so a report can carry the exact
// wording a later run is compared against.

import { normFactTerm } from "../../src/domain/hash.mjs";
import { isNewsProvenance } from "../../src/domain/news-feed.mjs";
import { ledgerFromPayload } from "../../src/domain/term-ledger.mjs";

// ---------------------------------------------------------------------------
// closed sets — every one of these IS the judgment call for its metric; the
// exact membership is what DEFINITIONS quotes back into the report.
// ---------------------------------------------------------------------------

/** Metric 5: the abstract WordNet-hypernym classes PLAN_NEWS_FEED_QUALITY.md
 *  names as noise (section 5's own list, plus "disapproval" from section 1's
 *  own worked example of the problem — nothing added beyond what the plan
 *  text itself names). */
export const NOISY_HUB_CLASS_TERMS = new Set([
  "cognition", "abstraction", "feeling", "relation", "act", "happening",
  "group", "line", "tune", "arrangement", "disapproval",
]);

/** Metric 7: unit and abbreviation noise, section 1's own named examples
 *  ("km", "m", "ssw", "de", "u.s.") widened to the closed families they
 *  belong to — compass bearings and the metric/imperial units a place-struck
 *  or measurement-bearing sentence tends to leave behind. */
export const RANKED_NOISE_TERMS = new Set([
  "n", "s", "e", "w", "ne", "nw", "se", "sw",
  "nne", "nnw", "sse", "ssw", "ene", "ese", "wnw", "wsw",
  "km", "m", "mi", "ft", "kg", "lb", "lbs", "mph", "kmh", "kph", "cm", "mm", "in", "yd",
  "de", "u.s.", "us", "uk", "usa", "st", "dr", "mr", "mrs", "ms", "vs", "etc", "inc", "co", "ltd", "jr", "sr",
]);

/** Metric 4's gazetteer classifier: an `rdf:type`/`rdfs:subClassOf` object
 *  the seed graph already uses to mark a term as a place or a person. */
export const GAZETTEER_CLASS_TERMS = new Set([
  "place", "person", "city", "country", "location", "nation", "continent",
  "capital", "state", "province", "town", "region",
]);

export const DEFINITIONS = Object.freeze({
  admissionRate:
    "per source: distinct polled items whose snapshot carries >=1 factId after grounding, "
    + "divided by distinct items the source's fetcher returned.",
  groundedTermProportion:
    "per polled item: normalized subject/object terms of the item's own admitted facts, "
    + "divided by that same set unioned with the terms the term-ledger recorded against the "
    + "item's own id (its ungrounded terms) — a micro-average (summed numerators over summed "
    + "denominators) per source and overall, plus the per-item distribution's min/median/max.",
  dedupeRatio:
    "feed cards built, divided by distinct polled items that admitted >=1 fact (the same set "
    + "admissionRate's numerator counts) — a ratio below 1 means several admitted items "
    + "consolidated onto shared hubs. secondPassNewItems/secondPassNewCards re-poll and "
    + "re-build the same fixtures a second time and report what changed; both target zero.",
  entityPreservation:
    "a candidate is a date (ISO, \"Month D, YYYY\" or \"D Month YYYY\") or a capitalized "
    + "1-4 word sequence found in an item's title+summary text, gazetteer-anchored when the "
    + "whole candidate or its text after the last comma normalizes to a term the seed graph "
    + "already classifies as a place or person (GAZETTEER_CLASS_TERMS via rdf:type/"
    + "rdfs:subClassOf). factSurvival counts an anchored candidate whose normalized form "
    + "appears as a subject/object term of one of the item's own admitted facts; "
    + "paragraphSurvival counts one whose literal text appears in a card the item contributed "
    + "facts to. rawCandidateCount (no gazetteer filter) is reported alongside for reference.",
  noisyHubRelationRate:
    "identity-sentence objects (rdf:type/rdfs:subClassOf rows whose subject is the card's own "
    + "hub, drawn from the card's full factIds set) that fall in NOISY_HUB_CLASS_TERMS, "
    + "divided by all such identity objects shown across the feed.",
  paragraphShape:
    "sentencesPerCard: each card's paragraph split on \". \", min/max/mean across the feed. "
    + "repeatedSentenceRate: (sentence occurrences beyond each string's first) / (total "
    + "sentence occurrences), pooled across every card's paragraph. aroundItRepeatRate: of "
    + "cards whose paragraph carries an \"Around it: ...\" clause, the fraction whose clause "
    + "text exactly matches another card's. headlinePresent/linkPresent/datePresent: the share "
    + "of cards whose sources[] entries carry a non-empty title / url / any key named "
    + "publishedAt or date.",
  rankedTermNoise:
    "ranked-terms panel entries whose term falls in RANKED_NOISE_TERMS, divided by the "
    + "panel's own entry count (the same list /news rank renders, top 20).",
  size:
    "newsFactRows/newsFactBytes: fact rows (and their JSON byte size) whose provenance carries "
    + "a news:/news-fixture:/research: tag. rowsPerArticle/bytesPerArticle: those totals divided "
    + "by admitted-item count. feedDocumentBytes: the materialized feed document's own byte size "
    + "(server/news-worker/handler.mjs's serializeCard + enforceFeedSizeBound), reported against "
    + "MAX_FEED_DOCUMENT_BYTES.",
});

// ---------------------------------------------------------------------------
// 1. admission rate
// ---------------------------------------------------------------------------

export function admissionRate(state, sourceIds) {
  const perSource = {};
  let offeredTotal = 0;
  let admittedTotal = 0;
  for (const sourceId of sourceIds) {
    const items = (state.items || []).filter((s) => s.sourceId === sourceId);
    const offered = items.length;
    const admitted = items.filter((s) => (s.factIds || []).length > 0).length;
    perSource[sourceId] = { offered, admitted, rate: offered ? admitted / offered : null };
    offeredTotal += offered;
    admittedTotal += admitted;
  }
  return { perSource, aggregate: { offered: offeredTotal, admitted: admittedTotal, rate: offeredTotal ? admittedTotal / offeredTotal : null } };
}

// ---------------------------------------------------------------------------
// 2. grounded-term proportion
// ---------------------------------------------------------------------------

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Metric 2's own per-item numerator/denominator, exported so the articles
 *  log (each card's backing article(s)) can quote the same figures the
 *  aggregate report is built from rather than recomputing a second way. */
export function groundedTermPerItem(state, rows) {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const ledger = ledgerFromPayload(state.ledger);
  const ungroundedByItem = new Map();
  for (const entry of ledger.terms.values()) {
    for (const itemId of entry.itemIds || []) {
      if (!ungroundedByItem.has(itemId)) ungroundedByItem.set(itemId, new Set());
      ungroundedByItem.get(itemId).add(entry.term);
    }
  }

  const perItem = [];
  for (const item of state.items || []) {
    const grounded = new Set();
    for (const factId of item.factIds || []) {
      const row = rowsById.get(factId);
      if (!row) continue;
      const s = normFactTerm(row.subject);
      const o = normFactTerm(row.object);
      if (s) grounded.add(s);
      if (o) grounded.add(o);
    }
    const ungrounded = ungroundedByItem.get(item.id) || new Set();
    const extracted = new Set([...grounded, ...ungrounded]);
    perItem.push({
      itemId: item.id, sourceId: item.sourceId,
      grounded: grounded.size, extracted: extracted.size,
      proportion: extracted.size ? grounded.size / extracted.size : null,
    });
  }
  return perItem;
}

export function groundedTermProportion(state, rows) {
  const perItem = groundedTermPerItem(state, rows);

  function summarize(items) {
    const withData = items.filter((r) => r.extracted > 0);
    const groundedSum = withData.reduce((a, r) => a + r.grounded, 0);
    const extractedSum = withData.reduce((a, r) => a + r.extracted, 0);
    const proportions = withData.map((r) => r.proportion).sort((a, b) => a - b);
    return {
      articles: withData.length,
      microAverage: extractedSum ? groundedSum / extractedSum : null,
      distribution: proportions.length
        ? { min: proportions[0], median: median(proportions), max: proportions[proportions.length - 1] }
        : null,
    };
  }

  const perSource = {};
  for (const sourceId of new Set(perItem.map((r) => r.sourceId))) {
    perSource[sourceId] = summarize(perItem.filter((r) => r.sourceId === sourceId));
  }
  return { perSource, aggregate: summarize(perItem) };
}

// ---------------------------------------------------------------------------
// 3. de-dupe ratio
// ---------------------------------------------------------------------------

export function dedupeRatio(feed, admission) {
  const admitted = admission.aggregate.admitted;
  return { cards: feed.items.length, admittedItems: admitted, ratio: admitted ? feed.items.length / admitted : null };
}

// ---------------------------------------------------------------------------
// 4. entity preservation
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
const LONG_DATE_RE = new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi");
const DAY_MONTH_RE = new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\s+\\d{4}\\b`, "gi");
const CAP_SEQUENCE_RE = /\b[A-Z][a-zA-Z'’.]*(?:[\s,]+[A-Z][a-zA-Z'’.]*){0,3}\b/g;
const GENERIC_SENTENCE_STARTERS = new Set([
  "the", "a", "an", "this", "that", "it", "in", "on", "at", "as", "when", "after", "before",
]);

function dateCandidates(text) {
  const out = new Set();
  for (const re of [ISO_DATE_RE, LONG_DATE_RE, DAY_MONTH_RE]) {
    for (const m of text.matchAll(re)) out.add(m[0]);
  }
  return out;
}

function capitalizedCandidates(text) {
  const out = new Set();
  for (const m of text.matchAll(CAP_SEQUENCE_RE)) {
    const candidate = m[0].trim();
    const words = candidate.split(/\s+/);
    if (words.length === 1 && GENERIC_SENTENCE_STARTERS.has(words[0].toLowerCase())) continue;
    if (candidate.length < 3) continue;
    out.add(candidate);
  }
  return out;
}

function buildGazetteer(rows) {
  const gazetteer = new Set();
  for (const row of rows) {
    if (row.predicate !== "rdf:type" && row.predicate !== "rdfs:subClassOf") continue;
    if (!GAZETTEER_CLASS_TERMS.has(normFactTerm(row.object))) continue;
    gazetteer.add(normFactTerm(row.subject));
  }
  return gazetteer;
}

function isGazetteerAnchored(candidate, gazetteer) {
  const whole = normFactTerm(candidate);
  if (gazetteer.has(whole)) return true;
  const afterComma = candidate.split(",").pop().trim();
  return afterComma !== candidate && gazetteer.has(normFactTerm(afterComma));
}

export function entityPreservation(state, rows, feed) {
  const gazetteer = buildGazetteer(rows);
  const rowsById = new Map(rows.map((r) => [r.id, r]));

  const cardsByFactId = new Map();
  for (const card of feed.items) {
    for (const factId of card.factIds || []) {
      if (!cardsByFactId.has(factId)) cardsByFactId.set(factId, []);
      cardsByFactId.get(factId).push(card);
    }
  }

  let rawCandidateCount = 0;
  let anchoredCount = 0;
  let factSurvival = 0;
  let paragraphSurvival = 0;

  for (const item of state.items || []) {
    const text = `${item.title || ""} ${item.summary || ""}`;
    const candidates = new Set([...dateCandidates(text), ...capitalizedCandidates(text)]);
    rawCandidateCount += candidates.size;
    if (!candidates.size) continue;

    const factTerms = new Set();
    for (const factId of item.factIds || []) {
      const row = rowsById.get(factId);
      if (!row) continue;
      factTerms.add(normFactTerm(row.subject));
      factTerms.add(normFactTerm(row.object));
    }
    const cardsForItem = new Set();
    for (const factId of item.factIds || []) for (const card of cardsByFactId.get(factId) || []) cardsForItem.add(card);
    const paragraphText = [...cardsForItem].map((c) => `${c.paragraph} ${c.backgroundParagraph || ""}`).join(" ").toLowerCase();

    for (const candidate of candidates) {
      if (!isGazetteerAnchored(candidate, gazetteer)) continue;
      anchoredCount += 1;
      if (factTerms.has(normFactTerm(candidate))) factSurvival += 1;
      if (paragraphText.includes(candidate.toLowerCase())) paragraphSurvival += 1;
    }
  }

  return {
    rawCandidateCount,
    anchoredCandidateCount: anchoredCount,
    factSurvivalRate: anchoredCount ? factSurvival / anchoredCount : null,
    paragraphSurvivalRate: anchoredCount ? paragraphSurvival / anchoredCount : null,
  };
}

// ---------------------------------------------------------------------------
// 5. noisy-hub-relation rate
// ---------------------------------------------------------------------------

const IDENTITY_PREDICATES = new Set(["rdf:type", "rdfs:subClassOf"]);

export function noisyHubRelationRate(feed, rows) {
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  let total = 0;
  let noisy = 0;
  for (const item of feed.items) {
    for (const factId of item.factIds || []) {
      const row = rowsById.get(factId);
      if (!row || !IDENTITY_PREDICATES.has(row.predicate)) continue;
      if (normFactTerm(row.subject) !== item.hub) continue;
      total += 1;
      if (NOISY_HUB_CLASS_TERMS.has(normFactTerm(row.object))) noisy += 1;
    }
  }
  return { contextLines: total, noisy, rate: total ? noisy / total : null };
}

// ---------------------------------------------------------------------------
// 6. paragraph shape
// ---------------------------------------------------------------------------

function splitSentences(paragraph) {
  const trimmed = String(paragraph || "").trim().replace(/\.$/, "");
  if (!trimmed) return [];
  return trimmed.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
}

export function paragraphShape(feed) {
  const counts = feed.items.map((item) => splitSentences(item.paragraph).length);
  const sentenceOccurrences = [];
  for (const item of feed.items) for (const sentence of splitSentences(item.paragraph)) sentenceOccurrences.push(sentence.toLowerCase());

  const seen = new Map();
  let duplicates = 0;
  for (const sentence of sentenceOccurrences) {
    const n = (seen.get(sentence) || 0) + 1;
    seen.set(sentence, n);
    if (n > 1) duplicates += 1;
  }

  const aroundItClauses = feed.items
    .map((item) => /Around it: (.+)$/.exec(item.paragraph.replace(/\.$/, ""))?.[1]?.trim().toLowerCase())
    .filter(Boolean);
  const aroundItSeen = new Map();
  let aroundItDuplicates = 0;
  for (const clause of aroundItClauses) {
    const n = (aroundItSeen.get(clause) || 0) + 1;
    aroundItSeen.set(clause, n);
    if (n > 1) aroundItDuplicates += 1;
  }

  const withDate = (src) => Object.hasOwn(src || {}, "publishedAt") || Object.hasOwn(src || {}, "date");
  let headlinePresent = 0;
  let linkPresent = 0;
  let datePresent = 0;
  for (const item of feed.items) {
    const sources = item.sources || [];
    if (sources.some((s) => s.title)) headlinePresent += 1;
    if (sources.some((s) => s.url)) linkPresent += 1;
    if (sources.some(withDate)) datePresent += 1;
  }

  return {
    cards: feed.items.length,
    sentencesPerCard: counts.length
      ? { min: Math.min(...counts), max: Math.max(...counts), mean: counts.reduce((a, b) => a + b, 0) / counts.length }
      : null,
    repeatedSentenceRate: sentenceOccurrences.length ? duplicates / sentenceOccurrences.length : null,
    aroundItRepeatRate: aroundItClauses.length ? aroundItDuplicates / aroundItClauses.length : null,
    headlinePresentRate: feed.items.length ? headlinePresent / feed.items.length : null,
    linkPresentRate: feed.items.length ? linkPresent / feed.items.length : null,
    datePresentRate: feed.items.length ? datePresent / feed.items.length : null,
  };
}

// ---------------------------------------------------------------------------
// 7. ranked-term noise
// ---------------------------------------------------------------------------

export function rankedTermNoise(rankedEntries) {
  const noisy = rankedEntries.filter((e) => RANKED_NOISE_TERMS.has(normFactTerm(e.term))).length;
  return { entries: rankedEntries.length, noisy, rate: rankedEntries.length ? noisy / rankedEntries.length : null };
}

// ---------------------------------------------------------------------------
// 8. size
// ---------------------------------------------------------------------------

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

export function sizeMetrics(rows, admittedItemsCount, feedDocumentBytesValue, maxFeedDocumentBytes) {
  const newsRows = rows.filter((r) => isNewsProvenance(r.provenance));
  const newsFactBytes = byteLength(newsRows);
  return {
    newsFactRows: newsRows.length,
    newsFactBytes,
    rowsPerArticle: admittedItemsCount ? newsRows.length / admittedItemsCount : null,
    bytesPerArticle: admittedItemsCount ? newsFactBytes / admittedItemsCount : null,
    feedDocumentBytes: feedDocumentBytesValue,
    maxFeedDocumentBytes,
    feedDocumentBudgetUsed: maxFeedDocumentBytes ? feedDocumentBytesValue / maxFeedDocumentBytes : null,
  };
}
