// `tmct extract` — turn a plain text file into facts by reusing the SAME
// deterministic recognizer the interactive chat's "teach" lane already has
// (runTurn, src/services/chat.mjs) — no new NLU, no LLM, no guessing.
//
//   tmct extract <text-file> [--repo <path>] [--out <file.jsonl>]
//
// The text file is named positionally, or with --file, the way `tmct import`
// names one.
//
// How it works: the file is split into sentences with wink-nlp's own
// sentence-boundary detection (src/adapters/wink-model.mjs — the same leaf loader
// src/adapters/ask-nlp.mjs/src/adapters/prose-nlp.mjs already use; never a naive regex split).
// Each sentence is fed through runTurn() exactly as if an operator had typed
// it into the live chat. A sentence the recognizer turns into a stored fact
// (record.via === "assert", record.miss === false) is kept; every other
// sentence — a question, a fragment, a scene-setting clause, anything
// outside the recognized teach-frame surface — is silently SKIPPED. This is
// an honest partial extraction, an "attempt", never full NLU: nothing here
// ever paraphrases or invents a fact the recognizer itself didn't produce.
//
// --repo <path>   write straight into that repo's own tmct memory (runTurn's
//                 normal memoryDir write path — "grow my own tmct memory
//                 from a document").
// (no --repo)     nothing on disk is mutated. Each sentence runs against an
//                 ephemeral scratch memory dir (deleted when the run ends);
//                 whatever gets recognized is printed as ConceptNet/tmct-
//                 shape JSONL ({subject, predicate, object, provenance}) —
//                 to stdout, or to --out <file.jsonl> if given.
//
// Every recognized fact ALSO gets a second, additive provenance tag —
// extracted:<source-file-basename> — layered on top of whatever the
// recognizer itself already wrote (ace:chat:…/teach:chat:…), via appendFact's
// existing provenance UNION (memory/core.mjs). That keeps an extracted fact
// auditable as "this document evidenced this claim", distinct from live
// operator speech or a curated corpus, at its own trust-prior tier
// (SOURCE_PRIOR.extracted, memory/trust.mjs — see that file's comment for
// the reasoning: same closed-set recognizer as `teach`, but an unvetted
// source document, so it sits just above `web`).
//
// Never claims full coverage: the summary this prints always states how many
// sentences were found, how many were recognized, and how many were honestly
// skipped.

import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { runTurn, uuidv7 } from "./chat.mjs";
import { splitSentencesPreservingPaths } from "./sentences.mjs";
import { loadMemory, readFactRows, appendFact } from "../adapters/memory/core.mjs";
import { loadConfig } from "../adapters/config.mjs";
import { touchedFactRows } from "../domain/memory/touched-facts.mjs";

export const USAGE = "usage: tmct extract <text-file>|--file <text-file> [--repo <path>] [--out <file.jsonl>]";

export function parseArgs(argv) {
  const args = { file: null, repo: null, out: null };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--repo") args.repo = argv[i += 1];
    else if (a === "--out") args.out = argv[i += 1];
    else if (a === "--file") args.file = argv[i += 1];
    else rest.push(a);
  }
  args.file = args.file || rest[0] || null;
  return args;
}

/**
 * Run one already-split sentence through runTurn against `memoryDir`, and
 * report the Fact rows THIS turn actually touched. Returns { recognized, rows }
 * — `recognized` true iff runTurn's own record called this a stored assertion,
 * `rows` the Fact rows it touched (possibly empty for a Rule-only write).
 */
async function runSentence(sentence, { config, memoryDir }) {
  const before = readFactRows(await loadMemory(memoryDir));
  const { record } = await runTurn(sentence, { config, memoryDir, sessionId: uuidv7() });
  if (record?.via !== "assert" || record?.miss) return { recognized: false, rows: [] };
  const after = readFactRows(await loadMemory(memoryDir));
  return { recognized: true, rows: touchedFactRows(before, after) };
}

/**
 * `argv` defaults to the real CLI args (process.argv.slice(2)) but takes an
 * explicit array too, so a test can drive this exactly like the CLI does
 * without touching global process.argv. Returns { sentences, recognized,
 * extracted } (the same counts the printed summary reports) so a test can
 * assert on structured results instead of scraping console output.
 */
export async function main(argv = process.argv.slice(2)) {
  const { file, repo, out } = parseArgs(argv);
  if (!file) {
    console.error(USAGE);
    process.exitCode = 1;
    return { sentences: 0, recognized: 0, extracted: [] };
  }

  const filePath = resolve(process.cwd(), file);
  const text = await readFile(filePath, "utf8");
  const sourceTag = basename(filePath);
  const sentences = splitSentencesPreservingPaths(text);

  const ephemeral = !repo;
  const memoryDir = repo ? resolve(process.cwd(), repo) : await mkdtemp(join(tmpdir(), "tmct-extract-"));
  const config = loadConfig(process.env, memoryDir);

  try {
    const extracted = [];
    let recognizedSentences = 0;

    for (const sentence of sentences) {
      const { recognized, rows } = await runSentence(sentence, { config, memoryDir });
      if (!recognized || !rows.length) continue; // unrecognized shape, or a Rule (not a Fact) — skip, honest
      recognizedSentences += 1;
      const tag = `extracted:${sourceTag}`;
      for (const row of rows) {
        // Additive: layers the audit tag onto the SAME (subject, predicate,
        // object) the recognizer just stored — appendFact unions provenance
        // by id, so this never duplicates or overwrites the recognizer's own
        // ace:chat:/teach:chat: entry, and re-running this over the same
        // file/fact is idempotent (the union simply dedupes the tag).
        await appendFact(memoryDir, {
          subject: row.subject, predicate: row.predicate, object: row.object,
          provenance: tag, quantifier: row.quantifier || "",
        });
        extracted.push({
          subject: row.subject, predicate: row.predicate, object: row.object,
          provenance: tag, quantifier: row.quantifier || "", sentence,
        });
      }
    }

    if (out) {
      const body = extracted.map((f) => JSON.stringify(f)).join("\n") + (extracted.length ? "\n" : "");
      await writeFile(resolve(process.cwd(), out), body, "utf8");
    } else if (ephemeral) {
      for (const f of extracted) console.log(JSON.stringify(f));
    }

    const skipped = sentences.length - recognizedSentences;
    console.error(
      `${sentences.length} sentence${sentences.length === 1 ? "" : "s"} found, `
      + `${recognizedSentences} recognized as fact${recognizedSentences === 1 ? "" : "s"} `
      + `(${extracted.length} fact row${extracted.length === 1 ? "" : "s"}), `
      + `${skipped} skipped — not a recognized declarative shape (an honest, expected gap; this is `
      + `an attempt, not full NLU).`,
    );
    if (repo) console.error(`facts written into ${memoryDir}'s tmct memory, tagged ${sourceTag}`);
    if (out) console.error(`facts written to ${out}`);
    return { sentences: sentences.length, recognized: recognizedSentences, extracted };
  } finally {
    if (ephemeral) await rm(memoryDir, { recursive: true, force: true });
  }
}
