// scripts/build-chat-seed.mjs — regenerate public/chat-seed.json, the starter
// memory behind chat.html's embedded chat engine (chat-browser.bundle.js).
// Seeded into an in-memory Backend-B handle through
// the REAL corpus seed path — resolveExtensions + seedActiveCorpusEntries,
// the exact functions `tmct init` runs — then serialized from what the store
// actually holds, so the page's vocabulary can never drift from the product's.
// Gitignored next to demo-memory.json for the same reason: generated at
// deploy, never committed.
//
// Contents: the default `human` persona whole (everyday vocabulary — what
// makes "what is a dog" answer with provenance), the SEON ontology whole
// (small, curated), and a capped slice of the ConceptNet band, definitional
// predicates first, so the cap spends itself on "X is a kind of Y" rather
// than location trivia. The byte ceiling below keeps the asset an honest
// page-weight budget: at the measured ~1.2 KB per serialized fact the
// default cap lands ~1.5 MB raw (~150 KB gzipped over the wire).

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** The largest chat-seed.json this builder will let through, in bytes. A
 *  bigger asset is a bug in the seed selection: lower the ConceptNet cap
 *  (or trim a band), never raise this number casually — the page fetches
 *  the whole file before the chat can answer a seeded question. */
export const SEED_BYTE_CEILING = 1600 * 1024;

/** Build the seed into `outPath` (default public/chat-seed.json). `limit`
 *  caps the ConceptNet band; human and SEON seed whole. */
export async function main(outPath = join(ROOT, "public", "chat-seed.json"), { limit = 200 } = {}) {
  const { createInMemoryStore, loadMemory } = await import(join(ROOT, "src", "adapters", "memory", "core.mjs"));
  const { resolveExtensions, seedActiveCorpusEntries } = await import(join(ROOT, "src", "services", "extensions.mjs"));

  const handle = createInMemoryStore();
  const { entries } = await resolveExtensions(ROOT);
  // Pin the band set: the resolver folds in whatever the local repo has
  // activated (a .tmct/ from an unrelated chat session), and a deploy asset
  // must not vary with the builder's machine.
  const SEED_BANDS = new Set(["human", "seon", "conceptnet"]);
  for (const [name, entry] of entries) {
    entries.set(name, { ...entry, active: SEED_BANDS.has(name) });
  }
  entries.set("conceptnet", { ...entries.get("conceptnet"), limit });
  const seeded = await seedActiveCorpusEntries(handle, entries);
  const failed = Object.entries(seeded.perBundle).filter(([, r]) => r.error);
  if (failed.length) {
    throw new Error(`chat seed: bundle(s) failed to seed: ${failed.map(([n, r]) => `${n} (${r.error})`).join(", ")}`);
  }
  if (!seeded.appended) throw new Error("chat seed: nothing seeded — the corpus files are missing or empty");

  const payload = await loadMemory(handle);
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json);
  if (bytes > SEED_BYTE_CEILING) {
    throw new Error(
      `chat seed: ${bytes} bytes exceeds the ${SEED_BYTE_CEILING}-byte ceiling — lower the ConceptNet cap `
      + `(currently ${limit}) or trim a band; do not raise the ceiling without weighing the page fetch.`,
    );
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json);
  const facts = payload.individuals.filter((i) => i.class === "Fact").length;
  return { outPath, bytes, facts, appended: seeded.appended, perBundle: seeded.perBundle };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const res = await main(process.argv[2]);
  const bands = Object.entries(res.perBundle).map(([n, r]) => `${r.appended} ${n}`).join(" + ");
  console.log(`wrote ${res.outPath} (${res.facts} facts: ${bands}; ${(res.bytes / 1024).toFixed(0)} KB)`);
}
