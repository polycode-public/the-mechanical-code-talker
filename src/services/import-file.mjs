// import-file.mjs — `tmct import --file <definition.txt>`: teach a plain-text
// definition file, one sentence at a time, through the SAME recognizers the
// live chat uses (runTurn) — no separate parser, no guessing.
//
// The report is loud on purpose: a definition file that half-teaches produces
// a planner that finds wrong plans or no plans with no visible cause, so every
// sentence's outcome is printed and any decline makes the caller exit non-zero.
//
// `#` lines are comments (skipped, counted, never "declined") — a definition
// file carries its own example prompts this way.

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { runTurn, uuidv7 } from "./chat.mjs";
import { loadMemory, readFactRows, appendFact, openMemoryBackend } from "../adapters/memory/core.mjs";
import { loadConfig } from "../adapters/config.mjs";
import { splitSentencesPreservingPaths } from "./sentences.mjs";

/**
 * Teach every sentence of `filePath` into `repoRoot`'s memory store.
 *
 * @returns {Promise<{
 *   sentences: number, taught: string[], declined: {sentence: string, reason: string}[],
 *   comments: number, report: string
 * }>}
 */
export async function importDefinitionFile(repoRoot, filePath, { env = process.env } = {}) {
  const root = resolve(repoRoot);
  const abs = resolve(root, filePath);
  const sourceTag = `import:${basename(abs)}`;
  const text = await readFile(abs, "utf8");

  const lines = text.split("\n");
  const commentLines = lines.filter((l) => l.trim().startsWith("#"));
  const body = lines.filter((l) => !l.trim().startsWith("#")).join("\n");
  const sentences = splitSentencesPreservingPaths(body);

  const { loadTomlConfig } = await import("../adapters/toml-config.mjs");
  const raw = await loadTomlConfig(root).catch(() => null);
  const backend = String(raw?.memory?.backend || "default").trim().toLowerCase();
  const { dir: memoryDir, close } = await openMemoryBackend(root, backend);
  const config = loadConfig(env, root);

  const taught = [];
  const declined = [];
  const reportLines = [`${basename(abs)} — ${sentences.length} sentence(s), ${commentLines.length} comment line(s) skipped`, ""];

  try {
    for (const sentence of sentences) {
      const before = readFactRows(await loadMemory(memoryDir));
      const beforeById = new Map(before.map((r) => [r.id, r.provenance]));
      const { record } = await runTurn(sentence, { config, memoryDir, sessionId: uuidv7() });
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
