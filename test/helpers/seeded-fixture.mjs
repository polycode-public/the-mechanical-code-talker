// test/helpers/seeded-fixture.mjs — a shared, once-per-process seeded-repo
// builder for tests that need "a freshly seeded repo" purely as CONSUMERS of
// its content (e.g. to ask vocabulary questions against, or to run syllogise
// over) — NOT for tests of the seeding MECHANISM itself (banner arithmetic,
// the marker's idempotency contract, initRepo's/createSession's returned
// seed metadata). Those still call the real seedMemory/createSession/initRepo
// directly, because the seed happening (and its exact return shape) IS the
// behavior under test there — see each call site's own comment for why it
// isn't converted to use this helper.
//
// The expensive part is the corpus parse+write (~2.4s: a multi-MB slice
// tokenized and written fact-by-fact); the RESULT is deterministic and
// content-addressed (same fact ids every time), so it's safe to build once
// per test process and hand every caller its own fresh COPY (fs.cp,
// recursive) in a new tmpdir — each test still gets full isolation (no
// cross-test pollution), only the parse+write step is shared/memoized.
import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, SEED_LIMIT, SEED_PREFER } from "../../src/services/chat.mjs";
import { seedMemory } from "../../src/adapters/corpus/conceptnet.mjs";

let bootstrapSrcPromise = null;
let conceptNetSrcPromise = null;

async function buildBootstrapSrc() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-fixture-bootstrap-src-"));
  // The exact path a fresh empty repo takes (chat.mjs's seedBootstrapMemory,
  // via the real createSession entry point): SEON + the whole ConceptNet band.
  const session = await createSession({ repoPath: dir, env: {} });
  await session.close();
  return dir;
}

async function buildConceptNetSrc() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-fixture-conceptnet-src-"));
  // The direct single-pass seed (ConceptNet band alone, no SEON pass, no
  // bootstrap marker) — what wiring-facts.test.mjs / syllogise.test.mjs call.
  const seedResult = await seedMemory(dir, { limit: SEED_LIMIT, prefer: SEED_PREFER });
  return { dir, seedResult };
}

/** A fresh, isolated copy of a repo that's already been through chat.mjs's
 *  FULL two-pass W3 bootstrap seed (SEON + ConceptNet), built once per test
 *  process. For tests that just need a seeded repo to drive turns/sessions
 *  against — never for a test asserting that the seed happened DURING that
 *  test's own createSession call (the copy already has the graph + marker in
 *  place, so createSession's own seed step is a no-op on it, same as any
 *  already-seeded repo). */
export async function freshBootstrapRepo(prefix = "tmct-fixture-bootstrap-") {
  if (!bootstrapSrcPromise) bootstrapSrcPromise = buildBootstrapSrc();
  const src = await bootstrapSrcPromise;
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await cp(src, dir, { recursive: true });
  return dir;
}

/** A fresh, isolated copy of a repo seeded via a single direct
 *  seedMemory(dir, { limit: SEED_LIMIT, prefer: SEED_PREFER }) call, built
 *  once per test process. Returns { dir, seedResult } — seedResult is the
 *  ONE real build's { appended, skipped } (identical on every copy: the
 *  corpus is deterministic and facts are content-addressed), so a caller
 *  that asserts on the seed's shape (e.g. "the whole band seeds uncapped")
 *  can do so without re-running the parse+write pass itself. */
export async function freshConceptNetRepo(prefix = "tmct-fixture-conceptnet-") {
  if (!conceptNetSrcPromise) conceptNetSrcPromise = buildConceptNetSrc();
  const { dir: src, seedResult } = await conceptNetSrcPromise;
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await cp(src, dir, { recursive: true });
  return { dir, seedResult };
}
