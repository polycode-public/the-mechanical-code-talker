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
