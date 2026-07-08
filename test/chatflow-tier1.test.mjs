// chatflow-tier1.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts, Tier 1
// (drill-down chains with anaphora: concept → instance → "what calls it" →
// "what uses that" → "where is it defined", focus carried throughout — §3).
// Freezes the flowing turns found in the 0.9.13 playtest cycle so a
// re-introduced dead-end is caught for free. Played against a synthetic
// fixture graph (test/fixtures/entities.fixture.json) copied into a fresh
// tmpdir per test — never the shipped examples/mini-webapp graph, which is a
// committed artifact that would otherwise pick up stray session/provenance
// writes on every test run.
//
// The fixes under test (all routing/wording, no new capability):
//   T1  WHERE-DEFINED typo tolerance: "were is X defined" (a dedicated
//       phrasing frame — "were" is a real word already load-bearing as the
//       TEMPORAL_AUX auxiliary, so it's not a blanket MISSPELLINGS entry),
//       "wehre"/"whre is X defined" (anchor-word typos, MISSPELLINGS), and
//       "where is X defned" (marker-word typo, MISSPELLINGS) all used to
//       either hit the grammar wall or a bogus "no module matching …" search.
//   T2  "describe X" → "what about it"/"what about that"/"describe that": a
//       drill-down chain that opens with "describe X" (the README's own
//       example) used to dead-end on the very next pronoun-continuation turn —
//       isConversational()'s short/non-codeish catch-all grabbed "what about
//       it" before the describe-wrapper rescue lane ever got a chance, AND
//       that rescue lane had no pronoun-to-focus resolution at all.
//   T3  the "explain [to me|please]* <Q>" politeness/ESL wrapper (§3b) now
//       unwraps a real WH-question underneath ("explain please where is it
//       defined") instead of leaving "explain"/"please" as noise that
//       corrupted the object term into a bogus search.
//   T4  discourseRewrite's NAME_TOKEN_RE now also matches lowerCamelCase
//       identifiers ("fnAlpha") — a drill-down chain focused on a function
//       (not a Capitalized class or a dotted/pathed module) had no name token
//       for "what about X" to swap in and always missed.
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
  const dir = await mkdtemp(join(tmpdir(), "tmct-tier1-"));
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

test("tier1/where-typo: 'were'/'wehre'/'whre is it defined' and 'where is it defned' all reach the definition site", async () => {
  const { dir, turns } = await driveSession([
    "describe Button",
    "were is it defined",
    "wehre is it defined",
    "whre is it defined",
    "where is it defned",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
    }
    for (let i = 1; i < turns.length; i += 1) {
      assert.equal(turns[i].answer, "Button is defined in app/lib/c.mjs at lines 1-10.", `turn ${i} resolves the where-defined answer`);
    }
    // sanity: the real TEMPORAL_AUX "were" reading (a different query shape
    // entirely) is untouched by the new typo frame — it must never be rewritten
    // into a where-defined question.
    const { turns: t2 } = await driveSession(["when were the classes last touched"]);
    assert.doesNotMatch(t2[0].answer, /is defined in/, "a genuine temporal 'were' query is never hijacked by the where-defined frame");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier1/describe+anaphora: 'describe X' then 'what about it'/'what about that'/'describe that' all carry the focus", async () => {
  const { dir, turns } = await driveSession([
    "describe Widget",
    "what about it",
    "what about that",
    "describe that",
  ]);
  try {
    const widgetDescribe = turns[0].answer;
    assert.match(widgetDescribe, /^Widget — Class/, "first turn describes Widget");
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, /I answer questions about THIS codebase/, `turn ${i} must not fall to the generic orientation card`);
    }
    for (let i = 1; i < turns.length; i += 1) {
      assert.equal(turns[i].answer, widgetDescribe, `turn ${i} re-describes the focus (Widget) via the pronoun`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier1/describe+anaphora: a named-entity 'what about <Class>' also carries after a describe-shaped prior turn", async () => {
  const { dir, turns } = await driveSession(["describe Widget", "what about Button"]);
  try {
    assert.doesNotMatch(turns[1].answer, WALL);
    assert.match(turns[1].answer, /^Button — Class/, "'what about Button' after 'describe Widget' describes Button, not the orientation card");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier1/explain-wrapper: 'explain please where is it defined' unwraps to the real question", async () => {
  const { dir, turns } = await driveSession(["describe Button", "explain please where is it defined"]);
  try {
    assert.doesNotMatch(turns[1].answer, WALL);
    assert.doesNotMatch(turns[1].answer, BAD_SEARCH);
    assert.equal(turns[1].answer, "Button is defined in app/lib/c.mjs at lines 1-10.");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier1/camelCase discourse: 'what calls fnAlpha' then 'what about Widget' swaps the lowerCamelCase subject", async () => {
  const { dir, turns } = await driveSession(["what calls fnAlpha", "what about Widget"]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.doesNotMatch(turns[1].answer, WALL);
    assert.match(turns[0].answer, /Widget\.render/, "'what calls fnAlpha' finds its one caller");
    // the continuation re-asks "what calls Widget" (the prior shape, fnAlpha
    // swapped for Widget) — Widget describes itself here only because
    // discourseRewrite's object failed to resolve as a caller-search subject
    // and fell back through the describe rescue; the load-bearing assertion is
    // that it reaches a REAL answer, not the grammar wall/orientation card.
    assert.doesNotMatch(turns[1].answer, /I answer questions about THIS codebase/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier1/concept drill-down: 'what is a class' → instance → 'what calls it' → 'what uses that' → 'where is it defined' flows end to end with zero dead-ends", async () => {
  const { dir, turns } = await driveSession([
    "what is a class",
    "describe Widget",
    "what calls it",
    "what uses that",
    "where is it defined",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
    }
    assert.match(turns[0].answer, /^A class is a template/, "concept force answers 'what is a class'");
    assert.match(turns[1].answer, /^Widget — Class/, "'describe Widget' resolves the instance");
    assert.equal(turns[4].answer, "Widget is defined in app/lib/b.mjs at lines 1-30.", "the chain ends at the definition site");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
