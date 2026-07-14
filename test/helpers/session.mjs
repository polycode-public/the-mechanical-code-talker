// test/helpers/session.mjs — shared "drive a scripted turn/session sequence"
// helpers for the SKILL_CHAT_PLAYTEST regression-transcript suites
// (chatflow-*.test.mjs and friends), which independently hand-rolled a
// near-identical drive()/driveSession() loop. This module extracts the
// genuinely-distinct shapes so each caller imports instead of re-declaring
// its own copy — behavior is unchanged, only the source of the loop moves.
import { runTurn, createSession } from "../../src/chat.mjs";
import { clearCache } from "../../src/source.mjs";

/** FEATURE B (0.9.x): every runAsk-composed answer carries an ALWAYS-ON
 *  trailing "\n\nGoal (inferred): …" line (chat.mjs's withGoalLine), optionally
 *  followed by a "\n\nCanonical: …" line (withCanonicalLine) — several
 *  routing/wall-avoidance regression suites strip both right where turns are
 *  collected, rather than teaching every exact-text assertion a new
 *  trailer-shaped tail. Canonical is stripped first (it trails Goal when both
 *  are present), so the end-anchored GOAL_LINE_RE still matches. `last`/
 *  `last.answer` (the why/say-more re-render source) is already trailer-free,
 *  so only `.answer`/`.logLines` need it here. */
export const GOAL_LINE_RE = /\n\nGoal \(inferred\):[^\n]*$/;
export const CANONICAL_LINE_RE = /\n\nCanonical:[^\n]*$/;
const stripTrailers = (s) => s.replace(CANONICAL_LINE_RE, "").replace(GOAL_LINE_RE, "");
export const stripGoalLine = (t) => (t && typeof t.answer === "string"
  ? {
      ...t,
      answer: stripTrailers(t.answer),
      logLines: Array.isArray(t.logLines) ? t.logLines.map((l) => (l === t.answer ? stripTrailers(l) : l)) : t.logLines,
    }
  : t);

/** Drive a sequence of turns through the real runTurn path (no session/close
 *  lifecycle — just config + an optional in-memory graph), carrying `last`
 *  turn to turn so discourse anaphora / "what about X" resolve exactly as the
 *  shell would. The plain-runTurn shape shared by the chatflow-{architecture,
 *  authorship,history,coverage,coverage-survey,drilldown}.test.mjs suites.
 *
 *  `carryFocus: true` also threads `focus` forward turn to turn (off by
 *  default — the suites above never set focus, so leaving it off matches
 *  their exact prior `{config, last}`-only calls; chatbench-levers.test.mjs's
 *  repoDriver needs the focus thread, so it opts in). `strip` (e.g.
 *  stripGoalLine) transforms each turn before it's collected. */
export async function driveTurns(config, queries, { graph = null, carryFocus = false, strip = null } = {}) {
  const out = [];
  let last = null;
  let focus = null;
  for (const q of queries) {
    clearCache();
    const r = await runTurn(q, { config, graph, last, ...(carryFocus ? { focus } : {}) });
    out.push(strip ? strip(r) : r);
    last = r.last;
    if (carryFocus) focus = r.focus;
  }
  return out;
}

/** Drive a sequence of turns through a REAL createSession session — the
 *  chatflow-tier2/tier2-drilldown/tier4/tier5 driveSession shape.
 *  `sessionOpts` is createSession's own options object (repoPath, env,
 *  ephemeral, …), passed through unchanged. Returns the raw turns array
 *  (callers that also need the repo dir or the session's bannerLines build
 *  those themselves around this — see each call site). `strip` transforms
 *  each turn the same way as driveTurns. */
export async function driveSessionTurns(sessionOpts, queries, { strip = null } = {}) {
  clearCache();
  const s = await createSession(sessionOpts);
  const turns = [];
  try {
    for (const q of queries) turns.push(strip ? strip(await s.turn(q)) : await s.turn(q));
  } finally {
    await s.close();
  }
  return turns;
}
