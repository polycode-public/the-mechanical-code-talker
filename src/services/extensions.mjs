// extensions.mjs — the extension-pack seam: one place a host repo (or a third-party
// package) declares which corpus/lexicon/templates bundles feed tmct, and how much each
// bundle's facts are trusted relative to the others.
//
//   resolveExtensions(repoRoot) → { entries: Map<name, ResolvedEntry>, biasByBundle }
//
// `human` is the default active bundle (everyday-world vocabulary); every other
// bundle ships inactive, activated via `tmct init --with-persona`/`--corpus <id>`
// or a `[extensions.<name>] active = true` override. `human-medium`/`human-large`
// are additive SIZE TIERS of `human`, not separate personas.
//
// A `tmct.toml` `[extensions]` table-of-tables may override a recognized builtin, or
// declare a new host entry with its own `kind` (corpus | lexicon | templates | pack |
// ontology). A separate flat `[bias]` table (bundle-name → number) feeds
// src/domain/memory/bias.mjs's ranking.
//
// Entries are returned in a fixed order: `seon` first, then `conceptnet`, then the rest
// sorted by name (so seon's curated facts win idempotency races over ConceptNet noise).

import { isAbsolute, join, resolve, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CODE_VOCAB_DATA } from "./lane-vocab-data.mjs";
import { loadTomlConfig } from "../adapters/toml-config.mjs";
import {
  SEON_CONCEPTS_FILE,
  SLICE_FILE as CONCEPTNET_SLICE_FILE,
  MAP_FILE as CONCEPTNET_MAP_FILE,
  TIER2_DIR,
  WORDNET_DIR,
  loadSlice,
  loadMap,
  toFacts,
} from "../adapters/corpus/conceptnet.mjs";

// corpus/namenet/generate.mjs's output — a single small top-up bundle.
const NAMENET_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "corpus", "namenet");

// The CHILD triples pack: gzipped shards plus a term index, not a slice file,
// so its entry declares shard_pack_path and seeds through child-seed.mjs.
const CHILD_PACK_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "corpus", "child");

// The code domain pack's lane vocabulary — count nouns/class labels, help rows
// and the miss-recovery pointer today's code-graph surfaces render, moved out
// of chat.mjs so a bare install carries none of it (see mergedLaneVocab).
const CODE_VOCAB_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "corpus", "domains", "code", "vocab.json");

export const EXTENSION_KINDS = Object.freeze(["corpus", "lexicon", "templates", "pack", "ontology"]);

// The definitional-band-first predicate order for the ConceptNet seed (re-declared,
// not imported, to keep this module off chat.mjs's heavy graph). The five
// relational predicates after the definitional backbone are the ones a
// commonsense multiple-choice question keys on (atLocation, causes, desires,
// motivatedByGoal, hasSubevent) — ranked ahead of the rest so the band cap
// buys them before it buys more RelatedTo.
const CONCEPTNET_PREFER = [
  "rdfs:subClassOf", "rdf:type", "mgx:usedFor", "mgx:partOf", "mgx:capableOf",
  "mgx:atLocation", "mgx:causes", "mgx:desires", "mgx:motivatedByGoal", "mgx:hasSubevent",
];

/** The shipped defaults — a FRESH object per call, so a caller can never
 *  accidentally mutate a module-level singleton. */
function builtinExtensions() {
  return {
    // Opt-in code-domain bundle.
    seon: {
      kind: "corpus",
      active: false,
      corpusPath: SEON_CONCEPTS_FILE,
      provenancePrefix: "corpus:seon",
    },
    // The code DOMAIN PACK: the seon corpus plus the lane vocabulary (count
    // nouns, help rows, the miss-recovery pointer) a code-graph session needs
    // — see mergedLaneVocab. Keeps seon's own provenance prefix (the curated-
    // definitions gate keys on "corpus:seon" rows regardless of which entry
    // seeded them). Its grounding channel is an extraction adapter: `tmct
    // index` (and the graphPaths provider seam) is the deterministic path
    // from a repo's own source to the facts this pack's vocabulary describes.
    code: {
      kind: "pack",
      active: false,
      corpusPath: SEON_CONCEPTS_FILE,
      provenancePrefix: "corpus:seon",
      vocabPath: CODE_VOCAB_FILE,
      vocabData: CODE_VOCAB_DATA,
      groundingKind: "extraction",
      groundingAdapter: "tmct index (the graphPaths provider seam)",
    },
    // Opt-in too: the committed slice is tech-domain-filtered, equally biased.
    conceptnet: {
      kind: "corpus",
      active: false,
      corpusPath: CONCEPTNET_SLICE_FILE,
      provenancePrefix: "corpus:conceptnet",
      limit: undefined,
      prefer: CONCEPTNET_PREFER,
    },
    // The default active bundle: everyday-world vocabulary plus the scaffolding
    // connecting WordNet's and Schema.org's independently-built taxonomies.
    human: {
      kind: "corpus",
      active: true,
      corpusPath: join(TIER2_DIR, "human.jsonl"),
      provenancePrefix: "corpus:human",
    },
    // Medium/Large SIZE tiers of `human` (additive, not separate personas): each file
    // holds only the facts that size adds beyond the previous one.
    "human-medium": {
      kind: "corpus",
      active: false,
      corpusPath: join(TIER2_DIR, "human-medium.jsonl"),
      provenancePrefix: "corpus:human-medium",
    },
    "human-large": {
      kind: "corpus",
      active: false,
      corpusPath: join(TIER2_DIR, "human-large.jsonl"),
      provenancePrefix: "corpus:human-large",
    },
    "tier2-general": {
      kind: "corpus",
      active: false,
      corpusPath: join(TIER2_DIR, "general.jsonl"),
      provenancePrefix: "corpus:tier2-general",
    },
    // corpus/wordnet/generate.mjs's output: a mechanical ConceptNet-shape conversion of
    // Open English WordNet, too large to hand-curate like the tier-2 bundles above.
    "wordnet-xl": {
      kind: "corpus",
      active: false,
      corpusPath: join(WORDNET_DIR, "wordnet-xl.jsonl"),
      provenancePrefix: "corpus:wordnet-xl",
    },
    "wordnet-full": {
      kind: "corpus",
      active: false,
      corpusPath: join(WORDNET_DIR, "wordnet-full.jsonl"),
      provenancePrefix: "corpus:wordnet-full",
    },
    // corpus/namenet/generate.mjs's output: species/common-name and Wikidata/WordNet
    // synonym pairs. A small, optional top-up bundle, not a primary corpus.
    namenet: {
      kind: "corpus",
      active: false,
      corpusPath: join(NAMENET_DIR, "namenet.jsonl"),
      provenancePrefix: "corpus:namenet",
    },
    // scripts/fetch-child-corpus.mjs's output: the ConceptNet edges around the
    // vocabulary a child has by about age eight. The clean-miss cascade already
    // reads it one term at a time; activating it here seeds the whole pack, so
    // the reasoning layers see the edges instead of only a miss lookup.
    child: {
      kind: "corpus",
      active: false,
      shardPackPath: CHILD_PACK_DIR,
      provenancePrefix: "corpus:child",
    },
  };
}

export const BUILTIN_EXTENSIONS = Object.freeze(builtinExtensions());

/** Validate one RESOLVED extension entry — throws a clear, specific error naming the
 *  offending key. Shared by resolveExtensions and validateExtensionPack. */
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
  if (entry.kind === "corpus" && !entry.corpusPath && !entry.shardPackPath) {
    throw new Error(`extension "${name}": a "corpus" entry needs corpus_path or shard_pack_path`);
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
  if (entry.kind === "pack" && !entry.corpusPath && !entry.shardPackPath && !entry.lexiconPath && !entry.templatesPath && !entry.phrasebookPath) {
    throw new Error(`extension "${name}": a "pack" entry needs at least one of corpus_path/shard_pack_path/lexicon_path/templates_path/phrasebook_path`);
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
    ["shard_pack_path", "shardPackPath"],
    ["lexicon_path", "lexiconPath"],
    ["templates_path", "templatesPath"],
    ["phrasebook_path", "phrasebookPath"],
    ["map_path", "mapPath"],
    ["vocab_path", "vocabPath"],
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
  // The grounding-channel declaration (validateExtensionPack requires it on a
  // "pack" candidate): "extraction" names an adapter (grounding_adapter);
  // "taught-only" says the pack's facts grow solely through the teach lane.
  if (override.grounding_kind !== undefined) entry.groundingKind = String(override.grounding_kind);
  else if (builtin?.groundingKind !== undefined) entry.groundingKind = builtin.groundingKind;
  if (override.grounding_adapter !== undefined) entry.groundingAdapter = String(override.grounding_adapter);
  else if (builtin?.groundingAdapter !== undefined) entry.groundingAdapter = builtin.groundingAdapter;
  return entry;
}

/**
 * Resolve every extension entry a repo carries — the shipped builtins plus whatever
 * `tmct.toml`'s `[extensions]`/`[bias]` tables add or override. Returns
 * `{ entries, biasByBundle }`: `entries` is Map<name, ResolvedEntry> in fixed order (every
 * entry present, active or not — callers filter by `.active`); `biasByBundle` is
 * { bundleName: number } from the flat `[bias]` table (default {}).
 *
 * `configFile` (optional): an explicit tmct.toml path read instead of
 * `<repoRoot>/tmct.toml`; `repoRoot` still anchors every resource path.
 */
export async function resolveExtensions(repoRoot, { configFile } = {}) {
  const raw = repoRoot ? await loadTomlConfig(repoRoot, configFile ? { file: configFile } : {}) : null;
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

/** Whether this entry has corpus facts to write: a `corpus`/`ontology` entry, or
 *  a `pack` entry that declares a corpus file. The one rule both the seeding
 *  loop and `tmct init`/`tmct import`'s status line read, so a bundle can never
 *  seed under one and read as "nothing to seed" under the other. */
export function isSeedableEntry(entry) {
  if (!entry) return false;
  if (entry.kind === "corpus" || entry.kind === "ontology") return true;
  return entry.kind === "pack" && Boolean(entry.corpusPath || entry.shardPackPath);
}

/** Seed every ACTIVE `corpus`/`ontology`-kind entry, plus any ACTIVE `pack`-kind entry
 *  that declares a `corpusPath`, into `repo`'s memory, one seedMemory() call per bundle.
 *  Shared by chat.mjs's first-run bootstrap, `tmct init`'s seed step, and
 *  `tmct init --corpus <id>`.
 *
 *  FAILURE-TOLERANT per bundle: one bad third-party pack's seedMemory throw is caught and
 *  recorded as `perBundle[name].error` while every other bundle still seeds normally.
 *  Returns `{ appended, skipped, total, perBundle: { name: {appended,skipped,total,error?} } }`.
 *
 *  `opts.captureUnknownContext`/`opts.unknownContextLimit` (both optional) forward to
 *  every seedMemory call unchanged — the tmct.toml `[seed]` knob (toml-config.mjs)
 *  applies uniformly across whichever bundles are active, not per-bundle. */
export async function seedActiveCorpusEntries(repo, entries, opts = {}) {
  const { seedMemory } = await import("../adapters/corpus/conceptnet.mjs");
  const { captureUnknownContext, unknownContextLimit } = opts;
  const perBundle = {};
  let appended = 0;
  let skipped = 0;
  let total = 0;
  for (const [name, entry] of entries instanceof Map ? entries : new Map()) {
    if (!entry.active) continue;
    if (!isSeedableEntry(entry)) continue;
    try {
      const res = entry.shardPackPath
        ? await (await import("../adapters/corpus/child-seed.mjs")).seedChildPack(repo, {
          packDir: entry.shardPackPath,
          provenancePrefix: entry.provenancePrefix,
          limit: entry.limit,
          prefer: entry.prefer,
        })
        : await seedMemory(repo, {
          slicePath: entry.corpusPath,
          mapPath: entry.mapPath,
          provenancePrefix: entry.provenancePrefix,
          limit: entry.limit,
          prefer: entry.prefer,
          captureUnknownContext,
          unknownContextLimit,
        });
      perBundle[name] = { appended: res.appended, skipped: res.skipped, total: res.total };
      appended += res.appended;
      skipped += res.skipped;
      total += res.total;
    } catch (err) {
      perBundle[name] = { appended: 0, skipped: 0, total: 0, error: err && err.message ? err.message : String(err) };
    }
  }
  return { appended, skipped, total, perBundle };
}

// ---- Part 3: lexicon-bundle merge -------------------------------------------

/** Merge every ACTIVE `lexicon`/`pack` entry's declared lexicon file into one
 *  `{nouns, verbs, adjectives, properNames}` object (grammar/lexicon.mjs's `loadLexicon`
 *  shape). Bundles merge in ascending bias order so a same-lemma collision resolves by
 *  bias, deterministically — a higher-bias bundle's entry always wins. Returns `null`
 *  when nothing merges. */
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

// ---- Part 3b: lane-vocabulary merge (vocab_path) -----------------------------

/** Merge every ACTIVE `pack`-kind entry's declared `vocab_path` file into one
 *  lane-vocabulary object: `countNouns`/`classLabels` (the count lane's noun
 *  table), `helpRows` (the command rows a code-domain pack contributes to
 *  `/help`) and `missRecoveryPointer` (the remedy line an empty session's
 *  banner offers). Bundles merge in ascending bias order, same rule as
 *  mergedLexiconExtra: a higher-bias bundle's same-key entry wins.
 *  `helpRows` and `countNouns`/`classLabels` are additive across bundles;
 *  `missRecoveryPointer` is single-valued, so the highest-bias bundle to
 *  declare one wins outright. No active pack with a vocab_path → every field
 *  comes back empty — a bare session carries no code-domain vocabulary. */
export async function mergedLaneVocab(entries, biasByBundle = {}) {
  const candidates = [];
  for (const [name, entry] of entries instanceof Map ? entries : new Map()) {
    if (!entry.active) continue;
    if (entry.kind !== "pack") continue;
    if (!entry.vocabPath && !entry.vocabData) continue;
    candidates.push({ name, path: entry.vocabPath, data: entry.vocabData, bias: biasByBundle[name] ?? 1 });
  }
  const merged = { countNouns: {}, classLabels: {}, helpRows: [], missRecoveryPointer: "" };
  if (!candidates.length) return merged;
  candidates.sort((a, b) => a.bias - b.bias);
  for (const c of candidates) {
    let raw;
    if (c.data) {
      raw = c.data;
    } else {
      try {
        raw = JSON.parse(await readFile(c.path, "utf8"));
      } catch (e) {
        throw new Error(`extension "${c.name}": vocab file ${c.path} — ${e && e.message ? e.message : e}`);
      }
    }
    Object.assign(merged.countNouns, raw.countNouns || {});
    Object.assign(merged.classLabels, raw.classLabels || {});
    if (Array.isArray(raw.helpRows)) merged.helpRows.push(...raw.helpRows);
    if (raw.missRecoveryPointer) merged.missRecoveryPointer = raw.missRecoveryPointer;
  }
  return merged;
}

let cachedDefaultCodeLaneVocab = null;
/** The shipped code pack's OWN lane vocabulary, loaded unconditionally
 *  (memoized — the file never changes mid-process). The safety net a caller
 *  holding a real code graph falls back to when the `code` pack itself isn't
 *  formally active in tmct.toml — the same "a real graph is enough" rule
 *  chat.mjs's own codeDomainActive already applies to the domain-active
 *  predicate. Never consulted when the domain is inactive. */
export function defaultCodeLaneVocab() {
  if (!cachedDefaultCodeLaneVocab) {
    const code = { ...builtinExtensions().code, active: true };
    cachedDefaultCodeLaneVocab = mergedLaneVocab(new Map([["code", code]]), {});
  }
  return cachedDefaultCodeLaneVocab;
}

/** Read one pack entry's own declaration into the shape a capability listing
 *  renders: the pack's name, the grounding channel it declares
 *  (grounding_kind/grounding_adapter) and how much its `vocab_path` file adds
 *  to the lane merge. A pack whose vocab file is missing or malformed still
 *  names itself and its grounding channel, with nothing counted — the listing
 *  reports what the pack declares, and never invents a contribution. */
async function declaredPackSummary(name, entry) {
  const summary = {
    name,
    groundingKind: entry.groundingKind || "",
    groundingAdapter: entry.groundingAdapter || "",
    commandCount: 0,
    countNounCount: 0,
  };
  if (!entry.vocabPath) return summary;
  try {
    const raw = JSON.parse(await readFile(entry.vocabPath, "utf8"));
    summary.commandCount = Array.isArray(raw.helpRows) ? raw.helpRows.length : 0;
    summary.countNounCount = Object.keys(raw.countNouns || {}).length;
  } catch { /* an unreadable vocab file lists as a pack that adds nothing */ }
  return summary;
}

/** Every ACTIVE `pack`-kind entry, summarized from its own declaration, in
 *  ascending bias order (name breaks a tie, so the listing is stable). The
 *  read-side companion to mergedLaneVocab: that merges what packs contribute,
 *  this says which packs contributed it. No active pack → an empty list, and
 *  a listing that names no domain at all. */
export async function activeDomainPacks(entries, biasByBundle = {}) {
  const candidates = [];
  for (const [name, entry] of entries instanceof Map ? entries : new Map()) {
    if (!entry.active) continue;
    if (entry.kind !== "pack") continue;
    candidates.push({ name, entry, bias: biasByBundle[name] ?? 1 });
  }
  candidates.sort((a, b) => a.bias - b.bias || a.name.localeCompare(b.name));
  const summaries = [];
  for (const c of candidates) summaries.push(await declaredPackSummary(c.name, c.entry));
  return summaries;
}

let cachedDefaultCodeDomainPacks = null;
/** The shipped code pack's OWN declaration as a one-entry listing — the same
 *  "a real graph is enough" fallback defaultCodeLaneVocab serves, for the
 *  caller that holds a real code graph without the `code` pack formally
 *  active in tmct.toml. Never consulted when the domain is inactive. */
export function defaultCodeDomainPacks() {
  if (!cachedDefaultCodeDomainPacks) {
    const code = { ...builtinExtensions().code, active: true };
    cachedDefaultCodeDomainPacks = activeDomainPacks(new Map([["code", code]]), {});
  }
  return cachedDefaultCodeDomainPacks;
}

// ---- Part 4: `tmct extend --validate <dir>` ---------------------------------

/** Validate one CANDIDATE extension pack entry against a directory, reusing the existing
 *  throw-loudly primitives (loadSlice/loadMap/toFacts, loadLexicon, loadTemplates).
 *  `candidate` is a resolved-shape entry whose paths are absolute or resolved against
 *  `dir`. Returns `{ ok, results: [{kind, path, ok, error?, counts?}] }`; never throws. */
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
      const { loadLexicon } = await import("../domain/grammar/lexicon.mjs");
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
      const { loadTemplates } = await import("../adapters/corpus/templates.mjs");
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

  if (candidate.vocabPath) {
    const path = abs(candidate.vocabPath);
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      const countNouns = raw.countNouns && typeof raw.countNouns === "object" ? Object.keys(raw.countNouns).length : 0;
      const classLabels = raw.classLabels && typeof raw.classLabels === "object" ? Object.keys(raw.classLabels).length : 0;
      const helpRows = Array.isArray(raw.helpRows) ? raw.helpRows.length : 0;
      results.push({ kind: "vocab", path, ok: true, counts: { countNouns, classLabels, helpRows } });
    } catch (e) {
      results.push({ kind: "vocab", path, ok: false, error: e && e.message ? e.message : String(e) });
    }
  }

  // The grounding-channel declaration — required on a "pack" candidate only
  // (a plain corpus/lexicon/templates/ontology entry declares no grounding):
  // exactly one of an extraction adapter (named) or explicit taught-only
  // mode. A pack declaring neither is symbols defined in symbols, with no
  // route from a domain's own artifacts back to the facts it describes.
  if (candidate.kind === "pack") {
    const gk = candidate.groundingKind;
    if (gk !== "extraction" && gk !== "taught-only") {
      results.push({
        kind: "grounding", path: "(pack manifest)", ok: false,
        error: `a "pack" entry needs "grounding_kind" of "extraction" or "taught-only" (got ${JSON.stringify(gk ?? null)})`,
      });
    } else if (gk === "extraction" && !candidate.groundingAdapter) {
      results.push({
        kind: "grounding", path: "(pack manifest)", ok: false,
        error: 'grounding_kind "extraction" needs "grounding_adapter" naming the adapter',
      });
    } else {
      results.push({
        kind: "grounding", path: "(pack manifest)", ok: true,
        counts: gk === "extraction" ? { channel: gk, adapter: candidate.groundingAdapter } : { channel: gk },
      });
    }
  }

  return { ok: results.length > 0 && results.every((r) => r.ok), results };
}
