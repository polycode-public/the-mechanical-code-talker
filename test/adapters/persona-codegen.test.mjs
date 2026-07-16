import test from "node:test";
import assert from "node:assert/strict";
import {
  CLUMP_ORDER, CLUMP_LABEL, IRREGULAR_PLURALS,
  lexiconNounEntry, factsBlock, nounsListBlock, buildCorpusEntry, spliceCorpusEntries,
} from "../../src/domain/persona/codegen.mjs";
import { pluralOf } from "../../src/domain/inflect.mjs";

test("factsBlock: renders each triple as an indented JS array literal line", () => {
  assert.equal(
    factsBlock([["dog", "/r/IsA", "animal"], ["cat", "/r/IsA", "animal"]]),
    '      ["dog", "/r/IsA", "animal"],\n      ["cat", "/r/IsA", "animal"],',
  );
});

test("factsBlock: no facts renders an empty string, not a stray line", () => {
  assert.equal(factsBlock([]), "");
});

test("nounsListBlock: wraps at 8 words per line", () => {
  const words = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
  assert.equal(
    nounsListBlock(words),
    '        "a", "b", "c", "d", "e", "f", "g", "h",\n        "i",',
  );
});

test("nounsListBlock: exactly 8 words is one line", () => {
  assert.equal(nounsListBlock(["a", "b", "c", "d", "e", "f", "g", "h"]).split("\n").length, 1);
});

test("nounsListBlock: no words renders an empty string", () => {
  assert.equal(nounsListBlock([]), "");
});

// ---- The two pluralization authorities, and why they stay separate ----------

test("lexiconNounEntry: an irregular noun declares its plural", () => {
  assert.deepEqual(lexiconNounEntry("foot"), { plural: "feet" });
  assert.deepEqual(lexiconNounEntry("child"), { plural: "children" });
});

test("lexiconNounEntry: a regular noun declares nothing and leaves folding to the lexicon", () => {
  assert.deepEqual(lexiconNounEntry("dog"), {});
  assert.deepEqual(lexiconNounEntry("church"), {});
});

test("IRREGULAR_PLURALS holds only what suffix-folding could not recover", () => {
  // The map's job is the exceptions, so a word whose regular plural is already
  // right has no business being in it. This is what keeps the map small and
  // keeps its meaning ("folding fails here") true.
  for (const [lemma, plural] of Object.entries(IRREGULAR_PLURALS)) {
    assert.notEqual(pluralOf(lemma), plural, `${lemma} -> ${plural} is the regular form; it does not need declaring`);
  }
});

test("the collision table's pluralOf and the lexicon's plural map answer different questions", () => {
  // Documented so the "two pluralization authorities" reading does not come
  // back. inflect.mjs generates candidate surface forms and commits to regular
  // rules only — it WANTS "foots", because a form it fails to generate is a
  // real word the repair tier may rewrite. This map declares the one correct
  // plural for the grammar, where "foots" would be a lie.
  assert.equal(pluralOf("foot"), "foots");
  assert.equal(IRREGULAR_PLURALS.foot, "feet");
  assert.equal(lexiconNounEntry("foot").plural, "feet");
});

test("IRREGULAR_PLURALS: unchanging plurals are declared explicitly, since folding would strip the -s", () => {
  assert.equal(IRREGULAR_PLURALS.sheep, "sheep");
  assert.equal(IRREGULAR_PLURALS.series, "series");
  assert.equal(IRREGULAR_PLURALS.species, "species");
});

// ---- buildCorpusEntry --------------------------------------------------------

const byClump = Object.fromEntries(CLUMP_ORDER.map((c) => [c, { facts: [], newNouns: [] }]));
const ONE = {
  ...byClump,
  "human-core": { facts: [["surgeon", "/r/IsA", "doctor"]], newNouns: ["surgeon"] },
};

test("buildCorpusEntry: emits a CORPUSES entry keyed by the tier id, with kind and lexicon", () => {
  const src = buildCorpusEntry("human-medium", "Medium", ONE);
  assert.match(src, /"human-medium": \{/);
  assert.match(src, /kind: "domain"/);
  assert.match(src, /"surgeon"/);
  assert.match(src, /\["surgeon", "\/r\/IsA", "doctor"\],/);
});

test("buildCorpusEntry: the emitted source parses as JS, which is the whole point", () => {
  const src = buildCorpusEntry("human-large", "Large", ONE);
  const parsed = new Function(`return {${src}};`)();
  assert.deepEqual(parsed["human-large"].lexicon.nouns, ["surgeon"]);
  assert.deepEqual(parsed["human-large"].facts, [["surgeon", "/r/IsA", "doctor"]]);
  assert.equal(parsed["human-large"].kind, "domain");
});

test("buildCorpusEntry: the description's embedded quotes survive into valid source", () => {
  const parsed = new Function(`return {${buildCorpusEntry("human-medium", "Medium", ONE)}};`)();
  assert.match(parsed["human-medium"].description, /activated alongside "human" via --persona-size medium/);
});

test("buildCorpusEntry: medium and large differ in tier, size flag and the tier they build on", () => {
  const medium = buildCorpusEntry("human-medium", "Medium", ONE);
  const large = buildCorpusEntry("human-large", "Large", ONE);
  assert.match(medium, /--persona-size medium/);
  assert.match(large, /--persona-size large/);
  assert.match(medium, /Medium stays flat, one hop per word/);
  assert.match(large, /walk real multi-hop hypernym chains/);
  assert.match(medium, /INCREMENTAL facts beyond Small/);
  assert.match(large, /INCREMENTAL facts beyond Medium/);
});

test("buildCorpusEntry: every clump gets a labelled comment, in CLUMP_ORDER", () => {
  const src = buildCorpusEntry("human-medium", "Medium", ONE);
  for (const clump of CLUMP_ORDER) {
    assert.ok(src.includes(`// ${clump} (+`), `${clump} needs its noun-list comment`);
    assert.ok(src.includes(CLUMP_LABEL[clump]), `${clump} needs its human-readable label`);
  }
  const positions = CLUMP_ORDER.map((c) => src.indexOf(`---- ${c} `));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "fact blocks must follow CLUMP_ORDER");
});

test("buildCorpusEntry: the per-clump comments report real counts", () => {
  const src = buildCorpusEntry("human-medium", "Medium", ONE);
  assert.ok(src.includes("// human-core (+1 words: people, family, common roles)"));
  assert.ok(src.includes("---- human-core (+1 facts, Medium) ----"));
  assert.ok(src.includes("---- human-places (+0 facts, Medium) ----"));
});

// ---- spliceCorpusEntries -----------------------------------------------------

const GENERATE = 'const CORPUSES = {\n  "human": {},\n};\n\nconst conceptUri = (x) => x;\n';

test("spliceCorpusEntries: inserts entries inside the CORPUSES object, before its close", () => {
  const out = spliceCorpusEntries(GENERATE, ['  "a": {},\n']);
  assert.ok(out.indexOf('"a": {}') > out.indexOf('"human": {}'));
  assert.ok(out.indexOf('"a": {}') < out.indexOf("const conceptUri"));
  assert.ok(out.includes("};\n\nconst conceptUri"), "the object must still close");
});

test("spliceCorpusEntries: the spliced result still parses as JS", () => {
  const out = spliceCorpusEntries(GENERATE, [buildCorpusEntry("human-medium", "Medium", ONE)]);
  assert.doesNotThrow(() => new Function(out));
});

test("spliceCorpusEntries: several entries land in the order given", () => {
  const out = spliceCorpusEntries(GENERATE, ['  "a": {},\n', '  "b": {},\n']);
  assert.ok(out.indexOf('"a": {}') < out.indexOf('"b": {}'));
});

test("spliceCorpusEntries: a missing anchor throws rather than writing a mangled file", () => {
  assert.throws(
    () => spliceCorpusEntries("const CORPUSES = {};\n", ['  "a": {},\n']),
    /could not find CORPUSES closing anchor/,
  );
});
