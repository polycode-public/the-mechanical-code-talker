// `tmct init --repo <path> --with-persona code` composes two independent
// mechanisms into one onboarding command: the corpus-bias preset the persona
// already wrote, and the repository indexer (src/index/index-repo.mjs) run
// against the repo's own real source. This proves the composition end to
// end — one CLI invocation, then a single in-process chat session answering
// both a vocabulary question (off the seeded corpus) and a code-structure
// question (off the self-produced graph).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, cp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { renderTomlConfig, PERSONA_PRESETS } from "../../src/services/init.mjs";

const BIN = fileURLToPath(new URL("../../bin/tmct.mjs", import.meta.url));
const JS_REPO_FIXTURE = fileURLToPath(new URL("../fixtures/js-repo", import.meta.url));
const runCli = (args, opts = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });

async function copyOfJsRepoFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-init-persona-code-"));
  await cp(JS_REPO_FIXTURE, dir, { recursive: true });
  return dir;
}

const exists = (p) => access(p).then(() => true, () => false);

/** A tmct.toml identical in shape to what `--with-persona code` itself writes
 *  (seon+conceptnet active, [bias] set), except the conceptnet fact count is
 *  capped and its unknown-context scan turned off — trimming the corpus seed
 *  from the shipped tens-of-thousands-of-rows band down to a few hundred
 *  facts. The seed step this exercises is real (not TMCT_NO_SEED'd away),
 *  just sized so the fact question below still has something to answer from
 *  without the test paying for the full uncapped band. */
async function writeFastPersonaCodeToml(dir) {
  const config = {
    seed: { captureUnknownContext: false, limit: 50 },
    extensions: PERSONA_PRESETS.code.extensions,
    bias: PERSONA_PRESETS.code.bias,
  };
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "tmct.toml"), renderTomlConfig(config));
}

test("`tmct init --repo <dir> --with-persona code` writes a self-produced graph, and the same chat session answers a fact question and a code-structure question off it", async () => {
  const dir = await copyOfJsRepoFixture();
  try {
    await writeFastPersonaCodeToml(dir);
    const r = runCli(["init", "--repo", dir, "--with-persona", "code"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /code persona: indexed the repo — wrote .*graph\.json \(4 modules, 9 symbols/);
    assert.match(r.stdout, /js\/ts: 4 modules, 9 symbols/);
    assert.match(r.stdout, /indexed 4 modules \(9 symbols\) — code questions now work/, "a produced graph announces the capability it unlocked");
    assert.match(r.stdout, /Seeded \d+ corpus facts? into memory/);

    const graphFile = join(dir, ".tmct", "graph.json");
    assert.ok(await exists(graphFile), "the indexer's graph.json artifact exists");
    const entities = JSON.parse(await readFile(graphFile, "utf8"));
    assert.ok(Array.isArray(entities.individuals) && entities.individuals.length > 0, "the graph carries real modules, not an empty bootstrap graph");

    clearCache();
    const session = await createSession({ repoPath: dir });
    try {
      const fact = await session.turn("what is a dog");
      assert.match(fact.answer, /dog is a kind of animal/, "the fact question answers off the persona's seeded corpus");

      const structure = await session.turn("which modules import src/base.mjs");
      assert.match(structure.answer, /src\/widget\.mjs/, "the code-structure question answers off the self-produced graph, in the SAME session");
    } finally {
      await session.close();
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init --with-persona code` against a repo with no supported source: degrades to a graphless-but-initialized repo, never a crash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-init-persona-code-empty-"));
  try {
    // Content is irrelevant to this assertion (the indexing gate, not seed content),
    // so skip the corpus seed entirely to keep this a fast CLI-process test.
    const r = runCli(["init", "--with-persona", "code"], { cwd: dir, env: { ...process.env, TMCT_NO_SEED: "1" } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no supported source found under the repo/);
    assert.doesNotMatch(r.stdout, /code questions now work/, "no source means no capability announce line");
    const graphFile = join(dir, ".tmct", "graph.json");
    assert.ok(await exists(graphFile), "the indexer still writes an (empty-modules) graph.json — degrade, don't skip the write");
    const entities = JSON.parse(await readFile(graphFile, "utf8"));
    const modules = entities.individuals.filter((i) => i.class === "Module");
    assert.deepEqual(modules, [], "no source means no Module individuals, not a crash (the schema self-docs still bake in)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a plain `tmct init` (no --with-persona code) never runs the indexer — no .tmct/graph.json appears", async () => {
  const dir = await copyOfJsRepoFixture();
  try {
    const r = runCli(["init"], { cwd: dir, env: { ...process.env, TMCT_NO_SEED: "1" } });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /indexed the repo/);
    assert.equal(await exists(join(dir, ".tmct", "graph.json")), false, "the bare persona (or no persona) never triggers indexing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
