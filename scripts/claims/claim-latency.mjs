import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeClaim } from "./lib.mjs";

const receiptPath = join(process.cwd(), "test-benchmarks", "receipts", "receipts.json");

const receipts = JSON.parse(readFileSync(receiptPath, "utf8"));

if (!receipts.latencyMs || receipts.latencyMs.p50 === undefined) {
  console.error("Error: latencyMs.p50 not found in receipts.json");
  process.exit(1);
}

const p50 = receipts.latencyMs.p50;
const p90 = receipts.latencyMs.p90;
const p99 = receipts.latencyMs.p99;
const n = receipts.latencyMs.n;

const hardware = receipts.host ? `${receipts.host.model} x${receipts.host.cores}` : "receipts rig";

const claim = writeClaim("latency", {
  value: p50,
  unit: "ms",
  pack: "shipped",
  hardware,
  threshold: {
    direction: "max",
    value: p50 * 1.2,
  },
  sources: ["test-benchmarks/receipts/receipts.json"],
  detail: {
    p90,
    p99,
    n,
  },
});

console.log(`Latency claim written: ${p50}ms (p50)`);
