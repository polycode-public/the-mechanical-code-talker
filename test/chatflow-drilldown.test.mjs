// chatflow-drilldown.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts. A
// natural concept → members → definition → relation drill-down that USED to hit
// dead-ends now FLOWS end to end: every turn answers (miss:false) or gives a
// guiding nudge, no grammar wall, no "unknown qualifier". Freezes the flowing
// turns so a re-introduced dead-end is caught for free.
//
// The fixes under test (all routing, no grammar rigidity):
//   D1  "what functions are in X"      → members (what does X contain)
//   D2  "what defined X"               → where is X defined
//   D3  the RELATION concept force     → definition + example edges + follow-ups
//   D4  "what about <relation>"        → the relation force (not a bare lookup)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";
import { driveTurns } from "./helpers/session.mjs";

const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url).pathname;

async function repoWithFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-drilldown-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  ingestSchemaDocs(payload);
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

// Drive a sequence of turns through the real runTurn path, carrying `last` so
// discourse anaphora / "what about X" resolve exactly as the shell would.
const drive = driveTurns;

test("drill-down flow: the six-turn replay transcript flows end to end (was 4 dead-ends)", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const turns = [
      "what is a class",             // concept force (noun) — already worked
      "what functions are in Widget", // D1: members phrasing → contains
      "where is Button defined",      // already worked
      "what about imports",           // D3+D4: relation force (with prior context)
      "what calls are there",         // D3: relation force
      "what defined fnAlpha",         // D2: where-defined phrasing
    ];
    const rs = await drive(config, turns);

    // EVERY turn flows: not a miss, not the grammar wall, not an unknown-qualifier.
    for (let i = 0; i < rs.length; i += 1) {
      assert.equal(rs[i].record.miss, false, `turn ${i} "${turns[i]}" must not miss`);
      assert.doesNotMatch(rs[i].answer, /couldn't parse this as a graph question/, `turn ${i} no grammar wall`);
      assert.doesNotMatch(rs[i].answer, /unknown qualifier/, `turn ${i} no unknown-qualifier`);
      assert.doesNotMatch(rs[i].answer, /could mean more than one thing/, `turn ${i} no ambiguity dead-end`);
    }

    // D1 — members: "what functions are in Widget" reaches the contains answer.
    assert.match(rs[1].answer, /Widget\.render/, "members phrasing lists the class's members");
    // D3 — relation force: "what about imports" gets the three-band relation answer.
    assert.match(rs[3].answer, /^To import is to bring another module's definitions/, "relation definition band");
    assert.match(rs[3].answer, /app\/lib\/b\.mjs imports app\/lib\/a\.mjs.*\(7 import edges\)/, "example edges band + count");
    assert.match(rs[3].answer, /Want to go deeper\? Try:/, "guided follow-ups band");
    // D3 — "what calls are there" also reaches the relation force.
    assert.match(rs[4].answer, /A call is one function invoking another/, "calls relation definition");
    // D2 — where-defined: "what defined fnAlpha" reaches the definition location.
    assert.match(rs[5].answer, /fnAlpha.*is defined in app\/lib\/a\.mjs/, "where-defined phrasing resolves");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("relation force: emits definition + example edges + validated follow-ups (via corpus/seon)", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const { answer, record } = await runTurn("tell me about inheritance", { config });
    assert.equal(record.miss, false);
    assert.equal(record.via, "corpus/seon", "the relation definition is cited to corpus/seon");
    assert.equal(answer,
      "Inheritance is one class deriving its structure and behaviour from another.\n"
      + "In this codebase, for example: Widget inherits from Base and Button inherits from Widget (2 inheritance edges).\n"
      + "Want to go deeper? Try:\n"
      + "  • which classes inherit from Base\n"
      + "  • where is Widget defined\n"
      + "\n"
      + "Goal (inferred): Understand a class hierarchy/inheritance relationship.",
      "Tier-2 playtest cycle 9 Goal-line-gap fix: a relation-force answer (envelope.parsed "
      + "never stands for this vague-touch shape) now deduces its goal from the SAME relation "
      + "kind the force itself resolved, instead of silently carrying forward a null goal");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("relation force: 'more' pages the held remainder of example edges", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const first = await runTurn("what are the imports", { config });
    assert.match(first.answer, /…and 4 more — say 'more' to see them\./);
    assert.ok(first.last.detail.pending, "the remainder is held on last.detail.pending");
    const more = await runTurn("more", { config, last: first.last });
    assert.match(more.answer, /imports/, "the 'more' turn shows the held import edges");
    assert.doesNotMatch(more.answer, /say 'more'/, "nothing left to page after the last batch");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("what about X discipline: a relation word fires the force; a real entity keeps the discourse continuation", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    // prior turn resolves an entity; "what about <module>" should continue the shape,
    // NOT be hijacked by the relation force (a.mjs is not a relation word).
    const [, cont] = await drive(config, ["which modules import a.mjs", "what about b.mjs"]);
    assert.doesNotMatch(cont.answer, /To import is to bring/, "a real entity name keeps the discourse continuation");
    // whereas "what about imports" fires the relation force even after a prior answer.
    const [, rel] = await drive(config, ["where is Button defined", "what about imports"]);
    assert.match(rel.answer, /^To import is to bring/, "a relation word routes into the relation force");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("relation force: short relation touches ('what is calling', 'what about inheritance') are not grabbed as small-talk", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    for (const [q, lead] of [
      ["what is calling", /^A call is one function invoking another/],
      ["what about inheritance", /^Inheritance is one class deriving/],
      ["what is importing", /^To import is to bring/],
      ["what are the tests", /^A test is code that exercises/],
    ]) {
      clearCache();
      const { answer, record } = await runTurn(q, { config });
      assert.equal(record.miss, false, `"${q}" flows`);
      assert.match(answer, lead, `"${q}" reaches the relation force, not the orientation`);
      assert.doesNotMatch(answer, /I answer questions about THIS codebase/, `"${q}" is not the orientation`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("phrasing frames: the members + where-defined synonyms all route to the canonical shape", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    for (const q of ["what functions are in Widget", "what are the members of Widget", "what's in Widget", "what methods does Widget have"]) {
      clearCache();
      const { answer, record } = await runTurn(q, { config });
      assert.equal(record.miss, false, `"${q}" flows`);
      assert.match(answer, /Widget\.render/, `"${q}" reaches the members answer`);
    }
    for (const q of ["what defined fnAlpha", "what declared fnAlpha", "where's fnAlpha defined"]) {
      clearCache();
      const { answer, record } = await runTurn(q, { config });
      assert.equal(record.miss, false, `"${q}" flows`);
      assert.match(answer, /fnAlpha.*defined in app\/lib\/a\.mjs/, `"${q}" reaches the definition location`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
