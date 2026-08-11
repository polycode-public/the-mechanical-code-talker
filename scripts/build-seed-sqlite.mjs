// scripts/build-seed-sqlite.mjs — writes mid-seed.sqlite and xl-seed.sqlite
// under server/seeds/, replaying the SAME mid/xl JSON seeds
// (server/turn-service/build-seed.mjs, scripts/build-chat-seed.mjs) through
// createSqliteMemoryStore's own write path (appendFacts -> mutateMemory ->
// persistSqlitePayload), so the sqlite files carry exactly the facts and
// provenance the JSON seeds already carry, stored the way Backend C stores
// them rather than a raw file copy.
//
// The JSON seed is built only when missing, never rebuilt on every run: each
// fact's createdAt/provenance is read back out of that one JSON snapshot and
// passed through unchanged, so two sqlite builds off the SAME JSON snapshot
// produce the same facts with the same timestamps — the JSON build's own
// wall-clock createdAt stays fixed once written, instead of drifting on every
// sqlite rebuild.
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");

export const SEEDS_DIR = join(ROOT, "server", "seeds");

export const SEED_KINDS = Object.freeze({
  mid: {
    jsonPath: join(ROOT, "server", "turn-service", "mid-seed.json"),
    sqlitePath: join(SEEDS_DIR, "mid-seed.sqlite"),
    buildJsonModule: join(ROOT, "server", "turn-service", "build-seed.mjs"),
  },
  xl: {
    jsonPath: join(ROOT, "public", "chat-seed.json"),
    sqlitePath: join(SEEDS_DIR, "xl-seed.sqlite"),
    buildJsonModule: join(ROOT, "scripts", "build-chat-seed.mjs"),
  },
});

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

// The write path stamps each new Source's single-source trust and
// updatedAt from the real wall clock (core.mjs's syncFactSources has no "now"
// override in appendFacts' public signature), so two builds run seconds
// apart would otherwise carry two different trust floats for the same
// fact set. Freezing the clock for the appendFacts call pins that value to
// this one fixed instant, so the same fact set always writes the same
// bytes — a build-script-only concern; the deployed store still reads trust
// fresh at query time off each record's real (unfrozen) createdAt.
const FROZEN_BUILD_INSTANT = "2026-01-01T00:00:00.000Z";

async function withFrozenClock(isoInstant, fn) {
  const RealDate = Date;
  const fixedMs = RealDate.parse(isoInstant);
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(fixedMs);
      return new RealDate(...args);
    }
    static now() { return fixedMs; }
  }
  globalThis.Date = FrozenDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/** Ensure `kind`'s JSON seed exists at its own default path, building it
 *  through the existing pipeline only when absent. */
async function ensureJsonSeed(kind) {
  const { jsonPath, buildJsonModule } = SEED_KINDS[kind];
  if (!(await pathExists(jsonPath))) {
    const { main } = await import(buildJsonModule);
    await main(jsonPath);
  }
  return jsonPath;
}

/** Read a JSON seed file, normalize it through the store's own load path
 *  (createInMemoryStore + loadMemory, so a legacy-id or legacy-provenance
 *  migration runs exactly as it would for any other memory payload), and
 *  fold it into the row shape `appendFacts` accepts: one entry per asserting
 *  record, so a triple with N sources replays as N records, not one. */
export async function factsFromJsonSeed(jsonPath) {
  const { createInMemoryStore, loadMemory, readFactRows } =
    await import(join(ROOT, "src", "adapters", "memory", "core.mjs"));
  const raw = JSON.parse(await readFile(jsonPath, "utf8"));
  const handle = createInMemoryStore();
  handle.payload = raw;
  const payload = await loadMemory(handle);
  const rows = readFactRows(payload);
  const facts = [];
  for (const row of rows) {
    const justification = row.environments?.length ? row.environments : undefined;
    for (const assertion of row.assertions || []) {
      facts.push({
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        provenance: assertion.provenance || "",
        createdAt: assertion.createdAt || "",
        ...(assertion.observedAt ? { observedAt: assertion.observedAt } : {}),
        quantifier: row.quantifier || "",
        ...(assertion.extraction ? { extraction: assertion.extraction } : {}),
        ...(justification ? { justification } : {}),
      });
    }
  }
  return { facts, factCount: rows.length };
}

/** Write `facts` into a fresh sqlite file at `sqlitePath` through
 *  createSqliteMemoryStore's public write path, then normalize the on-disk
 *  file so the SAME fact set always produces the SAME bytes: checkpoint and
 *  drop the WAL journal, then VACUUM to rebuild the file from a clean,
 *  content-only pass rather than whatever incidental page layout the write
 *  sequence left behind. */
export async function writeSqliteSeed(sqlitePath, facts) {
  const { createSqliteMemoryStore, closeSqliteMemoryStore, appendFacts } =
    await import(join(ROOT, "src", "adapters", "memory", "core.mjs"));

  await mkdir(dirname(sqlitePath), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${sqlitePath}${suffix}`, { force: true });
  }

  const handle = await createSqliteMemoryStore(sqlitePath);
  const res = await withFrozenClock(FROZEN_BUILD_INSTANT, () => appendFacts(handle, facts));
  handle.db.exec("PRAGMA journal_mode = DELETE");
  handle.db.exec("VACUUM");
  closeSqliteMemoryStore(handle);

  for (const suffix of ["-wal", "-shm"]) {
    await rm(`${sqlitePath}${suffix}`, { force: true });
  }
  return res;
}

export async function sha256File(path) {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

/** Build one seed kind ("mid" or "xl") end to end: ensure its JSON seed
 *  exists, replay its facts through the sqlite store's writer, print the
 *  output file's sha256. Returns `{ sqlitePath, factCount, appended, sha256 }`. */
export async function buildSeedSqlite(kind) {
  if (!SEED_KINDS[kind]) throw new Error(`build-seed-sqlite: unknown seed kind "${kind}" (expected "mid" or "xl")`);
  const jsonPath = await ensureJsonSeed(kind);
  const { facts, factCount } = await factsFromJsonSeed(jsonPath);
  if (!facts.length) throw new Error(`build-seed-sqlite: ${kind} JSON seed at ${jsonPath} carries no facts`);
  const { sqlitePath } = SEED_KINDS[kind];
  const res = await writeSqliteSeed(sqlitePath, facts);
  const sha256 = await sha256File(sqlitePath);
  return { kind, jsonPath, sqlitePath, factCount, appended: res.appended, sha256 };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const requested = process.argv[2];
  const kinds = requested ? [requested] : Object.keys(SEED_KINDS);
  for (const kind of kinds) {
    const res = await buildSeedSqlite(kind);
    console.log(`${res.kind}: ${res.factCount} triples (${res.appended} records) -> ${res.sqlitePath}`);
    console.log(`${res.kind}: sha256 ${res.sha256}`);
  }
}
