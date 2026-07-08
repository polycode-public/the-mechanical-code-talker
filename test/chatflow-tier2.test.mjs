// chatflow-tier2.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts, Tier 2
// (cross-concept & relation touches: "what about imports", "what calls are
// there", mixing nouns and relations — the RELATION concept force). Freezes
// the flowing turns found in the 0.9.14 playtest cycle so a re-introduced
// dead-end is caught for free. Played against a synthetic fixture graph
// (test/fixtures/entities.fixture.json) copied into a fresh tmpdir per test —
// never the shipped examples/mini-webapp graph, which is a committed artifact
// that would otherwise pick up stray session/provenance writes on every test
// run (the lesson from the Tier-1 cycle's own report).
//
// The fixes under test (all routing/wording + one new curated relation entry,
// no new query capability — every underlying query already worked directly):
//   T1  relationTermOf's own extra shapes ("what X are there", "what are the
//       X") had NO typo tolerance at all — "waht calls are there" fell
//       straight through to the grammar wall (relationTermOf reads the RAW
//       query, with no ask()-grammar envelope to inherit normalization from).
//       Fixed via interpret/normalize.mjs's new exported correctMisspellings()
//       (just the curated typo table, not the full normalizeQuery pipeline,
//       which would corrupt "tell me about X" into "about X").
//   T2  texting-shorthand "r" for "are"/"is" ("what r the calls", "what
//       calls r there") — narrowly scoped to relationTermOf's own closed
//       anchor shapes, same judgment call as chat.mjs's existing
//       SHORTHAND_CONTRACTIONS for the identity lane.
//   T3  vagueTouchTermOf ("tell me about X" / "what about X") had the same
//       typo gap ("waht about calls") plus its own dropped-letter typo ("tel
//       me about calls" missed the "^tell me about …" regex outright).
//   T4  vagueTouchTermOf now peels the SAME closed greeting/thanks/modal-
//       wrapper preambles ask()'s own grammar already peels (applyPreambleFrames,
//       not the full pipeline): "cheers, what about imports then" and "could
//       you kindly tell me about the calls" used to fall through to a bogus
//       object search ("no module matching 'kindly about' found").
//   T5  "g'day" (AU/NZ dialect, §3b) joins GREETING_PREAMBLE_RE's lead-in
//       alternation — "g'day, what does Base contain" used to parse "g'day
//       Base" as an ambiguous module search instead of stripping the greeting.
//   T6  a NEW curated relation, "reexports" (corpus/seon/relations.jsonl +
//       concept.mjs's RELATION_TERM/RELATION_KINDS/RELATION_RENDER/
//       RELATION_FOLLOWUP_SHAPES): "what about exports"/"tell me about
//       reexports" used to dead-end even though the direct query ("what does
//       X export") already worked — the vague-touch relation force simply had
//       no entry for the word at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const WALL = /couldn't parse this as a graph question/;
const BAD_SEARCH = /no module matching/;
const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url).pathname;

async function repoWithFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tier2-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

async function driveSession(queries) {
  clearCache();
  const dir = await repoWithFixture();
  const s = await createSession({ repoPath: dir });
  const turns = [];
  try {
    for (const q of queries) turns.push(await s.turn(q));
  } finally {
    await s.close();
  }
  return { dir, turns };
}

const CALLS_RELATION_TEXT =
  "A call is one function invoking another.\n"
  + "In this codebase, for example: scripts/g.mjs calls app/lib/a.mjs and Widget.render calls fnAlpha (2 call edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • what calls app/lib/a.mjs\n"
  + "  • what does scripts/g.mjs call";

test("tier2/relation-anchor typos: 'waht calls are there' and 'what r the calls' both reach the calls relation force", async () => {
  const { dir, turns } = await driveSession([
    "waht calls are there",
    "what r the calls",
    "what calls r there",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(t.answer, CALLS_RELATION_TEXT, `turn ${i} composes the calls relation force`);
    }
    // sanity: a real one-letter identifier is never at risk — "r" only reads as
    // "are"/"is" immediately after "what" inside these curated anchor shapes.
    const { turns: t2 } = await driveSession(["what does app/lib/a.mjs import"]);
    assert.doesNotMatch(t2[0].answer, WALL);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/vague-touch typos: 'waht about calls' and 'tel me about calls' both reach the calls relation force", async () => {
  const { dir, turns } = await driveSession([
    "waht about calls",
    "tel me about calls",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(t.answer, CALLS_RELATION_TEXT, `turn ${i} composes the calls relation force`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/politeness+dialect preambles: 'cheers, what about imports then' and 'could you kindly tell me about the calls' both flow", async () => {
  const { dir, turns } = await driveSession([
    "cheers, what about imports then",
    "could you kindly tell me about the calls",
  ]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.doesNotMatch(turns[0].answer, BAD_SEARCH);
    assert.match(turns[0].answer, /^To import is to bring another module's definitions/, "the greeting/tag preamble is peeled off, reaching the imports relation force");
    assert.doesNotMatch(turns[1].answer, WALL);
    assert.doesNotMatch(turns[1].answer, BAD_SEARCH);
    assert.equal(turns[1].answer, CALLS_RELATION_TEXT, "the modal+adverb wrapper is peeled off, reaching the calls relation force");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/g'day dialect lead-in: a direct graph question still resolves after the AU/NZ greeting is stripped", async () => {
  const { dir, turns } = await driveSession(["g'day, what does Base contain"]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.doesNotMatch(turns[0].answer, /matches more than one module ambiguously/, "the greeting must not be parsed as part of the object term");
    assert.match(turns[0].answer, /^Base has no contains edges in the index\.$/, "an honest, specific miss — Base genuinely has no contains edges in this fixture");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/reexports relation force: 'what about exports'/'tell me about reexports' reach the same three-band answer a direct query already supported", async () => {
  const { dir, turns } = await driveSession([
    "what does app/functions/d/handler.mjs export",
    "what about exports",
    "tell me about reexports",
    "what about reexports",
  ]);
  try {
    assert.equal(turns[0].answer, "fnAlpha.", "the direct query already worked before this cycle");
    const expected =
      "A re-export is a module passing another module's definition through as part of its own public API.\n"
      + "In this codebase, for example: app/functions/d/handler.mjs re-exports fnAlpha (1 re-export edge).\n"
      + "Want to go deeper? Try:\n"
      + "  • what does app/functions/d/handler.mjs export\n"
      + "  • where is fnAlpha defined";
    for (let i = 1; i < turns.length; i += 1) {
      assert.doesNotMatch(turns[i].answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(turns[i].answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(turns[i].answer, expected, `turn ${i} composes the reexports relation force`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/cross-concept drill-down: 'what is a class' -> 'what about inherits' -> 'which classes inherit from Widget' -> 'what about calls' flows end to end mixing nouns and relations", async () => {
  const { dir, turns } = await driveSession([
    "what is a class",
    "what about inherits",
    "which classes inherit from Widget",
    "what about calls",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
    }
    assert.match(turns[0].answer, /^A class is a template/, "the noun concept force answers 'what is a class'");
    assert.match(turns[1].answer, /^Inheritance is one class deriving/, "the relation concept force answers 'what about inherits'");
    assert.equal(turns[2].answer, "in app/lib/c.mjs there is Button.", "a direct graph query still resolves mid-chain");
    assert.equal(turns[3].answer, CALLS_RELATION_TEXT, "'what about calls' composes the calls relation force to close the chain");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
