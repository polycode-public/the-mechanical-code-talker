// extensions.mjs — the extension-pack seam: one place a host repo (or a
// third-party package such as seonix/marginalia) declares which corpus/
// lexicon/templates bundles feed tmct, and how much each bundle's facts are
// trusted relative to the others.
//
//   resolveExtensions(repoRoot) → { entries: Map<name, ResolvedEntry>, biasByBundle }
//
// BUILTIN_EXTENSIONS ships the exact two bundles chat.mjs's bootstrap has
// always seeded — `seon` and `conceptnet`, both active — plus four shipped-
// but-INACTIVE tier-2 bundles (`tier2-aws` / `tier2-python` / `tier2-java` /
// `tier2-general`). Activating one is a config-only edit (`tmct init --corpus
// aws`, or a `[extensions.tier2-aws] active = true` in tmct.toml) — zero code
// change. `tier2-general` (PLAN_AGENTS.md Phase 1) is deliberately NOT a
// language/domain bundle like the other three — everyday-knowledge concepts
// with zero code-domain framing, the "wider general-knowledge seed set"
// bullet made real instead of just mechanically activatable.
//
// A `tmct.toml` may carry a top-level `[extensions]` table-of-tables
// (`[extensions.tier2-aws]`, …): a RECOGNIZED name (one of the builtins above)
// may override `active`/paths/etc; an UNRECOGNIZED name declares a brand new
// host entry and MUST carry a `kind` (corpus | lexicon | templates | pack |
// ontology) — a `pack` entry may combine any of corpus_path/lexicon_path/
// templates_path/phrasebook_path under one `active` flag and one provenance
// name, the shape a third-party vocabulary package hands tmct. `ontology` is a
// DISTINCT, nameable kind for an ontology bundle (as opposed to a plain
// `corpus` bundle) — its `ontology_path` key is just an alias populating the
// SAME internal `corpusPath` field a corpus entry uses, so every downstream
// seeder/loader needs zero branching by kind name.
//
// A SEPARATE top-level `[bias]` table (flat: bundle-name → number) feeds
// src/memory/bias.mjs's ranking — never nested under `[extensions.*]`.
//
// Entries are returned in a FIXED, deterministic order — `seon` first, then
// `conceptnet`, then every other entry sorted by name — mirroring the
// seon-before-conceptnet idempotency-ordering precedent chat.mjs's
// seedBootstrapMemory already establishes (seon's curated facts should win the
// content-hash idempotency race over general ConceptNet noise).

import { isAbsolute, join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadTomlConfig } from "./toml-config.mjs";
import {
  SEON_CONCEPTS_FILE,
  SLICE_FILE as CONCEPTNET_SLICE_FILE,
  MAP_FILE as CONCEPTNET_MAP_FILE,
  TIER2_DIR,
  loadSlice,
  loadMap,
  toFacts,
} from "./corpus/conceptnet.mjs";

export const EXTENSION_KINDS = Object.freeze(["corpus", "lexicon", "templates", "pack", "ontology"]);

// The definitional-band-first predicate order chat.mjs's bootstrap has always
// passed for the ConceptNet seed (SEED_PREFER) — re-declared here (not
// imported from chat.mjs) to keep this module off chat.mjs's heavy graph, the
// same "re-declare, don't import" discipline init.mjs's own SEED_PREFER uses.
const CONCEPTNET_PREFER = ["rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf"];

/** The shipped defaults — a FRESH object per call, so a caller can never
 *  accidentally mutate a module-level singleton. */
function builtinExtensions() {
  return {
    seon: {
      kind: "corpus",
      active: true,
      corpusPath: SEON_CONCEPTS_FILE,
      provenancePrefix: "corpus:seon",
    },
    conceptnet: {
      kind: "corpus",
      active: true,
      corpusPath: CONCEPTNET_SLICE_FILE,
      provenancePrefix: "corpus:conceptnet",
      // matches chat.mjs's seedBootstrapMemory exactly: uncapped, definitional
      // band first.
      limit: undefined,
      prefer: CONCEPTNET_PREFER,
    },
    "tier2-aws": {
      kind: "corpus",
      active: false,
      corpusPath: join(TIER2_DIR, "aws.jsonl"),
      provenancePrefix: "corpus:tier2-aws",
    },
    "tier2-python": {
      kind: "corpus",
      active: false,
      corpusPath: join(TIER2_DIR, "python.jsonl"),
      provenancePrefix: "corpus:tier2-python",
    },
    "tier2-java": {
      kind: "corpus",
      active: false,
      corpusPath: join(TIER2_DIR, "java.jsonl"),
      provenancePrefix: "corpus:tier2-java",
    },
    "tier2-general": {
      kind: "corpus",
      active: false,
      corpusPath: join(TIER2_DIR, "general.jsonl"),
      provenancePrefix: "corpus:tier2-general",
    },
  };
}

export const BUILTIN_EXTENSIONS = Object.freeze(builtinExtensions());

/** Validate one RESOLVED extension entry — throws a clear, specific error
 *  naming the offending key. Shared by resolveExtensions (every entry, always
 *  on) and Part 4's validateExtensionPack (a candidate pack directory). */
export function validateExtensionEntry(name, entry) {
  if (!entry || typeof entry !== "object") {
    throw new Error(`extension "${name}": entry must be an object`);
  }
  if (!EXTENSION_KINDS.includes(entry.kind)) {
    throw new Error(`extension "${name}": unknown kind ${JSON.stringify(entry.kind)} (must be one of ${EXTENSION_KINDS.join(", ")})`);
  }
  if (entry.active !== undefined && typeof entry.active !== "boolean") {
    throw new Error(`extension "${name}": "active" must be a boolean`);
  }
  if (entry.kind === "corpus" && !entry.corpusPath) {
    throw new Error(`extension "${name}": a "corpus" entry needs corpus_path`);
  }
  if (entry.kind === "ontology" && !entry.corpusPath) {
    throw new Error(`extension "${name}": an "ontology" entry needs ontology_path`);
  }
  if (entry.kind === "lexicon" && !entry.lexiconPath) {
    throw new Error(`extension "${name}": a "lexicon" entry needs lexicon_path`);
  }
  if (entry.kind === "templates" && !entry.templatesPath) {
    throw new Error(`extension "${name}": a "templates" entry needs templates_path`);
  }
  if (entry.kind === "pack" && !entry.corpusPath && !entry.lexiconPath && !entry.templatesPath && !entry.phrasebookPath) {
    throw new Error(`extension "${name}": a "pack" entry needs at least one of corpus_path/lexicon_path/templates_path/phrasebook_path`);
  }
  if (entry.limit !== undefined && !Number.isFinite(entry.limit)) {
    throw new Error(`extension "${name}": "limit" must be a finite number`);
  }
  if (entry.prefer !== undefined && !Array.isArray(entry.prefer)) {
    throw new Error(`extension "${name}": "prefer" must be an array of predicate URIs`);
  }
}

const resolvePathMaybe = (repoRoot, p) => {
  if (p === undefined || p === null) return undefined;
  const s = String(p);
  return isAbsolute(s) ? s : resolve(repoRoot, s);
};

/** Merge a builtin default (or null, for a host-declared entry) with a raw
 *  `[extensions.<name>]` TOML override into one RESOLVED entry (camelCase
 *  fields, paths resolved against repoRoot). */
function mergeExtensionEntry(name, builtin, override, repoRoot) {
  if (!builtin && override.kind === undefined) {
    throw new Error(`extension "${name}": an unrecognized extension needs a "kind" (one of ${EXTENSION_KINDS.join(", ")})`);
  }
  const entry = {
    kind: override.kind !== undefined ? override.kind : builtin?.kind,
    active: override.active !== undefined ? Boolean(override.active) : Boolean(builtin?.active),
  };
  const paths = [
    ["corpus_path", "corpusPath"],
    ["ontology_path", "corpusPath"], // alias: an "ontology" entry's own path key, same internal field as "corpus"
    ["lexicon_path", "lexiconPath"],
    ["templates_path", "templatesPath"],
    ["phrasebook_path", "phrasebookPath"],
    ["map_path", "mapPath"],
  ];
  for (const [rawKey, key] of paths) {
    if (override[rawKey] !== undefined) entry[key] = resolvePathMaybe(repoRoot, override[rawKey]);
    else if (builtin?.[key] !== undefined) entry[key] = builtin[key];
  }
  entry.provenancePrefix = override.provenance_prefix !== undefined
    ? String(override.provenance_prefix)
    : (builtin?.provenancePrefix ?? `corpus:${name}`);
  if (override.limit !== undefined) entry.limit = Number(override.limit);
  else if (builtin?.limit !== undefined) entry.limit = builtin.limit;
  if (override.prefer !== undefined) entry.prefer = override.prefer;
  else if (builtin?.prefer !== undefined) entry.prefer = builtin.prefer;
  return entry;
}

/**
 * Resolve every extension entry a repo carries — the shipped builtins plus
 * whatever `tmct.toml`'s `[extensions]`/`[bias]` tables add or override.
 * Returns `{ entries, biasByBundle }`:
 *   - `entries`: Map<name, ResolvedEntry> in FIXED order (seon, conceptnet,
 *     then the rest sorted by name). EVERY entry is present (active or not) —
 *     callers filter by `.active` themselves (Part 2's corpus loader loop).
 *   - `biasByBundle`: { bundleName: number } from the flat top-level `[bias]`
 *     table (default {} — every bundle then ranks at bias 1, see bias.mjs).
 * No `tmct.toml` (or one with no `[extensions]`/`[bias]` tables) resolves to
 * exactly today's implicit seon+conceptnet default, byte-identical.
 */
export async function resolveExtensions(repoRoot) {
  const raw = repoRoot ? await loadTomlConfig(repoRoot) : null;
  const defs = builtinExtensions();
  const rawExtensions = (raw && raw.extensions && typeof raw.extensions === "object") ? raw.extensions : {};
  const rawBias = (raw && raw.bias && typeof raw.bias === "object") ? raw.bias : {};

  const names = new Set([...Object.keys(defs), ...Object.keys(rawExtensions)]);
  const resolved = new Map();
  for (const name of names) {
    const entry = mergeExtensionEntry(name, defs[name] || null, rawExtensions[name] || {}, repoRoot || process.cwd());
    validateExtensionEntry(name, entry);
    resolved.set(name, entry);
  }

  const biasByBundle = {};
  for (const [name, value] of Object.entries(rawBias)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`[bias] "${name}": bias must be a finite number, got ${JSON.stringify(value)}`);
    }
    biasByBundle[name] = value;
  }

  const rest = [...resolved.keys()].filter((n) => n !== "seon" && n !== "conceptnet").sort();
  const orderedNames = ["seon", "conceptnet", ...rest].filter((n) => resolved.has(n));
  const entries = new Map(orderedNames.map((n) => [n, resolved.get(n)]));

  return { entries, biasByBundle };
}

// ---- Part 2: the unified corpus loader loop ---------------------------------

/** Seed every ACTIVE `corpus`/`ontology`-kind entry, plus any ACTIVE `pack`-kind
 *  entry that declares a `corpusPath` (in the Map's own fixed order — seon,
 *  conceptnet, then the rest sorted by name) into `repo`'s memory, ONE
 *  seedMemory() call per bundle. Shared by chat.mjs's first-run bootstrap,
 *  `tmct init`'s seed step and `tmct init --corpus <id>` — so all three read
 *  the SAME loop instead of three independent hardcoded call sites.
 *
 *  BUGFIX (this batch): a `pack`-kind entry's `corpusPath` used to be silently
 *  skipped here despite this module's own docblock claiming pack entries
 *  combine corpus_path/lexicon_path/etc — a pack's corpus facts never made it
 *  into memory. Fixed by seeding any active pack entry that declares a
 *  corpusPath, alongside corpus/ontology entries.
 *
 *  FAILURE-TOLERANT per bundle (init.mjs's own doctrine: a missing/broken
 *  corpus degrades to "not seeded", never a crash): one bad third-party pack's
 *  seedMemory throw is CAUGHT and recorded as `perBundle[name].error` — logged
 *  in the structured result rather than silently swallowed — while every
 *  OTHER bundle still seeds normally. Returns
 *  `{ appended, skipped, total, perBundle: { name: {appended,skipped,total,error?} } }`. */
export async function seedActiveCorpusEntries(repo, entries) {
  const { seedMemory } = await import("./corpus/conceptnet.mjs");
  const perBundle = {};
  let appended = 0;
  let skipped = 0;
  let total = 0;
  for (const [name, entry] of entries instanceof Map ? entries : new Map()) {
    if (!entry.active) continue;
    const seedable = entry.kind === "corpus" || entry.kind === "ontology" || (entry.kind === "pack" && entry.corpusPath);
    if (!seedable) continue;
    try {
      const res = await seedMemory(repo, {
        slicePath: entry.corpusPath,
        mapPath: entry.mapPath,
        provenancePrefix: entry.provenancePrefix,
        limit: entry.limit,
        prefer: entry.prefer,
      });
      perBundle[name] = { appended: res.appended, skipped: res.skipped, total: res.total };
      appended += res.appended;
      skipped += res.skipped;
      total += res.total;
    } catch (err) {
      // Logged (in the structured result), never silently swallowed — but this
      // ONE bundle's failure never aborts the others.
      perBundle[name] = { appended: 0, skipped: 0, total: 0, error: err && err.message ? err.message : String(err) };
    }
  }
  return { appended, skipped, total, perBundle };
}

// ---- Part 3: lexicon-bundle merge -------------------------------------------

/** Merge every ACTIVE `lexicon`/`pack` entry's declared lexicon file into one
 *  `{nouns, verbs, adjectives, properNames}` object — the exact shape
 *  grammar/lexicon.mjs's `loadLexicon(extra)` already accepts. Bundles merge
 *  in ASCENDING bias order (lowest first) so `loadLexicon`'s existing "extra
 *  entries win on conflict" last-write-wins semantics resolve a same-lemma
 *  collision by BIAS, deterministically, rather than by arbitrary load order —
 *  a higher-bias bundle's entry always wins. Ties (equal/absent bias) keep the
 *  entries' `entries` Map iteration order (itself the fixed seon/conceptnet/
 *  sorted-rest order). Entries with no lexiconPath are skipped. Returns `null`
 *  when nothing merges (so a caller can pass `undefined` through to
 *  `loadLexicon` unchanged — the byte-identical no-extension default). */
export async function mergedLexiconExtra(entries, biasByBundle = {}) {
  const candidates = [];
  for (const [name, entry] of entries instanceof Map ? entries : new Map()) {
    if (!entry.active) continue;
    if (entry.kind !== "lexicon" && entry.kind !== "pack") continue;
    if (!entry.lexiconPath) continue;
    candidates.push({ name, path: entry.lexiconPath, bias: biasByBundle[name] ?? 1 });
  }
  if (!candidates.length) return null;
  // stable ascending-bias sort: ties keep the Map's own (fixed) iteration order.
  candidates.sort((a, b) => a.bias - b.bias);
  const merged = { nouns: {}, verbs: {}, adjectives: {}, properNames: [] };
  for (const c of candidates) {
    let raw;
    try {
      raw = JSON.parse(await readFile(c.path, "utf8"));
    } catch (e) {
      throw new Error(`extension "${c.name}": lexicon file ${c.path} — ${e && e.message ? e.message : e}`);
    }
    Object.assign(merged.nouns, raw.nouns || {});
    Object.assign(merged.verbs, raw.verbs || {});
    Object.assign(merged.adjectives, raw.adjectives || {});
    if (Array.isArray(raw.properNames)) {
      for (const n of raw.properNames) if (!merged.properNames.includes(n)) merged.properNames.push(n);
    }
  }
  return merged;
}

// ---- Part 4: `tmct extend --validate <dir>` ---------------------------------

/** Validate one CANDIDATE extension pack entry against a directory — reuses
 *  the existing throw-loudly primitives (loadSlice/loadMap/toFacts,
 *  loadLexicon, loadTemplates) rather than inventing new shape-checking logic.
 *  `candidate` is a resolved-shape entry (see mergeExtensionEntry) whose paths
 *  are absolute or resolved against `dir`. Returns
 *  `{ ok, results: [{kind, path, ok, error?, counts?}] }` — never throws;
 *  every failure is CAUGHT and reported as one `results[]` row. */
export async function validateExtensionPack(dir, candidate) {
  const results = [];
  const abs = (p) => (p ? (isAbsolute(p) ? p : resolve(dir, p)) : p);

  if (candidate.corpusPath) {
    const path = abs(candidate.corpusPath);
    try {
      const assertions = await loadSlice(path);
      const map = await loadMap(abs(candidate.mapPath) || CONCEPTNET_MAP_FILE);
      const facts = toFacts(assertions, map, candidate.provenancePrefix || "corpus:pack");
      results.push({ kind: "corpus", path, ok: true, counts: { assertions: assertions.length, facts: facts.length } });
    } catch (e) {
      results.push({ kind: "corpus", path, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  if (candidate.lexiconPath) {
    const path = abs(candidate.lexiconPath);
    try {
      const { loadLexicon } = await import("./grammar/lexicon.mjs");
      const raw = JSON.parse(await readFile(path, "utf8"));
      const lex = loadLexicon(raw);
      results.push({
        kind: "lexicon", path, ok: true,
        counts: { nouns: lex.nouns.size, verbs: lex.verbs.size, adjectives: lex.adjectives.size, properNames: lex.properNames.size },
      });
    } catch (e) {
      results.push({ kind: "lexicon", path, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  if (candidate.templatesPath) {
    const path = abs(candidate.templatesPath);
    try {
      const { loadTemplates } = await import("./corpus/templates.mjs");
      const templates = await loadTemplates(path);
      const unnamespaced = [...templates.keys()].filter((id) => !id.includes(":"));
      if (unnamespaced.length) {
        throw new Error(`template id${unnamespaced.length > 1 ? "s" : ""} not namespaced "<packname>:<id>": ${unnamespaced.join(", ")}`);
      }
      results.push({ kind: "templates", path, ok: true, counts: { templates: templates.size } });
    } catch (e) {
      results.push({ kind: "templates", path, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
