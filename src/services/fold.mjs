// fold.mjs — session-log cleaning → corpus folding, the I/O half. Reads the
// structured sidecars (.tmct/sessions/*.jsonl), pairs each turn with its answer
// prose from the human transcript, hands both to the pure cleaner, and writes
// ONE text block per session into blocks.mjs's store (block id = session id, so
// re-folding upserts rather than duplicates).
//
// The cleaning rules themselves are pure and live in domain/memory/fold.mjs;
// everything that touches the filesystem or the store lives here.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SESSIONS_DIR_REL, parseSessionJsonl, parseSessionLog } from "./sessions.mjs";
import { removeBlock, saveBlock } from "../adapters/memory/blocks.mjs";
import {
  FACT_CLASS, appendCanonicalisedFromEdges, appendFacts, loadMemory,
  openConfiguredMemoryBackend, readFactRows,
} from "../adapters/memory/core.mjs";
import { cleanSessionText } from "../domain/memory/fold.mjs";
import { syllogise } from "../domain/syllogise.mjs";

// chat.mjs's SESSION_LOG_DIR — repeated here (a one-word constant) rather than
// importing the whole chat surface into the fold.
const LOG_DIR_REL = ".tmct";

// ---- Canonise + link + speculative pass ----------------------------------
// Both hang off the fold seam — tmct's natural idle moment (the human has stopped
// talking; we know exactly what the session touched). They are offline, $0,
// best-effort side effects: a failure NEVER fails the fold.

/** CANONISE + LINK, never replace: for each Fact whose provenance names a
 *  `ace:chat:<sessionId>@<ts>` utterance, add an mgx:canonicalisedFrom edge
 *  Fact -> Utterance (the utterance itself is left verbatim). `memoryDir` is
 *  the already-opened store handle — the write goes through the store seam,
 *  never a direct graph-file write. Returns { linked, focus } — `focus` seeds
 *  the speculative pass below. */
async function canoniseLinkSession(memoryDir, sessionId) {
  const focus = new Set();
  const memory = await loadMemory(memoryDir);
  const individuals = memory.individuals || [];
  if (!individuals.length) return { linked: [], focus };
  const uttById = new Map(individuals.filter((i) => i?.class === "Utterance").map((i) => [i.id, i]));
  const factById = new Map(individuals.filter((i) => i?.class === FACT_CLASS).map((i) => [i.id, i]));
  const prefix = `ace:chat:${sessionId}@`;

  const links = [];
  const seen = new Set();
  for (const r of readFactRows(memory)) {
    for (const tag of String(r.provenance || "").split(" | ")) {
      if (!tag.startsWith(prefix)) continue;
      const ts = tag.slice(prefix.length);
      if (!ts) continue;
      const uttId = `utt:${sessionId}#${ts}#visitor`;
      const utt = uttById.get(uttId);
      if (!utt) continue; // never a dangling edge — honest drop
      if (r.subject) focus.add(r.subject);
      if (r.object) focus.add(r.object);
      const key = `${r.id} ${uttId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ factId: r.id, factLabel: factById.get(r.id)?.label || r.id, uttId, uttLabel: utt.label || uttId });
    }
  }
  if (links.length) await appendCanonicalisedFromEdges(memoryDir, links);
  return { linked: links, focus };
}

/** The fold-time idle pass (best-effort): open the repo's configured memory
 *  backend once (the fold only ever has the repo path in hand — its callers
 *  are file-level), canonise-link each folded session through it, then run one
 *  bounded speculative pass scoped to the union footprint (empty footprint ->
 *  skipped). Never throws — must never fail a fold. */
async function speculateOverSessions(repoDir, sessionIds) {
  try {
    const { dir: memoryDir, close } = await openConfiguredMemoryBackend(repoDir);
    try {
      const focus = new Set();
      for (const sid of sessionIds) {
        const { focus: f } = await canoniseLinkSession(memoryDir, sid);
        for (const t of f) focus.add(t);
      }
      if (focus.size) await syllogise(memoryDir, { focus, store: { loadMemory, readFactRows, appendFacts } });
    } finally {
      await close();
    }
  } catch { /* offline best-effort: a fold never fails on the speculative pass */ }
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
  const processed = []; // every session we parsed (folded or not) — the speculative footprint
  let skipped = 0;
  for (const name of names) {
    try {
      const record = parseSessionJsonl(await readFile(join(dir, name), "utf8"));
      if (!record) { skipped += 1; continue; }
      processed.push(record.id);
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
  // Idle seam: canonise-link the folded sessions' facts to their as-spoken
  // utterances and run one bounded, focus-scoped speculative pass.
  // A side effect on the memory graph only — the fold's return shape is unchanged.
  await speculateOverSessions(repoDir, processed);
  return { folded, removed, skipped };
}
