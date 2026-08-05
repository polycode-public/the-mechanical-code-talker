// Two lanes over a store that types single letters: the APPOSITION read, where
// "the letter p" names p because the store already holds "p is a letter", and
// the words-containing-a-letter lane, which lists the store's own vocabulary
// filtered by a letter. Both run end-to-end through runTurn against a real
// temp memory store, so what they assert is what a session actually says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";
import * as source from "../../src/adapters/source.mjs";

const FACTS = [
  { subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: "corpus:wordnet-xl" },
  { subject: "a", predicate: "rdfs:subClassOf", object: "letter", provenance: "corpus:wordnet-xl" },
  { subject: "pear", predicate: "rdfs:subClassOf", object: "fruit", provenance: "corpus:wordnet-xl" },
  { subject: "pi", predicate: "rdfs:subClassOf", object: "constant", provenance: "corpus:wordnet-xl" },
  { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "corpus:wordnet-xl" },
];

async function seededStore(facts = FACTS) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-letter-terms-"));
  await appendFacts(dir, facts);
  return dir;
}

const turn = (line, memoryDir) => runTurn(line, { config: null, memoryDir, env: {}, last: null });

// The describe lanes need a real config to dispatch tmct_describe at all, so
// they run against the shipped code fixture. What they pin is the equivalence:
// whatever "p" answers, "the letter p" must answer too.
const CODE_FIXTURE = { graphFile: fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url)) };
let codeGraph;
async function describeTurn(line, memoryDir) {
  codeGraph ||= parseEntities(await source.fetchEntities(CODE_FIXTURE));
  return runTurn(line, { config: CODE_FIXTURE, graph: codeGraph, memoryDir, env: {}, last: null });
}

test('"what is the letter p" answers p\'s own facts, exactly as "what is p" does', async () => {
  const dir = await seededStore();
  try {
    const apposed = await turn("what is the letter p", dir);
    const bare = await turn("what is p", dir);
    assert.equal(apposed.record.miss, false);
    assert.match(apposed.answer, /p is a kind of letter/);
    assert.equal(apposed.answer, bare.answer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the apposition read also fires without the article: "what is letter p"', async () => {
  const dir = await seededStore();
  try {
    const r = await turn("what is letter p", dir);
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /p is a kind of letter/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a class word the store never pairs with the thing leaves the phrase alone", async () => {
  const dir = await seededStore();
  try {
    const r = await turn("what is the fruit p", dir);
    assert.equal(r.record.miss, true, "nothing types p as a fruit, so the phrase must not resolve to p");
    assert.doesNotMatch(r.answer, /p is a kind of letter/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a multi-word term the store knows in its own right keeps its own answer", async () => {
  const dir = await seededStore([
    ...FACTS,
    { subject: "body of water", predicate: "rdfs:subClassOf", object: "feature", provenance: "ace:chat" },
    { subject: "water", predicate: "rdfs:subClassOf", object: "body", provenance: "ace:chat" },
  ]);
  try {
    const r = await turn("what is a body of water", dir);
    assert.match(r.answer, /body of water is a kind of feature/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('"tell me about the letter p" describes whatever "tell me about p" describes', async () => {
  const dir = await seededStore();
  try {
    const apposed = await describeTurn("tell me about the letter p", dir);
    const bare = await describeTurn("tell me about p", dir);
    assert.equal(apposed.record.miss, false);
    assert.equal(apposed.answer, bare.answer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the bare-command route folds the apposition too: "describe the letter p"', async () => {
  const dir = await seededStore();
  try {
    const apposed = await describeTurn("describe the letter p", dir);
    const bare = await describeTurn("describe p", dir);
    assert.equal(apposed.answer, bare.answer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a describe target the store never types that way is not folded", async () => {
  const dir = await seededStore();
  try {
    const unconfirmed = await describeTurn("tell me about the fruit p", dir);
    const bare = await describeTurn("tell me about p", dir);
    assert.notEqual(unconfirmed.answer, bare.answer, "nothing types p as a fruit, so the phrase stands as written");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the containing-letter lane lists the store's own words, alphabetically", async () => {
  const dir = await seededStore();
  try {
    const r = await turn("give me words with the letter p in it", dir);
    assert.equal(r.record.miss, false);
    assert.equal(r.answer.split("\n")[0], 'Among the words I know, 3 contain "p": p, pear, pi.');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every closed phrasing of the containing-letter question answers identically", async () => {
  const dir = await seededStore();
  try {
    const baseline = (await turn("words containing p", dir)).answer;
    for (const line of [
      "words with the letter p in it",
      "words with the letter p in them",
      "words with p in it",
      "which words contain p",
      "words that contain p",
      "what words have the letter p",
      "show me words with the letter p",
    ]) {
      const r = await turn(line, dir);
      assert.equal(r.answer, baseline, `"${line}" must answer like "words containing p"`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a long containing-letter answer caps at 32 and pages the rest with 'more'", async () => {
  const many = [];
  for (let i = 0; i < 40; i += 1) {
    const suffix = String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    many.push({ subject: `zed${suffix}`, predicate: "rdfs:subClassOf", object: "thing", provenance: "ace:chat" });
  }
  const dir = await seededStore(many);
  try {
    const r = await turn("words containing z", dir);
    assert.match(r.answer, /Among the words I know, 40 contain "z"/);
    assert.match(r.answer, /…and 8 more — say 'more' to see them\./);
    const held = r.last.detail.pending.items;
    assert.equal(held.length, 8);
    const more = await runTurn("more", { config: null, memoryDir: dir, env: {}, last: r.last });
    assert.ok(more.answer.includes(held[0]), "the held remainder is what 'more' pages");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a letter no known word carries is an honest miss, never an empty list", async () => {
  const dir = await seededStore();
  try {
    const r = await turn("which words contain q", dir);
    assert.equal(r.record.miss, true);
    assert.equal(r.answer, 'none of the words I know contain "q".');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the membership-list lane still owns 'list all animals'", async () => {
  const dir = await seededStore();
  try {
    const r = await turn("list all animals", dir);
    assert.match(r.answer, /dog is a kind of animal/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
