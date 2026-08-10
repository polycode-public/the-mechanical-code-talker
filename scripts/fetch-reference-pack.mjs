#!/usr/bin/env node
// scripts/fetch-reference-pack.mjs — build corpus/reference/, the shipped
// reference pack the clean-miss lookup answers from: 64 gzipped JSONL shards
// plus a gzipped term index, cut from a pinned Simple English Wikipedia dump.
// Maintainer-only: never imported by src/ or bin/, never run by `npm test`.
// Dependency-free (node builtins only), run by hand, results committed.
//
//   node scripts/fetch-reference-pack.mjs --dump 20260701 [--cache <dir>] [--out <dir>]
//
// The dump date pins the pack: the URL, the sha256 and every article revid are
// recorded in the manifest, so a rebuild from the same dump is byte-identical
// (sorted emit, gzip with mtime 0) and a re-download is verifiable. After the
// first build, --dump may be omitted — the date is read back from the manifest.
//
// The decompressor is a SPAWNED SYSTEM `bzip2 -dc`: node:zlib speaks gzip and
// deflate but not bz2, and the no-new-dependencies rule holds for scripts too.
// The dump is streamed through it twice — once collecting redirects, once
// processing articles — because a redirect can appear before its target and
// buffering every ns-0 article to wait for one would hold most of the dump in
// memory. Two decompression passes are minutes; the memory stays flat.
//
// Licensing: the articles are CC BY-SA 4.0 (share-alike, viral) and the pack
// ships in the npm package, so corpus/reference/ carries its own
// LICENSE-NOTICE and a corpus/LICENSES.json entry, exactly like
// corpus/prose/wikipedia/.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  shardNameFor, cleanMissReferenceTerm, isReferenceArticleRow,
  sentencesUpTo, isaOf, SUMMARY_CHAR_CAP, articleUrlFor, REFERENCE_PACK_ORIGIN,
} from "../src/domain/reference-pack.mjs";
import { loadLexicon } from "../src/domain/grammar/lexicon.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "corpus", "reference");
const CACHE_DEFAULT = join(homedir(), ".cache", "tmct-reference");

export const BUDGET_TEXT_BYTES = 10 * 1024 * 1024;          // uncompressed article text
export const BUDGET_SHARDS_GZ_BYTES = Math.round(3.5 * 1024 * 1024);
export const BUDGET_INDEX_GZ_BYTES = 600 * 1024;

export const LEAD_CHAR_CAP = 2500;

// The summary/isa extraction helpers live in src/domain/reference-pack.mjs
// now (the live Wikipedia lookup shares them); re-exported so this script
// remains the pack pipeline's one import surface.
export { sentencesUpTo, isaOf, SUMMARY_CHAR_CAP };

export function dumpUrlFor(date) {
  return `https://dumps.wikimedia.org/simplewiki/${date}/simplewiki-${date}-pages-articles-multistream.xml.bz2`;
}

export function mirrorUrlFor(date) {
  return `https://archive.org/download/simplewiki-${date}/simplewiki-${date}-pages-articles-multistream.xml.bz2`;
}

// ---- phase b: parse + clean -------------------------------------------------

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", middot: "·", times: "×", deg: "°",
};

function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Streaming per-<page> parse over an async iterable of XML chunks. Yields
 *  { title, ns, redirect, revid, text } with XML entities decoded. Never loads
 *  more than the tail of the current page into memory. */
export async function* extractPages(chunks) {
  let buffer = "";
  const field = (xml, re) => {
    const m = xml.match(re);
    return m ? decodeEntities(m[1]) : null;
  };
  for await (const chunk of chunks) {
    buffer += chunk.toString("utf8");
    let end;
    while ((end = buffer.indexOf("</page>")) !== -1) {
      const start = buffer.indexOf("<page>");
      const pageXml = start !== -1 && start < end ? buffer.slice(start, end) : "";
      buffer = buffer.slice(end + "</page>".length);
      if (!pageXml) continue;
      const title = field(pageXml, /<title>([^<]*)<\/title>/);
      if (title === null) continue;
      yield {
        title,
        ns: Number(field(pageXml, /<ns>(\d+)<\/ns>/) ?? -1),
        redirect: field(pageXml, /<redirect [^>]*title="([^"]*)"/),
        revid: Number(field(pageXml, /<revision>\s*<id>(\d+)<\/id>/) ?? 0),
        text: field(pageXml, /<text[^>]*>([\s\S]*?)<\/text>/) ?? "",
      };
    }
    // no complete page yet: keep only from the last opening tag, so the
    // buffer never grows past one page plus a chunk
    const lastOpen = buffer.lastIndexOf("<page>");
    if (lastOpen > 0) buffer = buffer.slice(lastOpen);
    else if (lastOpen === -1 && buffer.length > 1 << 22) buffer = buffer.slice(-("<page>".length));
  }
}

export function redirectTargetOf(wikitext) {
  const m = String(wikitext ?? "").match(/^\s*#REDIRECT[:\s]*\[\[([^\]#|]+)/i);
  return m ? m[1].replace(/_/g, " ").trim() : null;
}

export function isDisambiguation(wikitext) {
  return /\{\{\s*(?:disambiguation|disambig|dab|hndis|geodis|numberdis|surname|given name)\s*[|}]/i.test(String(wikitext ?? ""));
}

/** Strip every bracket-balanced [[Prefix:…]] block (File/Image/Category),
 *  which may nest [[links]] inside captions. */
function stripBracketedBlocks(text, prefixRe) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("[[", i) && prefixRe.test(text.slice(i + 2, i + 22))) {
      let depth = 0;
      let j = i;
      while (j < text.length) {
        if (text.startsWith("[[", j)) { depth += 1; j += 2; continue; }
        if (text.startsWith("]]", j)) { depth -= 1; j += 2; if (depth === 0) break; continue; }
        j += 1;
      }
      i = j;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

const STRIP_ITERATION_CAP = 64;

/** Deterministic wikitext → plain text for a LEAD section: cut at the first
 *  heading, strip comments/refs/templates/tables/media/category links, unwrap
 *  ordinary links, drop quote markup, decode entities, collapse whitespace. */
export function wikitextToPlain(wikitext) {
  let t = String(wikitext ?? "");
  const heading = t.search(/^\s*==[^=\n][^\n]*==\s*$/m);
  if (heading !== -1) t = t.slice(0, heading);
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<ref[^>]*\/>/gi, " ").replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, " ");
  for (let i = 0; i < STRIP_ITERATION_CAP; i += 1) {
    const next = t.replace(/\{\{[^{}]*\}\}/g, " ");
    if (next === t) break;
    t = next;
  }
  for (let i = 0; i < STRIP_ITERATION_CAP; i += 1) {
    const next = t.replace(/^\{\|[\s\S]*?^\|\}\s*$/m, " ");
    if (next === t) break;
    t = next;
  }
  t = stripBracketedBlocks(t, /^(?:File|Image|Category)\s*:/i);
  for (let i = 0; i < STRIP_ITERATION_CAP; i += 1) {
    const next = t
      .replace(/\[\[[^[\]|]*\|([^[\]]*)\]\]/g, "$1")
      .replace(/\[\[([^[\]]*)\]\]/g, "$1");
    if (next === t) break;
    t = next;
  }
  t = t.replace(/'{2,}/g, "");
  t = decodeEntities(t);
  t = t.replace(/<[^>]+>/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** The build's article sanity gate: long enough to say something, starts like
 *  prose, contains a finished sentence. */
export function passesSanityCheck(plain) {
  const t = String(plain ?? "");
  return t.length >= 40 && /^[A-Za-z]/.test(t) && /\.\s|\.$/.test(t);
}

// ---- phase c: select --------------------------------------------------------

/**
 * Decide what ships. `pages` are cleaned ns-0 candidates
 * ({ title, revid, plain }); `redirects` are { from, to } title pairs. An
 * article ships iff its own title, or a redirect title pointing at it,
 * resolves through the lexicon (cleanMissReferenceTerm); it is keyed on that
 * entry's LEMMA. Lemmas are processed sorted and contenders sorted by title,
 * so the winner of any tie is the alphabetically first title, every run.
 * Returns { articles: Map(term -> row), aliases: Map(term -> targetTerm) }.
 */
export function selectArticles(pages, redirects, lexicon = loadLexicon()) {
  const pageByTitle = new Map(pages.map((p) => [p.title, p]));
  const contendersByLemma = new Map();
  const contend = (lemma, title) => {
    if (!lemma || !pageByTitle.has(title)) return;
    if (!contendersByLemma.has(lemma)) contendersByLemma.set(lemma, new Set());
    contendersByLemma.get(lemma).add(title);
  };
  for (const p of pages) contend(cleanMissReferenceTerm(p.title, lexicon), p.title);
  for (const r of redirects) contend(cleanMissReferenceTerm(r.from, lexicon), r.to);

  const articles = new Map();
  const aliases = new Map();
  const termByTitle = new Map();
  for (const lemma of [...contendersByLemma.keys()].sort()) {
    const [title] = [...contendersByLemma.get(lemma)].sort();
    if (termByTitle.has(title)) {
      aliases.set(lemma, termByTitle.get(title));
      continue;
    }
    const page = pageByTitle.get(title);
    const text = sentencesUpTo(page.plain, LEAD_CHAR_CAP);
    const isa = isaOf(page.plain, lexicon);
    articles.set(lemma, {
      term: lemma,
      title: page.title,
      text,
      summary: sentencesUpTo(page.plain, SUMMARY_CHAR_CAP),
      url: articleUrlFor(REFERENCE_PACK_ORIGIN, page.title),
      revid: page.revid,
      ...(isa ? { isa } : {}),
    });
    termByTitle.set(title, lemma);
  }
  return { articles, aliases };
}

// ---- phases d/e: emit -------------------------------------------------------

export const REFERENCE_LICENSE_NOTICE = `LICENSE NOTICE — corpus/reference/
==================================

The article shards and index in this directory are cleaned extracts of Simple
English Wikipedia articles. They are licensed under the Creative Commons
Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0), NOT under
this repository's MPL-2.0.

  https://creativecommons.org/licenses/by-sa/4.0/deed.en

Attribution
-----------

This text is from Simple English Wikipedia, written by Wikipedia contributors
and available under CC BY-SA 4.0. A Wikipedia article has no single author:
the authoritative author list IS its revision history, and per Wikipedia's own
reuse guidance linking to the article satisfies attribution. Every article row
carries its source URL and the exact revision id it was cut from, and every
answer tmct renders from this pack cites both.

Source and reproduction
-----------------------

Built by scripts/fetch-reference-pack.mjs (\`npm run gen:reference-pack\`) from
the pinned pages-articles dump recorded in manifest.json (URL, mirror URL,
date and sha256). Wikipedia is a living text; this pack is a FROZEN snapshot
of that dump, and the manifest's checksums identify the exact bytes shipped.

Share-alike — READ THIS BEFORE REUSING
--------------------------------------

CC BY-SA 4.0's share-alike condition is viral. If you redistribute these
files, modified or not, you must do so under CC BY-SA 4.0 with this
attribution. The extraction code (scripts/fetch-reference-pack.mjs) is tmct
code under this repository's MPL-2.0; only the data files in this directory
carry CC BY-SA 4.0.
`;

const REFERENCE_README = `# corpus/reference/

The shipped reference pack: cleaned Simple English Wikipedia leads the
clean-miss lookup answers from, with a gzipped term index consulted first and
exactly one gzipped JSONL shard loaded per hit (src/adapters/corpus/
reference-pack.mjs). Layout:

- \`index.json.gz\` — \`{ term: { s, t, r } }\`: shard name, canonical term key,
  revision id. Redirect titles appear as alias entries pointing at their
  target's row.
- \`shards/ref-00.jsonl.gz\` … \`ref-3f.jsonl.gz\` — one JSON row per article:
  \`{ term, title, text, summary, url, revid, isa? }\`, sharded by the term's
  FNV-1a first byte mod 64 (src/domain/reference-pack.mjs).
- \`manifest.json\` — the pinned dump (URL, mirror, date, sha256), build date,
  counts, budgets and a sha256 for every emitted file.
- \`LICENSE-NOTICE\` — CC BY-SA 4.0; read it before reusing these files.

Rebuild with \`npm run gen:reference-pack\` (downloads the dump into
~/.cache/tmct-reference/ on the first run). Same dump in, same bytes out.
`;

/** Write the pack: sorted shards, sorted index, LICENSE-NOTICE, README,
 *  manifest. Hard budget asserts — an over-budget pack fails the build loudly
 *  and writes no manifest; content is never trimmed silently. */
export function emitPack({ articles, aliases }, outDir, { dump, built = new Date().toISOString().slice(0, 10) } = {}) {
  const terms = [...articles.keys()].sort();
  let textBytes = 0;
  for (const term of terms) {
    const row = articles.get(term);
    if (!isReferenceArticleRow(row)) throw new Error(`emitPack: malformed article row for "${term}"`);
    textBytes += Buffer.byteLength(row.text, "utf8");
  }
  if (textBytes > BUDGET_TEXT_BYTES) {
    throw new Error(`emitPack: uncompressed article text ${textBytes} bytes exceeds the ${BUDGET_TEXT_BYTES}-byte budget`);
  }

  mkdirSync(join(outDir, "shards"), { recursive: true });
  const files = [];
  const record = (rel, body) => {
    writeFileSync(join(outDir, rel), body);
    files.push({ file: rel, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") });
    return body.length;
  };

  const byShard = new Map();
  for (const term of terms) {
    const s = shardNameFor(term);
    if (!byShard.has(s)) byShard.set(s, []);
    byShard.get(s).push(articles.get(term));
  }
  let shardGzBytes = 0;
  for (const s of [...byShard.keys()].sort()) {
    const body = gzipSync(Buffer.from(byShard.get(s).map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8"), { level: 9 });
    shardGzBytes += record(join("shards", `${s}.jsonl.gz`), body);
  }
  if (shardGzBytes > BUDGET_SHARDS_GZ_BYTES) {
    throw new Error(`emitPack: shards total ${shardGzBytes} gz bytes exceeds the ${BUDGET_SHARDS_GZ_BYTES}-byte budget`);
  }

  const index = {};
  for (const term of terms) {
    index[term] = { s: shardNameFor(term), t: term, r: articles.get(term).revid };
  }
  for (const [alias, target] of [...aliases.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (index[alias] || !articles.has(target)) continue;
    index[alias] = { s: shardNameFor(target), t: target, r: articles.get(target).revid };
  }
  const sortedIndex = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
  const indexGzBytes = record("index.json.gz", gzipSync(Buffer.from(JSON.stringify(sortedIndex), "utf8"), { level: 9 }));
  if (indexGzBytes > BUDGET_INDEX_GZ_BYTES) {
    throw new Error(`emitPack: index ${indexGzBytes} gz bytes exceeds the ${BUDGET_INDEX_GZ_BYTES}-byte budget`);
  }

  record("LICENSE-NOTICE", Buffer.from(REFERENCE_LICENSE_NOTICE, "utf8"));
  record("README.md", Buffer.from(REFERENCE_README, "utf8"));

  const manifest = {
    version: 1,
    generated: "by scripts/fetch-reference-pack.mjs",
    dump,
    built,
    counts: {
      articles: articles.size,
      aliases: Object.keys(sortedIndex).length - articles.size,
      shards: byShard.size,
    },
    budgets: {
      textBytes: { used: textBytes, max: BUDGET_TEXT_BYTES },
      shardsGzBytes: { used: shardGzBytes, max: BUDGET_SHARDS_GZ_BYTES },
      indexGzBytes: { used: indexGzBytes, max: BUDGET_INDEX_GZ_BYTES },
    },
    files: files.sort((a, b) => a.file.localeCompare(b.file)),
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

// ---- phase a: download ------------------------------------------------------

async function sha256OfFile(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Download the pinned dump into the cache (skipped when already there) and
 *  return { file, url, mirrorUrl, date, sha256 }. */
export async function downloadDump(date, cacheDir) {
  const url = dumpUrlFor(date);
  const file = join(cacheDir, `simplewiki-${date}-pages-articles-multistream.xml.bz2`);
  mkdirSync(cacheDir, { recursive: true });
  if (!existsSync(file)) {
    console.log(`fetch-reference-pack: downloading ${url} ...`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    const partial = `${file}.partial`;
    const out = createWriteStream(partial);
    for await (const chunk of response.body) {
      if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    await rename(partial, file);
  } else {
    console.log(`fetch-reference-pack: dump already cached at ${file} — skipping download`);
  }
  return { file, url, mirrorUrl: mirrorUrlFor(date), date, sha256: await sha256OfFile(file) };
}

// ---- the thin main ----------------------------------------------------------

function bunzipStream(file) {
  const child = spawn("bzip2", ["-dc", file], { stdio: ["ignore", "pipe", "inherit"] });
  child.on("error", (e) => {
    throw new Error(`spawning system bzip2 failed (${e.message}) — install bzip2; node:zlib has no bz2`);
  });
  return child.stdout;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const outDir = arg("--out", OUT_DEFAULT);
  const cacheDir = arg("--cache", CACHE_DEFAULT);
  let date = arg("--dump", null);
  if (!date) {
    const manifestFile = join(outDir, "manifest.json");
    if (existsSync(manifestFile)) date = JSON.parse(readFileSync(manifestFile, "utf8"))?.dump?.date;
  }
  if (!/^\d{8}$/.test(String(date ?? ""))) {
    console.error("usage: node scripts/fetch-reference-pack.mjs --dump <YYYYMMDD> [--cache <dir>] [--out <dir>]");
    console.error("(--dump may be omitted once corpus/reference/manifest.json records a date)");
    process.exit(2);
  }

  const dump = await downloadDump(date, cacheDir);
  console.log(`fetch-reference-pack: dump sha256 ${dump.sha256}`);

  console.log("fetch-reference-pack: pass 1/2 — collecting redirects...");
  const redirects = [];
  for await (const page of extractPages(bunzipStream(dump.file))) {
    if (page.ns !== 0) continue;
    const target = page.redirect ?? redirectTargetOf(page.text);
    if (target) redirects.push({ from: page.title, to: target });
  }
  console.log(`fetch-reference-pack: ${redirects.length} ns-0 redirects`);

  console.log("fetch-reference-pack: pass 2/2 — cleaning candidate articles...");
  const lexicon = loadLexicon();
  const wanted = new Set(redirects.filter((r) => cleanMissReferenceTerm(r.from, lexicon)).map((r) => r.to));
  const pages = [];
  for await (const page of extractPages(bunzipStream(dump.file))) {
    if (page.ns !== 0 || page.redirect || redirectTargetOf(page.text)) continue;
    if (!cleanMissReferenceTerm(page.title, lexicon) && !wanted.has(page.title)) continue;
    if (isDisambiguation(page.text)) continue;
    const plain = wikitextToPlain(page.text);
    if (!passesSanityCheck(plain)) continue;
    pages.push({ title: page.title, revid: page.revid, plain });
  }
  console.log(`fetch-reference-pack: ${pages.length} cleaned candidates`);

  const selection = selectArticles(pages, redirects, lexicon);
  await rm(join(outDir, "shards"), { recursive: true, force: true });
  const manifest = emitPack(selection, outDir, {
    dump: { url: dump.url, mirrorUrl: dump.mirrorUrl, date: dump.date, sha256: dump.sha256 },
  });
  console.log(
    `fetch-reference-pack: wrote ${manifest.counts.articles} articles, ${manifest.counts.aliases} aliases, `
      + `${manifest.counts.shards} shards to ${outDir}`,
  );
  console.log(`  budgets: ${JSON.stringify(manifest.budgets)}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
