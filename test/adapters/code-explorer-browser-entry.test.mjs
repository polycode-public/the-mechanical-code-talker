// The code explorer's chat session answers over BOTH stores it seeds: the
// code graph (through source.mjs's provider seam) and an optional serialized
// memory payload — the same shape chat.html's seed asset carries — so one
// session grounds "what does a.mjs import" and "what is a <taught term>"
// alike, and a fact taught in one session survives the payload round-trip
// into the next.
import { test } from "node:test";
import assert from "node:assert/strict";
import { askRelatedFacts, createCodeExplorerSession } from "../../src/surfaces/web/code-explorer-browser-entry.mjs";
import { computeCodeLedger } from "../../src/services/code-explorer-viz.mjs";

const graphPayload = {
  individuals: [
    { id: "mod:src/a.mjs", label: "src/a.mjs", class: "Module" },
    { id: "mod:src/b.mjs", label: "src/b.mjs", class: "Module" },
  ],
  objectProperties: [
    {
      predicate: "imports",
      prop: "mgx:importsNamespace",
      count: 1,
      examples: [{ subject: "mod:src/a.mjs", object: "mod:src/b.mjs", subjectLabel: "src/a.mjs", objectLabel: "src/b.mjs" }],
    },
  ],
};

test("a graph question answers from the registered code graph", async () => {
  const session = createCodeExplorerSession({ graphPayload });
  const res = await session.turn("what does src/a.mjs import");
  assert.match(res.answer, /src\/b\.mjs/, "the import edge grounds the answer");
});

test("a seeded memory payload answers general-knowledge questions beside the graph lanes, in the same session", async () => {
  const teacher = createCodeExplorerSession({ graphPayload });
  await teacher.turn("every container is a thing");
  const taught = await teacher.turn("every zorbcase is a container");
  assert.doesNotMatch(taught.answer, /couldn't store/i, "the teach turn lands");

  const seedPayload = structuredClone(teacher.memoryDir.payload);
  const seeded = createCodeExplorerSession({ graphPayload, seedPayload, vocabSeeded: true });

  const recall = await seeded.turn("what is a zorbcase");
  assert.match(recall.answer, /container/, "the seeded fact grounds the recall");

  const code = await seeded.turn("what does src/a.mjs import");
  assert.match(code.answer, /src\/b\.mjs/, "the same session still answers over the code graph");
});

test("an unseeded session stays the honest graph-only chat: an unknown term is a miss, never a guess", async () => {
  const session = createCodeExplorerSession({ graphPayload });
  const res = await session.turn("what is a zorbcase");
  assert.doesNotMatch(res.answer, /container/, "nothing grounds the term, so nothing is asserted");
});

// A class whose members carry qualified labels, so an answer read off the graph
// and a walk over the edge groups' own denormalized objectLabel disagree about
// what to call the same member.
const memberPayload = {
  individuals: [
    { id: "mod:src/model.mjs", label: "src/model.mjs", class: "Module" },
    { id: "fn:src/model.mjs#Task", label: "Task", class: "Class" },
    { id: "fn:src/model.mjs#Task.title", label: "Task.title", class: "Attribute" },
    { id: "fn:src/model.mjs#Record", label: "Record", class: "Class" },
  ],
  objectProperties: [
    {
      predicate: "contains",
      prop: "seon:containsCodeEntity",
      count: 1,
      examples: [{ subject: "fn:src/model.mjs#Task", object: "fn:src/model.mjs#Task.title", subjectLabel: "Task", objectLabel: "title" }],
    },
    {
      predicate: "inherits",
      prop: "seon:hasSupertype",
      count: 1,
      examples: [{ subject: "fn:src/model.mjs#Task", object: "fn:src/model.mjs#Record", subjectLabel: "Task", objectLabel: "Record" }],
    },
  ],
};

test("the focus neighbourhood comes back from real tmct_ask round trips, one per relation kind the graph stores, in both directions", () => {
  const related = askRelatedFacts(graphPayload, "src/b.mjs");
  assert.equal(related.grounded, true, "the engine parsed the questions as asked");
  assert.deepEqual(
    related.asked.map((a) => a.query),
    ["what couples to src/b.mjs", "what does src/b.mjs import"],
    "a graph holding only imports asks the imports pair and nothing else",
  );
  assert.deepEqual(related.rows, [
    { s: "src/a.mjs", kind: "imports", phrase: "imports", o: "src/b.mjs", sClass: "Module", oClass: "" },
  ]);
  const [reverse, forward] = related.asked;
  assert.equal(reverse.traversal, "imports edges where object = src/b.mjs");
  assert.equal(forward.traversal, "imports edges where subject = src/b.mjs");
  assert.equal(forward.miss, true, "nothing imports out of src/b.mjs, and the engine says so rather than guessing");
});

test("the asked rows carry the graph's own member labels, which the edge groups' denormalized labels do not", () => {
  const asked = askRelatedFacts(memberPayload, "Task").rows.filter((r) => r.kind === "contains");
  const walked = computeCodeLedger(memberPayload).rows.filter((r) => r.kind === "contains" && r.s === "Task");
  assert.deepEqual(asked.map((r) => r.o), ["Task.title"], "the engine names the member as the graph declares it");
  assert.deepEqual(walked.map((r) => r.o), ["title"], "the edge group's own objectLabel is the bare, ambiguous one");
});

test("an asked neighbourhood reaches every kind and direction in one pass, typed by the answer's own class", () => {
  const related = askRelatedFacts(memberPayload, "Task");
  assert.equal(related.grounded, true);
  assert.deepEqual(related.rows.map((r) => `${r.s} ${r.phrase} ${r.o}`), [
    "Task contains Task.title",
    "Task inherits from Record",
  ]);
  const inherits = related.rows.find((r) => r.kind === "inherits");
  assert.equal(inherits.oClass, "Class", "the row's class comes from the matched individual, not a label guess");
  assert.deepEqual(
    related.asked.map((a) => a.query),
    ["what contains Task", "what does Task contain", "what inherits from Task", "what does Task inherit from"],
    "both directions of both stored kinds are put to the engine",
  );
});

test("an answer about a neighbour of the term, rather than the term, is dropped instead of drawn", () => {
  // ask() resolves a term against the asked relation's own range, so "what
  // contains Task" answers about Task.title's container. True, and not the pair
  // this row would claim.
  const reverseContains = askRelatedFacts(memberPayload, "Task").asked
    .find((a) => a.query === "what contains Task");
  assert.equal(reverseContains.used, true, "the question was understood");
  assert.equal(reverseContains.matched, 1, "and answered");
  assert.equal(reverseContains.traversal, "contains edges where object = Task.title", "about a neighbour of the term");
  assert.equal(reverseContains.confirmed, 0, "no contains edge runs into Task, so no row is drawn");
});

test("a term whose label is itself a relation verb reports itself ungrounded rather than answering about the verb", () => {
  const verbNamed = {
    individuals: [
      { id: "mod:spec.mjs", label: "spec.mjs", class: "Module" },
      { id: "mod:run", label: "run", class: "Module" },
    ],
    objectProperties: [
      {
        predicate: "tests",
        prop: "mgx:testsCoverage",
        count: 1,
        examples: [{ subject: "mod:spec.mjs", object: "mod:run", subjectLabel: "spec.mjs", objectLabel: "run" }],
      },
    ],
  };
  const related = askRelatedFacts(verbNamed, "run");
  assert.equal(related.grounded, false, "'what tests run' is a question about testing, not about run");
  assert.deepEqual(related.rows, [], "no row is invented from a misparsed question");
  assert.ok(related.asked.length > 0 && related.asked.every((a) => !a.used), "every question was put and every answer refused");
  const walked = computeCodeLedger(verbNamed).rows.filter((r) => r.s === "run" || r.o === "run");
  assert.equal(walked.length, 1, "the row walk still holds the edge, which is why an ungrounded ask falls back to it");
});

test("a term the row list names but the graph holds no individual for is left to the row list", () => {
  const walked = computeCodeLedger(memberPayload);
  assert.ok(walked.terms.some((t) => t.term === "title"), "the row walk offers the denormalized label as a clickable term");
  const related = askRelatedFacts(memberPayload, "title");
  assert.equal(related.grounded, false, "the graph's individual is Task.title, so there is no 'title' to ask about");
  assert.deepEqual(related.asked, [], "and nothing is asked rather than asked and misread");
});

test("no graph and no term ask nothing", () => {
  assert.deepEqual(askRelatedFacts(null, "src/b.mjs"), { term: "src/b.mjs", rows: [], asked: [], grounded: false });
  assert.deepEqual(askRelatedFacts(graphPayload, ""), { term: null, rows: [], asked: [], grounded: false });
});
