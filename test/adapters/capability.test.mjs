// memory/capability.mjs tests — the pure resolver over hand-built Fact rows.
// The chat lane pins the answers a visitor sees; these pin the rules those
// answers rest on, including the source arrangements the shipped corpus cannot
// produce (it asserts no negatives at all, so a corpus-vs-visitor disagreement
// is unreachable from the seed).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAPABILITY_REPORT_CAP, NEG_CAPABLE_OF_PREDICATE, NEG_SUBCLASS_PREDICATE, capabilityBaseRate,
  capabilityExtension, isNegatedPredicate, negatedPredicate, positivePredicate,
  resolveCapabilityPolarity,
} from "../../src/domain/memory/capability.mjs";

const can = (subject, object, extra = {}) => ({ subject, predicate: "mgx:capableOf", object, provenance: "teach:chat:s1", trust: 0.95, ...extra });
const cannot = (subject, object, extra = {}) => ({ subject, predicate: NEG_CAPABLE_OF_PREDICATE, object, provenance: "teach:chat:s1", trust: 0.95, ...extra });
const isa = (subject, object) => ({ subject, predicate: "rdfs:subClassOf", object, provenance: "teach:chat:s1", trust: 0.95 });

test("polarity lives in the predicate, under its own prefix", () => {
  assert.equal(negatedPredicate("mgx:capableOf"), "mgxneg:capableOf");
  assert.equal(negatedPredicate("mgx:eat"), "mgxneg:eat");
  assert.equal(positivePredicate("mgxneg:capableOf"), "mgx:capableOf");
  assert.equal(positivePredicate("mgx:capableOf"), null);
  assert.ok(isNegatedPredicate("mgxneg:eat"));
  assert.ok(!isNegatedPredicate("mgx:eat"));
});

test("a predicate outside the mgx: namespace negates through its stated twin", () => {
  // rdfs:subClassOf's negative cannot be minted by prefix swap — the positive
  // is RDFS's term, only the polarity is tmct's — so the pair is stated, and
  // the inverse must not read it back as the non-existent "mgx:subClassOf".
  assert.equal(negatedPredicate("rdfs:subClassOf"), NEG_SUBCLASS_PREDICATE);
  assert.equal(positivePredicate(NEG_SUBCLASS_PREDICATE), "rdfs:subClassOf");
  assert.ok(isNegatedPredicate(NEG_SUBCLASS_PREDICATE));
});

test("a predicate with no negative twin at all returns unchanged", () => {
  assert.equal(negatedPredicate("rdf:type"), "rdf:type");
  assert.equal(positivePredicate("rdf:type"), null);
});

test("a folded prepositional predicate keeps its preposition through the swap", () => {
  // the fold runs on the positive and the prefix swaps after, so nothing
  // meaning-bearing is stranded in the object
  assert.equal(negatedPredicate("mgx:rest-on"), "mgxneg:rest-on");
  assert.equal(positivePredicate("mgxneg:rest-on"), "mgx:rest-on");
});

test("a direct positive answers yes at zero hops", () => {
  const r = resolveCapabilityPolarity("bird", "fly", [can("bird", "fly")]);
  assert.equal(r.verdict, "yes");
  assert.equal(r.hops, 0);
});

test("a direct negative answers no, and never comes from the absence of a positive", () => {
  const r = resolveCapabilityPolarity("penguin", "fly", [cannot("penguin", "fly")]);
  assert.equal(r.verdict, "no");
  assert.equal(r.hops, 0);

  const silent = resolveCapabilityPolarity("penguin", "fly", [can("bird", "sing")]);
  assert.equal(silent.verdict, "none", "no fact about the subject is not a no");
});

test("capability inherits across subClassOf, and reports the chain it travelled", () => {
  const r = resolveCapabilityPolarity("penguin", "fly", [can("bird", "fly"), isa("penguin", "bird")]);
  assert.equal(r.verdict, "yes");
  assert.equal(r.hops, 1);
  assert.deepEqual(r.chain.map((s) => [s.subject, s.object]), [["penguin", "bird"]]);
});

test("inheritance chases a multi-hop chain within the hop budget, and stops at it", () => {
  const rows = [can("animal", "move"), isa("penguin", "bird"), isa("bird", "animal")];
  assert.equal(resolveCapabilityPolarity("penguin", "move", rows).verdict, "yes");
  assert.equal(resolveCapabilityPolarity("penguin", "move", rows, { maxHops: 1 }).verdict, "none");
});

test("a direct negative overrides an inherited positive, and names the default it beat", () => {
  const rows = [can("bird", "fly"), isa("penguin", "bird"), cannot("penguin", "fly")];
  const r = resolveCapabilityPolarity("penguin", "fly", rows);
  assert.equal(r.verdict, "no");
  assert.equal(r.hops, 0);
  assert.equal(r.overrides.fact.subject, "bird");
});

test("the override does not leak back up: the class keeps its own answer", () => {
  const rows = [can("bird", "fly"), isa("penguin", "bird"), cannot("penguin", "fly")];
  assert.equal(resolveCapabilityPolarity("bird", "fly", rows).verdict, "yes");
});

// The rule the whole design rests on. SOURCE_PRIOR puts entailed (0.3) under
// teach (0.95), so a taught negative already outranks a derived positive and
// trust LOOKS like it solves specificity for free. Flip the sources and it
// stops working — which is why hop count is sorted first and trust never gets
// to reorder across ranks.
test("specificity outranks trust: a low-trust direct fact beats a high-trust inherited one", () => {
  const rows = [
    can("bird", "fly", { provenance: "teach:chat:s1", trust: 0.95 }),
    isa("penguin", "bird"),
    cannot("penguin", "fly", { provenance: "corpus:human", trust: 0.7 }),
  ];
  const r = resolveCapabilityPolarity("penguin", "fly", rows);
  assert.equal(r.verdict, "no", "the less-trusted fact ABOUT PENGUIN still beats the trusted one about birds");
  assert.equal(r.hops, 0);
});

test("specificity outranks trust in the other direction too", () => {
  const rows = [
    cannot("bird", "fly", { provenance: "corpus:human", trust: 0.7 }),
    isa("penguin", "bird"),
    can("penguin", "fly", { provenance: "web:example", trust: 0.4 }),
  ];
  assert.equal(resolveCapabilityPolarity("penguin", "fly", rows).verdict, "yes");
});

test("trust orders only WITHIN a rank, never across one", () => {
  const rows = [
    can("bird", "fly", { trust: 0.7 }),
    can("bird", "fly", { provenance: "teach:chat:s2", trust: 0.95 }),
    isa("penguin", "bird"),
  ];
  const r = resolveCapabilityPolarity("penguin", "fly", rows);
  assert.equal(r.verdict, "yes");
  assert.equal(r.positive[0].trust, 0.95, "the better-trusted row of the winning rank leads");
});

test("two sources disagreeing at equal specificity report both and pick neither", () => {
  const rows = [
    can("penguin", "fly", { provenance: "corpus:human /r/CapableOf", trust: 0.7 }),
    cannot("penguin", "fly", { provenance: "teach:chat:visitor-b", trust: 0.95 }),
  ];
  const r = resolveCapabilityPolarity("penguin", "fly", rows);
  assert.equal(r.verdict, "both");
  assert.equal(r.positive.length, 1);
  assert.equal(r.negative.length, 1);
  // each side keeps its own source — that is what makes both statements true
  // at once, and the disagreement one between the sources rather than inside
  // the knowledge
  assert.match(r.positive[0].provenance, /corpus:human/);
  assert.match(r.negative[0].provenance, /visitor-b/);
});

test("two sources disagreeing at equal INHERITED specificity also report both", () => {
  const rows = [
    can("bird", "fly", { provenance: "corpus:human", trust: 0.7 }),
    cannot("bird", "fly", { provenance: "teach:chat:visitor-b", trust: 0.95 }),
    isa("penguin", "bird"),
  ];
  const r = resolveCapabilityPolarity("penguin", "fly", rows);
  assert.equal(r.verdict, "both");
  assert.equal(r.hops, 1);
});

test("the base rate excludes the subject from its own evidence", () => {
  const rows = [
    isa("ostrich", "bird"), isa("penguin", "bird"), isa("swift", "bird"),
    can("swift", "fly"), cannot("penguin", "fly"), cannot("ostrich", "fly"),
  ];
  const b = capabilityBaseRate("ostrich", "fly", rows);
  assert.equal(b.klass, "bird");
  assert.equal(b.kinds, 2, "ostrich is not evidence about ostrich");
  assert.ok(!b.negative.some((s) => s.name === "ostrich"));
});

test("the base-rate split accounts for every kind it counted", () => {
  const rows = [
    isa("ostrich", "bird"), isa("penguin", "bird"), isa("swift", "bird"),
    isa("owl", "bird"), isa("wren", "bird"), isa("crow", "bird"),
    can("swift", "fly"), can("wren", "fly"), can("crow", "fly"), cannot("penguin", "fly"),
  ];
  const b = capabilityBaseRate("ostrich", "fly", rows);
  assert.equal(b.kinds, 5);
  assert.equal(b.positive.length + b.negative.length + b.unknown.length, b.kinds,
    "say 5 and split only 4 and the arithmetic lies about what the store knows");
  assert.equal(b.positive.length, 3);
  assert.equal(b.negative.length, 1);
  assert.equal(b.unknown.length, 1);
});

test("a subject with no known class has no base rate to report", () => {
  assert.equal(capabilityBaseRate("wug", "fly", [can("bird", "fly")]), null);
});

test("the extension lists what the store says can do it, and excludes what it says cannot", () => {
  const rows = [can("jet", "fly"), can("bee", "fly"), cannot("penguin", "fly"), can("penguin", "fly")];
  const names = capabilityExtension("fly", rows).map((f) => f.subject);
  assert.deepEqual(names.sort(), ["bee", "jet"], "a contested subject is not an answer here either");
});

test("the extension drops the excluded terms, so a pivot cannot be circular", () => {
  const rows = [can("bird", "fly"), can("jet", "fly")];
  const names = capabilityExtension("fly", rows, { exclude: ["ostrich", "bird"] }).map((f) => f.subject);
  assert.deepEqual(names, ["jet"], "citing the class asked about is circular, not informative");
});

test("the report cap is one constant, so verbosity is tuned in one place", () => {
  assert.equal(typeof CAPABILITY_REPORT_CAP, "number");
  assert.ok(CAPABILITY_REPORT_CAP > 0);
});
