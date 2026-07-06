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
import { createSession, SEED_MARKER_REL } from "../src/chat.mjs";
import { loadMemory, FACT_CLASS } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

// The graph-less bootstrap seeds in TWO passes (chat.mjs seedBootstrapMemory): the
// curated SEON ontology FIRST and uncapped (provenance corpus:seon), THEN the WHOLE
// ConceptNet band — the 0.7.0 "seed all" (the old SEED_LIMIT=500 cap was lifted; a
// handful of ConceptNet facts overlap SEON facts and dedup on their content-hash id).
// The exact counts are CORPUS-DATA-DRIVEN — they move whenever the committed slice is
// regrown — so these tests assert the bootstrap's SHAPE, not brittle literals: the
// banner's three numbers are internally consistent, they equal the on-disk fact count,
// and the ConceptNet band is genuinely UNCAPPED (thousands, not a small cap).
const SEED_BANNER_RE = /^seeded (\d+) starter facts \((\d+) curated SEON \+ (\d+) ConceptNet\) — \/memory to inspect$/;
const UNCAPPED_MIN = 1000; // proof the cap is lifted: far above any old finite cap

const factCount = async (dir) =>
  (await loadMemory(dir)).individuals.filter((i) => i.class === FACT_CLASS).length;
const exists = (p) => access(p).then(() => true, () => false);

/** Find the banner's seed line and return { total, seon, conceptnet } — or null. */
const parseSeedBanner = (line) => {
  const m = SEED_BANNER_RE.exec(String(line));
  return m ? { total: Number(m[1]), seon: Number(m[2]), conceptnet: Number(m[3]) } : null;
};

test("W3: a graph-less first run seeds once — banner line, marker, facts; a second session skips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w3-seed-"));
  try {
    clearCache();
    const s1 = await createSession({ repoPath: dir, env: {} });
    await s1.close();
    const banner = s1.bannerLines.map(parseSeedBanner).find(Boolean);
    assert.ok(banner, `the banner reports the seed honestly: ${JSON.stringify(s1.bannerLines)}`);
    assert.equal(banner.total, banner.seon + banner.conceptnet, "banner arithmetic is internally consistent");
    assert.ok(banner.seon > 0, "the curated SEON pass landed");
    assert.ok(banner.conceptnet > UNCAPPED_MIN, `the ConceptNet band is uncapped (got ${banner.conceptnet})`);
    assert.equal(await factCount(dir), banner.total, "both corpus passes landed in .tmct/memory");
    assert.ok(await exists(join(dir, SEED_MARKER_REL)), "the seed marker was written");

    clearCache();
    const s2 = await createSession({ repoPath: dir, env: {} });
    await s2.close();
    assert.ok(!s2.bannerLines.some((l) => /seeded \d+ starter facts/.test(l)),
      "the marker prevents a re-seed — no seed line on the second run");
    assert.equal(await factCount(dir), banner.total, "fact count unchanged");
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
    const banner = r.stdout.split("\n").map(parseSeedBanner).find(Boolean);
    assert.ok(banner, `the seed banner is present: ${JSON.stringify(r.stdout)}`);
    assert.equal(banner.total, banner.seon + banner.conceptnet, "banner arithmetic consistent");
    assert.ok(banner.conceptnet > UNCAPPED_MIN, `ConceptNet band uncapped (got ${banner.conceptnet})`);
    assert.match(r.stdout, /Hi\. There's no code graph loaded here/); // #3: empty greeting orients
    assert.equal(await factCount(dir), banner.total);
    // Load-tolerant budget: this project MANDATES concurrent background agents,
    // so an absolute wall-clock cap false-fails a healthy seed under contention
    // (observed >20s under a heavy agent fleet). The guard exists to catch a
    // regression to the pre-batch unbatched path (~419s → 2.5s); 90s catches that
    // 100× regression while tolerating fleet load.
    assert.ok(elapsed < 90000, `seeded bootstrap stays inside a sane budget (took ${elapsed}ms)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
