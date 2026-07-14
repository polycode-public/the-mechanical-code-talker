// finish.mjs — response finishing: the segmentation IR seam.
//
// Fact-invariance by construction: an answer is a list of typed spans,
// [{ type, text }, …], carried alongside the flat string. Every type except
// `prose` is PROTECTED — byte-copied through finishing untouched — so only
// prose spans ever reach the grammar-rule engine; a rule can't touch a fact
// because a fact is never in its input. Byte-exact reconstruction is the
// whole contract: flatten(segments) === answer for every producer.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parse as parseToml } from "smol-toml";

import { flatten } from "./corpus/templates.mjs";

export { flatten };

const GRAMMAR_DIR = dirname(fileURLToPath(import.meta.url));
/** The data-driven grammar-rule table. */
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

// --- Conservative masker for the composed (non-template) path ---------------
// Walks a hand-built flat answer string and marks PROTECTED anything matching
// one of the patterns below; everything else is prose. Conservative: when
// unsure, protect. flatten(maskSegments(answer, ctx)) === answer, always.

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

// --- The grammar-rule engine -------------------------------------------------
// applyGrammar transforms ONLY the prose spans; every handler below filters
// `type === "prose"` and byte-copies the rest, since the invariance checker
// alone can't catch a rule that corrupts a span the masker mis-protected
// (prose is unchecked). Rules are chosen to commute → idempotent.

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
export function beginsWithVowelSound(word, rule) {
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
// prose ends in "a"/"an" and the next span supplies the word (only fires when
// it can read the real next token, else it leaves the article alone).
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

// Rule 2 — subject–verb agreement. STRUCTURE-DRIVEN:
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

// Rule 3 — sentence capitalisation: (a) the answer-initial letter, (b) every
// internal sentence boundary within one prose span, (c) a boundary that
// crosses a span boundary (skipping purely-whitespace spans in between). A
// boundary landing on a protected span is left alone — never rule-transformed.
function ruleCapitalise(segments) {
  if (!segments.length) return segments;
  const out = segments.map((s) => ({ ...s }));

  // (a) answer-initial capitalisation
  if (out[0].type === "prose") {
    out[0].text = out[0].text.replace(/^(\s*)([a-z])/, (m, sp, ch) => sp + ch.toUpperCase());
  }

  // (b) every internal sentence boundary WITHIN a single prose span
  for (const seg of out) {
    if (seg.type !== "prose") continue;
    seg.text = seg.text.replace(/([.!?])(\s+)([a-z])/g, (m, stop, sp, ch) => stop + sp + ch.toUpperCase());
  }

  // (c) a sentence boundary that CROSSES a span boundary
  for (let i = 0; i < out.length; i += 1) {
    const seg = out[i];
    if (seg.type !== "prose" || !/[.!?]\s*$/.test(seg.text)) continue;
    let j = i + 1;
    while (j < out.length && out[j].type === "prose" && /^\s*$/.test(out[j].text)) j += 1;
    if (j < out.length && out[j].type === "prose") {
      out[j].text = out[j].text.replace(/^(\s*)([a-z])/, (m, sp, ch) => sp + ch.toUpperCase());
    }
  }

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

// Rule 5 — terminal punctuation. Collapses ANY run of 2+ sentence stops within
// a prose span to a single stop ("done.." → "done."; "Sentence one.. Sentence
// two!!" → "Sentence one. Sentence two!"), across every internal sentence
// boundary a multi-sentence completion can carry, not just the answer's end.
// A legitimate fragment/list answer that ends without a stop is unaffected —
// there is nothing to collapse.
function ruleTerminal(segments, rule) {
  const stops = (rule.stops && rule.stops.length ? rule.stops : [".", "!", "?"]).map(escapeRe2).join("");
  const re = new RegExp(`([${stops}])(?:\\s*[${stops}])+(\\s*)`, "g");
  return segments.map((s) => (s.type === "prose" ? { ...s, text: s.text.replace(re, "$1$2") } : { ...s }));
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
 *  be identical) and returns the transformed segments. Idempotent:
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
// The last transform in a turn: mask (or reuse existing) segments, run
// applyGrammar over the prose spans, re-flatten, and assert invariance before
// rewriting result.answer/logLines. Byte-stable when neutral: finish() returns
// its argument by REFERENCE when no rule fired. Idempotent by construction.
//
// ctx.rules (optional): a caller-supplied rule table overriding the cached
// grammarRules() for this call only. Every existing call site omits it.

/** Finish a turn result: grammar-correct its prose spans, preserving every fact.
 *  Byte-stable when neutral (returns its argument unchanged); rebuilds only on a
 *  genuine fix. Throws if finishing would move any protected span.
 *  @param {{rules?: object[]}} [ctx.rules] optional rule-table override (see above) */
export function finish(result, ctx = {}) {
  if (!result || typeof result.answer !== "string") return result;
  const rules = Array.isArray(ctx.rules) ? ctx.rules : grammarRules();
  const before = Array.isArray(result.segments) && result.segments.length
    ? result.segments
    : maskSegments(result.answer, ctx);
  const after = applyGrammar(before, rules);
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
