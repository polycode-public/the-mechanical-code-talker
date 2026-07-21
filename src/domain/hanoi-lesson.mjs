// hanoi-lesson.mjs — the one pure generator behind the taught towers-of-hanoi
// lesson: data/games/hanoi-3.txt's own content, generalized from a fixed
// 3-disk puzzle to any disk count. Pure, no imports — both
// scripts/build-demo-site.mjs (the static initial embed) and
// src/surfaces/web/plan-browser-entry.mjs (the live re-solve a visitor's
// disk-count control triggers) read the SAME sentence sequence from here, so
// neither can drift from data/games/hanoi-3.txt's own taught shape.
//
// Every sentence is emitted the way `tmct import --file` actually teaches
// one — split down to ONE fact per sentence, the exact granularity
// import-file.mjs's own splitSentencesPreservingPaths would produce from the
// committed file's body — not grouped multi-sentence lines, so each array
// entry maps 1:1 onto a single runTurn() call.
//
// Always 3 pegs (peg-a/b/c); only the disk count varies. The pairwise
// "smaller than" facts are EVERY pair, not just adjacent ones — the taught
// relation is stored as given and never chased transitively (see the
// "scale" variation documented in hanoi-3.txt itself), so a partial pairing
// would leave some disks with no legal move.
//
// On top of hanoi-3.txt's own content, the lesson teaches two puzzle-
// inventory facts ("puzzle has N disks." / "puzzle has 3 pegs.") so the
// page's dock can answer "what is the puzzle?" / "does the puzzle have N
// disks?" about the very control the page displays. The subject is bare
// ("puzzle", no article) because that is the shape the has-teach frame
// stores; the disk fact regenerates with the disk-count control, so it
// tracks N instead of going stale.

/** The taught lesson for an N-disk puzzle: the class/individual/ordering
 *  facts, the action rule, the render hints, the starting stack (largest at
 *  the bottom of peg-a, smallest on top), and the goal + solve trigger —
 *  one sentence per array entry, in teaching order. `diskCount` is floored
 *  and clamped to at least 1. */
export function hanoiLessonSentences(diskCount = 3, { goalPeg = "peg-c" } = {}) {
  const n = Math.max(1, Math.floor(Number(diskCount) || 1));
  const disks = Array.from({ length: n }, (_, i) => `disk-${i + 1}`);
  const pegs = ["peg-a", "peg-b", "peg-c"];
  const sentences = [];

  sentences.push("a disk is a kind of game piece.");
  sentences.push("a peg is a kind of place.");
  for (const d of disks) sentences.push(`${d} is a disk.`);
  for (const p of pegs) sentences.push(`${p} is a peg.`);
  sentences.push(`puzzle has ${n} disk${n === 1 ? "" : "s"}.`);
  sentences.push("puzzle has 3 pegs.");
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) sentences.push(`${disks[i]} is smaller than ${disks[j]}.`);
  }
  sentences.push("you can move a disk onto a peg.");
  sentences.push("you can move a disk onto a disk.");
  sentences.push("to move a disk onto a target, nothing may rest on the disk.");
  sentences.push("to move a disk onto a target, nothing may rest on the target.");
  sentences.push("to move a disk onto a disk, the disk must be smaller than the target.");
  sentences.push("moving a disk onto a target makes the disk rest on the target.");
  sentences.push("a disk renders as a block.");
  sentences.push("a peg renders as a slot.");
  for (let i = 0; i < n - 1; i += 1) sentences.push(`${disks[i]} rests on ${disks[i + 1]}.`);
  sentences.push(`${disks[n - 1]} rests on peg-a.`);
  sentences.push(`the goal is that every disk rests on ${goalPeg}.`);
  sentences.push("solve it.");

  return sentences;
}
