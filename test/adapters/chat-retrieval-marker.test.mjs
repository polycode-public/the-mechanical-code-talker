// The corpus-scope line: which answers carry it, what it says, and the lane
// inventory that stops a listing lane from claiming completeness in silence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createSession } from "../../src/services/chat.mjs";
import { appendFacts, openMemoryBackend } from "../../src/adapters/memory/core.mjs";
import {
  ENUMERATION_LANES,
  CORPUS_SCOPE_LINE,
  CORPUS_SCOPE_BOUNDED_LINE,
  CORPUS_SUPPLEMENT_ABSENT_LINE,
  answerAssertsASet,
  isEnumerationLane,
  retrievalContextOf,
  retrievalMarkerLine,
} from "../../src/domain/retrieval-marker.mjs";
import { SUPPLEMENTED_MODE, SEED_SESSION_MODE } from "../../src/domain/retrieval-modes.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAT_SOURCE = readFileSync(path.join(REPO_ROOT, "src", "services", "chat.mjs"), "utf8");

const BANDS = ["wordnet-complete"];
const supplemented = (bounded) => ({ mode: SUPPLEMENTED_MODE, bounded, bands: BANDS });
const breakerOpen = () => ({ mode: SEED_SESSION_MODE, bounded: false, bands: BANDS });

/** Every enumeration lane, with a conversation that reaches it. The inventory
 *  test below holds this table against the registry both ways, so a lane added
 *  to one and not the other fails. */
const LANE_PROBES = [
  {
    lane: ENUMERATION_LANES.MEMORY_COUNT,
    teach: ["a dog is an animal"],
    ask: "how many facts do you know",
  },
  {
    lane: ENUMERATION_LANES.MEMORY_CLASS,
    teach: ["a dog is an animal", "a cat is an animal"],
    ask: "list facts",
  },
  {
    lane: ENUMERATION_LANES.LETTER_WORDS,
    teach: ["a dog is an animal", "a parrot is an animal"],
    ask: "show me words with the letter p in it",
  },
  {
    lane: ENUMERATION_LANES.COLLECTION_CONTENTS,
    teach: ["alphabet is a collection of letters", "p is in the alphabet", "q is in the alphabet"],
    ask: "list letters in the alphabet",
  },
  {
    lane: ENUMERATION_LANES.TAUGHT_CLASS_COUNT,
    teach: ["a dog is an animal", "a cat is an animal"],
    ask: "how many animals are there",
  },
  {
    lane: ENUMERATION_LANES.MEMBERSHIP_LIST,
    teach: ["a dog is an animal", "a cat is an animal"],
    ask: "list the animals",
  },
  {
    lane: ENUMERATION_LANES.MEMBERSHIP_EXAMPLE,
    teach: ["a dog is an animal", "a cat is an animal"],
    ask: "name an animal",
  },
  {
    lane: ENUMERATION_LANES.SKOS_NEIGHBOURHOOD,
    // The SKOS view reads corpus-import predicates the chat surface has no
    // teach phrasing for, so these go straight into the store.
    facts: [
      { subject: "cat", predicate: "mgx:synonym", object: "feline", provenance: "corpus:conceptnet /r/Synonym" },
      { subject: "cat", predicate: "mgx:relatedTo", object: "kitten", provenance: "corpus:conceptnet /r/RelatedTo" },
    ],
    ask: "another word for cat",
  },
  {
    lane: ENUMERATION_LANES.WHAT_ELSE,
    teach: ["a dog is an animal", "a dog can bark", "a dog has fur"],
    ask: "what else about a dog",
  },
  {
    lane: ENUMERATION_LANES.FACT_SET,
    teach: ["a dog can bark", "a parrot can talk"],
    ask: "which animals can bark",
  },
  {
    lane: ENUMERATION_LANES.FACT_READBACK,
    teach: ["a dog is an animal", "a dog can bark", "a dog has fur"],
    ask: "what did i tell you about dogs",
  },
];

/** Point answers: one fact, one claim, no set. None of them may grow a scope
 *  line while the supplement is running. */
const POINT_PROBES = [
  { teach: ["a dog can bark"], ask: "can a dog bark" },
  { teach: ["a dog is an animal"], ask: "is a dog an animal" },
  { teach: ["a dog has fur"], ask: "does a dog have fur" },
];

async function driveSession({ teach = [], facts = [], asks, retrieval }) {
  const dir = await mkdtemp(path.join(tmpdir(), "tmct-scope-"));
  if (facts.length) {
    const backend = await openMemoryBackend(dir, "");
    try {
      await appendFacts(backend.dir, facts);
    } finally {
      await backend.close();
    }
  }
  const session = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, retrieval });
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

const ask = async (probe, retrieval) => {
  const [turn] = await driveSession({ teach: probe.teach, facts: probe.facts, asks: [probe.ask], retrieval });
  return turn;
};

test("the three scope lines are the only wording this marker has", () => {
  assert.equal(CORPUS_SCOPE_LINE, "Corpus scope: the rows this query pulled from the corpus.");
  assert.equal(CORPUS_SCOPE_BOUNDED_LINE, "Corpus scope: the rows this query pulled from the corpus. The corpus may hold more.");
  assert.equal(CORPUS_SUPPLEMENT_ABSENT_LINE, "Corpus scope: none. Answered without the corpus supplement.");
});

test("a turn with no retrieval context gets no line at all", () => {
  assert.equal(retrievalMarkerLine(null, { enumerationLane: ENUMERATION_LANES.MEMBERSHIP_LIST }), null);
  assert.equal(retrievalMarkerLine(undefined, { enumerationLane: ENUMERATION_LANES.MEMBERSHIP_LIST }), null);
});

test("a context without a recognised mode cannot mint a line", () => {
  assert.equal(retrievalContextOf({ mode: "whatever", bounded: true, bands: BANDS }), null);
  assert.equal(retrievalMarkerLine({ mode: "whatever", bounded: true, bands: BANDS }, { enumerationLane: ENUMERATION_LANES.FACT_SET }), null);
});

test("seed-session with no bands configured says nothing", () => {
  assert.equal(retrievalMarkerLine({ mode: SEED_SESSION_MODE, bands: [] }, { enumerationLane: ENUMERATION_LANES.FACT_SET }), null);
  assert.equal(retrievalMarkerLine({ mode: SEED_SESSION_MODE, bands: [] }, {}), null);
});

test("an unregistered lane name never earns the supplemented line", () => {
  assert.equal(retrievalMarkerLine(supplemented(true), { enumerationLane: "invented-lane" }), null);
  assert.equal(isEnumerationLane("invented-lane"), false);
});

test("a truncated listing asserts a set whatever it rendered", () => {
  assert.equal(answerAssertsASet("one line", { pending: { items: ["more"], noun: "facts" } }), true);
  assert.equal(answerAssertsASet("one line"), false);
  assert.equal(answerAssertsASet("one line\nanother line"), true);
  assert.equal(answerAssertsASet("one line\n\n"), false);
});

test("the registry and the probe table name exactly the same lanes", () => {
  const registered = [...Object.values(ENUMERATION_LANES)].sort();
  const probed = [...new Set(LANE_PROBES.map((p) => p.lane))].sort();
  assert.deepEqual(probed, registered);
});

test("every lane the chat surface names is a registered lane", () => {
  const named = [...CHAT_SOURCE.matchAll(/ENUMERATION_LANES\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.ok(named.length > 0, "chat.mjs sets no enumeration lane at all");
  for (const key of new Set(named)) {
    assert.ok(key in ENUMERATION_LANES, `chat.mjs names ENUMERATION_LANES.${key}, which the registry does not hold`);
  }
});

test("every registered lane is set by a composer, so none is dead", () => {
  const named = new Set([...CHAT_SOURCE.matchAll(/ENUMERATION_LANES\.([A-Z_]+)/g)].map((m) => m[1]));
  for (const key of Object.keys(ENUMERATION_LANES)) {
    assert.ok(named.has(key), `no composer sets ENUMERATION_LANES.${key}`);
  }
});

test("every enumeration lane reads the retrieval flag and states its bound", async () => {
  for (const probe of LANE_PROBES) {
    const turn = await ask(probe, supplemented(true));
    assert.equal(
      turn.record?.enumerationLane,
      probe.lane,
      `"${probe.ask}" answered on lane ${turn.record?.enumerationLane ?? "(none)"} rather than ${probe.lane}`,
    );
    assert.ok(
      turn.answer.includes(`\n\n${CORPUS_SCOPE_BOUNDED_LINE}`),
      `"${probe.ask}" claimed a set's extent without saying what it counted over:\n${turn.answer}`,
    );
  }
});

test("an unstopped retrieval drops the may-hold-more clause and keeps the rest", async () => {
  for (const probe of LANE_PROBES) {
    const turn = await ask(probe, supplemented(false));
    assert.ok(
      turn.answer.includes(`\n\n${CORPUS_SCOPE_LINE}`),
      `"${probe.ask}" lost its scope line when nothing stopped the read:\n${turn.answer}`,
    );
    assert.ok(!turn.answer.includes("The corpus may hold more"), `"${probe.ask}" claimed a bound no budget set`);
  }
});

test("an answer that reports a set without reading the flag fails the inventory", async () => {
  for (const probe of LANE_PROBES) {
    const turn = await ask(probe, supplemented(true));
    if (!answerAssertsASet(turn.answer)) continue;
    assert.ok(
      isEnumerationLane(turn.record?.enumerationLane),
      `"${probe.ask}" rendered a set on an unclassified lane — register it or it claims completeness in silence`,
    );
  }
});

test("point answers change nothing while the supplement is running", async () => {
  for (const probe of POINT_PROBES) {
    for (const bounded of [true, false]) {
      const turn = await ask(probe, supplemented(bounded));
      assert.equal(turn.record?.enumerationLane, undefined, `"${probe.ask}" was tagged as an enumeration`);
      assert.ok(!turn.answer.includes("Corpus scope"), `"${probe.ask}" grew a scope line:\n${turn.answer}`);
    }
  }
});

test("a breaker-open turn says the supplement was absent, enumeration or not", async () => {
  for (const probe of [...LANE_PROBES, ...POINT_PROBES]) {
    const turn = await ask(probe, breakerOpen());
    assert.ok(
      turn.answer.includes(`\n\n${CORPUS_SUPPLEMENT_ABSENT_LINE}`),
      `"${probe.ask}" hid the degraded mode:\n${turn.answer}`,
    );
    assert.ok(!turn.answer.includes("pulled from the corpus"), `"${probe.ask}" claimed a corpus read the breaker skipped`);
  }
});

test("a breaker-open turn never carries both markers", async () => {
  const [turn] = await driveSession({
    teach: ["a dog is an animal", "a cat is an animal"],
    asks: ["list the animals"],
    retrieval: breakerOpen(),
  });
  const lines = turn.answer.split("\n").filter((line) => line.startsWith("Corpus scope:"));
  assert.deepEqual(lines, [CORPUS_SUPPLEMENT_ABSENT_LINE]);
});

test("the scope line sits against the answer body, ahead of the goal line", async () => {
  const [turn] = await driveSession({
    teach: ["a dog is an animal", "a cat is an animal"],
    asks: ["list the animals"],
    retrieval: supplemented(true),
  });
  assert.match(
    turn.answer,
    /\n\nCorpus scope: the rows this query pulled from the corpus\. The corpus may hold more\.\n\nGoal \(inferred\): List the taught members of a class\.$/,
  );
});

test("the same session answers byte-identically with and without a corpus behind it", async () => {
  const teach = ["a dog is an animal", "a cat is an animal", "a dog can bark"];
  const asks = ["how many animals are there", "list the animals", "can a dog bark"];
  const withoutContext = await driveSession({ teach, asks, retrieval: null });
  const withEmptyBands = await driveSession({ teach, asks, retrieval: { mode: SEED_SESSION_MODE, bounded: false, bands: [] } });
  // Each run mints its own session id and timestamps, so the provenance tails
  // differ by construction. Everything else must match to the byte.
  const withoutProvenance = (text) => text.replace(/\(source: ace:chat:[^)]*\)/g, "(source: ace:chat)");
  for (const [i, turn] of withoutContext.entries()) {
    assert.equal(
      withoutProvenance(withEmptyBands[i].answer),
      withoutProvenance(turn.answer),
      `"${asks[i]}" moved when a band-less context was passed`,
    );
  }
});

test("a turn's own retrieval context wins over the session's", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tmct-scope-"));
  const session = await createSession({ repoPath: dir, env: { TMCT_NO_SEED: "1" }, retrieval: breakerOpen() });
  try {
    await session.turn("a dog is an animal");
    await session.turn("a cat is an animal");
    const openTurn = await session.turn("how many animals are there");
    assert.ok(openTurn.answer.endsWith(CORPUS_SUPPLEMENT_ABSENT_LINE));
    const closedTurn = await session.turn("how many animals are there", { retrieval: supplemented(true) });
    assert.ok(closedTurn.answer.endsWith(CORPUS_SCOPE_BOUNDED_LINE));
  } finally {
    await session.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a miss stays a miss and never grows a supplemented scope line", async () => {
  const [turn] = await driveSession({
    teach: [],
    asks: ["list the aardvarks"],
    retrieval: supplemented(true),
  });
  assert.equal(turn.record?.enumerationLane, undefined);
  assert.ok(!turn.answer.includes("pulled from the corpus"), turn.answer);
});
