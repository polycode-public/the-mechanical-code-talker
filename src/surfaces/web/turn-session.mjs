// turn-session.mjs — the turn-dispatch wrapper nine near-identical browser
// sessions each hand-rolled (chat-browser-entry.mjs, code-explorer-browser-
// entry.mjs, ledger-browser-entry.mjs, adventure-browser-entry.mjs, spider-
// fly-browser-entry.mjs, plan-browser-entry.mjs, research-browser-entry.mjs,
// mud-browser-entry.mjs, sprites-browser-entry.mjs): a closure over
// focus/last/planState/researchState, a `try { runTurn(...) } catch` that
// turns a throw into a safe answer instead of ending the session (the page
// has no other chance to show that turn's reply), the post-call state
// capture, and a return shape covering every field one caller or another
// reads back.
//
// The nine differ in what they hand `runTurn` beyond the common core
// (`uiContext`, `synthesisBudget`, `gameConfig`, `researchConfig`,
// `actingSubject`, a per-character `sessionId`...) and in what they do with a
// turn's result besides the standard focus/last/planState/researchState fold
// (sync an externally-held plan holder, grow a visited-rooms set, bump a
// per-character turn tally). `buildExtraOptions`/`captureExtraState` below
// are exactly those two seams — everything else is common enough to live
// here once.
//
// The catch fallback text converges on the FULLEST of the nine: several
// callers had already drifted to a shorter one (mud-browser-entry.mjs drops
// "or /help"; research-browser-entry.mjs drops "or /help" AND "answering
// that") — proof, not just a risk, that duplicating this string invites
// exactly this drift.
import { runTurn as defaultRunTurn } from "../../services/chat.mjs";

function turnErrorFallback(message) {
  return `Something went wrong answering that (${message}). Try rephrasing, or /help.`;
}

/**
 * `createTurnSession({ memoryDir, graph, lexicon, sessionId, vocabHint,
 * buildExtraOptions, captureExtraState })` — a live turn-dispatch session
 * over the real engine (`runTurn`), threading focus/last/planState/
 * researchState across calls the way every browser chat dock does.
 *
 * `vocabHint` is the session-lifetime hint every caller computes once at
 * creation (a fixed string, or `vocabExampleHint(vocabSeeded)`'s result) —
 * never recomputed per turn.
 *
 * `buildExtraOptions(state, callArgs)` (optional) returns extra `runTurn`
 * options to merge OVER the defaults below — anything a specific page needs
 * (`uiContext: "browser"`, `synthesisBudget`, `gameConfig`, `researchConfig`,
 * a per-character `actingSubject`/`sessionId`, or a `planState` read from an
 * external holder instead of this closure's own). `state` is
 * `{ focus, last, planState, researchState }` as this turn is about to run;
 * `callArgs` is whatever extra argument `turn(line, callArgs)` was given
 * (plan-browser-entry.mjs's own per-call `{ maxDepth }` override, for one).
 *
 * `captureExtraState(result, state, callArgs)` (optional, may be async) runs
 * once after a SUCCESSFUL turn, with `state` already folded forward
 * (focus/last/planState/researchState updated) — the caller's own chance to
 * do further bookkeeping (sync an external plan holder, reload memory to
 * grow a visited-rooms set, bump a turn tally). Never runs on a throw: none
 * of the nine originals touch their own state when `runTurn` itself failed.
 *
 * Returns `{ memoryDir, sessionId, graph, turn, focus, last, planState,
 * setPlanState, researchState, setResearchState }`. `graph` is the one this
 * session was built over, exposed so a caller can put a question to the same
 * graph its turns run against (engine-surface.mjs's `graphAsk`) without
 * holding a second reference to it. `turn(line, callArgs)`
 * resolves to `{ answer, end, record, plan, research }` — the union of every
 * field any of the nine originals reads; a caller ignores what it doesn't
 * need. `research` is passed through undefined/null/a queue snapshot exactly
 * as `runTurn` returned it (a caller may distinguish "not a research turn"
 * from "a research turn that just ended").
 *
 * `runTurn` (default: the real engine) is injectable, purely so a test can
 * force the catch path deterministically without needing an input that
 * happens to make the real, deliberately crash-resistant engine throw.
 */
export function createTurnSession({
  memoryDir, graph, lexicon, sessionId, vocabHint = "",
  buildExtraOptions = () => ({}),
  captureExtraState = async () => {},
  runTurn = defaultRunTurn,
} = {}) {
  let focus = null;
  let last = null;
  let planState = null;
  let researchState = null;

  async function turn(line, callArgs) {
    const before = { focus, last, planState, researchState };
    const extra = buildExtraOptions(before, callArgs) || {};
    let result;
    try {
      result = await runTurn(line, {
        config: null, source: null, graph, focus, last, memoryDir, sessionId,
        env: {}, lexicon, vocabHint, planState, researchState,
        ...extra,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { answer: turnErrorFallback(message), end: false, record: null, plan: null, research: null };
    }
    focus = result.focus;
    last = result.last;
    if ("planState" in result) planState = result.planState;
    if ("researchState" in result) researchState = result.researchState;
    await captureExtraState(result, { focus, last, planState, researchState }, callArgs);
    return {
      answer: result.answer,
      end: Boolean(result.end),
      record: result.record ?? null,
      plan: result.plan ?? null,
      research: result.research,
    };
  }

  return {
    memoryDir,
    sessionId,
    graph,
    get focus() { return focus; },
    get last() { return last; },
    get planState() { return planState; },
    setPlanState(next) { planState = next; },
    get researchState() { return researchState; },
    setResearchState(next) { researchState = next; },
    turn,
  };
}
