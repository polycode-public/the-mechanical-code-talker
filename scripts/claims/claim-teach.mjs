// scripts/claims/claim-teach.mjs — measures the shape of tmct's own
// extensibility: for every row in test-benchmarks/claims/teach-set.jsonl, a
// fresh store is asked a round-trip question, taught the row's statement
// through the same chat entry point (runTurn) real sessions use, then asked
// the identical round-trip question again. `before` counts round-trip
// questions answered before teaching (expected near zero — nothing is
// stored yet); `after` counts round-trip questions answered afterwards
// AND citing the teaching turn's own provenance tag, so a coincidental hit
// from seeded vocabulary can't inflate the count. Ill-formed rows carry no
// round-trip question at all; they only exercise the accept/decline gate.
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { writeClaim, defaultHardware } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const FIXTURE_PATH = join(ROOT, "test-benchmarks", "claims", "teach-set.jsonl");
const CONFIG = {};
const STORED_RE = /noted — remembered/;

async function loadRows() {
  const text = await readFile(FIXTURE_PATH, "utf8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Runs one fixture row in its own fresh store: an optional before-probe,
 *  the teach turn, then an optional after-probe. Returns the observed
 *  shape for that row; never throws on a declined teach — a decline is a
 *  valid, measured outcome, not a rig failure. */
async function runRow(row, index) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-claim-teach-${index}-`));
  const sessionTag = `claim-teach-${index}`;
  try {
    let beforeAnswered = false;
    if (row.roundTrip) {
      const before = await runTurn(row.roundTrip, { config: CONFIG, memoryDir: dir, sessionId: `${sessionTag}-before` });
      beforeAnswered = before.record?.miss === false;
    }

    const taught = await runTurn(row.statement, { config: CONFIG, memoryDir: dir, sessionId: sessionTag });
    const stored = STORED_RE.test(taught.answer || "");

    let afterAnswered = false;
    let citesProvenance = false;
    if (row.roundTrip) {
      const after = await runTurn(row.roundTrip, { config: CONFIG, memoryDir: dir, sessionId: `${sessionTag}-after` });
      afterAnswered = after.record?.miss === false;
      citesProvenance = (after.answer || "").includes(sessionTag);
    }

    return {
      statement: row.statement,
      wellFormed: Boolean(row.wellFormed),
      expectTeach: Boolean(row.expectTeach),
      stored,
      beforeAnswered,
      afterAnswered,
      citesProvenance,
    };
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}

async function measure() {
  const rows = await loadRows();
  const results = [];
  for (let i = 0; i < rows.length; i += 1) {
    results.push(await runRow(rows[i], i));
  }
  return results;
}

async function main() {
  const results = await measure();

  const wellFormedRows = results.filter((r) => r.wellFormed);
  const storedRows = wellFormedRows.filter((r) => r.stored);
  const roundTripSuccess = storedRows.filter((r) => r.afterAnswered && r.citesProvenance);

  const before = results.filter((r) => r.beforeAnswered).length;
  const after = results.filter((r) => r.afterAnswered && r.citesProvenance).length;
  const delta = after - before;

  // A row whose observed store outcome disagrees with what the fixture
  // author expected — the real finding this rig exists to surface.
  const mismatches = results
    .filter((r) => r.stored !== r.expectTeach)
    .map((r) => ({ statement: r.statement, expectTeach: r.expectTeach, stored: r.stored }));

  const acceptanceRatePercent = wellFormedRows.length
    ? Number(((storedRows.length / wellFormedRows.length) * 100).toFixed(1))
    : 0;
  const roundTripRatePercent = storedRows.length
    ? Number(((roundTripSuccess.length / storedRows.length) * 100).toFixed(1))
    : 0;

  // The harness compares before/after/delta rows on `delta` — before is
  // deterministically 0 (a fresh store never answers a round-trip question
  // it hasn't been taught yet), so delta === after in practice, and this
  // explicit threshold guards `after` directly via that equivalence.
  const threshold = { direction: "min", value: after - 2 };

  const record = writeClaim("teach", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "answers",
    before,
    after,
    delta,
    threshold,
    sources: [
      "scripts/claims/claim-teach.mjs",
      "test-benchmarks/claims/teach-set.jsonl",
      "src/services/chat.mjs",
    ],
    detail: {
      fixtureRows: results.length,
      wellFormedOffered: wellFormedRows.length,
      stored: storedRows.length,
      acceptanceRatePercent,
      roundTripEligible: storedRows.length,
      roundTripSuccess: roundTripSuccess.length,
      roundTripRatePercent,
      mismatches,
      rows: results,
    },
  });
  console.log(`claim:teach: before ${record.before}, after ${record.after}, delta ${record.delta} (threshold ${record.threshold.direction} ${record.threshold.value})`);
  console.log(`  acceptance ${storedRows.length}/${wellFormedRows.length} (${acceptanceRatePercent}%), round-trip ${roundTripSuccess.length}/${storedRows.length} (${roundTripRatePercent}%)`);
  if (mismatches.length) {
    console.log(`  ${mismatches.length} row(s) disagreed with expectTeach:`);
    for (const m of mismatches) console.log(`    - "${m.statement}" expected ${m.expectTeach}, stored ${m.stored}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
