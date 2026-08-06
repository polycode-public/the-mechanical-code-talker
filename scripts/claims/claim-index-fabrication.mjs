import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeClaim } from "./lib.mjs";

const reportPath = join(process.cwd(), "reports", "BENCHMARK_CODE_INDEX_3.0.3.md");

const content = readFileSync(reportPath, "utf8");

if (!content.includes("25/25")) {
  console.error("Error: '25/25' not found in BENCHMARK_CODE_INDEX_3.0.3.md");
  process.exit(1);
}

const claim = writeClaim("index-fabrication", {
  value: 25,
  unit: "cases",
  pack: "shipped",
  hardware: "ci",
  threshold: {
    direction: "min",
    value: 25,
  },
  sources: ["reports/BENCHMARK_CODE_INDEX_3.0.3.md"],
  detail: {
    total: 25,
    fabricationSurfaces: 21,
  },
});

console.log("Index fabrication claim written: 25/25 cases");
