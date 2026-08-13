// First-run memory seeding:
//
//   - a graph-less first run seeds corpus facts into .tmct/memory, says so
//     honestly in the banner, and writes the marker;
//   - the marker prevents a re-seed (second session: no seed line, same facts);
//   - TMCT_NO_SEED=1 opts out entirely;
//   - a fixture-graph repo never seeds;
//   - the real binary in an empty dir still greets and exits 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, SEED_MARKER_REL } from "../src/services/chat.mjs";
import { loadMemory, openMemoryBackend, FACT_CLASS } from "../src/adapters/memory/core.mjs";
import { clearCache } from "../src/adapters/source.mjs";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const FIXTURE = fileURLToPath(new URL("../test/fixtures/entities.fixture.json", import.meta.url));

// The graph-less bootstrap seeds every ACTIVE bundle (chat.mjs seedBootstrapMemory,
// via src/services/extensions.mjs's resolveExtensions + seedActiveCorpusEntries), in the
// entries' own fixed order (seon, conceptnet, then the rest sorted by name).
// The default active bundle is `human` (seon/conceptnet ship but are opt-in);
// the banner lists every bundle that appended facts, so these tests assert the
// bootstrap's SHAPE against a generic "(N1 bundle1 + N2 bundle2 + …)" banner,
// not a hardcoded bundle-name literal.
const SEED_BANNER_RE = /^seeded (\d+) starter facts \((.+)\) — \/memory to inspect$/;

/** Read a repo's memory back through the DEFAULT-routed backend (sqlite) —
 *  the store the bootstrap seed actually writes. */
const readRoutedMemory = async (dir) => {
  const { dir: handle, close } = await openMemoryBackend(dir, "");
  try { return await loadMemory(handle); } finally { await close(); }
};
const factCount = async (dir) =>
  (await readRoutedMemory(dir)).individuals.filter((i) => i.class === FACT_CLASS).length;
const exists = (p) => access(p).then(() => true, () => false);

/** Find the banner's seed line and return { total, clauses, byBundle } — or null.
 *  `clauses` is the ordered ["N1 bundle1", "N2 bundle2", …] list; `byBundle` is
 *  the same thing keyed by bundle name -> its appended count, for easy lookup. */
const parseSeedBanner = (line) => {
  const m = SEED_BANNER_RE.exec(String(line));
  if (!m) return null;
  const clauses = m[2].split(" + ");
  const byBundle = {};
  for (const c of clauses) {
    const cm = /^(\d+) (.+)$/.exec(c);
    if (cm) byBundle[cm[2]] = Number(cm[1]);
  }
  return { total: Number(m[1]), clauses, byBundle };
};

test("a graph-less first run seeds once — banner line, marker, facts; a second session skips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-seed-first-run-"));
  try {
    clearCache();
    const s1 = await createSession({ repoPath: dir, env: {} });
    await s1.close();
    const banner = s1.bannerLines.map(parseSeedBanner).find(Boolean);
    assert.ok(banner, `the banner reports the seed honestly: ${JSON.stringify(s1.bannerLines)}`);
    const sumOfClauses = Object.values(banner.byBundle).reduce((a, b) => a + b, 0);
    assert.equal(banner.total, sumOfClauses, "banner arithmetic is internally consistent");
    assert.ok(banner.byBundle.human > 0, "the default human bundle landed");
    assert.equal(Object.keys(banner.byBundle).length, 1, "only the one default bundle seeded (seon/conceptnet are opt-in)");
    assert.equal(await factCount(dir), banner.total, "the corpus pass landed in .tmct/memory");
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

test("TMCT_NO_SEED=1 opts out of seeding — no facts, no marker, no banner line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-seed-noseed-"));
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

test("a repo WITH a graph artifact never seeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-seed-fixture-"));
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

test("a tmct.toml activating tier2-general seeds a second bundle alongside the default human bundle — banner grows an extra clause, base sentence unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-seed-tier2-"));
  try {
    await writeFile(join(dir, "tmct.toml"), '[extensions.tier2-general]\nactive = true\n');
    clearCache();
    const s = await createSession({ repoPath: dir, env: {} });
    await s.close();
    const line = s.bannerLines.find((l) => /^seeded \d+ starter facts/.test(l));
    assert.ok(line, `a seed banner line is present: ${JSON.stringify(s.bannerLines)}`);
    const banner = parseSeedBanner(line);
    assert.ok(banner, `banner parses generically: ${line}`);
    assert.ok(banner.byBundle.human > 0 && banner.byBundle["tier2-general"] > 0, `both bundles present: ${line}`);
    const sumOfClauses = Object.values(banner.byBundle).reduce((a, b) => a + b, 0);
    assert.equal(banner.total, sumOfClauses, "banner arithmetic includes both bundles");
    const mem = await readRoutedMemory(dir);
    const facts = (mem.individuals || []).filter((i) => i.class === "Fact");
    const generalFact = facts.find((f) => (f.attributes || []).some((a) => a.key === "provenance" && String(a.value).includes("corpus:tier2-general")));
    assert.ok(generalFact, "a tier2-general-provenance fact landed in memory");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the real binary in an empty dir seeds memory, greets and exits 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-seed-gate-"));
  try {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [BIN], { encoding: "utf8", input: "hi\n/exit\n", cwd: dir });
    const elapsed = Date.now() - t0;
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /code graph|code index/, "a bare install never hints at the code domain");
    const banner = r.stdout.split("\n").map(parseSeedBanner).find(Boolean);
    assert.ok(banner, `the seed banner is present: ${JSON.stringify(r.stdout)}`);
    const sumOfClauses = Object.values(banner.byBundle).reduce((a, b) => a + b, 0);
    assert.equal(banner.total, sumOfClauses, "banner arithmetic consistent");
    assert.ok(banner.byBundle.human > 0, `the default human bundle seeded (got ${JSON.stringify(banner.byBundle)})`);
    // The empty greeting orients — leads with identity + the (now seed-confirmed)
    // vocabulary example, not an apology; this run DID seed, so the hint is the
    // term-specific one (see the TMCT_NO_SEED sibling test for the other branch).
    assert.match(r.stdout, /Hi\. I'm tmct\. Try "what is a dog"/);
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
