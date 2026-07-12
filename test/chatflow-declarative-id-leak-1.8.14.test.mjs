// chatflow-declarative-id-leak-1.8.14.test.mjs — BENCHMARK_CONVERSATION_1.8.14.md
// item 7(b) (persona-sweep, non-native-speaker persona), confirmed live against
// examples/mini-webapp: a plain declarative with a trailing hedge, "the Router is
// used by every handler, I think", misfires into the verification-question path
// (kind:"uses", subject:"Router") — a known, separately-tracked routing gap (item
// 7(a), not fixed here) — and its OBJECT term ends up as the garbled "handler I
// think" (the trailing hedge leaking into the object slot once interpret/
// pipeline.mjs's noise-strip re-parse drops "every" as a stopword). That garbled
// term then resolved, live, via resolveObject's tier-4 prose fallback to a
// THREE-WAY TIE (two Commits sharing generic prose tokens with "handler"/"think",
// plus the real Router symbol) — genuinely ambiguous, `ambiguous: true` — but
// ask.mjs's shape==="ask" traverse() branch (src/ask.mjs, the `if (!subj.match ||
// !obj.match)` guard) never checked that flag, so it silently used the FIRST tied
// candidate as if it were a confident single match. That candidate happened to be
// a Commit individual, whose "label" IS its short hash — so the raw internal id
// "c3d4e5f6a1b2" rode straight into the Yes/No render's "No — no uses edge found
// from Router to c3d4e5f6a1b2." sentence, a confidently-wrong answer that leaks an
// internal id, not an honest miss.
//
// Fixed at the root of the leak (src/ask.mjs, shape==="ask"): the traverse()
// guard now also declines (the same honest "couldn't resolve one of the terms in
// this question" miss the plain unresolved case already uses) whenever either
// side's resolution is `ambiguous`, exactly like every other shape in this file
// already respects that flag. This does not fix the upstream misrouting (item
// 7(a), a separate closed-set-design question about parse-order between the
// teach lane and the verification-question lane) — it closes the leak: an
// ambiguous/tied resolution can never again surface a raw internal id as if it
// were a confident answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache } from "../src/source.mjs";
import { driveSessionTurns, stripGoalLine } from "./helpers/session.mjs";

const FIXTURE = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;

async function repoWithMiniWebapp() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-declarative-leak-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

test("a plain declarative with a trailing hedge never leaks a raw commit-hash id, even when its garbled object term resolves to a tied/ambiguous match", async () => {
  const dir = await repoWithMiniWebapp();
  try {
    const turns = await driveSessionTurns(
      { repoPath: dir },
      ["the Router is used by every handler, I think"],
      { strip: stripGoalLine },
    );
    const answer = turns[0].answer;
    // the actual bug: a raw internal commit id surfacing as if it were a real
    // resolved answer term.
    assert.doesNotMatch(answer, /c3d4e5f6a1b2/, "must never leak the raw commit-hash id into the answer");
    assert.doesNotMatch(answer, /f6a1b2c3d4e5/, "must never leak the OTHER tied commit's raw id either");
    // never a confidently-wrong Yes/No over the tied match — an honest decline.
    assert.doesNotMatch(answer, /^No — no uses edge found/);
    assert.match(answer, /couldn't resolve one of the terms/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the same relation WITHOUT the trailing hedge still answers normally (unambiguous object, no regression)", async () => {
  const dir = await repoWithMiniWebapp();
  try {
    const turns = await driveSessionTurns(
      { repoPath: dir },
      ["the Router is used by every handler"],
      { strip: stripGoalLine },
    );
    const answer = turns[0].answer;
    assert.match(answer, /^No — no uses edge found from Router to /);
    assert.doesNotMatch(answer, /c3d4e5f6a1b2/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
