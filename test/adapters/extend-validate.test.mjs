// extend-validate.test.mjs — Part 4 of the extension-pack batch:
// validateExtensionPack (src/services/extensions.mjs) and `tmct extend --validate <dir>`
// (bin/tmct.mjs). Reuses existing throw-loudly primitives (loadSlice/loadMap/
// toFacts, loadLexicon, loadTemplates) — no new shape-checking logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateExtensionPack } from "../../src/services/extensions.mjs";

const BIN = fileURLToPath(new URL("../../bin/tmct.mjs", import.meta.url));
const tmp = () => mkdtemp(join(tmpdir(), "tmct-extend-"));

test("validateExtensionPack: a well-formed fixture pack (corpus + lexicon + namespaced templates) passes every resource", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), JSON.stringify({ start: "/c/en/widget", rel: "/r/IsA", end: "/c/en/thing", weight: 1 }) + "\n");
    await writeFile(join(dir, "lexicon.json"), JSON.stringify({ nouns: { widget: {} } }));
    await writeFile(join(dir, "templates.jsonl"), '{"id":"mypack:greet","class":"describe","template":"hi.","register":"terse"}\n');
    const candidate = {
      kind: "pack",
      corpusPath: join(dir, "corpus.jsonl"),
      lexiconPath: join(dir, "lexicon.json"),
      templatesPath: join(dir, "templates.jsonl"),
      provenancePrefix: "corpus:mypack",
    };
    const { ok, results } = await validateExtensionPack(dir, candidate);
    assert.equal(ok, true);
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.ok));
    const corpus = results.find((r) => r.kind === "corpus");
    assert.deepEqual(corpus.counts, { assertions: 1, facts: 1 });
    const lex = results.find((r) => r.kind === "lexicon");
    assert.ok(lex.counts.nouns > 0);
    const tpl = results.find((r) => r.kind === "templates");
    assert.deepEqual(tpl.counts, { templates: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateExtensionPack: a corrupt corpus JSONL fails with a specific, located error", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), "not json\n");
    const { ok, results } = await validateExtensionPack(dir, { kind: "corpus", corpusPath: join(dir, "corpus.jsonl") });
    assert.equal(ok, false);
    assert.equal(results.length, 1);
    assert.equal(results[0].ok, false);
    assert.match(results[0].error, /corpus\.jsonl:1: not valid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateExtensionPack: a slice/map-drifted relation (unmapped in conceptnet-map.toml) fails, naming the drift", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), JSON.stringify({ start: "/c/en/widget", rel: "/r/NotARealRelation", end: "/c/en/thing", weight: 1 }) + "\n");
    const { ok, results } = await validateExtensionPack(dir, { kind: "corpus", corpusPath: join(dir, "corpus.jsonl") });
    assert.equal(ok, false);
    assert.match(results[0].error, /slice\/map drift.*\/r\/NotARealRelation.*no row in conceptnet-map\.toml/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateExtensionPack: a malformed lexicon JSON (illegal declared type) fails", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "lexicon.json"), JSON.stringify({ adjectives: { odd: { type: "weird" } } }));
    const { ok, results } = await validateExtensionPack(dir, { kind: "lexicon", lexiconPath: join(dir, "lexicon.json") });
    assert.equal(ok, false);
    assert.match(results[0].error, /"odd"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateExtensionPack: literally-unparseable lexicon JSON also fails (caught, not thrown)", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "lexicon.json"), "not json");
    const { ok, results } = await validateExtensionPack(dir, { kind: "lexicon", lexiconPath: join(dir, "lexicon.json") });
    assert.equal(ok, false);
    assert.ok(results[0].error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateExtensionPack: a duplicate/non-namespaced template id fails", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "templates.jsonl"), '{"id":"greet","class":"describe","template":"hi.","register":"terse"}\n');
    const { ok, results } = await validateExtensionPack(dir, { kind: "templates", templatesPath: join(dir, "templates.jsonl") });
    assert.equal(ok, false);
    assert.match(results[0].error, /not namespaced/);
    assert.match(results[0].error, /greet/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateExtensionPack: a duplicate template id WITHIN one file fails via loadTemplates' own loud check", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "templates.jsonl"),
      '{"id":"pack:a","class":"describe","template":"hi.","register":"terse"}\n'
      + '{"id":"pack:a","class":"describe","template":"hi again.","register":"terse"}\n');
    const { ok, results } = await validateExtensionPack(dir, { kind: "templates", templatesPath: join(dir, "templates.jsonl") });
    assert.equal(ok, false);
    assert.match(results[0].error, /duplicate template id "pack:a"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validateExtensionPack: results report per-resource, so a mixed pack shows some PASS and some FAIL", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), JSON.stringify({ start: "/c/en/widget", rel: "/r/IsA", end: "/c/en/thing", weight: 1 }) + "\n");
    await writeFile(join(dir, "templates.jsonl"), '{"id":"bare","class":"describe","template":"hi.","register":"terse"}\n');
    const { ok, results } = await validateExtensionPack(dir, {
      kind: "pack", corpusPath: join(dir, "corpus.jsonl"), templatesPath: join(dir, "templates.jsonl"),
    });
    assert.equal(ok, false);
    assert.equal(results.find((r) => r.kind === "corpus").ok, true);
    assert.equal(results.find((r) => r.kind === "templates").ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- CLI: `tmct extend --validate <dir>` -----------------------------------

const runCli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

test("CLI: `tmct extend --validate <dir>` on a well-formed pack prints a PASS report and exits 0", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), JSON.stringify({ start: "/c/en/widget", rel: "/r/IsA", end: "/c/en/thing", weight: 1 }) + "\n");
    await writeFile(join(dir, "templates.jsonl"), '{"id":"mypack:greet","class":"describe","template":"hi.","register":"terse"}\n');
    await writeFile(join(dir, "tmct.toml"),
      '[extensions.mypack]\nkind = "pack"\nactive = true\ncorpus_path = "corpus.jsonl"\ntemplates_path = "templates.jsonl"\n');
    const r = runCli(["extend", "--validate", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /mypack \(pack\):/);
    assert.match(r.stdout, /\[PASS\] corpus:/);
    assert.match(r.stdout, /\[PASS\] templates:/);
    assert.match(r.stdout, /all resources passed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: a corrupt resource prints a FAIL line naming the error and exits 1", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "corpus.jsonl"), "not json\n");
    await writeFile(join(dir, "tmct.toml"), '[extensions.mypack]\nkind = "corpus"\nactive = true\ncorpus_path = "corpus.jsonl"\n');
    const r = runCli(["extend", "--validate", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /\[FAIL\] corpus:/);
    assert.match(r.stdout, /not valid JSON/);
    assert.match(r.stdout, /one or more resources FAILED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: no --validate arg, or a dir with no host-declared [extensions.*] entries, both fail loudly", async () => {
  const noArg = runCli(["extend"]);
  assert.notEqual(noArg.status, 0);
  assert.match(noArg.stderr, /--validate <dir> requires a directory/);

  const dir = await tmp();
  try {
    const r = runCli(["extend", "--validate", dir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no host-declared \[extensions\.\*\] entries found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
