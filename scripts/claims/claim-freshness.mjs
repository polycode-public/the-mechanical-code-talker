// scripts/claims/claim-freshness.mjs — measures how old the facts a session
// might cite actually are, banded by whether they can regenerate themselves.
// Measurement only: this rig has no refresh mechanism of its own, it just
// reads what is already on disk.
//
// The store: a fresh repo seeded the way `tmct init` seeds one (initRepo,
// the sqlite backend), then every statement in
// test-benchmarks/claims/teach-set.jsonl taught into that SAME store through
// the chat entry point (runTurn) — the shape T6's claim:teach rig exercises
// per-row in isolation, built here as one accumulated store instead, because
// freshness needs every fact sitting in the one place a real session would
// read it from.
//
// Every Fact individual carries mgx:createdAt (core.mjs's CREATED_AT_PROP,
// "first-write-wins ISO-8601 on every individual") and, when its provenance
// tag embeds one, an event timestamp read back via trust.mjs's assertedAt
// (falls back to createdAt when the tag carries no timestamp of its own —
// true of every corpus-seeded row). Provenance's sourceType (trust.mjs's
// provenanceTagToSource) sorts each assertion into one of two bands: "teach"/
// "operator" (a person taught or asserted it, this session or a past one) is
// the taught/researched band; "corpus"/"corpusWeak"/"entailed" (shipped,
// bundled, or derived content a rebuild regenerates outright) is the
// regenerable band. A store built moments ago reads near-zero days in BOTH
// bands by construction — that is correct, not a bug: the number that
// matters is read off a real, long-lived deployed store over time, and this
// rig is the plumbing that makes that reading possible.
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initRepo } from "../../src/services/init.mjs";
import { openMemoryBackend, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { writeClaim, defaultHardware } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TEACH_SET_PATH = join(ROOT, "test-benchmarks", "claims", "teach-set.jsonl");
const CONFIG = {};

// The regenerable band regrows from a rebuild (the shipped corpus, or
// anything a rule derived rather than a person stated); everything else —
// what a person taught or the store asserted on their behalf — is the
// taught/researched band this rig actually guards.
const REGENERABLE_KINDS = new Set(["corpus", "corpusWeak", "entailed"]);
const bandFor = (sourceType) => (REGENERABLE_KINDS.has(sourceType) ? "regenerable" : "taughtResearched");

async function loadTeachSetRows() {
  const text = await readFile(TEACH_SET_PATH, "utf8");
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function buildStore() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-claim-freshness-"));
  await initRepo(dir);
  const { dir: memoryHandle, close: closeMemoryStore } = await openMemoryBackend(dir, "");

  const rows = await loadTeachSetRows();
  for (const [i, row] of rows.entries()) {
    await runTurn(row.statement, { config: CONFIG, memoryDir: memoryHandle, sessionId: `claim-freshness-${i}` });
  }

  return {
    dir,
    memoryHandle,
    async cleanup() {
      await closeMemoryStore();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const daysSince = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 86_400_000 : null;
};

const median = (sorted) => {
  const n = sorted.length;
  if (!n) return null;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function summarizeBand(ages) {
  const sorted = [...ages].sort((a, b) => a - b);
  return {
    count: sorted.length,
    oldestDays: sorted.length ? Number(sorted[sorted.length - 1].toFixed(3)) : null,
    newestDays: sorted.length ? Number(sorted[0].toFixed(3)) : null,
    medianDays: sorted.length ? Number(median(sorted).toFixed(3)) : null,
  };
}

async function measure() {
  const { memoryHandle, cleanup } = await buildStore();
  try {
    const rows = readFactRows(await loadMemory(memoryHandle));
    const now = Date.now();
    const ageDaysByBand = { taughtResearched: [], regenerable: [] };
    const unclassified = [];
    for (const row of rows) {
      for (const assertion of row.assertions) {
        const source = provenanceTagToSource(assertion.provenance);
        if (!source) { unclassified.push(assertion.provenance); continue; }
        const band = bandFor(source.kind);
        const age = daysSince(assertion.assertedAt || assertion.createdAt, now);
        if (age !== null) ageDaysByBand[band].push(age);
      }
    }
    return {
      totalFactRows: rows.length,
      taughtResearched: summarizeBand(ageDaysByBand.taughtResearched),
      regenerable: summarizeBand(ageDaysByBand.regenerable),
      unclassifiedCount: unclassified.length,
    };
  } finally {
    await cleanup();
  }
}

async function main() {
  const { totalFactRows, taughtResearched, regenerable, unclassifiedCount } = await measure();

  // A rig that silently reads zero rows in a band would report a fabricated
  // median (null coerced to something plausible-looking) — refuse outright
  // instead, the same honest-miss stance the product itself takes.
  if (taughtResearched.count === 0) throw new Error("claim:freshness: zero taught/researched assertions found — the store never actually taught the fixture, or provenance classification broke");
  if (regenerable.count === 0) throw new Error("claim:freshness: zero regenerable (corpus/entailed) assertions found — the default seed never landed in the store this rig read");

  const record = writeClaim("freshness", {
    hardware: defaultHardware(),
    pack: "shipped",
    unit: "days",
    value: taughtResearched.medianDays,
    // Wide and explicit on purpose: this rig's own store is built moments
    // before it's read, so the real value is always near zero — the
    // threshold exists only to catch a rig that starts reading garbage
    // (e.g. a corrupted provenance tag parsed as decades old), never to
    // pressure a genuinely low number.
    threshold: { direction: "max", value: 3650 },
    sources: [
      "scripts/claims/claim-freshness.mjs",
      "test-benchmarks/claims/teach-set.jsonl",
      "src/services/init.mjs",
      "src/adapters/memory/core.mjs",
      "src/domain/memory/trust.mjs",
      "src/services/chat.mjs",
    ],
    detail: {
      totalFactRows,
      taughtResearched,
      regenerable,
      unclassifiedCount,
    },
  });
  console.log(`claim:freshness: taught/researched median ${record.value} day(s) (${taughtResearched.count} assertions), regenerable median ${regenerable.medianDays} day(s) (${regenerable.count} assertions), threshold ${record.threshold.direction} ${record.threshold.value}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
