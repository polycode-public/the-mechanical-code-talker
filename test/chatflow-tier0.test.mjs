// chatflow-tier0.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts, Tier 0
// (the bootstrap/identity surface: no --repo, before any code graph). Freezes
// the flowing turns found in the 0.9.12 follow-up playtest cycle so a
// re-introduced dead-end is caught for free. Covers §3b's surface-variation
// axis (ESL word-order) and §0's new "an offered example that itself fails
// when tried" bullet, both played across a normally-seeded session AND
// TMCT_NO_SEED=1 (Tier 0's note requires both — an example that only works in
// one state and is offered in both is itself a dead-end).
//
// The fixes under test (all routing/wording, no new capability):
//   T1  ESL word-order: "explain [to me|please]* what is this/it/you" now
//       joins IDENTITY_PHRASES alongside the existing "explain what this is"
//       statement-order form — used to fall through to the grammar wall.
//   T2  vocabExampleHint's UNSEEDED branch and memorySummary's no-code-graph
//       hook now offer a CONCRETE, lexicon-verified teach pair ("every bug is
//       an issue") instead of the abstract "every X is a Y" placeholder — a
//       curious user who substitutes an intuitive-but-unknown word ("every
//       cache is a thing") into the old placeholder hit the teach-miss wall
//       right after being invited to try it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";
import { freshBootstrapRepo } from "./helpers/seeded-fixture.mjs";

const WALL = /couldn't parse this as a graph question/;

async function driveSession(env, queries) {
  clearCache();
  // env === undefined means "let the default (seeded) bootstrap apply" — for
  // those cases, start from a copy of the once-built shared bootstrap fixture
  // instead of paying the corpus parse+write cost per test (this suite only
  // ever CONSUMES the seeded state — the mechanism itself is wiring-seed.test.mjs's
  // job). An explicit env (e.g. TMCT_NO_SEED:"1") never seeds anyway, so it
  // stays on a plain empty tmpdir.
  const dir = env === undefined ? await freshBootstrapRepo("tmct-tier0-") : await mkdtemp(join(tmpdir(), "tmct-tier0-"));
  const s = await createSession({ repoPath: dir, env });
  const turns = [];
  try {
    for (const q of queries) turns.push(await s.turn(q));
  } finally {
    await s.close();
  }
  return { dir, turns, banner: s.bannerLines.join("\n") };
}

test("tier0/ESL: 'explain please what is this' and 'explain to me what is this' reach identity, not the grammar wall (seeded)", async () => {
  const { dir, turns } = await driveSession(undefined, [
    "helo",
    "you are what",
    "explain please what is this",
    "explain to me what is this",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    // T1 — both ESL word-order variants land the self-description, same as the
    // canonical "explain what this is" phrasing.
    assert.match(turns[2].answer, /I'm tmct — a deterministic, offline chat assistant/, "'explain please what is this' reaches identity-self");
    assert.match(turns[3].answer, /I'm tmct — a deterministic, offline chat assistant/, "'explain to me what is this' reaches identity-self");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier0/AI-identity: dialect/slang/typo greetings plus the AI-identity family all flow (seeded)", async () => {
  const { dir, turns } = await driveSession(undefined, [
    "g'day",
    "wassup",
    "are you chatgpt",
    "wat r u",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.match(turns[2].answer, /no LLM/i, "'are you chatgpt' gets tmct's actual no-LLM positioning");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier0/vocab-hint (seeded): the offered 'what is a cache' example actually resolves when tried in-session", async () => {
  const { dir, turns, banner } = await driveSession(undefined, [
    "hi",
    "what is a cache",
  ]);
  try {
    assert.match(banner, /what is a cache/, "seeded banner offers the term");
    assert.doesNotMatch(turns[1].answer, /couldn't parse|isn't a term in this graph/i, "the offered example resolves");
    assert.match(turns[1].answer, /fast, temporary store/, "the vocabulary answer is the real definition");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier0/vocab-hint (TMCT_NO_SEED=1): the offered teach example ('every bug is an issue') is concrete and actually resolves, taught then recalled", async () => {
  const { dir, turns, banner } = await driveSession({ TMCT_NO_SEED: "1" }, [
    "hi",
    "what do you know",
    "every bug is an issue",
    "what is a bug",
  ]);
  try {
    // The old abstract placeholder is gone from every unseeded "try this" surface.
    assert.doesNotMatch(banner, /what is a cache/, "unseeded banner never offers the seeded-only term");
    assert.doesNotMatch(banner, /teach me directly with "every X is a Y"/, "no longer offers the unverified abstract placeholder");
    assert.match(banner, /every bug is an issue/, "banner offers the concrete, verified teach pair");
    assert.match(turns[0].answer, /every bug is an issue/, "greeting's vocabHint carries the concrete pair too");
    assert.match(turns[1].answer, /every bug is an issue/, "'what do you know' hook offers the concrete pair, not the placeholder");
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    // T2 — the offered example itself, tried verbatim, actually stores and recalls.
    assert.match(turns[2].answer, /noted — remembered 1 fact: bug rdfs:subClassOf issue/, "the offered teach example stores");
    assert.match(turns[3].answer, /bug is a kind of issue/, "the taught fact is recalled by 'what is a bug'");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
