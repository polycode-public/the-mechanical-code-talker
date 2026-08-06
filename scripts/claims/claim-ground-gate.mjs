// scripts/claims/claim-ground-gate.mjs — the refusal confusion matrix. Ingests
// every hand-labelled statement in test-benchmarks/claims/ground-gate.jsonl
// (100 the shipped corpus can ground, 100 it cannot) against a fresh
// default-seeded store, through the SAME strict recognizer the ingest page
// and `tmct extract` both use (ingestText, src/services/extract-facts.mjs).
// Two headlines share one matrix: C2's accepted-wrong percent (an
// ungroundable statement the gate let through) and L2's refused-groundable
// percent (a groundable statement the gate turned away).
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initRepo, PERSONA_PRESETS } from "../../src/services/init.mjs";
import { openConfiguredMemoryBackend } from "../../src/adapters/memory/core.mjs";
import { ingestText } from "../../src/services/extract-facts.mjs";
import { writeClaim, defaultHardware, ROOT } from "./lib.mjs";

const FIXTURE_PATH = join(ROOT, "test-benchmarks", "claims", "ground-gate.jsonl");

async function loadFixture() {
  const body = await readFile(FIXTURE_PATH, "utf8");
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function measure(items) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-claim-ground-gate-"));
  let acceptedGroundable = 0;
  let acceptedUngroundable = 0;
  let refusedGroundable = 0;
  let refusedUngroundable = 0;
  const acceptedWrongExamples = [];
  const refusedGroundableExamples = [];
  try {
    await initRepo(dir, { persona: PERSONA_PRESETS.human, env: process.env });
    const store = await openConfiguredMemoryBackend(dir);
    try {
      for (const item of items) {
        const result = await ingestText(item.statement, {
          memoryDir: store.dir, sourceTag: "ground-gate", optimistic: false,
        });
        const accepted = result.extracted.length > 0;
        if (item.groundable && accepted) acceptedGroundable += 1;
        else if (!item.groundable && accepted) {
          acceptedUngroundable += 1;
          acceptedWrongExamples.push(item.statement);
        } else if (item.groundable && !accepted) {
          refusedGroundable += 1;
          refusedGroundableExamples.push(item.statement);
        } else refusedUngroundable += 1;
      }
    } finally {
      await store.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return {
    acceptedGroundable, acceptedUngroundable, refusedGroundable, refusedUngroundable,
    acceptedWrongExamples, refusedGroundableExamples,
  };
}

async function main() {
  const items = await loadFixture();
  const totalGroundable = items.filter((i) => i.groundable).length;
  const totalUngroundable = items.filter((i) => !i.groundable).length;

  const matrix = await measure(items);

  const acceptedWrongPercent = (matrix.acceptedUngroundable / totalUngroundable) * 100;
  const refusedGroundablePercent = (matrix.refusedGroundable / totalGroundable) * 100;

  const record = writeClaim("ground-gate", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "percent",
    value: acceptedWrongPercent,
    threshold: { direction: "max", value: acceptedWrongPercent + 2 },
    sources: [
      "test-benchmarks/claims/ground-gate.jsonl",
      "scripts/claims/claim-ground-gate.mjs",
      "src/services/extract-facts.mjs",
    ],
    detail: {
      totalGroundable,
      totalUngroundable,
      acceptedGroundable: matrix.acceptedGroundable,
      acceptedUngroundable: matrix.acceptedUngroundable,
      refusedGroundable: matrix.refusedGroundable,
      refusedUngroundable: matrix.refusedUngroundable,
      acceptedWrongExamples: matrix.acceptedWrongExamples,
      refusedGroundablePercent,
      limits: {
        refusedGroundablePercent: {
          headroom: 2,
          threshold: { direction: "max", value: refusedGroundablePercent + 2 },
        },
      },
    },
  });

  console.log(
    `claim:ground-gate: ${record.value.toFixed(1)}% accepted-wrong `
    + `(${matrix.acceptedUngroundable}/${totalUngroundable}), `
    + `${refusedGroundablePercent.toFixed(1)}% refused-groundable `
    + `(${matrix.refusedGroundable}/${totalGroundable})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
