// The taught-class list and count lanes ("list letters", "how many letters
// are there") read a class's members transitively through taught subClassOf
// edges, not just an exact string match on the asked class name: a member
// taught under a refined subclass still belongs to every ancestor class's
// list and count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createInMemoryStore, appendFacts } from "../../src/adapters/memory/core.mjs";

const EMPTY_GRAPH = parseEntities({ individuals: [], objectProperties: [] });

async function storeWith(rows) {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, rows.map((r) => ({ ...r, provenance: "corpus:test" })));
  return memoryDir;
}

const fact = (subject, predicate, object) => ({ subject, predicate, object });

const turn = async (query, memoryDir) =>
  runTurn(query, { graph: EMPTY_GRAPH, memoryDir, sessionId: "taught-class-transitive-members" });

test("a member taught under a taught subclass is listed under the parent class", async () => {
  const memoryDir = await storeWith([
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("list letters", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /beta/);
});

test("refining a member into a subclass keeps it in the parent's list", async () => {
  // The member's own isa row now names the narrower, taught subclass rather
  // than the broad class directly — the pre-closure lane would have dropped
  // it from the broad class's list the moment it was refined this way.
  const memoryDir = await storeWith([
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("list letters", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /beta is a kind of greek letter/);
});

test("an inherited member's line shows the chain back to the asked class", async () => {
  const memoryDir = await storeWith([
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("list letters", memoryDir);
  assert.match(r.answer, /beta is a kind of greek letter → letter/);
});

test("an inherited member's chain passes through the asked class when it has several parents", async () => {
  const memoryDir = await storeWith([
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
    fact("greek letter", "rdfs:subClassOf", "alphabet"),
  ]);
  const r = await turn("list letters", memoryDir);
  assert.match(r.answer, /beta is a kind of greek letter → letter/);
});

test("a direct member's line carries no inherited-chain arrow", async () => {
  const memoryDir = await storeWith([
    fact("alpha", "rdfs:subClassOf", "letter"),
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("list letters", memoryDir);
  const alphaLine = r.answer.split("\n").find((l) => l.startsWith("alpha "));
  assert.ok(alphaLine, r.answer);
  assert.ok(!alphaLine.includes("→"), alphaLine);
});

test("direct members render ahead of inherited ones", async () => {
  const memoryDir = await storeWith([
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
    fact("alpha", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("list letters", memoryDir);
  const lines = r.answer.split("\n");
  const alphaIndex = lines.findIndex((l) => l.startsWith("alpha "));
  const betaIndex = lines.findIndex((l) => l.startsWith("beta "));
  assert.ok(alphaIndex >= 0 && betaIndex >= 0, r.answer);
  assert.ok(alphaIndex < betaIndex, "the direct member (alpha) renders before the inherited one (beta)");
});

test("same facts inserted in a different order produce an identical list", async () => {
  const rows = [
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
    fact("alpha", "rdfs:subClassOf", "letter"),
    fact("gamma", "rdfs:subClassOf", "greek letter"),
  ];
  const forward = await storeWith(rows);
  const reversed = await storeWith([...rows].reverse());
  const a = await turn("list letters", forward);
  const b = await turn("list letters", reversed);
  assert.equal(a.answer, b.answer);
});

test("same facts inserted in a different order produce an identical count", async () => {
  const rows = [
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
    fact("alpha", "rdfs:subClassOf", "letter"),
    fact("gamma", "rdfs:subClassOf", "greek letter"),
  ];
  const forward = await storeWith(rows);
  const reversed = await storeWith([...rows].reverse());
  const a = await turn("how many letters are there", forward);
  const b = await turn("how many letters are there", reversed);
  assert.equal(a.answer, b.answer);
});

test("a count over a class with several taught subclasses reports senses", async () => {
  const memoryDir = await storeWith([
    fact("yogh", "rdfs:subClassOf", "letter"),
    fact("alpha", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
    fact("aleph", "rdfs:subClassOf", "hebrew letter"),
    fact("hebrew letter", "rdfs:subClassOf", "letter"),
    fact("aa", "rdfs:subClassOf", "runic letter"),
    fact("runic letter", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("how many letters are there", memoryDir);
  assert.match(r.answer, /^\d+ letters, in 3 senses\. Say "list letters" to see them\.$/);
});

test("a count over a single-sense class keeps the plain total", async () => {
  const memoryDir = await storeWith([
    fact("alpha", "rdfs:subClassOf", "letter"),
    fact("beta", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("how many letters are there", memoryDir);
  assert.match(r.answer, /^2 letters\. Say "list letters" to see them\.$/);
});

test("a count counts distinct members, not the facts that mention them", async () => {
  const memoryDir = await storeWith([
    fact("alpha", "rdfs:subClassOf", "letter"),
    fact("first kind", "rdfs:subClassOf", "letter"),
    fact("second kind", "rdfs:subClassOf", "letter"),
    fact("beta", "rdfs:subClassOf", "first kind"),
    fact("beta", "rdfs:subClassOf", "second kind"),
  ]);
  const r = await turn("how many letters are there", memoryDir);
  // 4 distinct subjects (alpha, first kind, second kind, beta) though beta
  // carries two isa facts under "letter"'s closure.
  assert.match(r.answer, /^4 letters/);
});

test("a class with no directly taught member is not read as a class at all", async () => {
  const memoryDir = await storeWith([
    fact("beta", "rdfs:subClassOf", "greek letter"),
  ]);
  const r = await turn("list letters", memoryDir);
  assert.equal(r.record?.miss, true, r.answer);
  assert.doesNotMatch(r.answer, /beta/);
});

test("an excluded subclass removes its transitive members from the list", async () => {
  const memoryDir = await storeWith([
    fact("alpha", "rdfs:subClassOf", "latin letter"),
    fact("latin letter", "rdfs:subClassOf", "letter"),
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
  ]);
  const r = await turn("list letters but not greek letters", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.doesNotMatch(r.answer, /beta/);
  assert.doesNotMatch(r.answer, /greek letter is a kind of letter/);
  assert.match(r.answer, /alpha is a kind of latin letter/);
});

test("excluding a class the store never taught anything relevant to leaves the list unchanged", async () => {
  const memoryDir = await storeWith([
    fact("alpha", "rdfs:subClassOf", "latin letter"),
    fact("latin letter", "rdfs:subClassOf", "letter"),
    fact("beta", "rdfs:subClassOf", "greek letter"),
    fact("greek letter", "rdfs:subClassOf", "letter"),
    fact("dog", "rdfs:subClassOf", "animal"),
  ]);
  const r = await turn("list letters but not animals", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  assert.match(r.answer, /alpha is a kind of latin letter/);
  assert.match(r.answer, /beta is a kind of greek letter/);
  assert.match(r.answer, /none of the letters I know are marked as animals yet/);
});

test("inherited members beyond the answer cap move into the paginated remainder while direct members do not", async () => {
  const rows = [];
  for (let i = 1; i <= 31; i += 1) rows.push(fact(`direct-${i}`, "rdfs:subClassOf", "letter"));
  rows.push(fact("greek letter", "rdfs:subClassOf", "letter"));
  for (let i = 1; i <= 5; i += 1) rows.push(fact(`inherited-${i}`, "rdfs:subClassOf", "greek letter"));
  const memoryDir = await storeWith(rows);
  const r = await turn("list letters", memoryDir);
  assert.equal(!!r.record?.miss, false, r.answer);
  const bodyLines = r.answer.split("\n")
    .filter((l) => l.startsWith("direct-") || l.startsWith("greek letter") || l.startsWith("inherited-"));
  assert.equal(bodyLines.length, 32);
  assert.ok(bodyLines.every((l) => !l.includes("→")), "none of the visible 32 lines carry an inherited chain arrow");
  assert.match(r.answer, /…and 5 more — say 'more' to see them\./);
});

// The answer-side hub set (hub-terms.mjs's ANSWER_STOP_SET) is wider than
// the persona-tier curation's STOP_SET, so a chain rendered in a chat answer
// halts before climbing into "property"/"concept"/"idea"/"content" the way
// STOP_SET alone would let it.
test("an inherited chain rendered in an answer stops before climbing into the wider abstraction-tier hubs", async () => {
  const memoryDir = await storeWith([
    fact("beta", "rdfs:subClassOf", "letter"),
    fact("letter", "rdfs:subClassOf", "character"),
    fact("character", "rdfs:subClassOf", "property"),
    fact("property", "rdfs:subClassOf", "concept"),
    fact("concept", "rdfs:subClassOf", "idea"),
    fact("idea", "rdfs:subClassOf", "content"),
  ]);
  const r = await turn("what is beta", memoryDir);
  assert.match(r.answer, /beta is a kind of letter → character/);
  assert.doesNotMatch(r.answer, /property|concept|idea|content/);
});
