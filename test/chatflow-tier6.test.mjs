// chatflow-tier6.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts, Tier 6
// ("the messy real user" — §3: "typos, politeness frames, topic switches, 'no
// wait', vague openers, 'what can you tell me about this repo' — the
// conversation a stranger actually has"), run alongside §3b (the surface-
// variation axis: dialect/register/typo/ESL variation of ALREADY-recognized
// intents) per this tier's own instruction to treat them as one pass. This is
// the LAST rung of the SKILL_CHAT_PLAYTEST.md ladder (Tiers 0-6).
//
// CYCLE 1 found nine dead-ends, all routing/recognition fixes to existing
// capabilities (structural queries, the relation concept force, orientation),
// none a new grammar rule or general fuzzy loosening:
//
//   T1  GRAIN-WORD RESOLUTION AMBIGUITY: "the logger module"/"describe the
//       Task class" — a human reads a trailing "module"/"class"/"function"/
//       "method" as a TYPE HINT that fully disambiguates a term ("the logger
//       MODULE", not the Logger class), but resolveObject's plain word-overlap
//       tier (ask.mjs) can't read grammatical role — "logger" alone overlapped
//       equally with mod:src/lib/logger.mjs, fn:...#Logger, and fn:...#Logger.info
//       once "module"/"the" matched nothing, so resolveEntity's own
//       !ambiguous gate silently declined the whole turn (moduleOrientLane,
//       "describe X", "where is X defined" all walled). Fixed centrally:
//       resolveObject (ask.mjs) now strips a leading article and, when a
//       trailing ENTITY_TO_TYPE grain word is present, retries narrowed to
//       that ONE class first — safe by construction (narrowing a pool can
//       only ever REDUCE ambiguity, never introduce it), falling through
//       unchanged to the original full-term resolution on any miss. A SEPARATE
//       rescue (describeGrainRescue, chat.mjs) was needed for dispatchTool's
//       "describe" tool, which resolves its `symbol` arg via codegraph.mjs's
//       resolveSymbol — a different, simpler matcher with no article/grain
//       tolerance at all. A first attempt routed describeWrapperAnswer's free
//       text through the general resolveEntity/resolveObject cascade instead —
//       reverted live after test/sessions.test.mjs's own transcript guard
//       caught a REAL regression: resolveObject's tier-3 ANY-overlap fallback
//       (tuned for near-path/near-symbol terms) matched "tell me A JOKE" to a
//       fixture module literally named "a.mjs" off the shared one-character
//       token "a" alone — the exact "fuzzy/typo tolerance returns the WRONG
//       thing" collision class this tier's own instructions warned about.
//       describeGrainRescue is scoped down to ONLY ever fire when an explicit
//       trailing grain word is present (no grain word -> no rescue attempt at
//       all, term untouched) — "tell me a joke" is unaffected either way.
//   T2  moduleOrientLane (chat.mjs, "what does X do"/"whats X for") read the
//       ORIGINAL un-normalized query text and ran neither of the two general
//       normalization passes the rest of the file already uses for this exact
//       noise class: correctMisspellings (so "waht dose the logger modul do"
//       — every one of those three typos already lives in ask-vocab.mjs's
//       MISSPELLINGS table — never even got a chance) and applyPreambleFrames
//       (so "scratch that, what does X do" left the topic-switch marker
//       standing). Also added a lane-local politeness-prefix strip for
//       "please/kindly explain X" specifically: normalize.mjs's own
//       EXPLAIN_WRAPPER_RE requires the string to literally START with
//       "explain", so a leading "please " defeats it.
//   T3  "what abut imports" (a one-letter-dropped typo of "about" — a real
//       English word on its own, so it can't live in the shared MISSPELLINGS
//       table per test/ask-vocab.test.mjs's own "every value must be grammar-
//       owned" invariant) searched for a module literally named "abut"
//       instead of reading as the relation concept force's own "what about
//       imports" vague touch. Fixed the same way VAGUE_TOUCH_TEL_RE already
//       fixes "tel"->"tell" for this exact lane: a lane-scoped word-boundary
//       replace, not a shared table entry.
//   T4  VAGUE OPENERS: "what can you tell me about this repo", "tell me
//       something interesting about this repo", "so, what is going on in this
//       codebase" — §3's own named example phrases — fell to the raw grammar
//       wall outright (isConversational's ≤3-word/no-codeish catch-all never
//       claims an 8-word sentence) even though orientationAnswer is exactly
//       the right answer, the same one CAPABILITY_PHRASES' other entries
//       already reach. Three new closed CAPABILITY_PHRASES entries.
//   T5  TOPIC-SWITCH / SELF-INTERRUPTION preambles: "actually never mind, what
//       calls X", "no wait, I meant what calls Y", "hold on, where is Z
//       defined", "scratch that, what does X do" (§3's own "no wait", topic
//       switches). New TOPIC_SWITCH_PREAMBLE_RE (normalize.mjs's
//       applyPreambleFrames) — a closed, chainable marker set (peels a STACK
//       of markers in one pass, unlike LEADING_CONNECTIVE_RE's single word),
//       unconditional like GREETING/THANKS_PREAMBLE_RE (none of these markers
//       is grammar-owned vocabulary). Distinct from SELF_CORRECTION_RE (same
//       file): that shape requires an explicit "sorry"/"i mean" marker WITH a
//       mandatory trailing delimiter, modeling a mid-sentence restart with
//       real text on both sides; this one is a standalone marker at the very
//       start with an OPTIONAL delimiter (colloquial speech drops the comma).
//   T6  ACKNOWLEDGEMENT preambles: "ok cool, what about the TaskController" —
//       a drill-down politely acknowledging the previous answer before the
//       next question. New ACK_PREAMBLE_RE (normalize.mjs), sibling of
//       GREETING/THANKS_PREAMBLE_RE for the "ok"/"cool" word family.
//   T7  describeWrapperAnswer (chat.mjs, the LAST-RESORT "describe X"/"what
//       about X" rescue lane) tested its own DESCRIBE_WRAPPER_RE against the
//       RAW query, never running applyPreambleFrames first — so "ok cool,
//       what about the TaskController" (T6's own preamble, already stripped
//       by an EARLIER lane that then correctly declined since TaskController
//       isn't an enumerable relation) reappeared here unstripped and broke the
//       anchor. Also added a leading-article-only strip (no grain word
//       needed) for the general case: "what about the TaskController" bare
//       — resolveSymbol has no word-overlap tier at all, so stripping "the "
//       is pure noise removal with no new collision risk, unlike T1's fix.
//   T8  HEAVY POLITENESS/HEDGING STACKS (§3's own example phrase): "could you
//       maybe possibly tell me, if its not too much trouble, what saveStore
//       does" — three new closed frames in normalize.mjs: HEDGE_ADVERB_PREAMBLE_RE
//       ("maybe possibly" — unconditional, no delimiter required, a hedge
//       adverb modifies the verb it precedes directly), TROUBLE_ASIDE_RE (a
//       genuine mid-sentence PARENTHETICAL — "if it's not too much trouble/
//       bother/hassle" — stripped wherever it appears, unlike every other
//       frame here which is start-anchored), and TELL_ME_WRAPPER_RE ("tell me
//       <Q>" -> "<Q>", gated on an interrogative-lead remainder so "tell me
//       about X" — a DIFFERENT, already-working shape owned elsewhere — is
//       never touched).
//   T9  SUBJECT-FIRST word order: "what saveStore does" (vs "what DOES
//       saveStore do") — a perfectly natural alternate phrasing of the SAME
//       already-recognized intent (§3b's own territory) that MODULE_ORIENT_RE's
//       anchor never covered. New MODULE_ORIENT_SVO_RE, tried only after the
//       other two shapes miss; safe because the entity-resolution gate (a
//       real, UNIQUE graph entity or the lane declines) still stands guard —
//       a syntactic match against a non-entity term simply falls through.
//
// Four full conversations replayed clean afterward (zero dead-ends, every
// turn either answers or nudges) — frozen below. One garbled-but-harmless
// non-fatal residual noted, NOT fixed (a genuine low-priority rough edge, not
// a dead end): "you are what able to tell me" (an ESL-garbled mix of an
// identity question and a capability question) mis-routes to the teach lane
// and declines with "I can't store a fact about 'you' as a class" — a real,
// honest, GUIDING decline (never a bare wall, never a fabrication), just not
// the ideal answer to what was actually asked. Left as-is: the phrasing is
// genuinely ambiguous even to a human reader, and forcing a specific route
// would be exactly the kind of guess this project's discipline forbids.
//
// CYCLE 2 (this pass found real fixable dead-ends in cycle 1, so it ratcheted
// per SKILL_CHAT_PLAYTEST.md §1 Step 7): eight more dead-ends, all sibling
// gaps of cycle 1's own preamble-frame mechanism plus two standalone typo/
// vocabulary fixes, found from fresh entry points (more dialect/register
// variation, ESL-shaped self-correction, and the teach lane's own preamble
// blind spot):
//
//   T10 "yeah nah, what does the router do" — the AU/NZ discourse opener
//       chat.mjs's own GREET closed set already recognizes BARE, but had no
//       PREAMBLE (fused lead-in) form at all, the exact gap g'day's own fix
//       closed in an earlier session for that same dialect. Added to
//       GREETING_PREAMBLE_RE (normalize.mjs).
//   T11 "howdy pardner, remember that X" — "howdy" alone already matched, but
//       a VOCATIVE word right after it ("pardner", US-Western register) sat
//       between the greeting and its delimiter, where only the literal word
//       "there" was tolerated. Widened GREETING_PREAMBLE_RE's vocative group
//       to a small closed set (pardner/folks/friend/mate).
//   T12 "ta for that" — "cheers for that" was already in chat.mjs's THANKS
//       set, but its "ta" sibling (both dropped-word forms of "thanks for
//       that") was missing, so it fell to the generic orientation card via
//       isConversational's ≤3-word catch-all instead of a thanks reply.
//   T13 Three more vague-opener idioms, same family as cycle 1's T4: "walk me
//       through this codebase", "what's the big picture (here)", "give me the
//       lay of the land" — new CAPABILITY_PHRASES entries.
//   T14 CAPABILITY_PHRASES' vague-opener entries are self-contained closed
//       regexes, but a preamble ahead of one ("right, can you walk me through
//       this codebase" — an ACK_PREAMBLE_RE + MODAL_WRAPPER_RE stack) was
//       tested nowhere upstream of conversationalTurn's own raw-text check,
//       unlike vagueTouchTermOf/describeWrapperAnswer (both already run
//       applyPreambleFrames first, per cycle 1's T7). Now tries the SAME
//       closed set again against the preamble-stripped text too — purely
//       additive, can only ADD a match, never remove one.
//   T15 "hwo many classes are there" (a transposed-letter typo of "how") lost
//       the aggregate/list trigger entirely, same failure class as the
//       existing "manyn"/"mnay" entries one word to the right of it in
//       ask-vocab.mjs's MISSPELLINGS table — "how" is grammar-owned via
//       AGGREGATE_TRIGGERS' own "how many"/"how much" multi-word entries.
//   T16 teachLane (chat.mjs) read the raw, un-normalized query and never ran
//       applyPreambleFrames at all, so ANY closed discourse-marker preamble
//       ahead of a teach sentence corrupted TEACH_RE's own match ("howdy
//       pardner, remember that TaskController is fragile" walled outright).
//       Verified safe against this lane's own extensive test corpus before
//       landing (none of applyPreambleFrames' frames match ordinary teach
//       phrasing) — confirmed empirically by the full suite staying green.
//   T17 factReadBack's own qHedge hedge-adverb strip (Tier 5's own fix for
//       "actually"/"really"/"honestly") didn't cover "yeah nah" — the exact
//       T10 dialect gap, just reached through a different lane (a yes/no
//       property read-back rather than a module-purpose overview). Widened
//       the SAME narrow, lane-scoped hedge set rather than routing through
//       applyPreambleFrames (which doesn't know "really"/"honestly" either,
//       and this lane's own Tier 5 precedent deliberately keeps its hedge set
//       separate from the broader preamble mechanism).
//
// One near-miss caught and reverted live during this cycle: widening
// SELF_CORRECTION_RE's own trailing delimiter to be optional (to catch "what
// calls listTasks -- oh wait, i mean createTask", no comma after "i mean")
// looked promising in isolation but broke this EXACT object-only-restart case
// worse than before — the regex's `.+?` prefix discards the whole verb clause
// ("what calls"), not just the abandoned object, so the fix reduced the query
// to a bare noun with no verb at all (a hard wall) instead of the honest
// "did you mean listTasks or createTask?" ambiguity nudge the UNCHANGED regex
// already gives (a real candidate list including the correct answer — an
// acceptable FLOW under §0/§2, not a dead end). Reverted; left as a named,
// narrower ceiling (see SELF_CORRECTION_RE's own updated docblock) rather than
// risk widening a proven, tested regex for a net-negative outcome.
//
// Three more full conversations replayed clean afterward — frozen below.
//
// CYCLE 3 (ratcheting again — cycle 2 found real fixable dead-ends): four more
// fixes, plus one genuine ceiling named:
//
//   T18 BARE "inherits"/"inherit" (no "from"): "TaskController inherits what",
//       "does TaskController inherit Controller" — this list's own SIBLING verb
//       "extends"/"extend" already worked bare, with no "from" required, but
//       "inherits"/"inherit" (arguably the MORE common everyday phrasing of
//       the two) had NO bare form at all in RELATIONS.inherits.verbs
//       (ask-vocab.mjs), only "inherits from"/"inherit from". Added both bare
//       forms; VERB_ALT's existing longest-first sort means the "... from"
//       forms still win whenever "from" actually follows, so this is purely
//       additive — verified against the full suite (no test relied on bare
//       "inherits" NOT parsing).
//   T19 "so what've we got here" / "just poking around, what's in this repo" —
//       two more vague-opener idioms (§3's own family, cycle 1/2's T4/T13
//       siblings): a new CAPABILITY_PHRASES entry for the casual "what've we
//       got here", plus a NEW preamble frame (BROWSING_PREAMBLE_RE,
//       normalize.mjs — "just poking around/browsing/exploring/looking
//       around, X") and a new CAPABILITY_PHRASES entry for "what's in this
//       repo/codebase" specifically (genuinely ambiguous with the real
//       members/containment "what's in <X>" grammar for any OTHER term, so
//       closed to the SAME self-referential noun set META_ORIENT_RE already
//       uses — a real module/class literally named "repo"/"codebase" is never
//       at risk).
//
// Genuine ceiling, NOT fixed: "the Task class extends what CLASS" (a
// REDUNDANT trailing type-word after the WH-word "what") mis-parses "class"
// itself as the literal object term to resolve ("no entity named 'class'"),
// because "class"/"module"/"function" aren't in PLACEHOLDER_NOUNS the way
// "something"/"anything" are — teaching the reverse-inherits parse to treat a
// trailing entity-type noun after "what" as a TYPE FILTER rather than a
// literal object name is a real grammar feature (recognizing "what class"
// as a typed placeholder), not a routing fix, and out of this tier's
// closed-set-addition scope. The un-redundant, more common phrasing ("the
// Task class extends what", no trailing "class") already works cleanly.
//
// Two more full conversations replayed clean afterward — frozen below.
//
// CYCLE 4: two more fixes, one of them the most important of this whole
// dispatch — a real WRONG-ANSWER bug (a genuine structural answer silently
// DISCARDED), not a routing gap:
//
//   T20 CRITICAL: "is the logger module tested" / "is logger tested" answered
//       "I don't know anything about 'logger' yet — teach me directly" — a
//       genuinely misleading response, because ask()'s OWN structural grammar
//       had ALREADY correctly parsed and traversed this as a real "tests"
//       reverse-relation question (shape=reverse kind=tests) and produced an
//       honest structural answer ("No tests cover logger", exactly what "what
//       tests cover logger" already answers correctly). Root cause:
//       IS_ADJECTIVE_YESNO_RE's own unrestricted backtracking (a recurring
//       risk this file's own docblocks already flag — see the ISA_ASK_RE/"is
//       there" exclusions found the same way) ALSO matches "tested" as if it
//       were a free-form property adjective, and factReadBack's three
//       "unknown property" branches (the empty-memory teach-offer, the
//       known-subject-wrong-property receipt, and the non-empty-rows
//       teach-offer) all fired UNCONDITIONALLY, discarding the real
//       structural answer regardless of whether one already existed. But
//       "tested"/"covered" (PASSIVE_PARTICIPLE_TO_KIND, ask-vocab.mjs) have
//       genuine graph-computable meaning, unlike "deprecated"/"fragile" (this
//       branch's own ORIGINAL Tier-5 T8 target, which has none). Fixed by
//       gating all three branches on `!envelope?.parsed` — when ask()'s own
//       grammar already produced a real parse, factReadBack defers to it
//       instead of competing; when it didn't (the ordinary case these
//       branches were built for), behavior is byte-identical to before.
//       Verified this doesn't just move the bug: a subject known ONLY under
//       an unrelated property ("the logger is deprecated") no longer wrongly
//       offers to teach "tested" either, once "is the logger tested" itself
//       is asked — the real structural empty answers instead.
//   T21 "no worries, X" (AU/NZ casual acknowledgement) — the "no worries"/"no
//       problem" sibling of ACK_PREAMBLE_RE's existing "ok"/"cool" family.
//
// Three more full conversations replayed clean afterward — frozen below.
//
// CYCLE 5 (the last cycle, per SKILL_CHAT_PLAYTEST's cap-of-5 discipline) —
// found two more real fixes, both surfaced by a deliberately adversarial
// STACKED-marker conversation (mirroring Tier 5's own final-cycle discipline:
// its critical T12 bug only surfaced from a deliberately adversarial
// two-subjects-sharing-a-generic-word conversation, not the single-marker
// ones earlier cycles used):
//
//   T22 "aight" (the further-dropped texting-register contraction of
//       "alright") had no ACK_PREAMBLE_RE entry at all.
//   T23 A leading connective ("so") SANDWICHED between two OTHER discourse
//       markers ("aight cool, SO actually wait, what calls X") blocked the
//       whole fixpoint loop: the remainder right after "so" ("actually wait,
//       X") isn't itself a question YET (it still carries its own marker
//       prefix), so LEADING_CONNECTIVE_RE's original interrogative-only gate
//       rejected the strip, and TOPIC_SWITCH_PREAMBLE_RE (anchored to the
//       string's start) never got a chance at "actually" while "so " still
//       sat in front of it. Widened the gate to ALSO accept a remainder that
//       matches one of this file's own OTHER closed preamble frames
//       (TOPIC_SWITCH/ACK/HEDGE_ADVERB/BROWSING) — each is itself anchored +
//       closed-vocabulary, so a match there guarantees the NEXT fixpoint pass
//       strips it too, never a guess.
//
// Verified NOT a fabrication risk (this tier's own explicit warning: a fuzzy/
// grain-word match is exactly the kind of mechanism that can confidently
// return the WRONG thing if under-gated, the same class T1/T20 both already
// guard against): spot-checked T1's grain-word narrowing and T20's structural-
// defers-to-memory guard against several FRESH entity pairs sharing a
// component/stem (tasks.mjs vs test/tasks.test.mjs, base.mjs, users.mjs vs a
// "User" class, several "is X <relation>" qualifier words with genuinely empty
// results) — all resolved to the correct, honest, non-colliding answer.
//
// Two more full conversations replayed clean afterward — frozen below. The
// well is genuinely getting shallower (2 cycle-5 conversations tried heavier,
// more exotic hedge stacks — "honestly not sure but is store tested tho",
// "innit though, what imports http.mjs" — and found nothing more worth fixing
// at the SAME closed-set-addition discipline the rest of this file uses; both
// are named as narrower, lower-priority ceilings rather than forced fixes).
//
// Driven against the SHIPPED examples/mini-webapp graph via `ephemeral: true`
// (chat.mjs's createSession) — same mechanism test/chatflow-tier4.test.mjs/
// test/chatflow-tier5.test.mjs rely on: reads the real graph, writes session/
// provenance state to a throwaway temp dir, so the committed fixture is never
// touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const WALL = /couldn't parse this as a graph question/;
const SHORT_WALL = /still couldn't parse that/;
const VOCAB_MISS = /isn't a term in this graph's own vocabulary/;
const NO_ENTITY = /no entity matching symbol/;
const DEAD_END = new RegExp([WALL, SHORT_WALL, VOCAB_MISS, NO_ENTITY].map((r) => r.source).join("|"));

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

/** A dead-end here is any bare wall/short-wall/vocab-miss/no-entity-match — this
 *  tier's fixes all reach a REAL flowing answer (not a nudge-appended-to-a-miss,
 *  unlike several of Tier 5's), so "flow" for every one of these turns means the
 *  dead-end pattern never appears at all, not just never appears ALONE. */
function assertAllFlow(turns, queries) {
  for (const [i, t] of turns.entries()) {
    assert.ok(
      !DEAD_END.test(t.answer),
      `turn ${i} "${queries[i]}" is a dead end: ${t.answer.slice(0, 160)}`,
    );
  }
}

test("tier6/conversation 1: vague opener + typo + ack-preamble + topic-switch drill-down, zero dead-ends (T2/T4/T5/T6 fix)", async () => {
  const queries = [
    "hi there",
    "so, what is going on in this codebase",
    "waht dose the logger modul do",
    "ok cool, what about the TaskController",
    "actually never mind, what calls saveStore",
    "no wait, I meant what calls createTask",
    "cheers, that helps",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^Hi\. Ask me about this codebase/);
  // T4: the vague opener reaches the SAME rich orientation card
  // CAPABILITY_PHRASES' other entries already reach, not a bare wall.
  assert.match(turns[1].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
  // T2: BOTH the typo'd anchor words ("waht"/"dose"/"modul") AND the module-grain
  // overview answer, exactly as the clean phrasing would give.
  assert.match(turns[2].answer, /^src\/lib\/logger\.mjs is a module — defines 3 \(Logger, Logger\.info, createLogger\)/);
  // T6/T7: the ack-preamble "ok cool," strips cleanly and reaches the FULL class
  // detail, exactly as bare "what about TaskController" already did.
  assert.match(turns[3].answer, /^TaskController — Class \(id: fn:src\/handlers\/tasks\.mjs#TaskController\)/);
  // T5: "actually never mind," strips cleanly — the REAL question underneath
  // answers correctly (createTask is saveStore's one real caller in this fixture).
  assert.match(turns[4].answer, /^in src\/handlers\/tasks\.mjs there is function createTask\(\)\./);
  // T5: "no wait, I meant" strips cleanly too — an honest, receipted empty
  // (nothing in this fixture calls createTask), never a dead end.
  assert.match(turns[5].answer, /^No modules found whose module directly calls createTask\./);
  // HANDOVER.md 2026-07-10 item 2: "cheers, that helps" now generalizes to a
  // real thanks reply (chat.mjs's farewellOrThanksSignal) instead of the
  // generic orientation card this test previously pinned as merely "not a
  // dead end" — a warm sign-off is a strictly better answer to a thanks-plus-
  // filler remark than a self-introduction card.
  assert.match(turns[6].answer, /^Any time\./);
});

test("tier6/conversation 2: heavy hedge-stack politeness + vague opener + typo + relation-touch typo, zero dead-ends (T3/T4/T8 fix)", async () => {
  const queries = [
    "could you maybe possibly tell me, if its not too much trouble, what saveStore does",
    "tell me something interesting about this repo",
    "what clases inherit from Record",
    "what abut imports",
    "cheers for that",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // T8: three stacked hedges ("maybe possibly"), a modal wrapper ("could you"),
  // a floating parenthetical ("if its not too much trouble"), and a bare "tell
  // me X" (no "about") all peel in one normalization pass, reaching the SAME
  // function-purpose answer "what saveStore does" alone gives.
  assert.match(turns[0].answer, /^saveStore is a function — no recorded tests\./);
  // T4
  assert.match(turns[1].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
  // pre-existing typo tolerance (MISSPELLINGS "clases"->"classes") — compat guard
  assert.match(turns[2].answer, /in src\/core\/model\.mjs there is Task, User and Project/);
  // T3: "abut" reads as "about" — the relation concept force's real import answer,
  // never a bogus "no module matching 'abut'" search.
  assert.match(turns[3].answer, /^To import is to bring another module's definitions into the current one\./);
  assert.match(turns[4].answer, /^Any time\./);
});

test("tier6/conversation 3: vague opener + politeness suffix + self-correction + explain-politeness wrapper, zero dead-ends (T2/T4 fix)", async () => {
  const queries = [
    "what can you tell me about this repo",
    "where is Task defined please",
    "sorry, i mean where is TaskController defined",
    "please explain what does createApp do",
    "ta",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // T4
  assert.match(turns[0].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
  // a trailing politeness "please" was already tolerated before this tier (compat guard)
  assert.match(turns[1].answer, /^Task is defined in src\/core\/model\.mjs at lines 9-15\./);
  // pre-existing SELF_CORRECTION_RE ("sorry, i mean X") still resolves the RIGHT
  // entity (compat guard) — the answer is correct even though the "Goal
  // (inferred)" debug line's own entity label is cosmetically garbled
  // ("sorry mean TaskController"), a known low-priority residual noted in this
  // file's own docblock, not a dead end (the actual answer is unaffected).
  assert.match(turns[2].answer, /^TaskController is defined in src\/handlers\/tasks\.mjs at lines 1-7\./);
  // T2: "please explain" (a leading politeness wrapper EXPLAIN_WRAPPER_RE alone
  // can't unwrap, since it requires the string to literally START with "explain")
  // reaches the SAME function-purpose answer the bare phrasing gives.
  assert.match(turns[3].answer, /^createApp is a function — no recorded tests\./);
  assert.match(turns[4].answer, /^Any time\./);
});

test("tier6/subject-first word order 'what X does' answers the same as 'what does X do' (T9 fix)", async () => {
  const turns = await driveSession(["what saveStore does", "what does saveStore do"]);
  assertAllFlow(turns, ["what saveStore does", "what does saveStore do"]);
  assert.equal(turns[0].answer, turns[1].answer);
  assert.match(turns[0].answer, /^saveStore is a function/);
});

test("tier6/grain-word disambiguation: 'the X module' vs 'the X class' never tie-ambiguous-decline (T1 fix)", async () => {
  const turns = await driveSession([
    "what does the logger module do",
    "describe the logger module",
    "describe the Task class",
    "where is the logger module defined",
  ]);
  assertAllFlow(turns, [
    "what does the logger module do", "describe the logger module",
    "describe the Task class", "where is the logger module defined",
  ]);
  assert.match(turns[0].answer, /^src\/lib\/logger\.mjs is a module/);
  assert.match(turns[1].answer, /^src\/lib\/logger\.mjs — Module \(id: mod:src\/lib\/logger\.mjs\)/);
  assert.match(turns[2].answer, /^Task — Class \(id: fn:src\/core\/model\.mjs#Task\)/);
  assert.match(turns[3].answer, /^src\/lib\/logger\.mjs is a module/);
});

test("tier6/T1's grain-word rescue never introduces the word-overlap collision it was built to avoid (compat guard)", async () => {
  // "describe a joke" / "tell me a joke" have NO trailing grain word, so
  // describeGrainRescue must never even attempt a resolution — a first
  // implementation attempt DID (routing free text through the general
  // resolveObject cascade) and it tier-3-matched a fixture module named
  // "a.mjs" off the bare one-character overlap on the article "a" alone,
  // caught live by test/sessions.test.mjs's own transcript guard. Both must
  // stay an honest, real decline — never a bogus "described" answer.
  const turns = await driveSession(["describe a joke", "tell me a joke"]);
  assert.match(turns[0].answer, NO_ENTITY);
  assert.match(turns[1].answer, WALL);
  assert.doesNotMatch(turns[0].answer, /a\.mjs/);
});

test("tier6/bare single-word 'logger' still resolves to the Class (pre-existing collision, untouched by T1's fix)", async () => {
  // T1's fix only ever narrows a pool or strips pure noise (a leading article) —
  // it never changes what an UNADORNED, already-exact-matching term resolves to.
  const turns = await driveSession(["what does logger do"]);
  assertAllFlow(turns, ["what does logger do"]);
  assert.match(turns[0].answer, /^Logger is a class/);
});

// ---- CYCLE 2 ----

test("tier6/conversation 4: dialect preamble + vague-opener idioms + ack-preamble + module-grain overview, zero dead-ends (T10/T13/T14 fix)", async () => {
  const queries = [
    "g'day, what modules import model.mjs then",
    "yeah nah, what does the router do",
    "ta for that",
    "right, can you walk me through this codebase",
    "what's the big picture here",
    "give me the lay of the land",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^src\/core\/store\.mjs and src\/core\/validate\.mjs and src\/handlers\/tasks\.mjs and src\/handlers\/users\.mjs\./);
  // T10: "yeah nah," (AU/NZ dialect opener) strips cleanly, reaching the module-
  // grain overview for the Router class (article-strip T1 territory).
  assert.match(turns[1].answer, /^Router is a class — no recorded tests\./);
  // T12: "ta for that" reads as thanks, not the generic orientation card.
  assert.match(turns[2].answer, /^Any time\./);
  // T14: an ack-preamble ("right,") + modal wrapper ("can you") stacked ahead of
  // a brand-new vague-opener idiom (T13) all peel, reaching orientationAnswer.
  assert.match(turns[3].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
  assert.match(turns[4].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
  assert.match(turns[5].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
});

test("tier6/conversation 5: ESL/self-correction typo variants + a typo'd count trigger, zero dead-ends where fixed (T15 fix; ambiguity-nudge FLOW noted, not walls)", async () => {
  const queries = [
    "which functions does saveStore call",
    "what calls listTasks -- oh wait, i mean createTask",
    "define Task -- no actually, define User",
    "hwo many classes are there",
    "wich modules touch model.mjs",
  ];
  const turns = await driveSession(queries);
  // Every turn either answers, offers a real "did you mean" candidate list (an
  // honest ambiguity nudge — acceptable FLOW per §0/§2, never a bare wall), or
  // gives a receipted honest empty — never the raw grammar wall / vocab-miss /
  // short-wall this file's DEAD_END pattern catches.
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^Task\./);
  // T9's sibling near-miss (SELF_CORRECTION_RE): an object-only restart with no
  // comma after "i mean" is a GENUINE ceiling (see SELF_CORRECTION_RE's own
  // docblock) — the ambiguity nudge's candidate list still names the CORRECT
  // answer ("createTask"), so a user who takes the hint still gets there.
  assert.match(turns[1].answer, /did you mean listTasks and createTask\? Try one of those\./);
  assert.match(turns[2].answer, /did you mean Task, Task\.title, Task\.complete, Task\.assignTo and User\? Try one of those\./);
  // T15: the transposed-letter typo "hwo" no longer loses the aggregate trigger.
  assert.match(turns[3].answer, /^10 classes\./);
  assert.match(turns[4].answer, /^No modules found whose module directly touches model\.mjs\./);
});

test("tier6/conversation 6: teach lane under a fused dialect+vocative preamble, then recall under a dialect hedge, zero dead-ends (T11/T16/T17 fix)", async () => {
  const queries = [
    "howdy pardner, remember that TaskController is fragile",
    "yeah nah, is TaskController fragile",
    "wait what, does the store module import model",
    "cheers",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // T11/T16: "howdy pardner," (a greeting + US-Western vocative) no longer
  // corrupts teachLane's own TEACH_RE match.
  assert.match(turns[0].answer, /^noted — remembered: taskcontroller is fragile/);
  // T17: "yeah nah," no longer misaligns factReadBack's yes/no property reader.
  assert.match(turns[1].answer, /^yes — you told me: taskcontroller is fragile/);
  assert.match(turns[2].answer, /^No — no imports edge found from Store to src\/core\/model\.mjs\./);
  assert.match(turns[3].answer, /^Any time\./);
});

// ---- CYCLE 3 ----

test("tier6/conversation 7: two more vague-opener idioms + reverse bare-inherits word order, zero dead-ends (T18/T19 fix)", async () => {
  const queries = [
    "so what've we got here",
    "just poking around, what's in this repo",
    "TaskController inherits what",
    "ta",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // T19: "so" (LEADING_CONNECTIVE_RE) strips, then "what've we got here" is its
  // own new CAPABILITY_PHRASES entry.
  assert.match(turns[0].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
  // T19: BROWSING_PREAMBLE_RE strips "just poking around,", then "what's in
  // this repo" is its own new CAPABILITY_PHRASES entry — never the members/
  // containment grammar's "no module matching 'this repo'" miss.
  assert.match(turns[1].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
  // T18: bare "inherits" (no "from") now parses; the reverse "X inherits
  // what" word order answers the same as "what does X inherit from".
  assert.match(turns[2].answer, /^Controller\./);
  assert.match(turns[3].answer, /^Any time\./);
});

test("tier6/conversation 8: bare 'inherit(s)' verb form across yes/no, reverse-subject, and typo'd phrasings (T18 fix)", async () => {
  const queries = [
    "does TaskController inherit Controller",
    "what inherits Controller",
    "wat inherts from Record",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^Yes — inherits edge from TaskController to Controller\./);
  assert.match(turns[1].answer, /TaskController and there is UserController/);
  // pre-existing typo tolerance ("wat"->"what", "inherts"->"inherits") — compat guard,
  // unaffected by T18's bare-verb addition.
  assert.match(turns[2].answer, /in src\/core\/model\.mjs there is Task, User and Project/);
});

// ---- CYCLE 4 ----

test("tier6/CRITICAL (T20 fix): 'is X tested' answers the REAL structural coverage question, never a fabricated 'I don't know that yet'", async () => {
  const queries = [
    "is the logger module tested",
    "is logger tested",
    "is the store module tested",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // THE bug: these two used to answer "I don't know anything about 'logger'
  // yet — teach me directly" — a real structural answer existed and was
  // silently discarded. Must now give the SAME honest empty "what tests cover
  // logger" already gives.
  assert.match(turns[0].answer, /^No modules found whose module directly tests logger\./);
  assert.doesNotMatch(turns[0].answer, /teach me directly/);
  assert.match(turns[1].answer, /^No tests cover logger\./);
  assert.doesNotMatch(turns[1].answer, /teach me directly/);
  // a module that DOES have real test coverage still answers correctly too —
  // never regressed by the new guard.
  assert.match(turns[2].answer, /test\/tasks\.test\.mjs and test\/store\.test\.mjs/);
});

test("tier6/T20's guard never breaks the ORIGINAL Tier-5 T8 teach-offer for a property with no structural meaning, and never lets a stale unrelated fact hide the real structural answer", async () => {
  const queries = [
    "remember that the logger module is deprecated",
    "is the logger deprecated",
    "is the logger tested",
    "is the logger fast",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^noted — remembered: logger module is deprecated/);
  // the taught fact still reads back correctly — T20's guard only ever fires
  // when envelope.parsed stands, and "deprecated" has no structural parse.
  assert.match(turns[1].answer, /^yes — you told me: logger module is deprecated/);
  // THE regression this guard had to avoid: once ANY fact is known about "the
  // logger" (here, an unrelated deprecation fact), the OLDER, non-empty-rows
  // code path could ALSO wrongly claim "tested" — now the real structural
  // empty answers instead, even with unrelated facts on file.
  assert.match(turns[2].answer, /^No tests cover logger\./);
  // "fast" has no structural meaning at all — the ORIGINAL known-subject/
  // wrong-property receipt (Tier 5) still stands, untouched.
  assert.match(turns[3].answer, /^I don't have a fact saying the logger is fast\./);
});

test("tier6/conversation 9: AU/NZ 'no worries' ack-preamble reaches the full class detail (T21 fix)", async () => {
  const turns = await driveSession(["no worries, what about the router"]);
  assertAllFlow(turns, ["no worries, what about the router"]);
  assert.match(turns[0].answer, /^Router — Class \(id: fn:src\/server\/router\.mjs#Router\)/);
});

// ---- CYCLE 5 (final cycle) ----

test("tier6/T20's structural-defers-to-memory guard generalizes across every relation qualifier, never just 'tested' (compat/adversarial guard)", async () => {
  const queries = ["is logger touched", "is logger imported", "is logger called", "is logger covered"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  // every one of these is a genuinely empty relation for Logger in this
  // fixture — each must give its OWN real structural empty, never a fabricated
  // "I don't know that yet" teach-offer (T20's fix generalizes via
  // envelope.parsed, not a per-word special case).
  assert.match(turns[0].answer, /^Logger has no touches edges in the index\./);
  assert.match(turns[1].answer, /^Logger has no imports edges in the index\./);
  assert.match(turns[2].answer, /^Logger has no calls edges in the index\./);
  assert.match(turns[3].answer, /^No — Logger is not covered\./);
});

test("tier6/conversation 10: a 5-deep stacked discourse-marker chain (ack+ack+connective+topic-switch+topic-switch) fully peels, zero dead-ends (T22/T23 fix)", async () => {
  const turns = await driveSession(["aight cool so actually wait, what calls createTask"]);
  assertAllFlow(turns, ["aight cool so actually wait, what calls createTask"]);
  // "aight" (T22) + "cool" (ACK) + "so" (LEADING_CONNECTIVE, T23's widened
  // gate) + "actually" + "wait" (TOPIC_SWITCH) all peel in one normalization
  // pass, reaching the exact same honest empty the bare question gives.
  assert.match(turns[0].answer, /^No modules found whose module directly calls createTask\./);
});
