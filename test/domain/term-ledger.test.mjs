import test from "node:test";
import assert from "node:assert/strict";
import {
  createTermLedger,
  bumpTerms,
  rankedTerms,
  markTerm,
  groundedSweep,
  ledgerPayload,
  ledgerFromPayload,
} from "../../src/domain/term-ledger.mjs";

test("bumpTerms accumulates counts for the same term across separate bumps", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["ceasefire", 2]]), "news-item:aaa", "2026-08-08T09:00:00Z");
  bumpTerms(ledger, new Map([["ceasefire", 3]]), "news-item:bbb", "2026-08-08T10:00:00Z");
  const [entry] = rankedTerms(ledger);
  assert.equal(entry.term, "ceasefire");
  assert.equal(entry.count, 5);
  assert.equal(entry.firstSeen, "2026-08-08T09:00:00Z");
  assert.equal(entry.lastSeen, "2026-08-08T10:00:00Z");
});

test("bumpTerms normalizes term keys, so a term matching only by article dedupes into one entry", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["a tariff", 1]]), "item-1", "2026-08-08T09:00:00Z");
  bumpTerms(ledger, new Map([["Tariff", 4]]), "item-2", "2026-08-08T09:05:00Z");
  assert.equal(ledger.terms.size, 1);
  assert.equal(ledger.terms.get("tariff").count, 5);
});

test("rankedTerms sorts count desc then term asc", () => {
  const ledger = createTermLedger();
  bumpTerms(
    ledger,
    new Map([
      ["ceasefire", 3],
      ["tariff", 5],
      ["albatross", 5],
    ]),
    "item-1",
    "2026-08-08T09:00:00Z",
  );
  const ranked = rankedTerms(ledger).map((e) => e.term);
  assert.deepEqual(ranked, ["albatross", "tariff", "ceasefire"]);
});

test("rankedTerms respects the limit", () => {
  const ledger = createTermLedger();
  bumpTerms(
    ledger,
    new Map([
      ["one", 3],
      ["two", 2],
      ["three", 1],
    ]),
    "item-1",
    "2026-08-08T09:00:00Z",
  );
  assert.deepEqual(
    rankedTerms(ledger, { limit: 2 }).map((e) => e.term),
    ["one", "two"],
  );
});

test("vocabGrounded is set once from vocabGroundedByTerm on first insert and never revisited", () => {
  const ledger = createTermLedger();
  const vocabMap = new Map([["ceasefire", true]]);
  bumpTerms(ledger, new Map([["ceasefire", 1]]), "item-1", "2026-08-08T09:00:00Z", vocabMap);
  assert.equal(ledger.terms.get("ceasefire").vocabGrounded, true);
  // A later bump passing a DIFFERENT vocab answer must not move the flag —
  // lexicon membership does not change once observed.
  const laterMap = new Map([["ceasefire", false]]);
  bumpTerms(ledger, new Map([["ceasefire", 1]]), "item-2", "2026-08-08T09:10:00Z", laterMap);
  assert.equal(ledger.terms.get("ceasefire").vocabGrounded, true);
});

test("vocabGrounded defaults to false when the term is missing from vocabGroundedByTerm", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["glorbnax", 1]]), "item-1", "2026-08-08T09:00:00Z");
  assert.equal(ledger.terms.get("glorbnax").vocabGrounded, false);
});

test("itemIds cap at 12 and never duplicate an item", () => {
  const ledger = createTermLedger();
  for (let i = 0; i < 20; i += 1) {
    bumpTerms(ledger, new Map([["ceasefire", 1]]), `item-${i}`, "2026-08-08T09:00:00Z");
  }
  bumpTerms(ledger, new Map([["ceasefire", 1]]), "item-0", "2026-08-08T09:00:00Z");
  const entry = ledger.terms.get("ceasefire");
  assert.equal(entry.itemIds.length, 12);
  assert.deepEqual(entry.itemIds, Array.from({ length: 12 }, (_, i) => `item-${i}`));
});

test("markTerm sets status and stamps missedAt only when the new status is missed", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["ceasefire", 1]]), "item-1", "2026-08-08T09:00:00Z");
  markTerm(ledger, "ceasefire", "enriching", "2026-08-08T09:05:00Z");
  assert.equal(ledger.terms.get("ceasefire").status, "enriching");
  assert.equal(ledger.terms.get("ceasefire").missedAt, "");
  markTerm(ledger, "ceasefire", "missed", "2026-08-08T09:10:00Z");
  assert.equal(ledger.terms.get("ceasefire").status, "missed");
  assert.equal(ledger.terms.get("ceasefire").missedAt, "2026-08-08T09:10:00Z");
});

test("groundedSweep flips pending and missed entries on fact-grounding alone, independent of vocabGrounded", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["ceasefire", 1], ["tariff", 1]]), "item-1", "2026-08-08T09:00:00Z", new Map([["ceasefire", true]]));
  markTerm(ledger, "tariff", "missed", "2026-08-08T09:05:00Z");
  const grounded = new Set(["ceasefire", "tariff"]);
  const flipped = groundedSweep(ledger, (term) => grounded.has(term));
  assert.deepEqual(flipped, ["ceasefire", "tariff"]);
  assert.equal(ledger.terms.get("ceasefire").status, "grounded");
  assert.equal(ledger.terms.get("ceasefire").vocabGrounded, true);
  assert.equal(ledger.terms.get("tariff").status, "grounded");
  assert.equal(ledger.terms.get("tariff").vocabGrounded, false);
});

test("groundedSweep never flips an already-grounded or enriching entry", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["ceasefire", 1]]), "item-1", "2026-08-08T09:00:00Z");
  markTerm(ledger, "ceasefire", "grounded", "2026-08-08T09:05:00Z");
  const flipped = groundedSweep(ledger, () => true);
  assert.deepEqual(flipped, []);
});

test("the negative-cache TTL expiry is pure: two now values give two answers, the ledger itself is untouched", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["tariff", 1]]), "item-1", "2026-08-08T09:00:00Z");
  markTerm(ledger, "tariff", "missed", "2026-08-08T09:00:00Z");

  const withinTtl = rankedTerms(ledger, { status: "pending", now: "2026-08-08T10:00:00Z", ttlMs: 24 * 60 * 60 * 1000 });
  assert.deepEqual(withinTtl, []);

  const afterTtl = rankedTerms(ledger, { status: "pending", now: "2026-08-10T10:00:00Z", ttlMs: 24 * 60 * 60 * 1000 });
  assert.equal(afterTtl.length, 1);
  assert.equal(afterTtl[0].term, "tariff");

  // Neither call mutated the underlying entry.
  assert.equal(ledger.terms.get("tariff").status, "missed");
});

test("a ttlMs of 0 is a real zero-hour TTL (immediately eligible again), not \"no TTL\"", () => {
  const ledger = createTermLedger();
  bumpTerms(ledger, new Map([["tariff", 1]]), "item-1", "2026-08-08T09:00:00Z");
  markTerm(ledger, "tariff", "missed", "2026-08-08T09:00:00Z");

  const immediatelyAfter = rankedTerms(ledger, { status: "pending", now: "2026-08-08T09:00:00Z", ttlMs: 0 });
  assert.equal(immediatelyAfter.length, 1, "a zero-hour negative cache never holds a term back");
  assert.equal(immediatelyAfter[0].term, "tariff");
});

test("bumpTerms never admits a function word, even at an occurrence count that would otherwise rank it first", () => {
  const ledger = createTermLedger();
  bumpTerms(
    ledger,
    new Map([
      ["from", 50],
      ["and", 40],
      ["but", 30],
      ["very", 20],
      ["into", 10],
      ["about", 5],
      ["tariff", 1],
    ]),
    "item-1",
    "2026-08-08T09:00:00Z",
  );
  const ranked = rankedTerms(ledger).map((e) => e.term);
  assert.deepEqual(ranked, ["tariff"]);
});

test("ledgerFromPayload drops a function-word entry already sitting in a persisted payload", () => {
  const payload = {
    terms: [
      { term: "from", count: 50, vocabGrounded: false, itemIds: [], firstSeen: "2026-08-08T09:00:00Z", lastSeen: "2026-08-08T09:00:00Z", status: "pending", missedAt: "" },
      { term: "tariff", count: 1, vocabGrounded: true, itemIds: [], firstSeen: "2026-08-08T09:00:00Z", lastSeen: "2026-08-08T09:00:00Z", status: "pending", missedAt: "" },
    ],
  };
  const ledger = ledgerFromPayload(payload);
  assert.deepEqual([...ledger.terms.keys()], ["tariff"]);
});

test("ledgerPayload emits entries in ranking order and round-trips byte-identically", () => {
  const ledger = createTermLedger();
  bumpTerms(
    ledger,
    new Map([
      ["ceasefire", 3],
      ["tariff", 5],
    ]),
    "item-1",
    "2026-08-08T09:00:00Z",
    new Map([["ceasefire", true]]),
  );
  markTerm(ledger, "ceasefire", "grounded", "2026-08-08T09:30:00Z");

  const payload = ledgerPayload(ledger);
  assert.deepEqual(payload.terms.map((e) => e.term), ["tariff", "ceasefire"]);

  const restored = ledgerFromPayload(payload);
  const roundTripped = ledgerPayload(restored);
  assert.equal(JSON.stringify(roundTripped), JSON.stringify(payload));
});
