// news-store.mjs — persists the news capability's whole runtime state (feed
// snapshots, the fact-ungrounded-term ledger, per-source health, the request
// log, cycle metrics) as one JSON file under the repo's .tmct/
// (news-state.json, beside the memory dir and research-queue.json), mirroring
// research-queue-store.mjs exactly: a Node CLI session's poll history and
// enrichment ledger survive a restart, while a browser session persists the
// same state object inside its own IndexedDB snapshot instead.
//
// The seam is the memoryDir backend token runTurn already carries:
//   - a repo-path string (Backend A): the state file is <repo>/.tmct/…;
//   - a sqlite handle carrying dbPath (Backend C, the CLI default): the state
//     file is the dbPath's .tmct/ sibling;
//   - an in-memory handle (Backend B) or null (the browser session): no
//     path, so persistence is a silent no-op.
//
// Fail closed: an absent, unreadable, or invalid file reads as "no state" —
// never a crash, never a fabricated one.

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_FILE = "news-state.json";

// requestLog is newest-first (PLAN_NEWS_FEED.md section 9.4); capping here,
// at the point of persistence, keeps the file bounded regardless of how much
// a caller appended to it in memory during one run.
const REQUEST_LOG_CAP = 200;

/** The on-disk path for `memoryDir`'s news state file, or null when this
 *  session has nowhere to persist — the same resolution research-queue-store
 *  uses for research-queue.json. */
function newsStatePath(memoryDir) {
  if (!memoryDir) return null;
  if (typeof memoryDir === "string") return join(memoryDir, ".tmct", STATE_FILE);
  if (typeof memoryDir.dbPath === "string") return join(dirname(dirname(memoryDir.dbPath)), STATE_FILE);
  return null;
}

/** A parsed value is a resumable news state only if it carries the five
 *  lists/objects every reader and writer below expects. Anything else fails
 *  closed to null. */
function isNewsState(state) {
  return !!state && typeof state === "object"
    && Array.isArray(state.items)
    && !!state.ledger && typeof state.ledger === "object" && Array.isArray(state.ledger.terms)
    && Array.isArray(state.health)
    && Array.isArray(state.requestLog)
    && Array.isArray(state.metrics);
}

/** The persisted news state for `memoryDir`, or null when none is stored,
 *  the store cannot persist, or the file is missing/corrupt/ill-shaped. */
export async function loadNewsState(memoryDir) {
  const path = newsStatePath(memoryDir);
  if (!path) return null;
  let raw;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  let state;
  try { state = JSON.parse(raw); } catch { return null; }
  return isNewsState(state) ? state : null;
}

/** Write-through the current state, capping requestLog to its newest
 *  REQUEST_LOG_CAP rows on the way out. A null/absent state clears the file.
 *  A store with no path is a no-op. A write that fails leaves the in-memory
 *  state standing. */
export async function saveNewsState(memoryDir, state) {
  const path = newsStatePath(memoryDir);
  if (!path) return;
  if (!state) { await clearNewsState(memoryDir); return; }
  const capped = {
    ...state,
    requestLog: Array.isArray(state.requestLog) ? state.requestLog.slice(0, REQUEST_LOG_CAP) : [],
  };
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(capped), "utf8");
  } catch { /* a state we can't persist stays in memory for this session */ }
}

/** Delete the persisted news state file (idempotent). A store with no path
 *  is a no-op. */
export async function clearNewsState(memoryDir) {
  const path = newsStatePath(memoryDir);
  if (!path) return;
  try { await unlink(path); } catch { /* already gone */ }
}
