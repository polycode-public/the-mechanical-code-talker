#!/usr/bin/env node
// gen-sprite-facts.mjs — writes corpus/sprites/src/sprite-facts.jsonl, the
// generated (not hand-authored) OWL-shaped fact rows behind sprites.html's
// chat dock. The walk itself — parsed sprite templates to fact rows — is
// defined once in src/domain/sprite-facts.mjs; this script only reads the
// TOML sets through the existing adapters and serializes the rows to disk,
// the same split gen-spider-fly-world.mjs takes for its own board.
// test/estate/generated-artifacts.test.mjs regenerates through --out and
// fails on drift, so the committed file can never fall behind data/sprites*/.
//
//   node scripts/gen-sprite-facts.mjs
//   node scripts/gen-sprite-facts.mjs --out /tmp/sprite-facts.jsonl

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSpriteTemplateFiles } from "../src/adapters/corpus/sprite-template-files.mjs";
import { readSpriteLargeTemplateFiles } from "../src/adapters/corpus/sprite-large-template-files.mjs";
import { spriteFactRows } from "../src/domain/sprite-facts.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(REPO_ROOT, "corpus", "sprites", "src", "sprite-facts.jsonl");

const outFlagIndex = process.argv.indexOf("--out");
const outFile = outFlagIndex !== -1 && process.argv[outFlagIndex + 1] ? process.argv[outFlagIndex + 1] : DEFAULT_OUT;

const rows = spriteFactRows({
  iconTemplates: readSpriteTemplateFiles(),
  largeTemplates: readSpriteLargeTemplateFiles(),
});

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
console.log(`gen-sprite-facts: wrote ${rows.length} rows -> ${outFile}`);
