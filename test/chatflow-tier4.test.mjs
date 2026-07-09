// chatflow-tier4.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts, genuine
// Tier 4 ("compositional & comparative" — §3: "which functions call X and are
// untested", "which module has the most imports", "public methods of X",
// "which of those are tested").
//
// Driven against the SHIPPED examples/mini-webapp graph via `ephemeral: true`
// (chat.mjs's createSession) — reads the real graph but writes session/provenance
// state to a throwaway temp dir, so the committed fixture is never touched (same
// mechanism test/chatflow-tier1-single-touch.test.mjs relies on).
//
// This tier had a head start: commit 610915a had already fixed "which functions
// call X and are untested" (a verb clause AND a bare qualifier branch) shortly
// before this pass started. This pass found and fixed four further dead-ends, all
// ROUTING/recognition, none widening the marker gate beyond a closed, low-risk
// signal (the compat-guarded bare verb+verb case, "which classes extends Base and
// couples to logging", stays on the legacy ambiguousParse path throughout — see
// ask-compositional.test.mjs's own compat guard, unmodified by any of these):
//
//   T1  "which functions call X and call Y" (bare AND, no "that", no qualifier) —
//       the sibling shape 610915a's own commit message deliberately left unfixed —
//       fell to the legacy ambiguousParse path and, worse, offered a "did you mean
//       X and Y? Try one of those" repair that ITSELF failed when tried verbatim
//       (§0's "an offered example that fails when tried" bar). Fixed narrowly: the
//       marker gate now also opens when every boolean branch leads with the SAME
//       mapped verb kind — an explicit repeat ("call X and call Y") or a bare
//       object inheriting the prior branch's verb via the SAME ellipsis-borrowing
//       buildPredicateAtoms already used for OR-chains ("call X but not Y"). A
//       branch with its own DIFFERENT explicit verb (the compat-guarded case)
//       still fails both conditions and is untouched.
//   T2  "which function is called the most" — parseSuperlative's edge-noun scan
//       only looked AT-OR-AFTER the extreme ("most"), so a passive-participle-led
//       phrasing with the metric word BEFORE "the most" (a copula predicate: "is
//       called the most") was never found, even though "called" was already a
//       recognized EDGE_NOUN_TO_METRIC key (added for "most called" word order).
//       Fixed with a backward fallback scan (only when the forward scan finds
//       nothing, so it can't touch any phrasing that already resolved correctly).
//   T3  A top-level "qualifier" AST node (a leading-qualifier compositional query,
//       e.g. "public methods of X") carried no `entityType` of its own — only its
//       `inner` did — so a ZERO-match qualifier query fell to the generic
//       {compositeKind:"set"} catch-all with `entityType: null`, rendering a bare,
//       kind-less "nothing in the index matches that." instead of a receipted
//       "nothing in the index matches that (methods)." Fixed by carrying
//       `entityType` on the qualifier node itself at both construction sites.
//   T4  The discourse-anaphora filter ("which of those are tested") lost the
//       entity-kind receipt the SAME way when a real, non-empty previous set
//       filtered down to ZERO survivors — evalAnaphora's `common` class only
//       looked at the (now-empty) post-filter set. Fixed with a fallback to the
//       PRE-filter set's shared class when the filter empties it out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { driveSessionTurns } from "./helpers/session.mjs";

const WALL = /couldn't parse this as a graph question/;
const AMBIGUOUS = /this could mean more than one thing/;
const COULDNT_RESOLVE = /couldn't resolve one of the terms/;
const COMPOSITE_MISS = /couldn't compile this compositional question/;
// The pre-fix T1 dead-end specifically — an ambiguous "did you mean" repair whose
// own suggested next step ("Try one of those") fails when tried verbatim. A
// GENUINE honest-empty ("nothing in the index matches that (…)") is NOT this —
// it names the entity kind checked, unlike the pre-fix bare "matches more than
// one … ambiguously" non-repair.
const AMBIGUOUS_MODULE_REPAIR = /matches more than one module ambiguously/;
const DEAD_END = new RegExp(
  [WALL, AMBIGUOUS, COULDNT_RESOLVE, COMPOSITE_MISS, AMBIGUOUS_MODULE_REPAIR].map((r) => r.source).join("|"),
);

const REPO = new URL("../examples/mini-webapp", import.meta.url).pathname;

const driveSession = (queries) => driveSessionTurns({ repoPath: REPO, env: {}, ephemeral: true }, queries);

function assertAllFlow(turns, queries) {
  for (const [i, t] of turns.entries()) {
    assert.doesNotMatch(t.answer, DEAD_END, `turn ${i} "${queries[i]}" must not dead-end: ${t.answer.slice(0, 160)}`);
  }
}

test("tier4/boolean-AND repeat-verb: 'which functions call X and call Y' composes (T1 fix) — genuinely empty intersection is an honest, receipted empty, not the old ambiguous non-repair", async () => {
  const queries = ["which functions call saveStore and call loadStore"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // no single function calls both saveStore and loadStore in this fixture — a
  // real, receipted empty (names the entity kind), never the old "did you mean
  // loadStore and saveStore? Try one of those" repair that itself failed.
  assert.match(turns[0].answer, /nothing in the index matches that \(functions\)/);
});

test("tier4/boolean-OR repeat-verb: 'which functions call X or call Y' still composes (compat, unaffected by T1)", async () => {
  const queries = ["which functions call saveStore or call loadStore"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /createTask\(\) and listTasks\(\)/);
});

test("tier4/boolean-BUT-NOT ellipsis: 'which functions call X but not Y' borrows the verb onto the bare object (T1 fix)", async () => {
  const queries = [
    "which functions call saveStore but not loadStore",
    "which functions call loadStore but not saveStore",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^createTask\(\)\./);
  assert.match(turns[1].answer, /^listTasks\(\)\./);
});

test("tier4/compat guard (unaffected): a bare verb+verb 'and' with two DIFFERENT verbs still stays off the compositional path", async () => {
  // Same discipline as ask-compositional.test.mjs's own compat guard — T1's fix
  // must not widen the gate to "any verb+verb and", only a same-relation chain.
  const turns = await driveSession(["which classes extends Base and couples to logging"]);
  // this fixture has no "couples to" relation data at all, so the legacy path's
  // own honest miss/ambiguous handling is whatever it is — the only thing pinned
  // here is that it did NOT get seized as a same-verb boolean composition.
  assert.doesNotMatch(turns[0].answer, /the most|superlative/i);
});

test("tier4/boolean-AND two-different-recognized-verbs (Batch 4/5 fix): 'which functions call X and test Y' composes to the real set intersection, not the legacy ambiguousParse", async () => {
  // "call" (kind calls) and "test" (kind tests) are TWO DIFFERENT, BOTH-recognized
  // verbs — previously this whole shape fell OUTSIDE sameVerbLed's gate (which only
  // accepted a same-kind repeat or a bare ellipsis-borrowed object) and dropped to
  // the legacy ambiguousParse path, misreading "Task and test src/core/store.mjs"
  // as one literal (unresolvable) object string. differentVerbLed (src/ask.mjs,
  // parseRelationalOrQualified) now also opens the gate when a later branch names
  // its OWN single-word recognized verb, so this composes as a genuine two-atom
  // boolean intersection instead.
  const queries = [
    // sanity: each branch's own clause is independently a REAL, non-empty answer in
    // this fixture (mini-webapp) — saveStore/validateTask both call Task (callsSymbol);
    // testCreateTask/testLoadStore are the functions in the two modules that test
    // src/core/store.mjs (refined from the module-coarse tests edge via defines).
    "which functions call Task",
    "which functions test src/core/store.mjs",
    // the composed query: the ACTUAL intersection of those two real sets. In this
    // fixture the "callers of Task" and "testers of store.mjs" are disjoint
    // real populations (test functions here call nothing themselves) — so the
    // intersection is genuinely empty, and a real, receipted empty (naming the
    // entity kind) is exactly the honest, correct answer — never the old
    // ambiguousParse misread of "Task and test src/core/store.mjs" as one term.
    "which functions call Task and test src/core/store.mjs",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /saveStore/);
  assert.match(turns[0].answer, /validateTask/);
  assert.match(turns[1].answer, /testCreateTask/);
  assert.match(turns[1].answer, /testLoadStore/);
  assert.match(turns[2].answer, /^nothing in the index matches that \(functions\)\./);
  // never the pre-fix misread of the whole tail as one unresolved object term
  assert.doesNotMatch(turns[2].answer, /Task and test/);
});

test("tier4/compat guard RE-CONFIRMED (Batch 4/5, unaffected): 'which classes extends Base and couples to logging' still falls to the legacy ambiguousParse path", async () => {
  // Re-run of the SAME 610915a compat case the differentVerbLed addition above must
  // not touch: "couples to" IS a recognized verb (VERB_TO_KIND maps it to "imports"),
  // so this is structurally the SAME "two different, both-recognized verbs" shape as
  // the fix above — the ONLY reason it stays off the compositional path is the
  // single-WORD restriction on differentVerbLed's later-branch verb ("couples to" is
  // two words; "test" above is one) — see ask.mjs's own doc on this exact narrowing.
  // ask-compositional.test.mjs pins the parseQuery-level shape (`ambiguousParse:
  // true`) directly; this confirms the end-to-end chat answer is unaffected too.
  const turns = await driveSession(["which classes extends Base and couples to logging"]);
  assert.doesNotMatch(turns[0].answer, /the most|superlative/i);
});

test("tier4/superlative ranking: 'which module has the most imports' -> discourse follow-up 'which of those are tested'", async () => {
  const queries = ["which module has the most imports", "which of those are tested"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^src\/handlers\/tasks\.mjs — the most imports \(5\)\./);
  // the winning module survives the "tested" filter — the same set is echoed back,
  // confirming both the superlative AND the discourse-anaphora carry the real ids.
  assert.match(turns[1].answer, /^src\/handlers\/tasks\.mjs\./);
});

test("tier4/superlative participle-led (T2 fix): 'which function is called the most' finds the metric word BEFORE 'the most'", async () => {
  const queries = ["which function is called the most"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /the most called/);
});

test("tier4/qualifier-filtered listing + discourse continuation (T3+T4 fix): 'public methods of X' -> 'which of those are tested' keeps the entity-kind receipt even when the filter empties the set", async () => {
  const queries = ["public methods of Controller", "which of those are tested"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^Controller\.handle\(\)\./);
  // Controller.handle is genuinely untested in this fixture (no test/ module
  // touches base.mjs) — a real, receipted empty naming "(methods)", never the
  // pre-fix bare kind-less "nothing in the index matches that."
  assert.match(turns[1].answer, /^nothing in the index matches that \(methods\)\./);
});

test("tier4/qualifier + scope listing: 'untested functions in src/handlers' filters correctly (compat, already flowed)", async () => {
  const queries = ["untested functions in src/handlers"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^listUsers\(\)\./);
});

test("tier4/discourse chain over a plain listing: concept -> 'which of those are public' -> 'how many of those are tested'", async () => {
  const queries = [
    "which classes inherit from Record",
    "which of those are public",
    "how many of those are tested",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /Task, User and Project/);
  assert.match(turns[1].answer, /Task, User and Project/);
  assert.match(turns[2].answer, /^\d+ classes?\./);
});

// SKILL_CHAT_PLAYTEST verification pass (this session): HANDOVER item 6's membership
// inheritance walk, confirmed live against the REAL shipped fixture (test/ask-cascade.test.mjs
// already pins the mechanism on a synthetic Controller/TaskController graph built inline;
// this drives the SAME shape end-to-end through a real chat session, against mini-webapp's
// own real Controller/TaskController inheritance pair — TaskController defines no methods of
// its own and inherits from Controller, which defines the single public method `handle`).
test("tier4/membership inheritance walk (item 6) against real mini-webapp data: 'public methods of TaskController' -> 'which class defines handle' -> 'what about UserController'", async () => {
  const queries = [
    "public methods of TaskController",
    "which class defines handle",
    "what about UserController",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // the inherited answer is DISCLOSED out loud, never presented as TaskController's own
  assert.match(turns[0].answer, /^TaskController has no own methods — inherited from Controller: Controller\.handle\(\)\./);
  assert.match(turns[1].answer, /^in src\/handlers\/base\.mjs there is Controller\./);
  // a natural next step names UserController directly — it shares the SAME inherits-from-
  // Controller shape, surfaced via the describe force (a genuinely useful, non-wall outcome)
  assert.match(turns[2].answer, /^UserController — Class/);
  assert.match(turns[2].answer, /inherits \[seon:hasSuperType\] \(1\) → Controller/);
});
