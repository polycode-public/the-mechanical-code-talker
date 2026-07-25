// synthbench/phrasing/synthesize.mjs — Stage 0 (PLAN_CODE_PLANNING.md §1.2/§6): the
// PHRASING_FRAMES warm-up. Synthesizes ONE `{re, to}` frame — the exact shape
// src/domain/interpret/normalize.mjs's PHRASING_FRAMES table declares — from a small
// set of PAIRED utterance examples `{from, to}`, e.g.
//   ("what functions are in Task", "what does Task contain")
//   ("what functions are in Widget", "what does Widget contain")
// This is the smaller warm-up instance of Track 1's species (PLAN_CODE_PLANNING.md
// §1.2): not an arbitrary regex search, but a TEMPLATE INSTANTIATION — the
// varying span (the object, "Task"/"Widget") generalizes into a capture
// group, and the fixed scaffold around it (both in `from` and in `to`)
// generalizes from what the examples themselves hold in common. No search
// over regex-space happens here at all: the algorithm is a deterministic
// longest-common-prefix/suffix DIFF, the same "generalize-a-template"
// discipline the plan names as one order of magnitude smaller than Track 1's
// closed field grammar (enumerate.mjs).
//
// Pure, deterministic, no I/O, no randomness: the SAME examples (in the SAME
// order — order does not actually matter here, every example is folded
// through the same associative min/max, but the function never reads
// Date.now/Math.random either way) always synthesize byte-identical output.

import { escapeRegex } from "../../../src/domain/interpret/normalize.mjs";

/** Longest common prefix across a list of strings (case-INsensitive compare,
 *  original casing returned) — []/empty input => "". */
function commonPrefix(strings) {
  if (!strings.length) return "";
  let prefix = strings[0];
  for (const s of strings.slice(1)) {
    let i = 0;
    const max = Math.min(prefix.length, s.length);
    while (i < max && prefix[i].toLowerCase() === s[i].toLowerCase()) i += 1;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/** Longest common suffix, same discipline as commonPrefix (reverse the
 *  strings, reuse the same walk, reverse back — no separate algorithm). */
function commonSuffix(strings) {
  return [...commonPrefix(strings.map((s) => [...s].reverse().join("")))].reverse().join("");
}

/** Strip ONE trailing "?" (both a hand-written frame's own convention and this
 *  synthesizer's: the produced regex always tolerates an optional trailing
 *  "?" via `\??$`, so a literal "?" in an example is redundant noise, not a
 *  meaningful part of the fixed scaffold). */
const stripQ = (s) => s.replace(/\?\s*$/, "");

/** Synthesize ONE `{re, to}` PHRASING_FRAMES-shaped entry from >=2 paired
 *  examples of the SAME family (same fixed scaffold, varying object span).
 *  Returns `{ re: RegExp, to: (m) => string, template: string }` — `template`
 *  is recorded for readability/debugging (not part of the frame's own shape,
 *  never read by applyPhrasingFrames). Throws a descriptive Error when the
 *  examples do not admit a single consistent generalization (never guesses a
 *  regex — the same honest-miss discipline as everywhere else in tmct). */
export function synthesizeFrame(examples) {
  if (!Array.isArray(examples) || examples.length < 2) {
    throw new Error("synthesizeFrame needs >=2 paired examples to generalize a varying span from");
  }
  const pairs = examples.map(({ from, to }) => {
    if (typeof from !== "string" || typeof to !== "string" || !from.trim() || !to.trim()) {
      throw new Error("every example needs non-empty string `from`/`to`");
    }
    return { from: stripQ(from.trim()), to: stripQ(to.trim()) };
  });

  // 1. generalize the TO side: the object substring is whatever varies
  //    between the `to` strings once their common prefix/suffix is removed.
  const toPrefix = commonPrefix(pairs.map((p) => p.to));
  const toRestAfterPrefix = pairs.map((p) => p.to.slice(toPrefix.length));
  const toSuffix = commonSuffix(toRestAfterPrefix);
  const objects = toRestAfterPrefix.map((r) => r.slice(0, r.length - toSuffix.length || undefined));
  if (objects.some((o) => !o)) throw new Error("could not isolate a non-empty varying object span in the `to` examples");
  if (new Set(objects.map((o) => o.toLowerCase())).size < 2) {
    throw new Error("every example names the same object — nothing to generalize (need >=2 DISTINCT objects)");
  }

  // 2. generalize the FROM side: locate each example's object span inside its
  //    own `from` string, then take the common prefix/suffix AROUND that span
  //    across every example — the fixed scaffold a regex captures the object.
  const spans = pairs.map((p, i) => {
    const idx = p.from.toLowerCase().indexOf(objects[i].toLowerCase());
    if (idx < 0) throw new Error(`example ${i}: the \`to\` object "${objects[i]}" is not a substring of the \`from\` text "${p.from}"`);
    return { pre: p.from.slice(0, idx), post: p.from.slice(idx + objects[i].length) };
  });
  const fromPrefix = commonPrefix(spans.map((s) => s.pre));
  const fromSuffix = commonSuffix(spans.map((s) => s.post));

  // 3. build the frame. The regex is anchored start-to-end (never a partial
  //    match — the same discipline every hand-written PHRASING_FRAMES entry
  //    uses), tolerates an optional trailing "?", case-insensitive (object
  //    names are meaningfully cased, so the CAPTURE is not lowercased).
  const re = new RegExp(`^${escapeRegex(fromPrefix)}(.+?)${escapeRegex(fromSuffix)}\\??$`, "i");
  const to = (m) => `${toPrefix}${m[1]}${toSuffix}`;
  const template = `${toPrefix}{OBJ}${toSuffix}`;

  // 4. self-consistency check — the SAME oracle discipline Track 1's own
  //    verification stage uses (never trust the candidate, only the pinned
  //    labeled examples): every given example must round-trip through the
  //    frame we just built, exactly. A frame that fails its OWN training
  //    examples is not a valid synthesis — refuse rather than ship it.
  for (const { from, to: expectedTo } of pairs) {
    const m = from.match(re);
    if (!m) throw new Error(`synthesized frame does not match its own example "${from}"`);
    const got = to(m);
    if (got !== expectedTo) throw new Error(`synthesized frame reproduces "${from}" as "${got}", expected "${expectedTo}"`);
  }

  return Object.freeze({ re, to, template });
}

/** Apply a synthesized (or hand-written) `{re, to}` frame to one input string.
 *  Mirrors normalize.mjs's applyPhrasingFrames for a SINGLE frame (this stage
 *  synthesizes one frame at a time — folding several into a first-match-wins
 *  table is Track 1 proper's concern, not this warm-up's). Returns the
 *  rewritten text, or the input unchanged if the frame does not match. */
export function applyFrame(text, frame) {
  const m = String(text).match(frame.re);
  return m ? frame.to(m).replace(/\s+/g, " ").trim() : String(text);
}
