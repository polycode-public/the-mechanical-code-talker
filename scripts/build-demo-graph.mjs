// scripts/build-demo-graph.mjs — regenerate public/demo-graph.json, the static graph
// the GitLab Pages site's browser chat demo fetches.
//
// Source of truth is examples/mini-webapp/.tmct/graph.json (the repo's own committed
// fixture graph, already used by `npm run example:mini`). The one transformation
// applied is src/tools/schema-docs.mjs's REAL ingestSchemaDocs() — the same function a
// graph writer calls after buildEntities — which merges tmct's static, repo-
// independent schema documentation (Module/Class/Function/… + every predicate) in as
// SchemaClass/SchemaPredicate individuals. Without it, "what is a module"/"what does
// cochange mean"-style questions have nothing to match against on this small fixture
// (the schema docs are otherwise only ingested by the full graph-build pipeline, which
// this static demo fixture predates). ingestSchemaDocs is pure and idempotent — this
// is real tmct code running offline, not a hand-authored answer.
//
// Deliberately NOT part of any bundler/transpile step — this is the one small "data
// prep" exception to public/'s literal-copy CI job, run once here (and re-run by CI on
// every deploy so the published demo graph can never drift from source).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ingestSchemaDocs } from "../src/tools/schema-docs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "..", "examples", "mini-webapp", ".tmct", "graph.json");
// Takes the output file as its first argument; build-demo-site.mjs passes one so
// a build can target a directory other than the repo's own public/.
const OUT = process.argv[2] ?? join(here, "..", "public", "demo-graph.json");

const payload = JSON.parse(readFileSync(SRC, "utf8"));
ingestSchemaDocs(payload);
writeFileSync(OUT, JSON.stringify(payload));
console.log(`wrote ${OUT} (${payload.individuals.length} individuals, schema docs ingested)`);
