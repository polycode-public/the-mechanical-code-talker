// sprite-expressions: the shared face-fragment palette and the pure by-name
// expansion that lets a sprite-large/*-with-emotion.toml file reference an
// emotion word instead of hand-copying its eyes-and-mouth markup, mirroring
// sprite-materials.test.mjs's own shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPRESSION_PALETTE, expandExpressionReferences } from "../../src/domain/sprite-expressions.mjs";

test("the palette carries exactly the 6 curated mgx:feels words", () => {
  assert.deepEqual(
    Object.keys(EXPRESSION_PALETTE).sort(),
    ["angry", "calm", "happy", "sad", "scared", "surprised"],
  );
});

test("every fragment is real, non-empty svg markup with no unresolved placeholder token", () => {
  for (const [name, fragment] of Object.entries(EXPRESSION_PALETTE)) {
    assert.match(fragment, /<(circle|path|ellipse)/, `${name}: expected real SVG shape markup`);
    assert.ok(!fragment.includes("{{"), `${name}: a palette fragment must never carry a placeholder token`);
  }
});

test("no two of the six fragments are byte-identical — each emotion reads as its own drawing", () => {
  const fragments = Object.values(EXPRESSION_PALETTE);
  const unique = new Set(fragments);
  assert.equal(unique.size, fragments.length);
});

test("expandExpressionReferences turns a by-name emotion word into a positioned <g> fragment for a template with a [face] anchor", () => {
  const templates = [{
    classes: ["dog"],
    svg: "<svg>{{FACE}}</svg>",
    face: { cx: 7, cy: 9, scale: 3.6 },
    parameters: {
      emotion: {
        property: "mgx:feels",
        placeholder: "{{FACE}}",
        values: { happy: "happy", sad: "sad" },
      },
    },
  }];
  const [expanded] = expandExpressionReferences(templates);
  assert.equal(expanded.parameters.emotion.values.happy, `<g transform="translate(7 9) scale(3.6)">${EXPRESSION_PALETTE.happy}</g>`);
  assert.equal(expanded.parameters.emotion.values.sad, `<g transform="translate(7 9) scale(3.6)">${EXPRESSION_PALETTE.sad}</g>`);
});

test("expandExpressionReferences leaves a template with no [face] table unexpanded — never guesses an anchor", () => {
  const templates = [{
    classes: ["dog"],
    svg: "<svg>{{FACE}}</svg>",
    parameters: { emotion: { property: "mgx:feels", placeholder: "{{FACE}}", values: { happy: "happy" } } },
  }];
  const [expanded] = expandExpressionReferences(templates);
  assert.equal(expanded.parameters.emotion.values.happy, "happy");
});

test("expandExpressionReferences leaves a template with no [parameters.emotion] table at all untouched", () => {
  const templates = [{ classes: ["egg"], svg: "<svg></svg>" }];
  assert.deepEqual(expandExpressionReferences(templates), templates);
});

test("expandExpressionReferences leaves an unknown emotion word as the plain string it was — never a guessed face", () => {
  const templates = [{
    classes: ["dog"],
    svg: "<svg>{{FACE}}</svg>",
    face: { cx: 7, cy: 9, scale: 3.6 },
    parameters: { emotion: { property: "mgx:feels", placeholder: "{{FACE}}", values: { mystery: "smug" } } },
  }];
  const [expanded] = expandExpressionReferences(templates);
  assert.equal(expanded.parameters.emotion.values.mystery, "smug");
});

test("expandExpressionReferences never touches a differently-named parameter table, even one shaped like an emotion table", () => {
  const templates = [{
    classes: ["lamp"],
    svg: "<svg>{{FILL}}</svg>",
    face: { cx: 12, cy: 12, scale: 2 },
    parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { happy: "happy" } } },
  }];
  const [expanded] = expandExpressionReferences(templates);
  assert.equal(expanded.parameters.colour.values.happy, "happy", "only a table whose property is mgx:feels is this module's own to expand");
});
