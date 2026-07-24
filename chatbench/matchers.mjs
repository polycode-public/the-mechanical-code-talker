// chatbench/matchers.mjs — tier promotion: distil STABLE judged passes into
// deterministic answerMatch matchers (PLAN lever 2).
//
// A case judged PASS with byte-stable wording across two consecutive cycles no
// longer needs the judge: a hand-authored `answerMatch` that captures the
// answer's grounded essentials gates it deterministically, and the judge falls
// back to being the appeal court for tier-1 FAILURES only. This module is the
// authoring aid — it reads the graded pool plus two cycles' judged results and
// proposes a matcher per stable-pass case. The proposals are REVIEWED before
// they become committed pool data (the -v2 supersede discipline in GRADED.md);
// nothing here edits the pool.
//
// The invariant the plan names: a matcher is TIGHTER THAN THE JUDGE BY
// CONSTRUCTION. Every distilled regex is an ESCAPED LITERAL fragment lifted from
// the answer tmct actually produced (never a wildcard), so a matcher pass
// implies those exact grounded fragments are present — a strictly stronger
// condition than the judge's fuzzy semantic pass. matcherTighterThanJudge()
// checks this holds, and the tests assert it for every distilled matcher.

/** Escape a string for use as a literal inside a RegExp — no metacharacter in
 *  the source survives as a wildcard. This is what makes a distilled matcher a
 *  literal, and therefore tight. */
export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The tmct answers of a product row joined newline-wise (the text a matcher is
 *  distilled from and evaluated against). */
export function answerText(row) {
  return (row.transcript ?? []).map((t) => String(t.answer ?? "")).join("\n");
}

// Grounded-token shapes the fixture domain speaks: module ids (mod:app/lib/a.mjs,
// colon-separated), git provenance (git:abc1234), the hyphen-separated entity ids
// (cls-widget, fn-alpha, commit-abc, m-render, a-name, g-register), source paths
// (app/lib/b.mjs), dotted names (app.lib.a), and bare integers (counts). A
// distinctive grounded token is the semantic essential a matcher must require;
// ordinary prose words are not.
const TOKEN_PATTERNS = [
  /\bmod:[A-Za-z0-9/_.-]+/g,                        // module ids
  /\bgit:[0-9a-f]{7,}\b/gi,                         // provenance commit ids
  /\b(?:cls|fn|commit)-[a-z0-9]+(?:-[a-z0-9]+)*\b/g, // cls-widget, fn-alpha, commit-abc
  /\b[mag]-[a-z]+\b/g,                              // m-render, a-name, g-register
  /\b[\w-]+(?:\/[\w.-]+)+\.[A-Za-z]+\b/g,           // source paths (app/lib/b.mjs)
  /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*){2,}\b/gi,   // dotted names (app.lib.a)
  /\b\d+\b/g,                                        // bare counts
];

/** The distinctive grounded tokens in an answer, de-duplicated in first-seen
 *  order. Deterministic: the same answer always yields the same token list. */
export function groundedTokens(text) {
  const seen = new Set();
  const out = [];
  for (const re of TOKEN_PATTERNS) {
    for (const m of String(text).matchAll(re)) {
      const tok = m[0];
      if (!seen.has(tok)) { seen.add(tok); out.push(tok); }
    }
  }
  return out;
}

/** Distil a deterministic matcher from a product row's answer: `miss:false` plus
 *  an `answerMatch` of escaped-literal grounded tokens. Returns null when the
 *  answer is a miss (a miss case is not a candidate for a positive matcher — its
 *  honesty is what the judge scores) or carries no distinctive grounded token
 *  (nothing tight to require; leave it to the judge). */
export function distillMatcher(row) {
  const missTurn = (row.transcript ?? []).some((t) => t.miss === true);
  if (missTurn) return null;
  const tokens = groundedTokens(answerText(row));
  if (!tokens.length) return null;
  return { miss: false, answerMatch: tokens.map(escapeRegex) };
}

/** Does a distilled matcher pass on a product row? `miss` gate (the row carries
 *  no missing turn) plus every answerMatch regex present in the answer text.
 *  This is the deterministic tier-1 gate a promoted case runs on instead of the
 *  judge. */
export function matcherPasses(matcher, row) {
  if (!matcher) return false;
  if (matcher.miss === false && (row.transcript ?? []).some((t) => t.miss === true)) return false;
  const text = answerText(row);
  return (matcher.answerMatch ?? []).every((re) => new RegExp(re).test(text));
}

/** The tighter-than-the-judge invariant: the matcher is non-empty, matches the
 *  source answer it was distilled from, and every regex is an escaped literal
 *  (contains no unescaped regex metacharacter that could widen it to arbitrary
 *  text). A matcher failing any clause is not safe to promote. */
export function matcherTighterThanJudge(matcher, sourceRow) {
  if (!matcher || !(matcher.answerMatch ?? []).length) return false;
  if (!matcherPasses(matcher, sourceRow)) return false;
  return matcher.answerMatch.every((re) => escapeRegex(unescapeForCheck(re)) === re);
}

// A distilled regex is `escapeRegex(token)`; unescaping it back must round-trip
// to the same escaped string (i.e. it holds no metacharacter we did not add).
function unescapeForCheck(re) {
  return String(re).replace(/\\([.*+?^${}()|[\]\\])/g, "$1");
}

/** Is a case a STABLE PASS across two cycles? Both cycles must have tier-1
 *  passed, neither hard-failed, both scored at or above the mean floor, AND the
 *  answer hash must be identical across the two cycles (byte-stable wording — the
 *  plan's "stable wording across two consecutive cycles"). `a`/`b` are per-case
 *  readings `{ tier1Pass, hardFail, mean, answerHash }`. */
export function isStablePass(a, b, { meanFloor = 1.5 } = {}) {
  if (!a || !b) return false;
  if (a.answerHash !== b.answerHash) return false;
  for (const c of [a, b]) {
    if (!c.tier1Pass || c.hardFail) return false;
    if (c.mean === null || c.mean === undefined || c.mean < meanFloor) return false;
  }
  return true;
}

/** Fold a cycle's judge summary + product rows into a per-case reading map the
 *  stability check consumes: caseId -> { tier1Pass, hardFail, mean, answerHash,
 *  row }. `answerHashOf(row)` is injected (verdict-cache.answerHash) so this
 *  module needs no hash dependency of its own. */
export function cycleReadings(summary, rows, answerHashOf) {
  const byId = new Map((summary.perCase ?? []).map((c) => [c.caseId, c]));
  const readings = new Map();
  for (const row of rows) {
    const c = byId.get(row.caseId);
    readings.set(row.caseId, {
      tier1Pass: row.tier1?.pass ?? c?.tier1Pass ?? null,
      hardFail: c?.hardFail ?? false,
      mean: c?.mean ?? null,
      answerHash: answerHashOf(row),
      row,
    });
  }
  return readings;
}

/** Propose promotion matchers over two cycles' readings: for every case that is
 *  a stable pass in both AND distils to a tight matcher, emit { caseId, matcher,
 *  answerHash }. Deterministic, id-sorted. These are the appeal-court exemptions
 *  — a promoted case gates on its matcher and never reaches the judge. */
export function proposePromotions(readingsA, readingsB, opts = {}) {
  const proposals = [];
  for (const [caseId, a] of readingsA) {
    const b = readingsB.get(caseId);
    if (!isStablePass(a, b, opts)) continue;
    const matcher = distillMatcher(a.row);
    if (!matcher || !matcherTighterThanJudge(matcher, a.row)) continue;
    proposals.push({ caseId, matcher, answerHash: a.answerHash });
  }
  return proposals.sort((x, y) => x.caseId.localeCompare(y.caseId));
}

/** Partition product rows against a set of promoted matchers: `deterministic` =
 *  rows whose promoted matcher passes tier-1 here (they skip the judge);
 *  `needsJudge` = everything else (new, un-promoted, or a promoted matcher that
 *  now FAILS — a tier-1 failure, exactly the appeal the judge exists for).
 *  `promoted` is a map caseId -> matcher. Composes with the verdict cache: a
 *  promoted, passing case is judged neither freshly nor from cache. */
export function partitionByPromotion(rows, promoted) {
  const deterministic = [];
  const needsJudge = [];
  const appeals = [];
  for (const row of rows) {
    const matcher = promoted.get(row.caseId);
    if (!matcher) { needsJudge.push(row); continue; }
    if (matcherPasses(matcher, row)) deterministic.push(row);
    else { needsJudge.push(row); appeals.push(row.caseId); }
  }
  return { deterministic, needsJudge, appeals };
}
