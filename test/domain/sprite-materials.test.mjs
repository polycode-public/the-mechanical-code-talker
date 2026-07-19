// sprite-materials: the shared {light, base, dark} treatment palette and the
// pure by-name expansion that lets a sprite-large/*.toml file reference a
// treatment instead of hand-copying its hex triple.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MATERIAL_PALETTE, expandMaterialReferences } from "../../src/domain/sprite-materials.mjs";

test("the palette carries exactly the 8 blessed rendering treatments", () => {
  assert.deepEqual(
    Object.keys(MATERIAL_PALETTE).sort(),
    ["ceramic", "glass", "metal", "paper", "plastic", "wax", "wood", "woven material"],
  );
});

test("every treatment is a complete {light, base, dark} hex triple", () => {
  for (const [name, triple] of Object.entries(MATERIAL_PALETTE)) {
    for (const key of ["light", "base", "dark"]) {
      assert.match(triple[key], /^#[0-9a-f]{6}$/i, `${name}.${key} must be a hex colour`);
    }
  }
});

test("expandMaterialReferences turns a by-name string into its full triple for a placeholders (plural) parameter", () => {
  const templates = [{
    classes: ["lamp"],
    svg: "<svg></svg>",
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { gold: "metal", metal: "metal" },
      },
    },
  }];
  const [expanded] = expandMaterialReferences(templates);
  assert.deepEqual(expanded.parameters.material.values.gold, MATERIAL_PALETTE.metal);
  assert.deepEqual(expanded.parameters.material.values.metal, MATERIAL_PALETTE.metal);
});

test("expandMaterialReferences leaves a single-placeholder parameter's string values alone", () => {
  const templates = [{
    classes: ["dog"],
    svg: "<svg>{{FILL}}</svg>",
    parameters: { colour: { property: "mgx:hasProperty", placeholder: "{{FILL}}", values: { black: "#22201d" } } },
  }];
  const [expanded] = expandMaterialReferences(templates);
  assert.equal(expanded.parameters.colour.values.black, "#22201d");
});

test("expandMaterialReferences leaves an already-expanded (one-off, hand-authored) triple untouched", () => {
  const oneOff = { light: "#111111", base: "#222222", dark: "#333333" };
  const templates = [{
    classes: ["lamp"],
    svg: "<svg></svg>",
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { bespoke: oneOff },
      },
    },
  }];
  const [expanded] = expandMaterialReferences(templates);
  assert.deepEqual(expanded.parameters.material.values.bespoke, oneOff);
});

test("expandMaterialReferences leaves an unknown treatment name as the plain string it was — never a guessed colour", () => {
  const templates = [{
    classes: ["lamp"],
    svg: "<svg></svg>",
    parameters: {
      material: {
        property: "mgx:madeOf",
        placeholders: { light: "{{FILL_LIGHT}}", base: "{{FILL}}", dark: "{{FILL_DARK}}" },
        values: { mystery: "unobtainium" },
      },
    },
  }];
  const [expanded] = expandMaterialReferences(templates);
  assert.equal(expanded.parameters.material.values.mystery, "unobtainium");
});

test("expandMaterialReferences passes through a template with no parameters at all", () => {
  const templates = [{ classes: ["egg"], svg: "<svg></svg>" }];
  assert.deepEqual(expandMaterialReferences(templates), templates);
});
