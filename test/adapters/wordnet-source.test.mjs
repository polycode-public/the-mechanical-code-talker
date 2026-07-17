import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWordnetYaml, loadEntriesFor, loadSynsets, hasWordnetSource } from "../../scripts/lib/wordnet-source.mjs";

// Every fixture is a literal written to a temp file, so these run on a machine
// with no WordNet clone. What they pin is the dump's own shapes: the reader is
// a YAML parser now, and these are the shapes the dump actually contains.

let dir;
const fixture = async (name, text) => {
  dir ??= await mkdtemp(join(tmpdir(), "tmct-wordnet-"));
  await writeFile(join(dir, name), text);
  return join(dir, name);
};
test.after(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

test("the dump's block shapes read into plain objects", async () => {
  assert.deepEqual(await readWordnetYaml(await fixture("flat.yaml", "a: one\nb: two\n")), { a: "one", b: "two" });
  assert.deepEqual(await readWordnetYaml(await fixture("nest.yaml", "outer:\n  inner: value\n")), { outer: { inner: "value" } });
  assert.deepEqual(await readWordnetYaml(await fixture("empty-key.yaml", "a:\nb: two\n")), { a: null, b: "two" });
  assert.deepEqual(await readWordnetYaml(await fixture("comments.yaml", "# a comment\n\na: one\nb: two\n")), { a: "one", b: "two" });
});

test("a sequence reads the same whether it is indented under its key or level with it", async () => {
  const level = await readWordnetYaml(await fixture("seq-level.yaml", "members:\n- dog\n- cat\n"));
  const under = await readWordnetYaml(await fixture("seq-under.yaml", "members:\n  - dog\n  - cat\n"));
  assert.deepEqual(level, { members: ["dog", "cat"] });
  assert.deepEqual(under, level);
});

test("a scalar wrapping onto a continuation line joins with one space", async () => {
  assert.deepEqual(
    await readWordnetYaml(await fixture("wrap.yaml", "definition: a long definition that\n  wraps onto a second line\n")),
    { definition: "a long definition that wraps onto a second line" },
  );
});

test("the entries shape reads word -> pos -> sense list", async () => {
  // The sense ids carry colons, so the dump quotes them; this is its own layout.
  const text = [
    "dog:",
    "  n:",
    "    sense:",
    "    - id: 'dog%1:05:00::'",
    "      synset: 02086723-n",
    "    - id: 'dog%1:18:01::'",
    "      synset: 10133978-n",
    "  v:",
    "    sense:",
    "    - id: 'dog%2:38:00::'",
    "      synset: 02001858-v",
    "",
  ].join("\n");
  assert.deepEqual(await readWordnetYaml(await fixture("entries-shape.yaml", text)), {
    dog: {
      n: { sense: [{ id: "dog%1:05:00::", synset: "02086723-n" }, { id: "dog%1:18:01::", synset: "10133978-n" }] },
      v: { sense: [{ id: "dog%2:38:00::", synset: "02001858-v" }] },
    },
  });
});

// ---- the shapes the dump provoked, which any reader of it has to survive -----

test("a quoted scalar holding a literal ': ' stays one string", async () => {
  assert.deepEqual(
    await readWordnetYaml(await fixture("colon.yaml", `definition: "the four gospels: Matthew, Mark, Luke, and John"\n`)),
    { definition: "the four gospels: Matthew, Mark, Luke, and John" },
  );
});

test("a quoted scalar wrapping after a colon keeps going rather than truncating there", async () => {
  assert.deepEqual(
    await readWordnetYaml(await fixture("colon-wrap.yaml", `definition: "the four gospels:\n  Matthew, Mark, Luke, and John"\n`)),
    { definition: "the four gospels: Matthew, Mark, Luke, and John" },
  );
});

test("a quoted list item holding ': ' stays a scalar rather than becoming a mapping", async () => {
  assert.deepEqual(
    await readWordnetYaml(await fixture("item-colon.yaml", `example:\n  - "the cetaceans, including: whales, dolphins"\n`)),
    { example: ["the cetaceans, including: whales, dolphins"] },
  );
});

test("a multi-word key stays one key", async () => {
  assert.deepEqual(await readWordnetYaml(await fixture("multi-word.yaml", "M-1 rifle:\n  n:\n    sense:\n    - id: x\n")), {
    "M-1 rifle": { n: { sense: [{ id: "x" }] } },
  });
  const cream = await readWordnetYaml(await fixture("ice-cream.yaml", "ice cream: dessert\n"));
  assert.deepEqual(Object.keys(cream), ["ice cream"]);
});

test("YAML's '' escape resolves to one apostrophe, in keys and in values alike", async () => {
  // The dump is full of these: lemmas like 'hood and Caesar's agaric, and
  // definitions quoting speech. A reader that leaves the pair doubled corrupts
  // every one of them.
  const parsed = await readWordnetYaml(await fixture("apostrophe.yaml", [
    "'''hood':",
    "  n:",
    "    sense:",
    "    - id: '''hood%1:14:01::'",
    "example: 'it would be cruel to wake him: he''s sound asleep'",
    "",
  ].join("\n")));
  assert.ok(Object.hasOwn(parsed, "'hood"), `key unescapes to 'hood, got ${JSON.stringify(Object.keys(parsed))}`);
  assert.equal(parsed["'hood"].n.sense[0].id, "'hood%1:14:01::");
  assert.equal(parsed.example, "it would be cruel to wake him: he's sound asleep");
});

test("a wrapped scalar whose continuation opens with '- ' stays one scalar", async () => {
  // The dump wraps prose mid-clause, so a continuation can begin with a dash:
  // "...physically difficult\n  - if not impossible - for the conductor...".
  // Reading that dash as a new list item truncates the scalar and swallows the
  // rest of the record.
  const text = [
    "92460744-n:",
    "  example:",
    "  - When double-deck carriages were introduced they identified a problem in that it",
    "    would be physically difficult - if not impossible - for the conductor to verify.",
    "  members:",
    "  - bilevel car",
    "  partOfSpeech: n",
    "",
  ].join("\n");
  const parsed = await readWordnetYaml(await fixture("dash-wrap.yaml", text));
  assert.equal(parsed["92460744-n"].example.length, 1, "the wrapped example is one item, not several");
  assert.match(parsed["92460744-n"].example[0], /if not impossible - for the conductor to verify\.$/);
  assert.deepEqual(parsed["92460744-n"].members, ["bilevel car"], "the keys after the wrap survive");
  assert.equal(parsed["92460744-n"].partOfSpeech, "n");
});

test("loadSynsets skips a file that is not there rather than throwing", async () => {
  const map = await loadSynsets(["nope.yaml"], dir ?? tmpdir());
  assert.equal(map.size, 0);
});

test("loadEntriesFor reads only the letters its words need, and keeps only those words", async () => {
  const d = await mkdtemp(join(tmpdir(), "tmct-entries-"));
  await writeFile(join(d, "entries-d.yaml"), "dog:\n  n:\n    sense:\n      - id: dog%1\n        synset: 02086723-n\nduck:\n  n:\n    sense:\n      - id: duck%1\n        synset: 01846331-n\n");
  await writeFile(join(d, "entries-c.yaml"), "cat:\n  n:\n    sense:\n      - id: cat%1\n        synset: 02121620-n\n");
  const index = await loadEntriesFor(new Set(["dog", "cat"]), d);
  assert.deepEqual([...index.keys()].sort(), ["cat", "dog"], "duck shares dog's file but was not asked for");
  assert.deepEqual(index.get("dog").n, [{ id: "dog%1", synset: "02086723-n" }]);
  await rm(d, { recursive: true, force: true });
});

test("hasWordnetSource reports on the directory it is given", async () => {
  assert.equal(hasWordnetSource(join(tmpdir(), "definitely-no-wordnet-here")), false);
  assert.equal(hasWordnetSource(tmpdir()), true);
});
