// [graph] read_only in a repo's tmct.toml — a chat session against it reads the
// graph but writes NOTHING back, even with no --ephemeral flag. This is what
// keeps a plain `tmct chat --repo examples/<x>` from folding a Session node into
// a committed, hand-stamped fixture graph. The mechanism reuses ephemeral's
// write-diversion; this pins the toml-driven entry to it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

test("read_only tmct.toml: a non-ephemeral session leaves the target graph byte-identical and drops nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ro-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    const graphPath = join(dir, ".tmct", "graph.json");
    await writeFile(graphPath, await readFile(FIXTURE, "utf8"));
    await writeFile(join(dir, "tmct.toml"), "[graph]\nread_only = true\n");
    const before = await readFile(graphPath, "utf8");

    clearCache();
    // no ephemeral flag — the read-only behaviour comes only from the toml.
    const s = await createSession({ repoPath: dir, env: {} });
    const r1 = await s.turn("what is a class");
    await s.turn("every module is a component"); // an assert would normally persist a fact
    await s.close();

    assert.equal(s.empty, false, "the read graph loaded");
    assert.match(r1.answer, /class/i);

    assert.equal(await readFile(graphPath, "utf8"), before, "the target graph.json is unmodified");

    // only the graph and the tmct.toml remain under the target repo — no session
    // logs, no sidecar, no memory dir landed in the committed fixture's tree.
    const rootEntries = (await readdir(dir)).sort();
    assert.deepEqual(rootEntries, [".tmct", "tmct.toml"], `unexpected repo droppings: ${JSON.stringify(rootEntries)}`);
    assert.deepEqual(await readdir(join(dir, ".tmct")), ["graph.json"], "only the code graph remains under .tmct");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
