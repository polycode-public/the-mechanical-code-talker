// research-queue-store.mjs — persists the "research <topic>" queue, and the
// researched-terms set a consumer dedups against, so a run started in one
// session resumes in the next: "research next" steps the queue, "research
// status" reports it, "research stop" clears it, all across process restarts.
//
// The seam is the memoryDir backend token runTurn already carries:
//   - a repo-path string (Backend A): the queue file is <repo>/.tmct/…;
//   - a sqlite handle carrying dbPath (Backend C, the CLI default): the queue
//     file is the dbPath's .tmct/ sibling;
//   - a row backend (Backend D): one bookkeeping row per queue entry;
//   - an in-memory handle (Backend B) or null (the browser session): no path
//     and no store, so persistence is a silent no-op and the in-page queue
//     behaves as before.
//
// The row path stores ENTRIES, never one blob: each queued, done or skipped
// title is its own row carrying its own status. Two turns that step the queue
// at the same time write different rows and both land, where a single shared
// value would have made the second write erase the first. A row class of
// `bookkeeping` is what keeps every one of these out of an answer: read paths
// exclude the class by field, so nothing here can compose into a reply.
//
// Fail closed: an absent, unreadable, or invalid file reads as "no run" — never
// a crash, never a fabricated queue.

import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  bookkeepingRow, bookkeepingEntries,
  BOOKKEEPING_RESEARCH_QUEUE, BOOKKEEPING_RESEARCHED_TERM,
} from "./memory/rows.mjs";
import { normFactTerm } from "../domain/hash.mjs";
import { isRowHandle } from "./memory/core.mjs";

const QUEUE_FILE = "research-queue.json";
const RESEARCHED_TERMS_FILE = "researched-terms.json";

const RUN_ENTRY = "run";
const STATUS_PENDING = "pending";
const STATUS_DONE = "done";
const STATUS_SKIPPED = "skipped";

/** A row backend bound as a memoryDir token carries its store on `impl`. */
const rowStoreOf = (memoryDir) => (isRowHandle(memoryDir) ? memoryDir.impl : null);

/** The on-disk path for one of `memoryDir`'s sidecar files, or null when this
 *  session has nowhere to persist (in-memory backend, a row backend, or a
 *  browser session with no store). A repo-path string keys off <repo>/.tmct;
 *  a store handle keys off its own dbPath's .tmct/ sibling. */
function sidecarPath(memoryDir, file) {
  if (!memoryDir) return null;
  if (typeof memoryDir === "string") return join(memoryDir, ".tmct", file);
  if (typeof memoryDir.dbPath === "string") return join(dirname(dirname(memoryDir.dbPath)), file);
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

async function readJsonFile(path) {
  let raw;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  try { return JSON.parse(raw); } catch { return null; }
}

async function writeJsonFile(path, value) {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value), "utf8");
  } catch { /* a sidecar we can't persist stays in memory for this session */ }
}

// ---- the row path -----------------------------------------------------------

/** Every bookkeeping entry of one kind the store holds. A row backend's read is
 *  the whole session partition, so the caller filters from there. */
async function readBookkeeping(impl, kind) {
  const rows = [];
  const value = await impl.readRows();
  if (Array.isArray(value)) rows.push(...value);
  else for await (const row of value) rows.push(row);
  return bookkeepingEntries(rows, kind);
}

/** The rows one queue state projects onto: the run's own scalars, then one row
 *  per title carrying that title's status and its position in its list. */
function queueRows(state) {
  const rows = [bookkeepingRow(BOOKKEEPING_RESEARCH_QUEUE, `${state.key}#${RUN_ENTRY}`, {
    runKey: state.key,
    topic: state.topic,
    title: state.title,
    limit: state.limit,
    maxDepth: state.maxDepth,
    maxTopics: state.maxTopics,
    nodeCapReached: Boolean(state.nodeCapReached),
  })];
  const entry = (title, value) => rows.push(
    bookkeepingRow(BOOKKEEPING_RESEARCH_QUEUE, `${state.key}#entry#${title}`, { runKey: state.key, ...value }),
  );
  state.pending.forEach((title, ord) => entry(title, {
    status: STATUS_PENDING, title, ord, depth: state.depths?.[normFactTerm(title)],
  }));
  state.done.forEach((d, ord) => entry(d.title, {
    status: STATUS_DONE, title: d.title, ord, facts: d.facts, depth: d.depth,
  }));
  state.skipped.forEach((title, ord) => entry(title, { status: STATUS_SKIPPED, title, ord }));
  return rows;
}

/** Rebuild a queue state from its entry rows. `pending`, `done` and `skipped`
 *  come back in each list's own recorded order, and a title's status decides
 *  which list it lands in — so a turn that marked one title done and a turn
 *  that queued another both survive, whichever order their rows arrived in. */
function queueStateFrom(entries) {
  const run = entries.find((e) => e.key.endsWith(`#${RUN_ENTRY}`))?.value;
  if (!run?.runKey) return null;
  const mine = entries
    .map((e) => e.value)
    .filter((v) => v?.runKey === run.runKey && v.status && typeof v.title === "string");
  const inOrder = (status) => mine
    .filter((v) => v.status === status)
    .sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));

  const pending = inOrder(STATUS_PENDING);
  const depths = {};
  for (const v of pending) {
    if (Number.isFinite(v.depth)) depths[normFactTerm(v.title)] = v.depth;
  }
  const state = {
    topic: run.topic, key: run.runKey, title: run.title,
    limit: run.limit, maxDepth: run.maxDepth, maxTopics: run.maxTopics,
    pending: pending.map((v) => v.title),
    depths,
    done: inOrder(STATUS_DONE).map((v) => ({ title: v.title, facts: v.facts, depth: v.depth })),
    skipped: inOrder(STATUS_SKIPPED).map((v) => v.title),
    nodeCapReached: Boolean(run.nodeCapReached),
  };
  return isQueueState(state) ? state : null;
}

async function loadRowQueue(impl) {
  return queueStateFrom(await readBookkeeping(impl, BOOKKEEPING_RESEARCH_QUEUE));
}

/** A title only ever moves forward: queued, then finished or passed over. A
 *  writer holding an older snapshot must not push a finished title back into
 *  the queue, which is what lets two turns step the same run at once and keep
 *  both results. */
const isSettled = (status) => status === STATUS_DONE || status === STATUS_SKIPPED;

/** Write the run's rows and drop only what this state actually retired: the
 *  rows of an earlier run, and any title of THIS run the state no longer
 *  mentions. A title another writer has already finished keeps that result, and
 *  a row another writer added for a title this state never saw is left alone. */
async function saveRowQueue(impl, state) {
  const stored = await readBookkeeping(impl, BOOKKEEPING_RESEARCH_QUEUE);
  const settled = new Set(stored
    .filter((e) => e.value?.runKey === state.key && isSettled(e.value?.status))
    .map((e) => e.rowKey));
  const rows = queueRows(state).filter((row) => {
    const entry = JSON.parse(row.json).value;
    return !entry.status || isSettled(entry.status) || !settled.has(row.rowKey);
  });
  const keep = new Set(rows.map((r) => r.rowKey));
  const stale = stored
    .filter((e) => !keep.has(e.rowKey) && !settled.has(e.rowKey))
    .filter((e) => e.value?.runKey !== state.key || e.key.startsWith(`${state.key}#entry#`))
    .map((e) => e.rowKey);
  await impl.putRows(rows);
  if (stale.length) await impl.deleteRows(stale);
}

async function clearRowQueue(impl) {
  const keys = (await readBookkeeping(impl, BOOKKEEPING_RESEARCH_QUEUE)).map((e) => e.rowKey);
  if (keys.length) await impl.deleteRows(keys);
}

// ---- the public surface -----------------------------------------------------

/** The persisted queue for `memoryDir`, or null when none is stored, the store
 *  cannot persist, or what is stored is missing/corrupt/ill-shaped. */
export async function loadResearchQueue(memoryDir) {
  const impl = rowStoreOf(memoryDir);
  if (impl) return loadRowQueue(impl);
  const path = sidecarPath(memoryDir, QUEUE_FILE);
  if (!path) return null;
  const state = await readJsonFile(path);
  return isQueueState(state) ? state : null;
}

/** Write-through the current queue. A null/absent state clears the store, so a
 *  stopped or completed-and-cleared run leaves nothing behind. A store with
 *  nowhere to persist is a no-op. A write that fails leaves the in-memory queue
 *  standing. */
export async function saveResearchQueue(memoryDir, state) {
  const impl = rowStoreOf(memoryDir);
  if (impl) {
    if (!state) { await clearResearchQueue(memoryDir); return; }
    try { await saveRowQueue(impl, state); } catch { /* a queue we can't persist stays in memory */ }
    return;
  }
  const path = sidecarPath(memoryDir, QUEUE_FILE);
  if (!path) return;
  if (!state) { await clearResearchQueue(memoryDir); return; }
  await writeJsonFile(path, state);
}

/** Drop the persisted queue (idempotent — an already-absent one is the cleared
 *  state we want). A store with nowhere to persist is a no-op. */
export async function clearResearchQueue(memoryDir) {
  const impl = rowStoreOf(memoryDir);
  if (impl) {
    try { await clearRowQueue(impl); } catch { /* already gone, or unreachable */ }
    return;
  }
  const path = sidecarPath(memoryDir, QUEUE_FILE);
  if (!path) return;
  try { await unlink(path); } catch { /* already gone */ }
}

/** The terms a consumer has already researched for this store, as a Set. One
 *  row per term on a row backend, so two turns marking different terms both
 *  land. Empty when nothing is stored or the store cannot persist. */
export async function loadResearchedTerms(memoryDir) {
  const impl = rowStoreOf(memoryDir);
  if (impl) {
    const entries = await readBookkeeping(impl, BOOKKEEPING_RESEARCHED_TERM);
    return new Set(entries.map((e) => e.key).filter(Boolean));
  }
  const path = sidecarPath(memoryDir, RESEARCHED_TERMS_FILE);
  if (!path) return new Set();
  const stored = await readJsonFile(path);
  return new Set(Array.isArray(stored) ? stored.filter((t) => typeof t === "string") : []);
}

/** Mark `term` researched. Additive on a row backend — its own row, so a
 *  concurrent turn marking a different term cannot erase it. */
export async function markTermResearched(memoryDir, term) {
  if (!term) return;
  const impl = rowStoreOf(memoryDir);
  if (impl) {
    try { await impl.putRows([bookkeepingRow(BOOKKEEPING_RESEARCHED_TERM, term, { term })]); }
    catch { /* a marker we can't persist costs one repeated lookup */ }
    return;
  }
  const path = sidecarPath(memoryDir, RESEARCHED_TERMS_FILE);
  if (!path) return;
  const terms = await loadResearchedTerms(memoryDir);
  if (terms.has(term)) return;
  terms.add(term);
  await writeJsonFile(path, [...terms].sort());
}
