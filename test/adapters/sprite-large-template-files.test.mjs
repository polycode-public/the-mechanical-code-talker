// sprite-large-template-files: the sprite tier meant to be looked at closely
// (400px, gradient/highlight material shading) — every real
// data/sprites-large/*.toml file loads, expands its material references
// against the shared palette, and is internally consistent; the tier
// resolves independently of the icon tier even where both name the same
// class; and the material treatments this pack actually uses never invent
// one outside the shared 8-item palette.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readSpriteLargeTemplateFiles, SPRITE_LARGE_TEMPLATES_DIR } from "../../src/adapters/corpus/sprite-large-template-files.mjs";
import { readSpriteTemplateFiles } from "../../src/adapters/corpus/sprite-template-files.mjs";
import { resolveSpriteAsset, spriteTemplateProblems } from "../../src/domain/sprite-templates.mjs";
import { MATERIAL_PALETTE } from "../../src/domain/sprite-materials.mjs";
import { SPRITE_REGISTRY } from "../../src/domain/sprite-map.mjs";

const REAL_LARGE_TEMPLATES = readSpriteLargeTemplateFiles();

/** Every loaded template whose `classes` list names `cls`. */
function templatesFor(cls) {
  return REAL_LARGE_TEMPLATES.filter((t) => Array.isArray(t.classes) && t.classes.includes(cls));
}

test("readSpriteLargeTemplateFiles loads every real sprite-tier template file, at least the base pack's 23", () => {
  assert.ok(REAL_LARGE_TEMPLATES.length >= 23, `expected at least 23 templates, got ${REAL_LARGE_TEMPLATES.length}`);
});

const WIDER_VOCABULARY_CLASSES = [
  "plant", "rabbit", "rain", "ring", "river", "road", "salt", "school", "sheep", "shirt",
  "shoe", "shop", "snake", "snow", "sock", "stadium", "star", "stone", "street", "sugar",
  "sun", "table", "tea", "tiger", "town", "train", "tree", "vegetable", "vehicle", "village",
  "water", "waterway", "wine", "wolf",
];

test("every class in the wider vocabulary pack has at least one dedicated template", () => {
  const totalClasses = new Set(REAL_LARGE_TEMPLATES.flatMap((t) => t.classes));
  const missing = WIDER_VOCABULARY_CLASSES.filter((c) => !totalClasses.has(c));
  assert.deepEqual(missing, [], `classes with no sprite-tier template at all: ${missing.join(", ")}`);
});

test("every real sprite-tier template is internally consistent", () => {
  for (const t of REAL_LARGE_TEMPLATES) {
    const problems = spriteTemplateProblems(t);
    assert.deepEqual(problems, [], `${JSON.stringify(t.classes)}: ${problems.join("; ")}`);
  }
});

test("every material treatment this pack actually uses is drawn from the shared 8-item palette", () => {
  const usedButUnknown = [];
  for (const t of REAL_LARGE_TEMPLATES) {
    for (const [paramName, param] of Object.entries(t.parameters || {})) {
      if (!param.placeholders) continue;
      for (const [rawValue, triple] of Object.entries(param.values || {})) {
        const known = Object.values(MATERIAL_PALETTE).some((p) => p.light === triple?.light && p.base === triple?.base && p.dark === triple?.dark);
        if (!known) usedButUnknown.push(`${t.classes.join("/")}.${paramName}.${rawValue}`);
      }
    }
  }
  assert.deepEqual(usedButUnknown, [], `these values resolved to a triple not found in MATERIAL_PALETTE: ${usedButUnknown.join(", ")}`);
});

test("the base pack covers the same 23 classes the icon tier does", () => {
  const iconClasses = new Set(readSpriteTemplateFiles().flatMap((t) => t.classes));
  const largeClasses = new Set(REAL_LARGE_TEMPLATES.flatMap((t) => t.classes));
  const missing = [...iconClasses].filter((c) => !largeClasses.has(c)).sort();
  assert.deepEqual(missing, [], `classes present at the icon tier but missing at the sprite tier: ${missing.join(", ")}`);
});

test("a material-bearing object resolves its taught mgx:madeOf value into a real gradient fill, not the raw treatment name", () => {
  const facts = [{ subject: "the-lamp", predicate: "mgx:madeOf", object: "gold" }];
  const svg = resolveSpriteAsset("lamp", [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.ok(svg.includes(MATERIAL_PALETTE.metal.light), "the expanded light stop must appear in the rendered svg");
  assert.ok(svg.includes(MATERIAL_PALETTE.metal.base));
  assert.ok(svg.includes(MATERIAL_PALETTE.metal.dark));
  assert.ok(!svg.includes("{{FILL"), "no unresolved placeholder token may reach the rendered output");
});

test("an object with no taught mgx:madeOf value still resolves to a complete, placeholder-free sprite", () => {
  const svg = resolveSpriteAsset("cabinet", [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.ok(svg.includes("<svg"));
  assert.ok(!svg.includes("{{FILL"));
});

test("an object with no material vocabulary at all (dog) never carries a [parameters.material] table at the sprite tier", () => {
  const dog = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes("dog"));
  assert.ok(dog, "sprite-large/dog.toml not found");
  assert.equal(dog.parameters, undefined);
});

test("portrait-round is a real [match] shape variant of portrait, selected only when mgx:hasProperty is round", () => {
  const plain = resolveSpriteAsset("portrait", [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  const round = resolveSpriteAsset("portrait", [], [{ subject: "the-portrait", predicate: "mgx:hasProperty", object: "round" }], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.notEqual(plain, round, "a round portrait must render differently from the plain arched frame");
  const unrelated = resolveSpriteAsset("portrait", [], [{ subject: "the-portrait", predicate: "mgx:hasProperty", object: "cracked" }], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.equal(unrelated, plain, "an unrelated property must never accidentally select the round variant");
});

test("two lamps with different taught materials, both given an instanceKey, never collide on the shared gradient id", () => {
  const gold = resolveSpriteAsset("lamp", [], [{ subject: "lamp-a", predicate: "mgx:madeOf", object: "gold" }], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY, { instanceKey: "lamp-a" });
  const ceramic = resolveSpriteAsset("lamp", [], [{ subject: "lamp-b", predicate: "mgx:madeOf", object: "ceramic" }], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY, { instanceKey: "lamp-b" });
  assert.notEqual(gold, ceramic);
  assert.ok(gold.includes(MATERIAL_PALETTE.metal.base) && gold.includes("lamp-a"));
  assert.ok(ceramic.includes(MATERIAL_PALETTE.ceramic.base) && ceramic.includes("lamp-b"));
  // without instanceKey, both would share the same "lamp-fill" id and a
  // browser would render every instance with whichever it saw first — this
  // is the regression instanceKey exists to prevent.
  const goldNoKey = resolveSpriteAsset("lamp", [], [{ subject: "lamp-a", predicate: "mgx:madeOf", object: "gold" }], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  const ceramicNoKey = resolveSpriteAsset("lamp", [], [{ subject: "lamp-b", predicate: "mgx:madeOf", object: "ceramic" }], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  const idOf = (svg) => svg.match(/id="([^"]+)"/)[1];
  assert.equal(idOf(goldNoKey), idOf(ceramicNoKey), "without an instanceKey both instances still share the same raw template id");
});

test("the icon tier and the sprite tier resolve the SAME class name independently, never confused for each other", () => {
  const iconTemplates = readSpriteTemplateFiles();
  const iconLamp = resolveSpriteAsset("lamp", [], [], iconTemplates, SPRITE_REGISTRY);
  const largeLamp = resolveSpriteAsset("lamp", [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.notEqual(iconLamp, largeLamp, "the two tiers must never resolve to byte-identical markup for the same class");
  assert.ok(iconLamp.includes("<svg"));
  assert.ok(largeLamp.includes("<svg"));
});

test("a sample of the wider vocabulary pack resolves to its own dedicated template, not a shared fallback", () => {
  const sample = ["rabbit", "tree", "sun", "river", "shirt", "salt", "stone", "waterway", "school", "wolf"];
  for (const cls of sample) {
    const own = templatesFor(cls);
    assert.equal(own.length, 1, `${cls}: expected exactly one dedicated template, found ${own.length}`);
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.ok(svg.includes("<svg"), `${cls}: resolved svg must be a real <svg> string`);
    assert.equal(svg, own[0].svg, `${cls}: resolveSpriteAsset must return this class's own template, not a fallback`);
  }
});

test("ring/table/vehicle/train gain a taught mgx:madeOf gradient the same way the original pack's material-bearing classes do", () => {
  const facts = [{ subject: "the-ring", predicate: "mgx:madeOf", object: "gold" }];
  const svg = resolveSpriteAsset("ring", [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.ok(svg.includes(MATERIAL_PALETTE.metal.base));
  assert.ok(!svg.includes("{{FILL"));
});

test("ring/table/vehicle/train are brand-new classes with no legacy sprite-registry entry, so each needs its own plain fallback when no material is taught", () => {
  for (const cls of ["ring", "table", "vehicle", "train"]) {
    assert.equal(templatesFor(cls).length, 2, `${cls}: expected a parameterized template plus a plain fallback`);
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.ok(!svg.includes("{{FILL"), `${cls}: an untaught instance must never leak a placeholder token`);
    assert.ok(svg.includes(`${cls}-plain-fill`), `${cls}: an untaught instance must resolve to its OWN plain fallback, not the generic animal root`);
  }
});

test("a missing directory reads as no templates at all, never throws", () => {
  assert.deepEqual(readSpriteLargeTemplateFiles("/does/not/exist"), []);
});

test("SPRITE_LARGE_TEMPLATES_DIR points at data/sprites-large", () => {
  assert.match(SPRITE_LARGE_TEMPLATES_DIR, /data[\\/]sprites-large$/);
});
