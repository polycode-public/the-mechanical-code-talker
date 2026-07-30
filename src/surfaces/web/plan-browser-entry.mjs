// plan-browser-entry.mjs — the esbuild entry for the "it plans, and shows
// the work" page's live session (public/plan-browser.bundle.js, built by
// scripts/build-plan-bundle.mjs), mirroring spider-fly-browser-entry.mjs's
// and adventure-browser-entry.mjs's own session-factory shape.
//
// Unlike spider-fly's board or Ashcombe Hall's world, hanoi has no
// structured fact/rule corpus to bootstrap from — its canonical definition
// (data/games/hanoi-3.txt) IS taught English, one sentence per teach frame.
// So this session seeds itself the same way `tmct import --file` teaches
// that file (src/services/import-file.mjs): every sentence
// hanoi-lesson.mjs's hanoiLessonSentences() generates runs as its own
// `turn()`, over the exact same runTurn the CLI and every other viz page's
// chat dock run — not raw appendFacts/appendRule, since there is no
// structured fact list to append here, only taught English.
//
// createPlanSession({ diskCount, maxDepth }) teaches a fresh N-disk puzzle
// and solves it once (mirroring the "disk-1 rests on disk-2. … the goal is
// that every disk rests on peg-c. solve it." prompt scripts/build-demo-
// site.mjs used to shell out to the CLI for), returning `{ plan, turn, ... }`
// — `plan` is the freshly solved plan (or null on an honest miss, e.g. a
// max-depth too low to find one), `turn(line, { maxDepth })` is the SAME
// chat-dock entry point adventure/spider-fly expose, so a visitor's typed
// fact and a visitor's typed "solve it" both dispatch through the real
// engine. `maxDepth` is overridable PER CALL (not just at session creation)
// so the page's own max-search-depth control can re-run "solve it" on the
// CURRENT board without tearing down and re-teaching the whole puzzle.
import { createInMemoryStore } from "../../adapters/memory/core.mjs";
import { parseEntities } from "../../domain/codegraph.mjs";
import { loadLexicon } from "../../domain/grammar/lexicon.mjs";
import { DEFAULT_GAME_CONFIG } from "../../domain/game-config.mjs";
import { hanoiLessonSentences } from "../../domain/hanoi-lesson.mjs";
import { computeBlocksLayout, planToPageData, renderInputsFromPlan } from "../../services/plan-viz.mjs";
import { planToPddl } from "../../services/plan-pddl.mjs";
import { createTurnSession } from "./turn-session.mjs";
// Re-exported so the page can register a CDN-loaded wink-nlp pair before the
// first teach, the same seam chat-browser-entry.mjs exposes as
// tmctChat.registerWinkModel — see wink-model.mjs's own header. The hanoi
// lesson's own "moving a disk onto a target makes the disk rest on the
// target" sentence needs a REAL lemmatiser (verbLemma reduces "moving" to
// "move" to match the taught "move onto" action family) — without it, that
// one sentence honestly declines ("the lemmatizer isn't available"), the
// action rule never gets its effect, and every later locative fact for the
// puzzle fails to teach in turn. spider-fly/adventure never register a wink
// model because their own gameplay never asks a taught rule to reduce a
// verb; the hanoi lesson is the first live session here that does.
import { registerWinkModel } from "../../adapters/wink-model.mjs";

/** A live in-memory towers-of-hanoi session this page's live controls AND
 *  chat dock can both drive. Returns `{ memoryDir, sessionId, diskCount,
 *  maxDepth, plan, turn }`. `plan` is the puzzle's freshly solved plan (the
 *  same shape chat.mjs's planLaneAnswer returns, enriched with
 *  `becauseText` — see `turn()` below), or null when `maxDepth` was too low
 *  to find one (an honest miss, not an error: `turn()`'s own answer text
 *  names it). */
export async function createPlanSession({ diskCount = 3, maxDepth = DEFAULT_GAME_CONFIG.planning.maxDepth } = {}) {
  const memoryDir = createInMemoryStore();
  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  // `maxDepth` overrides the session's own default for just this one call
  // (the page's own max-search-depth control threads it on every call,
  // including a plain typed "solve it"), so raising or lowering it never
  // requires re-teaching the board. `captureExtraState` folds `becauseText`
  // onto the returned `plan` from the session's own plan slot — the
  // plan-lane contract's returned object never carries it itself (only
  // planState does), and the PDDL panel's own "because —" line needs it.
  const session = createTurnSession({
    memoryDir, graph, lexicon, sessionId, vocabHint: "",
    buildExtraOptions: (state, callArgs) => ({
      gameConfig: {
        ...DEFAULT_GAME_CONFIG,
        planning: { ...DEFAULT_GAME_CONFIG.planning, maxDepth: callArgs?.maxDepth ?? maxDepth },
      },
    }),
    captureExtraState: (result, state) => {
      if (result.plan) result.plan = { ...result.plan, becauseText: state.planState?.becauseText ?? null };
    },
  });

  let plan = null;
  for (const sentence of hanoiLessonSentences(diskCount)) {
    const r = await session.turn(sentence);
    if (r.plan) plan = r.plan;
  }

  return { memoryDir, sessionId, diskCount, maxDepth, plan, turn: session.turn };
}

// Re-exported so the page's own rendering script (plan-viz.mjs's inlined
// script) never has to duplicate board layout or PDDL/OWL-RDF formatting —
// the same posture adventure-browser-entry.mjs/spider-fly-browser-entry.mjs
// take re-exporting their own engines' pure helpers.
globalThis.tmctPlan = {
  createPlanSession, computeBlocksLayout, planToPageData, renderInputsFromPlan, planToPddl, registerWinkModel,
};
