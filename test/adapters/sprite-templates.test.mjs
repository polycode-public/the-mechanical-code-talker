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
