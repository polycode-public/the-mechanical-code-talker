#!/usr/bin/env node
// scripts/generate-template-variants.mjs — PLAN_BREADTH_FIRST_NLU.md §6a's
// generation script. Maintainer-only tooling: never imported by src/ or
// bin/, never run by `npm test`. Offline, $0 — no network, no LLM, no
// invented text. Writes corpus/generated/ace-surface-variants.jsonl.
//
// Three mechanical generation techniques, all sourced from real local data,
// all self-verified against tmct's own live parseAce before being committed
// (a generated row that doesn't actually re-parse is DROPPED, never written
// — the committed file is proof-checked, not merely produced):
//
//   1. RESCUE — for every docs-corpus sentence (scripts/lib/text-corpus.mjs)
//      that parseAce almost fits (exactly one undeclared "residue" word),
//      look up that word's real WordNet synset and try substituting each
//      member that is ALSO already declared in tmct's own lexicon
//      (src/domain/grammar/lexicon-core.json) for the SAME part of speech. Both
//      ends of the swap are real, independently-curated tmct vocabulary —
//      WordNet only supplies the evidence that they're genuinely
//      synonymous. If the substituted sentence now hits, it's a real,
//      one-word-different variant of a real human-written sentence that
//      newly fits the grammar. This is the row kind the coverage harness's
//      `--rescue` flag consumes (scripts/template-coverage.mjs).
//   2. VARIANT — same synonym-substitution technique, applied instead to the
//      handful of sentences from corpus/tier2/human-examples*.jsonl (real
//      Open English WordNet / SemCor example sentences, already committed)
//      that ALREADY hit parseAce outright — producing same-meaning surface
//      variety for the small set of patterns real prose actually reaches.
//   3. ALT-PHRASING — for a possessive-pattern (#7) hit, the ACE grammar
//      itself declares TWO surface forms for the identical triple
//      ("X's Y is Z" / "the Y of X is Z", both routed through
//      src/domain/grammar/ace.mjs's buildPossessive) — the one place in the pattern
//      table where an alternate word order is grammar-sanctioned, not
//      invented here. Generates the sentence's untried surface form and
//      verifies it re-parses to the same triple shape.
//
// Never does: passive voice (no ACE pattern supports it — see ace.mjs's
// pattern table, PLAN_BREADTH_FIRST_NLU.md §6a's own scoping), NomLex
//
//   node scripts/generate-template-variants.mjs [--out <path>] [--limit <n>]

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { parseAce } from "../src/domain/grammar/ace.mjs";
import { loadLexicon } from "../src/domain/grammar/lexicon.mjs";
import { loadMarkdownCorpus, splitSentences } from "./lib/text-corpus.mjs";
import { synsetsFor } from "./lib/wordnet-synonyms.mjs";
import { classify } from "./template-coverage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT_DEFAULT = join(REPO_ROOT, "corpus", "generated", "ace-surface-variants.jsonl");
const SEED_CORPORA = ["human-examples.jsonl", "human-examples-medium.jsonl", "human-examples-large.jsonl"];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Case-preserving single-token whole-word replace: swaps the first
 *  whole-word, case-insensitive match of `from` for `to`, capitalizing `to`
 *  if the matched occurrence was capitalized (sentence-initial words). */
function substituteWord(sentence, from, to) {
  const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const m = re.exec(sentence);
  if (!m) return null;
  const matched = m[0];
  const cased = matched[0] === matched[0].toUpperCase() && matched[0] !== matched[0].toLowerCase()
    ? to[0].toUpperCase() + to.slice(1)
    : to;
  return sentence.slice(0, m.index) + cased + sentence.slice(m.index + matched.length);
}

/** Every declared-lexicon lemma of a given POS, lowercased, as a Set — used
 *  to check that a WordNet synset sibling is ALSO tmct's own vocabulary
 *  before it's ever allowed into a generated sentence. */
function declaredLemmas(lexicon, pos) {
  const map = pos === "noun" ? lexicon.nouns : pos === "verb" ? lexicon.verbs : lexicon.adjectives;
  return new Set([...map.keys()].map((w) => w.toLowerCase()));
}

// ---- 1. RESCUE: docs-corpus near-misses -----------------------------------

async function generateRescues(lexicon, limit) {
  const files = (await readdir(REPO_ROOT)).filter((f) => f.endsWith(".md")).sort();
  const corpus = await loadMarkdownCorpus(REPO_ROOT, { files });
  const declared = {
    noun: declaredLemmas(lexicon, "noun"),
    verb: declaredLemmas(lexicon, "verb"),
    adjective: declaredLemmas(lexicon, "adjective"),
  };

  // Only single-residue-word sentences: one clean, explainable swap per row.
  const candidates = [];
  const residueWords = new Set();
  for (const row of corpus) {
    const r = parseAce(row.sentence, lexicon);
    if (!r || r.triples.length) continue; // not residue
    if (r.residue.length !== 1) continue;
    const word = r.residue[0].toLowerCase().replace(/^[^a-z]+|[^a-z]+$/gi, "");
    if (!/^[a-z]+$/.test(word)) continue; // skip punctuation/number/hyphenated tokens
    residueWords.add(word);
    candidates.push({ ...row, word });
  }

  const synsets = await synsetsFor(residueWords);
  const rows = [];
  for (const { sentence, file, word } of candidates) {
    if (rows.length >= limit) break;
    const hits = synsets.get(word);
    if (!hits) continue;
    for (const { pos, synsetId, members } of hits) {
      const siblings = members.filter((m) => m.toLowerCase() !== word && declared[pos].has(m.toLowerCase()));
      for (const sibling of siblings) {
        const rescued = substituteWord(sentence, word, sibling.toLowerCase());
        if (!rescued) continue;
        if (classify(rescued, lexicon) !== "hit") continue;
        rows.push({
          kind: "rescue", sentence, rescued, from: word, to: sibling.toLowerCase(), pos, synsetId,
          sourceFile: file, provenance: `wordnet:${synsetId}`,
        });
        break; // one successful rescue per sentence is enough to prove the point
      }
      if (rows.some((r) => r.sentence === sentence)) break;
    }
  }
  return rows;
}

// ---- 2. VARIANT: synonym-substituted real WordNet/SemCor example hits -----

async function loadSeedHits(lexicon) {
  const seeds = [];
  for (const name of SEED_CORPORA) {
    const path = join(REPO_ROOT, "corpus", "tier2", name);
    const lines = (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const row of lines) {
      const r = parseAce(row.sentence, lexicon);
      if (r && r.triples.length) seeds.push({ sentence: row.sentence, sourceCorpus: `corpus/tier2/${name}`, pattern: r.pattern });
    }
  }
  return seeds;
}

async function generateVariants(lexicon, seeds, limit) {
  const declared = {
    noun: declaredLemmas(lexicon, "noun"),
    verb: declaredLemmas(lexicon, "verb"),
    adjective: declaredLemmas(lexicon, "adjective"),
  };
  // Content words = tokens that resolve to a declared noun/verb/adjective
  // lemma (skip determiners/prepositions/pronouns implicitly — they simply
  // won't be declared as any of the three).
  const wordSet = new Set();
  const perSeedWords = seeds.map((s) => {
    const toks = s.sentence.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter(Boolean);
    const words = toks.filter((t) => declared.noun.has(t) || declared.verb.has(t) || declared.adjective.has(t));
    for (const w of words) wordSet.add(w);
    return words;
  });

  const synsets = await synsetsFor(wordSet);
  const rows = [];
  seeds.forEach((seed, i) => {
    if (rows.length >= limit) return;
    for (const word of perSeedWords[i]) {
      const hits = synsets.get(word);
      if (!hits) continue;
      for (const { pos, synsetId, members } of hits) {
        if (!declared[pos].has(word)) continue; // only substitute in the POS it's actually declared as
        const siblings = members.filter((m) => m.toLowerCase() !== word && declared[pos].has(m.toLowerCase()));
        for (const sibling of siblings) {
          const generated = substituteWord(seed.sentence, word, sibling.toLowerCase());
          if (!generated || generated === seed.sentence) continue;
          if (classify(generated, lexicon) !== "hit") continue;
          rows.push({
            kind: "variant", seed: seed.sentence, generated, from: word, to: sibling.toLowerCase(), pos, synsetId,
            sourceCorpus: seed.sourceCorpus, provenance: `wordnet:${synsetId}`,
          });
        }
      }
    }
  });
  return rows;
}

// ---- 3. ALT-PHRASING: possessive pattern's two grammar-declared forms -----

function generateAltPhrasings(lexicon, seeds) {
  const rows = [];
  for (const seed of seeds) {
    if (seed.pattern !== "possessive") continue;
    const s = seed.sentence;
    // "the H of O is V" -> "O's H is V" (only when O is a single token, so
    // the apostrophe form's own left-anchor rule — sentence must OPEN with
    // "<owner>'s" — is satisfiable without inventing a determiner-less noun
    // phrase the grammar wouldn't otherwise accept).
    const ofForm = /^the (\S+) of (\S+) is (.+)$/i.exec(s);
    if (ofForm) {
      const [, head, owner, value] = ofForm;
      const generated = `${owner}'s ${head} is ${value}`;
      const r = parseAce(generated, lexicon);
      if (r && r.triples.length) {
        rows.push({ kind: "alt-phrasing", seed: s, generated, pattern: "possessive", form: "apostrophe", provenance: "grammar:ace.mjs pattern 7 (possessive) — both surface forms route through buildPossessive" });
      }
      continue;
    }
    // "O's H is V" -> "the H of O is V"
    const posForm = /^(\S+)'s (\S+) is (.+)$/i.exec(s);
    if (posForm) {
      const [, owner, head, value] = posForm;
      const generated = `the ${head} of ${owner} is ${value}`;
      const r = parseAce(generated, lexicon);
      if (r && r.triples.length) {
        rows.push({ kind: "alt-phrasing", seed: s, generated, pattern: "possessive", form: "of", provenance: "grammar:ace.mjs pattern 7 (possessive) — both surface forms route through buildPossessive" });
      }
    }
  }
  return rows;
}

// ---- main -------------------------------------------------------------

async function writeManifest(outPath, rowCount, bytes) {
  const sha256 = createHash("sha256").update(await readFile(outPath)).digest("hex");
  const manifest = {
    version: 1,
    generated: "by scripts/generate-template-variants.mjs",
    file: "ace-surface-variants.jsonl",
    rows: rowCount,
    bytes,
    sha256,
    license: "CC-BY-4.0 (WordNet-derived synonym substitutions of Open English WordNet / SemCor example sentences and this repo's own MPL-2.0 docs prose — see corpus/generated/README.md)",
  };
  await writeFile(join(dirname(outPath), "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

async function main() {
  const outPath = arg("--out", OUT_DEFAULT);
  const limit = Number(arg("--limit", "300"));
  const lexicon = loadLexicon();

  console.log("generate-template-variants: 1/3 rescue pass (docs corpus near-misses)...");
  const rescues = await generateRescues(lexicon, limit);
  console.log(`  ${rescues.length} rescued sentence(s)`);

  console.log("generate-template-variants: 2/3 seed hits (corpus/tier2/human-examples*.jsonl)...");
  const seeds = await loadSeedHits(lexicon);
  console.log(`  ${seeds.length} real sentence(s) already hit parseAce`);

  console.log("generate-template-variants: 2/3 variant pass (synonym substitution on seed hits)...");
  const variants = await generateVariants(lexicon, seeds, limit);
  console.log(`  ${variants.length} generated variant(s)`);

  console.log("generate-template-variants: 3/3 alt-phrasing pass (possessive pattern's two forms)...");
  const altPhrasings = generateAltPhrasings(lexicon, seeds);
  console.log(`  ${altPhrasings.length} alternate-phrasing row(s)`);

  const rows = [...rescues, ...variants, ...altPhrasings];
  await mkdir(dirname(outPath), { recursive: true });
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  await writeFile(outPath, body);
  const manifest = await writeManifest(outPath, rows.length, Buffer.byteLength(body));

  console.log(`generate-template-variants: wrote ${outPath}`);
  console.log(`  ${rows.length} total rows (${rescues.length} rescue, ${variants.length} variant, ${altPhrasings.length} alt-phrasing)`);
  console.log(`  sha256 ${manifest.sha256}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();

export { generateRescues, generateVariants, generateAltPhrasings, loadSeedHits, substituteWord };
