// The ACE assertTurn stitch: a declarative sentence in a live session asserts
// into tmct's own memory graph and confirms; bare runTurn (no memoryDir) stays
// pure and falls through to the query engine; questions never trigger asserts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { runTurn, runChat } from "../src/chat.mjs";
import { loadMemory, FACT_CLASS } from "../src/memory/core.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url).pathname;

function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  let text = "";
  out.on("data", (c) => (text += c));
  return { out, text: () => text };
}

test("assertTurn: a declarative ACE sentence in a session lands a Fact in memory and confirms", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-assert-"));
  try {
    const input = Readable.from(["every module is a component\n", "/exit\n"]);
    const { out, text } = sink();
    // (TMCT_NO_SEED: this test counts EXACT facts — the W3 corpus seed has its own suite)
    await runChat({ repoPath: dir, input, output: out, env: { TMCT_NO_SEED: "1" } });
    assert.match(text(), /noted — remembered 1 fact: module rdfs:subClassOf component/);
    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 1, "exactly one fact stored");
    const attr = (k) => facts[0].attributes.find((a) => a.key === k)?.value;
    assert.equal(attr("subject"), "module");
    assert.equal(attr("predicate"), "rdfs:subClassOf");
    assert.equal(attr("object"), "component");
    assert.match(attr("provenance"), /^ace:chat:/, "chat provenance tag recorded");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertTurn: bare runTurn without memoryDir stays pure — declaratives fall through to the engine", async () => {
  const { answer, record } = await runTurn("every module is a component", { config: { graphFile: FIXTURE } });
  assert.doesNotMatch(answer, /noted — remembered/, "no assert without a session shell");
  assert.equal(record.command, undefined);
});

test("assertTurn: a teach-lane turn's answer carries a 'Canonical: …' line matching record.canonical", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-assert-"));
  try {
    const r = await runTurn("every module is a component", { memoryDir: dir, sessionId: "s1" });
    assert.ok(r.record.canonical, "assertTurn must set record.canonical");
    const { english, machine } = r.record.canonical;
    const expected = `Canonical: ${english} — ${machine}`;
    assert.ok(r.answer.includes(expected), `answer must include "${expected}", got: ${r.answer}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runAsk: a query-lane turn's answer carries a 'Canonical: …' line matching record.canonical", async () => {
  const graph = parseEntities(await source.fetchEntities({ graphFile: FIXTURE }));
  const r = await runTurn("which modules import a.mjs", { config: { graphFile: FIXTURE }, graph });
  assert.ok(r.record.canonical, "runAsk must set record.canonical");
  const { english, machine } = r.record.canonical;
  const expected = `Canonical: ${english} — ${machine}`;
  assert.ok(r.answer.includes(expected), `answer must include "${expected}", got: ${r.answer}`);
  assert.match(r.answer, /Goal \(inferred\):.*\n\nCanonical:/, "the Canonical line sits right after the Goal line");
});

test("a plain conversational turn (record.canonical: null) never grows a spurious 'Canonical:' line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-assert-"));
  try {
    const r = await runTurn("hi", { memoryDir: dir, sessionId: "s1" });
    assert.ok(!r.record.canonical, "a conversational turn carries no real canonical");
    assert.doesNotMatch(r.answer, /Canonical:/, "no Canonical line without a real record.canonical");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertTurn: questions and unknown-word declaratives never assert in a session", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-assert-"));
  try {
    const input = Readable.from([
      "which modules import a.mjs\n",          // a question — engine path
      "every frobnicator is a doohickey\n",     // unknown lexicon words — residue, falls through
      "/exit\n",
    ]);
    const { out, text } = sink();
    // (TMCT_NO_SEED: this test counts EXACT facts — the W3 corpus seed has its own suite)
    await runChat({ repoPath: dir, input, output: out, env: { TMCT_NO_SEED: "1" } });
    assert.doesNotMatch(text(), /noted — remembered/);
    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === FACT_CLASS).length, 0, "no facts written");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
