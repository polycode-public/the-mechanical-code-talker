// idxbench/conformance-runner.mjs — the conformance-kit gate IDXBENCH runs
// against every produced graph before scoring it: a producer whose graph does
// not pass runConformance cannot be scored at all. runConformance()
// (src/tools/conformance.mjs) registers node:test tests at IMPORT time, so it
// needs a real test-runner context — idxbench/run.mjs loads this file through
// node:test's programmatic run() (see checkConformance there), pointing it at
// one produced graph via two env vars set just before the call. Not a case
// file itself: this only exists to give runConformance somewhere to run.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createGraphService } from "../../src/adapters/providers/graph-service.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { runConformance } from "../../src/tools/conformance.mjs";

const graphFile = process.env.IDXBENCH_CONFORMANCE_GRAPH;
const repoRoot = process.env.IDXBENCH_CONFORMANCE_REPO;
const entities = JSON.parse(readFileSync(graphFile, "utf8"));

runConformance("idxbench-produced", () =>
  createGraphService(parseEntities(entities), { sourceAccess: true, repoRoot, readFile, ask }));
