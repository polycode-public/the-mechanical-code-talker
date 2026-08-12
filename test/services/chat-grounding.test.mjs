// isGroundedTerm's code-graph branch: a term the static lexicon and prior-taught
// facts have never seen can still ground via a code-graph symbol resolveSymbol
// itself would match — the same resolver /describe, /members, and /subclasses
// already use, so "known to describe" and "known to teach" can never disagree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isGroundedTerm } from "../../src/services/chat.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";

const lex = loadLexicon();

const graph = {
  individuals: [
    { id: "cls-store", label: "Store", class: "Class", derived_from: [], mentions: [] },
  ],
};

test("isGroundedTerm grounds a term resolveSymbol matches in the supplied code graph", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-grounding-"));
  try {
    assert.equal(await isGroundedTerm("Store", lex, dir, null, graph), true);
    // Case-insensitive and fuzzy, exactly like resolveSymbol itself.
    assert.equal(await isGroundedTerm("store", lex, dir, null, graph), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isGroundedTerm does not ground a term the code graph has no symbol for", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-grounding-"));
  try {
    assert.equal(await isGroundedTerm("zorp", lex, dir, null, graph), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isGroundedTerm with graph: null (the default) behaves exactly as before — no graph consulted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-grounding-"));
  try {
    // "Store" is grounded ONLY via the code graph above — with no graph
    // supplied at all (today's default, and every pre-existing call site
    // before this fix), it must read as ungrounded, same as before this change.
    assert.equal(await isGroundedTerm("Store", lex, dir), false);
    assert.equal(await isGroundedTerm("Store", lex, dir, null, null), false);
    // A real static-lexicon word still grounds with no graph at all — the
    // graph branch is purely additive, never a replacement for the existing checks.
    assert.equal(await isGroundedTerm("dog", lex, dir), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isGroundedTerm never throws when graph is an empty/malformed stand-in", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-grounding-"));
  try {
    assert.equal(await isGroundedTerm("zorp", lex, dir, null, { individuals: [] }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isGroundedTerm still reports a corpus-only term as ungrounded — the anchor tier is isAnchoredTerm/isAnchorableTerm's territory, not this function's", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-grounding-"));
  try {
    await appendFacts(dir, [{ subject: "corpusonlyletter", predicate: "rdfs:subClassOf", object: "letter", provenance: "corpus:wordnet-xl /r/IsA" }]);
    assert.equal(await isGroundedTerm("corpusonlyletter", lex, dir), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
