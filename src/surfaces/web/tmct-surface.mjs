// tmct-surface.mjs — the one contract every demo page has with the engine.
//
// Each browser entry used to publish its own bag of primitives under its own
// name (tmctChat, tmctMud, tmctLedger, tmctSpiderFly, ...), so a visitor
// reading one page's source met a different wall of raw functions on every
// page, wired together by hand. mud-browser-entry.mjs's own header stated the
// reason for its 25: "so mud-viz.mjs's own inlined script never duplicates
// sprite resolution or the digest/affordance/knowledge readers". Right
// instinct, wrong unit — the page still had to know 25 names to say one
// sentence.
//
// This publishes ONE `globalThis.tmct` instead, and every page reaches the
// engine the same way:
//
//   await tmct.open(...)     open this page's session
//   tmct.session             the live session, once opened
//   await tmct.turn(line)    one conversational turn, the dock's entry point
//   await tmct.ask(request)  one grounded question, prose plus its evidence
//   await tmct.plan(request) one compound request, planned over what's loaded
//
// Whatever a page still needs that has NO plain-English form lives on
// `tmct.page` — canvas geometry, sprite templates, a wink model to register, a
// digest structure table. The split is the point: `tmct.ask(...)` is tmct
// answering, `tmct.page.cellId(...)` is this page drawing. A reader can tell
// them apart at a glance, which is exactly what eleven flat bags made
// impossible.
//
// Three more members show up on some pages, by convention rather than by
// anything this function returns: `tmct.ready` is the page's own boot
// promise (chat, ingest), `tmct.lastSave` is its last background-save
// record, `{at, ms}` (chat, adventure), and `tmct.seed` is what the starter
// memory is doing — `{state, facts}` through "loading", "indexing", "ready",
// "failed" (with `error`) and "skipped" (chat, ingest, research).
//
// `tmct.seed` is deliberately not the same question as `tmct.ready`. Boot
// finishing and the memory arriving are separate events, and a page whose
// seed failed still boots, still opens, and still answers — from a smaller
// store, which is the open-world assumption behaving correctly rather than a
// degraded mode. What the seed record adds is the ability to SAY so: a pill
// that reports real load progress, and a test that can tell a failed download
// apart from a store that is empty on purpose. Both look like zero facts.
//
// None can be threaded through `publishTmctSurface(...)` itself — boot is
// still running when this function returns, so the page's own script sets
// each once it reaches that point (see chat-page-viz.mjs, ingest-viz.mjs,
// adventure-viz.mjs).
// Each page's older bare global — window.tmctChatReady, tmctIngestReady,
// tmctChatLastSave, tmctAdventureLastSave — keeps working unchanged;
// `tmct.ready` / `tmct.lastSave` just reach the same value under the one
// `tmct.*` name everything else on this page already uses.
//
// `ask` and `plan` are supplied per page rather than fixed here, because what
// a page can ground a question against genuinely differs: code-explorer holds
// a code graph, spider-fly holds a live board projected into one, the ledger
// dock holds a memory store and no graph at all. A page that supplies neither
// gets an honest refusal naming why, never a guess — the same promise the
// engine itself makes.

const NO_SESSION = "no session is open on this page yet — await tmct.open() first";

// The demo ledger page carries TWO bundles at once: the committed
// question-only one inlined into the HTML (memory-ask-browser-entry.mjs) and
// the demo site's own full turn engine as a separate script tag
// (ledger-browser-entry.mjs). Both publish this surface, and which one the
// browser runs first is not something either can promise. So the
// question-only one publishes as a `fallback` and the full engine always
// wins, whichever order they load in. Registered globally rather than
// module-locally because the two bundles carry their own copy of this module.
const FALLBACK = Symbol.for("tmct.surface.fallback");

/**
 * `publishTmctSurface({ open, ask, plan, turn, page, target })` installs
 * `target.tmct` (default `globalThis`) and returns it.
 *
 * `open(...args)` is the page's own session factory and is the only required
 * argument — `createChatSession`, `createMudSession`, `createPlanSession` and
 * the rest, called with whatever arguments they already take. Its result
 * becomes `tmct.session`.
 *
 * `turn(line, options, session)` (optional) overrides how a line reaches the
 * session. The default calls `session.turn(line, options)`, which is every
 * page but mud — mud runs several characters over one world, so it routes on
 * `{ as: character }` to that character's own window.
 *
 * `ask(request, options, session)` and `plan(request, options, session)`
 * (optional) are the page's grounded-question and capability-planner routes.
 * Left out, the matching verb refuses and says which route the page does have.
 * Every verb takes the same `(what, options)` shape, so the research page's
 * source-scoped `tmct.ask(q, { sources })` reads like the plan page's
 * `tmct.turn("solve it", { maxDepth })`.
 *
 * `page` is the residual bag: this page's own rendering helpers, reachable as
 * `tmct.page.*`.
 *
 * `fallback: true` publishes only where no fuller surface is standing, and
 * yields to one that arrives later — the ledger page's two bundles.
 */
export function publishTmctSurface({
  open, ask = null, plan = null, turn = null, page = {}, fallback = false, target = globalThis,
} = {}) {
  if (typeof open !== "function") {
    throw new Error("publishTmctSurface: `open` must be this page's session factory");
  }
  const standing = target.tmct;
  if (fallback && standing && !standing[FALLBACK]) return standing;
  let session = null;

  const liveSession = () => {
    if (!session) throw new Error(NO_SESSION);
    return session;
  };

  const surface = {
    // Variadic, so each page's factory keeps the signature it already has —
    // adventure and mud both take the world payload first, then their options.
    async open(...args) {
      session = await open(...args);
      return session;
    },

    get session() { return session; },

    async turn(line, options) {
      const live = liveSession();
      if (turn) return turn(line, options, live);
      // Not every page holds a conversation. The ingest page grounds pasted
      // prose into facts and answers nothing, so it says so rather than
      // failing on a method it never had.
      if (typeof live.turn !== "function") {
        return {
          answer: "this page runs no conversational turn — see tmct.session for what it does run",
          end: false, record: null, plan: null, research: null,
        };
      }
      return live.turn(line, options);
    },

    async ask(request, options) {
      if (!ask) {
        return {
          answer: "this page has no separate ask route — it answers questions through tmct.turn()",
          data: undefined,
          miss: true,
        };
      }
      return ask(request, options, liveSession());
    },

    async plan(request, options) {
      if (!plan) {
        return {
          refused: true,
          why: "this page's bundle carries no capability planner",
          driver: null, calls: [], composed: null, observed: null,
        };
      }
      return plan(request, options, liveSession());
    },

    page,

    /** True where this is the question-only stand-in rather than a page's full
     *  engine. The ledger page reads it to tell its two docks apart: the live
     *  one teaches, the stand-in only answers. */
    fallback,
  };

  surface[FALLBACK] = fallback;
  target.tmct = surface;
  return surface;
}
