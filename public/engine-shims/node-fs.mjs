// node-fs.mjs — browser stand-in for `node:fs`, mapped via the page's import map.
//
// Why this ISN'T a trivial throwing stub (unlike node-module.mjs): direct
// instrumentation of a real ask() call proved that src/grammar/lexicon.mjs's
// readFileSync(lexicon-core.json) DOES execute on the ordinary synchronous query
// path — not just in some opt-in async branch. The chain is: ask.mjs's parseQuery
// -> interpret/pipeline.mjs's runStrategiesSync calls every registered strategy's
// `.run()` synchronously (including the async-declared ACE strategy — an async
// function with no internal `await` still runs its body synchronously up to the
// implicit Promise wrap) -> interpret/strategies/ace.mjs's runAce -> grammar/ace.mjs's
// parseAce(sentence, lexicon = loadLexicon()) evaluates its default parameter on
// EVERY call -> grammar/lexicon.mjs's loadLexicon() calls readFileSync(CORE_FILE).
// (runStrategiesSync's "skip a Promise-returning strategy" only decides whether to
// KEEP the settled result — it doesn't stop the synchronous body from running first.)
//
// So this shim genuinely serves the real committed lexicon-core.json — fetched once,
// verbatim, from the copy sitting alongside the other engine sources (public/engine/
// src/grammar/lexicon-core.json, copied byte-for-byte by the same CI step that copies
// the engine's .mjs files) — rather than pretending the call never happens. Top-level
// await is fine here: ES module graphs resolve a module's top-level await before
// anything that imports it can run.
//
// existsSync is the one other export actually imported (by embed.mjs, for the
// optional static-embedding weights). embed.mjs's functions are only reachable behind
// the `embedRank` opt-in flag, which this page never sets — so existsSync is honestly
// wired to "the weights are never present here" rather than faked as available.

const LEXICON_CORE_URL = new URL("../engine/src/grammar/lexicon-core.json", import.meta.url);

const lexiconCoreText = await fetch(LEXICON_CORE_URL).then((res) => {
  if (!res.ok) throw new Error(`node-fs shim: failed to fetch lexicon-core.json (HTTP ${res.status})`);
  return res.text();
});

/** Serves the real lexicon-core.json text for the one path lexicon.mjs actually
 *  reads. Any other path throws — nothing else should ever call this in the browser. */
export function readFileSync(path, _encoding) {
  const p = String(path);
  if (p.endsWith("lexicon-core.json")) return lexiconCoreText;
  throw new Error(`node-fs shim: readFileSync("${p}") has no browser-side backing file`);
}

/** Only embed.mjs's optional embedRank path calls this — always false here since the
 *  page never ships the (30 MB, gitignored) static-embedding weights. */
export function existsSync(_path) {
  return false;
}
