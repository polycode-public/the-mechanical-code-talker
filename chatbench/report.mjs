// chatbench/report.mjs — renders the CEFR_ENGLISH_0NN.md write-up skeleton (and
// its transcript appendix) from a run's summary.json + product.jsonl.
//
// The skeleton carries everything mechanical — headline mean + hard-fail
// count, judge model + prompt version pin, tier-1 tallies, the per-tag table,
// the hard-fail list, the top discriminating transcripts — plus TEMPLATE
// sections the cycle write-up fills in by hand: the predictions-vs-actuals
// table, the per-lever analysis, and the RANKED LEVER BOARD decision log
// (SKILL_TUNING_CYCLE.md step 6).
//
// "Discriminating" transcripts lead the appendix: baseline improvements and
// tier-1 failures first (behavior moved), then hard fails, then lowest judged
// mean — the cases where cycles differ are the ones a reader must see first.
//
// Usage:
//   node chatbench/report.mjs --summary <summary.json> --product <product.jsonl>
//     --n <NNN> [--outdir <dir>]      (writes CEFR_ENGLISH_0NN.md + _TRANSCRIPTS.md)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fmt = (v) => (v === null || v === undefined ? "–" : String(v));
const pad3 = (n) => String(n).padStart(3, "0");

/** Sort key for "discriminating first": lower sorts earlier. */
export function discriminationRank(caseSummary, productRow) {
  if (productRow?.tier1?.improvedBaselineTurns?.length) return [0, 0]; // a documented weakness moved
  if (productRow?.tier1 && !productRow.tier1.pass) return [1, 0];      // a tier-1 failure (regression candidate)
  if (caseSummary?.hardFail) return [2, 0];
  const mean = caseSummary?.mean;
  return [3, mean === null || mean === undefined ? 2 : mean];          // lowest judged mean first
}

/** Order product rows discriminating-first (shared by both renders). */
export function orderDiscriminating(summary, rows) {
  const byId = new Map((summary.perCase || []).map((c) => [c.caseId, c]));
  return rows.slice().sort((a, b) => {
    const ra = discriminationRank(byId.get(a.caseId), a);
    const rb = discriminationRank(byId.get(b.caseId), b);
    return ra[0] - rb[0] || ra[1] - rb[1] || a.caseId.localeCompare(b.caseId);
  });
}

const mdEscape = (s) => String(s).replaceAll("|", "\\|");

function tagTable(summary) {
  const lines = [
    "| tag | cases | mean (0–2) | hard fails |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const t of summary.perTag || []) {
    lines.push(`| ${t.tag} | ${t.cases} | ${fmt(t.mean)} | ${t.hardFails} |`);
  }
  return lines.join("\n");
}

function transcriptBlock(row) {
  const lines = [];
  let session = null;
  for (const turn of row.transcript) {
    if (row.mode === "session" && turn.session !== session) {
      session = turn.session;
      lines.push(`--- session ${session} ---`);
    }
    lines.push(`> ${turn.say}`);
    lines.push(turn.answer === "" ? "(no answer recorded)" : turn.answer);
  }
  return "```\n" + lines.join("\n") + "\n```";
}

/** The CEFR_ENGLISH_0NN.md skeleton. `summary` is judge.mjs's summary.json,
 *  `rows` the product.jsonl rows, `n` the cycle number. */
export function renderReport(summary, rows, n) {
  const o = summary.overall || {};
  const tier1Fails = rows.filter((r) => r.tier1 && !r.tier1.pass);
  const improved = rows.filter((r) => r.tier1?.improvedBaselineTurns?.length);
  const hardFails = (summary.perCase || []).filter((c) => c.hardFail);
  const baselineCount = rows.filter((r) => r.tier1?.baselineFailTurns?.length).length;
  const discriminating = orderDiscriminating(summary, rows).slice(0, 5);

  return `# CEFR_ENGLISH_${pad3(n)} — chat tuning cycle ${n}

## Headline

- **Mean rubric score: ${fmt(o.mean)} / 2** over ${fmt(o.cases)} cases (**hard fails: ${fmt(o.hardFailCount)}**, voided judge samples: ${fmt(o.voidCount)}).
- Tier-1 (deterministic): ${fmt(o.tier1PassCount)}/${fmt(o.cases)} pass; ${tier1Fails.length} failing; ${baselineCount} cases carry documented baselineFail turns${improved.length ? `; **${improved.length} baseline weakness(es) IMPROVED this cycle: ${improved.map((r) => r.caseId).join(", ")}**` : ""}.
- Judge pin: **${summary.judgeModel}**, prompt **${summary.promptVersion}**, ${fmt(summary.samplesPerCase)} sample(s)/case. Run stamp: \`${fmt(summary.stamp)}\`.
- Decision rule (SKILL §1): PASS = mean up vs previous cycle AND no pass→fail regression. _<fill: PASS/FAIL vs CEFR_ENGLISH_${pad3(Math.max(n - 1, 0))}>_

## Lever applied this cycle

_<fill: the ONE lever applied, with the commit(s)>_

## Predictions vs actuals

| prediction (step 1) | predicted movement | actual movement | verdict |
| --- | --- | --- | --- |
| _<fill>_ | _<fill>_ | _<fill>_ | _<fill>_ |

## Per-tag breakdown

${tagTable(summary)}

## Hard fails (${hardFails.length})

${hardFails.length ? hardFails.map((c) => `- **${c.caseId}** (${c.tags.join(", ")}): mean ${fmt(c.mean)} — _<fill: what went wrong>_`).join("\n") : "None."}

## Tier-1 failures (${tier1Fails.length})

${tier1Fails.length ? tier1Fails.map((r) => `- **${r.caseId}**: ${r.tier1.failing.map((f) => `turn ${f.turn + 1} ${f.key} (expected ${mdEscape(JSON.stringify(f.expected))})`).join("; ")}`).join("\n") : "None."}

## Per-lever analysis

_<fill: tie the applied lever to the cases it moved (use the discriminating transcripts below + CEFR_ENGLISH_${pad3(n)}_TRANSCRIPTS.md)>_

## Top discriminating transcripts

${discriminating.map((r) => `### ${r.caseId} (${r.tags.join(", ")})\n\n${transcriptBlock(r)}`).join("\n\n")}

## RANKED LEVER BOARD (decision log)

The re-ranked next-cycle menu; the pick is named. One line of justification each.

| rank | lever (ROADMAP item) | expected movement (cases/tags) | justification |
| ---: | --- | --- | --- |
| 1 | _<fill — THE PICK>_ | _<fill>_ | _<fill>_ |
| 2 | _<fill>_ | _<fill>_ | _<fill>_ |
| 3 | _<fill>_ | _<fill>_ | _<fill>_ |

**Pick:** _<fill: the top lever, carried into the next cycle's step 1>_
`;
}

/** The transcript appendix: EVERY case, discriminating first. */
export function renderTranscripts(summary, rows, n) {
  const byId = new Map((summary.perCase || []).map((c) => [c.caseId, c]));
  const ordered = orderDiscriminating(summary, rows);
  const parts = [
    `# CEFR_ENGLISH_${pad3(n)}_TRANSCRIPTS — appendix (discriminating transcripts first)`,
    "",
    `Judge pin: ${summary.judgeModel}, prompt ${summary.promptVersion}. Run stamp: \`${fmt(summary.stamp)}\`.`,
    "",
  ];
  for (const row of ordered) {
    const c = byId.get(row.caseId);
    const flags = [
      row.tier1?.pass === false ? "TIER-1 FAIL" : null,
      row.tier1?.improvedBaselineTurns?.length ? "BASELINE IMPROVED" : null,
      row.tier1?.baselineFailTurns?.length && !row.tier1?.improvedBaselineTurns?.length ? "documented baselineFail" : null,
      c?.hardFail ? "HARD FAIL" : null,
    ].filter(Boolean);
    parts.push(`## ${row.caseId} (${row.tags.join(", ")}) — judged mean ${fmt(c?.mean)}${flags.length ? ` — ${flags.join(", ")}` : ""}`);
    parts.push("");
    parts.push(transcriptBlock(row));
    parts.push("");
  }
  return parts.join("\n");
}

function parseJsonl(text) {
  return String(text).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function parseArgs(argv) {
  const args = { outdir: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--summary") args.summary = argv[++i];
    else if (a === "--product") args.product = argv[++i];
    else if (a === "--n") args.n = Number(argv[++i]);
    else if (a === "--outdir") args.outdir = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.summary || !args.product || !Number.isInteger(args.n) || args.n < 1) {
    console.error("chatbench/report.mjs: --summary <summary.json> --product <product.jsonl> --n <cycle number> are required.");
    return 2;
  }
  const summary = JSON.parse(await readFile(args.summary, "utf8"));
  const rows = parseJsonl(await readFile(args.product, "utf8"));
  await mkdir(args.outdir, { recursive: true });
  const reportFile = join(args.outdir, `CEFR_ENGLISH_${pad3(args.n)}.md`);
  const transcriptsFile = join(args.outdir, `CEFR_ENGLISH_${pad3(args.n)}_TRANSCRIPTS.md`);
  await writeFile(reportFile, renderReport(summary, rows, args.n));
  await writeFile(transcriptsFile, renderTranscripts(summary, rows, args.n));
  console.log(`wrote ${reportFile}\nwrote ${transcriptsFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
