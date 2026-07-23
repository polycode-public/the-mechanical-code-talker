// research-queue-store.mjs — persists the "research <topic>" queue as one JSON
// file under the repo's .tmct/ (research-queue.json, beside the memory dir), so
// a run started in one CLI session resumes in the next: "research next" steps
// the queue, "research status" reports it, "research stop" clears it, all
// across process restarts. The file is per-repo and machine-local (.tmct/ is
// gitignored), exactly like the graph/sqlite store it sits next to.
//
// The seam is the memoryDir backend token runTurn already carries:
//   - a repo-path string (Backend A): the queue file is <repo>/.tmct/…;
//   - a sqlite handle carrying dbPath (Backend C, the CLI default): the queue
//     file is the dbPath's .tmct/ sibling;
//   - an in-memory handle (Backend B) or null (the browser session): no path,
//     so persistence is a silent no-op and the in-page queue behaves as before.
//
// Fail closed: an absent, unreadable, or invalid file reads as "no run" — never
// a crash, never a fabricated queue.

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const QUEUE_FILE = "research-queue.json";

/** The on-disk path for `memoryDir`'s queue file, or null when this session has
 *  nowhere to persist (in-memory backend, or a browser session with no store).
 *  A repo-path string keys off <repo>/.tmct; a store handle keys off its own
 *  dbPath's .tmct/ sibling — any handle without a real dbPath has no home. */
function researchQueuePath(memoryDir) {
  if (!memoryDir) return null;
  if (typeof memoryDir === "string") return join(memoryDir, ".tmct", QUEUE_FILE);
  if (typeof memoryDir.dbPath === "string") return join(dirname(dirname(memoryDir.dbPath)), QUEUE_FILE);
  return null;
}

/** A parsed value is a resumable queue only if it carries the run identity and
 *  the three lists the lifecycle mutates. Anything else fails closed to null. */
function isQueueState(state) {
  return !!state && typeof state === "object"
    && typeof state.topic === "string"
    && typeof state.key === "string"
    && Array.isArray(state.pending)
    && Array.isArray(state.done)
    && Array.isArray(state.skipped);
}

/** The persisted queue for `memoryDir`, or null when none is stored, the store
 *  cannot persist, or the file is missing/corrupt/ill-shaped. */
export async function loadResearchQueue(memoryDir) {
  const path = researchQueuePath(memoryDir);
  if (!path) return null;
  let raw;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  let state;
  try { state = JSON.parse(raw); } catch { return null; }
  return isQueueState(state) ? state : null;
}

/** Write-through the current queue. A null/absent state clears the file, so a
 *  stopped or completed-and-cleared run leaves nothing behind. A store with no
 *  path is a no-op. A write that fails leaves the in-memory queue standing. */
export async function saveResearchQueue(memoryDir, state) {
  const path = researchQueuePath(memoryDir);
  if (!path) return;
  if (!state) { await clearResearchQueue(memoryDir); return; }
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state), "utf8");
  } catch { /* a queue we can't persist stays in memory for this session */ }
}

/** Delete the persisted queue file (idempotent — an already-absent file is the
 *  cleared state we want). A store with no path is a no-op. */
export async function clearResearchQueue(memoryDir) {
  const path = researchQueuePath(memoryDir);
  if (!path) return;
  try { await unlink(path); } catch { /* already gone */ }
}
