// W3 seam tests — seedMemory → bootstrap (ROADMAP Phase 4).
//
//   - a graph-less first run seeds SEED_LIMIT corpus facts into .tmct/memory,
//     says so honestly in the banner, and writes the marker;
//   - the marker prevents a re-seed (second session: no seed line, same facts);
//   - TMCT_NO_SEED=1 opts out entirely;
//   - a fixture-graph repo never seeds;
//   - the real binary in an empty dir still greets and exits 0 (the final gate,
//     now with seeding).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, SEED_LIMIT, SEED_MARKER_REL } from "../src/chat.mjs";
import { loadMemory, FACT_CLASS } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

// The graph-less bootstrap now seeds in TWO passes (chat.mjs seedBootstrapMemory):
// the curated SEON ontology FIRST and uncapped (219 facts, provenance corpus:seon),
// THEN the capped ConceptNet band (SEED_LIMIT=500 requested → 499 appended; one
// ConceptNet fact overlaps a SEON fact and dedups on its content-hash id). So a
// fresh repo lands 219 + 499 = 718 starter facts, and the banner says so honestly.
const SEON_SEEDED = 219;
const CONCEPTNET_SEEDED = 499;
const SEEDED_FACTS = SEON_SEEDED + CONCEPTNET_SEEDED; // 718
const SEED_BANNER = `seeded ${SEEDED_FACTS} starter facts (${SEON_SEEDED} curated SEON + ${CONCEPTNET_SEEDED} ConceptNet) — /memory to inspect`;

const factCount = async (dir) =>
  (await loadMemory(dir)).individuals.filter((i) => i.class === FACT_CLASS).length;
const exists = (p) => access(p).then(() => true, () => false);

test("W3: a graph-less first run seeds once — banner line, marker, facts; a second session skips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w3-seed-"));
  try {
    clearCache();
    const s1 = await createSession({ repoPath: dir, env: {} });
    await s1.close();
    assert.ok(
      s1.bannerLines.some((l) => l === SEED_BANNER),
      `the banner says so honestly: ${JSON.stringify(s1.bannerLines)}`,
    );
    assert.equal(await factCount(dir), SEEDED_FACTS, "both corpus passes landed in .tmct/memory");
    assert.ok(await exists(join(dir, SEED_MARKER_REL)), "the seed marker was written");

    clearCache();
    const s2 = await createSession({ repoPath: dir, env: {} });
    await s2.close();
    assert.ok(!s2.bannerLines.some((l) => /seeded \d+ starter facts/.test(l)),
      "the marker prevents a re-seed — no seed line on the second run");
    assert.equal(await factCount(dir), SEEDED_FACTS, "fact count unchanged");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W3: TMCT_NO_SEED=1 opts out — no facts, no marker, no banner line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w3-noseed-"));
  try {
    clearCache();
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    await s.close();
    assert.ok(!s.bannerLines.some((l) => /seeded \d+ starter facts/.test(l)));
    assert.equal(await factCount(dir), 0);
    assert.equal(await exists(join(dir, SEED_MARKER_REL)), false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W3: a repo WITH a graph artifact never seeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w3-fixture-"));
  try {
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.close();
    assert.equal(s.empty, false);
    assert.ok(!s.bannerLines.some((l) => /seeded \d+ starter facts/.test(l)));
    assert.equal(await factCount(dir), 0);
    assert.equal(await exists(join(dir, SEED_MARKER_REL)), false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W3 gate: the real binary in an empty dir seeds, greets and exits 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w3-gate-"));
  try {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [BIN], { encoding: "utf8", input: "hi\n/exit\n", cwd: dir });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no code graph loaded — starting empty/); // #3
    assert.match(r.stdout, new RegExp(`seeded ${SEEDED_FACTS} starter facts \\(${SEON_SEEDED} curated SEON \\+ ${CONCEPTNET_SEEDED} ConceptNet\\)`));
    assert.match(r.stdout, /Hi\. There's no code graph loaded here/); // #3: empty greeting orients
    assert.equal(await factCount(dir), SEEDED_FACTS);
    assert.ok(elapsed < 15000, `seeded bootstrap stays inside a sane budget (took ${elapsed}ms)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
