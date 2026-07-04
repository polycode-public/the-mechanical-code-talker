// sessions.mjs — chat sessions as first-class temporal graph data, like commits.
//
// A `tmct chat` session leaves two artifacts under the target repo:
//   .tmct/session-<uuidv7>.log            — the human-readable transcript (chat.mjs)
//   .tmct/sessions/session-<uuidv7>.jsonl — the STRUCTURED sidecar this module owns:
//     {"type":"session", id, started, repo, tmctVersion}        (header line)
//     {"type":"turn", ts, query, resolvedIds, answeredIds, miss}  (one per turn, flushed)
//     {"type":"end", ts}                                          (clean close marker)
//
// From the sidecar the session enters the typed graph twice:
//   - READ TIME (chat.mjs, per turn): appendSessionToGraph() upserts one `Session`
//     individual (`session:<uuidv7>`) + `mgx:asksAbout` edges into graph.json —
//     atomically (temp + rename), re-reading the file first so a re-index that
//     happened mid-session is tolerated: edges whose targets vanished are dropped,
//     never left dangling (honest degradation).
//   - REBUILD (any future graph writer): readSessionRecords() + foldInSessions()
//     re-attach every recorded session to a FRESH graph, re-resolving each recorded
//     entity id (by id first, then by unique label derived from the id shape);
//     unresolvable references are dropped and counted on the session node
//     (mgx:sessionDroppedEdges) — never a guessed edge.
//
// Sessions are runtime observations, not source derivations: they record what a human
// asked the graph about and which entities answered, so re-indexing re-attaches them
// rather than re-deriving them from source.

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SESSIONS_DIR_REL = join(".tmct", "sessions");

export const SESSION_CLASS = "Session";
export const ASKS_ABOUT_PREDICATE = "asksAbout";
export const ASKS_ABOUT_PROP = "mgx:asksAbout";

const QUERIES_ATTR_CAP = 500; // joined-queries attribute cap (mirrors commitMessage's cap idea)

/** Session labels mirror Commit's short-sha convention: the uuid's leading time-ordered hex. */
const sessionLabel = (id) => String(id).slice(0, 8);

/** Best-effort label a recorded entity id would carry, derived from the id shape —
 *  the "then by label" tier of fold-in re-resolution (ids are `mod:<path>`,
 *  `fn:<path>#<name>`, `commit:<sha>`; labels are path / name / short sha). */
function labelFromId(id) {
  const s = String(id);
  if (s.startsWith("mod:")) return s.slice(4);
  const fn = s.match(/^fn:.*#(.+)$/);
  if (fn) return fn[1];
  if (s.startsWith("commit:")) return s.slice(7, 19);
  return null;
}

/** Atomic JSON write: temp file in the same directory + rename, so a concurrent
 *  reader never sees a torn graph.json and a crash never destroys the old one. */
async function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, JSON.stringify(obj));
  await rename(tmp, file);
}

/**
 * Upsert one session record into an `entities` payload (mutates; pure of I/O).
 * Shared by the read-time append AND the re-index fold-in, so both resolve and
 * degrade identically:
 *   - a prior copy of the same session (per-turn re-appends) is replaced;
 *   - every recorded ref resolves by id, else by UNIQUE label (ambiguous → drop);
 *   - dropped refs are counted on the session node, never guessed into edges.
 * Record shape: { id, started, ended?, turns: [{ts, query, resolvedIds, answeredIds, miss}] }.
 * Returns { kept, dropped }.
 */
export function upsertSession(entities, record) {
  const sid = `session:${record.id}`;
  entities.individuals ||= [];
  entities.objectProperties ||= [];

  // replace any prior copy of this session (read-time appends run once per turn)
  entities.individuals = entities.individuals.filter((i) => i?.id !== sid);
  let group = entities.objectProperties.find((g) => g?.prop === ASKS_ABOUT_PROP);
  if (group) {
    group.examples = (group.examples || []).filter((e) => e?.subject !== sid);
  } else {
    group = { predicate: ASKS_ABOUT_PREDICATE, prop: ASKS_ABOUT_PROP, count: 0, examples: [] };
    entities.objectProperties.push(group);
  }

  // resolve refs against the CURRENT individuals — by id, then by unique label
  const byId = new Map();
  const byLabel = new Map(); // label -> id, or null when ambiguous
  for (const i of entities.individuals) {
    if (!i?.id) continue;
    byId.set(i.id, i);
    if (i.label) byLabel.set(i.label, byLabel.has(i.label) ? null : i.id);
  }
  const turns = Array.isArray(record.turns) ? record.turns : [];
  const refs = [...new Set(turns.flatMap((t) => [...(t?.resolvedIds || []), ...(t?.answeredIds || [])]))];
  const targets = [];
  let dropped = 0;
  for (const ref of refs) {
    if (byId.has(ref)) { targets.push(ref); continue; }
    const cand = labelFromId(ref);
    const viaLabel = cand ? byLabel.get(cand) : undefined;
    if (viaLabel) { targets.push(viaLabel); continue; }
    dropped += 1; // vanished or ambiguous — an honest drop, never a dangling/guessed edge
  }

  const started = record.started || "";
  const ended = record.ended || turns.at(-1)?.ts || started;
  const queries = turns.map((t) => String(t?.query || "")).filter(Boolean);
  const label = sessionLabel(record.id);
  entities.individuals.push({
    id: sid, label, class: SESSION_CLASS,
    derived_from: [], mentions: [],
    attributes: [
      { prop: "mgx:sessionStarted", key: "started", value: started },
      { prop: "mgx:sessionEnded", key: "ended", value: ended },
      { prop: "mgx:sessionTurns", key: "turns", value: String(turns.length) },
      ...(queries.length ? [{ prop: "mgx:sessionQueries", key: "queries", value: queries.join(" | ").slice(0, QUERIES_ATTR_CAP) }] : []),
      ...(dropped ? [{ prop: "mgx:sessionDroppedEdges", key: "dropped", value: String(dropped) }] : []),
    ],
  });
  for (const t of targets) {
    group.examples.push({ subject: sid, object: t, subjectLabel: label, objectLabel: byId.get(t)?.label || t });
  }
  group.count = group.examples.length;

  // classes[] + vocabulary[] entries appear ONLY once a session exists, so a
  // session-less graph stays byte-identical to what buildEntities always produced.
  const sessions = entities.individuals.filter((i) => i.class === SESSION_CLASS);
  if (Array.isArray(entities.classes)) {
    let cls = entities.classes.find((c) => c?.name === SESSION_CLASS);
    if (!cls) { cls = { name: SESSION_CLASS, count: 0, sample: [] }; entities.classes.push(cls); }
    cls.count = sessions.length;
    cls.sample = sessions.slice(0, 3).map((i) => i.label);
  }
  if (Array.isArray(entities.vocabulary) && !entities.vocabulary.some((v) => v?.prop === ASKS_ABOUT_PROP)) {
    entities.vocabulary.push({
      prop: ASKS_ABOUT_PROP, predicate: ASKS_ABOUT_PREDICATE,
      note: "chat Session → entity a turn resolved/answered with; runtime observation, owned (no SEON term)",
    });
  }
  return { kept: targets.length, dropped };
}

/** Read-time append (chat.mjs, once per turn): re-read graph.json FRESH (a re-index
 *  may have replaced it mid-session), upsert, write back atomically. A MISSING
 *  artifact is the empty-graph bootstrap: seed a minimal valid payload so the
 *  conversation itself becomes the first graph write. Still throws on an invalid
 *  (unparseable) artifact — the caller treats the append as best-effort. */
export async function appendSessionToGraph(graphFile, record) {
  let text = null;
  try {
    text = await readFile(graphFile, "utf8");
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
  }
  let entities;
  if (text === null) {
    entities = { generated_at: "", classes: [], vocabulary: [], objectProperties: [], individuals: [], proseIndex: {} };
    await mkdir(dirname(graphFile), { recursive: true });
  } else {
    entities = JSON.parse(text);
  }
  const res = upsertSession(entities, record);
  await atomicWriteJson(graphFile, entities);
  return res;
}

/** Parse one sidecar .jsonl into a session record (null if no valid header).
 *  Torn/partial trailing lines (a killed session) are skipped, not fatal. */
export function parseSessionJsonl(text) {
  let header = null;
  let ended = "";
  const turns = [];
  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  for (const line of String(text).split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    if (rec?.type === "session" && !header) header = rec;
    else if (rec?.type === "turn") {
      turns.push({
        ts: String(rec.ts || ""), query: String(rec.query || ""),
        resolvedIds: arr(rec.resolvedIds), answeredIds: arr(rec.answeredIds), miss: !!rec.miss,
      });
    } else if (rec?.type === "end") ended = String(rec.ts || "") || ended;
  }
  if (!header?.id) return null;
  return { id: String(header.id), started: String(header.started || ""), ended, turns };
}

/** All recorded sessions under <rootDir>/.tmct/sessions/*.jsonl, oldest first
 *  (uuidv7 filenames sort chronologically). Best-effort: no dir → []. */
export async function readSessionRecords(rootDir) {
  const dir = join(rootDir, SESSIONS_DIR_REL);
  let names;
  try { names = await readdir(dir); } catch { return []; }
  const records = [];
  for (const name of names.filter((n) => n.endsWith(".jsonl")).sort()) {
    try {
      const rec = parseSessionJsonl(await readFile(join(dir, name), "utf8"));
      if (rec) records.push(rec);
    } catch { /* unreadable sidecar — skip, never fail an index run */ }
  }
  return records;
}

/** Re-index fold-in: attach every recorded session to a FRESH entities payload.
 *  Sessions are runtime observations, not source derivations — they are re-attached
 *  after the source-derived build, with every reference re-resolved against the new
 *  graph (upsertSession's id-then-label tiers; unresolvable → dropped + counted). */
export function foldInSessions(entities, records) {
  let kept = 0;
  let dropped = 0;
  for (const rec of records || []) {
    const r = upsertSession(entities, rec);
    kept += r.kept;
    dropped += r.dropped;
  }
  return { sessions: (records || []).length, kept, dropped };
}
