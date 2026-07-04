// ask-cascade.test.mjs — the progressive-relaxation parse cascade (SHRDLU in a code
// graph, with a Zork parser's forgiveness). The cascade wraps the WHOLE existing parse
// and fires ONLY when the direct parse of the normalized query would MISS; it walks
// increasingly-permissive layers — NOISE-STRIP (drop one curated filler/politeness/
// vocative token at a time), DROP-UNMATCHED (drop plain-word unknowns beside the real
// terms), SYNONYM-NORMALISE (rewrite a near-canonical word onto the closed vocabulary) —
// re-attempting the full parse after each, and bottoms out in the SAME honest miss +
// rephrase hint. It only ever DROPS noise/unmatched words or NORMALISES to the closed
// vocab; it never invents a term or guesses an entity, and a clean direct hit never
// enters it (relaxed === null). buildEntities/parseEntities build a REAL graph, exactly
// like ask.test.mjs, so these exercise the true traverse/render pipeline end-to-end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntities } from "../src/extract.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { ask, relaxParse } from "../src/ask.mjs";

// A small fixture: exactly three classes (Apple/Banana/Cherry), a module walk.mjs
// imported by two others (src/a.mjs, src/b.mjs), and a function buildContextBundle
// called by another (a callsSymbol edge). Enough to exercise every cascade layer.
const MODULES = [
  { path: "src/walk.mjs", dotted: "src.walk", imports: [], calls: [], defines: [{ name: "walk", kind: "function", lineno: 1, decorators: [] }] },
  { path: "src/a.mjs", dotted: "src.a", imports: ["src.walk"], calls: [], defines: [{ name: "Apple", kind: "class", lineno: 1, decorators: [] }] },
  { path: "src/b.mjs", dotted: "src.b", imports: ["src.walk"], calls: [], defines: [{ name: "Banana", kind: "class", lineno: 1, decorators: [] }] },
  { path: "src/c.mjs", dotted: "src.c", imports: [], calls: [], defines: [{ name: "Cherry", kind: "class", lineno: 1, decorators: [] }] },
  { path: "src/ctx.mjs", dotted: "src.ctx", imports: [], calls: [], defines: [{ name: "buildContextBundle", kind: "function", lineno: 1, decorators: [] }] },
  { path: "src/caller.mjs", dotted: "src.caller", imports: ["src.ctx"], calls: [], defines: [{ name: "caller", kind: "function", lineno: 1, decorators: [], calls: ["buildContextBundle"] }] },
];
function buildGraph() {
  const entities = buildEntities(MODULES, []);
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}
// Every arm forces nlp:null — the cascade is a deterministic, adapter-free layer, and
// pinning the adapter off proves it needs no lemma/POS model (it rides in the inlined
// viewer bundle unchanged).
const OPTS = { nlp: null };

// ---- 1. the operator's worked example: NOISE-STRIP rescues a polite, vocative query ----

test("cascade NOISE-STRIP: 'Please count the classes matey' → counts the classes (politeness + vocative stripped)", () => {
  const graph = buildGraph();
  const r = ask(graph, "Please count the classes matey", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./); // Apple, Banana, Cherry
  // the cascade WAS used, and it stripped the noise words (order-independent set check)
  assert.notEqual(r.seonix_ask.relaxed, null);
  assert.equal(r.seonix_ask.relaxed.to, "count classes");
  assert.deepEqual([...r.seonix_ask.relaxed.dropped].sort(), ["matey", "the"]);
});

test("cascade NOISE-STRIP: 'could you show me what imports walk.mjs please' → the importers", () => {
  const graph = buildGraph();
  const r = ask(graph, "could you show me what imports walk.mjs please", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  // src/a.mjs and src/b.mjs import walk.mjs
  assert.match(r.content, /src\/a\.mjs/);
  assert.match(r.content, /src\/b\.mjs/);
  assert.notEqual(r.seonix_ask.relaxed, null);
  assert.equal(r.seonix_ask.relaxed.to, "what imports walk.mjs");
});

// ---- 2. DROP-UNMATCHED: an unknown content word beside a valid one is dropped ----

test("cascade DROP-UNMATCHED: 'count the frobnicate classes' → drops the unknown, counts the classes", () => {
  const graph = buildGraph();
  const r = ask(graph, "count the frobnicate classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./);
  assert.ok(r.seonix_ask.relaxed.dropped.includes("frobnicate"), "the unknown word was dropped");
  assert.equal(r.seonix_ask.relaxed.to, "count classes");
});

test("cascade DROP-UNMATCHED: an identifier-shaped unknown ('frobnicate the classes') that leaves nothing to run is an HONEST miss, never a guess", () => {
  const graph = buildGraph();
  // "frobnicate" is dropped and "the" stripped, but a bare "classes" is no executable
  // query (there is no list-all-classes verb) — so the cascade honestly bottoms out.
  const r = ask(graph, "frobnicate the classes", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.equal(r.seonix_ask.relaxed, null); // no relaxation could rescue it → original miss kept
  assert.match(r.content, /couldn't parse this as a graph question/);
});

// ---- 3. SYNONYM-NORMALISE: a near-canonical count word is rewritten to the vocab ----

test("cascade SYNONYM-NORMALISE: 'tally the classes' → normalises 'tally' to 'count'", () => {
  const graph = buildGraph();
  const r = ask(graph, "tally the classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./);
  assert.equal(r.seonix_ask.relaxed.to, "count classes");
  assert.ok(r.seonix_ask.relaxed.steps.some((s) => /normalise synonyms/.test(s)), "the synonym layer fired");
});

// ---- 3b. TRIGGER-TYPO correction: a typo of an aggregate/list trigger is CORRECTED
//         (curated MISSPELLINGS, or the cascade's bounded fuzzy backstop), never dropped —
//         so the count/list INTENT survives instead of being lost with the token ----

test("trigger-typo (curated): 'how manyn classes are there' → the class count (manyn→many + trailing 'are there' tolerated)", () => {
  const graph = buildGraph();
  const r = ask(graph, "how manyn classes are there", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /^3 classes\.$/); // curated MISSPELLINGS fixes it → a clean direct hit
  assert.equal(r.seonix_ask.relaxed, null);
});

test("trigger-typo (curated): 'coutn classes' → the class count (coutn→count)", () => {
  const graph = buildGraph();
  const r = ask(graph, "coutn classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /^3 classes\.$/);
});

test("trailing-filler: 'how many classes are there' counts (the 'are there' tail is not a restrictor)", () => {
  const graph = buildGraph();
  assert.match(ask(graph, "how many classes are there", OPTS).content, /^3 classes\.$/);
});

test("trigger-typo (fuzzy backstop): an UNCURATED typo 'how manny classes' is fuzzy-corrected to 'many', not dropped", () => {
  const graph = buildGraph();
  const r = ask(graph, "how manny classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./);
  // it rode the cascade's fuzzy-correct step (not a curated MISSPELLING)
  assert.ok(r.seonix_ask.relaxed.steps.some((s) => /fuzzy-correct/.test(s) && /manny/.test(s)), "the fuzzy-correct step fired");
});

test("trigger-typo (fuzzy backstop): an uncurated 'coubt classes' corrects to 'count'", () => {
  const graph = buildGraph();
  const r = ask(graph, "coubt classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./);
});

test("trigger-typo DISCIPLINE: a non-near-miss stays an honest miss ('how bananas classes' — 'bananas' isn't near any trigger)", () => {
  const graph = buildGraph();
  const r = ask(graph, "how bananas classes", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.match(r.content, /couldn't parse this as a graph question/);
});

test("trigger-typo determinism: the same typo'd trigger yields an identical result twice", () => {
  const graph = buildGraph();
  const a = ask(graph, "how manny classes", OPTS);
  const b = ask(graph, "how manny classes", OPTS);
  assert.equal(a.content, b.content);
  assert.deepEqual(a.seonix_ask.relaxed, b.seonix_ask.relaxed);
});

// ---- 4. pure noise → honest miss (the honest bottom of the cascade) ----

test("cascade honest bottom: a query that is ONLY noise → honest miss + rephrase hint, never a fabricated answer", () => {
  const graph = buildGraph();
  const r = ask(graph, "please kindly just tell me matey", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.equal(r.seonix_ask.relaxed, null);
  assert.match(r.content, /couldn't parse this as a graph question/);
});

// ---- 5. a clean DIRECT hit never enters the cascade (relaxed === null) ----

test("cascade is NOT invoked on a direct hit: a clean query parses without relaxation (relaxed === null)", () => {
  const graph = buildGraph();
  const r = ask(graph, "which functions call buildContextBundle", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /caller/);
  assert.equal(r.seonix_ask.relaxed, null); // the spy: the cascade never touched a direct hit
  // and the content is not prefixed with a "read as" relaxation note
  assert.doesNotMatch(r.content, /read as/);
});

test("cascade is NOT invoked on a direct compositional hit either ('how many classes')", () => {
  const graph = buildGraph();
  const r = ask(graph, "how many classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /^3 classes\.$/);
  assert.equal(r.seonix_ask.relaxed, null);
});

// ---- 6. explicit help request → the hint directly, never a pretend answer ----

test("cascade help: an explicit help request shows the rephrase hint directly (not a relaxation attempt)", () => {
  const graph = buildGraph();
  const r = ask(graph, "help", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.equal(r.seonix_ask.help, true);
  assert.equal(r.seonix_ask.relaxed, null);
  assert.match(r.content, /which <functions\|classes\|modules>/); // the rephrase hint itself
  // a real question about a symbol NAMED help is NOT intercepted (whole-query match only)
  assert.notEqual(ask(graph, "which functions call help", OPTS).seonix_ask.help, true);
});

// ---- 7. determinism: same query + same graph → identical envelope, twice ----

test("cascade determinism: the same relaxed query yields an identical result both times", () => {
  const graph = buildGraph();
  const a = ask(graph, "Please count the classes matey", OPTS);
  const b = ask(graph, "Please count the classes matey", OPTS);
  assert.equal(a.content, b.content);
  assert.deepEqual(a.seonix_ask.relaxed, b.seonix_ask.relaxed);
  assert.deepEqual(a.seonix_ask.parsed, b.seonix_ask.parsed);
  // relaxParse itself is pure given (graph, query): identical trace across calls
  const t1 = relaxParse(graph, "could you show me what imports walk.mjs please", OPTS);
  const t2 = relaxParse(graph, "could you show me what imports walk.mjs please", OPTS);
  assert.deepEqual(t1.steps, t2.steps);
  assert.deepEqual(t1.dropped, t2.dropped);
});

// ---- 8. discipline: relaxation never overrides a real answer, and never promotes a
//         bare grammar marker to the asked term (a rescue must be a genuine positive) ----

test("cascade discipline: a resolvable-but-empty query keeps its honest direct answer, never a mangled relaxation", () => {
  const graph = buildGraph();
  // walk.mjs resolves and imports nothing → a real, empty forward answer. The object
  // resolved, so the cascade must NOT fire (a hit — even an empty one — stays exact).
  const r = ask(graph, "what does walk.mjs import", OPTS);
  assert.equal(r.seonix_ask.relaxed, null);
  assert.match(r.content, /no imports edges/);
});

test("cascade discipline: an unresolved location term is an honest miss, not a marker promoted to the term", () => {
  const graph = buildGraph();
  // dropping the unresolved term must NOT leave "where is defined" and let the WHERE
  // marker "defined" slide into the asked-term slot — that would be a guess.
  const r = ask(graph, "where is totallymissingthing defined", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.equal(r.seonix_ask.relaxed, null);
  assert.match(r.content, /no module matching/);
});

// ---- 9. TERMINAL RULE: a bare KIND NOUN (only articles/noise/question words around it)
//         defaults to a bounded COUNT of that kind, the operator's "vague enough to land"
//         case — instead of dead-ending in an honest miss. Count, not list: the cheap safe
//         zero-arg answer; the asker can then "list them". Fires ONLY on a clean bare kind
//         noun; any dangling unknown qualifier / verb / term blocks it (the honest miss stands). ----

test("bare kind noun: 'the classes' → a COUNT default (not an honest miss)", () => {
  const graph = buildGraph();
  const r = ask(graph, "the classes", OPTS); // fixture has Apple, Banana, Cherry
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./);
  assert.equal(r.seonix_ask.relaxed.to, "count classes");
  assert.ok(r.seonix_ask.relaxed.steps.some((s) => /bare kind "classes" → count/.test(s)), "the terminal rule fired");
});

test("bare kind noun: a truly bare 'classes' (no article) also lands the count", () => {
  const graph = buildGraph();
  const r = ask(graph, "classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./);
  assert.equal(r.seonix_ask.relaxed.to, "count classes");
});

test("bare kind noun: 'tell me the classes' — 'tell me' is filler-stripped, the bare kind surfaces → count", () => {
  const graph = buildGraph();
  const r = ask(graph, "tell me the classes", OPTS);
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 classes\./);
  assert.equal(r.seonix_ask.relaxed.to, "count classes");
});

test("bare kind noun: 'what about the modules' — the 'about' lead-in is noise, the kind surfaces → count", () => {
  const graph = buildGraph();
  const r = ask(graph, "what about the modules", OPTS); // 6 modules in the fixture
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /6 modules\./);
  assert.equal(r.seonix_ask.relaxed.to, "count modules");
});

test("bare kind noun: singular 'the function' counts the function kind too", () => {
  const graph = buildGraph();
  const r = ask(graph, "the function", OPTS); // walk, buildContextBundle, caller
  assert.equal(r.seonix_ask.miss, false);
  assert.match(r.content, /3 functions\./);
});

test("bare kind DISCIPLINE: a dangling UNKNOWN qualifier ('the shiny classes') does NOT count — it stays an honest miss (the terminal rule reads the ORIGINAL tokens, so 'shiny' blocks the default)", () => {
  const graph = buildGraph();
  const r = ask(graph, "the shiny classes", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.equal(r.seonix_ask.relaxed, null); // never rescued into a count-all
  assert.match(r.content, /couldn't parse this as a graph question/);
});

test("bare kind DISCIPLINE: 'change'/'changes' is ask-vocab's pseudo-type (no node class) — never counted as a bare kind", () => {
  const graph = buildGraph();
  const r = ask(graph, "the changes", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.equal(r.seonix_ask.relaxed, null);
});

test("bare kind DISCIPLINE: a bare NON-kind noun ('the bananas') is still an honest miss, never a count", () => {
  const graph = buildGraph();
  const r = ask(graph, "the bananas", OPTS);
  assert.equal(r.seonix_ask.miss, true);
  assert.equal(r.seonix_ask.relaxed, null);
  assert.match(r.content, /couldn't parse this as a graph question/); // the hint names the kinds
});

test("bare kind DISCIPLINE: a kind noun carrying a real relative-clause predicate ('the classes that couple to walk.mjs') is NEVER collapsed into the count default — the terminal rule fires only on a CLEAN bare kind", () => {
  const graph = buildGraph();
  // The operator's guard: "the classes that inherit X" must stay the real compositional
  // query, not become a count. The predicate ("that couple to walk.mjs") lands verb/term
  // tokens in `others`, so the terminal rule can't fire — the query is handled by the
  // ordinary parse/cascade instead. Whatever it resolves to, it must NOT be "3 classes."
  const r = ask(graph, "the classes that couple to walk.mjs", OPTS);
  assert.doesNotMatch(r.content, /\b3 classes\./); // never the bare count default
  assert.notEqual(r.seonix_ask.relaxed && r.seonix_ask.relaxed.to, "count classes");
});

test("bare kind determinism: 'the classes' yields an identical relaxed result both times", () => {
  const graph = buildGraph();
  const a = ask(graph, "the classes", OPTS);
  const b = ask(graph, "the classes", OPTS);
  assert.equal(a.content, b.content);
  assert.deepEqual(a.seonix_ask.relaxed, b.seonix_ask.relaxed);
});
