// quickwins.test.mjs — the 0.8.1 quick-win regression pins. Each block locks a
// bounded playtest fix by ROUTING (never grammar rigidity, never an LLM), so a
// later change that silently un-fixes one fails HERE, in `npm test`.
//
//   1. singular "what is a test" reaches the relation-concept force (chat.mjs
//      relationTermOf widening) — without admitting the frozen am-meta-imports
//      ambiguity or preempting a real schema predicate ("what is a contains").
//   2. "who touched X" renders a friendly commit ref (short sha + author), not a
//      raw sha (ask.mjs commitRefOf) — degrading to the sha alone with no author.
//   3. "what tests cover X" honest-empty reads cleanly ("No tests cover X."), not
//      the "…whose module directly tests cover X" garble (ask.mjs miss renderer) —
//      while the frozen "which modules test X" wording is left byte-exact.
//   4. the chatbench runner scrubs the per-run-volatile fact-recall citation
//      (ace:chat:<uuidv7>@<ISO stamp>) so assert-recall rows are byte-reproducible
//      across identical runs (was the discourse-count / assert-recall flake source).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ask } from "../src/ask.mjs";
import { runTurn, runChat } from "../src/chat.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { clearCache } from "../src/source.mjs";
import { runSessionCase } from "../chatbench/run.mjs";
import { parseSessionJsonl, parseSessionLog, turnKey } from "../src/sessions.mjs";

const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url);
const FIXTURE_PAYLOAD = JSON.parse(await readFile(FIXTURE, "utf8"));
const graph = parseEntities(ingestSchemaDocs(structuredClone(FIXTURE_PAYLOAD)));

/** A temp repo whose .tmct/graph.json IS the writer-ingested fixture (a producer runs
 *  ingestSchemaDocs before writing; the product loader — server.mjs — does not), so
 *  the schema-doc individuals a real shipped graph carries are present. The end-to-end
 *  runTurn path loads it from config exactly as the real shell does. */
async function repoWithFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-qw-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const payload = structuredClone(FIXTURE_PAYLOAD);
  ingestSchemaDocs(payload);
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

// ── Fix 1: singular "what is a test" (meta shape) reaches the relation force ──

test("fix1: 'what is a test' composes the SAME relation-concept answer as 'what are the tests'", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const singular = await runTurn("what is a test", { config, graph });
    clearCache();
    const plural = await runTurn("what are the tests", { config, graph });
    assert.equal(singular.record.miss, false, "the singular meta shape is no longer an honest miss");
    assert.equal(singular.answer, plural.answer,
      "'what is a test' fires the relation-concept force identically to its plural");
    assert.match(singular.answer, /^A test is code that exercises/, "the curated relation definition leads");
    assert.match(singular.answer, /tests app\/lib\/b\.mjs/, "real example test EDGES follow");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fix1: the frozen am-meta-imports ambiguity is NOT admitted (a different shape)", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const r = await runTurn("what does imports mean", { config, graph });
    assert.match(r.answer, /could mean more than one thing/,
      "'what does imports mean' keeps its honest ambiguity surround — the relation force never preempts it");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fix1: a relation word that IS a real schema predicate keeps its schema meta answer", async () => {
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const r = await runTurn("what is a contains", { config, graph });
    assert.match(r.answer, /contains is a predicate \(relation\) in the graph's schema/,
      "a resolvable schema predicate (non-miss) is untouched by the widening");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fix1: a non-relation unknown term still declines to the honest vocabulary miss", async () => {
  // (0.8.2 WS1: "widget" now resolves via the meta fallback — it IS the fixture's
  // Class Widget — so the honest-miss pin uses a term that matches nothing at all.)
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const r = await runTurn("what is a gadget", { config, graph });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /isn't a term in this graph's own vocabulary/,
      "'gadget' is not a RELATION_TERM, a schema term, or a code-graph class — the miss stands");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("fix1 (0.8.2 WS1): a schema-vocabulary miss that IS a unique code-graph Class gets the describe-style one-liner", async () => {
  // "what is a Widget" used to claim Widget "isn't a term in this graph's own
  // vocabulary" although the code graph carries the Class individual — the meta
  // fallback now points at the real entity instead of the false vocabulary miss.
  const dir = await repoWithFixture();
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    clearCache();
    const r = await runTurn("what is a widget", { config, graph });
    assert.equal(r.record.miss, false, "a unique Class-label hit is a real answer");
    assert.equal(r.answer,
      'Widget is a class in this codebase, defined in app/lib/b.mjs — try "describe Widget" or "which classes inherit from Widget".',
      "the describe-style one-liner cites the defining module and offers next questions");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Fix 2: "who touched X" renders a friendly commit ref, not a raw sha ──

test("fix2: 'who touched X' names the author beside the sha, not a bare hash", () => {
  const r = ask(graph, "who touched app/lib/a.mjs");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content, "abc1234 (Ada Lovelace).",
    "the friendly ref is the short sha + the Commit individual's mgx:commitAuthor");
});

test("fix2: 'who touched X' degrades gracefully to the sha alone when no author is recorded", () => {
  // a commit individual with NO author attribute → the sha renders alone (no "()").
  const noAuthor = structuredClone(FIXTURE_PAYLOAD);
  const commit = noAuthor.individuals.find((i) => i.class === "Commit");
  commit.attributes = (commit.attributes || []).filter((a) => a.key !== "author");
  const g = parseEntities(ingestSchemaDocs(noAuthor));
  const r = ask(g, "who touched app/lib/a.mjs");
  assert.equal(r.content, "abc1234.", "no author → the sha stands alone, no empty parens");
});

// ── Fix 3: the "tests cover" honest-empty reads cleanly ──

test("fix3: 'what tests cover X' honest-empty reads 'No tests cover X.', not the garble", () => {
  const r = ask(graph, "what tests cover app/lib/c.mjs"); // c.mjs has no test edges
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /^No tests cover app\/lib\/c\.mjs\./,
    "the 'tests cover' verb phrase no longer leaks into the miss template");
  assert.doesNotMatch(r.content, /whose module directly/, "the mislabelled 'modules … whose module' scaffold is gone");
  assert.doesNotMatch(r.content, /tests cover app\/lib\/c\.mjs\. \(traversal.*cover/, "no leaked 'cover' verb in the object");
});

test("fix3: the leaked 'cover' verb is stripped from the object", () => {
  const r = ask(graph, "which tests cover app/lib/f.mjs");
  assert.match(r.content, /^No tests cover app\/lib\/f\.mjs\./, "the object is the module, with 'cover' removed");
});

test("fix3 (0.8.2 WS1): ANY leading relation verb is canonicalized out of the tests-kind honest empty", () => {
  // The old strip only knew ^cover(s|ing)? — "do any tests touch f.mjs" leaked the
  // user's verb ("No tests cover touch app/lib/f.mjs."). The strip is now built from
  // ask-vocab's closed relation-verb table, so touch/check/verify canonicalize too.
  for (const verb of ["touch", "check", "verify", "cover"]) {
    const r = ask(graph, `which tests ${verb} app/lib/f.mjs`);
    assert.equal(r.tmct_ask.miss, true, `${verb}: still the honest empty`);
    assert.match(r.content, /^No tests cover app\/lib\/f\.mjs\./, `${verb}: the leaked verb is stripped`);
    assert.doesNotMatch(r.content, new RegExp(`cover ${verb} `), `${verb}: no verb rides into the object`);
  }
});

test("fix3: the frozen 'which modules test X' entity-keyword wording is untouched", () => {
  const r = ask(graph, "which modules test app/lib/f.mjs"); // explicit entity keyword → entityType Module
  assert.match(r.content, /No modules found whose module directly tests app\/lib\/f\.mjs\./,
    "the pinned entity-keyword phrasing (frozen in cases.jsonl) stays byte-exact");
});

// ── Fix 4: the chatbench runner scrubs the volatile fact-recall citation ──

test("fix4: assert-recall rows are byte-reproducible — the ace:chat:<uuid>@<ts> citation is scrubbed", async () => {
  // An assert-then-recall session: turn 1 stores a fact, turn 2 recalls it and echoes
  // the provenance. The uuidv7 session id + wall-clock stamp are minted per run, so the
  // recalled answer used to flip between otherwise-identical runs (the instrument flake).
  const graphJson = (() => { const p = structuredClone(FIXTURE_PAYLOAD); ingestSchemaDocs(p); return JSON.stringify(p); })();
  const caseDef = {
    id: "qw-assert-recall", tags: ["graded"], grade: "C1", construction: "assert-recall",
    mode: "session", graph: "fixture",
    turns: [
      { say: "every class is a category", session: 1, expect: { miss: false } },
      { say: "what did i tell you last time", session: 2, expect: { miss: false, answerMatch: ["category"] } },
    ],
  };
  const deps = { runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson, clearCache };
  const run1 = await runSessionCase(caseDef, deps);
  const run2 = await runSessionCase(caseDef, deps);
  const recall1 = run1.transcript[1].answer;
  const recall2 = run2.transcript[1].answer;
  assert.match(recall1, /category/, "the recall still names the asserted fact (tier-1 unaffected)");
  assert.match(recall1, /ace:chat:<session>@<ts>/, "the volatile citation is folded to the stable placeholder");
  assert.doesNotMatch(recall1, /ace:chat:[0-9a-f]{8}-/i, "no raw uuidv7 leaks into the recorded answer");
  assert.doesNotMatch(recall1, /@\d{4}-\d{2}-\d{2}T/, "no raw wall-clock stamp leaks into the recorded answer");
  assert.equal(recall1, recall2, "two identical runs record byte-identical recall answers");
});
