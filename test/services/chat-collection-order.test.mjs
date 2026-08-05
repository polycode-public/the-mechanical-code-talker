// answerCollectionContents and the containment reader must render a
// collection's members in one deterministic order regardless of which order
// they were taught in — two independent stores holding the same members
// taught in reverse order must render the SAME member order, a pure function
// of the fact set rather than the arrival sequence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driveSessionTurns } from "../helpers/session.mjs";

const CITATION_RE = /\s*\(source:[^)]*\)/g;
const stripCitations = (text) => String(text ?? "").replace(CITATION_RE, "");

test("a collection's contents render in the same order whichever order its members were taught", async () => {
  const dirA = await mkdtemp(join(tmpdir(), "tmct-collection-order-"));
  const dirB = await mkdtemp(join(tmpdir(), "tmct-collection-order-"));
  try {
    const declare = "a bin is a collection of parts";
    const ask = "what is in the bin";
    const forward = await driveSessionTurns(
      { repoPath: dirA, env: { TMCT_NO_SEED: "1" } },
      [declare, "alpha is in the bin", "beta is in the bin", "gamma is in the bin", ask],
    );
    const reversed = await driveSessionTurns(
      { repoPath: dirB, env: { TMCT_NO_SEED: "1" } },
      [declare, "gamma is in the bin", "beta is in the bin", "alpha is in the bin", ask],
    );
    const forwardAnswer = stripCitations(forward.at(-1).answer);
    const reversedAnswer = stripCitations(reversed.at(-1).answer);
    assert.equal(forwardAnswer, reversedAnswer);
    assert.match(forwardAnswer, /alpha is a member of bin/);
    assert.match(forwardAnswer, /beta is a member of bin/);
    assert.match(forwardAnswer, /gamma is a member of bin/);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
