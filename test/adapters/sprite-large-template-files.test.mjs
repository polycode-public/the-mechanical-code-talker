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

test("readSpriteLargeTemplateFiles loads every real sprite-tier template file, at least the base pack's 23", () => {
  assert.ok(REAL_LARGE_TEMPLATES.length >= 23, `expected at least 23 templates, got ${REAL_LARGE_TEMPLATES.length}`);
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

test("a missing directory reads as no templates at all, never throws", () => {
  assert.deepEqual(readSpriteLargeTemplateFiles("/does/not/exist"), []);
});

test("SPRITE_LARGE_TEMPLATES_DIR points at data/sprites-large", () => {
  assert.match(SPRITE_LARGE_TEMPLATES_DIR, /data[\\/]sprites-large$/);
});

// fish/flower/food/forest/frog/garden/glove/gold/grass/hat/home/horse/
// hospital/hotel/house/insect/iron/jewelry/kitchen/library/lion/market/
// meal/meat/metal/money/mountain/mouse/museum/ocean/office/owl/park/pig/
// planet, mapped to the gradient/wash id each one's own file declares —
// every one of these 35 classes carries no [parameters.material] table,
// unlike lamp/key/cabinet/desk/letter/container/portrait: those seven
// can safely go material-parameterized because sprite-map.mjs's legacy
// SPRITE_REGISTRY already carries a fallback icon for the untaught
// case, and none of these 35 newer classes are registered there. A
// class with only a parameterized template and no taught fact to fill
// it resolves to nothing at its own term and falls through the whole
// ancestor chain to the generic root animal sprite — so every file
// here uses a fixed or currentColor-anchored gradient instead, the one
// shape that always renders correctly whether or not a fact was ever taught.
const CLASS_OWN_GRADIENT_ID = {
  fish: "fish-fill",
  flower: "flower-fill",
  food: "food-fill",
  forest: "forest-wash",
  frog: "frog-fill",
  garden: "garden-wash",
  glove: "glove-fill",
  gold: "gold-fill",
  grass: "grass-fill",
  hat: "hat-fill",
  home: "home-wash",
  horse: "horse-fill",
  hospital: "hospital-wash",
  hotel: "hotel-wash",
  house: "house-wash",
  insect: "insect-fill",
  iron: "iron-fill",
  jewelry: "jewelry-fill",
  kitchen: "kitchen-wash",
  library: "library-wash",
  lion: "lion-fill",
  market: "market-wash",
  meal: "meal-fill",
  meat: "meat-fill",
  metal: "metal-fill",
  money: "money-fill",
  mountain: "mountain-wash",
  mouse: "mouse-fill",
  museum: "museum-wash",
  ocean: "ocean-wash",
  office: "office-wash",
  owl: "owl-fill",
  park: "park-wash",
  pig: "pig-fill",
  planet: "planet-fill",
};

test("every one of the pack's own 35 classes resolves to a template that names that exact class", () => {
  for (const cls of Object.keys(CLASS_OWN_GRADIENT_ID)) {
    const t = REAL_LARGE_TEMPLATES.find((x) => x.classes.includes(cls));
    assert.ok(t, `data/sprites-large/${cls}.toml not found`);
    assert.deepEqual(t.classes, [cls], `${cls}.toml should declare classes = ["${cls}"]`);
  }
});

test("every one of the pack's own 35 classes resolves through its own dedicated gradient with zero taught facts, never the root animal fallback", () => {
  for (const [cls, ownId] of Object.entries(CLASS_OWN_GRADIENT_ID)) {
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.ok(svg.includes(`id="${ownId}"`), `${cls} resolved without its own gradient id "${ownId}": ${svg}`);
    assert.ok(!svg.includes("{{FILL"), `${cls} left an unresolved placeholder token`);
  }
});

test("none of the pack's own 35 classes carries a [parameters.material] table, since none has a legacy SPRITE_REGISTRY fallback for the untaught case", () => {
  for (const cls of Object.keys(CLASS_OWN_GRADIENT_ID)) {
    const t = REAL_LARGE_TEMPLATES.find((x) => x.classes.includes(cls));
    assert.equal(t.parameters, undefined, `${cls}.toml should carry no material parameters`);
  }
});
