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
  renderSpriteCatalogHtml, renderSpriteCatalogLandingHtml, buildSpriteCatalogEntries, groupForClass,
  paletteTreatmentFor, tierSwatchesFor, parameterVariantsFor, extractSceneItems, GROUP_ADVENTURE,
  GROUP_PERSON, GROUP_OBJECT, GROUP_EMOJI, PERSON_ROLE_CLASSES, CYCLE_FRAME_DELAY_MS, FACING_TURN_ORDER,
  moodFrameSequence, turnFrameSequence, movingFrameSequence, displayModeSequence, DISPLAY_MODE_ORDER,
  CATALOG_GROUPS, groupIsClustered,
  catalogSections, LANDING_EXAMPLE_CLASSES, landingExampleFor, classAnchorId, sceneComposerClassIndex,
  loadSpriteOntologyFactRows, subClassIndex, buildOntologyTree, sectionSlugFor, ontologyTreeNodeId,
  ontologyNodeDescription, MAX_TREE_SIBLINGS_PER_PARENT,
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

// The real ontology facts (the same wordnet-xl-derived rows the demo site
// build itself loads) — needed only for the tests below that check which
// REAL classes land in which cluster/section, since the small hand-built
// SEED_ROWS fixture above has no ancestry for most of this catalog's own
// classes.
const realFactRows = await loadSpriteOntologyFactRows();
const realEntries = buildSpriteCatalogEntries({ iconTemplates, largeTemplates, factRows: realFactRows });
const realSpritedClasses = new Set([...iconTemplates, ...largeTemplates].flatMap((t) => t.classes || []));

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
  assert.match(html, /data-cls="poodle"[\s\S]{0,400}chain-link own"[^>]*>poodle</);
  assert.match(html, /data-cls="poodle"[\s\S]{0,400}chain-link"[^>]*>dog</);
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

// ---- direction variants and the cycle swatch ----

test("a class with facing variants renders a left and a right swatch, each a real [match] render distinct from the plain sprite", () => {
  const swatches = tierSwatchesFor("bear", largeTemplates, SPRITE_REGISTRY, "large");
  const left = swatches.find((s) => s.label === "left");
  const right = swatches.find((s) => s.label === "right");
  const plain = swatches.find((s) => s.label === "plain");
  assert.ok(left && right && plain, "bear shows plain, left and right swatches");
  assert.equal(left.property, "mgx:faces");
  assert.equal(right.property, "mgx:faces");
  assert.notEqual(left.svg, plain.svg);
  assert.notEqual(right.svg, left.svg);
});

test("a mood a match-free template already offers is listed once, so a facing variant carrying the same six moods never repeats them", () => {
  for (const cls of ["bear", "cat", "dog", "king"]) {
    const swatches = tierSwatchesFor(cls, largeTemplates, SPRITE_REGISTRY, "large");
    const labels = swatches.map((s) => s.label);
    assert.equal(new Set(labels).size, labels.length, `${cls}: every swatch label must be unique`);
    const rendered = swatches.map((s) => s.svg);
    assert.equal(new Set(rendered).size, rendered.length, `${cls}: every swatch must be a distinct render, so no gradient id is emitted twice`);
    const happy = swatches.filter((s) => s.label === "happy");
    assert.equal(happy.length, 1, `${cls}: exactly one happy swatch`);
    assert.ok(happy[0].svg.includes(`${cls}-with-emotion-fill`), `${cls}: the mood swatch comes from the front-facing template`);
  }
});

test("a facing variant's own parameter value is rendered with BOTH facts and labeled for the pair when no match-free template offers it", () => {
  const facingWithMood = {
    classes: ["gremlin"],
    svg: "<svg>left-profile{{FACE}}</svg>",
    match: { property: "mgx:faces", value: "left" },
    face: { cx: 7, cy: 9, scale: 3 },
    parameters: { emotion: { property: "mgx:feels", placeholder: "{{FACE}}", values: { happy: "HAPPY-FACE" } } },
  };
  const swatches = tierSwatchesFor("gremlin", [facingWithMood], SPRITE_REGISTRY, "large");
  const pair = swatches.find((s) => s.label === "left + happy");
  assert.ok(pair, `expected a "left + happy" swatch, saw: ${swatches.map((s) => s.label).join(", ")}`);
  assert.equal(pair.property, "mgx:feels");
  assert.equal(pair.svg, "<svg>left-profileHAPPY-FACE</svg>", "the profile art renders with the mood filled in, not the front view");
});

test("a swatch born from a property fact carries that property as a data attribute the page's cycle script can select on", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, /data-property="mgx:faces"/, "direction swatches are selectable by property");
  assert.match(html, /data-property="mgx:feels"/, "expression swatches are selectable by property");
  assert.doesNotMatch(html, /class="swatch large plain"[^>]*data-property/, "a plain swatch never claims a property");
});

test("the rendered page ships the animated-cell machinery: one property per axis, the stepper, and the reduced-motion guard", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, /MOOD_PROPERTY = "mgx:feels"/);
  assert.match(html, /FACING_PROPERTY = "mgx:faces"/);
  assert.match(html, /POSE_PROPERTY = "mgx:pose"/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /\.swatch\.cycle \.swatch-img/, "the cycle cell has its own styling");
  assert.match(html, /\.swatch\.cycle \.swatch-mode/, "the visible mode label has its own styling");
});

// ---- the three animated swatches: mood, facing, pose ----

const svgFrame = (label) => ({ svg: `<svg id="${label}"/>`, label });

test("the mood cycle leads with the plain sprite, then every mood in the order the templates declare them", () => {
  const frames = moodFrameSequence(svgFrame("person"), [svgFrame("happy"), svgFrame("sad"), svgFrame("calm")]);
  assert.deepEqual(frames.map((f) => f.label), ["person", "happy", "sad", "calm"]);
});

test("a single mood is a blink, not a cycle, so the mood swatch stays static below two moods", () => {
  assert.deepEqual(moodFrameSequence(svgFrame("person"), [svgFrame("happy")]), []);
  assert.deepEqual(moodFrameSequence(svgFrame("person"), []), []);
});

test("the facing sweep steps left to right through the turntable, with the undirected sprite as the centre frame", () => {
  const facings = Object.fromEntries(
    ["left", "half-left", "half-right", "right"].map((f) => [f, svgFrame(f)]),
  );
  const frames = turnFrameSequence(FACING_TURN_ORDER, svgFrame("plain"), facings);
  assert.deepEqual(frames.map((f) => f.label), ["left", "half-left", "centre", "half-right", "right"]);
  assert.equal(frames[2].svg, "<svg id=\"plain\"/>", "the centre frame is the class's own plain sprite");
});

test("the facing sweep skips a turntable angle the class has no sprite for, keeping the rest in order", () => {
  const frames = turnFrameSequence(FACING_TURN_ORDER, svgFrame("plain"), { left: svgFrame("left"), right: svgFrame("right") });
  assert.deepEqual(frames.map((f) => f.label), ["left", "centre", "right"]);
});

test("a class with one facing or none has nothing to sweep through", () => {
  assert.deepEqual(turnFrameSequence(FACING_TURN_ORDER, null, { left: svgFrame("left") }), []);
  assert.deepEqual(turnFrameSequence(FACING_TURN_ORDER, svgFrame("plain"), {}), []);
});

test("the pose toggle alternates the idle sprite with the moving one, and needs both to animate at all", () => {
  const frames = movingFrameSequence(svgFrame("plain"), svgFrame("moving"));
  assert.deepEqual(frames.map((f) => f.label), ["idle", "moving"]);
  assert.notEqual(frames[0].svg, frames[1].svg, "the two states are really different drawings");
  assert.deepEqual(movingFrameSequence(svgFrame("plain"), null), [], "no moving sprite, no toggle");
  assert.deepEqual(movingFrameSequence(null, svgFrame("moving")), [], "no idle sprite, no toggle");
});

/** The frame lists sprites.html's own inline script builds for one class,
 *  selected off real tierSwatchesFor output by the same properties and
 *  labels the page selects DOM swatches by, then flattened into the one
 *  click-through sequence its image cell walks. Keeps these tests honest
 *  about the real catalog rather than about a hand-built frame fixture. */
function pageCyclesFor(cls) {
  const swatches = tierSwatchesFor(cls, largeTemplates, SPRITE_REGISTRY, "large");
  const frameOf = (s) => ({ svg: s.svg, label: s.label });
  const base = swatches.find((s) => s.kind === "plain" || s.kind === "fallback");
  const baseFrame = base ? frameOf(base) : null;
  const moodFrames = swatches.filter((s) => s.property === "mgx:feels").map(frameOf);
  const facingFrames = {};
  for (const s of swatches) if (s.property === "mgx:faces") facingFrames[s.label] = frameOf(s);
  const movingSwatch = swatches.find((s) => s.property === "mgx:pose" && s.label === "moving");
  const mood = moodFrameSequence(baseFrame && { svg: baseFrame.svg, label: cls }, moodFrames);
  const turn = turnFrameSequence(FACING_TURN_ORDER, baseFrame, facingFrames);
  const moving = movingFrameSequence(baseFrame, movingSwatch && frameOf(movingSwatch));
  return {
    swatches,
    mood,
    turn,
    moving,
    modes: displayModeSequence(baseFrame && { svg: baseFrame.svg, label: cls }, {
      movingFrame: movingSwatch && frameOf(movingSwatch),
      turnFrames: turn,
      moodFrames: mood,
    }),
  };
}

test("a fully-turned real class sweeps all five turntable angles, the undirected sprite sitting centre", () => {
  for (const cls of ["writer", "king", "dog", "cat"]) {
    const { turn } = pageCyclesFor(cls);
    assert.deepEqual(turn.map((f) => f.label), ["left", "half-left", "centre", "half-right", "right"], `${cls} sweeps the full turntable`);
    assert.equal(new Set(turn.map((f) => f.svg)).size, 5, `${cls}: every angle is a distinct drawing, never the same art twice`);
  }
});

test("a real class's moving sprite toggles against its own idle one, both real renders", () => {
  for (const cls of ["writer", "king", "dog", "cat"]) {
    const { moving } = pageCyclesFor(cls);
    assert.deepEqual(moving.map((f) => f.label), ["idle", "moving"], `${cls} has both pose states`);
    assert.notEqual(moving[0].svg, moving[1].svg, `${cls}: the moving sprite is really different art from the idle one`);
    assert.ok(moving[1].svg.startsWith("<svg"), `${cls}: the moving frame is a real resolved sprite`);
  }
});

test("a combined facing-and-pose variant joins neither single-axis cycle, so each animation stays on one axis", () => {
  const { swatches, turn, moving, mood } = pageCyclesFor("writer");
  const combined = swatches.filter((s) => String(s.property).includes(" + "));
  assert.ok(combined.length, "writer really does carry combined facing+pose swatches, or this test proves nothing");
  const combinedLabels = new Set(combined.map((s) => s.label));
  for (const list of [turn, moving, mood]) {
    for (const f of list) assert.ok(!combinedLabels.has(f.label), `${f.label} is a combined variant and must not be a single-axis frame`);
  }
  assert.deepEqual(mood.map((f) => f.label), ["writer", "happy", "sad", "angry", "scared", "surprised", "calm"], "the mood cycle carries moods only, never a facing");
});

test("a class the catalog gives no facing or pose art animates nothing on those axes rather than faking a frame", () => {
  const { turn, moving, mood, modes } = pageCyclesFor("person");
  assert.deepEqual(turn, [], "no facing sprites, no sweep");
  assert.deepEqual(moving, [], "no moving sprite, no toggle");
  assert.equal(mood.length, 7, "its moods still cycle");
  assert.deepEqual([...new Set(modes.map((f) => f.mode))], ["static", "emotions"], "the cell offers only the modes there is art for");
});

// ---- the one image cell's display modes ----

test("displayModeSequence walks static, moving, turning then emotions, and the static sprite is never repeated as a mood frame", () => {
  const frames = displayModeSequence({ svg: "<svg id=\"plain\"/>", label: "bear" }, {
    movingFrame: svgFrame("moving"),
    turnFrames: [svgFrame("left"), { svg: "<svg id=\"plain\"/>", label: "centre" }, svgFrame("right")],
    moodFrames: [{ svg: "<svg id=\"plain\"/>", label: "bear" }, svgFrame("happy"), svgFrame("sad")],
  });
  assert.deepEqual(frames.map((f) => f.mode), ["static", "moving", "turning", "turning", "turning", "emotions", "emotions"]);
  assert.deepEqual(frames.map((f) => f.label), ["bear", "moving", "left", "centre", "right", "happy", "sad"]);
  assert.deepEqual([...new Set(frames.map((f) => f.mode))], DISPLAY_MODE_ORDER, "every mode in the declared order");
});

test("displayModeSequence keeps only the modes a class has real art for, static always leading", () => {
  const staticOnly = { svg: "<svg/>", label: "lamp" };
  assert.deepEqual(displayModeSequence(staticOnly, {}), [], "one frame is not a cycle, so the cell never appears");
  const moodOnly = displayModeSequence(staticOnly, { moodFrames: [staticOnly, svgFrame("happy"), svgFrame("calm")] });
  assert.deepEqual(moodOnly.map((f) => f.mode), ["static", "emotions", "emotions"]);
  const moveOnly = displayModeSequence(staticOnly, { movingFrame: svgFrame("moving") });
  assert.deepEqual(moveOnly.map((f) => [f.mode, f.label]), [["static", "lamp"], ["moving", "moving"]]);
  assert.deepEqual(displayModeSequence(null, { movingFrame: svgFrame("moving") }), [], "no resting frame, no cell");
});

test("a fully-illustrated real class offers all four display modes from one cell, its own name resting on top", () => {
  for (const cls of ["bear", "cat", "dog", "king"]) {
    const { modes } = pageCyclesFor(cls);
    assert.deepEqual([...new Set(modes.map((f) => f.mode))], DISPLAY_MODE_ORDER, `${cls} carries art for every mode`);
    assert.deepEqual(modes[0], { mode: "static", svg: modes[0].svg, label: cls }, `${cls} rests on its own plain sprite`);
    assert.equal(modes.filter((f) => f.mode === "moving").length, 1);
    assert.equal(modes.filter((f) => f.mode === "turning").length, 5, `${cls} sweeps the whole turntable`);
    assert.equal(modes.filter((f) => f.mode === "emotions").length, 6, `${cls} cycles its six curated moods`);
  }
});

test("a moving-pose template's swatch carries mgx:pose, the property the page's toggle selects it by", () => {
  const idle = { classes: ["walker"], svg: '<svg viewBox="0 0 24 24"><rect/></svg>' };
  const moving = { classes: ["walker"], match: { property: "mgx:pose", value: "moving" }, svg: '<svg viewBox="0 0 24 24"><rect x="1"/></svg>' };
  const swatches = tierSwatchesFor("walker", [idle, moving], SPRITE_REGISTRY, "large");
  const movingSwatch = swatches.find((s) => s.label === "moving");
  const plainSwatch = swatches.find((s) => s.label === "plain");
  assert.equal(movingSwatch.property, "mgx:pose");
  const frames = movingFrameSequence(
    { svg: plainSwatch.svg, label: plainSwatch.label },
    { svg: movingSwatch.svg, label: movingSwatch.label },
  );
  assert.deepEqual(frames.map((f) => f.label), ["idle", "moving"]);
  assert.notEqual(frames[0].svg, frames[1].svg);
});

test("every axis runs off one delay and one interval, so their tempos can never drift apart", () => {
  assert.equal(CYCLE_FRAME_DELAY_MS, 800, "the mood cycle's established tempo, now shared by every axis");
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, new RegExp(`const CYCLE_FRAME_DELAY_MS = ${CYCLE_FRAME_DELAY_MS};`));
  assert.equal((html.match(/setInterval\(/g) || []).length, 1, "one interval drives every animated cell on the page");
  assert.match(html, /\}, CYCLE_FRAME_DELAY_MS\)/, "the interval is fed the shared constant, never a second hard-coded number");
});

test("the page splices in the same frame-order functions this file tests, never a second copy written inline", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.ok(html.includes(moodFrameSequence.toString()), "the mood cycle's real ordering function reaches the page");
  assert.ok(html.includes(turnFrameSequence.toString()), "the facing sweep's real ordering function reaches the page");
  assert.ok(html.includes(movingFrameSequence.toString()), "the pose toggle's real ordering function reaches the page");
  assert.ok(html.includes(displayModeSequence.toString()), "the mode order this file tests is the one the page runs");
  assert.match(html, /const FACING_TURN_ORDER = \["left","half-left",null,"half-right","right"\]/);
});

test("the one animated cell takes the plain swatch's place, so the three separate cycles never come back as extra grid cells", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, /replaceChild\(makeModeCell\(modeFrames, cls\), baseSwatch\)/, "the cell stands where the plain swatch was");
  assert.doesNotMatch(html, /insertBefore\(makeCycleSwatch/, "no axis adds a cell of its own any more");
  assert.equal((html.match(/makeModeCell\(/g) || []).length, 2, "one cell factory, called from one place");
});

test("the hover preview and the auto-step are both off under reduced motion, and a click still steps a frame", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, /if \(!reducedMotion && movingIndex > 0\) \{[\s\S]{0,80}mouseenter/, "the hover preview is only wired when motion is allowed");
  assert.match(html, /if \(cycleSteppers\.length && !reducedMotion\)/, "the interval only starts when motion is allowed");
  assert.match(html, /frameImgEl\.addEventListener\("click", \(\) => \{[\s\S]{0,140}frameIndex = \(frameIndex \+ 1\) % frames\.length;/, "a click advances one frame whatever the motion setting");
});

// ---- the section ontology trees ----

const realIndex = subClassIndex(realFactRows);
const realEntriesByClass = new Map(realEntries.map((e) => [e.className, e]));
const realSections = catalogSections(realEntries, realSpritedClasses);
const sectionNamed = (groupId, label) => realSections.find((s) => s.group.id === groupId && s.label === label);
const treeFor = (section) => buildOntologyTree(section, {
  index: realIndex, spritedClasses: realSpritedClasses, entriesByClass: realEntriesByClass,
});
const allNodes = (tree) => [...tree.branches.flatMap((b) => b.levels.flat()), ...tree.apart];
const nodeNamed = (tree, term) => allNodes(tree).find((n) => n.term === term);

test("subClassIndex reads both directions off the rdfs:subClassOf rows and de-duplicates each list", () => {
  const { parentsOf, childrenOf } = subClassIndex([
    isA("poodle", "dog"), isA("poodle", "dog"), isA("beagle", "dog"), isA("dog", "animal"),
    { subject: "dog", predicate: "mgx:feels", object: "happy" },
  ]);
  assert.deepEqual(parentsOf.get("poodle"), ["dog"], "the repeated row is stored once");
  assert.deepEqual(childrenOf.get("dog").sort(), ["beagle", "poodle"]);
  assert.deepEqual(parentsOf.get("dog"), ["animal"]);
  assert.equal(parentsOf.has("happy"), false, "a row of another predicate contributes nothing");
});

test("a section's tree covers every term its cards' ancestry pills print, so no pill can point at a missing node", () => {
  for (const section of realSections) {
    const terms = new Set(allNodes(treeFor(section)).map((n) => n.term));
    for (const entry of section.entries) {
      for (const term of entry.chain.slice(0, 6)) {
        assert.ok(terms.has(term), `${section.label}: "${term}" is on a pill but has no tree node`);
      }
    }
  }
});

test("a class with two recorded parents keeps both, drawn as two chains meeting at the class", () => {
  const queen = nodeNamed(treeFor(sectionNamed("person", "everything else")), "queen");
  assert.deepEqual(queen.parents, ["insect", "woman"], "queen is on record as both, and neither is dropped");
  const fly = nodeNamed(treeFor(sectionNamed("object", "insect")), "fly");
  assert.ok(fly.parents.length > 1, `fly keeps every recorded parent, got ${fly.parents.join(", ")}`);
  assert.ok(fly.parents.includes("insect"));
});

test("a tree node sits one level below its deepest drawn parent, and the levels at each rung read alphabetically", () => {
  const tree = treeFor(sectionNamed("person", "worker"));
  for (const branch of tree.branches) {
    branch.levels.forEach((nodes, level) => {
      assert.deepEqual(nodes.map((n) => n.term), nodes.map((n) => n.term).slice().sort(), `level ${level} is alphabetical`);
      for (const node of nodes) {
        assert.equal(node.level, level);
        for (const parent of node.parents) {
          const parentNode = nodeNamed(tree, parent);
          assert.ok(parentNode.level < level, `${node.term} must sit below its parent ${parent}`);
        }
      }
    });
  }
  assert.equal(nodeNamed(tree, "person").level, 1, "person hangs under organism here");
  assert.equal(nodeNamed(tree, "driver").level, 4);
});

test("the biggest connected sub-graph leads, and a term connected to nothing else is set apart rather than faked into the graph", () => {
  const tree = treeFor(sectionNamed("object", "everything else"));
  const sizes = tree.branches.map((b) => b.size);
  assert.deepEqual(sizes, sizes.slice().sort((a, b) => b - a), "sub-graphs run biggest first");
  assert.ok(tree.apart.length, "the objects section really does carry classes that stand apart");
  for (const node of tree.apart) assert.deepEqual(node.parents, [], "a term standing apart draws no parent link");
  assert.deepEqual(tree.apart.map((n) => n.term), tree.apart.map((n) => n.term).slice().sort());
});

test("a tree names the section's own classes, their ancestors, and the other catalog classes sharing those ancestors", () => {
  const tree = treeFor(sectionNamed("object", "animal"));
  const byKind = (kind) => allNodes(tree).filter((n) => n.kind === kind).map((n) => n.term);
  assert.deepEqual(byKind("member").sort(), ["dog", "insect", "spider"], "the section's own classes are its members");
  assert.ok(byKind("ancestor").includes("organism"), "an abstract ancestor is drawn as its own node");
  const siblings = byKind("sibling");
  assert.ok(siblings.length, "the animal sub-graph really is shared with catalog classes from other sections");
  for (const term of siblings) {
    assert.ok(realEntriesByClass.has(term), `${term} is a real catalog class, never an invented sibling`);
  }
});

test("no ancestor recruits more than the capped number of siblings, so one crowded parent can't flood a tree", () => {
  for (const section of realSections) {
    const tree = treeFor(section);
    const siblingsPerParent = new Map();
    for (const node of allNodes(tree)) {
      if (node.kind !== "sibling") continue;
      for (const parent of node.parents) siblingsPerParent.set(parent, (siblingsPerParent.get(parent) || 0) + 1);
    }
    for (const [parent, count] of siblingsPerParent) {
      assert.ok(count <= MAX_TREE_SIBLINGS_PER_PARENT, `${section.label}: ${parent} drew ${count} siblings`);
    }
  }
});

test("a term with no sprite of its own carries a stand-in description written from its own place in the graph", () => {
  const tree = treeFor(sectionNamed("person", "worker"));
  const doer = nodeNamed(tree, "doer");
  assert.equal(doer.sprited, false, "doer is a real ancestor this catalog draws no art for");
  assert.equal(doer.description, "a kind of person. No sprite yet.");
  const person = nodeNamed(tree, "person");
  assert.equal(person.sprited, true, "a term that really has a template needs no stand-in");
  assert.equal(person.description, null);
  for (const node of allNodes(tree)) {
    assert.equal(node.sprited, node.description === null, `${node.term} must carry a description exactly when it has no sprite`);
  }
});

test("ontologyNodeDescription names at most two parents and says plainly when a term tops its branch", () => {
  assert.equal(ontologyNodeDescription("organism", []), "the widest concept this branch reaches. No sprite yet.");
  assert.equal(ontologyNodeDescription("queen", ["insect", "woman"]), "a kind of insect and woman. No sprite yet.");
  assert.equal(ontologyNodeDescription("fly", ["change", "hit", "insect"]), "a kind of change and hit. No sprite yet.");
});

test("buildOntologyTree is a pure function of the fact set — the same facts in a different order build the same tree", () => {
  const section = sectionNamed("object", "insect");
  const shuffled = realFactRows.slice().reverse();
  const forward = treeFor(section);
  const backward = buildOntologyTree(section, {
    index: subClassIndex(shuffled), spritedClasses: realSpritedClasses, entriesByClass: realEntriesByClass,
  });
  assert.deepEqual(backward, forward);
});

test("a subClassOf loop in the fact set lays out without spinning, and both recorded edges still show", () => {
  const looped = [isA("hen", "bird"), isA("bird", "hen"), isA("hen", "animal")];
  const section = { group: CATALOG_GROUPS[2], label: "loop", entries: [{ className: "hen", chain: ["hen", "bird", "animal"] }] };
  const tree = buildOntologyTree(section, {
    index: subClassIndex(looped), spritedClasses: new Set(), entriesByClass: new Map(),
  });
  const hen = nodeNamed(tree, "hen");
  assert.deepEqual(hen.parents, ["animal", "bird"], "both of hen's recorded parents are drawn");
  assert.deepEqual(nodeNamed(tree, "bird").parents, ["hen"], "the loop's other edge is drawn too");
});

test("sectionSlugFor keeps two sections with the same label apart by their own group", () => {
  const person = sectionSlugFor({ group: { id: GROUP_PERSON }, label: "everything else" });
  const object = sectionSlugFor({ group: { id: GROUP_OBJECT }, label: "everything else" });
  assert.equal(person, "person-everything-else");
  assert.equal(object, "object-everything-else");
  assert.notEqual(person, object);
  assert.equal(sectionSlugFor({ group: { id: GROUP_OBJECT }, label: "body of water" }), "object-body-of-water");
});

test("ontologyTreeNodeId builds one stable, slugified id per section and term", () => {
  assert.equal(ontologyTreeNodeId("object-animal", "dog"), "tree-object-animal-dog");
  assert.equal(ontologyTreeNodeId("object-everything-else", "body of water"), "tree-object-everything-else-body-of-water");
});

test("the landing page draws one tree per section, every node id distinct and every ancestry pill resolving to one", () => {
  const html = renderSpriteCatalogLandingHtml({ iconTemplates, largeTemplates, factRows: realFactRows });
  assert.equal((html.match(/class="ontology-head"/g) || []).length, realSections.length, "one tree per section");
  const ids = [...html.matchAll(/ id="(tree-[^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "every tree node id is unique on the page");
  const idSet = new Set(ids);
  const pillTargets = [...html.matchAll(/<a class="chain-link[^"]*" href="#([^"]+)"/g)].map((m) => m[1]);
  assert.ok(pillTargets.length, "the pills really are links now");
  for (const target of pillTargets) assert.ok(idSet.has(target), `the pill linking to #${target} points at no node`);
});

test("a term with no sprite renders an obvious placeholder slot carrying its own description, sprited terms render real art", () => {
  const html = renderSpriteCatalogLandingHtml({ iconTemplates, largeTemplates, factRows: realFactRows });
  assert.match(html, /id="tree-person-worker-doer"[^>]*><span class="tree-img-placeholder" role="img" aria-label="doer: a kind of person\. No sprite yet\.">a kind of person\. No sprite yet\.<\/span>/);
  assert.match(html, /id="tree-person-worker-person"[^>]*>\s*<span class="tree-img" role="img" aria-label="the person sprite"><svg/);
});

test("a group page draws no trees of its own and sends its ancestry pills to the landing page's node for that term", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: realFactRows, groupId: GROUP_OBJECT });
  assert.equal((html.match(/class="ontology-head"/g) || []).length, 0, "the trees all live on the landing page");
  assert.match(html, /<a class="chain-link own" href="\.\/sprites\.html#tree-object-animal-dog">dog<\/a>/);
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

// ---- the scene composer's free-text parser ----
//
// classIndex fixtures below are built the same way sceneComposerClassIndex
// does — real material/variant labels read off tierSwatchesFor's real
// output for the real large-tier templates, never a hand-typed color-word
// list. This is the same real-data posture the rest of this file already
// holds tierSwatchesFor/buildSpriteCatalogEntries to.

function realClassIndexFor(classNames) {
  const index = {};
  for (const cls of classNames) {
    const materials = {};
    for (const s of tierSwatchesFor(cls, largeTemplates, SPRITE_REGISTRY, "large")) {
      if (s.kind === "material" || s.kind === "variant") materials[String(s.label).toLowerCase()] = true;
    }
    index[cls] = { materials };
  }
  return index;
}

test("extractSceneItems finds every real class named in a sentence, in the order they appear, with no material modifier", () => {
  const classIndex = realClassIndexFor(["doctor", "hat", "cabinet"]);
  const items = extractSceneItems("a doctor with a hat, and a cabinet", classIndex);
  assert.deepEqual(items, [
    { className: "doctor", materialLabel: null },
    { className: "hat", materialLabel: null },
    { className: "cabinet", materialLabel: null },
  ]);
});

test("extractSceneItems honestly drops an unrecognized modifier word rather than inventing a material match — 'red lamp' draws a plain lamp", () => {
  const classIndex = realClassIndexFor(["lamp"]);
  assert.ok(!("red" in classIndex.lamp.materials), "the fixture's own real lamp materials never include 'red', or this test would prove nothing");
  const items = extractSceneItems("red lamp", classIndex);
  assert.deepEqual(items, [{ className: "lamp", materialLabel: null }]);
});

test("extractSceneItems matches a real taught-material word immediately before its class, keyed to that class's own real labels", () => {
  const classIndex = realClassIndexFor(["cabinet", "lamp"]);
  assert.deepEqual(extractSceneItems("wood cabinet", classIndex), [{ className: "cabinet", materialLabel: "wood" }]);
  assert.deepEqual(extractSceneItems("glass lamp", classIndex), [{ className: "lamp", materialLabel: "glass" }]);
});

test("extractSceneItems never lets a material word valid for one class leak onto a different class", () => {
  // "wood" is a real cabinet material but never a real lamp material — a
  // material match must stay keyed to the class it actually precedes.
  const classIndex = realClassIndexFor(["cabinet", "lamp"]);
  assert.ok(!("wood" in classIndex.lamp.materials));
  const items = extractSceneItems("wood lamp", classIndex);
  assert.deepEqual(items, [{ className: "lamp", materialLabel: null }]);
});

test("extractSceneItems returns nothing for a sentence naming no real class — the honest miss, never a crash", () => {
  const classIndex = realClassIndexFor(["doctor", "hat", "cabinet", "lamp"]);
  assert.deepEqual(extractSceneItems("xyzzy plugh", classIndex), []);
  assert.deepEqual(extractSceneItems("", classIndex), []);
  assert.deepEqual(extractSceneItems(undefined, classIndex), []);
});

test("extractSceneItems prefers a real multi-word class over a shorter class name it would otherwise fragment into", () => {
  // A hand-built fixture on purpose: this catalog carries no standalone
  // "water" class today to collide with "body of water" (checked directly),
  // so a same-catalog collision can't exercise this precedence rule. The
  // rule itself — longest real class name wins the position it starts at —
  // is still real product logic and needs its own coverage.
  const classIndex = { water: { materials: {} }, "body of water": { materials: {} } };
  const items = extractSceneItems("a wide body of water stretched out", classIndex);
  assert.deepEqual(items, [{ className: "body of water", materialLabel: null }]);
});

test("extractSceneItems: 'body of water' is a real catalog class, resolved whole from real text with no other class fragmenting it", () => {
  const classIndex = realClassIndexFor(["body of water"]);
  const items = extractSceneItems("the body of water was calm", classIndex);
  assert.deepEqual(items, [{ className: "body of water", materialLabel: null }]);
});

test("extractSceneItems repeats a class once per real occurrence in the text", () => {
  const classIndex = realClassIndexFor(["cat"]);
  const items = extractSceneItems("a cat, then another cat", classIndex);
  assert.deepEqual(items, [
    { className: "cat", materialLabel: null },
    { className: "cat", materialLabel: null },
  ]);
});

// ---- the demo site's multi-page split: CATALOG_GROUPS' own page field,
// section granularity, landing-page examples, and cross-page anchors ----

test("CATALOG_GROUPS: every group carries its own distinct, kebab-case page filename", () => {
  const pages = CATALOG_GROUPS.map((g) => g.page);
  assert.deepEqual(pages, [
    "sprites-adventure-props.html", "sprites-person-roles.html", "sprites-objects.html", "sprites-emotions.html",
  ]);
  assert.equal(new Set(pages).size, pages.length, "no two groups share a page filename");
});

test("groupIsClustered: only Person roles and Physical objects/creatures/places break into ancestor sections", () => {
  assert.equal(groupIsClustered(GROUP_PERSON), true);
  assert.equal(groupIsClustered(GROUP_OBJECT), true);
  assert.equal(groupIsClustered(GROUP_ADVENTURE), false);
  assert.equal(groupIsClustered(GROUP_EMOJI), false);
});

test("catalogSections breaks the real catalog into one section per top-level unclustered group plus one per ancestor cluster, covering every real entry exactly once", () => {
  const sections = catalogSections(realEntries, realSpritedClasses);
  const totalSectioned = sections.reduce((n, s) => n + s.entries.length, 0);
  assert.equal(totalSectioned, realEntries.length, "every real catalog entry lands in exactly one section");
  const adventureSections = sections.filter((s) => s.group.id === GROUP_ADVENTURE);
  const emojiSections = sections.filter((s) => s.group.id === GROUP_EMOJI);
  assert.equal(adventureSections.length, 1, "an unclustered group is one section");
  assert.equal(emojiSections.length, 1, "an unclustered group is one section");
  assert.ok(sections.filter((s) => s.group.id === GROUP_PERSON).length > 1, "Person roles really does break into more than one cluster");
  assert.ok(sections.filter((s) => s.group.id === GROUP_OBJECT).length > 1, "the object group really does break into more than one cluster");
});

test("every one of the operator's curated landing-page examples is a real member of exactly one of today's catalog sections", () => {
  const sections = catalogSections(realEntries, realSpritedClasses);
  for (const cls of LANDING_EXAMPLE_CLASSES) {
    const owners = sections.filter((s) => s.entries.some((e) => e.className === cls));
    assert.equal(owners.length, 1, `"${cls}" should be a real member of exactly one section, found in ${owners.length}`);
  }
});

test("landingExampleFor picks the curated favourite for each of today's real sections, in the operator's own given reading order", () => {
  const sections = catalogSections(realEntries, realSpritedClasses);
  const chosen = sections.map((s) => landingExampleFor(s.entries).className);
  assert.deepEqual(chosen, LANDING_EXAMPLE_CLASSES, "today's real section order names exactly the operator's curated list, in order");
});

test("landingExampleFor falls back to a section's own first entry when none of the curated names is a member", () => {
  const section = [{ className: "zzz-not-curated" }, { className: "aaa-not-curated" }];
  assert.equal(landingExampleFor(section).className, "zzz-not-curated", "falls back to the section's own existing order, not alphabetical");
  assert.equal(landingExampleFor([]), null);
  assert.equal(landingExampleFor(null), null);
});

test("classAnchorId slugifies a class name into a stable, lowercase DOM id, multi-word names included", () => {
  assert.equal(classAnchorId("cabinet"), "card-cabinet");
  assert.equal(classAnchorId("body of water"), "card-body-of-water");
  assert.equal(classAnchorId("King"), "card-king");
});

test("cardHtml gives every card a classAnchorId id, so a landing-page link can anchor straight to it", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, /id="card-dog"[^>]*data-cls="dog"/);
  assert.match(html, new RegExp(`id="${classAnchorId("lamp")}"[^>]*data-cls="lamp"`));
});

test("sceneComposerClassIndex reads defaultSvg/materials straight off largeSwatches, skipping a class with no large-tier swatch", () => {
  const entries = [
    { className: "widget", largeSwatches: [{ kind: "plain", label: "plain", svg: "<svg>plain</svg>" }], iconSwatches: [] },
    {
      className: "gizmo",
      largeSwatches: [
        { kind: "fallback", label: "no material taught", svg: "<svg>fallback</svg>" },
        { kind: "material", label: "Wood", svg: "<svg>wood</svg>" },
      ],
      iconSwatches: [],
    },
    { className: "icon-only", largeSwatches: [], iconSwatches: [{ kind: "plain", label: "plain", svg: "<svg>icon</svg>" }] },
  ];
  const index = sceneComposerClassIndex(entries);
  assert.deepEqual(Object.keys(index).sort(), ["gizmo", "widget"], "a class with no large-tier swatch contributes nothing");
  assert.equal(index.widget.defaultSvg, "<svg>plain</svg>");
  assert.equal(index.gizmo.defaultSvg, "<svg>fallback</svg>", "the fallback swatch stands in when there's no plain one");
  assert.equal(index.gizmo.materials.wood, "<svg>wood</svg>", "a material label is lowercased");
});

test("renderSpriteCatalogHtml with a real groupId renders only that group's full gallery, with cross-page nav and group-scoped footer counts", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS, spritesBundleAvailable: true, groupId: GROUP_PERSON });
  assert.match(html, /data-cls="doctor"/, "a real person-role class renders");
  assert.doesNotMatch(html, /data-cls="cabinet"/, "an adventure-group class does not render on the person page");
  assert.match(html, /href="\.\/sprites-adventure-props\.html"/, "the topbar links to a sibling group page, not an in-page anchor");
  assert.match(html, /href="\.\/sprites\.html">overview/, "the topbar links back to the landing page");
  const personEntries = buildSpriteCatalogEntries({ iconTemplates, largeTemplates, factRows: SEED_ROWS }).filter((e) => e.group === GROUP_PERSON);
  assert.match(html, new RegExp(`${personEntries.length} classes`), "the footer counts only this group's own classes, not the whole catalog");
});

test("a per-group page's embedded composer/dock data still covers the WHOLE catalog, not just this group's own classes", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS, spritesBundleAvailable: true, groupId: GROUP_PERSON });
  assert.match(html, /"cabinet"/, "the embedded scene-composer class index still carries a class from a different group");
  assert.match(html, /mgx:take-parameter|corpus:sprites/, "the dock's own fact rows are embedded regardless of which group renders");
});

test("renderSpriteCatalogLandingHtml shows exactly one example card per section, each linking to that class's own card on its group's full page", () => {
  const html = renderSpriteCatalogLandingHtml({ iconTemplates, largeTemplates, factRows: realFactRows, spritesBundleAvailable: true });
  const sections = catalogSections(realEntries, realSpritedClasses);
  assert.equal((html.match(/class="card"/g) || []).length, sections.length, "one card per section, not one per group and not the full gallery");
  assert.equal((html.match(/class="viewall"/g) || []).length, sections.length);
  assert.match(html, new RegExp(`href="\\./sprites-person-roles\\.html#${classAnchorId("king")}"`), "the 'man' cluster's own favourite links straight to its own card on the person-roles page");
  assert.match(html, new RegExp(`href="\\./sprites-objects\\.html#${classAnchorId("frog")}"`), "the object group's trailing 'everything else' cluster links to its own favourite's card");
  assert.doesNotMatch(html, /data-cls="doctor"/, "a class that isn't one of the curated examples has no card on the landing page");
});

test("the landing page's embedded composer/dock data still covers the WHOLE catalog even though only one class per section has a card", () => {
  const html = renderSpriteCatalogLandingHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS, spritesBundleAvailable: true });
  assert.match(html, /"doctor"/, "doctor has no card on the landing page but still resolves through the embedded class index");
  assert.match(html, /"cabinet"/);
});
