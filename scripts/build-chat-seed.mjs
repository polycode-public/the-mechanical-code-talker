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
// and the CLI can never drift on WHICH corpuses seed, or at what scale — every
// band ships whole EXCEPT ConceptNet, capped per SEED_BAND_CAPS below since
// PLAN_FACT.md's per-assertion re-key. Measured at 63,470 facts, ~93.5 MB raw
// JSON (~7.1 MB gzip).
//
// SEED_BAND_CAPS and SEED_BYTE_CEILING stay in the file as a backstop, not a
// design limit: if a future corpus addition pushes the seed's byte count high
// enough to threaten the page boot budget, a band cap is the lever to pull,
// spent definitional-predicates-first through the same `prefer` mechanism
// the ConceptNet band has always used, so the cap would buy the IsA backbone
// rather than trivia.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

/** The largest chat-seed.json this builder will let through, in bytes. The
 *  full uncapped init:xl band set measures ~89.8 MB (89,774,669 bytes
 *  measured), so this ceiling sits at 100 MB — about 10 MB of headroom for
 *  corpus growth before the next measurement is due. A bigger asset than
 *  that is a bug in the seed selection: this is a backstop guard, not the
 *  band-set's normal operating margin — the page fetches the whole file
 *  before the chat can answer a seeded question, so a real breach should be
 *  investigated against the boot budget (test-e2e/pages-chat-boot-budget.test.mjs)
 *  before this number is raised again. */
export const SEED_BYTE_CEILING = 100 * 1024 * 1024;

/** Per-band fact caps, applied only to bands named here. PLAN_FACT.md's
 *  per-assertion re-key (`mgx:sourceId`, restructured `trustInputs`, etc. on
 *  every record) grew each fact's own byte cost even though corpus bands stay
 *  one record per triple — the full band set measured 106,413,353 bytes
 *  post-re-key, over SEED_BYTE_CEILING. ConceptNet is capped at 28,000 (was
 *  36,328 uncapped), seeding definitional-predicates-first through the same
 *  `prefer` order it already used, so the cut buys the IsA (subClassOf)
 *  backbone rather than trivia — 93,496,025 bytes, ~10.8 MB headroom
 *  restored, matching this file's own documented norm. Re-measure before
 *  changing this number again. */
export const SEED_BAND_CAPS = Object.freeze({ conceptnet: 28000 });

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
