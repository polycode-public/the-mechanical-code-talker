// chatbench/verdict-cache.mjs — delta-judging: a committed verdict cache keyed
// by (case id, answer hash), so an unchanged answer never re-judges (PLAN
// lever 1).
//
// tmct is deterministic: an unchanged case against unchanged machinery replays
// a byte-identical answer. The judge is the only paid step, and on a typical
// cycle (a handful of fixes) almost every answer is byte-identical to the last
// judged run. This module partitions a run's product rows into the ones whose
// judged content CHANGED (must re-judge) and the ones that did not (inherit the
// prior verdict verbatim). The invalidation key is the answer HASH — never a
// file date — plus the judge identity (model + prompt + fixture-context grain):
// a verdict scored under a different judge, prompt or context grain is not
// comparable, so a change to any of them re-judges the case even when its answer
// text is unchanged.
//
// The cache is reviewed, committed data — the same discipline as every grader in
// this repo. A cached verdict is only ever a PRIOR judge sample replayed under a
// matching key; nothing is fabricated, because the key binds a verdict to the
// exact answer text and judge identity it was produced for.

import { fnv1aHex } from "../../src/domain/hash.mjs";

export const CACHE_VERSION = 1;

/** The judged content of a product row, as ONE string: every tmct answer in
 *  transcript order, newline-joined. This is what the judge actually reads
 *  scored ("did tmct answer well"), so it is what the answer hash addresses.
 *  The visitor prompts are fixed per case id, so they need not enter the hash;
 *  the case id already carries them. */
export function answerText(row) {
  return (row.transcript ?? []).map((t) => String(t.answer ?? "")).join("\n");
}

/** The answer hash — a narrow content address over answerText (fnv1aHex is the
 *  sanctioned hash for answer-variant-class pools, hash.mjs). Two runs whose
 *  case answers are byte-identical share this hash; any answer edit changes it. */
export function answerHash(row) {
  return fnv1aHex(answerText(row));
}

/** The judge identity a verdict was produced under. A verdict is inheritable
 *  only when ALL of these match the current run's, because each changes what the
 *  judge saw or how it scored: the model, the prompt version, and the
 *  fixture-context grain (run.mjs FIXTURE_CONTEXT_VERSION — a context bump is a
 *  groundedness re-baseline, so its prior verdicts are not comparable). */
export function judgeIdentity(row, { judgeModel, promptVersion }) {
  return {
    judgeModel,
    promptVersion,
    contextVersion: row.judge?.contextVersion ?? null,
  };
}

const identityEqual = (a, b) =>
  a.judgeModel === b.judgeModel &&
  a.promptVersion === b.promptVersion &&
  a.contextVersion === b.contextVersion;

/** An empty cache object (the shape saveCache writes / loadCache reads). */
export function emptyCache() {
  return { version: CACHE_VERSION, entries: {} };
}

/** Is `entry` a valid inheritance for `row` under the current judge identity?
 *  True only when the answer hash AND the full judge identity match. */
export function entryValidFor(entry, row, ctx) {
  if (!entry) return false;
  if (entry.answerHash !== answerHash(row)) return false;
  return identityEqual(entry, judgeIdentity(row, ctx));
}

/** Partition product rows against a cache: `fresh` are the rows to send to the
 *  judge (new, changed, or scored under a different judge identity); `inherited`
 *  is a map caseId -> the cached judged sample rows to replay verbatim. Also
 *  returns `counts` for the run's receipt. */
export function partition(rows, cache, ctx) {
  const entries = cache?.entries ?? {};
  const fresh = [];
  const inherited = new Map();
  for (const row of rows) {
    const entry = entries[row.caseId];
    if (entryValidFor(entry, row, ctx)) {
      inherited.set(row.caseId, entry.judged.map((j) => ({ ...j, caseId: row.caseId })));
    } else {
      fresh.push(row);
    }
  }
  return {
    fresh,
    inherited,
    counts: { total: rows.length, fresh: fresh.length, inherited: inherited.size },
  };
}

/** Strip a judged sample row down to what the cache stores (drop the caseId — it
 *  is the entry key — keep the scored payload verbatim). */
function storedSample(j) {
  const { caseId, ...rest } = j;
  return rest;
}

/** Build the NEXT cache from this run: every product row gets an entry. A row
 *  the run judged fresh stores its new samples + current hash/identity; a row
 *  that inherited carries its prior entry forward unchanged. A row that is
 *  neither (no judged output, not inherited) is dropped — the cache only ever
 *  holds rows with a real verdict behind them. Deterministic: entries are
 *  key-sorted so a re-run over the same inputs writes a byte-identical file. */
export function buildCache(rows, freshJudged, inherited, ctx, priorCache = emptyCache()) {
  const byCaseFresh = new Map();
  for (const j of freshJudged) {
    if (!byCaseFresh.has(j.caseId)) byCaseFresh.set(j.caseId, []);
    byCaseFresh.get(j.caseId).push(j);
  }
  const entries = {};
  for (const row of rows) {
    const id = row.caseId;
    if (byCaseFresh.has(id)) {
      const identity = judgeIdentity(row, ctx);
      entries[id] = {
        answerHash: answerHash(row),
        ...identity,
        judged: byCaseFresh.get(id).map(storedSample),
      };
    } else if (inherited.has(id) && priorCache.entries?.[id]) {
      entries[id] = priorCache.entries[id];
    }
  }
  const sorted = {};
  for (const k of Object.keys(entries).sort()) sorted[k] = entries[k];
  return { version: CACHE_VERSION, entries: sorted };
}

/** The full judged-row set for a run: the freshly-judged rows plus the inherited
 *  ones flattened back to judged.jsonl shape, id-sorted so the output file is
 *  deterministic regardless of which rows were fresh. */
export function mergeJudged(freshJudged, inherited) {
  const all = [...freshJudged];
  for (const rows of inherited.values()) all.push(...rows);
  return all.sort((a, b) => a.caseId.localeCompare(b.caseId) || (a.sample ?? 0) - (b.sample ?? 0));
}
