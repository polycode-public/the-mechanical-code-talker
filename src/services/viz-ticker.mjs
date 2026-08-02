// viz-ticker.mjs — the play/pause/step/reset control PATTERN, extracted once
// from plan-viz.mjs's own inlined ticker script (PLAN_SPIDER_FLY.md §11: the
// `step`/`playing`/`animating` state triple, `playRange`/`wait(300)`, the
// `prefers-reduced-motion` guard). plan-viz.mjs's own version stays exactly
// where it is — it closes directly over Hanoi/river's block-board DOM
// (`animateMove`/`drawState`/`PLAN.layouts`) and was never generic. This file
// is the reusable part only, written once so more than one self-contained
// page can share it instead of re-implementing it.
//
// `createTicker` is written to run standalone: it closes over nothing but its
// own parameters and the ambient browser globals (`window`, `setTimeout`)
// every self-contained tmct page already assumes, so it can be spliced
// verbatim into a page's own inlined <script> via `createTicker.toString()`
// — exactly how ledger-viz.mjs inlines `facetCounts`/`resolveAnsweredTerm`
// (see src/services/spider-fly-viz.mjs for the first caller). A later ES
// import (`import { createTicker } from "./viz-ticker.mjs"`) works
// identically, for a caller with its own module graph.
//
// This helper deliberately owns NO notion of "step number" or "total step
// count" — plan-viz.mjs's own ticker assumes a fixed, precomputed sequence
// (Hanoi's move list), but a live simulation (spider-and-fly's turn-by-turn
// engine) has no such fixed length. Both shapes fit the one contract below:
// a fixed-length replay passes `hasNext: () => getStep() < N`; an open-ended
// simulation passes `hasNext: () => true` (or its own stopping condition,
// e.g. "the board still has agents on it").
//
// What a caller supplies, via `opts`:
//   - `onTick()` (required): advance by exactly one step. May be async —
//     this is the caller's chance to run one real engine turn, or animate one
//     move — and is awaited before the ticker considers the next step. Its
//     return value is ignored; the caller updates its own state/DOM inside.
//   - `onRender(state)` (optional): called after every state change, with a
//     plain `{ playing, animating }` snapshot, so the caller can update its
//     own button labels/disabled-state. This helper touches no DOM itself —
//     unlike plan-viz.mjs's inlined version, it assumes no button ids.
//   - `onReset()` (optional, async): called by `reset()` — this helper has no
//     opinion on what "back to the start" means (replay from step 0? a fresh
//     session for a live simulation?), so that decision is entirely the
//     caller's; `reset()` is a no-op without it beyond clearing `playing`.
//   - `hasNext()` (default: always true): whether another tick should run.
//     Checked before every tick, both for a single step and inside `play()`'s
//     loop.
//   - `waitMs` (default 300): the pacing delay between auto-played ticks —
//     matches plan-viz.mjs's own `wait(300)`.
//   - `wait` (default a real `setTimeout` promise): injectable for tests, so
//     a suite can pass an instant resolver instead of waiting in real time.
//
// Returns `{ play, pause, stepOnce, reset, getState }` — the four verbs a
// play/pause/step/reset button row wires to a click handler, plus a read of
// the current `{ playing, animating }` snapshot.
export function createTicker({
  onTick, onRender = () => {}, onReset = null,
  hasNext = () => true, waitMs = 300,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const state = { playing: false, animating: false };
  const render = () => onRender({ ...state });
  // The promise of whatever onTick() call is currently in flight, or null
  // between ticks — reset() awaits this (see below) rather than bailing out
  // when a click lands mid-tick, so a reset can never be silently dropped.
  let inFlight = null;

  /** Advance exactly one step, honoring `hasNext`/`animating` guards. Returns
   *  whether it actually advanced. */
  async function stepOnce() {
    if (state.animating || !hasNext()) return false;
    state.animating = true;
    render();
    inFlight = Promise.resolve(onTick());
    await inFlight;
    inFlight = null;
    state.animating = false;
    render();
    return true;
  }

  /** Keep advancing, paced by `waitMs`, until paused or `hasNext()` says
   *  stop. A no-op while a step is already animating (never overlaps a
   *  running tick) or already playing (toggling play again pauses instead —
   *  see `play()`). */
  async function play() {
    if (state.animating) return;
    if (state.playing) { pause(); return; }
    state.playing = true;
    render();
    while (state.playing && hasNext()) {
      // eslint-disable-next-line no-await-in-loop
      const advanced = await stepOnce();
      if (!advanced) break;
      if (state.playing && hasNext()) {
        // eslint-disable-next-line no-await-in-loop
        await wait(waitMs);
      }
    }
    state.playing = false;
    render();
  }

  function pause() {
    state.playing = false;
    render();
  }

  /** Stop and rewind. `state.playing` drops immediately, even mid-tick, so
   *  `play()`'s own loop can never start one more tick once this has been
   *  called — a reset clicked while a tick is animating used to return here
   *  before touching `playing` at all, which left the loop running right
   *  past it. If a tick IS in flight, this waits for it to actually settle
   *  (never calling `onReset` while `onTick` might still be touching the
   *  same state/DOM) before rewinding, rather than dropping the reset. */
  async function reset() {
    state.playing = false;
    if (inFlight) await inFlight;
    if (onReset) await onReset();
    render();
  }

  return { play, pause, stepOnce, reset, getState: () => ({ ...state }) };
}

/** The one-line `prefers-reduced-motion` read plan-viz.mjs's inlined script
 *  performs itself (`window.matchMedia("(prefers-reduced-motion: reduce)")
 *  .matches`) — pulled out only so a caller doesn't retype the media query.
 *  This helper never consults it itself: what "reduced motion" should change
 *  (skip a CSS transition? jump straight to the end?) is entirely up to
 *  what `onTick` does with the value. Self-contained, `.toString()`-splice
 *  safe, same as `createTicker` above. */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/** A FIFO queue of async jobs that never overlap — the same primitive
 *  mud-viz.mjs (`tickChain`/`serializeTick`) and adventure-viz.mjs/
 *  spider-fly-viz.mjs (`lock`/`withLock`) each wrote under a different name,
 *  for the same reason in all three: a ticker, a chat dock and (mud's case)
 *  an editor sync all touch the same in-memory store, and any two calls
 *  overlapping could race the same write.
 *
 *  Returns `{ run }`. `run(fn)` chains `fn` onto the queue and returns a
 *  promise for `fn`'s own settlement — a rejection propagates to THAT
 *  caller, but never poisons the queue for the jobs queued after it (the
 *  internal chain swallows the rejection once it has been handed back).
 *  Self-contained, `.toString()`-splice safe. */
export function createSerialQueue() {
  let chain = Promise.resolve();
  function run(fn) {
    const settled = chain.then(fn, fn);
    chain = settled.catch(() => {});
    return settled;
  }
  return { run };
}
