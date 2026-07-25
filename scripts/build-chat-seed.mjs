// scripts/build-chat-seed.mjs — regenerate public/chat-seed.json, the starter
// memory behind chat.html's embedded chat engine (chat-browser.bundle.js).
// Seeded into an in-memory Backend-B handle through
// the REAL corpus seed path — resolveExtensions + seedActiveCorpusEntries,
// the exact functions `tmct init` runs — then serialized from what the store
// actually holds, so the page's vocabulary can never drift from the product's.
// Gitignored next to demo-memory.json for the same reason: generated at
// deploy, never committed.
//
// Contents: the SAME band set `npm run init:xl` gives the CLI — the large
// human persona, SEON, ConceptNet, the tier-2 code corpuses (aws/python/java)
// and WordNet-xl — read from package.json's own init:xl script and resolved
// through the same name lookup `tmct import --corpus` uses, so the browser
// and the CLI can never drift on WHICH corpuses seed.
//
// Where the two surfaces deliberately diverge is SCALE, not bands. Serialized
// memory runs ~1.2 KB per fact, so the uncapped init:xl set measures ~86 MB
// (ConceptNet's 36k mapped facts are ~43 MB of that; WordNet-xl's 23.8k rows
// another ~26 MB) — far past what a page should fetch before it can answer.
// The two open-scale bands therefore carry pinned fact caps (SEED_BAND_CAPS),
// each spent definitional-predicates-first through the same `prefer`
// mechanism the ConceptNet band has always used, so the cap buys the IsA
// backbone rather than trivia. Every hand-curated band seeds whole.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** The largest chat-seed.json this builder will let through, in bytes. The
 *  capped default configuration measures ~38.7 MB and boots inside the page's
 *  boot budget (test-e2e/pages-chat-boot-budget.test.mjs holds it there). A bigger
 *  asset is a bug in the seed selection: lower a SEED_BAND_CAPS entry, never
 *  raise this number casually — the page fetches the whole file before the
 *  chat can answer a seeded question. */
export const SEED_BYTE_CEILING = 40 * 1024 * 1024;

/** Pinned per-band fact caps for the two bands whose full size dwarfs the
 *  byte ceiling. Definitional predicates seed first (each capped band gets
 *  the ConceptNet band's own `prefer` order), so the WordNet-xl cap is spent
 *  on its hypernym (subClassOf) backbone. Pinned as counts, not computed
 *  from bytes at build time, so the deploy asset is identical on every
 *  machine that holds the same corpus files. Raised from 2000/4000 to
 *  7000/14000 (measured ~38.7 MB against the boot-budget guard, ~1.3 MB of
 *  headroom under the byte ceiling above) — a further raise is a fresh
 *  measurement against that same guard, not a bigger number chosen by eye. */
export const SEED_BAND_CAPS = Object.freeze({ conceptnet: 7000, "wordnet-xl": 14000 });

// `tmct init --persona-size <size>` activates these additive human-persona
// size bands on top of the always-active `human` (same ladder bin/tmct.mjs
// resolves for the flag).
const PERSONA_SIZE_BANDS = Object.freeze({
  medium: ["human-medium"],
  large: ["human-medium", "human-large"],
});

/** The band list `npm run init:xl` produces, in the order the CLI seeds it:
 *  the persona bands `tmct init --persona-size <size>` activates, then each
 *  `tmct import --corpus <name>` in script order. Read from package.json's
 *  own script text and resolved with the same lookup the import path uses
 *  (an extension name as-is, else a tier-2 manifest id -> "tier2-<id>"), so
 *  there is no second alias table to drift. */
export async function initXlBands(entries) {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const script = pkg.scripts?.["init:xl"];
  if (!script) throw new Error("chat seed: package.json has no init:xl script to mirror");

  const bands = ["human"];
  const size = /--persona-size\s+(\S+)/.exec(script)?.[1];
  if (size) {
    const sizeBands = PERSONA_SIZE_BANDS[size];
    if (!sizeBands) throw new Error(`chat seed: init:xl names unknown persona size "${size}"`);
    bands.push(...sizeBands);
  }

  const { TIER2_MANIFEST_FILE } = await import(join(ROOT, "src", "adapters", "corpus", "conceptnet.mjs"));
  const manifest = JSON.parse(await readFile(TIER2_MANIFEST_FILE, "utf8"));
  const tier2Ids = new Set((manifest.corpuses || []).map((c) => c.id));
  for (const [, name] of script.matchAll(/--corpus\s+(\S+)/g)) {
    if (entries.has(name)) bands.push(name);
    else if (tier2Ids.has(name)) bands.push(`tier2-${name}`);
    else throw new Error(`chat seed: init:xl imports unknown corpus "${name}"`);
  }
  return bands;
}

/** Build the seed into `outPath` (default public/chat-seed.json).
 *  `bands` (ordered array) overrides the init:xl-mirrored band set;
 *  `caps` overrides SEED_BAND_CAPS; `byteCeiling` overrides SEED_BYTE_CEILING. */
export async function main(outPath = join(ROOT, "public", "chat-seed.json"), { bands, caps = SEED_BAND_CAPS, byteCeiling = SEED_BYTE_CEILING } = {}) {
  const { createInMemoryStore, loadMemory } = await import(join(ROOT, "src", "adapters", "memory", "core.mjs"));
  const { resolveExtensions, seedActiveCorpusEntries } = await import(join(ROOT, "src", "services", "extensions.mjs"));

  const handle = createInMemoryStore();
  // Pin the band set: the resolver folds in whatever the local repo has
  // activated (a .tmct/ from an unrelated chat session), and a deploy asset
  // must not vary with the builder's machine.
  const { entries } = await resolveExtensions(ROOT);
  const seedBands = bands ?? await initXlBands(entries);
  const definitionalFirst = entries.get("conceptnet")?.prefer;

  // One seedActiveCorpusEntries call per band, in seedBands order, so the
  // build can report what each band actually cost in facts AND bytes.
  const perBundle = {};
  let appended = 0;
  let prevBytes = 0;
  for (const name of seedBands) {
    const entry = entries.get(name);
    if (!entry) throw new Error(`chat seed: unknown band "${name}"`);
    const capped = caps[name] !== undefined
      ? { ...entry, limit: caps[name], prefer: entry.prefer ?? definitionalFirst }
      : entry;
    const seeded = await seedActiveCorpusEntries(handle, new Map([[name, { ...capped, active: true }]]));
    const result = seeded.perBundle[name];
    if (!result || result.error) {
      throw new Error(`chat seed: bundle failed to seed: ${name}${result?.error ? ` (${result.error})` : ""}`);
    }
    const bytes = Buffer.byteLength(JSON.stringify(await loadMemory(handle)));
    perBundle[name] = { ...result, bytes: bytes - prevBytes };
    prevBytes = bytes;
    appended += result.appended;
  }
  if (!appended) throw new Error("chat seed: nothing seeded — the corpus files are missing or empty");

  const payload = await loadMemory(handle);
  const json = JSON.stringify(payload);
  const bytes = Buffer.byteLength(json);
  if (bytes > byteCeiling) {
    throw new Error(
      `chat seed: ${bytes} bytes exceeds the ${byteCeiling}-byte ceiling — lower a band cap `
      + `(${JSON.stringify(caps)}); do not raise the ceiling without re-measuring the page's boot budget.`,
    );
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, json);
  const facts = payload.individuals.filter((i) => i.class === "Fact").length;
  return { outPath, bytes, facts, appended, bands: seedBands, perBundle };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const res = await main(process.argv[2]);
  for (const [name, r] of Object.entries(res.perBundle)) {
    console.log(`  ${name}: ${r.appended} facts, ${(r.bytes / 1024).toFixed(0)} KB`);
  }
  console.log(`wrote ${res.outPath} (${res.facts} facts, ${(res.bytes / 1024 / 1024).toFixed(2)} MB)`);
}
