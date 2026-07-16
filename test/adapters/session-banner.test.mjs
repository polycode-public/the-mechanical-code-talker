// Banner wording pins. bannerLines is a createSession-handle surface corpus
// rows cannot read, so the banner's honesty contract lives here: every
// example a banner offers must be one the session's actual seed state can
// keep, and the unseeded/empty states must stay actionable, not apologetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../../src/chat.mjs";
import { clearCache } from "../../src/source.mjs";
import { freshBootstrapRepo } from "../helpers/seeded-fixture.mjs";

test("the seeded banner offers the corpus-verified 'what is a dog' example", async () => {
  clearCache();
  const dir = await freshBootstrapRepo("tmct-banner-");
  const s = await createSession({ repoPath: dir });
  try {
    assert.match(s.bannerLines.join("\n"), /what is a dog/, "seeded banner offers the term");
  } finally {
    await s.close();
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the unseeded banner offers the concrete, verified teach pair, never a seeded-only term or the abstract placeholder", async () => {
  clearCache();
  const dir = await mkdtemp(join(tmpdir(), "tmct-banner-"));
  const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
  try {
    const banner = s.bannerLines.join("\n");
    assert.doesNotMatch(banner, /what is a cache/, "unseeded banner never offers the seeded-only term");
    assert.doesNotMatch(banner, /what is a dog/, "nor the seeded vocabulary example");
    assert.doesNotMatch(banner, /teach me directly with "every X is a Y"/, "never the unverified abstract placeholder");
    assert.match(banner, /every bug is an issue/, "banner offers the concrete, verified teach pair");
  } finally {
    await s.close();
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an empty-graph unseeded banner orients toward --repo/tmct init and reports the empty start honestly", async () => {
  clearCache();
  const dir = await mkdtemp(join(tmpdir(), "tmct-banner-empty-"));
  try {
    const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
    assert.equal(s.moduleCount, 0);
    const banner = s.bannerLines.join("\n");
    assert.match(banner, /no code graph loaded — starting empty/);
    assert.match(banner, /tmct init|--repo/);
    assert.match(banner, /tmct init.*seed|seed.*starter vocabulary/i, "points at how to actually get the vocabulary");
    await s.close();
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
