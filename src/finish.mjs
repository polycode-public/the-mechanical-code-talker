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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";

import { flatten } from "./corpus/templates.mjs";

export { flatten };

const GRAMMAR_DIR = dirname(fileURLToPath(import.meta.url));
/** The data-driven grammar-rule table (Phase 7, lever 2). */
export const GRAMMAR_RULES_FILE = join(GRAMMAR_DIR, "..", "data", "templates", "grammar-rules.toml");

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

// --- The grammar-rule engine (lever 2) --------------------------------------
// applyGrammar transforms ONLY the prose spans of a segment list. It NEVER
// regexes the flat answer string and NEVER touches a protected span — the
// invariance checker is treated as NECESSARY-BUT-NOT-SUFFICIENT (a token the
// masker failed to protect would sit in a prose span, and a corrupting rule that
// mangled it would pass the multiset check because prose is unchecked). So the
// only defence is that a rule literally cannot receive a protected span: every
// handler below filters `type === "prose"` and byte-copies the rest. Each rule's
// NEUTRAL behaviour is byte-stable; the only byte changes are GENUINE fixes to
// defects tmct itself generates. Rules are chosen to commute → idempotent.

const escapeRe2 = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Preserve the leading-letter case of `orig` on the replacement `want`. */
function matchCase(orig, want) {
  return /^[A-Z]/.test(orig) ? want[0].toUpperCase() + want.slice(1) : want;
}

/** The first alphabetic word token of a string (leading punctuation skipped),
 *  or "" when there is none (a bare number / symbol → the caller must refuse). */
function leadingWord(text) {
  const m = String(text).match(/[A-Za-z][\w-]*/);
  return m ? m[0] : "";
}

/** Does `word` begin with a VOWEL SOUND? true → "an", false → "a", null → cannot
 *  tell (refuse). Spelling-vs-sound exceptions come from the rule's TOML row. */
function beginsWithVowelSound(word, rule) {
  const w = String(word).toLowerCase().replace(/^[^a-z]+/, "");
  if (!w) return null;
  for (const ex of rule.vowel_sound_consonants || []) if (w.startsWith(ex)) return true;
  for (const ex of rule.consonant_sound_vowels || []) if (w.startsWith(ex)) return false;
  const c = w[0];
  if ("aeiou".includes(c)) return true;
  if (/[a-z]/.test(c)) return false;
  return null;
}

/** Plurality of a span: an explicit boolean `plural` wins; else a NUMBER span is
 *  singular iff its value is exactly 1 (0 and >1 are plural); else null. */
function pluralityOf(seg) {
  if (!seg) return null;
  if (typeof seg.plural === "boolean") return seg.plural;
  if (seg.type === "number") {
    const v = Number(String(seg.text).replace(/,/g, ""));
    return Number.isFinite(v) ? v !== 1 : null;
  }
  return null;
}

// Rule 1 — article selection (a/an). Reads the following word: in-span when the
// whole "a word" pair is inside one prose span; across the boundary when the
// prose ends in "a"/"an" and the next span supplies the word (guard #3: it only
// fires when it can read the real next token, else it leaves the article alone).
function ruleArticle(segments, rule) {
  const out = segments.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i += 1) {
    const seg = out[i];
    if (seg.type !== "prose") continue;
    // (a) in-span "a artifact" / "an module" (case-insensitive; case preserved)
    seg.text = seg.text.replace(/\b(a|an)(\s+)([A-Za-z][\w-]*)/gi, (m, art, sp, word) => {
      const vowel = beginsWithVowelSound(word, rule);
      if (vowel === null) return m;
      return matchCase(art, vowel ? "an" : "a") + sp + word;
    });
    // (b) boundary: prose ends "…a " / "…an ", next span carries the word
    const bm = seg.text.match(/(^|[^\w])(a|an)(\s+)$/i);
    if (bm) {
      const next = out[i + 1];
      const word = next && typeof next.text === "string" ? leadingWord(next.text) : "";
      const vowel = word ? beginsWithVowelSound(word, rule) : null;
      if (vowel !== null) {
        const fixed = matchCase(bm[2], vowel ? "an" : "a");
        seg.text = seg.text.slice(0, bm.index + bm[1].length) + fixed + bm[3];
      }
    }
  }
  return out;
}

// Rule 2 — subject–verb agreement. STRUCTURE-DRIVEN and deliberately narrow:
// (i) an existential "there is/are/was/were" agrees with the FOLLOWING number
//     span's value (the number is genuinely the subject there);
// (ii) any listed copula agrees with a following span that carries an explicit
//      `plural` flag (a producer that knows its slot's plurality sets it).
// A bare copula followed by a number that is an OBJECT count ("the file has 3")
// is NOT existential and carries no flag → left untouched. No surface guessing.
function ruleAgreement(segments, rule) {
  const singular = rule.singular || [];
  const plural = rule.plural || [];
  const toPlural = {};
  const toSingular = {};
  for (let k = 0; k < singular.length; k += 1) { toPlural[singular[k]] = plural[k]; }
  for (let k = 0; k < plural.length; k += 1) { toSingular[plural[k]] = singular[k]; }
  const out = segments.map((s) => ({ ...s }));
  for (let i = 0; i < out.length; i += 1) {
    const seg = out[i];
    if (seg.type !== "prose") continue;
    const m = seg.text.match(/(\bthere\s+)?\b([A-Za-z]+)(\s*)$/i);
    if (!m) continue;
    const verb = m[2].toLowerCase();
    if (!(verb in toPlural) && !(verb in toSingular)) continue;
    const next = out[i + 1];
    const existential = Boolean(m[1]) && next && next.type === "number";
    const flagged = next && typeof next.plural === "boolean";
    if (!existential && !flagged) continue; // guard: only fire on real structure
    const isPlural = pluralityOf(next);
    if (isPlural === null) continue;
    let want = null;
    if (isPlural && verb in toPlural && toPlural[verb] !== verb) want = toPlural[verb];
    else if (!isPlural && verb in toSingular && toSingular[verb] !== verb) want = toSingular[verb];
    if (!want) continue;
    seg.text = seg.text.slice(0, m.index) + (m[1] || "") + matchCase(m[2], want) + m[3];
  }
  return out;
}

// Rule 3 — sentence capitalisation. Only when the answer OPENS on a prose span
// whose first non-space character is a lowercase letter. An answer that opens on
// a protected span (a path/entity) is left exactly as grounded.
function ruleCapitalise(segments) {
  if (!segments.length || segments[0].type !== "prose") return segments;
  const out = segments.map((s) => ({ ...s }));
  out[0].text = out[0].text.replace(/^(\s*)([a-z])/, (m, sp, ch) => sp + ch.toUpperCase());
  return out;
}

// Rule 4 — list punctuation. A series joined by repeated connective prose spans
// (default " and ") becomes a comma series with a single terminal conjunction:
// "a and b and c" → "a, b and c". Operates ONLY on the connective prose spans;
// the joined (protected) items are byte-copied. A two-item list is untouched.
function ruleList(segments, rule) {
  const conn = rule.connective;
  const sep = rule.separator;
  const out = segments.map((s) => ({ ...s }));
  const isConn = (i) => out[i] && out[i].type === "prose" && out[i].text === conn;
  let i = 0;
  while (i < out.length) {
    if (!isConn(i)) { i += 1; continue; }
    const run = [i];
    let j = i;
    while (isConn(j + 2)) { run.push(j + 2); j += 2; }
    if (run.length >= 2) {
      for (let k = 0; k < run.length - 1; k += 1) out[run[k]].text = sep; // last stays " and "
    }
    i = j + 1;
  }
  return out;
}

// Rule 5 — terminal punctuation. Collapse a trailing run of 2+ sentence stops in
// the LAST prose span to a single stop ("done.." → "done."). Adds nothing where
// a fragment/list answer legitimately ends without a stop.
function ruleTerminal(segments, rule) {
  const stops = (rule.stops && rule.stops.length ? rule.stops : [".", "!", "?"]).map(escapeRe2).join("");
  const out = segments.map((s) => ({ ...s }));
  let idx = -1;
  for (let i = out.length - 1; i >= 0; i -= 1) if (out[i].type === "prose") { idx = i; break; }
  if (idx < 0) return out;
  const re = new RegExp(`([${stops}])(?:\\s*[${stops}])+(\\s*)$`);
  const m = out[idx].text.match(re);
  if (m) out[idx].text = out[idx].text.slice(0, m.index) + m[1] + m[2];
  return out;
}

const HANDLERS = {
  article: ruleArticle,
  agreement: ruleAgreement,
  capitalise: ruleCapitalise,
  list: ruleList,
  terminal: ruleTerminal,
};

let rulesCache = null;

/** Load + parse the grammar-rule table (the `[[rule]]` array-of-tables). Sync so
 *  finish() stays synchronous at the turn seam. A bad/absent table is defensive:
 *  the caller falls back to an empty rule set (finish becomes a strict no-op). */
export function loadGrammarRules(path = GRAMMAR_RULES_FILE) {
  const parsed = parseToml(readFileSync(path, "utf8"));
  return Array.isArray(parsed.rule) ? parsed.rule : [];
}

/** The cached rule table (parsed once per process). */
export function grammarRules() {
  if (rulesCache === null) {
    try { rulesCache = loadGrammarRules(); } catch { rulesCache = []; }
  }
  return rulesCache;
}

/** Apply the grammar rules to a segment list, in file order, transforming ONLY
 *  prose spans. Asserts fact-invariance at the end (the protected multiset must
 *  be identical) and returns the transformed segments. Idempotent by design:
 *  applyGrammar(applyGrammar(x)) yields the same flattened text as applyGrammar(x). */
export function applyGrammar(segments, rules = grammarRules()) {
  let cur = segments;
  for (const rule of rules) {
    if (rule && rule.enabled === false) continue;
    const handler = rule && HANDLERS[rule.kind];
    if (!handler) continue;
    cur = handler(cur, rule);
  }
  assertInvariance(segments, cur); // necessary-but-not-sufficient; still a hard gate
  return cur;
}

// --- The finish() seam ------------------------------------------------------
// finish() is the LAST transform in a turn:
//   1. take the result's `segments` (attached by a producer) or mask its
//      `answer` via maskSegments(result.answer, ctx),
//   2. map ONLY the prose spans through the grammar-rule engine (applyGrammar),
//   3. re-flatten, ASSERTING the invariance checker holds (guard #4: this runs
//      in production, not just in tests — a corruption throws, never ships),
//   4. rewrite result.answer (and thus logLines); `via` is unchanged.
//
// NEUTRAL finishing is BYTE-STABLE: when no rule fires, the flattened answer is
// byte-identical to the input and finish() returns its argument by REFERENCE, so
// every byte-exact assertion (test/showcase.test.mjs) stays green untouched. A
// genuine fix (e.g. "a artifact" → "an artifact") rebuilds the result with the
// corrected answer. Idempotent by construction: finish(finish(x)) === finish(x).
//
// INTENDED chat.mjs SEAM (a sibling/later wave wires this, foreign file): in
// runTurn, at the `withLast` seam, `result = finish(result, { graph })` so every
// producer passes through once. Until then finish() is exercised by its unit +
// golden tests; wiring it changes no fact, only fixes our own generated defects.

/** Finish a turn result: grammar-correct its prose spans, preserving every fact.
 *  Byte-stable when neutral (returns its argument unchanged); rebuilds only on a
 *  genuine fix. Throws if finishing would move any protected span (guard #4). */
export function finish(result, ctx = {}) {
  if (!result || typeof result.answer !== "string") return result;
  const before = Array.isArray(result.segments) && result.segments.length
    ? result.segments
    : maskSegments(result.answer, ctx);
  const after = applyGrammar(before, grammarRules());
  assertInvariance(before, after);
  const answer = flatten(after);
  if (answer === result.answer) return result; // neutral → byte-stable, same reference
  const next = { ...result, answer, segments: after };
  if (Array.isArray(result.logLines)) {
    next.logLines = result.logLines.map((l) =>
      (typeof l === "string" ? l.split(result.answer).join(answer) : l));
  }
  return next;
}
