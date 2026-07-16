// completions/infer.mjs — Stage 3 ("inference between groups"): applies the injected
// resolveRelationChase to relationships BETWEEN retrieved text groups, not just graph facts.
// Four relations (supports/contradicts/elaborates/exemplifies), each with its own named
// licensing test — see the four test*() functions below. A relation is asserted only when its
// test concretely licenses it, never from prose similarity.
//
// Entities are a group's content tokens narrowed to graph-known terms (normFactTerm-matched
// against loaded facts) — sharing an English word alone never licenses a relation.

import { splitSentences } from "./rank.mjs";
import { STOPWORDS } from "../prose.mjs";
import { findActionPath, findReachableSet } from "../planning.mjs";
import { requireInjected } from "./injected.mjs";

// Same content-token filter group.mjs/rank.mjs apply to their own adjacency/ranking; not
// exported from either, so replicated here rather than reached across files.
const isContentToken = (t) => /^[a-z0-9]+$/.test(t) && !STOPWORDS.has(t);

/** tokenizeBlock(text), narrowed to real content tokens — see isContentToken above. */
function makeContentTokens(tokenizeBlock) {
  return (text) => tokenizeBlock(text).filter(isContentToken);
}

// Local copy of chat.mjs's private HAS_PROPERTY_PREDICATE constant — not exported, so callers
// supply their own copy in the `helpers` bag resolveRelationChase expects.
const HAS_PROPERTY_PREDICATE = "mgx:hasProperty";

// The taught ISA-family predicates (stored edges only, not their transitive closure).
const ISA_PREDICATES = new Set(["rdfs:subClassOf", "rdf:type"]);

// The contradicts test's closed negation-marker vocabulary, checked against RAW sentence
// text (contentTokens() strips "not"/"no" as stopword filler, which would erase this signal).
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
function groupContentTokenSet(group, { contentTokens }) {
  const set = new Set();
  for (const m of group?.members || []) {
    for (const t of contentTokens(m?.text || "")) set.add(t);
  }
  return set;
}

/** Every sentence across a group's members, pre-split (rank.mjs's own splitSentences — reused
 *  verbatim, no re-implementation), each carrying its own content-token set and negation flag
 *  — the exact per-sentence facts the contradicts test needs. */
function sentencesOf(group, { contentTokens }) {
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
function buildGraphTerms(rows, normFactTerm) {
  const set = new Set();
  for (const r of rows) {
    const s = normFactTerm(r.subject);
    const o = normFactTerm(r.object);
    if (s) set.add(s);
    if (o) set.add(o);
  }
  return set;
}

/** A group's GRAPH-GROUNDED entities: content tokens narrowed to graph-known terms, sorted. */
function entitiesOf(group, grounding) {
  return [...groupContentTokenSet(group, grounding)].filter((t) => grounding.graphTerms.has(t)).sort();
}

/** A minimal relationFactsFor(name): direct-predicate match only (`mgx:${name}`), no
 *  alias/subClassOf chase — sufficient for this test's licensing standard. */
function makeRelationFactsFor(rows) {
  return (name) => rows
    .filter((f) => f.predicate === `mgx:${name}`)
    .map((f) => ({ fact: f, aliasFacts: [] }));
}

/** The resolveRelationChase/resolveRelationChaseReverse `helpers` bag this file supplies,
 *  built once per inferRelations() call over the loaded memory's fact rows. */
function makeHelpers(rows) {
  return {
    relationFactsFor: makeRelationFactsFor(rows),
    renderFactLine: (f) => `${f.subject} ${f.predicate} ${f.object}`,
    factPhrase: (f) => `${f.subject} ${f.predicate} ${f.object}`,
    factTermVariants: (normFn, term) => new Set([normFn(term)]),
    byTrust: (a, b) => (b.trust ?? 0) - (a.trust ?? 0),
    rows,
    HAS_PROPERTY_PREDICATE,
    findActionPath,
    findReachableSet,
  };
}

/** Every distinct relation NAME present among the loaded facts (`mgx:<name>` predicates,
 *  minus HAS_PROPERTY_PREDICATE, a property marker not a relation name). Sorted. */
function relationNameCandidates(rows) {
  const names = new Set();
  for (const r of rows) {
    if (r.predicate === HAS_PROPERTY_PREDICATE) continue;
    if (!String(r.predicate || "").startsWith("mgx:")) continue;
    names.add(r.predicate.slice("mgx:".length).toLowerCase());
  }
  return [...names].sort();
}

/** SUPPORTS — groups A/B share >=2 graph-grounded entities AND a taught relation fact
 *  connects two of them. Tries every (subject, object) pair against every candidate relation
 *  name in fixed sorted order; first hit wins. Returns `{ licensingTest, evidence }` or null. */
async function testSupports(a, b, grounding) {
  const { memory, helpers, relationNames, resolveRelationChase } = grounding;
  const entitiesA = entitiesOf(a, grounding);
  const entitiesB = entitiesOf(b, grounding);
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

/** CONTRADICTS — groups A/B share a graph-grounded entity plus a second co-occurring token
 *  ("aspect"), and one side's matching sentence is negated while the other's isn't. Returns
 *  `{ licensingTest, evidence }` or null. */
function testContradicts(a, b, grounding) {
  const entitiesA = entitiesOf(a, grounding);
  const entitiesB = entitiesOf(b, grounding);
  const sharedEntities = entitiesA.filter((e) => entitiesB.includes(e));
  if (!sharedEntities.length) return null;

  const tokensA = groupContentTokenSet(a, grounding);
  const tokensB = groupContentTokenSet(b, grounding);
  const sharedTokens = [...tokensA].filter((t) => tokensB.has(t)).sort();

  const sentencesA = sentencesOf(a, grounding);
  const sentencesB = sentencesOf(b, grounding);

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

/** ELABORATES — one group's graph-grounded entity set is a PROPER SUBSET of the other's; the
 *  wider group elaborates the narrower one. Equal sets never count. Returns
 *  `{ wider: "a"|"b", licensingTest, evidence }` or null. */
function testElaborates(a, b, grounding) {
  const entitiesA = new Set(entitiesOf(a, grounding));
  const entitiesB = new Set(entitiesOf(b, grounding));
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

/** EXEMPLIFIES — `general` names a class-level term (object of an ISA_PREDICATES edge), and
 *  `instance` names an entity taught to BE one directly. Asymmetric: callers probe both
 *  directions by calling this twice with groups swapped (see inferRelations below). Returns
 *  `{ licensingTest, evidence }` or null. */
function testExemplifies(general, instance, grounding) {
  const { rows, normFactTerm } = grounding;
  const generalEntities = entitiesOf(general, grounding);
  const instanceEntities = entitiesOf(instance, grounding);
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
 * Stage 3 — cross-group inference. For every unordered pair of groups, tests each of the four
 * closed relations and includes a hit only when its test function fires.
 *
 * @param {Array<{id:string, members:Array<{id:string,text:string}>}>} groups
 * @param {object} memory  an already-loaded loadMemory() payload
 * @param {object} [opts]
 * @param {object} opts.store  REQUIRED — the memory store's `{ readFactRows, normFactTerm,
 *   resolveRelationChase }` readers plus the block store's `{ tokenizeBlock }` helper
 * @returns {Promise<Array<{from:string, to:string, relation:"supports"|"contradicts"|"elaborates"|"exemplifies", licensingTest:string, evidence:object}>>}
 *   deterministic: id-sorted pairwise order, stable-sorted by (from, to, relation).
 */
export async function inferRelations(groups, memory, { store } = {}) {
  const { readFactRows, normFactTerm, resolveRelationChase, tokenizeBlock } = requireInjected(
    store, ["readFactRows", "normFactTerm", "resolveRelationChase", "tokenizeBlock"],
    { caller: "inferRelations", option: "store" },
  );
  const list = Array.isArray(groups) ? groups.filter((g) => g && g.id && Array.isArray(g.members)) : [];
  if (list.length < 2) return [];

  const rows = readFactRows(memory);
  // Everything the four licensing tests read, resolved once per call: the injected store
  // handles, the loaded fact rows, and the indexes derived from them.
  const grounding = {
    memory,
    rows,
    normFactTerm,
    resolveRelationChase,
    contentTokens: makeContentTokens(tokenizeBlock),
    graphTerms: buildGraphTerms(rows, normFactTerm),
    helpers: makeHelpers(rows),
    relationNames: relationNameCandidates(rows),
  };

  const sorted = list.slice().sort((x, y) => x.id.localeCompare(y.id));
  const out = [];

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const A = sorted[i];
      const B = sorted[j];

      // eslint-disable-next-line no-await-in-loop -- deterministic fixed-order pairwise search
      const sup = await testSupports(A, B, grounding);
      if (sup) out.push({ from: A.id, to: B.id, relation: "supports", licensingTest: sup.licensingTest, evidence: sup.evidence });

      const con = testContradicts(A, B, grounding);
      if (con) out.push({ from: A.id, to: B.id, relation: "contradicts", licensingTest: con.licensingTest, evidence: con.evidence });

      const ela = testElaborates(A, B, grounding);
      if (ela) {
        const from = ela.wider === "a" ? A.id : B.id;
        const to = ela.wider === "a" ? B.id : A.id;
        out.push({ from, to, relation: "elaborates", licensingTest: ela.licensingTest, evidence: ela.evidence });
      }

      // Both directions probed independently — different claims, each its own test.
      const bExemplifiesA = testExemplifies(A, B, grounding);
      if (bExemplifiesA) out.push({ from: B.id, to: A.id, relation: "exemplifies", licensingTest: bExemplifiesA.licensingTest, evidence: bExemplifiesA.evidence });
      const aExemplifiesB = testExemplifies(B, A, grounding);
      if (aExemplifiesB) out.push({ from: A.id, to: B.id, relation: "exemplifies", licensingTest: aExemplifiesB.licensingTest, evidence: aExemplifiesB.evidence });
    }
  }

  out.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to) || x.relation.localeCompare(y.relation));
  return out;
}
