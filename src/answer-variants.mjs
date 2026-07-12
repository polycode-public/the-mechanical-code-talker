// answer-variants.mjs — deterministic, committed answer-phrasing variety
// ("wiring the generated corpus into the live answer path", ROADMAP.md's
// What's next item / archive/PLAN_TEMPLATE_COVERAGE.md's stated follow-on).
//
// A SMALL, curated, committed table (answer-variants.json) of safe cosmetic/
// locational/connector-word rephrasings for a deliberately narrow set of
// answer templates in ask.mjs/chat.mjs -- never a relation verb (imports/
// calls/tests/inherits/touches), never an entity id/label/path, never a miss/
// rephrase-hint template. Each pool was hand-reviewed for meaning-safety in
// its SPECIFIC rendered sentence (see answer-variants.json's own "curation"
// field) -- WordNet was consulted but its sense-1 lookups mostly resolved to
// the wrong sense for this domain-specific connector vocabulary, so nothing
// here was auto-accepted from a raw synset match.
//
// Selection is a pure hash, never Math.random/Date.now: the SAME (poolId, key)
// always picks the SAME form, so the same query against the same entity
// renders byte-identical text every time (pinnable in tests), while different
// entities/answers spread across the pool's forms. This is the ONE place that
// hash-and-pick logic lives -- every call site below imports pickPhrase
// rather than re-deriving its own index arithmetic.
//
// Lazy + failure-tolerant load (chat.mjs's own "a turn never crashes" ethos,
// see chatTemplates()): a missing/corrupt data file, or `node:fs` simply
// being unavailable, degrades to always returning `base` -- never a throw.
// That second case is load-bearing, not theoretical: ask.mjs is bundled
// whole into the browser "Ask the graph" panel (scripts/build-ask-bundle.mjs
// stubs node:fs's readFileSync as a function that THROWS when called, so the
// browser bundle still boots; this module's readFileSync call only ever
// happens lazily inside pickPhrase, wrapped in try/catch, exactly so that
// throw is caught here and never reaches the caller.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), "answer-variants.json");

let dataCache; // undefined = not yet attempted; null = load failed/unavailable
function loadData() {
  if (dataCache !== undefined) return dataCache;
  try {
    dataCache = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  } catch {
    dataCache = null;
  }
  return dataCache;
}

/** Deterministically choose `base` or one of `poolId`'s committed variants,
 *  keyed on `key` -- pass something stable that identifies THIS specific
 *  answer (an entity's own `id` for entity-anchored templates; any other
 *  stable string, e.g. a graph-summary key, for templates with no single
 *  entity). Same (poolId, key) always returns the same string; an unknown
 *  pool, a missing/unreadable data file, or a falsy `key` all fall back to
 *  `base` unconditionally -- variety is strictly additive, never a way to
 *  lose the original wording. */
export function pickPhrase(poolId, key, base) {
  if (!key) return base;
  const data = loadData();
  const variants = data?.pools?.[poolId]?.variants;
  if (!Array.isArray(variants) || !variants.length) return base;
  const forms = [base, ...variants];
  const digest = createHash("sha256").update(`${poolId}:${String(key)}`).digest();
  const idx = digest[0] % forms.length;
  return forms[idx];
}
