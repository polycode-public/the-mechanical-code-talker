// The chat surface's anaphor resolution in the what-is/UsedFor reader, and
// the FORM every unresolvable cousin falls to: a pronoun or demonstrative
// that cannot bind must be named and declined in one coherent message —
// never looked up as a literal fact subject, never offered back as a
// teachable garble ("that before X was"), and never buried under a stack of
// unrelated orientation pointers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

/** A temp repo with the entities fixture as its code graph, plus a memory dir. */
async function graphRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-anaphor-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return {
    dir,
    config: { graphFile: join(dir, ".tmct", "graph.json") },
    graph: parseEntities(ingestSchemaDocs(payload)),
    memoryDir: join(dir, ".tmct", "memory"),
  };
}

test("'what is it used for' resolves the anaphor against the standing focus and answers that subject's UsedFor fact", async () => {
  const { dir, config, graph, memoryDir } = await graphRepo();
  try {
    clearCache();
    await runTurn("remember that a car is used for driving", { config, graph, memoryDir });
    const focus = { id: "x-car", label: "car" };
    const r = await runTurn("what is it used for", { config, graph, focus, memoryDir });
    assert.match(r.answer, /car is used for driving/, "the focus subject's own UsedFor fact answers");
    assert.doesNotMatch(r.answer, /it used for/, "the literal pronoun never survives as a subject");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the article never decides a used-for lookup: 'what is car used for' and 'what is a car used for' answer identically", async () => {
  const { dir, config, graph, memoryDir } = await graphRepo();
  try {
    clearCache();
    await runTurn("remember that a car is used for driving", { config, graph, memoryDir });
    const bare = await runTurn("what is car used for", { config, graph, memoryDir });
    const articled = await runTurn("what is a car used for", { config, graph, memoryDir });
    assert.match(bare.answer, /car is used for driving/);
    assert.match(articled.answer, /car is used for driving/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a taught participle-frame fact ('is used for') is found by the curated usedFor filter — the two predicate spellings converge", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-usedfor-fold-"));
  try {
    clearCache();
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const memoryDir = join(dir, ".tmct", "memory");
    await runTurn("remember that a kettle is used for boiling", { config, memoryDir });
    const r = await runTurn("what is a kettle used for", { config, memoryDir });
    assert.match(r.answer, /kettle is used for boiling/, "the freshly taught fact answers the used-for question");
    assert.doesNotMatch(r.answer, /I don't have any "is used for" facts/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a pronoun-subject used-for ask with NO focus names the pronoun in ONE message — no fact lookup on 'it', no teach offer, no index pointer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-cold-usedfor-"));
  try {
    clearCache();
    const r = await runTurn("what is it used for", { config: { graphFile: join(dir, ".tmct", "graph.json") }, memoryDir: join(dir, ".tmct", "memory") });
    assert.match(r.answer, /not sure what "it" refers to yet — name the subject directly/);
    assert.equal(r.answer.split("\n").length, 1, "one coherent miss, not a stack");
    assert.doesNotMatch(r.answer, /teach me directly/);
    assert.doesNotMatch(r.answer, /no code graph/);
    assert.equal(r.record.miss, true, "still recorded as a miss");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unbindable 'was that before X was touched' misses by naming the referent gap — never a teach offer for the garbled subject", async () => {
  const { dir, config, graph, memoryDir } = await graphRepo();
  try {
    clearCache();
    const r = await runTurn("was that before a.mjs was touched", { config, graph, memoryDir });
    assert.match(r.answer, /I don't have a referent for "that" yet/);
    assert.doesNotMatch(r.answer, /teach me directly/);
    assert.doesNotMatch(r.answer, /that before a\.mjs was/, "the garbled clause never reads back as a subject");
    assert.equal(r.record.miss, true);

    // The graph-less session falls to the same referent miss, not the garble.
    const bare = await runTurn("was this after b.mjs was modified", { config: { graphFile: join(dir, "nope", "graph.json") }, memoryDir });
    assert.match(bare.answer, /I don't have a referent for "this" yet/);
    assert.doesNotMatch(bare.answer, /teach me directly/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a comparison-shaped subject with a participle OUTSIDE the closed set still never becomes a teachable subject", async () => {
  const { dir, config, graph, memoryDir } = await graphRepo();
  try {
    clearCache();
    // "landed" is not in TEMPORAL_COMPARISON_RE's closed participle family,
    // so the comparison lane declines — the property readers must decline
    // the backtracked "that before a.mjs was" subject too.
    const r = await runTurn("was that before a.mjs was landed", { config, graph, memoryDir });
    assert.doesNotMatch(r.answer, /I don't know anything about "that before/);
    assert.doesNotMatch(r.answer, /remember that that before/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown-term 'what is X' on the generic wall collapses to the teach offer alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-collapse-"));
  try {
    clearCache();
    const r = await runTurn("what is a glorbath", { config: { graphFile: join(dir, ".tmct", "graph.json") }, memoryDir: join(dir, ".tmct", "memory") });
    assert.match(r.answer, /^I don't know "glorbath" yet — teach me directly/, "the offer IS the whole answer");
    assert.doesNotMatch(r.answer, /couldn't parse|couldn't read/);
    assert.doesNotMatch(r.answer, /no code graph/);
    assert.equal(r.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
