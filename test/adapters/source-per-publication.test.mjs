// One Source per publication — the feed or the reference work — never per
// article and never per sentence. What this suite holds:
//
//   - a feed's item id and a reference work's article stay on the tag for audit
//     and out of the Source identity;
//   - an ingest run driving the chat teach lane as its recognizer files the
//     assertion under the publication, not under a chat session;
//   - two articles of one feed stating the same triple corroborate nothing,
//     while two different feeds stating it do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, loadMemory, readFactRows, SOURCE_CLASS } from "../../src/adapters/memory/core.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-pub-source-"));
const sourceIds = (memory) => memory.individuals.filter((i) => i?.class === SOURCE_CLASS).map((i) => i.id).sort();

// What the news ingest actually writes per grounded sentence: the recognizer's
// own tag, and the audit tag the ingest seam layers on top.
const recognizerTag = (feed) => `teach:chat:ingest#news:${feed}@2026-08-11T10:00:00.000Z`;
const auditTag = (feed, item) => `extracted:news:${feed}@${item}`;

test("a feed's item id rides the tag for audit and stays out of the Source identity", () => {
  const first = provenanceTagToSource("news:nyt-world@item-91");
  assert.deepEqual(first, { kind: "web", url: "news:nyt-world" });
  assert.deepEqual(provenanceTagToSource("news:nyt-world@item-92"), first);
  assert.deepEqual(provenanceTagToSource("extracted:news:nyt-world@item-92"), first);
  assert.deepEqual(provenanceTagToSource("optimistic-extract:news:nyt-world@item-92"),
    { kind: "optimisticExtract", name: "news:nyt-world" });
});

test("a reference work is one asserting party however many of its pages get read", () => {
  assert.deepEqual(provenanceTagToSource("reference:simplewiki:Otter@9184482"),
    { kind: "reference", pack: "simplewiki", article: "Otter@9184482" });
  assert.deepEqual(provenanceTagToSource("research:simple-wikipedia:otter"),
    { kind: "referenceLive", pack: "simple-wikipedia", article: "otter" });
  assert.deepEqual(provenanceTagToSource("research:simple-wikipedia:kestrel"),
    { kind: "referenceLive", pack: "simple-wikipedia", article: "kestrel" });
  // the research lane's own fan-out tag keeps its shape, depth dropped
  assert.deepEqual(provenanceTagToSource("research:golden gate bridge@1"),
    { kind: "referenceLive", pack: "research", article: "golden gate bridge" });
});

test("an ingest run borrowing the teach lane files its assertion under the publication, not a chat session", () => {
  assert.deepEqual(provenanceTagToSource(recognizerTag("nyt-world")),
    { kind: "web", url: "news:nyt-world", createdAt: "2026-08-11T10:00:00.000Z" });
  assert.deepEqual(provenanceTagToSource("teach:chat:ingest#research:wikidata:otter@2026-08-11T10:00:00.000Z"),
    { kind: "referenceLive", pack: "wikidata", article: "otter", createdAt: "2026-08-11T10:00:00.000Z" });
  // a person teaching in a session is untouched
  assert.deepEqual(provenanceTagToSource("teach:chat:sess-9@2026-08-11T10:00:00.000Z"),
    { kind: "teach", createdAt: "2026-08-11T10:00:00.000Z", sessionId: "sess-9" });
  // and a marked tag can only stand in for a publication, never for another actor
  assert.deepEqual(provenanceTagToSource("teach:chat:ingest#teach:chat:sess-9@2026-08-11T10:00:00.000Z"),
    { kind: "teach", createdAt: "2026-08-11T10:00:00.000Z", sessionId: "ingest#teach:chat:sess-9" });
});

test("two articles of one feed stating the same triple corroborate nothing; two feeds do", async () => {
  const dir = await tmpRepo();
  try {
    const fact = (feed, item) => appendFact(dir, {
      subject: "kestrel", predicate: "rdfs:subClassOf", object: "bird",
      provenance: `${recognizerTag(feed)} | ${auditTag(feed, item)}`,
    });
    await fact("nyt-world", "item-91");
    await fact("nyt-world", "item-92");

    let memory = await loadMemory(dir);
    assert.equal(sourceIds(memory).length, 1, "one feed is one Source across both of its articles");
    assert.equal(memory.individuals.filter((i) => i?.class === SOURCE_CLASS && i.id.startsWith("src:teach-chat:")).length, 0,
      "no throwaway chat session is minted for an ingest");
    let row = readFactRows(memory).find((r) => r.subject === "kestrel");
    assert.equal(row.sourceIds.length, 1, "a feed agreeing with itself is not corroboration");
    assert.equal(row.assertions.length, 1, "both articles resolve onto the feed's own single record");
    const alone = row.trust;

    await fact("bbc-world", "item-3");
    memory = await loadMemory(dir);
    assert.equal(sourceIds(memory).length, 2, "a second feed is a second asserting party");
    row = readFactRows(memory).find((r) => r.subject === "kestrel");
    assert.equal(row.sourceIds.length, 2);
    assert.ok(row.trust > alone, `two independent feeds agreeing raises trust (${alone} -> ${row.trust})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
