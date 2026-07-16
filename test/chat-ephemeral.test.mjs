// Ephemeral mode — `tmct chat --ephemeral` (and TMCT_EPHEMERAL=1) reads the target
// graph but writes NOTHING back into it. The shipped `npm run example:*` demos run
// this way so a repeatable demo never dirties the committed code graph (it used to
// fold a session individual into examples/*/.tmct/graph.json and rewrite the file).
//
// Contract:
//   - the target graph.json is byte-identical after a multi-turn session;
//   - no .tmct memory / session droppings land under the target repo;
//   - the session still ANSWERS from the read graph (the concept force resolves).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

test("ephemeral: a multi-turn session leaves the target graph byte-identical and drops nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ephem-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    const graphPath = join(dir, ".tmct", "graph.json");
    await writeFile(graphPath, await readFile(FIXTURE, "utf8"));
    const before = await readFile(graphPath, "utf8");

    clearCache();
    const s = await createSession({ repoPath: dir, env: {}, ephemeral: true });
    const r1 = await s.turn("what is a class");
    await s.turn("every module is a component"); // an assert would normally persist a fact
    await s.close();

    // it still answered from the read graph
    assert.equal(s.empty, false, "the read graph loaded");
    assert.match(r1.answer, /class/i);

    // the committed graph is untouched, byte for byte
    assert.equal(await readFile(graphPath, "utf8"), before, "the target graph.json is unmodified");

    // nothing persisted under the target .tmct (no memory dir, no session logs/sidecars)
    const entries = await readdir(join(dir, ".tmct"));
    assert.deepEqual(entries, ["graph.json"], `only the code graph remains: ${JSON.stringify(entries)}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ephemeral: TMCT_EPHEMERAL=1 in the env has the same effect as the option", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ephem-env-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    const graphPath = join(dir, ".tmct", "graph.json");
    await writeFile(graphPath, await readFile(FIXTURE, "utf8"));
    const before = await readFile(graphPath, "utf8");

    clearCache();
    const s = await createSession({ repoPath: dir, env: { TMCT_EPHEMERAL: "1" } });
    await s.turn("what is a module");
    await s.close();

    assert.equal(await readFile(graphPath, "utf8"), before, "env opt-in also leaves the graph unmodified");
    assert.deepEqual(await readdir(join(dir, ".tmct")), ["graph.json"]);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
