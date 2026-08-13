// import-file.mjs — `tmct import --file <definition.txt|facts.jsonl>`: teach a
// definition file into a repo's memory. A plain-text file is taught one
// sentence at a time through the SAME recognizers the live chat uses (runTurn)
// — no separate parser, no guessing. A JSONL file (the shape `tmct extract` and
// `tmct memory --export` emit — one {subject, predicate, object, provenance}
// object per line) loads each fact straight into the store, so an exported
// triple-store round-trips back in with its provenance intact.
//
// The report is loud on purpose: a definition file that half-teaches produces
// a planner that finds wrong plans or no plans with no visible cause, so every
// line's outcome is printed and any decline makes the caller exit non-zero.
//
// `#` lines are comments (skipped, counted, never "declined") — a definition
// file carries its own example prompts this way.

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { runTurn, uuidv7 } from "./chat.mjs";
import { loadMemory, readFactRows, appendFact, appendFacts, openConfiguredMemoryBackend } from "../adapters/memory/core.mjs";
import { loadConfig } from "../adapters/config.mjs";
import { splitSentencesPreservingPaths } from "./sentences.mjs";

/** A body line as a stored fact, or null when it is not a JSONL fact object.
 *  A fact line JSON-parses to an object carrying string subject/predicate/
 *  object; anything else (a plain sentence, malformed JSON, a JSON array) is
 *  not one. */
function parseFactLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!record || typeof record !== "object") return null;
  const { subject, predicate, object } = record;
  if (typeof subject !== "string" || typeof predicate !== "string" || typeof object !== "string") return null;
  if (!subject || !predicate || !object) return null;
  return {
    subject, predicate, object,
    provenance: typeof record.provenance === "string" ? record.provenance : "",
    quantifier: typeof record.quantifier === "string" ? record.quantifier : "",
  };
}

/**
 * Teach every sentence of `filePath` into `repoRoot`'s memory store.
 *
 * @returns {Promise<{
 *   sentences: number, taught: string[], declined: {sentence: string, reason: string}[],
 *   comments: number, report: string
 * }>}
 */
export async function importDefinitionFile(repoRoot, filePath, { env = process.env, memoryDir: injectedMemoryDir = null } = {}) {
  const root = resolve(repoRoot);
  const abs = resolve(root, filePath);
  const sourceTag = `import:${basename(abs)}`;
  const text = await readFile(abs, "utf8");

  const lines = text.split("\n");
  const commentLines = lines.filter((l) => l.trim().startsWith("#"));
  const bodyLines = lines.filter((l) => !l.trim().startsWith("#"));
  const body = bodyLines.join("\n");

  // A file whose every non-blank body line is a JSONL fact object is a
  // triple-store dump, not prose — import each fact directly, keeping its own
  // provenance, rather than pushing "{...}" through the sentence recognizer
  // (which would decline it). This is the return leg for `tmct memory --export`
  // and the browser pages' fact download.
  const nonBlankBody = bodyLines.filter((l) => l.trim());
  const factLines = nonBlankBody.map(parseFactLine);
  const isFactFile = nonBlankBody.length > 0 && factLines.every(Boolean);

  // An injected handle (a caller mid-session, or a build script pinned to the
  // in-memory backend) is used as-is and left open — the caller owns it.
  const opened = injectedMemoryDir ? null : await openConfiguredMemoryBackend(root, env);
  const memoryDir = injectedMemoryDir ?? opened.dir;
  const close = opened ? opened.close : async () => {};

  if (isFactFile) {
    const importReport = [`${basename(abs)} — ${factLines.length} fact(s), ${commentLines.length} comment line(s) skipped`, ""];
    // One batched write for the whole dump — a triple export can carry every
    // seed fact, so a per-fact loop (load+write each) would be quadratic.
    try {
      await appendFacts(memoryDir, factLines.map((fact) => ({
        subject: fact.subject, predicate: fact.predicate, object: fact.object,
        provenance: fact.provenance || sourceTag, quantifier: fact.quantifier,
      })));
    } finally {
      await close();
    }
    const imported = factLines.map((fact) => `${fact.subject} ${fact.predicate} ${fact.object}`);
    // A triple dump can carry tens of thousands of facts, so the per-line echo
    // is capped — enough to show the shape, not a wall that overflows a caller's
    // output buffer.
    const LIST_CAP = 20;
    for (const rendered of imported.slice(0, LIST_CAP)) importReport.push(`  imported — ${rendered}`);
    if (imported.length > LIST_CAP) importReport.push(`  … and ${imported.length - LIST_CAP} more fact(s)`);
    importReport.push("", `${imported.length} fact(s) imported, 0 declined, ${commentLines.length} comment line(s) skipped`);
    return { sentences: factLines.length, taught: imported, declined: [], comments: commentLines.length, report: importReport.join("\n") };
  }

  const sentences = splitSentencesPreservingPaths(body);
  const config = loadConfig(env, root);

  const taught = [];
  const declined = [];
  const reportLines = [`${basename(abs)} — ${sentences.length} sentence(s), ${commentLines.length} comment line(s) skipped`, ""];

  try {
    for (const sentence of sentences) {
      const before = readFactRows(await loadMemory(memoryDir));
      const beforeById = new Map(before.map((r) => [r.id, r.provenance]));
      const { record } = await runTurn(sentence, { config, memoryDir, sessionId: uuidv7(), ingested: true });
      const ok = record?.via === "assert" && !record?.miss;
      if (!ok) {
        const reason = String(record?.answer || "").split("\n")[0] || "not a recognized declarative shape";
        declined.push({ sentence, reason });
        reportLines.push(`  DECLINED — ${sentence} — ${reason}`);
        continue;
      }
      taught.push(sentence);
      reportLines.push(`  taught — ${sentence}`);
      // Layer the additive audit tag onto the fact rows this sentence touched
      // (appendFact unions provenance by id — re-import is idempotent). Rule
      // teaches touch no fact rows; the Rule's own provenance already names
      // the teach source.
      const after = readFactRows(await loadMemory(memoryDir));
      const touched = after.filter((r) => beforeById.get(r.id) !== r.provenance);
      for (const row of touched) {
        await appendFact(memoryDir, {
          subject: row.subject, predicate: row.predicate, object: row.object,
          provenance: sourceTag, quantifier: row.quantifier || "",
        });
      }
    }
  } finally {
    await close();
  }

  reportLines.push("");
  reportLines.push(
    `${taught.length} taught, ${declined.length} declined, ${commentLines.length} comment line(s) skipped`
    + (declined.length ? " — a half-taught game plans wrongly or not at all; fix the declined sentence(s) and re-import" : ""),
  );
  return { sentences: sentences.length, taught, declined, comments: commentLines.length, report: reportLines.join("\n") };
}
