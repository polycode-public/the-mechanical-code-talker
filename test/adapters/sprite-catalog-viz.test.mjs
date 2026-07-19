// sprite-catalog-viz: renderSpriteCatalogHtml is a pure string builder over
// the real template files plus a real rdfs:subClassOf fact set — these tests
// pin the page's structure and the pure derivation helpers it splices from
// (mirroring adventure-viz.test.mjs's/spider-fly-viz.test.mjs's own style),
// against the REAL data/sprites/ and data/sprites-large/ template files
// (readSpriteTemplateFiles/readSpriteLargeTemplateFiles, not a hand fixture)
// so a broken real template would fail here too. The ancestor-fact rows
// stay a small hand-built fixture (sprite-map.test.mjs's own isA() idiom) —
// loading the real wordnet-xl corpus slice is loadSpriteOntologyFactRows'
// own job, exercised at build time, not needed to prove this module's own
// logic is correct.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderSpriteCatalogHtml, buildSpriteCatalogEntries, groupForClass, paletteTreatmentFor,
  tierSwatchesFor, parameterVariantsFor, GROUP_ADVENTURE, GROUP_PERSON, GROUP_OBJECT, GROUP_EMOJI,
  PERSON_ROLE_CLASSES,
} from "../../src/services/sprite-catalog-viz.mjs";
import { readSpriteTemplateFiles } from "../../src/adapters/corpus/sprite-template-files.mjs";
import { readSpriteLargeTemplateFiles } from "../../src/adapters/corpus/sprite-large-template-files.mjs";
import { classAncestorChain, SPRITE_REGISTRY } from "../../src/domain/sprite-map.mjs";
import { MATERIAL_PALETTE } from "../../src/domain/sprite-materials.mjs";

const isA = (subject, object) => ({ subject, predicate: "rdfs:subClassOf", object });
const SEED_ROWS = [isA("poodle", "dog"), isA("dog", "animal"), isA("spider", "arachnid"), isA("arachnid", "animal")];

const iconTemplates = readSpriteTemplateFiles();
const largeTemplates = readSpriteLargeTemplateFiles();
const allClasses = [...new Set([...iconTemplates, ...largeTemplates].flatMap((t) => t.classes || []))];

test("buildSpriteCatalogEntries covers every real class either tier declares a template for", () => {
  const entries = buildSpriteCatalogEntries({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  const names = new Set(entries.map((e) => e.className));
  for (const cls of allClasses) assert.ok(names.has(cls), `${cls} is missing from the catalog`);
  assert.equal(entries.length, allClasses.length, "no class is catalogued twice");
});

test("renderSpriteCatalogHtml renders a card for every real class, with the real classes present in the DOM markup", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  for (const cls of allClasses.slice(0, 30)) {
    assert.match(html, new RegExp(`data-cls="${cls}"`), `${cls} has no card`);
  }
  assert.match(html, /data-cls="dog"/);
  assert.match(html, /data-cls="lamp"/);
  assert.match(html, /data-cls="anger"/);
});

test("no unresolved {{FILL}}/{{FACE}} placeholder token leaks into the rendered page", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.doesNotMatch(html, /\{\{FILL/, "an unfilled material placeholder reached the page");
  assert.doesNotMatch(html, /\{\{FACE/, "an unfilled expression placeholder reached the page");
});

test("the real ancestor chain (via classAncestorChain, never invented) is present as ontology-mapping text for a sample of classes", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  // poodle really does chain through dog to animal in this fixture — the page
  // must show the same real chain classAncestorChain itself returns.
  const poodleChain = classAncestorChain("poodle", SEED_ROWS);
  assert.deepEqual(poodleChain, ["poodle", "dog", "animal"]);
  assert.match(html, /data-cls="poodle"[\s\S]{0,400}chain-link own">poodle</);
  assert.match(html, /data-cls="poodle"[\s\S]{0,400}chain-link">dog</);
  // a class with no ancestor fact at all still shows its own name as the chain.
  const chairChain = classAncestorChain("chair", SEED_ROWS);
  assert.deepEqual(chairChain, ["chair"]);
});

test("renderSpriteCatalogHtml is pure — byte-identical output for identical input", () => {
  const a = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  const b = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.equal(a, b);
});

test("the footer's class/swatch counts match what was actually built", () => {
  const entries = buildSpriteCatalogEntries({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  const totalSwatches = entries.reduce((n, e) => n + e.iconSwatches.length + e.largeSwatches.length, 0);
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, new RegExp(`${entries.length} classes`));
  assert.match(html, new RegExp(`${totalSwatches} swatches`));
});

// ---- the "no misleading plain swatch" gotcha ----

const MATERIAL_ONLY_TEMPLATE = {
  classes: ["gizmo"],
  svg: '<svg viewBox="0 0 24 24"><rect fill="{{FILL}}"/></svg>',
  parameters: { material: { property: "mgx:madeOf", placeholder: "{{FILL}}", values: { wood: "#8a5a2e", metal: "#c9a24b" } } },
};

const PLAIN_TEMPLATE = { classes: ["widget"], svg: '<svg viewBox="0 0 24 24"><rect/></svg>' };

test("a class with no plain template (material-only) never gets a swatch mislabeled 'plain'", () => {
  const swatches = tierSwatchesFor("gizmo", [MATERIAL_ONLY_TEMPLATE], SPRITE_REGISTRY, "large");
  assert.ok(!swatches.some((s) => s.label === "plain"), "a material-only class must never show a 'plain' swatch");
  assert.deepEqual(swatches.map((s) => s.label).sort(), ["metal", "no material taught", "wood"].sort());
  const fallback = swatches.find((s) => s.kind === "fallback");
  assert.ok(fallback, "the honest no-material-taught fallback swatch is still shown, just not called plain");
  assert.ok(fallback.svg.startsWith("<svg"), "the fallback swatch is a real resolved svg, not a placeholder");
});

test("a class with a genuine plain template shows it labeled 'plain', with no synthetic fallback swatch alongside it", () => {
  const swatches = tierSwatchesFor("widget", [PLAIN_TEMPLATE], SPRITE_REGISTRY, "large");
  assert.deepEqual(swatches.map((s) => s.label), ["plain"]);
  assert.ok(!swatches.some((s) => s.kind === "fallback"));
});

test("real large-tier classes this catalog's own header names as material-only never show a 'plain' swatch", () => {
  // Cross-checked against the real templates, not the operator's own hand list
  // (which this module's own header notes was off by one — "cabinet" — versus
  // the programmatic check this test performs).
  for (const cls of ["lamp", "key", "letter", "container", "cabinet", "portrait"]) {
    const swatches = tierSwatchesFor(cls, largeTemplates, SPRITE_REGISTRY, "large");
    assert.ok(!swatches.some((s) => s.label === "plain"), `${cls} incorrectly shows a 'plain' swatch`);
    assert.ok(swatches.some((s) => s.kind === "fallback"), `${cls} is missing its honest no-material fallback swatch`);
  }
});

test("real large-tier classes with a genuine dedicated plain-fallback file do show it", () => {
  for (const cls of ["ring", "table", "train", "vehicle"]) {
    const swatches = tierSwatchesFor(cls, largeTemplates, SPRITE_REGISTRY, "large");
    assert.ok(swatches.some((s) => s.label === "plain"), `${cls} should show its real plain template`);
  }
});

// ---- material/treatment labeling ----

test("parameterVariantsFor reads every declared value straight off the template, never invents one", () => {
  const variants = parameterVariantsFor(MATERIAL_ONLY_TEMPLATE);
  assert.deepEqual(variants.map((v) => v.rawValue).sort(), ["metal", "wood"]);
  assert.ok(variants.every((v) => v.property === "mgx:madeOf"));
});

test("paletteTreatmentFor reverse-looks-up a MATERIAL_PALETTE triple, and returns null otherwise", () => {
  assert.equal(paletteTreatmentFor(MATERIAL_PALETTE.metal), "metal");
  assert.equal(paletteTreatmentFor(MATERIAL_PALETTE.ceramic), "ceramic");
  assert.equal(paletteTreatmentFor("#22201d"), null, "a plain colour string is not a palette treatment");
  assert.equal(paletteTreatmentFor({ light: "#000", base: "#000", dark: "#000" }), null, "an unrecognised triple matches no treatment");
});

test("a real lamp material variant's treatment is labeled from the real MATERIAL_PALETTE, gold and metal both folding to the metal treatment", () => {
  const entries = buildSpriteCatalogEntries({ iconTemplates: [], largeTemplates, factRows: [] });
  const lamp = entries.find((e) => e.className === "lamp");
  const byLabel = Object.fromEntries(lamp.largeSwatches.map((s) => [s.label, s.treatment]));
  assert.equal(byLabel.gold, "metal");
  assert.equal(byLabel.metal, "metal");
  assert.equal(byLabel.ceramic, "ceramic");
  assert.equal(byLabel.glass, "glass");
});

// ---- grouping ----

test("groupForClass: an icon-tier adventure prop (not a spider-fly creature, not 'person') lands in the adventure group", () => {
  assert.equal(groupForClass("cabinet", { isIconTierClass: true, isEmoji: false }), GROUP_ADVENTURE);
  assert.equal(groupForClass("butler", { isIconTierClass: true, isEmoji: false }), GROUP_ADVENTURE);
});

test("groupForClass: a spider-fly creature stays out of the adventure group even though it's icon-tier", () => {
  for (const cls of ["spider", "fly", "egg", "poodle", "dog", "animal"]) {
    assert.notEqual(groupForClass(cls, { isIconTierClass: true, isEmoji: false }), GROUP_ADVENTURE);
  }
});

test("groupForClass: 'person' stays out of the adventure group even though it's icon-tier — it lands in person roles", () => {
  assert.equal(groupForClass("person", { isIconTierClass: true, isEmoji: false }), GROUP_PERSON);
});

test("groupForClass: a curated person-role class lands in the person group regardless of tier", () => {
  assert.equal(groupForClass("king", { isIconTierClass: false, isEmoji: false }), GROUP_PERSON);
  assert.equal(groupForClass("crowd", { isIconTierClass: false, isEmoji: false }), GROUP_PERSON);
});

test("groupForClass: an emoji-fallback class always lands in the emoji group, even if it were also icon-tier or a person role", () => {
  assert.equal(groupForClass("king", { isIconTierClass: false, isEmoji: true }), GROUP_EMOJI);
  assert.equal(groupForClass("cabinet", { isIconTierClass: true, isEmoji: true }), GROUP_EMOJI);
});

test("groupForClass: anything named neither an adventure prop, a person role, nor emoji falls into the generic object/creature/place bucket", () => {
  assert.equal(groupForClass("elephant", { isIconTierClass: false, isEmoji: false }), GROUP_OBJECT);
  assert.equal(groupForClass("mountain", { isIconTierClass: false, isEmoji: false }), GROUP_OBJECT);
});

test("every real emoji-fallback class in the large tier (a <text> glyph in its resolved svg) is grouped as emoji, and PERSON_ROLE_CLASSES never collides with one", () => {
  const entries = buildSpriteCatalogEntries({ iconTemplates: [], largeTemplates, factRows: [] });
  const emojiClasses = entries.filter((e) => e.group === GROUP_EMOJI).map((e) => e.className);
  assert.ok(emojiClasses.includes("anger"));
  assert.ok(emojiClasses.includes("wedding"));
  for (const cls of emojiClasses) assert.ok(!PERSON_ROLE_CLASSES.includes(cls), `${cls} is listed as both a person role and an emoji class`);
});

test("PERSON_ROLE_CLASSES is a frozen, de-duplicated list", () => {
  assert.ok(Object.isFrozen(PERSON_ROLE_CLASSES));
  assert.equal(new Set(PERSON_ROLE_CLASSES).size, PERSON_ROLE_CLASSES.length);
});
