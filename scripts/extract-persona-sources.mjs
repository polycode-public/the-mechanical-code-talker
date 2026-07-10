#!/usr/bin/env node
// scripts/extract-persona-sources.mjs — maintainer-only curation-worksheet
// generator for the "human-world" default persona (PLAN_SEED.md). Mirrors
// corpus/tier2/generate.mjs's own "not part of the product path" discipline:
// offline, $0, never imported by anything under src/ or bin/, never run by
// `npm test`.
//
// Reads two LOCALLY-CLONED reference repos (never vendored, never committed,
// never part of the npm package):
//   - Open English WordNet   (TMCT_WORDNET_SRC,   default ~/projects/globalwordnet/english-wordnet)
//   - Schema.org vocabulary  (TMCT_SCHEMAORG_SRC, default ~/projects/schemaorg/schemaorg)
// and writes ONE curation worksheet (JSON) surfacing CANDIDATES for the 9
// persona clumps (PLAN_SEED.md §3) — never the final committed files. A human
// (or an agent acting as one) reviews the worksheet and hand-picks the actual
// facts/lexicon words/example sentences that land in corpus/tier2/human.jsonl
// and src/grammar/lexicon-core.json, exactly the same "curate down from a big
// source" discipline SEON and every existing tier2 bundle already follows.
//
//   node scripts/extract-persona-sources.mjs [--out <path>]
//
// Fails gracefully (a clear one-line message, exit 0 — never a stack trace)
// if either source repo isn't present locally: this is a maintainer
// convenience tool, never a build dependency, never required for `npm test`
// or the product path.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WORDNET_SRC = process.env.TMCT_WORDNET_SRC || join(homedir(), "projects", "globalwordnet", "english-wordnet");
const SCHEMAORG_SRC = process.env.TMCT_SCHEMAORG_SRC || join(homedir(), "projects", "schemaorg", "schemaorg");
const WORDNET_YAML_DIR = join(WORDNET_SRC, "src", "yaml");
const SCHEMA_TTL = join(SCHEMAORG_SRC, "data", "schema.ttl");

const OUT = (() => {
  const i = process.argv.indexOf("--out");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : join("scripts", "persona-worksheet.json");
})();

// ---- Part 1: a tiny YAML-subset reader ------------------------------------
// The OEWN dump uses a small, regular subset of YAML: 2-space-indented block
// mappings/sequences, quoted or bare scalars, and long scalar list-items that
// simply WRAP onto a further-indented continuation line (no block scalars, no
// anchors, no flow style — confirmed by direct inspection, PLAN_SEED.md §5).
// This reads exactly that subset; it is not a general YAML parser.
function parseYaml(text) {
  const rawLines = text.split("\n");
  const lines = [];
  for (const line of rawLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    lines.push({ indent, text: line.trimStart() });
  }
  let pos = 0;
  // Non-greedy key group so a MULTI-WORD entry key ("M-1 rifle", "ice cream")
  // still matches — the first ": "/end-of-line colon wins, exactly as real
  // YAML's block-mapping key/value split works. A plain wrapped scalar
  // continuation line (a definition/example fragment) only coincidentally
  // matches this if it ALSO happens to contain a bare "word: " sequence —
  // rare in this corpus's prose, and this is a maintainer worksheet tool
  // whose output is hand-reviewed, not a correctness-critical parser.
  const KEY_RE = /^(.+?):(\s+(.*)|)$/;
  const isDash = (t) => t === "-" || t.startsWith("- ");

  function parseScalar(s) {
    const t = s.trim();
    if ((t.startsWith("'") && t.endsWith("'") && t.length >= 2) || (t.startsWith('"') && t.endsWith('"') && t.length >= 2)) {
      return t.slice(1, -1);
    }
    return t;
  }

  // A scalar that may continue on subsequent MORE-indented lines with no
  // "key:"/"- " marker of their own (WordNet's definition-wrapping style). A
  // QUOTED scalar ('...' or "...") is handled separately: WordNet definitions
  // routinely contain a literal ": " inside the quoted text itself (e.g. "…
  // Matthew, Mark, Luke, and John" split across a line boundary right after a
  // colon) — the bare-scalar heuristic below would misread that continuation
  // line as a new "key:" line and truncate the string. Once inside an open
  // quote, EVERY line is a continuation until one ends with the matching
  // closing quote, full stop — the key/dash heuristic never applies inside it.
  function parseScalarOrContinue(first, minContinIndent) {
    const trimmed = first.trim();
    const quote = trimmed[0] === "'" || trimmed[0] === '"' ? trimmed[0] : null;
    if (quote) {
      const closes = (s) => s.length >= 2 && s.endsWith(quote);
      let buf = trimmed;
      while (!closes(buf) && pos < lines.length && lines[pos].indent >= minContinIndent) {
        buf += " " + lines[pos].text.trim();
        pos += 1;
      }
      return closes(buf) ? buf.slice(1, -1) : buf;
    }
    let s = parseScalar(first);
    while (pos < lines.length && lines[pos].indent >= minContinIndent
      && !isDash(lines[pos].text) && !KEY_RE.test(lines[pos].text)) {
      s += " " + lines[pos].text.trim();
      pos += 1;
    }
    return s;
  }

  /** The value that follows a "key:" (bare, no inline scalar) — peeks at the
   *  next line to decide whether it's a nested sequence (which YAML allows to
   *  sit at the SAME indent as the key itself, not just deeper) or a nested
   *  mapping (which must be deeper) or simply absent (null). `parentIndent`
   *  is the indent of the "key:" line whose value this resolves. */
  function parseValue(parentIndent) {
    if (pos >= lines.length || lines[pos].indent < parentIndent) return null;
    const line = lines[pos];
    if (isDash(line.text)) return parseSeq(line.indent);
    if (line.indent > parentIndent && KEY_RE.test(line.text)) return parseMap(line.indent);
    return null;
  }

  function parseSeq(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && isDash(lines[pos].text)) {
      const dashIndent = indent;
      const rest = lines[pos].text === "-" ? "" : lines[pos].text.slice(2);
      pos += 1;
      if (rest === "") {
        arr.push(parseValue(dashIndent));
        continue;
      }
      // A quoted scalar is classified FIRST, unconditionally — WordNet
      // definitions routinely contain a literal ": " (or a colon at the very
      // end of a wrapped line, e.g. "…including:\n  whales, …") inside quoted
      // prose, which KEY_RE would otherwise misread as an inline "- key:"
      // mapping. Only an UNQUOTED rest is even considered for that shape.
      const quoted = rest[0] === "'" || rest[0] === '"';
      const m = quoted ? null : KEY_RE.exec(rest);
      if (m) {
        // "- key: value" or "- key:" — an inline mapping for this list item;
        // sibling keys of the SAME item are indented +2 from the dash.
        const obj = {};
        obj[m[1]] = m[3] !== undefined && m[3] !== "" ? parseScalarOrContinue(m[3], dashIndent + 2) : parseValue(dashIndent + 2);
        while (pos < lines.length && lines[pos].indent === dashIndent + 2 && KEY_RE.test(lines[pos].text)) {
          const mm = KEY_RE.exec(lines[pos].text);
          pos += 1;
          obj[mm[1]] = mm[3] !== undefined && mm[3] !== "" ? parseScalarOrContinue(mm[3], dashIndent + 4) : parseValue(dashIndent + 2);
        }
        arr.push(obj);
      } else {
        // a plain (or quoted) scalar list item — may wrap onto continuation lines
        arr.push(parseScalarOrContinue(rest, dashIndent + 2));
      }
    }
    return arr;
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && KEY_RE.test(lines[pos].text)) {
      const m = KEY_RE.exec(lines[pos].text);
      const key = parseScalar(m[1]);
      pos += 1;
      obj[key] = m[3] !== undefined && m[3] !== "" ? parseScalarOrContinue(m[3], indent + 2) : parseValue(indent);
      // (parseValue(indent) — not indent+2 — so a same-indent sequence value
      // is recognized; parseValue itself accepts child indent >= indent.)
    }
    return obj;
  }

  return parseMap(0);
}

// ---- Part 2: WordNet synset + entry indexes -------------------------------

/** Load one or more noun.<x>/verb.<x>.yaml files into a flat synset-id -> record map. */
async function loadSynsets(files) {
  const map = new Map();
  for (const f of files) {
    const path = join(WORDNET_YAML_DIR, f);
    if (!existsSync(path)) continue;
    const parsed = parseYaml(await readFile(path, "utf8"));
    for (const [id, rec] of Object.entries(parsed)) map.set(id, rec);
  }
  return map;
}

/** Load the entries-<letter>.yaml files that could contain any of `words`
 *  (only the letters actually needed — 28 files, ~1MB-3MB each, no reason to
 *  load all 28 when a clump only needs a handful of letters). Returns
 *  word -> { n: [{id, synset}], v: [...], a: [...] }. */
async function loadEntriesFor(words) {
  const letters = new Set();
  for (const w of words) {
    const c = w[0].toLowerCase();
    letters.add(/[a-z]/.test(c) ? c : "0");
  }
  const index = new Map();
  for (const letter of letters) {
    const path = join(WORDNET_YAML_DIR, `entries-${letter}.yaml`);
    if (!existsSync(path)) continue;
    const parsed = parseYaml(await readFile(path, "utf8"));
    for (const [word, byPos] of Object.entries(parsed)) {
      if (!words.has(word)) continue;
      const senses = {};
      for (const [pos, rec] of Object.entries(byPos || {})) {
        if (pos === "form") continue;
        const list = Array.isArray(rec?.sense) ? rec.sense : [];
        senses[pos] = list.map((s) => ({ id: s.id, synset: s.synset })).filter((s) => s.synset);
      }
      index.set(word, senses);
    }
  }
  return index;
}

/** For one target word, find its most likely synset (first noun sense, by
 *  WordNet's own sense-order convention — sense 1 is the most frequent/
 *  common sense in the source lexicographer files) and its one-hop
 *  hypernym candidate. */
function candidateFor(word, entries, synsets, pos = "n") {
  const senses = entries.get(word)?.[pos];
  if (!senses || !senses.length) return null;
  const synsetId = senses[0].synset;
  const synset = synsets.get(synsetId);
  if (!synset) return null;
  const hypernymId = Array.isArray(synset.hypernym) ? synset.hypernym[0] : null;
  const hyper = hypernymId ? synsets.get(hypernymId) : null;
  const hyperTerm = Array.isArray(hyper?.members) ? hyper.members[0] : null;
  return {
    word,
    synsetId,
    definition: Array.isArray(synset.definition) ? synset.definition[0] : synset.definition,
    example: Array.isArray(synset.example) ? synset.example[0] : synset.example,
    members: synset.members,
    hypernymId,
    hypernymTerm: hyperTerm,
    hypernymDefinition: Array.isArray(hyper?.definition) ? hyper.definition[0] : hyper?.definition,
  };
}

// ---- Part 3: the 9 persona clumps -> source-file mapping (PLAN_SEED.md §3) --

const CLUMPS = {
  "human-core": {
    files: ["noun.person.yaml", "noun.group.yaml"],
    // A curated CANDIDATE common-word list per clump — deliberately hand-picked
    // to be everyday words, not a mechanical dump of the ~10,400-synset pool
    // (PLAN_SEED.md §3's own point: WordNet's noun.person file alone includes
    // senses like "imaginary being"/"hypothetical creature" that must be
    // skipped in favour of "man", "woman", "doctor", "teacher", …).
    words: [
      "man", "woman", "person", "child", "boy", "girl", "baby", "adult",
      "friend", "neighbor", "stranger", "guest", "visitor",
      "doctor", "teacher", "nurse", "student", "worker", "farmer",
      "mother", "father", "parent", "brother", "sister", "family",
      "king", "queen", "soldier", "artist", "writer", "cook",
      "team", "group", "crowd", "audience", "club",
    ],
  },
  "human-places": {
    files: ["noun.location.yaml", "noun.artifact.yaml"],
    words: [
      "place", "city", "town", "village", "country", "state",
      "house", "home", "room", "kitchen", "bedroom", "bathroom",
      "school", "hospital", "shop", "store", "market", "church",
      "park", "garden", "street", "road", "bridge", "farm",
      "office", "factory", "library", "museum", "hotel", "airport",
    ],
  },
  "human-objects": {
    files: ["noun.artifact.yaml", "noun.possession.yaml"],
    words: [
      "hat", "shirt", "coat", "shoe", "dress", "clothing",
      "table", "chair", "bed", "door", "window", "wall", "roof",
      "book", "pen", "paper", "letter", "key", "lock", "box",
      "car", "bicycle", "boat", "train", "wheel",
      "knife", "spoon", "fork", "plate", "cup", "bottle", "bag",
      "money", "coin", "toy", "tool", "machine", "clock", "phone",
    ],
  },
  "human-nature": {
    files: ["noun.animal.yaml", "noun.plant.yaml", "noun.substance.yaml"],
    words: [
      "dog", "cat", "horse", "cow", "pig", "sheep", "bird", "fish",
      "mouse", "rabbit", "bear", "lion", "tiger", "elephant", "snake",
      "tree", "flower", "grass", "leaf", "root", "seed", "fruit",
      "water", "air", "fire", "earth", "stone", "sand", "gold", "iron",
      "rain", "snow", "wind", "cloud", "sun", "moon", "star",
    ],
  },
  "human-time-events": {
    files: ["noun.time.yaml", "noun.event.yaml", "noun.quantity.yaml"],
    words: [
      "time", "day", "night", "morning", "evening", "week", "month", "year",
      "hour", "minute", "second", "moment", "season", "spring", "summer", "winter",
      "party", "meeting", "wedding", "war", "game", "match", "race", "trip",
      "number", "amount", "pair", "dozen", "half", "part", "piece",
    ],
  },
  "human-body-food": {
    files: ["noun.body.yaml", "noun.food.yaml"],
    words: [
      "body", "head", "hand", "arm", "leg", "foot", "eye", "ear", "mouth",
      "nose", "hair", "heart", "blood", "bone", "skin", "face",
      "food", "bread", "meat", "milk", "egg", "cheese", "fruit", "vegetable",
      "meal", "breakfast", "dinner", "drink", "water", "wine", "tea", "coffee",
    ],
  },
  "human-mind": {
    files: ["noun.communication.yaml", "noun.cognition.yaml", "noun.feeling.yaml"],
    words: [
      "word", "language", "story", "news", "question", "answer", "idea",
      "thought", "mind", "knowledge", "memory", "dream", "belief", "reason",
      "love", "hate", "fear", "joy", "anger", "hope", "surprise", "pride",
      "name", "sound", "voice", "song", "picture", "art", "music",
    ],
  },
};

// ---- Part 4: Schema.org class allowlist (human-base + human-bridge) ------

const SCHEMA_ALLOWLIST = ["Thing", "Person", "Place", "Event", "Organization", "Product"];

/** Very small Turtle reader for schema.ttl's OWN regular shape: each class is
 *  one `:Name a rdfs:Class ;` block terminated by a line ending in ` .`, with
 *  `rdfs:label`/`rdfs:comment`/`rdfs:subClassOf` as `;`-separated predicate
 *  lines. Not a general Turtle parser — schema.ttl's own generator emits a
 *  single, very regular style (confirmed by direct inspection, PLAN_SEED.md §5). */
function parseSchemaClasses(text) {
  const classes = new Map(); // name -> { label, comment, subClassOf: [] }
  const blocks = text.split(/\n(?=:[A-Za-z])/); // each class/property starts a new top-level block
  for (const block of blocks) {
    const head = /^:([A-Za-z0-9_]+)\s+a\s+rdfs:Class\s*;/.exec(block);
    if (!head) continue;
    const name = head[1];
    const label = /rdfs:label\s+"([^"]*)"/.exec(block)?.[1] || name;
    const comment = /rdfs:comment\s+"([^"]*)"/.exec(block)?.[1] || "";
    const subClassOf = [...block.matchAll(/rdfs:subClassOf\s+:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    classes.set(name, { name, label, comment, subClassOf });
  }
  return classes;
}

// ---- Part 5: main ----------------------------------------------------------

async function main() {
  if (!existsSync(WORDNET_YAML_DIR)) {
    console.error(`extract-persona-sources: WordNet source not found at ${WORDNET_YAML_DIR}`);
    console.error(`  (set TMCT_WORDNET_SRC to override — this is a maintainer convenience tool, not a build dependency)`);
    return;
  }
  if (!existsSync(SCHEMA_TTL)) {
    console.error(`extract-persona-sources: Schema.org source not found at ${SCHEMA_TTL}`);
    console.error(`  (set TMCT_SCHEMAORG_SRC to override — this is a maintainer convenience tool, not a build dependency)`);
    return;
  }

  const worksheet = { generatedBy: "scripts/extract-persona-sources.mjs", clumps: {}, schemaClasses: [] };

  // human-base / human-bridge candidates: Schema.org's Thing-rooted allowlist.
  const schemaText = await readFile(SCHEMA_TTL, "utf8");
  const schemaClasses = parseSchemaClasses(schemaText);
  for (const name of SCHEMA_ALLOWLIST) {
    const c = schemaClasses.get(name);
    if (c) worksheet.schemaClasses.push(c);
  }

  // The 8 content clumps.
  for (const [clumpId, spec] of Object.entries(CLUMPS)) {
    const synsets = await loadSynsets(spec.files);
    const entries = await loadEntriesFor(new Set(spec.words));
    const candidates = [];
    for (const word of spec.words) {
      const c = candidateFor(word, entries, synsets);
      if (c) candidates.push(c);
    }
    worksheet.clumps[clumpId] = { sourceFiles: spec.files, requested: spec.words.length, found: candidates.length, candidates };
  }

  await import("node:fs/promises").then(({ writeFile, mkdir }) =>
    mkdir(join(process.cwd(), "scripts"), { recursive: true }).then(() =>
      writeFile(OUT, JSON.stringify(worksheet, null, 2) + "\n")));

  const totalFound = Object.values(worksheet.clumps).reduce((n, c) => n + c.found, 0);
  const totalRequested = Object.values(worksheet.clumps).reduce((n, c) => n + c.requested, 0);
  console.error(`extract-persona-sources: wrote ${OUT}`);
  console.error(`  schema classes: ${worksheet.schemaClasses.length}/${SCHEMA_ALLOWLIST.length}`);
  console.error(`  wordnet candidates: ${totalFound}/${totalRequested} target words resolved`);
  for (const [id, c] of Object.entries(worksheet.clumps)) {
    console.error(`    ${id}: ${c.found}/${c.requested}`);
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) await main();

export { parseYaml, parseSchemaClasses, candidateFor };
