// Conjunction teach: "X is A and is B" splits at the top-level " and <verb>"
// seam, re-attaches the shared subject, and stores both halves through the
// ordinary teach cascade. The confirmation names both facts; a half that
// declines is named — never a silent partial store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-conj-${tag}-`));

test("'ahab is male and is the father of john' stores both facts, names both, and both read back", async () => {
  const dir = await mem("both");
  try {
    const taught = await runTurn("ahab is male and is the father of john", { config: CONFIG, memoryDir: dir, sessionId: "c1" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /remembered both/);
    assert.match(taught.answer, /ahab is male/);
    assert.match(taught.answer, /ahab fathers john/);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "ahab" && r.object === "male"));
    assert.ok(rows.some((r) => r.subject === "ahab" && r.predicate === "mgx:father" && r.object === "john"));

    const father = await runTurn("is ahab the father of john", { config: CONFIG, memoryDir: dir });
    assert.match(father.answer, /^yes —/);
    const male = await runTurn("is ahab male", { config: CONFIG, memoryDir: dir });
    assert.match(male.answer, /^yes —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the wrapped form ('remember that X has a hat and can sing') stores both halves too", async () => {
  const dir = await mem("wrapped");
  try {
    const taught = await runTurn("remember that tony has a hat and can sing", { config: CONFIG, memoryDir: dir, sessionId: "c2" });
    assert.equal(taught.record.miss, false);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "tony" && r.predicate === "mgx:hasA" && r.object === "hat"));
    assert.ok(rows.some((r) => r.subject === "tony" && r.predicate === "mgx:capableOf" && r.object === "sing"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a second clause with its own subject ('… and the weather is nice') is declined by name while the first half stores", async () => {
  const dir = await mem("own-subject");
  try {
    const taught = await runTurn("ahab is male and the weather is nice", { config: CONFIG, memoryDir: dir, sessionId: "c3" });
    assert.equal(taught.record.miss, false);
    assert.match(taught.answer, /ahab is male/);
    assert.match(taught.answer, /the weather is nice/);
    assert.match(taught.answer, /names its own subject/);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "ahab" && r.object === "male"));
    assert.ok(!rows.some((r) => r.subject === "weather"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a shared-subject half that cannot store is named in the reply — never a silent partial store", async () => {
  const dir = await mem("half-fail");
  try {
    const taught = await runTurn("zorp is male and is a blimble", { config: CONFIG, memoryDir: dir, sessionId: "c4" });
    assert.match(taught.answer, /zorp is male/);
    assert.match(taught.answer, /couldn't store/);
    assert.match(taught.answer, /zorp is a blimble/);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "zorp" && r.object === "male"));
    assert.ok(!rows.some((r) => r.object === "blimble"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
