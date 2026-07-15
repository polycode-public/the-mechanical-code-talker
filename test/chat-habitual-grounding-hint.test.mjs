// A bare habitual teach ("penguins swim") whose subject is grounded nowhere
// gets an honest grounding hint, not the orientation card — and the hint's
// own suggested phrasing round-trips: ground the subject, repeat the
// sentence, and the capability stores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-hab-${tag}-`));

test("'penguins swim' with an unknown subject gets the grounding hint, not the orientation card, and stores nothing", async () => {
  const dir = await mem("hint");
  try {
    const turn = await runTurn("penguins swim", { config: CONFIG, memoryDir: dir, sessionId: "h1" });
    assert.match(turn.answer, /I don't know "penguin" yet/);
    assert.match(turn.answer, /every penguin is a thing/);
    assert.doesNotMatch(turn.answer, /I'm tmct/);
    assert.equal(turn.record.miss, true);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the hint round-trips: ground the subject with the suggested sentence, repeat 'penguins swim', and the capability stores and reads back", async () => {
  const dir = await mem("roundtrip");
  try {
    const ground = await runTurn("every penguin is a thing", { config: CONFIG, memoryDir: dir, sessionId: "h2" });
    assert.equal(ground.record.miss, false);

    const taught = await runTurn("penguins swim", { config: CONFIG, memoryDir: dir, sessionId: "h2" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /noted — remembered: penguin can swim/);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "penguin" && r.predicate === "mgx:capableOf" && r.object === "swim"));

    const can = await runTurn("can a penguin swim", { config: CONFIG, memoryDir: dir });
    assert.match(can.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the explicit capability surfaces follow the same grounding rules: 'a wren can sing' stores once the subject is fact-grounded, and a plural surface stores under the singular", async () => {
  const dir = await mem("explicit-can");
  try {
    const ungrounded = await runTurn("penguins can swim", { config: CONFIG, memoryDir: dir, sessionId: "h4" });
    assert.match(ungrounded.answer, /I don't know "penguin" yet/);

    await runTurn("every wren is a bird", { config: CONFIG, memoryDir: dir, sessionId: "h4" });
    const explicit = await runTurn("a wren can sing", { config: CONFIG, memoryDir: dir, sessionId: "h4" });
    assert.equal(explicit.record.miss, false);
    const plural = await runTurn("wrens can hum", { config: CONFIG, memoryDir: dir, sessionId: "h4" });
    assert.equal(plural.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "wren" && r.predicate === "mgx:capableOf" && r.object === "sing"));
    assert.ok(rows.some((r) => r.subject === "wren" && r.predicate === "mgx:capableOf" && r.object === "hum"));
    assert.ok(!rows.some((r) => r.subject === "wrens"));

    const can = await runTurn("can a wren hum", { config: CONFIG, memoryDir: dir });
    assert.match(can.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'jokes please' keeps the conversational card — a discourse tail is never read as a habitual verb", async () => {
  const dir = await mem("jokes");
  try {
    const turn = await runTurn("jokes please", { config: CONFIG, memoryDir: dir, sessionId: "h3" });
    assert.doesNotMatch(turn.answer, /Ground it first/);
    assert.doesNotMatch(turn.answer, /I don't know/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
