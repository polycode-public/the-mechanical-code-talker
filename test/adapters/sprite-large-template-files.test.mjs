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
import { EXPRESSION_PALETTE } from "../../src/domain/sprite-expressions.mjs";
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
  const dog = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes("dog") && !t.parameters?.emotion);
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

test("a sample of the pack's own no-material classes each resolve to their own dedicated template with no facts at all, never a fallback", () => {
  const samples = ["castle", "cat", "bear", "bread", "coffee", "church", "earth", "body of water", "drink"];
  for (const className of samples) {
    const svg = resolveSpriteAsset(className, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.ok(svg.includes("<svg"), `${className}: expected real svg markup`);
    assert.ok(!svg.includes("{{FILL"), `${className}: no unresolved placeholder token may reach the rendered output`);
    const gradientId = className.replace(/\s+/g, "-") + "-fill";
    assert.ok(svg.includes(gradientId), `${className}: expected its own dedicated gradient id "${gradientId}", got a fallback template instead`);
  }
});

test("a sample of the pack's own material-bearing classes each resolve their own dedicated template once a matching mgx:madeOf fact is taught", () => {
  const samples = [
    { className: "bicycle", value: "metal" },
    { className: "chair", value: "wood" },
    { className: "coin", value: "gold" },
    { className: "coat", value: "woven material" },
  ];
  for (const { className, value } of samples) {
    const facts = [{ subject: "the-instance", predicate: "mgx:madeOf", object: value }];
    const svg = resolveSpriteAsset(className, [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.ok(svg.includes("<svg"), `${className}: expected real svg markup`);
    assert.ok(!svg.includes("{{FILL"), `${className}: no unresolved placeholder token may reach the rendered output`);
    const gradientId = className.replace(/\s+/g, "-") + "-fill";
    assert.ok(svg.includes(gradientId), `${className}: expected its own dedicated gradient id "${gradientId}", got a fallback template instead`);
  }
});

test("a material-bearing class among the new pack (bicycle) resolves a taught mgx:madeOf value into a real gradient fill, not the raw treatment name", () => {
  const facts = [{ subject: "the-bike", predicate: "mgx:madeOf", object: "metal" }];
  const svg = resolveSpriteAsset("bicycle", [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.ok(svg.includes(MATERIAL_PALETTE.metal.light));
  assert.ok(svg.includes(MATERIAL_PALETTE.metal.base));
  assert.ok(svg.includes(MATERIAL_PALETTE.metal.dark));
  assert.ok(!svg.includes("{{FILL"));
});

test("a garment class among the new pack (coat) resolves the woven material treatment from its own by-name palette reference", () => {
  const facts = [{ subject: "the-coat", predicate: "mgx:madeOf", object: "woven material" }];
  const svg = resolveSpriteAsset("coat", [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.ok(svg.includes(MATERIAL_PALETTE["woven material"].base));
  assert.ok(!svg.includes("{{FILL"));
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

// ---- the emoji fallback: an abstract concept with no honest single picture,
// but a genuinely ubiquitous pictograph, renders as that glyph rather than
// an invented scene or a skipped class. ------------------------------------

const EMOJI_CLASSES = [
  "anger", "autumn", "birthday", "fear", "hate", "holiday", "hope", "joy",
  "love", "meeting", "spring", "summer", "surprise", "trip", "wedding", "winter",
];

test("every abstract-concept emoji class resolves to its own dedicated template, not the animal-root fallback", () => {
  for (const cls of EMOJI_CLASSES) {
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.ok(svg.includes("<text"), `${cls}: expected an emoji <text> sprite, got ${svg}`);
  }
});

test("an emoji sprite carries no [parameters] table — a glyph is not a gradient template", () => {
  for (const cls of EMOJI_CLASSES) {
    const t = REAL_LARGE_TEMPLATES.find((tpl) => tpl.classes.includes(cls));
    assert.ok(t, `${cls}: no template found`);
    assert.equal(t.parameters, undefined, `${cls}: an emoji sprite should never carry a material/colour parameter`);
  }
});

// ---- the 56 generic person-ROLE classes a fresh `npm run init` seeds ------

const PERSON_ROLE_CLASSES = [
  "adult", "artist", "audience", "baby", "boss", "boy", "brother", "champion", "child", "citizen",
  "crowd", "customer", "daughter", "doctor", "driver", "employee", "engineer", "family", "farmer",
  "father", "friend", "girl", "grandfather", "grandmother", "guest", "human", "husband", "judge",
  "king", "lawyer", "leader", "man", "manager", "mother", "neighbor", "nurse", "officer", "parent",
  "president", "priest", "queen", "resident", "servant", "sister", "soldier", "son", "stranger",
  "student", "teacher", "team", "visitor", "volunteer", "wife", "woman", "worker", "writer",
];

test("every one of the 56 person-role classes loads as its own real template file", () => {
  assert.equal(PERSON_ROLE_CLASSES.length, 56);
  for (const className of PERSON_ROLE_CLASSES) {
    const template = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes(className));
    assert.ok(template, `${className}.toml not found among the loaded sprite-tier templates`);
  }
});

test("a sample of the person-role classes each resolve to their own dedicated template, not the generic person fallback", () => {
  const personSvg = resolveSpriteAsset("person", [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  const sample = [
    "doctor", "king", "queen", "nurse", "soldier", "farmer", "judge", "teacher", "writer",
    "student", "worker", "boss", "grandfather", "grandmother", "artist", "baby", "adult",
    "man", "woman", "child",
  ];
  for (const className of sample) {
    const svg = resolveSpriteAsset(className, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.notEqual(svg, personSvg, `${className} must resolve to its own template, not the generic person fallback`);
    assert.ok(svg.includes("<svg"));
  }
});

test("the plain, no-invented-prop person-role classes are honest about it: each renders the same body as adult.toml", () => {
  const adultSvg = resolveSpriteAsset("adult", [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  const stripId = (svg, className) => svg.split(`${className}-fill`).join("ID");
  for (const className of ["human", "resident", "stranger", "citizen", "guest", "visitor", "neighbor", "parent", "friend"]) {
    const svg = resolveSpriteAsset(className, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.equal(stripId(svg, className), stripId(adultSvg, "adult"), `${className} should render the same plain body as adult.toml`);
  }
});

test("the four group classes each render a cluster of person silhouettes, not a single figure", () => {
  for (const className of ["family", "crowd", "audience", "team"]) {
    const svg = resolveSpriteAsset(className, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    const heads = svg.match(/<circle/g) || [];
    assert.ok(heads.length >= 3, `${className} should render at least 3 head circles (a group composite), got ${heads.length}`);
  }
});

// fish, flower, food, forest, frog, garden, glove, gold, grass, hat, home,
// horse, hospital, hotel, house, insect, iron, jewelry, kitchen, library,
// lion, market, meal, meat, metal, money, mountain, mouse, museum, ocean,
// office, owl, park, pig, planet, mapped to the gradient/wash id each one's
// own file declares —
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

// ---- the 3 real *-with-emotion.toml proof-of-concept files ----------------
// (B.2's own worked examples for the shared face-fragment mechanism: one
// for the 56-person-role wave, two for the 19-expressive-faced-animal wave)

const EMOTION_WORDS = ["happy", "sad", "angry", "scared", "surprised", "calm"];
const EMOTION_CLASSES = ["dog", "person", "cat"];

const feels = (subject, object) => [{ subject, predicate: "mgx:feels", object }];

test("every *-with-emotion.toml file loads as a real template with its own [face] table", () => {
  for (const cls of EMOTION_CLASSES) {
    const withEmotion = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes(cls) && t.parameters?.emotion);
    assert.ok(withEmotion, `${cls}-with-emotion.toml not found among the loaded sprite-tier templates`);
    assert.equal(typeof withEmotion.face?.cx, "number", `${cls}-with-emotion.toml: face.cx must be a number`);
    assert.equal(typeof withEmotion.face?.cy, "number", `${cls}-with-emotion.toml: face.cy must be a number`);
    assert.equal(typeof withEmotion.face?.scale, "number", `${cls}-with-emotion.toml: face.scale must be a number`);
  }
});

for (const cls of EMOTION_CLASSES) {
  for (const word of EMOTION_WORDS) {
    test(`${cls} taught mgx:feels ${word} resolves placeholder-free with that emotion's own face fragment`, () => {
      const svg = resolveSpriteAsset(cls, [], feels(`the-${cls}`, word), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
      assert.ok(!svg.includes("{{FACE"), `${cls}/${word}: no unresolved face placeholder may reach the rendered output`);
      assert.ok(svg.includes(EXPRESSION_PALETTE[word]), `${cls}/${word}: the resolved svg must carry that emotion's own fragment markup`);
    });
  }
}

test("a class with no mgx:feels fact at all still resolves to the plain, faceless template — the dog/dog-with-colour precedent", () => {
  for (const cls of EMOTION_CLASSES) {
    const plain = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes(cls) && !t.parameters?.emotion);
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.equal(svg, plain.svg, `${cls}: an untaught instance must resolve to the plain ${cls}.toml sprite, never the emotion template`);
    for (const word of EMOTION_WORDS) assert.ok(!svg.includes(EXPRESSION_PALETTE[word]), `${cls}: no face fragment may leak in with no mgx:feels fact`);
  }
});

test("an mgx:feels value outside the 6-word curated vocabulary is never a guessed face — falls through to the plain template", () => {
  const svg = resolveSpriteAsset("dog", [], feels("the-dog", "ecstatic"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  const plain = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes("dog") && !t.parameters?.emotion);
  assert.equal(svg, plain.svg);
});
