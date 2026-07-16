#!/usr/bin/env node
// scripts/fetch-prose-corpus.mjs — regenerate corpus/prose/, the FROZEN prose
// corpus that feeds the rescue pass (scripts/generate-template-variants.mjs)
// and the coverage harness (scripts/template-coverage.mjs). Maintainer-only:
// never imported by src/ or bin/, never run by `npm test`. Dependency-free
// (node builtins only), run by hand, results committed.
//
//   node scripts/fetch-prose-corpus.mjs [--out <dir>]
//
// Why the corpus is EXTERNAL and FROZEN rather than this repo's own *.md docs:
// globbing the docs made every committed artifact a hostage to every doc edit —
// editing a README drifted corpus/generated/ace-surface-variants.jsonl, and
// template-coverage's hit rate could not be compared across two versions
// because the corpus moved underneath the metric. Committed text with a
// recorded URL, fetch date and sha256 holds still. corpus/README.md carries
// the long form.
//
// Licensing is the constraint that picked the sources. The rescue pass
// SUBSTITUTES WORDS and the result is committed to a file npm SHIPS, so this
// corpus is republished as a MODIFIED DERIVATIVE. Only sources that permit
// derivatives qualify. That rules out IETF RFCs (the Trust Legal Provisions
// grant copying "in full and without modification"; portions only "unmodified")
// and W3C specifications including the OWL 2 Primer, the best domain match of
// all ("No right to create modifications or derivatives of W3C documents is
// granted pursuant to this license"). Do not add either.
//
// The two that qualify:
//   - SQLite documentation — public domain (https://www.sqlite.org/copyright.html:
//     "All of the code and documentation in SQLite has been dedicated to the
//     public domain"). No attribution obligation, no share-alike.
//   - Wikipedia — CC BY-SA 4.0, per the API's own rightsinfo. Share-alike is
//     VIRAL: it is why corpus/generated/ace-surface-variants.jsonl is labelled
//     CC-BY-SA-4.0 rather than CC-BY-4.0. See the two LICENSE-NOTICE files.
//
// Two Wikipedia sets, fetched differently, because measurement said so:
//   - CHILD (simple.wikipedia.org, LEAD SECTIONS): everyday English about the
//     concepts tmct's persona corpus actually models. Simple English is written
//     at roughly the level PLAN_CHILD_CORPUS.md describes, and its lead sections
//     are dense definitional prose ("Penguins are seabirds in the family
//     Spheniscidae") — the shape the ACE grammar is built to parse. Highest
//     rescue-candidate density of any source measured, ~3x the technical prose.
//   - TECHNICAL (en.wikipedia.org, FULL articles): tmct's own domain. Simple
//     English has no articles at this depth.
// Lead sections come from &exintro=1; the CHILD set uses it, the TECHNICAL set
// does not (its lead sections are too thin to be worth a fetch).

import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "corpus", "prose");

const USER_AGENT = "tmct-corpus-fetch/1.0 (+https://github.com/polycode-projects/the-mechanical-code-talker)";
const POLITE_DELAY_MS = 250;

export const SQLITE_PAGES = [
  "lang_select", "lang_insert", "lang_createtable", "transactional",
  "atomiccommit", "wal", "queryplanner", "optoverview", "fileformat",
  "arch", "whentouse", "faq",
];

// Everyday concepts at roughly AoA <= 8, chosen to cover the lexicographer
// files tmct's persona clumps are built from (scripts/build-persona-tiers.mjs's
// CLUMP_FILES): animal, plant, substance, food, body, person, group, location,
// artifact, possession, time, event, quantity, communication, cognition,
// feeling. Bird/Penguin/Ostrich/Eagle are deliberate — PLAN_CHILD_CORPUS.md's
// worked example is that the shipped corpus knows exactly one kind of bird.
export const WIKIPEDIA_CHILD_TITLES = [
  "Bird", "Penguin", "Ostrich", "Owl", "Eagle", "Dog", "Cat", "Horse", "Fish",
  "Insect", "Mammal", "Bee", "Butterfly",
  "Tree", "Flower", "Grass", "Plant",
  "Food", "Bread", "Milk", "Apple", "Cooking",
  "Human", "Family", "Child", "Doctor", "Teacher",
  "City", "River", "Mountain", "Sea", "Farm", "School",
  "Tool", "House", "Car", "Book", "Clock",
  "Heart", "Hand", "Eye", "Bone",
  "Knowledge", "Memory", "Learning", "Language", "Writing",
  "Rain", "Snow", "Sun", "Wind", "Weather",
  "Emotion", "Happiness", "Fear",
  "Team",
];

export const WIKIPEDIA_TECHNICAL_TITLES = [
  "Natural_language_processing", "Web_Ontology_Language", "First-order_logic",
  "Description_logic", "Knowledge_representation_and_reasoning", "Semantic_Web",
  "Resource_Description_Framework", "Attempto_Controlled_English",
  "Interactive_fiction", "Text-based_game", "Automated_planning_and_scheduling",
  "Semantic_reasoner",
];

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

/** Strip HTML to plain text. Drops script/style/pre/code outright — a code
 *  block is the thing most likely to look like a sentence without being one —
 *  turns block-level closers into newlines so sentences don't run together,
 *  then removes the remaining tags and decodes entities. */
export function htmlToPlainText(html) {
  return normalizeLines(
    decodeEntities(
      html
        .replace(/<(script|style|pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|table)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/** Clean a MediaWiki `explaintext` extract: drop its "== Section ==" heading
 *  lines, which are not sentences and would otherwise survive the splitter as
 *  three-token fragments. */
export function cleanWikiExtract(text) {
  return normalizeLines(text.split("\n").filter((line) => !/^\s*=+.*=+\s*$/.test(line)).join("\n"));
}

/** Collapse intra-line whitespace, trim, drop blank lines. Deterministic and
 *  idempotent: the same input always yields byte-identical output. */
function normalizeLines(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n") + "\n";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getText(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.text();
}

async function fetchSqlitePage(page) {
  const url = `https://www.sqlite.org/${page}.html`;
  return { url, file: `${page}.txt`, text: htmlToPlainText(await getText(url)) };
}

/** Fetch one article's plain-text extract. `lead` selects the lead section
 *  only (&exintro=1). Follows redirects (&redirects=1) and reports the title
 *  actually served, so a retitled article is visible rather than silent. */
async function fetchWikipediaExtract(host, title, { lead }) {
  const url =
    `https://${host}/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json` +
    `${lead ? "&exintro=1" : ""}&titles=${encodeURIComponent(title)}`;
  const payload = JSON.parse(await getText(url));
  const page = Object.values(payload.query.pages)[0];
  const redirectedFrom = (payload.query.redirects ?? [])[0];
  if (!page || "missing" in page || !page.extract) return { url, missing: true, title };
  return {
    url,
    file: `${title}.txt`,
    text: cleanWikiExtract(page.extract),
    servedTitle: page.title,
    redirectedFrom: redirectedFrom ? redirectedFrom.from : null,
  };
}

async function writeFamily(outDir, family, entries) {
  const dir = join(outDir, family);
  await mkdir(dir, { recursive: true });
  // Remove any file a previous run left behind but this one no longer fetches,
  // so the committed tree always equals the manifest exactly.
  const stale = (await readdir(dir).catch(() => [])).filter(
    (name) => name.endsWith(".txt") && !entries.some((e) => e.file === name),
  );
  for (const name of stale) await rm(join(dir, name));

  const records = [];
  for (const entry of entries.sort((a, b) => a.file.localeCompare(b.file))) {
    const body = Buffer.from(entry.text, "utf8");
    await writeFile(join(dir, entry.file), body);
    records.push({
      file: `${family}/${entry.file}`,
      url: entry.url,
      bytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
      ...(entry.redirectedFrom ? { redirectedFrom: entry.redirectedFrom, servedTitle: entry.servedTitle } : {}),
    });
  }
  return records;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const outDir = arg("--out", OUT_DEFAULT);
  const missing = [];

  console.log(`fetch-prose-corpus: 1/2 SQLite documentation (${SQLITE_PAGES.length} pages, public domain)...`);
  const sqlite = [];
  for (const page of SQLITE_PAGES) {
    sqlite.push(await fetchSqlitePage(page));
    await sleep(POLITE_DELAY_MS);
  }

  console.log(
    `fetch-prose-corpus: 2/2 Wikipedia (${WIKIPEDIA_CHILD_TITLES.length} simple-English lead sections` +
      ` + ${WIKIPEDIA_TECHNICAL_TITLES.length} full articles, CC BY-SA 4.0)...`,
  );
  const wikipedia = [];
  for (const [host, titles, lead] of [
    ["simple.wikipedia.org", WIKIPEDIA_CHILD_TITLES, true],
    ["en.wikipedia.org", WIKIPEDIA_TECHNICAL_TITLES, false],
  ]) {
    for (const title of titles) {
      const entry = await fetchWikipediaExtract(host, title, { lead });
      if (entry.missing) {
        missing.push(`${host}:${title}`);
        console.log(`  !! ${host} has no extract for "${title}" — skipped`);
      } else {
        if (entry.redirectedFrom) console.log(`  -> "${entry.redirectedFrom}" redirected to "${entry.servedTitle}"`);
        wikipedia.push(entry);
      }
      await sleep(POLITE_DELAY_MS);
    }
  }

  const files = [...(await writeFamily(outDir, "sqlite", sqlite)), ...(await writeFamily(outDir, "wikipedia", wikipedia))];
  const bytes = files.reduce((sum, f) => sum + f.bytes, 0);

  const manifest = {
    version: 1,
    generated: "by scripts/fetch-prose-corpus.mjs",
    fetched: new Date().toISOString().slice(0, 10),
    description:
      "Frozen external prose corpus for the rescue pass and the coverage harness. " +
      "Every file records the URL it came from and a sha256 of the committed bytes, so a " +
      "re-fetch is verifiable and a doc edit in this repo can never drift it.",
    sources: [
      {
        family: "sqlite",
        upstream: "SQLite documentation (sqlite.org)",
        license: "public-domain",
        licenseUrl: "https://www.sqlite.org/copyright.html",
        notice: "corpus/prose/sqlite/LICENSE-NOTICE",
        extraction: "HTML fetched per page; script/style/pre/code elements dropped, tags stripped, entities decoded",
      },
      {
        family: "wikipedia",
        upstream: "Wikipedia — simple.wikipedia.org lead sections (everyday concepts) and en.wikipedia.org full articles (tmct's technical domain)",
        license: "CC-BY-SA-4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.en",
        notice: "corpus/prose/wikipedia/LICENSE-NOTICE",
        extraction: "MediaWiki API action=query&prop=extracts&explaintext=1 (&exintro=1 for the simple-English set); section headings removed",
      },
    ],
    totals: { files: files.length, bytes },
    files,
  };
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`fetch-prose-corpus: wrote ${files.length} files, ${(bytes / 1024).toFixed(0)} KB to ${outDir}`);
  if (missing.length) console.log(`  ${missing.length} title(s) had no extract: ${missing.join(", ")}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();
