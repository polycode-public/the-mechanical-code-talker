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
  SAID_IN_SESSION_PROP, IN_REPLY_TO_PROP,
  UTTERANCE_CLASS, FACT_CLASS, MEMORY_SESSION_CLASS, emptyMemory,
} from "../src/memory/core.mjs";
import { loadLexicon, predicateOf } from "../src/grammar/lexicon.mjs";

const TTL_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "ontology", "tmct-core.ttl");

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
  assert.deepEqual([...prefixes].sort(), ["mgx", "owl", "rdf", "rdfs", "seon", "tmct", "xsd"]);
  assert.ok(terminators >= 50, `a real ontology, not a stub: ${terminators} statements`);
});

test("the checker itself catches malformed Turtle (it is not a rubber stamp)", () => {
  assert.throws(() => checkTurtle('@prefix a: <urn:x#> .\n<urn:y> a "unterminated'), /unterminated string/);
  assert.throws(() => checkTurtle("@prefix a: <urn:x#> .\na:x a:list ( a:y .\n"), /unclosed \(/);
  assert.throws(() => checkTurtle("<urn:x"), /unterminated IRI/);
  assert.throws(() => checkTurtle("@prefix a: <urn:x#> .\nb:oops a:thing .\n"), /prefix "b" used/);
});

test("the ontology mirrors the memory vocabulary of src/memory/core.mjs exactly", async () => {
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
  assert.ok(text.includes(`<${emptyMemory().prefixes.mgx}>`), "mgx IRI matches src/memory/core.mjs");
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
