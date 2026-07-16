// scripts/build-demo-memory.mjs — regenerate public/demo-memory.json, the memory
// payload behind the Pages site's ledger hero (public/ledger.html). Built by
// teaching a throwaway repo through the REAL paths — runTurn for the README's
// grandfather chain, appendFact with real corpus provenance for the animal
// slice, importDefinitionFile for the shipped hanoi-3 game — then serializing
// what the store actually holds. Gitignored next to demo-graph.json for the
// same reason: generated at deploy, it can never drift from the engine.

import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

// The README's own teach transcript, verbatim (examples/teach-and-infer.mjs).
const GRANDFATHER_TEACH = [
  "ahab is the father of john",
  "john is the father of ishmael",
  "a father is a kind of parent",
  "remember that ahab is male",
  "a grandparent is a parent of a parent",
  "a grandfather is a grandparent who is male",
];

// A small everyday-animal slice in the shipped corpus's own fact shape:
// the predicates and "corpus:human /r/<Relation>" provenance the tier-1 seed
// writes, so the ledger's provenance colors and the dock's source lines are
// the real thing.
const ANIMAL_FACTS = [
  ["dog", "rdfs:subClassOf", "animal", "corpus:human /r/IsA"],
  ["dog", "mgx:hasA", "tail", "corpus:human /r/HasA"],
  ["dog", "mgx:capableOf", "bark", "corpus:human /r/CapableOf"],
  ["horse", "rdfs:subClassOf", "animal", "corpus:human /r/IsA"],
  ["horse", "mgx:capableOf", "run", "corpus:human /r/CapableOf"],
  ["horse", "mgx:usedFor", "riding", "corpus:human /r/UsedFor"],
  ["cat", "rdfs:subClassOf", "animal", "corpus:human /r/IsA"],
  ["cat", "mgx:hasA", "whiskers", "corpus:human /r/HasA"],
  ["cat", "mgx:capableOf", "purr", "corpus:human /r/CapableOf"],
  ["bird", "rdfs:subClassOf", "animal", "corpus:human /r/IsA"],
  ["bird", "mgx:hasA", "wings", "corpus:human /r/HasA"],
  ["bird", "mgx:capableOf", "fly", "corpus:human /r/CapableOf"],
];

/** Build the payload into `outPath` (default public/demo-memory.json). */
export async function main(outPath = join(ROOT, "public", "demo-memory.json")) {
  const { runTurn, uuidv7 } = await import(join(ROOT, "src", "chat.mjs"));
  const { appendFact, loadMemory, openMemoryBackend } = await import(join(ROOT, "src", "adapters", "memory", "core.mjs"));
  const { importDefinitionFile } = await import(join(ROOT, "src", "import-file.mjs"));

  const repo = await mkdtemp(join(tmpdir(), "tmct-demo-memory-"));
  try {
    const { dir: memoryDir, close } = await openMemoryBackend(repo, "default");
    try {
      const sessionId = uuidv7();
      for (const line of GRANDFATHER_TEACH) {
        const { record } = await runTurn(line, { memoryDir, sessionId });
        if (record?.miss || record?.via !== "assert") {
          throw new Error(`demo teach declined: "${line}" -> ${String(record?.answer || "").split("\n")[0]}`);
        }
      }
      for (const [subject, predicate, object, provenance] of ANIMAL_FACTS) {
        await appendFact(memoryDir, { subject, predicate, object, provenance });
      }
      const imported = await importDefinitionFile(repo, join(ROOT, "data", "games", "hanoi-3.txt"));
      if (imported.declined.length) {
        throw new Error(`hanoi-3.txt declined ${imported.declined.length} sentence(s):\n${imported.report}`);
      }
      const payload = await loadMemory(memoryDir);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, JSON.stringify(payload));
      return { outPath, facts: ANIMAL_FACTS.length, taughtGame: imported.taught.length };
    } finally {
      if (typeof close === "function") await close();
    }
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = await main(process.argv[2]);
  console.log(`wrote ${res.outPath} (grandfather chain + ${res.facts} corpus facts + ${res.taughtGame} game sentences)`);
}
