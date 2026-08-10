// corpus/research-source.mjs — the contract a research SOURCE adapter meets,
// written down from the seam that already exists rather than beside it.
//
// The research lane (src/services/research.mjs) talks to one provider behind
// registerResearchProvider/getResearchProvider in wikipedia-live.mjs. What the
// lane reads off that provider is `lookup(term)` returning a reference-pack
// article row (or null), plus two optional fan-out reads it feature-tests
// before calling. This module writes that shape down. It adds the two things a
// source says about itself, its name and the origin it fetches from, and names
// the provenance tag its facts carry.
//
// It also holds the registry the contract test and the claims rig walk. An
// adapter registers a factory here. A caller builds one source from that entry
// against a stub transport (the test) or against the live endpoint (the rig).
//
// No node builtins: the browser bundles import the adapters that import this.

import { normFactTerm } from "../../domain/hash.mjs";
import { isReferenceArticleRow } from "../../domain/reference-pack.mjs";

/** The closed predicate set a research source may map onto: the seed ontology's
 *  own relation vocabulary (src/services/init.mjs SEED_PREFER, and the tmct
 *  predicates src/adapters/corpus/conceptnet-map.toml emits). A source that
 *  needs a relation missing here adds it to this list first. That keeps every
 *  alignment decision visible in one place instead of spread through the
 *  adapters. */
export const RESEARCH_SOURCE_RELATIONS = Object.freeze([
  "rdf:type",
  "rdfs:subClassOf",
  "mgx:partOf",
  "mgx:hasA",
  "mgx:usedFor",
  "mgx:capableOf",
  "mgx:atLocation",
  "mgx:causes",
  "mgx:madeOf",
  "mgx:createdBy",
  "mgx:locatedNear",
  "mgx:hasProperty",
]);

/** One fact a source contributes: {subject, predicate, object, provenance},
 *  every field a non-empty string, the predicate one of
 *  RESEARCH_SOURCE_RELATIONS. The provenance field is required here and not
 *  optional anywhere: a fact with no tag has no way into the graph. */
export function isResearchFact(fact) {
  if (!fact || typeof fact !== "object") return false;
  for (const field of ["subject", "predicate", "object", "provenance"]) {
    if (typeof fact[field] !== "string" || !fact[field]) return false;
  }
  return RESEARCH_SOURCE_RELATIONS.includes(fact.predicate);
}

/** What `lookup(term)` resolves to: the shipped reference pack's own article
 *  row ({term, title, text, summary, url, revid, isa?, source?, licence?}),
 *  optionally carrying `facts` — the triples a source that reads STRUCTURED
 *  data mapped at its own boundary. A prose source carries no `facts` and
 *  licenses its isa instead. */
export function isResearchSourceRow(row) {
  if (!isReferenceArticleRow(row)) return false;
  if (row.facts === undefined) return true;
  return Array.isArray(row.facts) && row.facts.length > 0 && row.facts.every(isResearchFact);
}

/** The adapter interface: a `name` it goes by, the `origin` it fetches from,
 *  `lookup(term)` and `provenanceTag(term)`. `pageByTitle`/`linkedTitles` stay
 *  optional, because the lane feature-tests both before calling either. */
export function isResearchSource(source) {
  return !!source && typeof source === "object"
    && typeof source.name === "string" && source.name.length > 0
    && typeof source.origin === "string" && source.origin.startsWith("https://")
    && typeof source.lookup === "function"
    && typeof source.provenanceTag === "function";
}

/** The provenance tag every fact gained through a research source carries:
 *  `research:<source>:<folded term>`. memory/trust.mjs reads the `research:`
 *  prefix back as a referenceLive Source, so a live-fetched fact scores below
 *  every curated pack, and the source segment keeps which adapter fetched it
 *  readable off the fact itself. */
export function researchSourceTag(sourceName, term) {
  return `research:${sourceName}:${normFactTerm(term)}`;
}

/** The facts a looked-up row licenses, each stamped with the source's own tag.
 *  A structured source mapped its claims at its adapter boundary and carries
 *  them on `facts`; a prose source licenses its first-sentence isa as one
 *  subClassOf edge, the same edge the chat ingest reads off the row. A null row
 *  licenses nothing, so a miss stays a miss. */
export function researchFacts(source, term, row) {
  if (!row) return [];
  const provenance = source.provenanceTag(term);
  if (Array.isArray(row.facts)) {
    return row.facts.map(({ subject, predicate, object }) => ({ subject, predicate, object, provenance }));
  }
  if (row.isa && row.term && row.isa !== row.term) {
    return [{ subject: row.term, predicate: "rdfs:subClassOf", object: row.isa, provenance }];
  }
  return [];
}

const sourceFactories = new Map();

/** Register a source adapter's factory: `{ name, create(options) -> source }`.
 *  The factory takes the same option bag the adapter's own constructor does, so
 *  a caller can hand it a stub transport. Re-registering a name replaces the
 *  entry, which keeps a module-scope registration idempotent. */
export function registerResearchSource(entry) {
  if (!entry || typeof entry.name !== "string" || !entry.name || typeof entry.create !== "function") {
    throw new Error("registerResearchSource: expected { name, create(options) }");
  }
  sourceFactories.set(entry.name, { name: entry.name, create: entry.create });
}

/** Every registered source factory, name-sorted so a caller that walks them
 *  reads them in the same order every run. An adapter module registers on
 *  import, so this lists exactly the adapters the caller imported. */
export function researchSources() {
  return [...sourceFactories.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The config-facing choice words a user, tmct.toml or a CLI flag may name.
 *  "wikipedia" and "simple-wikipedia" are deliberate synonyms — both name the
 *  same registered source, "wikipedia" for backward compatibility with the
 *  original single-source config, "simple-wikipedia" so the news `kb_sources`
 *  list (news-sources.mjs) can name every source by the same id its own
 *  registry uses. "simple-wikipedia-pack" names its offline sibling — the
 *  shipped reference pack read as a research source, no network at all. */
export const RESEARCH_SOURCE_CHOICES = Object.freeze([
  "wikipedia", "wikidata", "simple-wikipedia", "simple-wikipedia-pack", "wiktionary", "dbpedia",
]);
export const DEFAULT_RESEARCH_SOURCE_CHOICE = "wikipedia";

const CHOICE_TO_SOURCE_NAME = Object.freeze({
  wikipedia: "simple-wikipedia",
  wikidata: "wikidata",
  "simple-wikipedia": "simple-wikipedia",
  "simple-wikipedia-pack": "simple-wikipedia-pack",
  wiktionary: "wiktionary",
  dbpedia: "dbpedia-lookup",
});

/** The config-facing choice folded to a known one — an absent, empty or
 *  unrecognized value reads as the default. */
export function normalizeResearchChoice(choice) {
  return RESEARCH_SOURCE_CHOICES.includes(choice) ? choice : DEFAULT_RESEARCH_SOURCE_CHOICE;
}

/** The registered SOURCE NAME a choice selects ("wikipedia" → "simple-wikipedia"). */
export function researchSourceNameFor(choice) {
  return CHOICE_TO_SOURCE_NAME[normalizeResearchChoice(choice)];
}
