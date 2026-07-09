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
  assert.match(turns[6].answer, /^I'm tmct — a deterministic, offline code-graph assistant/);
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
