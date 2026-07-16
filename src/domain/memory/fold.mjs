// memory/fold.mjs — the pure cleaning rules a session log passes through on its
// way into the text-block corpus: pair each turn with its answer prose, drop
// slash-commands, filler and misses, and render what survives as corpus text.
//
// Pure by construction — the reading, writing and speculative pass live in
// services/fold.mjs, which calls cleanSessionText below.

import { turnKey } from "./session-turns.mjs";

/** Conversational filler a transcript doesn't need: greetings, thanks, byes,
 *  bare acknowledgements. Catches the one-liners chat.mjs did NOT flag
 *  `conversational` (e.g. typed straight at an older tmct). */
const FILLER_RE = new RegExp(
  "^(?:(?:hi|hiya|hello|hey|yo|howdy)(?:\\s+there)?|good\\s*(?:morning|afternoon|evening)|" +
    "thanks(?:\\s+(?:a\\s+lot|so\\s+much))?|thank\\s*you|thx|ty|cheers|" +
    "ok(?:ay)?|cool|nice|great|sure|yes|no|yep|nope|" +
    "bye(?:\\s+bye)?|goodbye|see\\s*(?:ya|you)|later)[\\s!.?,]*$",
  "i",
);

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** The grammar wall's opening line. Source of truth: chat.mjs's WALL_MISS_RE —
 *  repeated here as a one-line local anchor so the memory layer stays decoupled
 *  from the chat surface. Checked on squashed (single-line) answer text. */
const WALL_ANSWER_RE = /^couldn't parse this as a graph question\. Try:/;
/** chat.mjs's recall frame preamble. An answer carrying it is a REPLAY of an
 *  earlier session (possibly with the wall appended below it), never fresh
 *  content — folding it would nest recalls-of-recalls. */
const RECALL_PREAMBLE_RE = /you asked about this before/;

/**
 * Clean one parsed session record into corpus text (pure). `answers` is
 * parseSessionLog()'s Map (may be empty — a vanished transcript degrades to
 * question-only lines, honestly, rather than losing the session).
 * Returns "" when nothing survives.
 */
export function cleanSessionText(record, answers = new Map()) {
  const parts = [];
  for (const t of record?.turns || []) {
    const query = squash(t?.query);
    if (!query) continue;
    if (t.command || query.startsWith("/")) continue; // slash-commands + their outputs
    if (t.conversational || FILLER_RE.test(query)) continue; // greetings/thanks/bye
    if (t.miss) continue; // honest-miss boilerplate is not corpus content
    const answer = squash(answers.get(turnKey(t.ts, t.query)));
    // Belt-and-braces recall hygiene: even when a turn was NOT recorded as a
    // miss, a grammar-wall answer or a recall replay never re-enters the
    // corpus — re-folding also cleans stores poisoned by older builds.
    if (WALL_ANSWER_RE.test(answer) || RECALL_PREAMBLE_RE.test(answer)) continue;
    parts.push(answer ? `Q: ${query}\nA: ${answer}` : `Q: ${query}`);
  }
  return parts.join("\n");
}
