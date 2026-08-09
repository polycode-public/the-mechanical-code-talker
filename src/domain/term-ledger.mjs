// term-ledger.mjs — counts every fact-ungrounded term the news loop sees, so
// the enrichment queue can work the most-mentioned gaps first
// (PLAN_NEWS_FEED.md section 6.3). Pure: every timestamp arrives as a `now`
// parameter from the caller, nothing here reads the wall clock, so two peers
// replaying the same bump/mark/sweep sequence converge on the same ledger.

import { normFactTerm } from "./hash.mjs";

const ITEM_IDS_CAP = 12;

/** Ledger entry field order fixed once here so `ledgerPayload` serializes
 *  byte-identically across peers regardless of insertion order elsewhere. */
function newEntry(term, vocabGrounded, now) {
  return {
    term,
    count: 0,
    vocabGrounded,
    itemIds: [],
    firstSeen: now,
    lastSeen: now,
    status: "pending",
    missedAt: "",
  };
}

export function createTermLedger() {
  return { terms: new Map() };
}

/** `termCounts`: Map<term, occurrences-in-this-text>. Normalizes keys through
 *  `normFactTerm`, so dedupe across cycles is inherent — one entry per
 *  normalized term. `vocabGroundedByTerm` (raw term or normalized term ->
 *  boolean) seeds a NEW entry's `vocabGrounded` flag once; an existing entry's
 *  flag is never revisited, because lexicon membership does not change. */
export function bumpTerms(ledger, termCounts, itemId, now, vocabGroundedByTerm = new Map()) {
  for (const [rawTerm, occurrences] of termCounts) {
    const term = normFactTerm(rawTerm);
    if (!term) continue;
    let entry = ledger.terms.get(term);
    if (!entry) {
      const vocabGrounded = vocabGroundedByTerm.has(rawTerm)
        ? Boolean(vocabGroundedByTerm.get(rawTerm))
        : Boolean(vocabGroundedByTerm.get(term));
      entry = newEntry(term, vocabGrounded, now);
      ledger.terms.set(term, entry);
    }
    entry.count += occurrences;
    entry.lastSeen = now;
    if (itemId && !entry.itemIds.includes(itemId) && entry.itemIds.length < ITEM_IDS_CAP) {
      entry.itemIds.push(itemId);
    }
  }
  return ledger;
}

const byRank = (a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0);

/** A "missed" entry whose `missedAt + ttlMs` has passed `now` reads as
 *  "pending" here — the negative-cache expiry, computed fresh on every call
 *  from the arguments alone. The ledger itself is never mutated by this. */
function effectiveStatus(entry, now, ttlMs) {
  if (entry.status !== "missed" || now == null || ttlMs == null) return entry.status;
  const missedAtMs = Date.parse(entry.missedAt);
  if (!Number.isFinite(missedAtMs)) return entry.status;
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) return entry.status;
  return nowMs - missedAtMs >= ttlMs ? "pending" : entry.status;
}

/** Entries sorted count desc then term asc; `status` filters on the entry's
 *  effective status (after the negative-cache expiry above) when given. */
export function rankedTerms(ledger, { limit = 20, status = null, now = null, ttlMs = 0 } = {}) {
  const withEffectiveStatus = [...ledger.terms.values()].map((entry) => ({
    ...entry,
    status: effectiveStatus(entry, now, ttlMs),
  }));
  const filtered = status == null ? withEffectiveStatus : withEffectiveStatus.filter((e) => e.status === status);
  return filtered.sort(byRank).slice(0, limit);
}

/** Sets an entry's status; stamps `missedAt` when the new status is
 *  "missed" (the negative-cache clock). A no-op for a term with no entry. */
export function markTerm(ledger, term, status, now) {
  const entry = ledger.terms.get(normFactTerm(term));
  if (!entry) return ledger;
  entry.status = status;
  if (status === "missed") entry.missedAt = now;
  return ledger;
}

/** Flips every pending/missed entry `isFactGrounded(term)` now answers true
 *  for to "grounded"; returns the flipped terms, sorted. `vocabGrounded` never
 *  gates this — fact-grounding and vocab-grounding are independent states. */
export function groundedSweep(ledger, isFactGrounded) {
  const flipped = [];
  for (const entry of ledger.terms.values()) {
    if ((entry.status === "pending" || entry.status === "missed") && isFactGrounded(entry.term)) {
      entry.status = "grounded";
      flipped.push(entry.term);
    }
  }
  return flipped.sort();
}

/** JSON-safe snapshot, entries in ranking order — the determinism contract:
 *  two peers with the same bump/mark/sweep history serialize identically. */
export function ledgerPayload(ledger) {
  const entries = [...ledger.terms.values()].sort(byRank).map((entry) => ({ ...entry, itemIds: [...entry.itemIds] }));
  return { terms: entries };
}

export function ledgerFromPayload(payload) {
  const ledger = createTermLedger();
  for (const entry of payload?.terms ?? []) {
    ledger.terms.set(entry.term, { ...entry, itemIds: [...(entry.itemIds ?? [])] });
  }
  return ledger;
}
