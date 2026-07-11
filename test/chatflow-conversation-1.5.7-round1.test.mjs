// chatflow-conversation-1.5.7-round1.test.mjs — SKILL_BENCHMARK_CONVERSATION.md
// capped sprint (v1.5.7), round 1 — three real dead-ends found in a genuine
// multi-turn conversation against examples/mini-webapp (plus a Phase A bootstrap
// session), all fixed as routing/recognition gaps, not new grammar:
//
// 1. "thanks, that's everything for now" hit the raw grammar wall as a session's
//    LAST turn, even though a prior single-turn regression test for the exact
//    same phrase already existed and passed — that test only pinned "doesn't
//    match the wall text", which the isolated-turn miss happened not to; the
//    SAME phrase, as the 6th turn of a real session, produced the literal wall.
//    Root cause: farewellOrThanksSignal's multi-clause matcher (chat.mjs) gates
//    every non-thanks clause to <=3 words to avoid swallowing a real question
//    ("cheers, what does X do") — "that's everything for now" is 4 words, so it
//    never qualified. Fixed with a curated CLOSING_FILLER_CLAUSES exemption.
// 2. describeWrapperAnswer (the "tell me more about X" rescue lane) resolves and
//    confidently describes a real entity, but never told its caller which one —
//    so the session's focus was never updated, and the VERY NEXT natural
//    follow-up ("what calls it", "where's that defined", "what does it inherit
//    from") dead-ended on "'it' needs a selected node to refer to" right after
//    the engine had just named one. Fixed by having describeWrapperAnswer
//    return the resolved entity too, and threading it through nextFocus() the
//    same way the ordinary ask() object-resolution path already does.
// 3. describeWrapperAnswer's captured term never stripped a trailing bare
//    discourse tag ("tell me about Record then") — the same class of bug
//    HANDOVER.md 2026-07-10 item 8 already fixed for the meta-whatis vocab
//    lane, just not extended here. Fixed by reusing the existing
//    stripTrailingDiscourseTag (ask-vocab.mjs).
//
// Played against a tmpdir COPY of examples/mini-webapp's graph.json — never the
// committed fixture directly (a live session writes provenance state back into
// it), same discipline as chatflow-tier2-drilldown.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache } from "../src/source.mjs";
import { driveSessionTurns, stripGoalLine } from "./helpers/session.mjs";

const FIXTURE = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;
const WALL = /couldn't parse this as a graph question/;
const NEEDS_SELECTED_NODE = /needs a selected node to refer to/;

async function repoWithMiniWebapp() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-conv-r1-"));
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

test("round 1 fix: a closing/thanks remark after real session history still gets a warm sign-off, not the wall", async () => {
  const { dir, turns } = await driveSession([
    "what's in this codebase",
    "what classes are there",
    "what calls saveStore",
    "thanks, that's everything for now",
  ]);
  try {
    const last = turns[turns.length - 1];
    assert.doesNotMatch(last.answer, WALL, "the closing remark must never hit the raw grammar wall");
    assert.match(last.answer, /Any time\. Ask another/, "must be the real warm sign-off template, not just a non-wall miss");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("round 1 fix: describeWrapperAnswer ('tell me more about X') carries its resolved entity forward as the new focus", async () => {
  const queries = [
    "tell me more about Task",
    "what calls it",
    "where's that defined",
    "what does it inherit from",
  ];
  const { dir, turns } = await driveSession(queries);
  try {
    for (let i = 1; i < turns.length; i += 1) {
      assert.doesNotMatch(turns[i].answer, NEEDS_SELECTED_NODE,
        `turn ${i} ("${queries[i]}") must resolve "it"/"that" against the focus describeWrapperAnswer just set, not decline for lack of one`);
    }
    assert.match(turns[1].answer, /saveStore|validateTask/, "'what calls it' must name Task's real callers");
    assert.match(turns[2].answer, /src\/core\/model\.mjs/, "'where's that defined' must name Task's real definition site");
    assert.match(turns[3].answer, /Record/, "'what does it inherit from' must name Task's real superclass");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("round 1 fix: describeWrapperAnswer strips a trailing bare discourse tag ('tell me about X then')", async () => {
  const { dir, turns } = await driveSession(["tell me about Record then"]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.match(turns[0].answer, /Record — Class/, "must describe Record itself, not fail to resolve \"Record then\" as one literal term");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
