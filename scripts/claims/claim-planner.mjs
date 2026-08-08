// claim-planner.mjs — the tractability envelope: how far the taught planner
// (a bounded breadth-first search over `findActionPath`, src/domain/
// planning.mjs) reaches before an instance stops being fast, for three
// domains taught in English the way data/games/hanoi-3.txt teaches Hanoi.
// Hanoi is the shipped lesson (src/domain/hanoi-lesson.mjs); blocksworld and
// gripper are authored here from test-benchmarks/claims/blocksworld-rules.txt
// and gripper-rules.txt, the same closed teach frames, scaled by
// planner-domains.mjs beside this file.
//
// For each domain the rig grows the instance size (a disk/block/ball count)
// and solves a fresh instance at each size, until the solve time's median
// crosses 10 seconds. Every timed run happens in its own child process
// (planner-worker.mjs, via runIsolatedInstance below) with a wall-clock
// timeout just past the 10-second line: a domain with no clearing
// precondition or no size ordering has strictly more legal moves than hanoi
// at the same instance size, and the very first version of this rig
// confirmed that difference by exhausting the heap partway through a sweep,
// not just running slow. Isolating each run means a runaway instance kills
// its own child and gets recorded as an honest "over the line" data point,
// never the whole rig.
//
// Every size's own rep count starts at 20 and shrinks only when a size is
// itself slow enough that 20 reps would blow the rig's own running time —
// REP_BUDGET_MS bounds what any ONE size may cost. The reduced rep count is
// written to `detail` alongside its size, so nothing about the methodology
// is hidden.
//
// An instance the search cannot solve inside its bound is not a rig
// failure: the honest-miss constitution treats it as the envelope's own
// shape, so a miss (or a timeout) is recorded with its wall-clock like any
// solve. A sentence the teach lane declines IS a rig failure — it means one
// of the two rule files or this file's own generators is broken — so that
// stops the run immediately and names the sentence.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { writeClaim } from "./lib.mjs";
import { PLANNER_DOMAINS } from "./planner-domains.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(HERE, "planner-worker.mjs");

const START_SIZE = 3;
const GROWTH = 1.35;
const CROSS_MS = 10_000;
const UNDER_MS = 1_000;
const MAX_ITERATIONS = 40;
const MAX_SIZE = 2000;
const REP_BUDGET_MS = 120_000;
// A run that has not finished by here is unambiguously over CROSS_MS — the
// rig does not need the exact number, only the fact that it crossed. Also
// the ceiling on any one size's total cost when every rep times out.
const RUN_TIMEOUT_MS = 15_000;
const WORKER_MAX_HEAP_MB = 1536;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 20 reps by default; fewer only when a size's own solve time is slow
 *  enough that 20 of them would cost more than REP_BUDGET_MS — the rig's
 *  guard against a domain whose crossing size is itself minutes long. Never
 *  below 3, so a median still means something. */
function repCountFor(sampleMs) {
  const byBudget = Math.floor(REP_BUDGET_MS / Math.max(1, sampleMs));
  return Math.max(3, Math.min(20, byBudget));
}

class PlannerDeclineError extends Error {
  constructor(domainName, size, declined) {
    super(`claim:planner — ${domainName} at size ${size} declined "${declined.sentence}" (${declined.via}): ${declined.answer}`);
    this.name = "PlannerDeclineError";
  }
}

/** One solvePlannerInstance(domainName, size) call, isolated in its own
 *  child process (planner-worker.mjs) so an instance whose search grows
 *  large enough to exhaust the heap crashes only that child. A run that
 *  neither finishes nor crashes within RUN_TIMEOUT_MS is killed and reported
 *  as `over: true` with `ms: RUN_TIMEOUT_MS` — a disclosed LOWER bound, not
 *  a measured time. Same shape for a child that crashes outright (an
 *  out-of-memory instance is, honestly, also "over the line"). */
function runIsolatedInstance(domainName, size) {
  const result = spawnSync(
    process.execPath,
    [`--max-old-space-size=${WORKER_MAX_HEAP_MB}`, WORKER_PATH, domainName, String(size)],
    { timeout: RUN_TIMEOUT_MS, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );

  if (result.error || result.signal) {
    return { size, ms: RUN_TIMEOUT_MS, solved: false, moves: null, declined: null, over: true, cause: result.signal ? `killed (${result.signal})` : String(result.error) };
  }
  if (result.status !== 0) {
    return { size, ms: RUN_TIMEOUT_MS, solved: false, moves: null, declined: null, over: true, cause: `worker exited ${result.status}: ${String(result.stderr || "").slice(0, 300)}` };
  }
  return { ...JSON.parse(result.stdout), over: false };
}

/** One domain's envelope: grow `size` from START_SIZE until a size's own
 *  median crosses CROSS_MS (or a single run at that size runs over the
 *  isolation timeout), measuring every size along the way with an
 *  adaptively-sized rep count. Returns `{ unit, sizes, largestUnder1s,
 *  firstOver10s }` — `sizes` is every measured size in order, `largestUnder1s`
 *  is the largest size that BOTH solved and stayed under UNDER_MS (a size
 *  whose search gave up quickly is a fast miss, not a fast solve, so it
 *  cannot be the headline value), `firstOver10s` is derived from the same
 *  list on time alone (null when the sweep never saw one). Throws
 *  PlannerDeclineError the moment any teach sentence at any size is
 *  declined, rather than folding a mis-teach into the timing data. */
function measureDomain(domainName) {
  const { unit } = PLANNER_DOMAINS[domainName];
  const sizes = [];
  let size = START_SIZE;

  for (let i = 0; i < MAX_ITERATIONS && size <= MAX_SIZE; i += 1) {
    const first = runIsolatedInstance(domainName, size);
    if (first.declined) throw new PlannerDeclineError(domainName, size, first.declined);

    if (first.over) {
      sizes.push({ size, medianMs: RUN_TIMEOUT_MS, reps: 1, solved: false, moves: null, over: true, cause: first.cause });
      console.log(`  ${domainName} size=${size}: over the line (${first.cause})`);
      break;
    }

    const reps = repCountFor(first.ms);
    const samples = [first.ms];
    let { solved, moves } = first;
    let over = false;
    let cause = null;
    for (let rep = 1; rep < reps && !over; rep += 1) {
      const r = runIsolatedInstance(domainName, size);
      if (r.declined) throw new PlannerDeclineError(domainName, size, r.declined);
      if (r.over) { over = true; cause = r.cause; break; }
      samples.push(r.ms);
      ({ solved, moves } = r);
    }

    const medianMs = over ? RUN_TIMEOUT_MS : median(samples);
    sizes.push({ size, medianMs: Math.round(medianMs * 100) / 100, reps: samples.length, solved, moves, over, ...(cause ? { cause } : {}) });
    console.log(`  ${domainName} size=${size}: median=${Math.round(medianMs)}ms over ${samples.length} run(s)${over ? " (crossed mid-sweep)" : ""}`);

    if (medianMs > CROSS_MS) break;
    size = Math.max(size + 1, Math.round(size * GROWTH));
  }

  const largestUnder1s = [...sizes].reverse().find((s) => s.solved && s.medianMs <= UNDER_MS)?.size ?? null;
  const firstOver10s = sizes.find((s) => s.medianMs > CROSS_MS)?.size ?? null;
  return { unit, sizes, largestUnder1s, firstOver10s };
}

const domains = {};
for (const name of Object.keys(PLANNER_DOMAINS)) {
  console.log(`claim:planner — sweeping ${name}`);
  domains[name] = measureDomain(name);
}

if (domains.hanoi.largestUnder1s == null) {
  throw new Error("claim:planner — hanoi never solved an instance under 1s; the headline value has nothing to report");
}

const value = domains.hanoi.largestUnder1s;

writeClaim("planner", {
  value,
  unit: "disks",
  pack: "shipped",
  threshold: { direction: "min", value },
  sources: [
    "test-benchmarks/claims/blocksworld-rules.txt",
    "test-benchmarks/claims/gripper-rules.txt",
  ],
  detail: {
    hardwareNote: "measured on the machine that ran this claim; the receipts machine's numbers (test-benchmarks/receipts/receipts.json) are canonical wherever they exist for a shared metric",
    repBudgetMs: REP_BUDGET_MS,
    runTimeoutMs: RUN_TIMEOUT_MS,
    domains,
  },
});

console.log(`Planner claim written: hanoi solves ${value} disks under 1s.`);
for (const [name, envelope] of Object.entries(domains)) {
  const last = envelope.sizes.at(-1);
  console.log(`  ${name}: largest under 1s = ${envelope.largestUnder1s ?? "none"} ${envelope.unit}, first over 10s = ${envelope.firstOver10s ?? "not reached"} ${envelope.unit} (swept to ${last.size}, ${last.medianMs}ms median over ${last.reps} run(s))`);
}
