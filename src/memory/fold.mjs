// memory/fold.mjs — session-log cleaning → corpus folding (ROADMAP item 9).
//
// A raw chat session is noisy: slash-commands and their dumps, greetings,
// thanks, honest misses. foldSessionLogs() reads the structured sidecars
// (.tmct/sessions/*.jsonl), pairs each turn with its answer PROSE from the
// human transcript (.tmct/session-<id>.log — the only artifact carrying answer
// text), cleans the turns, and writes ONE text block per session into
// blocks.mjs's store. Cleaning rules:
//   - slash-command turns (and therefore their outputs) are dropped;
//   - conversational filler is dropped — both turns chat.mjs already flagged
//     `conversational` and unflagged greeting/thanks/bye one-liners;
//   - miss turns are dropped (their answer is the honest-miss boilerplate —
//     the memory GRAPH still records them as utterances; the corpus doesn't);
//   - surviving Q/A pairs are whitespace-normalized into "Q: …\nA: …" lines.
//
// Idempotent by construction: the block id IS the session id, and
// blocks.saveBlock() replaces on the same id — re-folding a session updates
// its block, never duplicates it. A session that cleans down to nothing writes
// no block (and removes a stale one), so the corpus never holds empty blocks.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSIONS_DIR_REL, parseSessionJsonl, parseSessionLog, turnKey } from "../sessions.mjs";
import { removeBlock, saveBlock } from "./blocks.mjs";

// chat.mjs's SESSION_LOG_DIR — repeated here (a one-word constant) rather than
// importing the whole chat surface into the memory layer.
const LOG_DIR_REL = ".tmct";

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
    parts.push(answer ? `Q: ${query}\nA: ${answer}` : `Q: ${query}`);
  }
  return parts.join("\n");
}

/**
 * Fold recorded session logs into the text-block corpus. Reads every
 * .tmct/sessions/*.jsonl sidecar under `repoDir` (or just `sessionId`'s),
 * cleans it, and upserts one block per session (block id = session id).
 * Best-effort per session — an unreadable sidecar or missing transcript never
 * fails the fold. Returns { folded: [ids], removed: [ids], skipped: n }.
 */
export async function foldSessionLogs(repoDir, { sessionId = null } = {}) {
  const dir = join(repoDir, SESSIONS_DIR_REL);
  let names;
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".jsonl")).sort();
  } catch {
    return { folded: [], removed: [], skipped: 0 };
  }
  if (sessionId) names = names.filter((n) => n === `session-${sessionId}.jsonl`);

  const folded = [];
  const removed = [];
  let skipped = 0;
  for (const name of names) {
    try {
      const record = parseSessionJsonl(await readFile(join(dir, name), "utf8"));
      if (!record) { skipped += 1; continue; }
      let answers = new Map();
      try {
        answers = parseSessionLog(await readFile(join(repoDir, LOG_DIR_REL, `session-${record.id}.log`), "utf8"));
      } catch { /* transcript gone — fold question-only, honestly */ }
      const text = cleanSessionText(record, answers);
      if (text) {
        await saveBlock(repoDir, { id: record.id, text });
        folded.push(record.id);
      } else if (await removeBlock(repoDir, record.id)) {
        removed.push(record.id); // the session re-cleaned down to nothing — stale block gone
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1; // one bad session never fails the fold
    }
  }
  return { folded, removed, skipped };
}
