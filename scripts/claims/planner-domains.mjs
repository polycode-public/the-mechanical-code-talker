// planner-domains.mjs — the three taught puzzles claim-planner.mjs measures,
// and the one per-instance solve function every caller (this rig, and later
// the claims page's own benchmark-this-device button) drives through.
//
// blocksworld and gripper are authored the same way src/domain/hanoi-lesson.mjs
// generalizes data/games/hanoi-3.txt: a fixed small rule set teaches the
// domain's types and action family, and a size parameter scales the puzzle
// instance stacked on top of it. Both reuse the exact closed teach frames
// data/games/hanoi-3.txt and data/games/river.txt already exercise (the
// action-signature, clearing-precondition, and action-effect sentences), so
// nothing here is a new grammar shape — only new vocabulary and a new
// instance shape.
//
// blocksworld drops hanoi's "smaller than" comparative precondition: real
// Blocksworld blocks are uniform, so any clear block may stack on any other
// clear block or spot. gripper drops the clearing precondition entirely: a
// room holds any number of balls, so carrying one is unconditional. Removing
// constraints only ever ADDS legal moves at each search step, which is why
// both grow harder than hanoi at the same instance size — the search radius
// shrinks. claim-planner.mjs measures how much.

import { hanoiLessonSentences } from "../../src/domain/hanoi-lesson.mjs";
import { createInMemoryStore } from "../../src/adapters/memory/core.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { createTurnSession } from "../../src/surfaces/web/turn-session.mjs";

/** The block-stacking domain's rule scaffolding alone (types, individuals,
 *  the "stack onto" action family, render hints) — no starting stack, no
 *  goal, no solve. This is the half of the taught content that belongs in
 *  the committed rule file, matching how data/games/hanoi-3.txt carries only
 *  hanoi's rules and leaves the instance to be typed interactively. */
export function blocksworldRuleSentences(blockCount = 3) {
  const n = Math.max(1, Math.floor(Number(blockCount) || 1));
  const blocks = Array.from({ length: n }, (_, i) => `block-${i + 1}`);
  const spots = ["spot-a", "spot-b", "spot-c"];
  const sentences = [];
  sentences.push("a block is a kind of game piece.");
  sentences.push("a spot is a kind of place.");
  for (const b of blocks) sentences.push(`${b} is a block.`);
  for (const p of spots) sentences.push(`${p} is a spot.`);
  sentences.push("you can stack a block onto a spot.");
  sentences.push("you can stack a block onto a block.");
  sentences.push("to stack a block onto a target, nothing may rest on the block.");
  sentences.push("to stack a block onto a target, nothing may rest on the target.");
  sentences.push("stacking a block onto a target makes the block rest on the target.");
  sentences.push("a block renders as a cube.");
  sentences.push("a spot renders as a mat.");
  return sentences;
}

/** blocksworldRuleSentences(blockCount) plus one solvable instance: every
 *  block starts in a single stack on spot-a (block-1 on top), and the goal
 *  gathers them all onto spot-c — the same shape hanoiLessonSentences uses
 *  for its own starting stack, minus the size ordering. */
export function blocksworldInstanceSentences(blockCount = 3) {
  const n = Math.max(1, Math.floor(Number(blockCount) || 1));
  const blocks = Array.from({ length: n }, (_, i) => `block-${i + 1}`);
  const sentences = blocksworldRuleSentences(n);
  for (let i = 0; i < n - 1; i += 1) sentences.push(`${blocks[i]} rests on ${blocks[i + 1]}.`);
  sentences.push(`${blocks[n - 1]} rests on spot-a.`);
  sentences.push("the goal is that every block rests on spot-c.");
  sentences.push("solve it.");
  return sentences;
}

/** The ball-transport domain's rule scaffolding alone. Rooms hold any number
 *  of balls, so the family carries no clearing precondition at all — the
 *  cleanest possible action family the taught grammar supports (a signature
 *  and an effect, nothing else). */
export function gripperRuleSentences(ballCount = 3) {
  const n = Math.max(1, Math.floor(Number(ballCount) || 1));
  const balls = Array.from({ length: n }, (_, i) => `ball-${i + 1}`);
  const rooms = ["room-a", "room-b", "room-c"];
  const sentences = [];
  sentences.push("a ball is a kind of game piece.");
  sentences.push("a room is a kind of place.");
  for (const b of balls) sentences.push(`${b} is a ball.`);
  for (const r of rooms) sentences.push(`${r} is a room.`);
  sentences.push("you can carry a ball inside a room.");
  sentences.push("carrying a ball inside a room makes the ball rest inside the target.");
  sentences.push("a ball renders as a sphere.");
  sentences.push("a room renders as a chamber.");
  return sentences;
}

/** gripperRuleSentences(ballCount) plus one solvable instance: every ball
 *  starts in room-a, and the goal gathers them all in room-c. */
export function gripperInstanceSentences(ballCount = 3) {
  const n = Math.max(1, Math.floor(Number(ballCount) || 1));
  const balls = Array.from({ length: n }, (_, i) => `ball-${i + 1}`);
  const sentences = gripperRuleSentences(n);
  for (const b of balls) sentences.push(`${b} rests inside room-a.`);
  sentences.push("the goal is that every ball rests inside room-c.");
  sentences.push("solve it.");
  return sentences;
}

/** The three envelope columns claim-planner.mjs measures, and (later) the
 *  benchmark-this-device button offers a visitor. `unit` names what `size`
 *  counts; `instanceSentences(size)` is the full taught sequence a fresh
 *  session runs to solve one instance. */
export const PLANNER_DOMAINS = {
  hanoi: { unit: "disks", instanceSentences: hanoiLessonSentences },
  blocksworld: { unit: "blocks", instanceSentences: blocksworldInstanceSentences },
  gripper: { unit: "balls", instanceSentences: gripperInstanceSentences },
};

/** Teach one fresh in-memory session domain's instance at `size` and solve
 *  it, over the real chat turn entry point (`createTurnSession` — the same
 *  wrapper plan-browser-entry.mjs opens its live session through). Returns
 *  `{ ms, size, solved, moves, declined }`: `moves` is the shortest plan's
 *  length or null on an honest miss (no plan within the search bound);
 *  `declined` is null when every teach sentence was accepted, or the first
 *  sentence that was not (`{ sentence, via, answer }`) — a rig that finds
 *  one mid-sweep should stop and report it rather than keep timing a
 *  half-taught domain. This is the one per-instance solve entry point every
 *  caller (this rig, a future browser button) drives through, so a visitor's
 *  timing and this claim's timing can never silently diverge. */
export async function solvePlannerInstance(domainName, size) {
  const domain = PLANNER_DOMAINS[domainName];
  if (!domain) throw new Error(`solvePlannerInstance: unknown domain "${domainName}"`);

  const memoryDir = createInMemoryStore();
  const graph = parseEntities({ individuals: [], objectProperties: [] });
  const lexicon = loadLexicon();
  const sessionId = globalThis.crypto?.randomUUID?.() ?? String(Math.random());
  const session = createTurnSession({ memoryDir, graph, lexicon, sessionId, vocabHint: "" });

  let plan = null;
  let declined = null;
  const sentences = domain.instanceSentences(size);
  const start = performance.now();
  for (const sentence of sentences) {
    const r = await session.turn(sentence);
    if (r.plan) plan = r.plan;
    const via = r.record?.via;
    if (!declined && via && via !== "assert" && via !== "plan") {
      declined = { sentence, via, answer: r.answer };
    }
  }
  const ms = performance.now() - start;

  return { ms, size, solved: Boolean(plan), moves: plan?.actions?.length ?? null, declined };
}
