// finish.mjs — Phase 7 response finishing: the segmentation IR seam.
// (PLAN_RESPONSE_FINISHING.md, "The segmentation IR (lever 1)".)
//
// The governing principle is fact-invariance BY CONSTRUCTION. An answer is a
// list of typed spans, [{ type, text }, …], carried alongside the flat string
// (never replacing it). Every type except `prose` is PROTECTED: entities,
// paths, numbers, code, provenance and receipts are byte-copied through
// finishing untouched, and only prose spans are ever handed to a (future)
// grammar-rule engine. Segmentation makes "turn app/lib/a.mjs into an.mjs"
// UNREPRESENTABLE — the protected spans are not in the rule engine's input.
//
// This module is the FOUNDATION step: pure structure, ZERO behaviour change.
// It provides:
//   - the segment type vocabulary + the protected/prose split,
//   - maskSegments(answer, { graph }) — a conservative masker for the composed
//     (non-template) path (the templated path segments in corpus/templates.mjs),
//   - an INVARIANCE CHECKER (the protected-span multiset must survive any
//     prose-only transform), the property future grammar rules are gated on,
//   - a NO-OP finish(result, ctx) — the seam a later wave wires into chat.mjs.
//
// Byte-exact reconstruction is the whole contract here: flatten(segments) ===
// answer for every producer, and finish() returns its input byte-for-byte.

import { flatten } from "./corpus/templates.mjs";

export { flatten };

/** The segment type vocabulary. `prose` is the only unprotected type. */
export const SEGMENT_TYPES = Object.freeze([
  "prose", "entity", "path", "number", "code", "provenance", "receipt",
]);

/** Protected types: byte-copied through finishing, never rule-transformed. */
export const PROTECTED_TYPES = Object.freeze(
  new Set(SEGMENT_TYPES.filter((t) => t !== "prose")),
);

/** Is this span type protected (i.e. anything that is not prose)? */
export function isProtected(type) {
  return type !== "prose";
}

// --- Conservative masker for the composed path ------------------------------
// The templated path gets segments almost for free (corpus/templates.mjs
// renderSegments). The composed path (ask engine, plain/conversational turns)
// hands finishing a hand-built flat string; maskSegments walks it and marks
// PROTECTED anything matching one of the patterns below, leaving everything
// else prose. Policy: CONSERVATIVE — when unsure, protect. An un-adopted render
// site simply presents its whole answer as a single prose span (pass no graph
// and match nothing → one prose segment), and the invariance checker still
// guards it. flatten(maskSegments(answer, ctx)) === answer, always.

// Parenthesized receipts: "(traversal: calls edges where object = fnAlpha)" and
// the repair receipt 'read as "which modules import a.mjs"'.
const RECEIPT_PAREN_RE = /\((?:traversal|read as)\b[^)]*\)/gi;
const RECEIPT_READAS_RE = /read as\s+"[^"]*"/gi;

// Provenance / licence tags: "(source: …)", "(licence: …)", bare CC licences
// ("CC-BY-SA") and the ConceptNet source name.
const PROVENANCE_PAREN_RE = /\((?:source|licen[sc]e)\b[^)]*\)/gi;
const LICENCE_CODE_RE = /\bCC-BY(?:-[A-Z]+)*\b/g;
const CONCEPTNET_RE = /\bConceptNet\b/g;

// Path tokens: anything with a slash-joined segment, or a file extension.
const PATH_RE = /(?:[\w@.-]+\/)+[\w@.-]+|\b[\w-]+\.(?:mjs|cjs|js|jsx|ts|tsx|json|jsonl|md|txt|py|rb|go|rs|toml|yml|yaml)\b/g;

// Bare numbers (integers or decimals), lowest precedence so a number inside a
// path/receipt/entity is claimed by that span first.
const NUMBER_RE = /\b\d+(?:\.\d+)?\b/g;

// Precedence: lower wins when candidate spans overlap.
const PRECEDENCE = { receipt: 0, provenance: 1, path: 2, entity: 3, number: 4 };

/** Collect the string labels of a loaded graph's individuals (defensive: any
 *  non-array / missing-label shape yields an empty set). Longest labels first
 *  so a compound label wins over a substring of it. */
function graphLabels(graph) {
  const labels = [];
  const individuals = graph && Array.isArray(graph.individuals) ? graph.individuals : [];
  for (const ind of individuals) {
    const label = ind && ind.label != null ? String(ind.label) : "";
    if (label) labels.push(label);
  }
  labels.sort((a, b) => b.length - a.length);
  return labels;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pushMatches(re, type, text, out) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) { re.lastIndex += 1; continue; }
    out.push({ start: m.index, end: m.index + m[0].length, type });
  }
}

/** Segment a composed (non-template) flat answer into typed spans, marking as
 *  PROTECTED any known graph label (entity), path token, bare number, receipt
 *  tail or provenance/licence tag; everything else is prose. Guarantees exact
 *  reconstruction: flatten(maskSegments(answer, ctx)) === answer.
 *
 *  @param {string} answer   the flat answer string
 *  @param {{graph?: {individuals?: Array<{label?: any}>}}} [ctx]
 */
export function maskSegments(answer, ctx = {}) {
  const text = String(answer);
  if (!text) return [];
  const cand = [];

  pushMatches(RECEIPT_PAREN_RE, "receipt", text, cand);
  pushMatches(RECEIPT_READAS_RE, "receipt", text, cand);
  pushMatches(PROVENANCE_PAREN_RE, "provenance", text, cand);
  pushMatches(LICENCE_CODE_RE, "provenance", text, cand);
  pushMatches(CONCEPTNET_RE, "provenance", text, cand);
  pushMatches(PATH_RE, "path", text, cand);
  pushMatches(NUMBER_RE, "number", text, cand);

  // Known graph labels → entity spans (word-boundary, longest-first).
  for (const label of graphLabels(ctx && ctx.graph)) {
    const re = new RegExp(`(?<![\\w/.-])${escapeRe(label)}(?![\\w/.-])`, "g");
    pushMatches(re, "entity", text, cand);
  }

  // Greedy non-overlapping selection: earliest start, then precedence, then
  // longest span. A candidate overlapping an already-accepted span is dropped.
  cand.sort((a, b) =>
    a.start - b.start ||
    PRECEDENCE[a.type] - PRECEDENCE[b.type] ||
    (b.end - b.start) - (a.end - a.start));

  const chosen = [];
  let guard = -1;
  for (const c of cand) {
    if (c.start < guard) continue;
    chosen.push(c);
    guard = c.end;
  }

  // Emit segments, filling the gaps between protected spans with prose.
  const segments = [];
  let last = 0;
  for (const c of chosen) {
    if (c.start > last) segments.push({ type: "prose", text: text.slice(last, c.start) });
    segments.push({ type: c.type, text: text.slice(c.start, c.end) });
    last = c.end;
  }
  if (last < text.length) segments.push({ type: "prose", text: text.slice(last) });
  return segments;
}

// --- Invariance checker -----------------------------------------------------
// The machine proof that no fact moved: the MULTISET of protected spans must be
// identical before and after any prose-only transform. Future grammar rules are
// gated on this — a rule that changes a protected span is a bug, not a fix.

/** The protected spans of a segment list, as {type,text} (order-independent). */
export function protectedSpans(segments) {
  return segments
    .filter((s) => isProtected(s.type))
    .map((s) => ({ type: s.type, text: s.text }));
}

/** A canonical (sorted) multiset key for the protected spans, for comparison. */
export function protectedMultiset(segments) {
  return protectedSpans(segments)
    .map((s) => `${s.type} ${s.text}`)
    .sort();
}

/** Does the protected-span multiset survive a transform (before → after)? */
export function invariantHolds(before, after) {
  const a = protectedMultiset(before);
  const b = protectedMultiset(after);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Assert the invariant, returning `after` on success; throw on violation. */
export function assertInvariance(before, after) {
  if (!invariantHolds(before, after)) {
    throw new Error("fact-invariance violated: the protected-span multiset changed during finishing");
  }
  return after;
}

// --- The finish() seam ------------------------------------------------------
// finish() is the LAST transform in a turn. In the finished design it will:
//   1. take the turn result's `segments` (attached by the producer) or, if none,
//      mask its `answer` via maskSegments(result.answer, ctx),
//   2. map ONLY the prose spans through the grammar-rule engine,
//   3. re-flatten to a new answer, asserting the invariance checker holds,
//   4. rewrite result.answer (and thus logLines); `via` is unchanged.
//
// In THIS foundation step it is a strict NO-OP: it returns its input
// byte-for-byte, so every existing byte-exact assertion (test/showcase.test.mjs)
// stays green. Idempotent by construction: finish(finish(x)) === finish(x).
//
// INTENDED chat.mjs SEAM (not wired here — a later wave does this): in runTurn,
// at the `withLast` seam where every dispatched turn's result is finalised,
// wrap the result — `result = finish(result, { graph })` — so every producer
// (runAsk, plainTurn, conversationalTurn, runCommand) passes through it once,
// whether or not it attached `segments`.

/** No-op finishing seam: returns `result` unchanged (byte-for-byte). */
export function finish(result, ctx = {}) {
  return result;
}
