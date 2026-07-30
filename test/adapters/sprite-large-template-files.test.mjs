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
import {
  resolveSpriteAsset, spriteTemplateProblems, matchConstraints, FACING_PROPERTY, POSE_PROPERTY,
} from "../../src/domain/sprite-templates.mjs";
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

// Everything a mud-garden player can find: the world's own placed props
// plus every kind a dig can turn up. Each needs a template of its own, or
// the room view hangs a generic fallback on the wall in place of the thing
// the digest just named.
const MUD_ITEM_CLASSES = ["carrot", "lettuce", "tomato", "stone", "seed", "basket", "root", "worm"];

test("every object class a mud-garden player can meet resolves to its own dedicated template", () => {
  for (const cls of MUD_ITEM_CLASSES) {
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY, { rootFallback: "portable" });
    assert.ok(svg.includes(`id="${cls}-fill"`), `${cls} resolved without its own gradient id: ${svg}`);
    assert.ok(!svg.includes("{{FILL"), `${cls} left an unresolved placeholder token`);
  }
});

// The mid-level classes a specific food item climbs to when its own class
// has no sprite: a turnip reaches vegetable, an apple reaches fruit, moss
// reaches plant. Each needs a picture for that climb to be worth making.
test("the mid-level fallback classes a food item climbs to each carry their own template", () => {
  for (const cls of ["food", "fruit", "vegetable", "plant", "flower"]) {
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY, { rootFallback: "portable" });
    assert.ok(svg.includes(`id="${cls}-fill"`), `${cls} resolved without its own gradient id: ${svg}`);
  }
});

test("a class whose whole chain has no sprite lands on the plain portable parcel, never the animal root", () => {
  const rows = [{ subject: "gizmo", predicate: "rdfs:subClassOf", object: "widget" }];
  const svg = resolveSpriteAsset("gizmo", rows, [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY, { rootFallback: "portable" });
  assert.ok(svg.includes('id="portable-plain-fill"'), `expected the plain parcel, got: ${svg}`);
  assert.ok(!svg.includes("{{FILL"), "an untaught portable must never leak a placeholder token");
});

test("a taught mgx:madeOf value still wins over the plain parcel", () => {
  const facts = [{ subject: "the-thing", predicate: "mgx:madeOf", object: "wood" }];
  const svg = resolveSpriteAsset("portable", [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY, { rootFallback: "portable" });
  assert.ok(svg.includes(MATERIAL_PALETTE.wood.base), "the taught material's own gradient must appear");
  assert.ok(!svg.includes('id="portable-plain-fill"'), "the plain fallback must not shadow a filled material template");
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
  const dog = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes("dog") && !t.parameters?.emotion && !t.match);
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
    // a class with a -with-emotion.toml or -facing-*.toml sibling has
    // several templates by design — the plain, un-parameterized,
    // un-matched template is still the one that must resolve here, so
    // exclude the siblings rather than assume exactly one template exists
    // for every class in this sample.
    const own = templatesFor(cls).filter((t) => !t.parameters?.emotion && !t.match);
    assert.equal(own.length, 1, `${cls}: expected exactly one dedicated PLAIN template, found ${own.length}`);
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
    // a class also given a -with-emotion.toml sibling carries a real
    // [parameters.emotion] table on THAT file — find the plain template
    // specifically, since it's the one this assertion is actually about.
    const t = REAL_LARGE_TEMPLATES.find((x) => x.classes.includes(cls) && !x.parameters?.emotion && !x.match);
    assert.ok(t, `${cls}: no plain (non-emotion) template found`);
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
    const plain = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes(cls) && !t.parameters?.emotion && !t.match);
    const svg = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.equal(svg, plain.svg, `${cls}: an untaught instance must resolve to the plain ${cls}.toml sprite, never the emotion template`);
    for (const word of EMOTION_WORDS) assert.ok(!svg.includes(EXPRESSION_PALETTE[word]), `${cls}: no face fragment may leak in with no mgx:feels fact`);
  }
});

test("an mgx:feels value outside the 6-word curated vocabulary is never a guessed face — falls through to the plain template", () => {
  const svg = resolveSpriteAsset("dog", [], feels("the-dog", "ecstatic"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  const plain = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes("dog") && !t.parameters?.emotion && !t.match);
  assert.equal(svg, plain.svg);
});

// ---- the *-facing-{left,right}.toml [match] direction variants ------------

const FACING_CLASSES = [
  "bear", "cat", "dog", "king",
  "father", "friend", "girl", "grandfather", "grandmother", "guest", "human",
];

// The person-role wave also ships a centre-facing `<class>-moving.toml`, a
// single-constraint mgx:pose = "moving" variant with no facing requirement —
// bear/cat/dog/king have no such file, since their own moving art only
// exists combined with a facing angle. The generic "pose alone lands on the
// plain sprite" test below is only true for classes with no such file, so it
// is scoped away from these; the paragraph after it covers what these
// classes do instead.
const CENTER_MOVING_CLASSES = ["father", "friend", "girl", "grandfather", "grandmother", "guest", "human"];

const faces = (subject, object) => [{ subject, predicate: "mgx:faces", object }];

test("every facing pair loads as two real [match] templates on mgx:faces, one per direction", () => {
  for (const cls of FACING_CLASSES) {
    for (const direction of ["left", "right"]) {
      const variant = REAL_LARGE_TEMPLATES.find(
        (t) => t.classes.includes(cls) && t.match?.property === "mgx:faces" && t.match?.value === direction,
      );
      assert.ok(variant, `${cls}-facing-${direction}.toml not found among the loaded sprite-tier templates`);
    }
  }
});

for (const cls of FACING_CLASSES) {
  test(`${cls} taught mgx:faces left resolves its own profile art, distinct from the plain front-facing sprite and from the right profile`, () => {
    const plain = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    const left = resolveSpriteAsset(cls, [], faces(`the-${cls}`, "left"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    const right = resolveSpriteAsset(cls, [], faces(`the-${cls}`, "right"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.notEqual(left, plain, `${cls}: the left profile must differ from the plain sprite`);
    assert.notEqual(right, plain, `${cls}: the right profile must differ from the plain sprite`);
    assert.notEqual(left, right, `${cls}: the two directions must differ from each other`);
    assert.ok(left.includes(`${cls}-facing-left-fill`), `${cls}: the left profile carries its own gradient id`);
    assert.ok(right.includes(`${cls}-facing-right-fill`), `${cls}: the right profile carries its own gradient id`);
  });
}

test("a right profile is the left profile's mirror: the same geometry under one flip transform", () => {
  for (const cls of FACING_CLASSES) {
    const left = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes(cls) && t.match?.value === "left");
    const right = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes(cls) && t.match?.value === "right");
    assert.ok(right.svg.includes('transform="translate(24 0) scale(-1 1)"'), `${cls}: the right file mirrors rather than redrawing`);
    // Strip the id-bearing direction word and the mirror wrapper's own lines;
    // what remains — the drawn shapes — must be identical between the pair.
    const shapeLines = (svg, direction) => svg
      .split("\n")
      .map((line) => line.trim().split(`facing-${direction}`).join("facing"))
      .filter((line) => line.startsWith("<ellipse") || line.startsWith("<circle") || line.startsWith("<path") || line.startsWith("<rect") || line.startsWith("<line"));
    assert.deepEqual(shapeLines(right.svg, "right"), shapeLines(left.svg, "left"), `${cls}: the mirrored file must not silently redraw any shape`);
  }
});

test("an mgx:faces value outside the turntable's own angles is never a guessed view — falls through to the plain template", () => {
  const plain = resolveSpriteAsset("bear", [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.equal(resolveSpriteAsset("bear", [], faces("the-bear", "north"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY), plain);
});

test("a facing fact on a class with no facing variant resolves to that class's plain sprite, never a neighbour's profile", () => {
  const plain = resolveSpriteAsset("rabbit", [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.equal(resolveSpriteAsset("rabbit", [], faces("the-rabbit", "left"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY), plain);
});

// ---- a facing profile can also wear one of the six moods ------------------
// (each *-facing-*.toml carries [face] + [parameters.emotion] of its own, so
// the two dimensions compose instead of one shadowing the other)

const facingVariantFor = (cls, direction) => REAL_LARGE_TEMPLATES.find(
  (t) => t.classes.includes(cls) && t.match?.property === "mgx:faces" && t.match?.value === direction,
);

test("every facing variant declares its own numeric [face] anchor alongside its [parameters.emotion] table", () => {
  for (const cls of FACING_CLASSES) {
    for (const direction of ["left", "right"]) {
      const variant = facingVariantFor(cls, direction);
      assert.equal(typeof variant.face?.cx, "number", `${cls}-facing-${direction}: face.cx must be a number`);
      assert.equal(typeof variant.face?.cy, "number", `${cls}-facing-${direction}: face.cy must be a number`);
      assert.equal(typeof variant.face?.scale, "number", `${cls}-facing-${direction}: face.scale must be a number`);
      assert.deepEqual(
        Object.keys(variant.parameters?.emotion?.values || {}).sort(),
        [...EMOTION_WORDS].sort(),
        `${cls}-facing-${direction}: all six curated words must be mapped`,
      );
    }
  }
});

test("a right profile's face anchor is its left twin's reflected across the canvas midline, at the same height and size", () => {
  for (const cls of FACING_CLASSES) {
    const left = facingVariantFor(cls, "left");
    const right = facingVariantFor(cls, "right");
    assert.ok(Math.abs(right.face.cx - (24 - left.face.cx)) < 1e-9, `${cls}: the right anchor must sit at 24 - ${left.face.cx}`);
    assert.equal(right.face.cy, left.face.cy, `${cls}: a mirror never changes the face's height`);
    assert.equal(right.face.scale, left.face.scale, `${cls}: a mirror never changes the face's size`);
  }
});

for (const cls of FACING_CLASSES) {
  for (const direction of ["left", "right"]) {
    test(`${cls} taught mgx:faces ${direction} and an mgx:feels word renders that profile wearing that mood`, () => {
      for (const word of EMOTION_WORDS) {
        const both = [
          { subject: `the-${cls}`, predicate: "mgx:faces", object: direction },
          { subject: `the-${cls}`, predicate: "mgx:feels", object: word },
        ];
        const svg = resolveSpriteAsset(cls, [], both, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
        assert.ok(svg.includes(`${cls}-facing-${direction}-fill`), `${cls}/${direction}/${word}: the profile art must still be what renders`);
        assert.ok(svg.includes(EXPRESSION_PALETTE[word]), `${cls}/${direction}/${word}: that mood's own fragment markup must appear`);
        assert.ok(!svg.includes("{{FACE"), `${cls}/${direction}/${word}: no unresolved placeholder token may reach the output`);
      }
    });
  }
}

test("a facing fact on its own renders the bare profile — the face placeholder is dropped rather than left in the markup", () => {
  for (const cls of FACING_CLASSES) {
    for (const direction of ["left", "right"]) {
      const svg = resolveSpriteAsset(cls, [], faces(`the-${cls}`, direction), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
      assert.ok(svg.includes(`${cls}-facing-${direction}-fill`), `${cls}/${direction}: the profile art must render with no mood taught`);
      assert.ok(!svg.includes("{{FACE"), `${cls}/${direction}: an untaught mood must never leak a placeholder token`);
      for (const word of EMOTION_WORDS) {
        assert.ok(!svg.includes(EXPRESSION_PALETTE[word]), `${cls}/${direction}: no face fragment may appear with no mgx:feels fact`);
      }
    }
  }
});

test("a mood outside the curated six never guesses a face onto a profile, and never costs the instance the pose it asked for", () => {
  for (const cls of FACING_CLASSES) {
    const facts = [
      { subject: `the-${cls}`, predicate: "mgx:faces", object: "left" },
      { subject: `the-${cls}`, predicate: "mgx:feels", object: "ecstatic" },
    ];
    const svg = resolveSpriteAsset(cls, [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    const facingOnly = resolveSpriteAsset(cls, [], faces(`the-${cls}`, "left"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.equal(svg, facingOnly, `${cls}: an unmapped mood renders exactly as the bare profile does`);
  }
});

test("a mood with no facing fact still resolves the front-facing emotion template, never a profile", () => {
  for (const cls of ["cat", "dog"]) {
    const svg = resolveSpriteAsset(cls, [], feels(`the-${cls}`, "happy"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.ok(svg.includes(EXPRESSION_PALETTE.happy), `${cls}: the happy fragment must appear`);
    assert.ok(!svg.includes("-facing-"), `${cls}: a mood alone must never select a profile variant`);
  }
});

// ---- the 5-point turntable and the mgx:pose axis ---------------------------
// The turntable names four angles and leaves the centre view as the absent
// mgx:faces fact; mgx:pose names one intermediate frame and leaves standing
// still as the absent fact. A combined facing-and-pose file needs both facts
// at once, which is what the plural [[match]] spelling is for.

const HALF_ANGLES = ["half-left", "half-right"];
const poses = (subject, object) => [{ subject, predicate: POSE_PROPERTY, object }];

/** The one loaded `cls` template whose [match] requires EXACTLY `wanted`
 *  (each entry written "property=value"), or undefined. */
function variantRequiring(cls, wanted) {
  const key = [...wanted].sort().join(" & ");
  return REAL_LARGE_TEMPLATES.find((t) => {
    if (!Array.isArray(t.classes) || !t.classes.includes(cls)) return false;
    return matchConstraints(t).map((c) => `${c.property}=${c.value}`).sort().join(" & ") === key;
  });
}

const angleVariant = (cls, angle) => variantRequiring(cls, [`${FACING_PROPERTY}=${angle}`]);
const movingVariant = (cls) => variantRequiring(cls, [`${FACING_PROPERTY}=left`, `${POSE_PROPERTY}=moving`]);

test("every reference class carries all four named turntable angles as real single-constraint variants", () => {
  for (const cls of FACING_CLASSES) {
    for (const angle of ["left", "half-left", "half-right", "right"]) {
      assert.ok(angleVariant(cls, angle), `${cls} has no variant requiring ${FACING_PROPERTY} = ${angle}`);
    }
  }
});

test("every reference class carries a combined facing-and-pose variant requiring two facts at once", () => {
  for (const cls of FACING_CLASSES) {
    const variant = movingVariant(cls);
    assert.ok(variant, `${cls} has no combined ${FACING_PROPERTY} + ${POSE_PROPERTY} variant`);
    assert.equal(matchConstraints(variant).length, 2, `${cls}: the combined variant must require exactly the two facts`);
    assert.ok(Array.isArray(variant.match), `${cls}: two constraints must be authored as repeated [[match]] tables`);
  }
});

test("every new turntable and pose file is internally consistent on its own terms", () => {
  for (const cls of FACING_CLASSES) {
    for (const variant of [...HALF_ANGLES.map((a) => angleVariant(cls, a)), movingVariant(cls)]) {
      assert.deepEqual(spriteTemplateProblems(variant), [], `${cls}: ${JSON.stringify(matchConstraints(variant))} has authoring problems`);
      assert.deepEqual(
        Object.keys(variant.parameters?.emotion?.values || {}).sort(),
        [...EMOTION_WORDS].sort(),
        `${cls}: all six curated moods must be mapped`,
      );
      for (const key of ["cx", "cy", "scale"]) {
        assert.equal(typeof variant.face?.[key], "number", `${cls}: face.${key} must be a number`);
      }
    }
  }
});

test("a half-angle face anchor sits between the full profile's and the front view's, the eyes half as narrowed", () => {
  for (const cls of FACING_CLASSES) {
    const profileScale = facingVariantFor(cls, "left").face.scale;
    const frontScale = templatesFor(cls).find((t) => !t.match && t.parameters?.emotion).face.scale;
    for (const angle of HALF_ANGLES) {
      const halfScale = angleVariant(cls, angle).face.scale;
      assert.ok(
        halfScale > profileScale && halfScale < frontScale,
        `${cls}/${angle}: a three-quarter view's face scale (${halfScale}) must sit between the profile's ${profileScale} and the front view's ${frontScale}`,
      );
    }
  }
});

test("the half-right profile is the half-left one's mirror, in both its shapes and its face anchor", () => {
  for (const cls of FACING_CLASSES) {
    const left = angleVariant(cls, "half-left");
    const right = angleVariant(cls, "half-right");
    assert.ok(right.svg.includes('transform="translate(24 0) scale(-1 1)"'), `${cls}: the half-right file mirrors rather than redrawing`);
    const shapeLines = (svg, direction) => svg
      .split("\n")
      .map((line) => line.trim().split(`facing-${direction}`).join("facing"))
      .filter((line) => line.startsWith("<ellipse") || line.startsWith("<circle") || line.startsWith("<path") || line.startsWith("<rect") || line.startsWith("<line"));
    assert.deepEqual(shapeLines(right.svg, "half-right"), shapeLines(left.svg, "half-left"), `${cls}: the mirrored half file must not silently redraw any shape`);
    assert.ok(Math.abs(right.face.cx - (24 - left.face.cx)) < 1e-9, `${cls}: the half-right anchor must sit at 24 - ${left.face.cx}`);
    assert.equal(right.face.cy, left.face.cy, `${cls}: a mirror never changes the face's height`);
    assert.equal(right.face.scale, left.face.scale, `${cls}: a mirror never changes the face's size`);
  }
});

test("each of the four angles resolves its own art, and no two angles of one class draw the same picture", () => {
  for (const cls of FACING_CLASSES) {
    const drawn = new Map();
    for (const angle of ["left", "half-left", "half-right", "right"]) {
      const svg = resolveSpriteAsset(cls, [], faces(`the-${cls}`, angle), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
      assert.ok(svg.includes(`${cls}-facing-${angle}-fill`), `${cls}/${angle}: that angle's own gradient id must render`);
      assert.ok(!svg.includes("{{"), `${cls}/${angle}: no unresolved placeholder token may reach the output`);
      for (const [seen, seenAngle] of drawn) {
        assert.notEqual(svg, seen, `${cls}: ${angle} and ${seenAngle} resolve the same markup`);
      }
      drawn.set(svg, angle);
    }
  }
});

test("the pose fact only bites alongside the facing it was drawn for: on its own it resolves the plain sprite", () => {
  for (const cls of FACING_CLASSES.filter((c) => !CENTER_MOVING_CLASSES.includes(c))) {
    const plain = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.equal(
      resolveSpriteAsset(cls, [], poses(`the-${cls}`, "moving"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY),
      plain,
      `${cls}: a pose with no facing on record has no art of its own to land on`,
    );
  }
});

test("a class with its own centre-facing moving template resolves that art when the pose fact stands alone", () => {
  for (const cls of CENTER_MOVING_CLASSES) {
    const plain = resolveSpriteAsset(cls, [], [], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    const moving = resolveSpriteAsset(cls, [], poses(`the-${cls}`, "moving"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.notEqual(moving, plain, `${cls}: an unfaced moving instance has its own centre-facing art, not the plain sprite`);
    assert.ok(moving.includes(`${cls}-moving-fill`), `${cls}: the centre-facing moving template's own gradient id must render`);
    assert.ok(!moving.includes("{{"), `${cls}: no unresolved placeholder token may reach the output`);
  }
});

test("a facing fact with no pose still resolves the standing profile, never the moving frame", () => {
  for (const cls of FACING_CLASSES) {
    const standing = resolveSpriteAsset(cls, [], faces(`the-${cls}`, "left"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.equal(standing, facingVariantFor(cls, "left").svg.split("{{FACE}}").join(""), `${cls}: the standing profile is what an unposed instance gets`);
    assert.ok(!standing.includes("-moving-"), `${cls}: the moving frame must not leak into an unposed instance`);
  }
});

test("all three axes compose on the real files: the facing picks the frame, the pose picks the moving one, the mood wears it", () => {
  for (const cls of FACING_CLASSES) {
    const standing = resolveSpriteAsset(cls, [], faces(`the-${cls}`, "left"), REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    for (const word of EMOTION_WORDS) {
      const facts = [
        { subject: `the-${cls}`, predicate: FACING_PROPERTY, object: "left" },
        { subject: `the-${cls}`, predicate: POSE_PROPERTY, object: "moving" },
        { subject: `the-${cls}`, predicate: "mgx:feels", object: word },
      ];
      const svg = resolveSpriteAsset(cls, [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
      assert.ok(svg.includes(`${cls}-facing-left-moving-fill`), `${cls}/${word}: the moving frame's own art must be what renders`);
      assert.ok(svg.includes(EXPRESSION_PALETTE[word]), `${cls}/${word}: that mood's own fragment markup must appear`);
      assert.ok(!svg.includes("{{"), `${cls}/${word}: no unresolved placeholder token may reach the output`);
      assert.notEqual(svg, standing, `${cls}/${word}: the moving frame must differ from the standing profile`);
    }
  }
});

test("a mood on the moving frame is still never guessed: an unmapped word keeps the pose and drops the face", () => {
  for (const cls of FACING_CLASSES) {
    const facts = [
      { subject: `the-${cls}`, predicate: FACING_PROPERTY, object: "left" },
      { subject: `the-${cls}`, predicate: POSE_PROPERTY, object: "moving" },
      { subject: `the-${cls}`, predicate: "mgx:feels", object: "ecstatic" },
    ];
    const svg = resolveSpriteAsset(cls, [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
    assert.equal(svg, movingVariant(cls).svg.split("{{FACE}}").join(""), `${cls}: an unmapped mood renders exactly as the bare moving frame`);
  }
});

test("a half angle also carries its moods, so the turntable and the expressions cross at every named angle it ships", () => {
  for (const cls of FACING_CLASSES) {
    for (const angle of HALF_ANGLES) {
      for (const word of EMOTION_WORDS) {
        const facts = [
          { subject: `the-${cls}`, predicate: FACING_PROPERTY, object: angle },
          { subject: `the-${cls}`, predicate: "mgx:feels", object: word },
        ];
        const svg = resolveSpriteAsset(cls, [], facts, REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
        assert.ok(svg.includes(`${cls}-facing-${angle}-fill`), `${cls}/${angle}/${word}: the angle's own art must render`);
        assert.ok(svg.includes(EXPRESSION_PALETTE[word]), `${cls}/${angle}/${word}: that mood's own fragment must appear`);
      }
    }
  }
});

test("no two sprite-tier files share a gradient id, so one page can show every angle at once", () => {
  const declaredBy = new Map();
  const collisions = [];
  for (const t of REAL_LARGE_TEMPLATES) {
    for (const [, id] of String(t.svg).matchAll(/<(?:linear|radial)Gradient[^>]*\sid="([^"]+)"/g)) {
      if (declaredBy.has(id)) collisions.push(`${id} declared by both ${declaredBy.get(id)} and ${t.classes.join("/")}`);
      declaredBy.set(id, t.classes.join("/"));
    }
  }
  assert.deepEqual(collisions, [], collisions.join("\n"));
});

test("portrait-round, the one [match] variant carrying no parameters, resolves byte-for-byte as its own raw template", () => {
  const round = facingVariantFor("portrait", "left");
  assert.equal(round, undefined, "portrait has no facing variant — it matches on mgx:hasProperty instead");
  const variant = REAL_LARGE_TEMPLATES.find((t) => t.classes.includes("portrait") && t.match);
  assert.equal(variant.parameters, undefined, "portrait-round declares no parameters at all");
  const svg = resolveSpriteAsset("portrait", [], [{ subject: "the-portrait", predicate: "mgx:hasProperty", object: "round" }], REAL_LARGE_TEMPLATES, SPRITE_REGISTRY);
  assert.equal(svg, variant.svg, "a parameterless [match] variant is returned exactly as authored");
});
