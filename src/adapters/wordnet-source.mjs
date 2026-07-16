// wordnet-source.mjs — reads a LOCAL Open English WordNet clone off disk and
// indexes it. The clone is never vendored, never committed, never part of the
// npm package: point TMCT_WORDNET_SRC at it, or keep it at the default path.
//
// This is the disk half of the WordNet reader. The parsing half is pure and
// lives in src/domain/wordnet/yaml.mjs, so it is testable with no clone
// present; everything here needs the real files.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseYaml } from "../domain/wordnet/yaml.mjs";

export const WORDNET_SRC = process.env.TMCT_WORDNET_SRC || join(homedir(), "projects", "globalwordnet", "english-wordnet");
export const WORDNET_YAML_DIR = join(WORDNET_SRC, "src", "yaml");

/** True iff a WordNet clone is readable at `yamlDir`. Callers use this to fail
 *  with a one-line message rather than a stack trace: these are maintainer
 *  tools, never a build dependency. */
export function hasWordnetSource(yamlDir = WORDNET_YAML_DIR) {
  return existsSync(yamlDir);
}

/** Load one or more noun.<x>/verb.<x>.yaml files into a flat synset-id -> record map. */
export async function loadSynsets(files, yamlDir = WORDNET_YAML_DIR) {
  const map = new Map();
  for (const f of files) {
    const path = join(yamlDir, f);
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
export async function loadEntriesFor(words, yamlDir = WORDNET_YAML_DIR) {
  const letters = new Set();
  for (const w of words) {
    const c = w[0].toLowerCase();
    letters.add(/[a-z]/.test(c) ? c : "0");
  }
  const index = new Map();
  for (const letter of letters) {
    const path = join(yamlDir, `entries-${letter}.yaml`);
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

/** Every noun.*.yaml synset in the clone. */
export async function loadAllNounSynsets(yamlDir = WORDNET_YAML_DIR) {
  const files = (await readdir(yamlDir)).filter((f) => f.startsWith("noun."));
  return loadSynsets(files, yamlDir);
}
