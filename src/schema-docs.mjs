// schema-docs.mjs — the single source of truth for tmct's own ontology documentation.
//
// tmct's typed graph (src/graph-build.mjs's buildEntities, queried by codegraph.mjs)
// has had its schema documented since day one, but only in scattered code comments
// (graph-build.mjs's header, the `note` fields on some — not all — of the `vocabulary`
// array entries it emits) — readable by a human editing the source, invisible to anything
// that only sees graph.json. This file completes that documentation (every entity class,
// every predicate actually emitted — verified against real `prop:`/`class:` literals in
// graph-build.mjs, not just what the existing vocabulary array already claimed) and
// `ingestSchemaDocs()` (called by a graph writer after buildEntities) merges it
// into a graph build so a question like "what does cochange mean" or "what is a
// Commit" is answerable by querying the SAME graph the same way any other question is —
// not via separate hardcoded documentation logic.
//
// GLOBAL, NOT PER-REPO: this documentation does not vary by repository — "Module" means
// the same thing indexing Django or a JS library — so it is static, committed data
// (this file), never recomputed at index time. Ingesting it is a fixed-size merge, not a
// computation (see the ~0ms measured delta in schema-docs.test.mjs).
//
// Mirrors the pattern in marginalia's app/lib/vocab.mjs (a `comment`/description per
// schema term, single-sourced) minus the RDF/OWL external-alignment machinery, which
// doesn't apply here — tmct's schema is code-relationship-specific, not general-domain.

// ---- entity classes (7 — verified against every `class: "X"` individual literal in
// graph-build.mjs) -----------------------------------------------------------------------
export const CLASS_DOCS = Object.freeze([
  { name: "Module", description:
    "A source file — one importable unit within the indexed repository (a .py/.mjs/.ts/" +
    ".cs/.java file, etc). The coarsest unit tmct ranks, locates, and injects as a " +
    "digest; every other entity class belongs to exactly one Module." },
  { name: "Class", description:
    "A class definition inside a Module. Contains Methods and Attributes (seon:" +
    "containsCodeEntity) and may declare a base class (seon:hasSuperType)." },
  { name: "Function", description:
    "A top-level, module-scope function definition — not a method (methods belong to a " +
    "Class and are their own entity class)." },
  { name: "Method", description:
    "A function defined inside a Class — an instance, static, or class method. Distinct " +
    "from Function so class membership (seon:containsCodeEntity) and free functions " +
    "never get confused." },
  { name: "Attribute", description:
    "A field or property belonging to a Class — either a class-level assignment or a " +
    "self-scoped instance field seen in a method body (self.<name> =). Distinct from a " +
    "module-level GlobalVariable." },
  { name: "GlobalVariable", description:
    "A module-level variable or constant assignment that belongs to no Class or " +
    "function — a name defined directly in a Module's top-level scope." },
  { name: "Commit", description:
    "A single recorded git commit. Carries author/date/message attributes and connects " +
    "to the Modules it touched (mgx:touchedByCommit) and, more precisely, the specific " +
    "symbols whose current source span its changed lines intersect (mgx:touchesSymbol)." },
  { name: "Session", description:
    "One recorded `tmct chat` session — a runtime observation, not a source " +
    "derivation. Carries started/ended timestamps (temporal ordering, like a Commit's " +
    "date), a turn count and the queries asked, and connects to the entities its turns " +
    "resolved or answered with (mgx:asksAbout). Recorded under .tmct/sessions/ and " +
    "re-attached on every re-index (sessions.mjs)." },
]);

// ---- predicates / attributes (every `prop:` token actually emitted by buildEntities,
// verified by grep against graph-build.mjs — not just what the pre-existing `vocabulary`
// array already documented; three real gaps found this way: seon:startsAt, mgx:value,
// mgx:dotted, plus the prose second-pass's mgx:hasProseTokens) ------------------------
export const PREDICATE_DOCS = Object.freeze([
  // ---- object properties (edges between individuals) ----
  { prop: "mgx:importsNamespace", kind: "imports", description:
    "Module → Module. The subject module has a top-level import statement that resolves " +
    "to a module already present in this repository's index. External/unresolved " +
    "imports are dropped, never guessed." },
  { prop: "mgx:callsCoarse", kind: "calls", description:
    "Module → Module. An import-backed, module-granular \"this file calls into that " +
    "file\" edge — not resolved to a specific symbol (see callsSymbol for that)." },
  { prop: "mgx:callsSymbol", kind: "callsSymbol", description:
    "Function/Method → Function/Class. A call site resolved to exactly one same-named " +
    "definition in the repository — unambiguous names only; an ambiguous or external " +
    "call is dropped rather than guessed (no wrong edge)." },
  { prop: "seon:declaresMethod", kind: "defines", description:
    "Module → Function/Class/Method/Attribute/GlobalVariable. What a module's top-level " +
    "scope actually declares." },
  { prop: "seon:containsCodeEntity", kind: "contains", description:
    "Class → Method/Attribute. Class membership — which methods and fields belong to " +
    "which class." },
  { prop: "mgx:touchedByCommit", kind: "touches", description:
    "Commit → Module. From `git log --name-only`, restricted to modules already in the " +
    "index — which files a commit's diff lists, at file granularity." },
  { prop: "mgx:touchesSymbol", kind: "touchesSymbol", description:
    "Commit → Function/Method/Class/Attribute. A commit's changed-line-range intersected " +
    "with a symbol's current source span — WHICH specific function or class a commit " +
    "actually edited, not just which file it touched." },
  { prop: "mgx:testsCoverage", kind: "tests", description:
    "Module → Module. A test module's own internal imports — a lightweight \"this test " +
    "file exercises that source file\" signal, not line-level coverage-tool data." },
  { prop: "seon:hasSuperType", kind: "inherits", description:
    "Class → Class. A class's base class, resolved to an internal Class when the name " +
    "matches one defined in the repo; otherwise recorded as an external `ext:` reference." },
  { prop: "mgx:changeCoupledWith", kind: "cochange", description:
    "Module ↔ Module. Two modules frequently committed together, independent of any " +
    "import or call relationship — surfaces coupling that static analysis alone misses " +
    "(e.g. a module and its test file, or two files that always change together for a " +
    "reason no import edge captures)." },
  { prop: "mgx:reExports", kind: "reexports", description:
    "Module → Function/Class. A module's public-API (`__all__`) entry that re-exports a " +
    "symbol defined or imported elsewhere — answers \"where is X importable from,\" not " +
    "just \"where is X defined.\"" },
  { prop: "mgx:asksAbout", kind: "asksAbout", description:
    "Session → any entity. A chat session's turn resolved this entity as its subject " +
    "or cited it in the answer — which parts of the codebase a human actually asked " +
    "about. A runtime observation (owned term, no SEON equivalent); references that no " +
    "longer resolve after a re-index are dropped and counted, never guessed." },
  { prop: "mgx:hasProseTokens", kind: "prose", description:
    "Individual → word tokens (an attribute, not a between-individuals edge). The " +
    "decomposed word sequence extracted from an identifier's name (camelCase/snake_case " +
    "split) and any doc-comment prose, used by the second-pass prose-to-symbol " +
    "cross-reference index (PLAN_PROSE_INDEX.md) to resolve free-text object terms that " +
    "don't exact-match an identifier." },

  // ---- attributes (individual-scoped facts, not edges) ----
  { prop: "seon:startsAt", kind: "attribute", description:
    "The `path:line` or `path:start-end` source location of a Function/Method/Class/" +
    "Attribute/GlobalVariable — where in its Module the definition actually lives." },
  { prop: "mgx:dotted", kind: "attribute", description:
    "A Module's dotted import name (e.g. `pkg.sub.mod` for Python), when the language " +
    "has one — used to resolve import statements to internal modules." },
  { prop: "mgx:exportsAll", kind: "attribute", description:
    "A Module's literal `__all__` membership list, stored even for entries that don't " +
    "resolve to a real symbol — so the digest can always tell an agent \"this module has " +
    "an __all__, add your new symbol to it.\"" },
  { prop: "mgx:decorator", kind: "attribute", description:
    "Python/framework decorators applied to a Function/Method/Class definition (e.g. " +
    "`@property`, `@app.route(...)`), as written." },
  { prop: "mgx:value", kind: "attribute", description:
    "The literal right-hand-side value of a GlobalVariable's assignment, when the AST " +
    "extractor could capture one cheaply (a constant or simple literal)." },
  { prop: "mgx:sessionStarted", kind: "attribute", description:
    "A chat Session's start time, ISO-8601 — the timestamp the session enters the " +
    "timeline at (the Session analogue of a Commit's date)." },
  { prop: "mgx:sessionEnded", kind: "attribute", description:
    "A chat Session's end time, ISO-8601 (the /exit, EOF, or last recorded turn)." },
  { prop: "mgx:sessionTurns", kind: "attribute", description:
    "How many query turns a chat Session ran (non-empty, non-/exit inputs)." },
  { prop: "mgx:sessionQueries", kind: "attribute", description:
    "The queries a chat Session asked, ' | '-joined and length-capped — what the " +
    "human wanted to know, in their own words." },
  { prop: "mgx:sessionDroppedEdges", kind: "attribute", description:
    "How many of a Session's recorded entity references could not be re-resolved " +
    "against the current graph (renamed/removed code) — those edges are dropped, " +
    "never guessed, and this attribute keeps the loss honest and visible." },
  { prop: "mgx:commitAuthor", kind: "attribute", description: "A Commit's author name (git %an)." },
  { prop: "mgx:commitDate", kind: "attribute", description:
    "A Commit's author date, ISO-8601 (git %aI)." },
  { prop: "mgx:commitMessage", kind: "attribute", description:
    "A Commit's subject line (git %s), capped to 120 characters." },
  { prop: "seon:hasParameter", kind: "attribute", description:
    "A Function/Method's formal parameter list, as a signature string (the AST's " +
    "unparsed argument list — not resolved types)." },
  { prop: "seon:hasReturnType", kind: "attribute", description:
    "A Function/Method's return type ANNOTATION exactly as written — not an inferred or " +
    "resolved type." },
  { prop: "seon:throwsException", kind: "attribute", description:
    "Exception class names literally named in a `raise` statement inside the definition — " +
    "not resolved to their own Class individuals." },
  { prop: "seon:catchesException", kind: "attribute", description:
    "Exception type names literally named in an `except` handler inside the definition." },
  { prop: "seon:accessesField", kind: "attribute", description:
    "`self.<field>` names a Method reads or writes — self-scoped only (an honest, " +
    "narrow signal, not general data-flow analysis)." },
  { prop: "seon:isStatic", kind: "attribute", description:
    "The definition is decorated `@staticmethod` or `@classmethod`." },
  { prop: "seon:isAbstract", kind: "attribute", description:
    "The definition is decorated `@abstractmethod` or `@abstractproperty`." },
  { prop: "seon:isConstant", kind: "attribute", description:
    "An ALL_CAPS module-level GlobalVariable — a naming-convention signal, not enforced " +
    "immutability." },
  { prop: "seon:subKind", kind: "attribute", description:
    "The flavour of a Class define when it is not a plain class: interface, enum, struct " +
    "or record. The graph keeps kind=class for every type declaration; this attribute " +
    "carries the distinction." },
  { prop: "seon:hasAccessModifier", kind: "attribute", description:
    "Visibility inferred from a leading underscore (private/protected); a public member " +
    "carries no value for this attribute." },
  { prop: "seon:hasDoc", kind: "attribute", description:
    "The first line of a docstring, length-capped — a one-line purpose summary without " +
    "the full docstring body." },
]);

const classDocByName = new Map(CLASS_DOCS.map((c) => [c.name, c]));
const predicateDocByProp = new Map(PREDICATE_DOCS.map((p) => [p.prop, p]));

/** Meta-individual ids are namespaced (`schema:class:`/`schema:predicate:`) so they can
 *  never collide with a real code entity's id (`mod:`/`fn:`/`commit:`) and are trivially
 *  filterable out of normal code-entity queries by anything that cares to. */
const classIndividual = ({ name, description }) => ({
  id: `schema:class:${name}`,
  label: name,
  class: "SchemaClass",
  derived_from: [],
  mentions: [],
  attributes: [{ prop: "mgx:schemaDoc", key: "doc", value: description }],
});

const predicateIndividual = ({ prop, kind, description }) => ({
  id: `schema:predicate:${prop}`,
  // The label is the human-facing relation name (what a user would actually type — "what
  // does cochange mean" — matching ask-vocab.mjs's VERB_TO_KIND/kind vocabulary), not the
  // raw prop token; the token is kept as a separate attribute for exact lookup.
  label: kind,
  class: "SchemaPredicate",
  derived_from: [],
  mentions: [],
  attributes: [
    { prop: "mgx:schemaDoc", key: "doc", value: description },
    { prop: "mgx:schemaToken", key: "token", value: prop },
  ],
});

/** Merge the static schema documentation into a just-built `entities` payload (the
 *  object `buildEntities` returns, before it's serialized to graph.json):
 *   - `entities.classes[].description` filled in for every known class,
 *   - `entities.vocabulary[].note` backfilled wherever it was missing (existing notes
 *     are left as-is — this only fills gaps, it doesn't overwrite a human's wording),
 *   - `entities.individuals` gains one SchemaClass + one SchemaPredicate individual per
 *     documented term, so the SAME graph traversal that answers "what calls X" can also
 *     answer "what is a Commit" or "what does cochange mean".
 *  Mutates and returns `entities`. Idempotent (safe to call more than once — individuals
 *  are only appended if not already present by id). Pure w.r.t. repo content: the output
 *  is identical regardless of what was indexed. */
export function ingestSchemaDocs(entities) {
  if (!entities || typeof entities !== "object") return entities;

  if (Array.isArray(entities.classes)) {
    for (const c of entities.classes) {
      const doc = classDocByName.get(c.name);
      if (doc && c.description === undefined) c.description = doc.description;
    }
  }
  if (Array.isArray(entities.vocabulary)) {
    for (const v of entities.vocabulary) {
      const doc = predicateDocByProp.get(v.prop);
      if (doc && !v.note) v.note = doc.description;
    }
  }

  entities.individuals ||= [];
  const existingIds = new Set(entities.individuals.map((i) => i?.id));
  for (const c of CLASS_DOCS) {
    const ind = classIndividual(c);
    if (!existingIds.has(ind.id)) { entities.individuals.push(ind); existingIds.add(ind.id); }
  }
  for (const p of PREDICATE_DOCS) {
    const ind = predicateIndividual(p);
    if (!existingIds.has(ind.id)) { entities.individuals.push(ind); existingIds.add(ind.id); }
  }
  return entities;
}
