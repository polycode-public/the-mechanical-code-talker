// sprite-animation.mjs — the pure state machine behind every animated sprite
// tile: the hover flip-book (static/moving), the focused cell's turning
// rotation and emotion cycle, and the oscillate-and-turn walk a "moving"
// scene entity performs. Every function here is a pure function of its
// arguments — no wall clock, no local counter; the caller passes the tick.
// They are also self-contained (no outer refs), so a page builder can splice
// any of them in by `.toString()` exactly the way sprite-catalog-viz.mjs
// splices its frame-sequence functions, and a browser bundle can export the
// same functions for a page that loads the engine (the sprites and adventure
// entries both do).

/** The pose word a tile at rest shows, and the one its hover flip names. */
export const SPRITE_POSE_REST = "static";
export const SPRITE_POSE_MOVING = "moving";

/** A swatch label that IS a moving frame ("moving", "left + moving"), as
 *  opposed to a resting tile a moving frame can fold into. Pure;
 *  `.toString()`-splice safe. */
export function isMovingSwatchLabel(label) {
  return label === "moving" || / \+ moving$/.test(String(label ?? ""));
}

/** The label of the moving counterpart frame a resting tile's hover flip
 *  alternates with: the plain tile ("default") flips against the bare
 *  "moving" frame, a facing tile ("left") against its own combined
 *  "left + moving" one. Pure; `.toString()`-splice safe. */
export function movingCounterpartLabel(restLabel) {
  if (!restLabel || restLabel === "default" || restLabel === "plain") return "moving";
  return restLabel + " + moving";
}

/** The two modes a focused sprite steps between, and the click toggle. */
export const FOCUS_MODE_ORDER = Object.freeze(["turning", "emotions"]);

/** Pure; `.toString()`-splice safe. */
export function nextFocusMode(mode) {
  return mode === "turning" ? "emotions" : "turning";
}

/** The frame a cycling cell shows at `tick`, looping. Pure;
 *  `.toString()`-splice safe. */
export function frameAtTick(frames, tick) {
  const list = frames || [];
  if (!list.length) return null;
  const step = Math.trunc(Number(tick) || 0);
  return list[((step % list.length) + list.length) % list.length];
}

/** The frame list a focused cell cycles in `mode`. The asked-for axis wins;
 *  a class with no art on that axis falls back to the next axis it does
 *  have, and a class with fewer than two frames on every axis animates
 *  nothing. Pure; `.toString()`-splice safe. */
export function focusModeFrames(mode, { turnFrames = [], moodFrames = [], movingFrames = [] } = {}) {
  const order = mode === "emotions"
    ? [moodFrames, turnFrames, movingFrames]
    : [turnFrames, movingFrames, moodFrames];
  for (const frames of order) {
    if (frames && frames.length >= 2) return frames;
  }
  return [];
}

/** One step of the oscillate-and-turn walk a moving scene entity performs:
 *  walk one way for `legTicks` ticks alternating static/moving, turn on the
 *  spot through the half-way facings at the end, walk back, turn again.
 *  `offsetFraction` is the horizontal offset in sprite widths, swinging half
 *  a sprite width each side of centre. Pure — the same tick always gives the
 *  same step. `.toString()`-splice safe. */
export function oscillateWalkStep(tick, { legTicks = 6 } = {}) {
  const legs = Math.max(2, Math.trunc(legTicks));
  const turnTicks = 3;
  const cycle = 2 * (legs + turnTicks);
  const t = (((Math.trunc(Number(tick) || 0)) % cycle) + cycle) % cycle;
  const stride = (k) => (k % 2 ? "static" : "moving");
  if (t < legs) {
    return { facing: "right", pose: stride(t), offsetFraction: -0.5 + (t + 1) / (legs + 1) };
  }
  if (t < legs + turnTicks) {
    const facing = ["half-right", null, "half-left"][t - legs];
    return { facing, pose: "static", offsetFraction: 0.5 };
  }
  if (t < 2 * legs + turnTicks) {
    const k = t - legs - turnTicks;
    return { facing: "left", pose: stride(k), offsetFraction: 0.5 - (k + 1) / (legs + 1) };
  }
  const facing = ["half-left", null, "half-right"][t - 2 * legs - turnTicks];
  return { facing, pose: "static", offsetFraction: -0.5 };
}

/** The swatch labels worth trying for a walk step, most specific first —
 *  the combined facing-and-pose frame, then the facing alone, then the bare
 *  moving frame, then the entity's own material swatch. The caller shows
 *  the first label its class really carries and falls back to the default
 *  sprite past the end. Pure; `.toString()`-splice safe. */
export function walkFrameLabelCandidates({ facing = null, pose = "static", material = null } = {}) {
  const candidates = [];
  if (facing && pose === "moving") candidates.push(facing + " + moving");
  if (facing) candidates.push(facing);
  if (pose === "moving") candidates.push("moving");
  if (material) candidates.push(material);
  return candidates;
}
