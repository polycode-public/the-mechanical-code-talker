// The read-back caveat: an answer leaning on a row the extractor recorded a
// finding about says how that row was read, in the same words every time,
// right before the source citation.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createSession,
  renderUnionLine,
  renderEnumerationLine,
  renderUniversalRestrictionLine,
} from "../../src/services/chat.mjs";
import { appendFacts, openMemoryBackend } from "../../src/adapters/memory/core.mjs";

const CANONICAL_LINE_RE = /\n\nCanonical:[^\n]*$/;
const GOAL_LINE_RE = /\n\nGoal \(inferred\):[^\n]*$/;
const body = (turn) => String(turn?.answer ?? "").replace(CANONICAL_LINE_RE, "").replace(GOAL_LINE_RE, "");

/** Drive one session over a store preloaded with `facts` (the extractor's own
 *  write shape, findings included) and return the asked turns. */
async function driveSession({ facts = [], teach = [], asks = [] }) {
  const dir = await mkdtemp(path.join(tmpdir(), "tmct-caveat-"));
  if (facts.length) {
    const backend = await openMemoryBackend(dir, "");
    try {
      await appendFacts(backend.dir, facts);
    } finally {
      await backend.close();
    }
  }
  const session = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" } });
  try {
    for (const line of teach) await session.turn(line);
    const out = [];
    for (const ask of asks) out.push(await session.turn(ask));
    return out;
  } finally {
    await session.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("a carried-subject row reads back with its caveat between the fact and the citation", async () => {
  const [turn] = await driveSession({
    facts: [{
      subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
      provenance: "extracted:biology.md", extraction: ["pronoun-carry"],
    }],
    asks: ["what is a cell"],
  });
  assert.equal(
    body(turn),
    "i learned: cell is a kind of unit (subject carried from the previous sentence) (source: extracted:biology.md)",
  );
});

test("a clause-fallback row and an identifier-token row each read with their own caveat", async () => {
  const [fragment, identifier] = await driveSession({
    facts: [
      {
        subject: "beacon", predicate: "rdfs:subClassOf", object: "tower",
        provenance: "extracted:coastline.md", extraction: ["clause-fallback"],
      },
      {
        subject: "normalizefeeditems", predicate: "mgx:usedFor", object: "feed items",
        provenance: "optimistic-extract:reader.md", extraction: ["identifier-token"],
      },
    ],
    asks: ["what is a beacon", "what is normalizefeeditems used for"],
  });
  assert.equal(
    body(fragment),
    "i learned: beacon is a kind of tower (read from a clause fragment) (source: extracted:coastline.md)",
  );
  assert.equal(
    body(identifier),
    "i learned: normalizefeeditems is used for feed items (identifier token) (source: optimistic-extract:reader.md)",
  );
});

test("a reported-speech row reads back with its caveat between the fact and the citation", async () => {
  const [turn] = await driveSession({
    facts: [{
      subject: "sighting", predicate: "rdfs:subClassOf", object: "report",
      provenance: "extracted:nyt-world.md", extraction: ["reported-speech"],
    }],
    asks: ["what is a sighting"],
  });
  assert.equal(
    body(turn),
    "i learned: sighting is a kind of report (read from reported speech) (source: extracted:nyt-world.md)",
  );
});

test("a row carrying two findings reads both, once each, in the caveat table's own order", async () => {
  const [turn] = await driveSession({
    facts: [{
      subject: "flushcache", predicate: "rdfs:subClassOf", object: "routine",
      provenance: "extracted:reader.md", extraction: ["identifier-token", "pronoun-carry"],
    }],
    asks: ["what is flushcache"],
  });
  assert.equal(
    body(turn),
    "i learned: flushcache is a kind of routine (subject carried from the previous sentence) (identifier token) (source: extracted:reader.md)",
  );
});

test("a row the extractor recorded nothing about reads back with its citation alone", async () => {
  const [turn] = await driveSession({
    facts: [{
      subject: "kestrel", predicate: "rdfs:subClassOf", object: "bird",
      provenance: "extracted:coastline.md",
    }],
    asks: ["what is a kestrel"],
  });
  assert.equal(body(turn), "i learned: kestrel is a kind of bird (source: extracted:coastline.md)");
});

test("the superclass chain stays on the fact, ahead of the caveat and the citation", async () => {
  const [turn] = await driveSession({
    facts: [{
      subject: "rover", predicate: "rdfs:subClassOf", object: "dog",
      provenance: "extracted:pets.md", extraction: ["pronoun-carry"],
    }],
    teach: ["a dog is a canine"],
    asks: ["what is rover"],
  });
  assert.equal(
    body(turn),
    "i learned: rover is a kind of dog → canine (subject carried from the previous sentence) (source: extracted:pets.md)",
  );
});

test("a proof chain cites each premise with that premise's own caveat", async () => {
  const [turn] = await driveSession({
    facts: [{
      subject: "rover", predicate: "rdfs:subClassOf", object: "dog",
      provenance: "extracted:pets.md", extraction: ["pronoun-carry"],
    }],
    teach: ["a dog is a canine"],
    asks: ["is rover a canine"],
  });
  const text = body(turn);
  assert.match(
    text,
    /^yes — rover is a kind of dog \(subject carried from the previous sentence\) \(source: extracted:pets\.md\); dog is a kind of canine \(source: /,
  );
  assert.match(text, /; so rover is a canine$/);
  // The taught premise carries no finding, so it gets no caveat of its own.
  assert.equal(text.match(/subject carried from the previous sentence/g).length, 1);
});

test("a union line declares a finding recorded on any row it composed", () => {
  const node = { subject: "pet", predicate: "rdfs:subClassOf", object: "u1", provenance: "extracted:pets.md" };
  const members = [
    { subject: "u1", predicate: "owl:unionOf", object: "cat", provenance: "extracted:pets.md" },
    { subject: "u1", predicate: "owl:unionOf", object: "dog", provenance: "extracted:pets.md", extraction: ["clause-fallback"] },
  ];
  assert.equal(
    renderUnionLine(node, members),
    "every pet is a cat or a dog (read from a clause fragment) (source: extracted:pets.md)",
  );
  const clean = members.map(({ extraction, ...rest }) => rest);
  assert.equal(renderUnionLine(node, clean), "every pet is a cat or a dog (source: extracted:pets.md)");
});

test("an enumeration line declares a finding recorded on any member it lists", () => {
  const members = [
    { subject: "primary colour", predicate: "owl:oneOf", object: "blue", provenance: "extracted:art.md", extraction: ["pronoun-carry"] },
    { subject: "primary colour", predicate: "owl:oneOf", object: "red", provenance: "extracted:art.md" },
  ];
  assert.equal(
    renderEnumerationLine("primary colour", members),
    "the primary colours are exactly blue and red (subject carried from the previous sentence) (source: extracted:art.md)",
  );
  const clean = members.map(({ extraction, ...rest }) => rest);
  assert.equal(
    renderEnumerationLine("primary colour", clean),
    "the primary colours are exactly blue and red (source: extracted:art.md)",
  );
});

test("an only-line declares a finding recorded on the restriction it read", () => {
  const node = { subject: "heart", predicate: "rdfs:subClassOf", object: "r1", provenance: "extracted:anatomy.md", extraction: ["identifier-token"] };
  const rows = [
    { subject: "r1", predicate: "owl:onProperty", object: "contains", provenance: "extracted:anatomy.md" },
    { subject: "r1", predicate: "owl:allValuesFrom", object: "valve", provenance: "extracted:anatomy.md" },
  ];
  assert.equal(
    renderUniversalRestrictionLine(node, rows),
    "every heart contains only valves (identifier token) (source: extracted:anatomy.md)",
  );
  const { extraction, ...cleanNode } = node;
  assert.equal(
    renderUniversalRestrictionLine(cleanNode, rows),
    "every heart contains only valves (source: extracted:anatomy.md)",
  );
});
