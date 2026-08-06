// scripts/claims/claim-prose-band.mjs — measures how much of ordinary Simple
// English Wikipedia prose the ingest pipeline can ground into facts, with no
// help from the sentences being about code. Every sentence in
// test-benchmarks/claims/simplewiki-sentences.txt runs, one at a time, through
// ingestText() against a single default-seeded store (the same starter
// vocabulary `tmct init` leaves behind). A sentence the pipeline cannot parse
// into a fact is a miss, not a bug — this rig reports the resulting rate
// as-is, however low, because the whole point of the measurement is to know
// the real number.
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepo, MEMORY_DIR_REL } from "../../src/services/init.mjs";
import { ingestText } from "../../src/services/extract-facts.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { writeClaim, defaultHardware } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SENTENCES_PATH = join(ROOT, "test-benchmarks", "claims", "simplewiki-sentences.txt");

async function loadSentences() {
  const text = await readFile(SENTENCES_PATH, "utf8");
  return text.split("\n").map((s) => s.trim()).filter(Boolean);
}

async function measure() {
  const sentences = await loadSentences();
  const dir = await mkdtemp(join(tmpdir(), "tmct-claim-prose-band-"));
  try {
    await initRepo(dir);
    const memoryDir = join(dir, MEMORY_DIR_REL);

    let sentenceCount = 0;
    let recognizedCount = 0;
    let optimisticCount = 0;
    const ungroundedTerms = new Map();
    for (const sentence of sentences) {
      const result = await ingestText(sentence, { memoryDir, sourceTag: "claim-prose-band" });
      sentenceCount += result.sentences;
      recognizedCount += result.recognized;
      optimisticCount += result.optimistic.length;
      for (const term of result.ungroundedTerms) {
        ungroundedTerms.set(term, (ungroundedTerms.get(term) ?? 0) + 1);
      }
    }
    const topUngrounded = [...ungroundedTerms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term, count]) => ({ term, count }));

    return { sentenceCount, recognizedCount, optimisticCount, topUngrounded };
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { sentenceCount, recognizedCount, optimisticCount, topUngrounded } = await measure();
  const rate = sentenceCount > 0 ? (recognizedCount / sentenceCount) * 100 : 0;

  const record = writeClaim("prose-band", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "percent",
    value: Number(rate.toFixed(2)),
    marginKind: "rate",
    sources: [
      "scripts/claims/claim-prose-band.mjs",
      "test-benchmarks/claims/simplewiki-sentences.txt",
      "test-benchmarks/claims/simplewiki-sentences.LICENSE",
      "src/services/extract-facts.mjs",
      "src/services/init.mjs",
    ],
    detail: {
      sentenceCount,
      recognizedCount,
      skippedCount: sentenceCount - recognizedCount,
      optimisticCount,
      topUngroundedTerms: topUngrounded,
    },
  });
  console.log(`claim:prose-band: ${record.value}% (${recognizedCount}/${sentenceCount} sentences grounded, threshold ${record.threshold.direction} ${record.threshold.value})`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
