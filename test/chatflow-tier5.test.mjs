// chatflow-tier5.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts, genuine
// Tier 5 ("teach + recall + reasoning in dialogue" — §3: "assert a fact
// mid-conversation, recall it later, mix with graph truth; the honest 'I
// don't know that yet' that offers to learn").
//
// This tier's territory heavily overlapped this session's own EARLIER
// teach/recall shipping (general verb-to-predicate teaching, new-term
// teaching, quantifiers, "what is in your memory" — see HANDOVER.md items
// 2-7/Bugs A-F) — those are treated here as ALREADY-SHIPPED capabilities
// being woven into natural conversation, not re-discovered. This pass found
// SIX further dead-ends, all routing/recognition fixes to those existing
// capabilities, none a new grammar rule:
//
//   T1  "what do you know about X" (KNOW_ABOUT_RE, chat.mjs's factAnswer)
//       genuinely missed a just-taught multi-word-subject fact the moment
//       the query used a LEADING ARTICLE ("about the logger") or SHORTENED
//       the subject to its head word ("about logger" for a fact taught as
//       "logger module"). Root cause (1): normFactTerm (memory/core.mjs)
//       never stripped a leading "the"/"a"/"an" — every recall regex in this
//       file calls factTermVariants -> normFactTerm on its raw captured term
//       with no article-strip of its own, so fixing it ONCE there closed the
//       gap everywhere (WHO_OWNS_RE, ISA_ASK_RE, GENERAL_VERB_*, …), not just
//       here. Root cause (2): exact-variant matching alone can't bridge
//       "logger" against a stored "logger module" — a word-overlap fallback
//       (whole word, length >= 4, tried ONLY when the exact pass finds
//       nothing) closes it, mirroring resolveObject's own established
//       length-floor discipline.
//   T2  A frequency ADVERB between a bare-name subject and the real verb
//       ("TaskController usually needs review" — the operator's OWN example
//       phrase) mis-split subject="TaskController", VERB="usually" in
//       GENERAL_VERB_TEACH_RE, minting a nonsense mgx:usually predicate and
//       garbling the confirmation itself ("taskcontroller usuallies needs
//       review" — thirdPersonSingularSurface's naive fallback appended an
//       "-ies"). Fixed with a closed, non-capturing adverb-skip reused by
//       GENERAL_VERB_TEACH_RE and its query-side twins (GENERAL_VERB_YESNO_RE/
//       GENERAL_VERB_OPEN_RE) — recognition stays closed, only the skip-set is
//       new, same "recognition closed, mapping generalized" split this file's
//       general-verb mechanism already uses.
//   T3  "<Name> maintains <a short noun phrase>" ("margo maintains the tasks
//       handler") WALLED entirely — OWNS_TEACH_RE's object was a
//       single-token-only capture, and generalVerbTeach explicitly stands
//       down for "owns"/"maintains" ANYWHERE in the sentence (deferring to
//       OWNS_TEACH_RE), so neither recognizer ever stored the fact. Widened
//       OWNS_TEACH_RE's object to a short lazy multi-word capture (T1's
//       normFactTerm article-strip handles "the tasks handler" ==
//       "tasks handler" for free). A SEPARATE gap surfaced alongside: no
//       yes/no reader existed for a specific ownership CLAIM at all ("does
//       margo maintain the tasks handler") — only the OPEN "who
//       owns/maintains X" form did. Added OWNS_YESNO_RE, closed-world "no" on
//       a genuine non-match (mirrors the general-verb yes/no reader's own
//       convention), "yes" cited on a hit.
//   T4  A taught ADJECTIVE property fact ("the logger module is deprecated")
//       had NO direct-question reader at all ("is the logger deprecated" /
//       "is it deprecated") — only presuppositionNudge's own narrow "why does
//       X still Y" embedded this same mgx:hasProperty check. Added
//       IS_ADJECTIVE_YESNO_RE (factReadBack), deliberately silent-on-miss
//       (never a fabricated closed-world "no" — a bare copula is the most
//       common CASUAL English shape, unlike the owns/general-verb yes/no
//       forms), with the SAME T1 word-overlap fallback for a multi-word
//       subject, and anaphora ("it"/"this"/"that") resolved against the
//       session's live FOCUS. Needed a second fix alongside: this shape is
//       exactly 3 words ("is it deprecated") with no code-ish token, so
//       isConversationalCandidate's text-only heuristic would otherwise win
//       the race and claim the turn before factReadBack ever got a look —
//       the SAME class of bug BUG 2 (chat.mjs, "what is john") fixed for
//       bare-meta fact lookups; widened that exemption's gate to also try
//       IS_ADJECTIVE_YESNO_RE shapes, diverting ONLY when a real fact hits.
//   T5  A genuinely-unknown-everywhere "what is X" miss (not a real graph
//       entity, not a schema term, not in memory either) fell to a bare wall
//       — SKILL_CHAT_PLAYTEST.md §0 names "'X' isn't a term in this graph's
//       own vocabulary" as its own dead-end example, and Tier 5 (§3)
//       explicitly wants "the honest 'I don't know that yet' that offers to
//       learn". Added a TEACH-OFFER, appended (never replacing) under the
//       existing miss text. Found + fixed live while verifying the offer
//       itself (SKILL_CHAT_PLAYTEST.md §4's "verify every offered example"
//       rule): a 2-word term's suggested BARE "X is a Y" example failed
//       (BARE_DECLARATIVE_RE's own bare-unwrapped path is single-token-subject
//       only), so the offer is worded by word count — 1 word offers both the
//       bare and "remember" forms, 2 words offers only the (now-widened,
//       T3-sibling) "remember" form, 3+ words offers no unverifiable concrete
//       example at all, only the honest general nudge.
//
// CYCLE 2 (this pass found real fixable dead-ends in cycle 1, so it ratcheted
// per SKILL_CHAT_PLAYTEST.md §1 Step 7): three more dead-ends, all sibling
// gaps of the cycle-1 fixes above, found from fresh entry points (passive
// ownership phrasing, a quantifier+property mix, and a genuinely-first-ever
// question with zero facts in memory at all):
//
//   T6  "<X> is owned by <Name>" (the PASSIVE ownership phrasing — at least
//       as natural as the active "<Name> owns <X>" T3 fixed) had NO
//       recognizer at all, teach or read: "TaskController is owned by sam"
//       WALLED entirely (generalVerbTeach stands down on "is" appearing
//       anywhere, and no frame recognized the passive shape). Added
//       OWNS_PASSIVE_TEACH_RE (teach) and OWNS_PASSIVE_YESNO_RE (read,
//       matched BEFORE IS_ADJECTIVE_YESNO_RE — which would otherwise ALSO
//       backtrack-match this shape and silently decline) — both store/read
//       the SAME OWNED_BY_PREDICATE shape T3's active forms use, so "who
//       owns X" answers either phrasing identically.
//   T7  "some functions are risky" — Y ("risky") isn't a lexicon NOUN, so
//       SOME_A_FEW_RE's own subclass-only path correctly declined it, but
//       the sentence then fell through to TEACH_PROPERTY_RE (which has NO
//       vocabulary gate on its complement at all), silently mis-teaching the
//       LITERAL 2-word string "some functions" as a proper-noun subject
//       ("noted — remembered: some functions is risky" — a quantifier word
//       baked wrongly into the subject, plus a subject/verb agreement
//       error). A quantified PROPERTY claim isn't a supported shape (only a
//       quantified SUBCLASS claim is) — now honestly declines with a
//       specific, guiding explanation instead of silently mis-teaching.
//   T8  "is the checkout flow deprecated" as someone's genuinely FIRST
//       question (zero facts in memory at all yet) fell to the raw
//       structural wall — the exact "honest 'I don't know that yet' offers
//       to learn" case Tier 5 (§3) itself names, but IS_ADJECTIVE_YESNO_RE's
//       own "subject completely unknown" TEACH-OFFER (T4) never got a
//       chance, because factReadBack's `!rows.length` fast-path bails out
//       before that code even runs when memory is TRULY empty. Special-
//       cased ahead of that bail-out — narrowly: excludes ISA_ASK_RE matches
//       and a leading "there" (existential, not a named subject), found live
//       via two real regressions on the FIRST attempt at this fix ("is a
//       zebra a mammal" and "is there anything bigger" both syntactically
//       match IS_ADJECTIVE_YESNO_RE's unrestricted backtracking too, and
//       both already have a correct, MORE SPECIFIC answer elsewhere that an
//       unguarded teach-offer would have silently pre-empted).
//
// Driven against the SHIPPED examples/mini-webapp graph via `ephemeral: true`
// (chat.mjs's createSession) — same mechanism test/chatflow-tier4.test.mjs
// relies on: reads the real graph, writes session/provenance state to a
// throwaway temp dir, so the committed fixture is never touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const WALL = /couldn't parse this as a graph question/;
const VOCAB_MISS = /isn't a term in this graph's own vocabulary/;
const DEAD_END = new RegExp([WALL, VOCAB_MISS].map((r) => r.source).join("|"));

const REPO = new URL("../examples/mini-webapp", import.meta.url).pathname;

async function driveSession(queries) {
  clearCache();
  const s = await createSession({ repoPath: REPO, env: {}, ephemeral: true });
  const turns = [];
  try {
    for (const q of queries) turns.push(await s.turn(q));
  } finally {
    await s.close();
  }
  return turns;
}

// A dead-end here is a BARE wall/vocab-miss with NOTHING else in the answer —
// every fixed lane in this file APPENDS a nudge/offer alongside a standing
// miss rather than fabricating a hit, so "flow" for a genuine miss means the
// wall/vocab-miss text is followed by more (a teach-offer, a fact, a receipt),
// never standing completely alone.
function assertNeverBareWall(turns, queries) {
  for (const [i, t] of turns.entries()) {
    if (DEAD_END.test(t.answer)) {
      assert.notEqual(
        t.answer.trim().split("\n").length, 1,
        `turn ${i} "${queries[i]}" is a BARE wall/vocab-miss with no nudge: ${t.answer.slice(0, 160)}`,
      );
    }
  }
}

test("tier5/teach + recall a multi-word-subject fact, mixed with real graph structure (T1 fix)", async () => {
  const queries = [
    "hi",
    "remember that the logger module is deprecated",
    "what do you know about the logger",
    "what do you know about logger",
    "what calls the logger",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[1].answer, /^noted — remembered: logger module is deprecated/);
  // "the logger" (article-led) and "logger" (head-word only) BOTH recall the
  // fact taught as "logger module" — T1's normFactTerm article-strip + the
  // word-overlap fallback, respectively.
  assert.match(turns[2].answer, /1 remembered fact about the logger:\n\s+you told me: logger module is deprecated/);
  assert.match(turns[3].answer, /1 remembered fact about logger:\n\s+you told me: logger module is deprecated/);
  // real graph structure alongside the taught fact — an honest, receipted
  // empty (this fixture's logger module genuinely has zero callers), not a
  // dead-end.
  assert.match(turns[4].answer, /No modules found whose module directly calls logger\./);
});

test("tier5/adjective property recall: 'is X deprecated' + anaphora once focus is set (T4 fix)", async () => {
  const queries = [
    "remember that the logger module is deprecated",
    "is the logger deprecated",
    "is the logger fast",
    "what calls the logger",
    "is it deprecated",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[1].answer, /^yes — you told me: logger module is deprecated/);
  // no fact says "fast" — an honest, NAMED receipt (never a fabricated
  // closed-world "no" truth-claim, and never a bare wall either): the subject
  // is known (it has a deprecated-fact), just not under THIS property.
  assert.match(turns[2].answer, /^I don't have a fact saying the logger is fast\./);
  assert.match(turns[3].answer, /No modules found whose module directly calls logger\./);
  // "it" now resolves against the focus "what calls the logger" set (Logger)
  assert.match(turns[4].answer, /^yes — you told me: logger module is deprecated/);
});

test("tier5/adverb-led teach (T2 fix): 'X usually needs Y' teaches cleanly, never the garbled 'usuallies' misparse", async () => {
  const queries = [
    "remember that TaskController usually needs review",
    "what do you know about TaskController",
    "does TaskController usually need review",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[0].answer, /^noted — remembered: taskcontroller needs review/);
  assert.doesNotMatch(turns[0].answer, /usuallies/);
  assert.match(turns[1].answer, /1 remembered fact about taskcontroller:\n\s+you told me: taskcontroller needs review/);
  assert.match(turns[2].answer, /^yes — you told me: taskcontroller needs review/);
});

test("tier5/ownership teach with a multi-word object + yes/no + who-owns read-back (T3 fix)", async () => {
  const queries = [
    "remember that margo maintains the tasks handler",
    "which modules import src/core/model.mjs",
    "does margo maintain the tasks handler",
    "does sam maintain the tasks handler",
    "who maintains the tasks handler",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[0].answer, /^noted — remembered: tasks handler is owned by margo/);
  // an unrelated real graph question in between — recall doesn't decay
  assert.match(turns[1].answer, /src\/core\/store\.mjs and src\/core\/validate\.mjs/);
  assert.match(turns[2].answer, /^yes — you told me: tasks handler is owned by margo/);
  assert.match(turns[3].answer, /^no — no remembered fact says sam owns\/maintains the tasks handler\./);
  assert.match(turns[4].answer, /you told me: tasks handler is owned by margo/);
});

test("tier5/new single-word term teach ('redis is a cache') recalls cleanly across an unrelated graph question (compat, already flowed)", async () => {
  const queries = [
    "remember that redis is a cache",
    "what is redis",
    "what calls saveStore",
    "what do you know about redis",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[0].answer, /^noted — remembered: redis is a kind of cache/);
  assert.match(turns[1].answer, /^you told me: redis is a kind of cache/);
  assert.match(turns[2].answer, /in src\/handlers\/tasks\.mjs there is function createTask\(\)\./);
  assert.match(turns[3].answer, /1 remembered fact about redis:\n\s+you told me: redis is a kind of cache/);
});

test("tier5/honest 'I don't know that yet' offers to learn, and the offered example is verified in-state (T5 fix)", async () => {
  const queries = [
    "what is a vulcan gizmo",
    "remember vulcan gizmo is a tool",
    "what is a vulcan gizmo",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[0].answer, VOCAB_MISS);
  // the offer names a phrasing that ACTUALLY WORKS (2-word subject -> only the
  // "remember" form is offered, never the bare unwrapped form that would fail).
  assert.match(turns[0].answer, /I don't know "vulcan gizmo" yet — teach me directly, e\.g\. "remember vulcan gizmo is a <thing>"\./);
  assert.doesNotMatch(turns[0].answer, /"vulcan gizmo is a <thing>" or/);
  assert.match(turns[1].answer, /^noted — remembered: vulcan gizmo is a kind of tool/);
  assert.match(turns[2].answer, /^you told me: vulcan gizmo is a kind of tool/);
});

test("tier5/a single-word unknown term's teach-offer still names BOTH the bare and wrapped forms (T5, word-count branch)", async () => {
  const turns = await driveSession(["what is a widgetzz"]);
  assertNeverBareWall(turns, ["what is a widgetzz"]);
  assert.match(turns[0].answer, /I don't know "widgetzz" yet — teach me directly, e\.g\. "widgetzz is a <thing>" or "remember widgetzz is a <thing>"\./);
});

// ---- CYCLE 2 ----

test("tier5/passive ownership teach + yes/no + who-owns read-back, alongside the active form (T6 fix)", async () => {
  const queries = [
    "remember that TaskController is owned by sam",
    "who owns TaskController",
    "is TaskController owned by sam",
    "is TaskController owned by margo",
    "does sam own TaskController",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[0].answer, /^noted — remembered: taskcontroller is owned by sam/);
  assert.match(turns[1].answer, /you told me: taskcontroller is owned by sam/);
  assert.match(turns[2].answer, /^yes — you told me: taskcontroller is owned by sam/);
  assert.match(turns[3].answer, /^no — no remembered fact says taskcontroller is owned by margo\./);
  // the ACTIVE yes/no form (T3) reads back the SAME fact the passive form taught
  assert.match(turns[4].answer, /^yes — you told me: taskcontroller is owned by sam/);
});

test("tier5/a quantified PROPERTY claim ('some Xs are Y-adjective') declines honestly instead of mis-teaching a garbled fact (T7 fix)", async () => {
  const queries = [
    "remember that some functions are risky",
    "remember that some bugs are issues",
    "remember that saveStore is risky",
    "is saveStore risky",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  // never the pre-fix mis-teach ("noted — remembered: some functions is risky")
  assert.doesNotMatch(turns[0].answer, /^noted —/);
  assert.match(turns[0].answer, /isn't a shape I can store yet/);
  // the quantified SUBCLASS shape (an object that IS a lexicon noun) is unaffected
  assert.match(turns[1].answer, /^noted — remembered: bug is a kind of issue/);
  // naming ONE specific entity (never a quantifier) still teaches + reads back
  // cleanly, exactly as the decline message itself suggests
  assert.match(turns[2].answer, /^noted — remembered: savestore is risky/);
  assert.match(turns[3].answer, /^yes — you told me: savestore is risky/);
});

test("tier5/a genuinely first-ever 'is X <adjective>' question (zero facts in memory) offers to learn, never a bare wall (T8 fix)", async () => {
  const queries = [
    "is the checkout flow deprecated",
    "remember that checkout flow is deprecated",
    "is the checkout flow deprecated",
  ];
  const turns = await driveSession(queries);
  assertNeverBareWall(turns, queries);
  assert.match(turns[0].answer, /^I don't know anything about "the checkout flow" yet — teach me directly, e\.g\. "remember that the checkout flow is deprecated"\./);
  assert.match(turns[1].answer, /^noted — remembered: checkout flow is deprecated/);
  assert.match(turns[2].answer, /^yes — you told me: checkout flow is deprecated/);
});

test("tier5/T8's empty-memory special-case never pre-empts a DIFFERENT, more specific honest miss (compat guard)", async () => {
  // "is a zebra a mammal" is ISA_ASK_RE's own territory (a genuine "is a <X> a
  // <kind>" shape) — IS_ADJECTIVE_YESNO_RE's unrestricted backtracking would
  // ALSO syntactically match this (subject="a zebra a", adjective="mammal")
  // with zero facts in memory; T8's own fix explicitly excludes ISA_ASK_RE
  // matches so the ORIGINAL, correct wall stands, never a confusing teach-offer
  // about the nonsensical literal fragment "a zebra a".
  const turns = await driveSession(["is a zebra a mammal"]);
  assert.match(turns[0].answer, WALL);
  assert.doesNotMatch(turns[0].answer, /teach me directly/);
});
