// chatflow-canonical.test.mjs — SKILL_BENCHMARK_CONVERSATION.md Sec 0.1
// regression transcripts: the single most canonical, "anyone would try this
// first" textbook example for each of tmct's headline claims, frozen as a
// PERMANENT, always-run npm-test gate — not something that depends on a
// future playtest session remembering to check it.
//
// Born from a real miss (2026-07-10): a full 3-round playtest sprint
// carefully explored examples/mini-webapp and found real dead-ends, but every
// teach-test used codebase vocabulary ("every Widget is a Component") because
// every round was framed around codebase exploration. The operator's own very
// first try after the session, unprompted, was the classic textbook
// syllogism ("john is a man") and it hit a confusing, semantically-backwards
// decline message. This file exists so that class of miss can never again
// require a human to catch it by hand — it's now checked on every commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { createSession, runChat } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";
import { freshBootstrapRepo } from "./helpers/seeded-fixture.mjs";

const WALL = /couldn't parse this as a graph question/;

async function driveSession(queries) {
  clearCache();
  const dir = await freshBootstrapRepo("tmct-canonical-");
  const s = await createSession({ repoPath: dir });
  const turns = [];
  try {
    for (const q of queries) turns.push(await s.turn(q));
  } finally {
    await s.close();
  }
  return { dir, turns };
}

test("canonical: the classic textbook syllogism ('john is a man') never hits the wall, and its ungrounded-pair hint is sane, not a nonsensical chain", async () => {
  const { turns } = await driveSession(["john is a man"]);
  const [t0] = turns;
  assert.doesNotMatch(t0.answer, WALL, "the classic syllogism must never hit the raw grammar wall");
  // Regression pin for the 2026-07-10 fix: the OLD suggestion chained the
  // second unknown term under the first's now-grounded proper name ("every
  // man is a john") -- accepted by the grammar, nonsense to a human. The
  // fixed suggestion grounds both sides independently.
  assert.doesNotMatch(t0.answer, /is a john"/, "must never suggest chaining a common noun under a proper name");
  assert.match(t0.answer, /every man is a thing/, "must suggest grounding the second term independently");
});

test("canonical: the suggested grounding workaround for an ungrounded-pair teach actually works end to end", async () => {
  const { turns } = await driveSession([
    "every john is a thing",
    "every man is a thing",
    "every john is a man",
    "is john a man",
  ]);
  const [, , , t3] = turns;
  assert.match(t3.answer, /^yes/i, "after grounding both sides as suggested, the original fact must actually store and answer");
});

test("canonical: README's own headline 'teach it, then ask it to reason' example works verbatim", async () => {
  const graph = {
    individuals: [
      { id: "mod:src/handlers/base.mjs", label: "src/handlers/base.mjs", class: "Module" },
      { id: "mod:src/handlers/tasks.mjs", label: "src/handlers/tasks.mjs", class: "Module" },
      { id: "fn:src/handlers/base.mjs#Controller", label: "Controller", class: "Class" },
      { id: "fn:src/handlers/tasks.mjs#TaskController", label: "TaskController", class: "Class" },
    ],
    objectProperties: [{
      predicate: "inherits", prop: "seon:hasSuperType", count: 1,
      examples: [{
        subject: "fn:src/handlers/tasks.mjs#TaskController", object: "fn:src/handlers/base.mjs#Controller",
        subjectLabel: "TaskController", objectLabel: "Controller",
      }],
    }],
  };
  const repoPath = await mkdtemp(join(tmpdir(), "tmct-canonical-readme-"));
  try {
    await mkdir(join(repoPath, ".tmct"), { recursive: true });
    await writeFile(join(repoPath, ".tmct", "graph.json"), JSON.stringify(graph));
    async function tell(line) {
      const out = new PassThrough();
      let transcript = "";
      out.on("data", (chunk) => { transcript += chunk; });
      await runChat({ repoPath, input: Readable.from([`${line}\n`, "/exit\n"]), output: out });
      return transcript.split("\n").find((l) => l.startsWith("tmct> "));
    }
    await tell("a controller is a kind of handler");
    const answer = await tell("is TaskController a handler");
    assert.match(answer, /^tmct> yes/, "README's headline example must still produce a confident yes");
    assert.match(answer, /TaskController inherits Controller/, "must cite the graph-sourced premise");
    assert.match(answer, /controller is a kind of handler/, "must cite the taught premise");
  } finally {
    await rm(repoPath, { recursive: true, force: true });
  }
});

test("canonical: 'what is a cache' (README's own general-vocabulary claim) returns a real definition, not a miss", async () => {
  const { turns } = await driveSession(["what is a cache"]);
  const [t0] = turns;
  assert.doesNotMatch(t0.answer, WALL);
  assert.match(t0.answer, /cache/i);
  assert.doesNotMatch(t0.answer, /isn't a term in this graph/);
});

test("canonical: a plain greeting gets a real greeting back, not the grammar wall", async () => {
  const { turns } = await driveSession(["hi"]);
  assert.doesNotMatch(turns[0].answer, WALL);
});

test("canonical: a plain closing/thanks remark gets a warm sign-off, not the grammar wall", async () => {
  const { turns } = await driveSession(["thanks, that's everything for now"]);
  assert.doesNotMatch(turns[0].answer, WALL);
});
