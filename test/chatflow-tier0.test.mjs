// Bootstrap banner assertions: the session banner's vocabulary-example hint
// must offer only examples verified against the session's actual seed state.
// The corpus games lane replays the conversational turns (the offered
// examples resolving in-session); the BANNER itself is a createSession-handle
// surface (`bannerLines`) that corpus rows cannot read, so its wording is
// pinned here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";
import { freshBootstrapRepo } from "./helpers/seeded-fixture.mjs";

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

test("the unseeded banner offers the concrete, verified teach pair, never the seeded-only term or the abstract placeholder", async () => {
  clearCache();
  const dir = await mkdtemp(join(tmpdir(), "tmct-banner-"));
  const s = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
  try {
    const banner = s.bannerLines.join("\n");
    assert.doesNotMatch(banner, /what is a cache/, "unseeded banner never offers the seeded-only term");
    assert.doesNotMatch(banner, /teach me directly with "every X is a Y"/, "never the unverified abstract placeholder");
    assert.match(banner, /every bug is an issue/, "banner offers the concrete, verified teach pair");
  } finally {
    await s.close();
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
