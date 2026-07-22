// ontology/tmct-core.ttl tests — a MINIMAL hand-rolled Turtle well-formedness
// check (no new dependency): balanced strings/IRIs/brackets, every used
// prefix declared, statements terminated — plus content cross-checks that the
// ontology mirrors what the code actually emits (memory/core.mjs vocabulary,
// grammar kinds, lexicon-aligned classes and predicates).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  SAID_IN_SESSION_PROP, IN_REPLY_TO_PROP, STATED_BY_PROP, CANONICALISED_FROM_PROP,
  UTTERANCE_CLASS, FACT_CLASS, MEMORY_SESSION_CLASS, emptyMemory, provSourceClassFor,
  createInMemoryStore, appendFacts, loadMemory,
} from "../../src/adapters/memory/core.mjs";
import { SOURCE_PRIOR } from "../../src/domain/memory/trust.mjs";
import { loadLexicon, predicateOf } from "../../src/domain/grammar/lexicon.mjs";
import { NEG_PREDICATE_PREFIX, NEG_SUBCLASS_PREDICATE } from "../../src/domain/memory/capability.mjs";
import { relationKind } from "../../src/domain/codegraph.mjs";
import { DIALOGUE_ACTS, DIALOGUE_ACT_DIMENSIONS } from "../../src/domain/dialogue-acts.mjs";

const TTL_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ontology", "tmct-core.ttl");

/** Minimal Turtle scanner: strips comments, tokenizes IRIs / strings / words /
 *  punctuation, tracks bracket balance. Throws on an unterminated construct.
 *  Deliberately NOT a parser — a well-formedness floor, per the repo's
 *  no-new-dependency rule. Assumes the file's own conventions: short strings,
 *  standalone "." statement terminators. */
function scanTurtle(text) {
  const tokens = [];
  const stack = [];
  let i = 0;
  let line = 1;
  let word = "";
  const flush = () => { if (word) { tokens.push({ type: "word", t: word, line }); word = ""; } };
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\n") line += 1;
    if (ch === "#" && !word) { // comment to end of line (words like Foo#bar keep their #)
      flush();
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "<") {
      flush();
      const end = text.indexOf(">", i + 1);
      if (end < 0 || text.slice(i, end).includes("\n")) throw new Error(`unterminated IRI at line ${line}`);
      tokens.push({ type: "iri", t: text.slice(i + 1, end), line });
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      flush();
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length || text.slice(i, j).includes("\n")) throw new Error(`unterminated string at line ${line}`);
      tokens.push({ type: "string", t: text.slice(i + 1, j), line });
      i = j + 1;
      continue;
    }
    if ("[]()".includes(ch)) {
      flush();
      if (ch === "[" || ch === "(") stack.push({ ch, line });
      else {
        const open = stack.pop();
        const want = ch === "]" ? "[" : "(";
        if (!open || open.ch !== want) throw new Error(`unbalanced ${ch} at line ${line}`);
      }
      tokens.push({ type: "punct", t: ch, line });
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) { flush(); i += 1; continue; }
    if ((ch === ";" || ch === "," || ch === ".") && !word) {
      tokens.push({ type: "punct", t: ch, line });
      i += 1;
      continue;
    }
    if ((ch === ";" || ch === ",") && word) { flush(); continue; }
    word += ch;
    i += 1;
  }
  flush();
  if (stack.length) throw new Error(`unclosed ${stack[0].ch} from line ${stack[0].line}`);
  return tokens;
}

/** Check declarations and prefix usage over the scanned tokens. */
function checkTurtle(text) {
  const tokens = scanTurtle(text);
  const prefixes = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].type === "word" && tokens[i].t === "@prefix") {
      const name = tokens[i + 1];
      const iri = tokens[i + 2];
      const dot = tokens[i + 3];
      assert.ok(name?.type === "word" && /^[A-Za-z][\w-]*:$/.test(name.t), `@prefix name at line ${tokens[i].line}`);
      assert.equal(iri?.type, "iri", `@prefix IRI at line ${tokens[i].line}`);
      assert.ok(dot?.type === "punct" && dot.t === ".", `@prefix terminator at line ${tokens[i].line}`);
      prefixes.add(name.t.slice(0, -1));
    }
  }
  const meaningful = tokens.filter((t) => t.type !== "punct" || t.t === ".");
  for (const tok of tokens) {
    if (tok.type !== "word" || tok.t === "@prefix") continue;
    let w = tok.t;
    if (w.startsWith("^^")) w = w.slice(2); // datatype tag on a literal
    const m = /^([A-Za-z][\w-]*):/.exec(w);
    if (m && m[1] !== "_") {
      assert.ok(prefixes.has(m[1]), `prefix "${m[1]}" used at line ${tok.line} but never declared`);
    }
    // a word ending "." would hide a statement terminator from the scan
    assert.ok(!/\.$/.test(w), `token "${w}" at line ${tok.line} ends with "." — terminators must stand alone`);
  }
  const terminators = tokens.filter((t) => t.type === "punct" && t.t === ".").length;
  assert.ok(meaningful.at(-1)?.t === ".", "the file ends with a statement terminator");
  return { prefixes, terminators, tokens };
}

test("tmct-core.ttl is well-formed Turtle (minimal check): balanced constructs, all used prefixes declared, terminated statements", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  const { prefixes, terminators } = checkTurtle(text);
  assert.deepEqual([...prefixes].sort(), ["cap", "cn", "dact", "mgx", "mgxneg", "owl", "prov", "rdf", "rdfs", "seon", "skos", "taught", "tmct", "xsd"]);
  assert.ok(terminators >= 50, `a real ontology, not a stub: ${terminators} statements`);
});

test("the checker itself catches malformed Turtle (it is not a rubber stamp)", () => {
  assert.throws(() => checkTurtle('@prefix a: <urn:x#> .\n<urn:y> a "unterminated'), /unterminated string/);
  assert.throws(() => checkTurtle("@prefix a: <urn:x#> .\na:x a:list ( a:y .\n"), /unclosed \(/);
  assert.throws(() => checkTurtle("<urn:x"), /unterminated IRI/);
  assert.throws(() => checkTurtle("@prefix a: <urn:x#> .\nb:oops a:thing .\n"), /prefix "b" used/);
});

test("the ontology mirrors the memory vocabulary of src/adapters/memory/core.mjs exactly", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  // the edge predicates, by their exported constants
  assert.ok(text.includes(`${SAID_IN_SESSION_PROP} a owl:ObjectProperty`), SAID_IN_SESSION_PROP);
  assert.ok(text.includes(`${IN_REPLY_TO_PROP} a owl:ObjectProperty`), IN_REPLY_TO_PROP);
  // the three memory classes, labelled with the exact class strings the payload counts
  for (const cls of [UTTERANCE_CLASS, FACT_CLASS, MEMORY_SESSION_CLASS]) {
    assert.ok(text.includes(`tmct:${cls} a owl:Class`), `tmct:${cls} declared`);
    assert.ok(text.includes(`rdfs:label "${cls}"`), `tmct:${cls} labelled "${cls}"`);
  }
  // every mgx: datatype prop the payload vocabulary documents is grounded
  for (const prop of ["mgx:utteranceRole", "mgx:utteranceText", "mgx:utteranceTs", "mgx:utteranceParsed", "mgx:sessionStarted", "mgx:factProvenance", "mgx:hasProseTokens"]) {
    assert.ok(text.includes(`${prop} a owl:DatatypeProperty`), `${prop} declared`);
  }
  // the mgx prefix IRI is the one emptyMemory() declares — one namespace, not two
  assert.ok(text.includes(`<${emptyMemory().prefixes.mgx}>`), "mgx IRI matches src/adapters/memory/core.mjs");
});

test("every namespace a written graph declares is a namespace the ontology declares", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  for (const [prefix, iri] of Object.entries(emptyMemory().prefixes)) {
    assert.ok(
      new RegExp(`^@prefix\\s+${prefix}:\\s+<${iri.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&")}>`, "m").test(text),
      `graph.json declares ${prefix}: <${iri}>, so the ontology must declare it too`,
    );
  }
});

test("every mgx: property the store's own vocabulary documents has a definition in the ontology", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  const documented = [...new Set(emptyMemory().vocabulary.map((v) => v.prop))]
    .filter((p) => p.startsWith("mgx"));
  const ungrounded = documented.filter(
    (p) => !new RegExp(`^${p.replace(/:/g, "\\:")} a owl:(Object|Datatype)Property`, "m").test(text),
  );
  assert.deepEqual(ungrounded, [], "a prop the payload documents but the ontology never defines");
  assert.ok(documented.length >= 28, `the vocabulary did not shrink silently: ${documented.length}`);
});

test("the negative-polarity namespace is grounded, and the asymmetric twin is stated rather than minted", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  assert.ok(text.includes(`@prefix mgxneg: <${emptyMemory().prefixes.mgxneg}>`), "mgxneg IRI matches the store payload");
  // the twin that the prefix swap cannot produce: rdfs: is negated under tmct's prefix
  assert.ok(NEG_SUBCLASS_PREDICATE.startsWith(NEG_PREDICATE_PREFIX), "the stated twin lives in the negative namespace");
  assert.ok(
    new RegExp(`^${NEG_SUBCLASS_PREDICATE.replace(/:/g, "\\:")} a owl:ObjectProperty`, "m").test(text),
    `${NEG_SUBCLASS_PREDICATE} is declared`,
  );
});

test("a fact attribute the writer emits is grounded, even when the payload vocabulary never documents it", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  // These are written onto Facts by appendFact/appendFacts. Whether or not a
  // prop also appears in the payload's documented vocabulary (the check
  // above), an emitted prop needs a home in the ontology.
  const emitted = ["mgx:factJustification", "mgx:factQuantifier", "mgx:factProvenance"];
  for (const prop of emitted) {
    assert.ok(
      new RegExp(`^${prop.replace(/:/g, "\\:")} a owl:DatatypeProperty`, "m").test(text),
      `${prop} is emitted onto a Fact, so the ontology must define it`,
    );
  }
});

/** A prop is grounded when the payload vocabulary documents it or the ontology
 *  defines it as a property. Fed with what a real store actually wrote, so the
 *  checked set can never go stale the way a hand-kept prop list can. */
function propGrounded(ttlText, documented, prop) {
  if (documented.has(prop)) return true;
  return new RegExp(`^${prop.replace(/:/g, "\\:")} a owl:(Object|Datatype|Annotation)Property`, "m").test(ttlText);
}

test("every prop a stored Fact carries is grounded — the checked set is read back from a real store, never a literal list", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  const dir = createInMemoryStore();
  const { ids: premiseIds } = await appendFacts(dir, [
    { subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", provenance: "ace:teach", quantifier: "every" },
    { subject: "mammal", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:teach" },
  ]);
  await appendFacts(dir, [{
    subject: "dog", predicate: "rdfs:subClassOf", object: "animal",
    provenance: "entailed:subClassOf", justification: premiseIds,
    premiseTrusts: [0.9, 0.9], ruleConfidence: 0.9,
  }]);
  const memory = await loadMemory(dir);
  const emitted = new Set();
  for (const ind of memory.individuals) {
    if (ind?.class !== FACT_CLASS) continue;
    for (const a of ind.attributes || []) if (a?.prop) emitted.add(a.prop);
  }
  // the seed must actually exercise the optional fact props, or the diff proves nothing
  for (const optional of ["mgx:factQuantifier", "mgx:factJustification", "mgx:factProvenance"]) {
    assert.ok(emitted.has(optional), `the seeded store emits ${optional}`);
  }
  const documented = new Set(emptyMemory().vocabulary.map((v) => v.prop));
  const ungrounded = [...emitted].filter((p) => !propGrounded(text, documented, p)).sort();
  assert.deepEqual(ungrounded, [], "a prop the store writes that neither the payload vocabulary documents nor the ontology defines");
});

test("the store-derived grounding check is not a rubber stamp: a prop declared nowhere is reported ungrounded", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  const documented = new Set(emptyMemory().vocabulary.map((v) => v.prop));
  assert.equal(propGrounded(text, documented, "mgx:factConfabulation"), false);
});

test("the provenance family aligns to PROV-O: the umbrella is influence, and only the entity-to-entity link is derivation", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  const clause = (subject, predicate, object) =>
    new RegExp(`^${subject.replace(/:/g, "\\:")} a owl:[^.]*?${predicate}\\s+${object.replace(/:/g, "\\:")}\\s*[;.]`, "ms")
      .test(text);

  // mgx:derivedFrom unions attribution with derivation, so its true PROV parent is
  // the umbrella over both — claiming prov:wasDerivedFrom would over-narrow it
  assert.ok(clause("mgx:derivedFrom", "rdfs:subPropertyOf", "prov:wasInfluencedBy"), "mgx:derivedFrom under prov:wasInfluencedBy");
  assert.ok(!clause("mgx:derivedFrom", "rdfs:subPropertyOf", "prov:wasDerivedFrom"), "mgx:derivedFrom is NOT claimed as prov:wasDerivedFrom");

  // both ends are prov:Entity here, which is exactly what wasDerivedFrom needs
  assert.ok(clause(CANONICALISED_FROM_PROP, "rdfs:subPropertyOf", "prov:wasDerivedFrom"), "canonicalisedFrom under prov:wasDerivedFrom");

  // ranges over tmct:Source, which unions PROV's three disjoint top classes, so
  // the attribution link is a pointer and not an entailment
  assert.ok(clause(STATED_BY_PROP, "rdfs:seeAlso", "prov:wasAttributedTo"), "statedBy points at prov:wasAttributedTo");
  assert.ok(!clause(STATED_BY_PROP, "rdfs:subPropertyOf", "prov:wasAttributedTo"), "statedBy does not assert the Agent range");

  // an Utterance is an Entity generated by a Session, which is an Activity
  assert.ok(clause(SAID_IN_SESSION_PROP, "rdfs:subPropertyOf", "prov:wasGeneratedBy"), "saidInSession under prov:wasGeneratedBy");
  assert.ok(clause("mgx:sessionStarted", "rdfs:subPropertyOf", "prov:startedAtTime"), "sessionStarted under prov:startedAtTime");
  assert.ok(text.includes("tmct:Session a owl:Class ;\n  rdfs:label \"Session\" ;\n  rdfs:subClassOf prov:Activity"), "a Session is a prov:Activity");
});

test("the Source split maps every stored sourceType to one PROV top class, in the ontology and in code", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  // each read-side subclass is declared under tmct:Source and one prov: top class
  const subclassParent = {
    "tmct:AgentSource": "prov:Agent",
    "tmct:DocumentSource": "prov:Entity",
    "tmct:ActivitySource": "prov:Activity",
  };
  for (const [sub, prov] of Object.entries(subclassParent)) {
    const s = sub.replace(/:/g, "\\:");
    assert.ok(new RegExp(`^${s} a owl:Class`, "m").test(text), `${sub} declared`);
    assert.ok(new RegExp(`${s} a owl:Class[^.]*?rdfs:subClassOf tmct:Source`, "s").test(text), `${sub} under tmct:Source`);
    assert.ok(
      new RegExp(`${s} a owl:Class[^.]*?rdfs:subClassOf ${prov.replace(/:/g, "\\:")}\\b`, "s").test(text),
      `${sub} under ${prov}`,
    );
  }

  // the classifier agrees with the ontology and is TOTAL over the store's
  // sourceType vocabulary — SOURCE_PRIOR is the closed set every Source draws
  // from, so a new type added without a PROV class fails here
  const expected = {
    operator: "tmct:AgentSource", teach: "tmct:AgentSource", provider: "tmct:AgentSource",
    corpus: "tmct:DocumentSource", corpusWeak: "tmct:DocumentSource", web: "tmct:DocumentSource",
    extracted: "tmct:DocumentSource", reference: "tmct:DocumentSource",
    referenceLive: "tmct:DocumentSource",
    entailed: "tmct:ActivitySource",
  };
  for (const sourceType of Object.keys(SOURCE_PRIOR)) {
    const got = provSourceClassFor(sourceType);
    assert.ok(got, `sourceType ${sourceType} is classified`);
    assert.equal(got.subClass, expected[sourceType], `${sourceType} -> ${expected[sourceType]}`);
    assert.equal(got.prov, subclassParent[got.subClass], `${sourceType} -> ${subclassParent[got.subClass]}`);
    // the ontology enumerates this sourceType under its subclass's owl:oneOf
    assert.ok(
      new RegExp(`${got.subClass.replace(/:/g, "\\:")} a owl:Class[^.]*?owl:oneOf\\s*\\([^)]*"${sourceType}"[^)]*\\)`, "s").test(text),
      `${sourceType} enumerated under ${got.subClass}`,
    );
  }
  assert.equal(provSourceClassFor("nonsense"), null, "an unknown sourceType is not force-fit");
});

test("a prop token classifies by the ontology's camelCase spelling, whatever casing the artifact spells it in", () => {
  // The classifier's lookup table is keyed lowercase and it lowercases before
  // reading, so a graph artifact may spell a prop token any way at all. The
  // camelCase spelling is the ontology's, and each pair below must land on one
  // kind: two spellings of one IRI would be two terms, and this is what proves
  // they are not.
  const authoritative = {
    "mgx:importsNamespace": "imports",
    "mgx:callsCoarse": "calls",
    "mgx:callsSymbol": "callsSymbol",
    "mgx:testsCoverage": "tests",
    "mgx:touchedByCommit": "touches",
    "mgx:touchesSymbol": "touchesSymbol",
    "mgx:changeCoupledWith": "cochange",
    "mgx:reExports": "reexports",
    "seon:hasSuperType": "inherits",
    "seon:containsCodeEntity": "contains",
    "seon:declaresMethod": "defines",
  };
  for (const [prop, kind] of Object.entries(authoritative)) {
    assert.equal(relationKind({ prop }), kind, `${prop} classifies as ${kind}`);
    assert.equal(relationKind({ prop: prop.toLowerCase() }), kind, `${prop.toLowerCase()} classifies the same`);
    assert.equal(relationKind({ prop: prop.toUpperCase() }), kind, `${prop.toUpperCase()} classifies the same`);
  }
});

test("every corpus relation mirrored from ConceptNet cites the relation it mirrors", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  const toml = await readFile(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "adapters", "corpus", "conceptnet-map.toml"),
    "utf8",
  );
  const mirrored = toml.split("[[relation]]").slice(1)
    .map((block) => ({
      rel: (block.match(/rel = "([^"]+)"/) || [])[1],
      predicate: (block.match(/predicate = "([^"]+)"/) || [])[1],
    }))
    .filter((r) => r.predicate?.startsWith("mgx:"));
  assert.ok(mirrored.length >= 25, `the mirror did not shrink silently: ${mirrored.length}`);
  for (const { rel, predicate } of mirrored) {
    assert.ok(
      new RegExp(`^${predicate.replace(/:/g, "\\:")} a owl:ObjectProperty`, "m").test(text),
      `${predicate} is declared (loader emits it from ${rel})`,
    );
    assert.ok(
      new RegExp(`^${predicate.replace(/:/g, "\\:")} a owl:[^.]*?rdfs:seeAlso cn:${rel.replace("/r/", "")}\\s*[;.]`, "ms").test(text),
      `${predicate} cites its origin ${rel}`,
    );
  }
});

test("the dialogue-act vocabulary and its ontology declaration are one closed set, two ways, dimensions included", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  const declared = new Map(
    [...text.matchAll(/^dact:(\w+) a dact:CommunicativeFunction\b[^.]*?dact:dimension "([^"]+)"/gms)]
      .map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(
    [...declared.keys()].sort(), Object.keys(DIALOGUE_ACTS).sort(),
    "every table entry is declared and every declared act is in the table",
  );
  const dimensions = new Set(DIALOGUE_ACT_DIMENSIONS);
  for (const [act, { dimension }] of Object.entries(DIALOGUE_ACTS)) {
    assert.equal(declared.get(act), dimension, `${act} is declared in its table dimension`);
    assert.ok(dimensions.has(declared.get(act)), `${act}'s declared dimension is a real data category`);
  }
});

test("the corpus-to-SKOS bridge is annotated: mgx:relatedTo points at skos:related", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  assert.ok(
    /^mgx:relatedTo a owl:[^.]*?rdfs:seeAlso skos:related\s*[;.]/ms.test(text),
    "mgx:relatedTo cites skos:related (the derived concept view reads it as that relation)",
  );
});

test("the ontology grounds the grammar: every emitted kind appears, and lexicon predicates/classes are declared", async () => {
  const text = await readFile(TTL_FILE, "utf8");
  for (const kind of ["rdfs:subClassOf", "rdf:type", "owl:ObjectProperty", "owl:DatatypeProperty", "owl:someValuesFrom", "owl:minCardinality", "owl:maxCardinality", "owl:cardinality", "owl:disjointWith", "owl:hasValue", "owl:intersectionOf", "owl:onProperty", "owl:onClass", "owl:Restriction"]) {
    assert.ok(text.includes(kind), `grammar kind ${kind} covered`);
  }
  // top-level software-entity classes align with the lexicon's noun lemmas
  const lex = loadLexicon();
  for (const noun of ["module", "class", "function", "method", "attribute", "test", "commit", "repository", "service", "developer", "bug"]) {
    assert.ok(lex.nouns.has(noun), `lexicon noun ${noun}`);
    assert.ok(text.includes(`tmct:${noun} a owl:Class`), `tmct:${noun} declared a class`);
  }
  // core verbs: the exact predicate spelling predicateOf() emits is declared
  for (const verb of ["import", "call", "test", "contain", "extend", "use", "depend", "have"]) {
    const pred = predicateOf(lex.verbs.get(verb));
    assert.ok(text.includes(`${pred} a owl:ObjectProperty`), `${pred} declared`);
  }
  // possessive typings: data nouns as DatatypeProperty, object nouns as ObjectProperty
  assert.ok(text.includes("tmct:license a owl:DatatypeProperty"));
  assert.ok(text.includes("tmct:owner a owl:ObjectProperty"));
  // code-graph alignment stays visible (seeAlso the real prop tokens)
  assert.ok(text.includes("rdfs:seeAlso mgx:importsNamespace"));
  assert.ok(text.includes("rdfs:seeAlso seon:hasSuperType"));
});
