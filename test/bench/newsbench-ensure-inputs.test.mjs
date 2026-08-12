// ensure-bench-inputs.mjs's own skip-when-fresh contract: a target that
// already exists and is newer than every one of its sources is left alone;
// a missing target, or a source that has moved since, triggers exactly one
// rebuild. Exercised against synthetic temp-dir artifacts rather than the
// four real ones, so the test never pays for an actual worlds-pack/ask-
// bundle/chat-seed build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isStaleArtifact, ensureArtifact } from "../../scripts/news-bench/ensure-bench-inputs.mjs";

function tempArtifact() {
  const root = mkdtempSync(join(tmpdir(), "newsbench-ensure-inputs-"));
  const sourceFile = join(root, "source.txt");
  const target = join(root, "built.txt");
  writeFileSync(sourceFile, "source v1");
  let buildCalls = 0;
  const artifact = {
    name: "synthetic",
    targets: [target],
    freshnessTarget: target,
    sources: [sourceFile],
    build: () => {
      buildCalls += 1;
      writeFileSync(target, `built from ${buildCalls}`);
    },
  };
  return {
    root, sourceFile, target, artifact, buildCallCount: () => buildCalls,
  };
}

test("a missing target is stale, and ensureArtifact builds it exactly once", () => {
  const { root, artifact, buildCallCount } = tempArtifact();
  try {
    assert.equal(isStaleArtifact(artifact), true);
    assert.equal(ensureArtifact(artifact), "built");
    assert.equal(buildCallCount(), 1);
    assert.equal(isStaleArtifact(artifact), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fresh target (built after its source) is skipped on the next call", () => {
  const { root, artifact, buildCallCount } = tempArtifact();
  try {
    ensureArtifact(artifact);
    assert.equal(buildCallCount(), 1);

    assert.equal(ensureArtifact(artifact), "up to date");
    assert.equal(ensureArtifact(artifact), "up to date");
    assert.equal(buildCallCount(), 1, "a fresh target must never trigger a second build");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a target older than its source goes stale and rebuilds exactly once more", () => {
  const { root, artifact, buildCallCount } = tempArtifact();
  try {
    ensureArtifact(artifact);
    assert.equal(buildCallCount(), 1);

    // Push the already-built target's own mtime into the past, the same
    // shape a real "the source changed after the artifact was last built"
    // takes without racing the test against real wall-clock granularity.
    const past = new Date(Date.now() - 10_000);
    utimesSync(artifact.freshnessTarget, past, past);
    assert.equal(isStaleArtifact(artifact), true);

    assert.equal(ensureArtifact(artifact), "built");
    assert.equal(buildCallCount(), 2);

    assert.equal(ensureArtifact(artifact), "up to date");
    assert.equal(buildCallCount(), 2, "the artifact must settle back to fresh after the one rebuild it needed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--from copies a target present in the from-root instead of building, and stamps it fresh", () => {
  const fromRoot = mkdtempSync(join(tmpdir(), "newsbench-ensure-inputs-from-"));
  const { root, artifact, buildCallCount } = tempArtifact();
  try {
    // copyFromRoot maps each target through relative(relativeToRoot, target)
    // onto the from-root — here relativeToRoot is the artifact's own temp
    // root, so the from-root needs "built.txt" directly under it, the same
    // relative path the target itself has.
    writeFileSync(join(fromRoot, "built.txt"), "already built elsewhere");

    const action = ensureArtifact(artifact, { from: fromRoot, relativeToRoot: root });
    assert.match(action, /^copied from /);
    assert.equal(buildCallCount(), 0, "a successful --from copy must never fall through to build()");
    assert.equal(isStaleArtifact(artifact), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(fromRoot, { recursive: true, force: true });
  }
});
