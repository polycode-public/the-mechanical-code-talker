// chatflow-conversation-1.5.7-round2.test.mjs — SKILL_BENCHMARK_CONVERSATION.md
// capped sprint (v1.5.7), round 2 — one real, confidently-WRONG-answer dead-end
// found continuing a live multi-turn conversation against examples/mini-webapp:
//
// "is there anything that tests Task", asked right after focus had landed on
// UserController (from the immediately preceding "tell me about UserController"),
// answered "No — no tests edge found from UserController to Task" — silently
// substituting the standing focus as the subject instead of treating "anything"
// as an open existential search. Worse than a miss: a confidently wrong answer.
// The sibling gerund phrasing "is anything testing Task" already worked
// correctly (parses as the reverse-relation lookup, same as "what tests Task"),
// but the relative-clause form ("is there anything that tests Task") fell
// through parseExistence (ask.mjs — "anything" isn't a real entity-kind noun)
// into the generic anaphoric ask-shape instead. Fixed with a closed textual
// rewrite, existentialAnythingRewrite (chat.mjs): "is there anything/something/
// anyone/anybody that/which/who <verb-phrase>" -> "what <verb-phrase>", reusing
// the already-correct "what <verb> X" reverse-relation shape rather than adding
// new AST-shape logic. Applied unconditionally in the same rewrite chain as
// discourseRewrite/superlativeRepeatRewrite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache } from "../src/source.mjs";
import { driveSessionTurns, stripGoalLine } from "./helpers/session.mjs";

const FIXTURE = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;

async function repoWithMiniWebapp() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-conv-r2-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

async function driveSession(queries) {
  const dir = await repoWithMiniWebapp();
  const turns = await driveSessionTurns({ repoPath: dir }, queries, { strip: stripGoalLine });
  return { dir, turns };
}

test("round 2 fix: 'is there anything that tests X' answers correctly even with an unrelated standing focus, never substitutes the focus as subject", async () => {
  const { dir, turns } = await driveSession([
    "tell me about UserController", // sets focus to UserController, NOT Task
    "is there anything that tests Task",
  ]);
  try {
    const last = turns[turns.length - 1];
    assert.doesNotMatch(last.answer, /UserController/, "must never substitute the standing focus as the subject");
    assert.match(last.answer, /test\/tasks\.test\.mjs/, "must name Task's real test file");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("round 2 fix: the relative-clause and gerund existential phrasings agree", async () => {
  const { dir, turns } = await driveSession([
    "is there anything that tests Task",
    "is anything testing Task",
  ]);
  try {
    assert.equal(turns[0].answer, turns[1].answer, "'that tests' and 'testing' phrasings of the same existential question must answer identically");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("round 2 guard: the UNRELATED 'is there a <kind> called <name>' existence-check shape is untouched by the new rewrite", async () => {
  const { dir, turns } = await driveSession([
    "is there a class called Store",
    "is there a class called Bananas",
  ]);
  try {
    assert.match(turns[0].answer, /^Yes — Store is a class/);
    assert.match(turns[1].answer, /^No — no class named "Bananas" found/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
