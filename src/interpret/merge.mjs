// interpret/merge.mjs — class-grouped merging of strategy results (ROADMAP item 8).
// Grown from ask.mjs's original two-way merge ("one strategy hit -> use it; both
// hit and agree -> use it; both hit and DISAGREE -> a genuine parse-level
// ambiguity; neither hits -> the honest grammar miss") into a general rule over N
// strategies and N result CLASSES:
//
//   · SAME-class candidates merge and rank — identical parses (sameParse) dedupe
//     onto the highest-precedence strategy's candidate, exactly as the legacy
//     merge returned "either" result on agreement; multiple DISTINCT parses
//     surviving in the winning class are the legacy {ambiguousParse, candidates}
//     surface, rendered by ask.mjs as "this could mean more than one thing: …".
//   · DISTINCT-class groups produce the ambiguity SURROUND: the winning class
//     answers, and each other class's best candidate is listed as an
//     "if you mean X then …" line (alternateLines below) — the generalization of
//     the engine's existing announced-correction shapes ("assuming you meant …").
//
// Winner selection is deterministic: the class holding the highest-confidence
// candidate wins; a confidence tie goes to the earlier-registered strategy. The
// two legacy strategies share one class ("graph-query"), so their merge reduces
// exactly to the original behavior by construction.

const DEFAULT_CONFIDENCE = 0.5;

// "commit abc1234" and bare "abc1234" are the SAME term once resolveObject's
// commit-sha tier strips the noun — the anchored strategy captures the noun inside
// its object span while keyword-spot consumes it as the entity keyword, so without
// this the two strategies would "disagree" over a word that names no different thing.
const cmpTerm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^commit\s+(?=[0-9a-f]{7,40}$)/, "");

/** Do two independently-produced parses mean the same graph query? Same
 *  shape, same relation kind, and matching term(s) (both subject and object
 *  for "ask"; just object otherwise) — anything less is a genuine
 *  disagreement, not a near-miss to paper over. */
export function sameParse(p, q) {
  if (p.shape !== q.shape || p.kind !== q.kind) return false;
  if (p.shape === "ask") return cmpTerm(p.subject) === cmpTerm(q.subject) && cmpTerm(p.object) === cmpTerm(q.object);
  return cmpTerm(p.object) === cmpTerm(q.object);
}

/** Merge an array of strategy results ({strategyId, class, candidates:[{parsed,
 *  confidence?, note?}]}), in strategy-registration (= precedence) order, into
 *    { class, parsed, winner, alternates } | null
 *  where `parsed` is the winning class's single merged parse OR the legacy
 *  {ambiguousParse: true, candidates} tie, `winner` is the winning candidate
 *  record, and `alternates` lists each OTHER class's best candidate (its parse
 *  not sameParse-equal to a winning one — a cross-class agreement is agreement,
 *  not an alternative reading). Null when nothing parsed anywhere. */
// Candidate `via` values that mark an APPROXIMATE reading (a bounded-edit-
// distance or lemma rewrite happened on the way to this parse). The engine's
// tier discipline — "exact curated match always wins; lower tiers fire only on
// a miss" — must survive the merge: an approximate candidate is DISCARDED
// outright whenever any exact candidate parsed at all (rule a), and dedupe keys
// on (parse, via) so an approximate twin can never collapse onto (or stand in
// for) an exact parse and smuggle its "assuming you meant …" announcement into
// an exact answer (rule b). A candidate with no `via` (or via:"exact") is exact
// — the legacy strategies set none.
const APPROXIMATE_VIAS = new Set(["fuzzy", "lemma", "spell"]);
const isApproximate = (c) => APPROXIMATE_VIAS.has(c.via);

export function mergeStrategyResults(results) {
  const valid = (results || []).filter((r) => r && Array.isArray(r.candidates) && r.candidates.length);
  if (!valid.length) return null;
  // flatten candidates in precedence order (validity-checked)
  let flat = [];
  for (const r of valid) {
    for (const c of r.candidates) {
      if (!c || !c.parsed) continue;
      flat.push({
        parsed: c.parsed,
        confidence: typeof c.confidence === "number" ? c.confidence : DEFAULT_CONFIDENCE,
        note: c.note || null,
        via: c.via || null,
        strategyId: r.strategyId,
        class: r.class,
      });
    }
  }
  // rule (a): any exact parse anywhere discards every approximate candidate —
  // exact curated evidence always wins, so a fuzzy/lemma reading may only ever
  // compete when NOTHING parsed exactly.
  if (flat.some((c) => !isApproximate(c))) flat = flat.filter((c) => !isApproximate(c));
  if (!flat.length) return null;
  // group by class, preserving precedence order
  const groups = new Map();
  for (const c of flat) {
    if (!groups.has(c.class)) groups.set(c.class, []);
    groups.get(c.class).push(c);
  }
  // within-class dedupe: an identical parse collapses onto its first (highest-
  // precedence) occurrence — the survivor keeps the strongest confidence and
  // counts how many strategies agreed on it. Dedupe keys on (parse, via) — rule
  // (b) — so distinct provenances never merge (moot after rule (a) globally
  // splits exact from approximate, but held here as its own invariant).
  const merged = [];
  for (const [cls, cands] of groups) {
    const distinct = [];
    for (const c of cands) {
      const dup = distinct.find((d) => sameParse(d.parsed, c.parsed) && d.via === c.via);
      if (dup) {
        dup.agreed += 1;
        dup.confidence = Math.max(dup.confidence, c.confidence);
        continue;
      }
      distinct.push({ ...c, agreed: 1 });
    }
    if (distinct.length) merged.push({ class: cls, candidates: distinct });
  }
  if (!merged.length) return null;
  const top = (g) => Math.max(...g.candidates.map((c) => c.confidence));
  let winner = merged[0];
  for (const g of merged) if (top(g) > top(winner)) winner = g;
  // >1 DISTINCT parse in the winning class -> the legacy parse-level ambiguity,
  // surfaced honestly (never a silently-preferred guess) — byte-identical to the
  // original two-strategy disagreement shape.
  const parsed = winner.candidates.length === 1
    ? winner.candidates[0].parsed
    : { ambiguousParse: true, candidates: winner.candidates.map((c) => c.parsed) };
  const alternates = merged
    .filter((g) => g !== winner)
    .map((g) => g.candidates[0])
    .filter((a) => !winner.candidates.some((w) => sameParse(w.parsed, a.parsed)));
  return { class: winner.class, parsed, winner: winner.candidates[0], alternates };
}

/** One-line, honest rephrasing of an alternate's parse — the default `describe`
 *  for alternateLines. Template only, reads straight off the parsed fields (the
 *  same discipline as ask.mjs's describeParse; callers with richer noun tables
 *  may pass their own describe). */
export function describeAlternate(p) {
  if (!p) return "something else";
  if (p.ambiguousParse) return "one of several readings";
  const obj = p.object ?? p.subject ?? "?";
  return `${p.kind} "${obj}"`;
}

/** The distinct-class ambiguity SURROUND: one "if you mean X then …" line per
 *  alternate. `answerFor(alternate)` (optional) supplies the "then …" tail — a
 *  caller holding the graph can answer each alternate reading outright; without
 *  it the line honestly points at the rephrase instead of pretending to answer.
 *  Message shape generalizes the engine's announced-correction precedents
 *  ("assuming you meant …" / "this could mean more than one thing: …"). */
export function alternateLines(alternates, { describe = describeAlternate, answerFor = null } = {}) {
  return (alternates || []).map((a) => {
    const meaning = a.note || describe(a.parsed);
    const tail = (answerFor && answerFor(a)) || "ask it that way";
    return `if you mean ${meaning} then ${tail}`;
  });
}
