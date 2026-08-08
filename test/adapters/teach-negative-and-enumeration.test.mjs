// The teach lane's widened individual-negative path (the lexicon gate on
// "X is not a Y" no longer blocks an out-of-lexicon object once the subject
// reads as an individual and the object is a class the store already
// carries), its adjective guard, the retraction/bare-negative split it sits
// beside, and the four owl:unionOf/owl:complementOf/owl:oneOf/owl:differentFrom
// read-back phrasings the same round adds to FACT_PREDICATE_PHRASES.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn, renderUnionLine, renderEnumerationLine } from "../../src/services/chat.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-teach-negative-"));
}

test("a subject that resolves as an individual mints the negative directly, with no lexicon entry for the object", async () => {
  const dir = await tmpRepo();
  try {
    // "gremlin" carries no lexicon entry at all; it only becomes a class the
    // store knows through the taught disjointness below, never through the
    // curated noun dictionary — the exact gate this round removes.
    await runTurn("no dog is a gremlin", { memoryDir: dir, sessionId: "widened" });
    // "rex" becomes a term the store already knows as an rdf:type subject.
    await runTurn("rex is a dog", { memoryDir: dir, sessionId: "widened" });
    const { answer, record } = await runTurn("rex is not a gremlin", { memoryDir: dir, sessionId: "widened" });
    assert.match(answer, /rex is not a gremlin/);
    assert.equal(record.miss, false);

    const asked = await runTurn("is rex a gremlin", { memoryDir: dir, sessionId: "widened" });
    assert.match(asked.answer, /^no —/);
    assert.match(asked.answer, /rex is not a gremlin/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the adjective guard still declines — a property claim never mints a class exclusion", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("zeus is a god", { memoryDir: dir, sessionId: "adjective-guard" });
    // "mortal" is declared nowhere — not a lexicon noun, and nothing taught
    // ever makes it a stored class — so the widened arm must not fire either.
    await runTurn("zeus is not mortal", { memoryDir: dir, sessionId: "adjective-guard" });

    const asked = await runTurn("is zeus mortal", { memoryDir: dir, sessionId: "adjective-guard" });
    // No owl:disjointWith(zeus, mortal) was stored, so the question stays an
    // honest miss rather than a confirmed "no".
    assert.doesNotMatch(asked.answer, /^no —/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("'forget that X is a Y' still retracts the stored positive", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("rex is a pet", { memoryDir: dir, sessionId: "retract" });
    const forgotten = await runTurn("forget that rex is a pet", { memoryDir: dir, sessionId: "retract" });
    assert.match(forgotten.answer, /forgotten/);

    const asked = await runTurn("is rex a pet", { memoryDir: dir, sessionId: "retract" });
    assert.doesNotMatch(asked.answer, /^yes —/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the bare negative never retracts — both polarities stay stored and the disagreement is reported", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("rex is a cat", { memoryDir: dir, sessionId: "bare-negative" });
    const negated = await runTurn("rex is not a cat", { memoryDir: dir, sessionId: "bare-negative" });
    assert.match(negated.answer, /you told me earlier that rex is a cat/);

    const asked = await runTurn("is rex a cat", { memoryDir: dir, sessionId: "bare-negative" });
    assert.match(asked.answer, /rex is a cat/);
    assert.match(asked.answer, /rex is not a kind of cat/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("owl:unionOf reads back as 'is either'", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every pet is a cat or a dog", { memoryDir: dir, sessionId: "union-phrase" });
    const { answer } = await runTurn("what do you know about cat-or-dog", { memoryDir: dir, sessionId: "union-phrase" });
    assert.match(answer, /cat-or-dog is either cat/);
    assert.match(answer, /cat-or-dog is either dog/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("owl:complementOf reads back as 'is anything that is not'", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("everything that is not aquatic is terrestrial", { memoryDir: dir, sessionId: "complement-phrase" });
    const { answer } = await runTurn("what do you know about not-aquatic", { memoryDir: dir, sessionId: "complement-phrase" });
    assert.match(answer, /not-aquatic is anything that is not aquatic/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("owl:oneOf reads back as 'includes exactly'", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("the metals are exactly copper, iron and tin", { memoryDir: dir, sessionId: "oneof-phrase" });
    const { answer } = await runTurn("what do you know about metal", { memoryDir: dir, sessionId: "oneof-phrase" });
    assert.match(answer, /metal includes exactly copper/);
    assert.match(answer, /metal includes exactly iron/);
    assert.match(answer, /metal includes exactly tin/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("owl:differentFrom reads back as 'is not the same as'", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("GitHub is not GitLab", { memoryDir: dir, sessionId: "different-from-phrase" });
    const { answer } = await runTurn("what do you know about GitHub", { memoryDir: dir, sessionId: "different-from-phrase" });
    assert.match(answer, /github is not the same as gitlab/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("owl:TransitiveProperty never renders as a plain fact line in the describe lane", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("containing is transitive", { memoryDir: dir, sessionId: "transitive-suppressed" });
    const { answer } = await runTurn("what do you know about contains", { memoryDir: dir, sessionId: "transitive-suppressed" });
    assert.doesNotMatch(answer, /transitiveproperty/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renderUnionLine composes one sentence from the parent row and the sorted member rows", () => {
  const line = renderUnionLine(
    { subject: "pet", predicate: "rdfs:subClassOf", object: "cat-or-dog", provenance: "ace:chat:s1@2026-01-01T00:00:00.000Z" },
    [
      { subject: "cat-or-dog", predicate: "owl:unionOf", object: "dog" },
      { subject: "cat-or-dog", predicate: "owl:unionOf", object: "cat" },
    ],
  );
  assert.equal(line, "every pet is a cat or a dog (source: ace:chat:s1@2026-01-01T00:00:00.000Z)");
});

test("renderEnumerationLine composes one sentence from the class term and the sorted member rows", () => {
  const line = renderEnumerationLine(
    "primary-colour",
    [
      { subject: "primary-colour", predicate: "owl:oneOf", object: "yellow", provenance: "ace:chat:s1@2026-01-01T00:00:00.000Z" },
      { subject: "primary-colour", predicate: "owl:oneOf", object: "red", provenance: "ace:chat:s1@2026-01-01T00:00:00.000Z" },
      { subject: "primary-colour", predicate: "owl:oneOf", object: "blue", provenance: "ace:chat:s1@2026-01-01T00:00:00.000Z" },
    ],
  );
  assert.equal(line, "the primary colours are exactly blue, red and yellow (source: ace:chat:s1@2026-01-01T00:00:00.000Z)");
});
