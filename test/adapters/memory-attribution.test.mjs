// Attribution on the read side: the fold hangs each attributed claim's speakers
// on the claim's own row. A report's claim and its speaker are two rows — the
// claim, and `fact:<claimId> | mgx:attributedTo | <speaker>` beside it — so a
// reader that only reads the claim would state a report's assertion as tmct's
// own.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryStore, appendFacts, loadMemory, readFactRows,
} from "../../src/adapters/memory/core.mjs";
import { factIdForTriple } from "../../src/domain/hash.mjs";

const CLAIM = { subject: "russia", predicate: "mgx:releases", object: "robert gilman" };
const CLAIM_ID = factIdForTriple(CLAIM.subject, CLAIM.predicate, CLAIM.object);

const claimRow = (provenance = "extracted:nyt-world") => ({
  ...CLAIM, provenance, extraction: ["reported-speech"],
});
const attributionRow = (speaker, provenance = "extracted:nyt-world") => ({
  subject: CLAIM_ID, predicate: "mgx:attributedTo", object: speaker, provenance,
});

async function storeWith(facts) {
  const dir = createInMemoryStore();
  await appendFacts(dir, facts);
  return dir;
}

const rowsOf = async (dir) => readFactRows(await loadMemory(dir));
const rowFor = (rows, subject) => rows.find((r) => r.subject === subject);

test("the fold hangs an attributed claim's speaker on the claim's own row", async () => {
  const rows = await rowsOf(await storeWith([claimRow(), attributionRow("president trump")]));
  assert.deepEqual(rowFor(rows, "russia").attributedTo, ["president trump"]);
  assert.deepEqual(
    rowFor(rows, "russia").extraction, ["reported-speech"],
    "the finding is the durable half and stays on the row beside the speaker",
  );
});

test("a claim two outlets attributed to two speakers carries both, sorted", async () => {
  const rows = await rowsOf(await storeWith([
    claimRow(),
    attributionRow("president trump"),
    attributionRow("state department", "extracted:reuters-world"),
  ]));
  assert.deepEqual(rowFor(rows, "russia").attributedTo, ["president trump", "state department"]);
});

test("the same rows in any arrival order fold to the same bytes", async () => {
  const facts = [
    claimRow(),
    attributionRow("state department", "extracted:reuters-world"),
    attributionRow("president trump"),
    { subject: "robert gilman", predicate: "rdf:type", object: "person", provenance: "corpus:test" },
  ];
  // Write time is the one thing a second store cannot repeat, so it is the one
  // thing held apart from the comparison.
  const bytes = (rows) => JSON.stringify(rows).replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<t>");
  const forward = await rowsOf(await storeWith(facts));
  const backward = await rowsOf(await storeWith([...facts].reverse()));
  assert.equal(bytes(forward), bytes(backward));
});

test("an attribution whose claim the store never held hangs on nothing", async () => {
  const rows = await rowsOf(await storeWith([attributionRow("president trump")]));
  assert.equal(rowFor(rows, "russia"), undefined, "the claim has not arrived yet");
  assert.ok(
    rows.every((r) => !("attributedTo" in r)),
    "an attribution ahead of its claim attaches to nothing rather than erroring or standing alone",
  );
  assert.equal(
    rowFor(rows, CLAIM_ID).object, "president trump",
    "the attribution itself is still stored, ready for the claim to arrive",
  );
});

test("a row nothing attributed carries no attributedTo at all", async () => {
  const rows = await rowsOf(await storeWith([
    { subject: "kestrel", predicate: "rdfs:subClassOf", object: "bird", provenance: "corpus:test" },
  ]));
  assert.ok(!("attributedTo" in rowFor(rows, "kestrel")), "absent, never empty");
});
