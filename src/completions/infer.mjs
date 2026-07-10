// completions/infer.mjs — Stage 3 ("inference between groups") of PLAN_COMPLETIONS.md's
// six-stage mechanical-text-generation pipeline. §4's staging table: "cross-group inference
// wired to the existing entailment/rule-chase machinery, closed inference-relation
// vocabulary... Reuses syllogise.mjs/resolveRelationChase, no new engine... Every asserted
// inference cites a concrete licensing test, zero fabricated relationships on a hand-labeled
// set" — this file, plus test/completions-infer.test.mjs's hand-labeled fixture, is that exit
// criterion made concrete.
//
// "Apply tmct's existing entailment machinery... not just to graph facts, but to
// relationships BETWEEN retrieved text groups... a closed, small inference-relation
// vocabulary, deliberately mirroring marginalia's own TYPED_EDGES closed set... A relationship
// between two groups is only asserted when a concrete, named test licenses it... never
// inferred by prose similarity alone" (PLAN_COMPLETIONS.md §1.3). Four relations, each with
// its own mechanical, named licensing test — see the four test*() functions below, one per
// relation, each documented at its own definition:
//
//   supports    — resolveRelationChase (src/memory/core.mjs, PLAN_COMPLETIONS.md Stage 1's
//                 own prerequisite extraction) confirms a taught relation fact between two
//                 entities both groups' text share.
//   contradicts — the two groups' text carry OPPOSITE negation polarity around the SAME
//                 shared graph-known entity + shared content token (token-level, closed
//                 negation-marker set — no graph fact required).
//   elaborates  — one group's graph-known entity set is a PROPER SUBSET of the other's (the
//                 wider group elaborates the narrower one).
//   exemplifies — one group names a class-level term (something else is taught
//                 rdfs:subClassOf/rdf:type it — checkable via the SAME memory/core.mjs-loaded
//                 fact rows), and the other group names a taught INSTANCE of that class.
//
// "Entity" grounding: a group's raw content tokens (tokenizeBlock, the same tokenizer
// group.mjs/rank.mjs use, filtered the same isContentToken way those two files already
// establish) are narrowed to GRAPH-KNOWN terms only — tokens that normFactTerm-match some
// fact's subject or object in the loaded memory. This is the concrete grounding that keeps
// "group A and group B share an entity" a checkable graph fact, not a prose-similarity guess:
// two groups merely using the same English word never licenses anything on its own unless
// that word is itself a taught term.
//
// Determinism: no randomness anywhere. Groups are processed in a fixed (id-sorted) pairwise
// order; every internal token/entity set is turned into a sorted array before use; every
// per-relation test returns at most one hit per (group pair, relation), picked by that fixed
// order — never "first of an unordered Set/Map iteration". See
// test/completions-infer.test.mjs's own double-run diff test, the same discipline
// test/completions-stage0.test.mjs and test/completions-stage2.test.mjs already apply to
// search+group and to sentence ranking.

import { normFactTerm, readFactRows, resolveRelationChase } from "../memory/core.mjs";
import { tokenizeBlock } from "../memory/blocks.mjs";
import { splitSentences } from "./rank.mjs";
import { STOPWORDS } from "../prose.mjs";

// Same content-token filter group.mjs/rank.mjs each apply to their own adjacency/ranking (not
// exported from either, so replicated here rather than reached across files — see either
// file's own header for why raw tokenizeBlock output, which re-admits stopword-shaped filler,
// is unsuitable for unweighted set operations like the ones this file runs).
const isContentToken = (t) => /^[a-z0-9]+$/.test(t) && !STOPWORDS.has(t);

/** tokenizeBlock(text), narrowed to real content tokens — see isContentToken above. */
function contentTokens(text) {
  return tokenizeBlock(text).filter(isContentToken);
}

// This file's own local copy of chat.mjs's private HAS_PROPERTY_PREDICATE constant (same
// literal string, "mgx:hasProperty") — not exported from memory/core.mjs or chat.mjs, so
// resolveRelationChase's own unit tests (test/memory-core.test.mjs) establish the precedent of
// a caller supplying its own minimal, self-contained copy in its `helpers` bag rather than
// reaching into chat.mjs (out of scope for this dispatch) for the shared constant.
const HAS_PROPERTY_PREDICATE = "mgx:hasProperty";

// The taught ISA-family predicates (chat.mjs's own MINT_ISA_PREDICATES/ISA_PREDICATES sets
// this same pair, elsewhere) — the exemplifies test's "checkable via the taught IsA/subClassOf
// graph" per PLAN_COMPLETIONS.md §1.3, read directly off readFactRows() rows rather than via
// syllogise.mjs's fuller OWL 2 RL machinery (out of scope for this dispatch; this file only
// needs the STORED isa edges, not their transitive closure).
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

// The contradicts test's closed negation-marker vocabulary (PLAN_COMPLETIONS.md §1.3's own
// suggestion: "a simpler token-level polarity check... a small closed negation-word set").
// Deliberately checked against the RAW sentence text, not contentTokens()'s output — prose.mjs's
// STOPWORDS (which isContentToken filters through) already strips "not"/"no" as filler for
// clustering/ranking purposes, which would silently erase the exact signal this test needs.
const NEGATION_MARKERS = new Set([
  "not", "no", "never", "cannot", "none", "nobody", "nothing", "neither", "nor", "without",
]);
const NEGATION_CONTRACTION_RE = /n't\b/i; // doesn't/isn't/don't/won't/can't/... one closed check

/** Does this sentence carry a negation marker from the closed set above? Token-level, on the
 *  raw (not stopword-filtered) sentence text. */
function sentenceIsNegated(sentence) {
  const s = String(sentence || "").toLowerCase();
  if (NEGATION_CONTRACTION_RE.test(s)) return true;
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w) => NEGATION_MARKERS.has(w));
}

/** Union of contentTokens() over every member's text — a group's own content-token
 *  vocabulary, deduped. */
function groupContentTokenSet(group) {
  const set = new Set();
  for (const m of group?.members || []) {
    for (const t of contentTokens(m?.text || "")) set.add(t);
  }
  return set;
}

/** Every sentence across a group's members, pre-split (rank.mjs's own splitSentences — reused
 *  verbatim, no re-implementation), each carrying its own content-token set and negation flag
 *  — the exact per-sentence facts the contradicts test needs. */
function sentencesOf(group) {
  const out = [];
  for (const m of group?.members || []) {
    for (const sentence of splitSentences(m?.text || "")) {
      out.push({ sentence, tokens: new Set(contentTokens(sentence)), negated: sentenceIsNegated(sentence) });
    }
  }
  return out;
}

/** Every normFactTerm-normalized term that appears as SOME fact's subject or object in the
 *  loaded memory — the "graph-known term" universe entities are grounded against. */
function buildGraphTerms(rows) {
  const set = new Set();
  for (const r of rows) {
    const s = normFactTerm(r.subject);
    const o = normFactTerm(r.object);
    if (s) set.add(s);
    if (o) set.add(o);
  }
  return set;
}

/** A group's GRAPH-GROUNDED entities: its own content-token vocabulary, narrowed to tokens
 *  that are themselves graph-known terms (buildGraphTerms' universe) — sorted for determinism.
 *  This is the concrete grounding test/completions-infer.test.mjs's fixture exercises: two
 *  groups merely sharing an English word (e.g. both saying "abstraction") never counts unless
 *  that word is itself a taught fact term. */
function entitiesOf(group, graphTerms) {
  return [...groupContentTokenSet(group)].filter((t) => graphTerms.has(t)).sort();
}

/** A minimal, self-contained relationFactsFor(name) — direct-predicate match only
 *  (`mgx:${name}`), no alias/subClassOf-over-relation-names chase. Mirrors
 *  test/memory-core.test.mjs's own testRelationFactsFor precedent exactly: resolveRelationChase
 *  never calls the alias substrate itself, that lives entirely inside whatever relationFactsFor
 *  the caller supplies, and a direct-only implementation is an honest, valid, simpler one — no
 *  alias-chase claim is made or needed for the supports test's own licensing standard. */
function makeRelationFactsFor(rows) {
  return (name) => rows
    .filter((f) => f.predicate === `mgx:${name}`)
    .map((f) => ({ fact: f, aliasFacts: [] }));
}

/** The resolveRelationChase/resolveRelationChaseReverse `helpers` bag this file supplies —
 *  same shape test/memory-core.test.mjs's own direct unit tests use, built once per
 *  inferRelations() call over the loaded memory's fact rows. */
function makeHelpers(rows) {
  return {
    relationFactsFor: makeRelationFactsFor(rows),
    renderFactLine: (f) => `${f.subject} ${f.predicate} ${f.object}`,
    factPhrase: (f) => `${f.subject} ${f.predicate} ${f.object}`,
    factTermVariants: (normFn, term) => new Set([normFn(term)]),
    byTrust: (a, b) => (b.trust ?? 0) - (a.trust ?? 0),
    rows,
    HAS_PROPERTY_PREDICATE,
  };
}

/** Every distinct relation NAME resolveRelationChase can plausibly be asked about: every
 *  `mgx:<name>` predicate actually present among the loaded facts, minus HAS_PROPERTY_PREDICATE
 *  (a property-literal marker, not a relation name) — a closed, corpus-derived candidate list,
 *  never an open-ended guess at what "a relation" might be named. Sorted for determinism. */
function relationNameCandidates(rows) {
  const names = new Set();
  for (const r of rows) {
    if (r.predicate === HAS_PROPERTY_PREDICATE) continue;
    if (!String(r.predicate || "").startsWith("mgx:")) continue;
    names.add(r.predicate.slice("mgx:".length).toLowerCase());
  }
  return [...names].sort();
}

/**
 * SUPPORTS — group A and group B share at least two graph-grounded entities, AND a taught
 * relation fact (resolveRelationChase, src/memory/core.mjs — this file's direct tie-in to
 * PLAN_COMPLETIONS.md Stage 1's own prerequisite extraction) confirms a claim connecting two of
 * those shared entities. Tries every (subject, object) ordered pair drawn from the shared
 * entity set, against every candidate relation name, in fixed sorted order; the first hit
 * (deterministic given fixed inputs) is the one asserted. Returns
 * `{ licensingTest, evidence }` or null.
 */
async function testSupports(a, b, memory, helpers, relationNames, graphTerms) {
  const entitiesA = entitiesOf(a, graphTerms);
  const entitiesB = entitiesOf(b, graphTerms);
  const shared = entitiesA.filter((e) => entitiesB.includes(e));
  if (shared.length < 2) return null;
  for (const subjectTerm of shared) {
    for (const objectTerm of shared) {
      if (subjectTerm === objectTerm) continue;
      for (const name of relationNames) {
        // eslint-disable-next-line no-await-in-loop -- deterministic fixed-order search, not a batch op
        const hit = await resolveRelationChase(memory, name, subjectTerm, objectTerm, helpers);
        if (hit) {
          return {
            licensingTest: `resolveRelationChase("${name}", "${subjectTerm}", "${objectTerm}") resolved a taught fact — both terms are entities shared by group ${a.id} and group ${b.id}'s text`,
            evidence: { sharedEntities: shared, relationName: name, subject: subjectTerm, object: objectTerm, citation: hit.citation },
          };
        }
      }
    }
  }
  return null;
}

/**
 * CONTRADICTS — group A and group B both mention the SAME graph-grounded entity, plus a
 * second shared content token ("predicate"/aspect) that co-occurs with the entity in at least
 * one sentence on each side — and one side's co-occurring sentence carries a closed-set
 * negation marker while the other side's does not (opposite polarity about the same claim,
 * PLAN_COMPLETIONS.md §1.3's own "simpler token-level polarity check"). Returns
 * `{ licensingTest, evidence }` or null.
 */
function testContradicts(a, b, graphTerms) {
  const entitiesA = entitiesOf(a, graphTerms);
  const entitiesB = entitiesOf(b, graphTerms);
  const sharedEntities = entitiesA.filter((e) => entitiesB.includes(e));
  if (!sharedEntities.length) return null;

  const tokensA = groupContentTokenSet(a);
  const tokensB = groupContentTokenSet(b);
  const sharedTokens = [...tokensA].filter((t) => tokensB.has(t)).sort();

  const sentencesA = sentencesOf(a);
  const sentencesB = sentencesOf(b);

  for (const entity of sharedEntities) {
    for (const aspect of sharedTokens) {
      if (aspect === entity) continue;
      const matchesA = sentencesA.filter((s) => s.tokens.has(entity) && s.tokens.has(aspect));
      const matchesB = sentencesB.filter((s) => s.tokens.has(entity) && s.tokens.has(aspect));
      if (!matchesA.length || !matchesB.length) continue;
      const negatedA = matchesA.some((s) => s.negated);
      const affirmedA = matchesA.some((s) => !s.negated);
      const negatedB = matchesB.some((s) => s.negated);
      const affirmedB = matchesB.some((s) => !s.negated);
      if (affirmedA && negatedB) {
        return {
          licensingTest: `shared entity "${entity}" + shared token "${aspect}": group ${a.id}'s matching sentence carries no negation marker while group ${b.id}'s does (closed negation-marker set)`,
          evidence: {
            entity, aspect,
            affirmedSentence: matchesA.find((s) => !s.negated).sentence,
            negatedSentence: matchesB.find((s) => s.negated).sentence,
          },
        };
      }
      if (negatedA && affirmedB) {
        return {
          licensingTest: `shared entity "${entity}" + shared token "${aspect}": group ${a.id}'s matching sentence carries a negation marker while group ${b.id}'s does not (closed negation-marker set)`,
          evidence: {
            entity, aspect,
            negatedSentence: matchesA.find((s) => s.negated).sentence,
            affirmedSentence: matchesB.find((s) => !s.negated).sentence,
          },
        };
      }
    }
  }
  return null;
}

/** small.size >= 1, small.size < big.size, and every element of small is in big — the
 *  contradicts/elaborates tests' shared "proper subset" primitive. */
function isProperSubset(small, big) {
  return small.size > 0 && small.size < big.size && [...small].every((t) => big.has(t));
}

/**
 * ELABORATES — one group's graph-grounded entity set is a PROPER SUBSET of the other's: the
 * WIDER group (the superset) elaborates the NARROWER one (the subset) — it covers everything
 * the narrower group's entities do, plus more. Equal entity sets never count (neither is a
 * *proper* subset of the other) — two groups about exactly the same entities are not in an
 * elaboration relationship by this test. Returns `{ wider: "a"|"b", licensingTest, evidence }`
 * or null.
 */
function testElaborates(a, b, graphTerms) {
  const entitiesA = new Set(entitiesOf(a, graphTerms));
  const entitiesB = new Set(entitiesOf(b, graphTerms));
  if (!entitiesA.size || !entitiesB.size) return null;
  if (isProperSubset(entitiesB, entitiesA)) {
    return {
      wider: "a",
      licensingTest: `group ${b.id}'s entity set is a proper subset of group ${a.id}'s — ${a.id} elaborates ${b.id}'s narrower topic`,
      evidence: { widerEntities: [...entitiesA].sort(), narrowerEntities: [...entitiesB].sort() },
    };
  }
  if (isProperSubset(entitiesA, entitiesB)) {
    return {
      wider: "b",
      licensingTest: `group ${a.id}'s entity set is a proper subset of group ${b.id}'s — ${b.id} elaborates ${a.id}'s narrower topic`,
      evidence: { widerEntities: [...entitiesB].sort(), narrowerEntities: [...entitiesA].sort() },
    };
  }
  return null;
}

/**
 * EXEMPLIFIES — `general` names a class-level term (some taught fact has it as the OBJECT of
 * an ISA_PREDICATES edge — i.e. something else is taught to BE one of it), and `instance`
 * names a graph-grounded entity taught to BE one, directly (ISA_PREDICATES edge: instance ->
 * general). Asymmetric and directional by construction: `instance`'s group exemplifies
 * `general`'s group, never the reverse in the same call — callers probe both directions by
 * calling this twice with the groups swapped (see inferRelations below). Returns
 * `{ licensingTest, evidence }` or null.
 */
function testExemplifies(general, instance, rows, graphTerms) {
  const generalEntities = entitiesOf(general, graphTerms);
  const instanceEntities = entitiesOf(instance, graphTerms);
  for (const gA of generalEntities) {
    const isClass = rows.some((r) => ISA_PREDICATES.has(r.predicate) && normFactTerm(r.object) === gA);
    if (!isClass) continue;
    for (const eB of instanceEntities) {
      if (eB === gA) continue;
      const instanceFact = rows.find(
        (r) => ISA_PREDICATES.has(r.predicate) && normFactTerm(r.subject) === eB && normFactTerm(r.object) === gA,
      );
      if (instanceFact) {
        return {
          licensingTest: `"${gA}" is class-level in group ${general.id} (a taught fact has object "${gA}" under ${instanceFact.predicate}); "${eB}" in group ${instance.id} is a taught instance of it (${instanceFact.subject} ${instanceFact.predicate} ${instanceFact.object})`,
          evidence: { generalTerm: gA, instanceTerm: eB, citation: `${instanceFact.subject} ${instanceFact.predicate} ${instanceFact.object}` },
        };
      }
    }
  }
  return null;
}

/**
 * Stage 3 — cross-group inference. For every unordered pair of groups (group.mjs's groupHits()
 * output, or any `{ id, members: [{id, text}] }` array), tests each of the four closed
 * relations (supports/contradicts/elaborates/exemplifies) via its own concrete, named,
 * mechanical licensing test — never prose similarity. A relation only appears in the output
 * when its own test function returns a hit; every hit carries `licensingTest` (a human-
 * readable description of exactly what fired) and `evidence` (the concrete facts/tokens cited)
 * — PLAN_COMPLETIONS.md §2's auditability bar ("every cross-group claim must cite the
 * two-or-more groups and the inference kind that licensed it").
 *
 * @param {Array<{id:string, members:Array<{id:string,text:string}>}>} groups
 * @param {object} memory  an already-loaded memory/core.mjs loadMemory() payload
 * @param {object} [opts]  reserved for future tuning; unused today
 * @returns {Promise<Array<{from:string, to:string, relation:"supports"|"contradicts"|"elaborates"|"exemplifies", licensingTest:string, evidence:object}>>}
 *   deterministic: groups are processed in id-sorted pairwise order, and the final list is
 *   additionally stable-sorted by (from, to, relation) so output order never depends on
 *   incidental iteration order anywhere upstream.
 */
// eslint-disable-next-line no-unused-vars -- opts reserved, see docblock
export async function inferRelations(groups, memory, opts = {}) {
  const list = Array.isArray(groups) ? groups.filter((g) => g && g.id && Array.isArray(g.members)) : [];
  if (list.length < 2) return [];

  const rows = readFactRows(memory);
  const graphTerms = buildGraphTerms(rows);
  const helpers = makeHelpers(rows);
  const relationNames = relationNameCandidates(rows);

  const sorted = list.slice().sort((x, y) => x.id.localeCompare(y.id));
  const out = [];

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const A = sorted[i];
      const B = sorted[j];

      // eslint-disable-next-line no-await-in-loop -- deterministic fixed-order pairwise search
      const sup = await testSupports(A, B, memory, helpers, relationNames, graphTerms);
      if (sup) out.push({ from: A.id, to: B.id, relation: "supports", licensingTest: sup.licensingTest, evidence: sup.evidence });

      const con = testContradicts(A, B, graphTerms);
      if (con) out.push({ from: A.id, to: B.id, relation: "contradicts", licensingTest: con.licensingTest, evidence: con.evidence });

      const ela = testElaborates(A, B, graphTerms);
      if (ela) {
        const from = ela.wider === "a" ? A.id : B.id;
        const to = ela.wider === "a" ? B.id : A.id;
        out.push({ from, to, relation: "elaborates", licensingTest: ela.licensingTest, evidence: ela.evidence });
      }

      // Both directions probed independently — "A exemplifies B" and "B exemplifies A" are
      // genuinely different claims, each licensed (or not) by its own class/instance test.
      const bExemplifiesA = testExemplifies(A, B, rows, graphTerms);
      if (bExemplifiesA) out.push({ from: B.id, to: A.id, relation: "exemplifies", licensingTest: bExemplifiesA.licensingTest, evidence: bExemplifiesA.evidence });
      const aExemplifiesB = testExemplifies(B, A, rows, graphTerms);
      if (aExemplifiesB) out.push({ from: A.id, to: B.id, relation: "exemplifies", licensingTest: aExemplifiesB.licensingTest, evidence: aExemplifiesB.evidence });
    }
  }

  out.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to) || x.relation.localeCompare(y.relation));
  return out;
}
