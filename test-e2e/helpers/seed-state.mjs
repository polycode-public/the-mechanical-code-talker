// The starter memory's own load state, as chat.html and ingest.html publish it
// on window.tmct.seed.
//
// A page's boot promise (window.tmctChatReady, window.tmctIngestReady) says the
// page finished booting. It resolves whether or not the seed arrived, because a
// page whose seed failed still opens and can still be taught — that is the
// right product behaviour and the wrong thing for a test to wait on. A test
// that asserts on seeded content needs the seed's own state, and a test whose
// seed never loaded should say THAT rather than reporting the fact count of
// zero or the miss it causes several steps later.
import assert from "node:assert/strict";

// "ready" is the only one of these that means the session can answer from the
// seed. "failed" and "skipped" are settled too — they are just settled on
// nothing having been loaded.
const SETTLED = ["ready", "failed", "skipped"];

/**
 * The page's starter-memory record, once it has settled: `{ state, facts }`,
 * plus `error` when the load failed.
 *
 * The pages settle this inside boot, so a caller that has already awaited the
 * boot promise finds it settled. The short wait here exists so a page that
 * ever stopped doing that reports which phase it was stuck in.
 */
export async function waitForSeedState(page, { timeout = 5_000 } = {}) {
  await page.waitForFunction(
    (settled) => Boolean(window.tmct && window.tmct.seed && settled.includes(window.tmct.seed.state)),
    SETTLED,
    { timeout },
  );
  return page.evaluate(() => window.tmct.seed);
}

/** The same, and fail with the load's own reason if the seed is not in. */
export async function requireSeedLoaded(page, options) {
  const seed = await waitForSeedState(page, options);
  assert.equal(
    seed.state,
    "ready",
    `the starter memory never loaded, so nothing below can be asserted against it — state "${seed.state}"`
      + (seed.error ? `, reason: ${seed.error}` : ""),
  );
  return seed;
}
