// scripts/build-demo-pack.mjs cuts the browser-fetchable subset of the
// reference pack. Driven here over the committed mini-pack in
// test/fixtures/reference-pack/, so no built corpus/reference/ is needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoPack, articleIdFor, DEMO_PACK_BYTES_MAX } from "../../scripts/build-demo-pack.mjs";
import { isReferenceArticleRow } from "../../src/domain/reference-pack.mjs";

const FIXTURE_PACK = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "reference-pack");

test("buildDemoPack emits index.json + one fetchable JSON per article, aliases sharing their target's file", async () => {
  const out = await mkdtemp(join(tmpdir(), "tmct-demo-pack-"));
  try {
    const manifest = buildDemoPack({ srcDir: FIXTURE_PACK, terms: ["otter", "Harbour", "falcon"], outDir: out });
    assert.equal(manifest.license, "CC-BY-SA-4.0");
    assert.match(manifest.attribution, /Simple English Wikipedia/);
    assert.deepEqual(manifest.terms, { falcon: "falcon", harbour: "harbor", otter: "otter" }, "the alias maps to its target's article id");
    assert.deepEqual(JSON.parse(readFileSync(join(out, "index.json"), "utf8")), manifest);
    for (const id of new Set(Object.values(manifest.terms))) {
      const row = JSON.parse(readFileSync(join(out, "articles", `${id}.json`), "utf8"));
      assert.ok(isReferenceArticleRow(row), `articles/${id}.json is a full article row`);
    }
    assert.ok(!existsSync(join(out, "articles", "harbour.json")), "no separate file for an alias");
    const bytes = ["index.json", ...[...new Set(Object.values(manifest.terms))].map((id) => join("articles", `${id}.json`))]
      .reduce((sum, rel) => sum + readFileSync(join(out, rel)).length, 0);
    assert.ok(bytes <= DEMO_PACK_BYTES_MAX, `${bytes} bytes stays inside the demo budget`);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("buildDemoPack fails loudly on a term the pack does not hold, an empty allowlist, or an absent pack", async () => {
  const out = await mkdtemp(join(tmpdir(), "tmct-demo-pack-fail-"));
  try {
    assert.throws(() => buildDemoPack({ srcDir: FIXTURE_PACK, terms: ["otter", "zorbulon"], outDir: out }), /zorbulon/);
    assert.throws(() => buildDemoPack({ srcDir: FIXTURE_PACK, terms: [], outDir: out }), /no terms/);
    assert.throws(() => buildDemoPack({ srcDir: join(tmpdir(), "tmct-no-pack-here"), terms: ["otter"], outDir: out }), /no readable reference pack/);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("articleIdFor slugs a term into a safe file name", () => {
  assert.equal(articleIdFor("otter"), "otter");
  assert.equal(articleIdFor("polar bear"), "polar-bear");
  assert.equal(articleIdFor("o'clock"), "o-clock");
});
