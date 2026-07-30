// sprite-templates: the property-aware resolver layered on sprite-map.mjs's
// ancestor walk. The first block exercises the specificity order with small
// hand-built fixtures; the second loads the REAL data/sprites/ directory and
// checks every file this task added is internally consistent and resolves
// the Ashcombe Hall objects it names to their own specific sprite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSpriteAsset, spriteTemplateProblems } from "../../src/domain/sprite-templates.mjs";
import { readSpriteTemplateFiles } from "../../src/adapters/corpus/sprite-template-files.mjs";
import { SPRITE_REGISTRY } from "../../src/domain/sprite-map.mjs";

const isA = (subject, object) => ({ subject, predicate: "rdfs:subClassOf", object });
const hasProperty = (subject, object) => ({ subject, predicate: "mgx:hasProperty", object });

const PLAIN_REGISTRY = Object.freeze({ animal: "<svg>animal-root</svg>" });

// ---- specificity order, hand-built fixtures --------------------------------

test("a plain class template wins over the flat spriteRegistry entry for the same class", () => {
  const templates = [{ classes: ["dog"], svg: "<svg>dog-template</svg>" }];
  const registry = Object.freeze({ ...PLAIN_REGISTRY, dog: "<svg>dog-registry</svg>" });
  assert.equal(resolveSpriteAsset("dog", [], [], templates, registry), "<svg>dog-template</svg>");
});

test("a class with no template at all falls back to the flat spriteRegistry entry — byte-identical to the old resolver", () => {
  const registry = Object.freeze({ ...PLAIN_REGISTRY, dog: "<svg>dog-registry</svg>" });
  assert.equal(resolveSpriteAsset("dog", [], [], [], registry), "<svg>dog-registry</svg>");
});

test("a parameterized template fills in from an observed matching property value", () => {
  const templates = [{
    classes: ["dog"],
    svg: "<svg>{{FILL}}</svg>",
    parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: "#22201d" } } },
  }];
  const svg = resolveSpriteAsset("dog", [], [hasProperty("rex", "black")], templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>#22201d</svg>");
});

test("a property value with no entry in the template's values map is never a match — falls through to the plain class template", () => {
  const templates = [
    { classes: ["dog"], svg: "<svg>dog-plain</svg>" },
    {
      classes: ["dog"],
      svg: "<svg>{{FILL}}</svg>",
      parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: "#22201d" } } },
    },
  ];
  const svg = resolveSpriteAsset("dog", [], [hasProperty("rex", "brown")], templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>dog-plain</svg>", "brown has no mapped substitution, so this is never a guessed fill");
});

test("no property fact at all resolves to the plain class template, not the parameterized one", () => {
  const templates = [
    { classes: ["dog"], svg: "<svg>dog-plain</svg>" },
    {
      classes: ["dog"],
      svg: "<svg>{{FILL}}</svg>",
      parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: "#22201d" } } },
    },
  ];
  assert.equal(resolveSpriteAsset("dog", [], [], templates, PLAIN_REGISTRY), "<svg>dog-plain</svg>");
});

test("a fully-specific [match] variant outranks a parameterized template filled with the same observed value", () => {
  const templates = [
    { classes: ["dog"], svg: "<svg>dog-plain</svg>" },
    {
      classes: ["dog"],
      svg: "<svg>{{FILL}}</svg>",
      parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: "#22201d" } } },
    },
    { classes: ["dog"], svg: "<svg>dog-black-hand-authored</svg>", match: { property: "mgx:hasProperty", value: "black" } },
  ];
  const svg = resolveSpriteAsset("dog", [], [hasProperty("rex", "black")], templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>dog-black-hand-authored</svg>");
});

test("an unsatisfied [match] never applies — falls through to the parameterized template instead", () => {
  const templates = [
    {
      classes: ["dog"],
      svg: "<svg>{{FILL}}</svg>",
      parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { white: "#f5f2ea" } } },
    },
    { classes: ["dog"], svg: "<svg>dog-black-hand-authored</svg>", match: { property: "mgx:hasProperty", value: "black" } },
  ];
  const svg = resolveSpriteAsset("dog", [], [hasProperty("rex", "white")], templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>#f5f2ea</svg>");
});

test("class-specialization and property-parameterization compose: sheepdog IsA dog walks the ancestor chain and still resolves the filled template", () => {
  const templates = [{
    classes: ["dog"],
    svg: "<svg>{{FILL}}</svg>",
    parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: "#22201d" } } },
  }];
  const rows = [isA("sheepdog", "dog")];
  const svg = resolveSpriteAsset("sheepdog", rows, [hasProperty("fido", "black")], templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>#22201d</svg>");
});

test("walking past a class with no template of its own still reaches a template two ancestors up", () => {
  const templates = [{ classes: ["animal"], svg: "<svg>animal-template</svg>" }];
  const rows = [isA("sheepdog", "dog"), isA("dog", "animal")];
  assert.equal(resolveSpriteAsset("sheepdog", rows, [], templates, PLAIN_REGISTRY), "<svg>animal-template</svg>");
});

test("the chain exhausted with no template match at any level falls back to spriteRegistry's own root entry", () => {
  assert.equal(resolveSpriteAsset("wombat", [], [], [], PLAIN_REGISTRY), PLAIN_REGISTRY.animal);
});

test("rootFallback itself can carry a template, checked with the same specificity order as any other term", () => {
  const templates = [{ classes: ["animal"], svg: "<svg>animal-template</svg>" }];
  assert.equal(resolveSpriteAsset("wombat", [], [], templates, PLAIN_REGISTRY), "<svg>animal-template</svg>");
});

// ---- spriteTemplateProblems: internal-consistency checks -------------------

test("spriteTemplateProblems accepts a well-formed plain template", () => {
  assert.deepEqual(spriteTemplateProblems({ classes: ["dog"], svg: "<svg></svg>" }), []);
});

test("spriteTemplateProblems flags a missing/empty classes list", () => {
  assert.ok(spriteTemplateProblems({ svg: "<svg></svg>" }).length > 0);
  assert.ok(spriteTemplateProblems({ classes: [], svg: "<svg></svg>" }).length > 0);
});

test("spriteTemplateProblems flags an svg that isn't real markup", () => {
  assert.ok(spriteTemplateProblems({ classes: ["dog"], svg: "not svg" }).length > 0);
});

test("spriteTemplateProblems flags a parameters table with an empty values map", () => {
  const problems = spriteTemplateProblems({
    classes: ["dog"], svg: "<svg>{{FILL}}</svg>",
    parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: {} } },
  });
  assert.ok(problems.some((p) => p.includes("values is empty")));
});

test("spriteTemplateProblems flags a placeholder token absent from its own svg", () => {
  const problems = spriteTemplateProblems({
    classes: ["dog"], svg: "<svg>no placeholder here</svg>",
    parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: "#000" } } },
  });
  assert.ok(problems.some((p) => p.includes("does not appear in svg")));
});

test("spriteTemplateProblems flags a match table missing property or value", () => {
  assert.ok(spriteTemplateProblems({ classes: ["dog"], svg: "<svg></svg>", match: { property: "mgx:hasProperty" } }).length > 0);
  assert.ok(spriteTemplateProblems({ classes: ["dog"], svg: "<svg></svg>", match: { value: "black" } }).length > 0);
});

// ---- [face] and [parameters.emotion] must always be declared together ----

const FACE_TABLE = { cx: 7, cy: 9, scale: 3.6 };
const EMOTION_PARAM = { property: "mgx:feels", placeholder: "{{FACE}}", values: { happy: "<g/>" } };

test("spriteTemplateProblems accepts a template declaring both face and parameters.emotion", () => {
  assert.deepEqual(
    spriteTemplateProblems({ classes: ["dog"], svg: "<svg>{{FACE}}</svg>", face: FACE_TABLE, parameters: { emotion: EMOTION_PARAM } }),
    [],
  );
});

test("spriteTemplateProblems accepts a template declaring neither face nor parameters.emotion", () => {
  assert.deepEqual(spriteTemplateProblems({ classes: ["dog"], svg: "<svg></svg>" }), []);
});

test("spriteTemplateProblems flags a face table declared with no parameters.emotion to select it", () => {
  const problems = spriteTemplateProblems({ classes: ["dog"], svg: "<svg></svg>", face: FACE_TABLE });
  assert.ok(problems.some((p) => p.includes("face is declared without parameters.emotion")));
});

test("spriteTemplateProblems flags a parameters.emotion table declared with no face to anchor it", () => {
  const problems = spriteTemplateProblems({ classes: ["dog"], svg: "<svg>{{FACE}}</svg>", parameters: { emotion: EMOTION_PARAM } });
  assert.ok(problems.some((p) => p.includes("parameters.emotion is declared without a face")));
});

// ---- multi-placeholder parameters (the sprite tier's gradient shading) ----

const GRADIENT_SVG =
  "<svg><stop stop-color=\"{{FILL_LIGHT}}\"/><stop stop-color=\"{{FILL}}\"/><stop stop-color=\"{{FILL_DARK}}\"/></svg>";
const GOLD_TRIPLE = { light: "#f0dfa0", base: "#c9a24b", dark: "#8a6a1e" };

test("a multi-placeholder parameter fills every named token from the matching value's sub-keys", () => {
  const templates = [{
    classes: ["lamp"],
    svg: GRADIENT_SVG,
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { gold: GOLD_TRIPLE },
      },
    },
  }];
  const madeOf = (subject, object) => ({ subject, predicate: "mgx:madeOf", object });
  const svg = resolveSpriteAsset("lamp", [], [madeOf("lamp-1", "gold")], templates, PLAIN_REGISTRY);
  assert.equal(svg, `<svg><stop stop-color="${GOLD_TRIPLE.light}"/><stop stop-color="${GOLD_TRIPLE.base}"/><stop stop-color="${GOLD_TRIPLE.dark}"/></svg>`);
});

test("a multi-placeholder value missing one of the declared sub-keys is never a partial match — falls through to the plain template", () => {
  const templates = [
    { classes: ["lamp"], svg: "<svg>lamp-plain</svg>" },
    {
      classes: ["lamp"],
      svg: GRADIENT_SVG,
      parameters: {
        material: {
          property: "mgx:madeOf",
          placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
          values: { gold: { light: "#f0dfa0", base: "#c9a24b" } }, // no "dark"
        },
      },
    },
  ];
  const facts = [{ subject: "lamp-1", predicate: "mgx:madeOf", object: "gold" }];
  const svg = resolveSpriteAsset("lamp", [], facts, templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>lamp-plain</svg>", "an incomplete triple must never render a partially-filled gradient");
});

test("spriteTemplateProblems accepts a well-formed multi-placeholder parameter", () => {
  assert.deepEqual(
    spriteTemplateProblems({
      classes: ["lamp"],
      svg: GRADIENT_SVG,
      parameters: {
        material: {
          property: "mgx:madeOf",
          placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
          values: { gold: GOLD_TRIPLE },
        },
      },
    }),
    [],
  );
});

test("spriteTemplateProblems flags a parameter that sets both placeholder and placeholders", () => {
  const problems = spriteTemplateProblems({
    classes: ["lamp"],
    svg: GRADIENT_SVG,
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholder: "{{FILL}}",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { gold: GOLD_TRIPLE },
      },
    },
  });
  assert.ok(problems.some((p) => p.includes("sets both placeholder and placeholders")));
});

test("spriteTemplateProblems flags a placeholders token absent from its own svg", () => {
  const problems = spriteTemplateProblems({
    classes: ["lamp"],
    svg: "<svg>{{FILL_LIGHT}}{{FILL}}</svg>",
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { gold: GOLD_TRIPLE },
      },
    },
  });
  assert.ok(problems.some((p) => p.includes("placeholders.dark") && p.includes("does not appear in svg")));
});

test("spriteTemplateProblems flags a values entry that is a plain string under a placeholders (plural) parameter — an unresolved material reference", () => {
  const problems = spriteTemplateProblems({
    classes: ["lamp"],
    svg: GRADIENT_SVG,
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { gold: "metal" },
      },
    },
  });
  assert.ok(problems.some((p) => p.includes("unresolved material reference")));
});

test("spriteTemplateProblems flags a values entry missing a declared sub-key", () => {
  const problems = spriteTemplateProblems({
    classes: ["lamp"],
    svg: GRADIENT_SVG,
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { gold: { light: "#f0dfa0", base: "#c9a24b" } },
      },
    },
  });
  assert.ok(problems.some((p) => p.includes('values.gold is missing "dark"')));
});

test("spriteTemplateProblems flags a single-placeholder parameter whose values entry is not a plain string", () => {
  const problems = spriteTemplateProblems({
    classes: ["dog"], svg: "<svg>{{FILL}}</svg>",
    parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: { light: "#000" } } } },
  });
  assert.ok(problems.some((p) => p.includes("must be a plain string for a single-placeholder parameter")));
});

// ---- two parameter tables on the same template (parameterizedFillAll) -----
// the composition fix B.2.2 exists for: a template declaring both
// [parameters.material] and [parameters.emotion] fills whichever of the
// two an instance's own facts actually match, accumulating onto the same
// running svg rather than stopping at the first dimension.

const DUAL_SVG = "<svg>{{FILL}}{{FACE}}</svg>";
const dualTemplate = () => ({
  classes: ["lamp"],
  svg: DUAL_SVG,
  parameters: {
    colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { gold: "GOLD" } },
    emotion: { property: "mgx:feels", placeholder: "{{FACE}}", values: { happy: "HAPPY-FACE" } },
  },
});

test("a template with two parameter tables fills BOTH when both facts are present", () => {
  const facts = [
    { subject: "lamp-1", predicate: "mgx:hasProperty", object: "gold" },
    { subject: "lamp-1", predicate: "mgx:feels", object: "happy" },
  ];
  const svg = resolveSpriteAsset("lamp", [], facts, [dualTemplate()], PLAIN_REGISTRY);
  assert.equal(svg, "<svg>GOLDHAPPY-FACE</svg>");
});

test("a template with two parameter tables fills only the one dimension whose fact is present, leaving the other's placeholder untouched", () => {
  const colourOnly = [{ subject: "lamp-1", predicate: "mgx:hasProperty", object: "gold" }];
  const svgColourOnly = resolveSpriteAsset("lamp", [], colourOnly, [dualTemplate()], PLAIN_REGISTRY);
  assert.equal(svgColourOnly, "<svg>GOLD{{FACE}}</svg>");

  const emotionOnly = [{ subject: "lamp-1", predicate: "mgx:feels", object: "happy" }];
  const svgEmotionOnly = resolveSpriteAsset("lamp", [], emotionOnly, [dualTemplate()], PLAIN_REGISTRY);
  assert.equal(svgEmotionOnly, "<svg>{{FILL}}HAPPY-FACE</svg>");
});

test("specificity order still holds with two parameters present: a [match] variant still outranks the dual-parameter fill", () => {
  const templates = [
    dualTemplate(),
    { classes: ["lamp"], svg: "<svg>lamp-hand-authored</svg>", match: { property: "mgx:hasProperty", value: "gold" } },
  ];
  const facts = [
    { subject: "lamp-1", predicate: "mgx:hasProperty", object: "gold" },
    { subject: "lamp-1", predicate: "mgx:feels", object: "happy" },
  ];
  const svg = resolveSpriteAsset("lamp", [], facts, templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>lamp-hand-authored</svg>");
});

test("specificity order still holds with two parameters present: no fact at all for either dimension falls through to the plain template", () => {
  const templates = [{ classes: ["lamp"], svg: "<svg>lamp-plain</svg>" }, dualTemplate()];
  assert.equal(resolveSpriteAsset("lamp", [], [], templates, PLAIN_REGISTRY), "<svg>lamp-plain</svg>");
});

// ---- a [match] variant may carry its own [parameters.*] too ----------------
// (the facing pairs: a satisfied [match] picks the profile art, and the
// instance's OTHER facts then fill that same variant's placeholders, so one
// sprite can be both turned left and visibly happy)

const faces = (subject, object) => ({ subject, predicate: "mgx:faces", object });
const feels = (subject, object) => ({ subject, predicate: "mgx:feels", object });

const facingVariant = () => ({
  classes: ["bear"],
  svg: "<svg>left-profile{{FACE}}</svg>",
  match: { property: "mgx:faces", value: "left" },
  face: { cx: 7.2, cy: 8.25, scale: 3 },
  parameters: { emotion: { property: "mgx:feels", placeholder: "{{FACE}}", values: { happy: "HAPPY-FACE", sad: "SAD-FACE" } } },
});
const frontEmotionTemplate = () => ({
  classes: ["bear"],
  svg: "<svg>front-view{{FACE}}</svg>",
  face: { cx: 12, cy: 9, scale: 5 },
  parameters: { emotion: { property: "mgx:feels", placeholder: "{{FACE}}", values: { happy: "HAPPY-FACE", sad: "SAD-FACE" } } },
});
const PLAIN_BEAR = { classes: ["bear"], svg: "<svg>bear-plain</svg>" };

test("a [match] variant that also declares [parameters.emotion] fills that parameter from the instance's own second fact", () => {
  const templates = [PLAIN_BEAR, facingVariant()];
  const facts = [faces("the-bear", "left"), feels("the-bear", "happy")];
  assert.equal(resolveSpriteAsset("bear", [], facts, templates, PLAIN_REGISTRY), "<svg>left-profileHAPPY-FACE</svg>");
});

test("each mood word fills the same [match] variant with its own substitution", () => {
  const templates = [PLAIN_BEAR, facingVariant()];
  const sad = [faces("the-bear", "left"), feels("the-bear", "sad")];
  assert.equal(resolveSpriteAsset("bear", [], sad, templates, PLAIN_REGISTRY), "<svg>left-profileSAD-FACE</svg>");
});

test("a [match] variant selected on its match alone drops the placeholder nothing filled, never leaking the raw token", () => {
  const templates = [PLAIN_BEAR, facingVariant()];
  const svg = resolveSpriteAsset("bear", [], [faces("the-bear", "left")], templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>left-profile</svg>");
});

test("a satisfied [match] holds even when its own parameter finds nothing to fill — the profile art never falls through to the plain template", () => {
  const templates = [PLAIN_BEAR, facingVariant()];
  const facts = [faces("the-bear", "left"), feels("the-bear", "ecstatic")];
  const svg = resolveSpriteAsset("bear", [], facts, templates, PLAIN_REGISTRY);
  assert.equal(svg, "<svg>left-profile</svg>", "an unmapped mood is never a guessed face, and never costs the instance the pose it asked for");
});

test("a [match] variant outranks a sibling parameterized template that would fill the same fact", () => {
  const templates = [PLAIN_BEAR, frontEmotionTemplate(), facingVariant()];
  const facts = [faces("the-bear", "left"), feels("the-bear", "happy")];
  assert.equal(resolveSpriteAsset("bear", [], facts, templates, PLAIN_REGISTRY), "<svg>left-profileHAPPY-FACE</svg>");
});

test("an emotion fact with no facing fact still reaches the parameterized front view, not the profile variant", () => {
  const templates = [PLAIN_BEAR, frontEmotionTemplate(), facingVariant()];
  assert.equal(
    resolveSpriteAsset("bear", [], [feels("the-bear", "happy")], templates, PLAIN_REGISTRY),
    "<svg>front-viewHAPPY-FACE</svg>",
  );
});

test("a [match] variant declaring no parameters at all is still returned byte-for-byte, whatever other facts the instance carries", () => {
  const templates = [
    PLAIN_BEAR,
    { classes: ["bear"], svg: "<svg>left-profile-no-face</svg>", match: { property: "mgx:faces", value: "left" } },
  ];
  const facts = [faces("the-bear", "left"), feels("the-bear", "happy"), hasProperty("the-bear", "black")];
  assert.equal(resolveSpriteAsset("bear", [], facts, templates, PLAIN_REGISTRY), "<svg>left-profile-no-face</svg>");
});

test("spriteTemplateProblems flags a [match] variant whose face has no parameters.emotion to select it", () => {
  const problems = spriteTemplateProblems({
    classes: ["bear"], svg: "<svg>left-profile</svg>",
    match: { property: "mgx:faces", value: "left" },
    face: FACE_TABLE,
  });
  assert.ok(problems.some((p) => p.includes("face is declared without parameters.emotion")));
});

test("spriteTemplateProblems flags a [match] variant whose parameters.emotion has no face to anchor it", () => {
  const problems = spriteTemplateProblems({
    classes: ["bear"], svg: "<svg>left-profile{{FACE}}</svg>",
    match: { property: "mgx:faces", value: "left" },
    parameters: { emotion: EMOTION_PARAM },
  });
  assert.ok(problems.some((p) => p.includes("parameters.emotion is declared without a face")));
});

test("spriteTemplateProblems accepts a well-formed [match] + face + parameters.emotion variant", () => {
  assert.deepEqual(spriteTemplateProblems(facingVariant()), []);
});

test("spriteTemplateProblems still catches a missing placeholder token on a [match] variant", () => {
  const problems = spriteTemplateProblems({ ...facingVariant(), svg: "<svg>left-profile</svg>" });
  assert.ok(problems.some((p) => p.includes("does not appear in svg")));
});

// ---- the icon tier and the sprite tier resolve independently ---------------
// (never confused for each other even though both can carry templates for
// the same class name, e.g. "lamp") — the two are selected by which
// template SET the caller searches, not by class name collision.

test("an icon-tier template set and a sprite-tier template set for the same class never collide", () => {
  const iconTemplates = [{ classes: ["lamp"], svg: "<svg>icon-lamp</svg>" }];
  const largeTemplates = [{ classes: ["lamp"], svg: "<svg>large-lamp</svg>" }];
  assert.equal(resolveSpriteAsset("lamp", [], [], iconTemplates, PLAIN_REGISTRY), "<svg>icon-lamp</svg>");
  assert.equal(resolveSpriteAsset("lamp", [], [], largeTemplates, PLAIN_REGISTRY), "<svg>large-lamp</svg>");
});

// ---- instanceKey: two differently-valued instances of the SAME template ---
// on the same page never collide on a shared gradient id (svg-instance-ids.mjs).

test("with no instanceKey, resolveSpriteAsset returns the svg exactly as before (byte-for-byte, id untouched)", () => {
  const templates = [{ classes: ["lamp"], svg: '<svg><defs><linearGradient id="lamp-fill"/></defs></svg>' }];
  assert.equal(resolveSpriteAsset("lamp", [], [], templates, PLAIN_REGISTRY), templates[0].svg);
});

test("instanceKey namespaces the resolved svg's own gradient id so two instances of the same template never collide", () => {
  const templates = [{
    classes: ["lamp"],
    svg: '<svg><defs><linearGradient id="lamp-fill"><stop stop-color="{{FILL}}"/></linearGradient></defs><path fill="url(#lamp-fill)"/></svg>',
    parameters: { material: { property: "mgx:madeOf", placeholder: "{{FILL}}", values: { gold: "#c9a24b", ceramic: "#e6e1d8" } } },
  }];
  const goldSvg = resolveSpriteAsset("lamp", [], [{ subject: "lamp-a", predicate: "mgx:madeOf", object: "gold" }], templates, PLAIN_REGISTRY, { instanceKey: "lamp-a" });
  const ceramicSvg = resolveSpriteAsset("lamp", [], [{ subject: "lamp-b", predicate: "mgx:madeOf", object: "ceramic" }], templates, PLAIN_REGISTRY, { instanceKey: "lamp-b" });
  assert.ok(goldSvg.includes('id="lamp-fill-lamp-a"') && goldSvg.includes("#c9a24b"));
  assert.ok(ceramicSvg.includes('id="lamp-fill-lamp-b"') && ceramicSvg.includes("#e6e1d8"));
  assert.notEqual(goldSvg, ceramicSvg);
});

// ---- against the REAL loaded data/sprites/ directory -----------------------

const REAL_TEMPLATES = readSpriteTemplateFiles();

test("readSpriteTemplateFiles loads every real sprite template file, at least the set this task added", () => {
  assert.ok(REAL_TEMPLATES.length >= 23, `expected at least 23 templates, got ${REAL_TEMPLATES.length}`);
});

test("every real sprite template is internally consistent", () => {
  for (const t of REAL_TEMPLATES) {
    const problems = spriteTemplateProblems(t);
    assert.deepEqual(problems, [], `${JSON.stringify(t.classes)}: ${problems.join("; ")}`);
  }
});

test("dog-with-colour is a real parameterized template mapping at least black and white", () => {
  const t = REAL_TEMPLATES.find((x) => x.classes.includes("dog") && x.parameters);
  assert.ok(t, "dog-with-colour.toml not found among the loaded templates");
  const values = t.parameters.colour.values;
  assert.ok("black" in values && "white" in values);
});

// The operator's own worked example, run end to end against the REAL shipped
// dog.toml/dog-with-colour.toml pair (not hand-built stand-ins): class-
// specialization (sheepdog IsA dog) and property-parameterization
// (mgx:hasProperty black) compose, and an absent/unmapped property never
// invents a color.
test("real dog.toml + dog-with-colour.toml: a dog taught black resolves to the filled template", () => {
  const svg = resolveSpriteAsset("dog", [], [hasProperty("rex", "black")], REAL_TEMPLATES, SPRITE_REGISTRY);
  const plain = REAL_TEMPLATES.find((t) => t.classes.includes("dog") && !t.parameters);
  assert.notEqual(svg, plain.svg, "a taught black dog must not render as the plain dog sprite");
  assert.ok(svg.includes("#22201d"), "the observed black value is substituted into the real template");
});

test("real dog.toml + dog-with-colour.toml: a dog with no colour property resolves to the plain dog sprite", () => {
  const svg = resolveSpriteAsset("dog", [], [], REAL_TEMPLATES, SPRITE_REGISTRY);
  const plain = REAL_TEMPLATES.find((t) => t.classes.includes("dog") && !t.parameters);
  assert.equal(svg, plain.svg);
});

test("real dog.toml + dog-with-colour.toml: a sheepdog (IsA dog) taught black still resolves through the ancestor walk to the same filled template", () => {
  const rows = [isA("sheepdog", "dog")];
  const asDog = resolveSpriteAsset("dog", [], [hasProperty("rex", "black")], REAL_TEMPLATES, SPRITE_REGISTRY);
  const asSheepdog = resolveSpriteAsset("sheepdog", rows, [hasProperty("fido", "black")], REAL_TEMPLATES, SPRITE_REGISTRY);
  assert.equal(asSheepdog, asDog, "class-specialization and property-parameterization compose to the identical rendered sprite");
});

// Ashcombe Hall's own shipped object/NPC facts (corpus/worlds/src/ashcombe-hall.jsonl) —
// each of these subjects gets its OWN sprite template this pass, not the
// generic furniture/portable/person fallback. `classAncestorChain`'s BFS
// starts at the subject's own name directly (no ancestor walk needed: each
// is registered by its own name).
for (const subject of ["cabinet", "desk", "portrait", "lamp", "key", "letter", "butler", "housekeeper", "cook", "gardener"]) {
  test(`${subject} resolves to its own dedicated sprite template, not a class-level fallback`, () => {
    const svg = resolveSpriteAsset(subject, [], [], REAL_TEMPLATES, SPRITE_REGISTRY);
    const own = REAL_TEMPLATES.find((t) => t.classes.includes(subject));
    assert.ok(own, `no template registered for ${subject}`);
    assert.equal(svg, own.svg);
    for (const fallbackClass of ["furniture", "portable", "person", "container"]) {
      if (fallbackClass === subject) continue;
      const fallbackTemplate = REAL_TEMPLATES.find((t) => t.classes.includes(fallbackClass));
      if (fallbackTemplate) assert.notEqual(svg, fallbackTemplate.svg, `${subject} must not render as the generic ${fallbackClass} sprite`);
    }
  });
}
