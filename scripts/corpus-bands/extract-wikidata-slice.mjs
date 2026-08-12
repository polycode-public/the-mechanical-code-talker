#!/usr/bin/env node
// extract-wikidata-slice.mjs — turns the full Wikidata entity dump
// (`scripts/resume-wikidata-dump.sh`'s download target) into the small
// JSON-lines slice `build-wikidata-slice.mjs --source <slice>` consumes.
// Not part of the product path — an operator-run maintainer tool over a
// dump the operator downloads by hand.
//
//   node scripts/corpus-bands/extract-wikidata-slice.mjs \
//     [--dump ~/tmct-dumps/wikidata-latest-all.json.gz] [--out ~/tmct-dumps/]
//
// The dump's own on-disk shape is a single JSON array split one entity per
// line, every line but the last carrying a trailing comma:
//   [
//   {"type":"item","id":"Q5",...},
//   {"type":"item","id":"Q144",...},
//   {"type":"item","id":"Q99999999",...}
//   ]
// Two streaming passes over that (multi-hundred-GB decompressed) array find
// the slice's rows without ever holding the dump in memory:
//   pass A  — the committed SEED_QIDS entities' own lines.
//   derive  — every object QID a mapped claim (WIKIDATA_PROPERTY_RELATIONS,
//             the same table wikidata-live.mjs's live lookups use) on a
//             found seed entity points at.
//   pass B  — those object entities' own lines.
// The two entity sets, concatenated, are the dump-derived slice.
//
// Each pass reads the dump exactly once with a bounded read buffer (readline
// over a piped gunzip stream) and holds only the (small) set of matched
// entities in memory, so runtime memory stays flat regardless of dump size.
//
// Resumability is per-phase, not per-line: each phase (pass A, derive,
// pass B) writes its result to a state file under
// `<out>/.wikidata-slice-state/` only once it has fully finished, and a
// rerun skips any phase whose state file already exists. A crash mid-phase
// loses that phase's progress and rescans the dump from the top of the
// phase it was in, but never repeats an already-finished phase — cheaper
// than restarting the whole extraction, without needing a seekable index
// into the gzip stream to checkpoint mid-phase.

import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { SEED_QIDS } from "./build-wikidata-slice.mjs";
import { WIKIDATA_PROPERTY_RELATIONS } from "../../src/adapters/corpus/wikidata-live.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESUME_SCRIPT_PATH = join(HERE, "..", "resume-wikidata-dump.sh");

export const DEFAULT_DUMP_PATH = join(homedir(), "tmct-dumps", "wikidata-latest-all.json.gz");
export const DEFAULT_OUT_DIR = join(homedir(), "tmct-dumps");
export const SLICE_FILENAME = "wikidata-slice.jsonl";

// The id sits near the start of every dump entity line; scanning only a
// short prefix keeps the per-line match cheap even for a busy entity's
// multi-hundred-KB line.
const ID_PREFIX_RE = /"id":"(Q[1-9][0-9]*)"/;
const ID_PREFIX_SCAN_CHARS = 200;

export function stripTrailingComma(line) {
  const trimmed = line.trimEnd();
  return trimmed.endsWith(",") ? trimmed.slice(0, -1) : trimmed;
}

export function lineEntityId(line) {
  const match = ID_PREFIX_RE.exec(line.slice(0, ID_PREFIX_SCAN_CHARS));
  return match ? match[1] : null;
}

/** Every object QID a mapped, valued claim on `entity` points at — the same
 *  claim shape wikidata-live.mjs's own mappedClaims and build-wikidata-
 *  slice.mjs's mappedClaimTargets read. */
export function objectQidsOf(entity) {
  const out = new Set();
  for (const property of Object.keys(WIKIDATA_PROPERTY_RELATIONS)) {
    const statements = entity?.claims?.[property];
    if (!Array.isArray(statements)) continue;
    for (const statement of statements) {
      const snak = statement?.mainsnak;
      if (snak?.snaktype !== "value") continue;
      const id = snak?.datavalue?.value?.id;
      if (typeof id === "string" && id) out.add(id);
    }
  }
  return out;
}

function defaultProgressLogger({ phase, bytesRead, matched, done }) {
  const mb = (bytesRead / 1048576).toFixed(1);
  const suffix = done ? "  (phase done)" : "";
  process.stderr.write(`${new Date().toISOString()}  ${phase}  ${mb} MB read  ${matched} matched${suffix}\n`);
}

/** One streaming pass over the gzipped dump, collecting the lines whose id
 *  is in `targetIds`. Reads the whole file once; memory holds only the
 *  matched entities, not the file. */
async function extractEntityLines(dumpPath, targetIds, { phase, onProgress, progressIntervalMs }) {
  const found = new Map();
  if (targetIds.size === 0) return found;

  let bytesRead = 0;
  let lastTick = Date.now();
  const raw = createReadStream(dumpPath);
  raw.on("data", (chunk) => { bytesRead += chunk.length; });
  const rl = createInterface({ input: raw.pipe(createGunzip()), crlfDelay: Infinity });

  for await (const line of rl) {
    const id = lineEntityId(line);
    if (id && targetIds.has(id) && !found.has(id)) {
      const stripped = stripTrailingComma(line.trim());
      if (stripped && stripped !== "[" && stripped !== "]") {
        try {
          found.set(id, JSON.parse(stripped));
        } catch {
          // A partial line (e.g. the dump was still being written) — skip
          // it rather than abort the whole pass over it.
        }
      }
    }
    if (onProgress) {
      const now = Date.now();
      if (now - lastTick >= progressIntervalMs) {
        onProgress({ phase, bytesRead, matched: found.size });
        lastTick = now;
      }
    }
  }
  if (onProgress) onProgress({ phase, bytesRead, matched: found.size, done: true });
  return found;
}

async function writeEntityLinesAtomically(path, entitiesById) {
  const tmp = `${path}.tmp-${process.pid}`;
  const lines = [...entitiesById.values()].map((entity) => JSON.stringify(entity));
  await writeFile(tmp, lines.length ? `${lines.join("\n")}\n` : "");
  await rename(tmp, path);
}

async function loadEntityLines(path) {
  const text = await readFile(path, "utf8");
  const map = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entity = JSON.parse(line);
    map.set(entity.id, entity);
  }
  return map;
}

async function writeJsonAtomically(path, value) {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, path);
}

/** Builds `<outDir>/wikidata-slice.jsonl` from `dumpPath`. Returns a summary
 *  of what each phase found. `seedQids` overrides SEED_QIDS, for a fixture. */
export async function extractWikidataSlice({
  dumpPath = DEFAULT_DUMP_PATH,
  outDir = DEFAULT_OUT_DIR,
  seedQids = SEED_QIDS,
  progressIntervalMs = 60_000,
  onProgress = defaultProgressLogger,
} = {}) {
  await mkdir(outDir, { recursive: true });
  const stateDir = join(outDir, ".wikidata-slice-state");
  await mkdir(stateDir, { recursive: true });

  const seedIds = new Set(seedQids);
  const seedStatePath = join(stateDir, "pass-a-seed-entities.jsonl");
  const objectIdsStatePath = join(stateDir, "derived-object-qids.json");
  const objectStatePath = join(stateDir, "pass-b-object-entities.jsonl");

  const seedEntities = existsSync(seedStatePath)
    ? await loadEntityLines(seedStatePath)
    : await (async () => {
      const found = await extractEntityLines(dumpPath, seedIds, {
        phase: "pass A (seed entities)", onProgress, progressIntervalMs,
      });
      await writeEntityLinesAtomically(seedStatePath, found);
      return found;
    })();

  const objectIds = existsSync(objectIdsStatePath)
    ? new Set(JSON.parse(await readFile(objectIdsStatePath, "utf8")))
    : await (async () => {
      const derived = new Set();
      for (const entity of seedEntities.values()) {
        for (const id of objectQidsOf(entity)) {
          if (!seedIds.has(id)) derived.add(id);
        }
      }
      await writeJsonAtomically(objectIdsStatePath, [...derived].sort());
      return derived;
    })();

  const objectEntities = existsSync(objectStatePath)
    ? await loadEntityLines(objectStatePath)
    : await (async () => {
      const found = await extractEntityLines(dumpPath, objectIds, {
        phase: "pass B (object entities)", onProgress, progressIntervalMs,
      });
      await writeEntityLinesAtomically(objectStatePath, found);
      return found;
    })();

  const outPath = join(outDir, SLICE_FILENAME);
  const tmpOut = `${outPath}.tmp-${process.pid}`;
  const all = [...seedEntities.values(), ...objectEntities.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = all.map((entity) => JSON.stringify(entity));
  await writeFile(tmpOut, lines.length ? `${lines.join("\n")}\n` : "");
  await rename(tmpOut, outPath);

  return {
    outPath,
    seedsRequested: seedIds.size,
    seedsFound: seedEntities.size,
    objectQidsDerived: objectIds.size,
    objectsFound: objectEntities.size,
    totalLines: all.length,
  };
}

async function readDumpUrl() {
  const script = await readFile(RESUME_SCRIPT_PATH, "utf8");
  const match = /DUMP_URL="([^"]+)"/.exec(script);
  if (!match) throw new Error(`could not find DUMP_URL in ${RESUME_SCRIPT_PATH}`);
  return match[1];
}

/** The dump's expected byte count, read live from the same URL
 *  scripts/resume-wikidata-dump.sh downloads and size-checks against —
 *  never a number frozen into this file. */
export async function expectedDumpBytes({ timeoutMs = 15_000 } = {}) {
  const url = await readDumpUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    const length = response.headers.get("content-length");
    if (!length) throw new Error(`HEAD ${url} returned no content-length header`);
    return Number(length);
  } finally {
    clearTimeout(timer);
  }
}

/** Throws a clear, actionable error if `dumpPath` is missing or shorter than
 *  the dump's expected size. `expectedBytesFn` is a test seam for
 *  `expectedDumpBytes`, which otherwise makes a live network call. */
export async function verifyDumpReady(dumpPath, { expectedBytesFn = expectedDumpBytes } = {}) {
  if (!existsSync(dumpPath)) {
    throw new Error(`dump not found at ${dumpPath} — run: bash scripts/resume-wikidata-dump.sh`);
  }
  const { size } = await stat(dumpPath);
  let expected;
  try {
    expected = await expectedBytesFn();
  } catch (err) {
    throw new Error(
      `could not confirm the dump's expected size (${err.message}) — check network access, `
      + "then re-run bash scripts/resume-wikidata-dump.sh to confirm the download finished",
    );
  }
  if (size < expected) {
    throw new Error(
      `dump looks incomplete: ${size} of ${expected} bytes at ${dumpPath} — `
      + "run: bash scripts/resume-wikidata-dump.sh",
    );
  }
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const dumpPath = flagValue(argv, "--dump") || DEFAULT_DUMP_PATH;
  const outDir = flagValue(argv, "--out") || DEFAULT_OUT_DIR;

  try {
    await verifyDumpReady(dumpPath);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const result = await extractWikidataSlice({ dumpPath, outDir });
  process.stderr.write(
    `seeds: ${result.seedsFound}/${result.seedsRequested} found; `
    + `objects: ${result.objectsFound}/${result.objectQidsDerived} derived QIDs found\n`
    + `wrote ${result.outPath} (${result.totalLines} entity lines)\n`
    + `build with: node scripts/corpus-bands/build-wikidata-slice.mjs --source ${result.outPath}\n`,
  );
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
