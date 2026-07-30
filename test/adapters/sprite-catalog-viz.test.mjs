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
  tierSwatchesFor, parameterVariantsFor, extractSceneItems, GROUP_ADVENTURE, GROUP_PERSON,
  GROUP_OBJECT, GROUP_EMOJI, PERSON_ROLE_CLASSES, CYCLE_FRAME_DELAY_MS, FACING_TURN_ORDER,
  moodFrameSequence, turnFrameSequence, movingFrameSequence,
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

test("the rendered page ships the animated-swatch machinery: one property per axis, the stepper, and the reduced-motion guard", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, /MOOD_PROPERTY = "mgx:feels"/);
  assert.match(html, /FACING_PROPERTY = "mgx:faces"/);
  assert.match(html, /POSE_PROPERTY = "mgx:pose"/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /\.swatch\.cycle \.swatch-img/, "the cycle swatch has its own styling");
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

/** The three frame lists sprites.html's own inline script builds for one
 *  class, selected off real tierSwatchesFor output by the same properties
 *  and labels the page selects DOM swatches by. Keeps these tests honest
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
  return {
    swatches,
    mood: moodFrameSequence(baseFrame && { svg: baseFrame.svg, label: cls }, moodFrames),
    turn: turnFrameSequence(FACING_TURN_ORDER, baseFrame, facingFrames),
    moving: movingFrameSequence(baseFrame, movingSwatch && frameOf(movingSwatch)),
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
  const { turn, moving, mood } = pageCyclesFor("person");
  assert.deepEqual(turn, [], "no facing sprites, no sweep");
  assert.deepEqual(moving, [], "no moving sprite, no toggle");
  assert.equal(mood.length, 7, "its moods still cycle");
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

test("all three animated swatches run off one delay and one interval, so their tempos can never drift apart", () => {
  assert.equal(CYCLE_FRAME_DELAY_MS, 800, "the mood cycle's established tempo, now shared by the sweep and the toggle");
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, new RegExp(`const CYCLE_FRAME_DELAY_MS = ${CYCLE_FRAME_DELAY_MS};`));
  assert.equal((html.match(/setInterval\(/g) || []).length, 1, "one interval drives every animated swatch on the page");
  assert.match(html, /\}, CYCLE_FRAME_DELAY_MS\)/, "the interval is fed the shared constant, never a second hard-coded number");
});

test("the page splices in the same frame-order functions this file tests, never a second copy written inline", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.ok(html.includes(moodFrameSequence.toString()), "the mood cycle's real ordering function reaches the page");
  assert.ok(html.includes(turnFrameSequence.toString()), "the facing sweep's real ordering function reaches the page");
  assert.ok(html.includes(movingFrameSequence.toString()), "the pose toggle's real ordering function reaches the page");
  assert.match(html, /const FACING_TURN_ORDER = \["left","half-left",null,"half-right","right"\]/);
});

test("the facing sweep takes the plain swatch's place and the pose toggle takes happy's, so neither adds a grid cell", () => {
  const html = renderSpriteCatalogHtml({ iconTemplates, largeTemplates, factRows: SEED_ROWS });
  assert.match(html, /replaceChild\(makeCycleSwatch\(turnFrames[\s\S]{0,120}baseSwatch\)/, "the sweep replaces the plain swatch");
  assert.match(html, /replaceChild\(makeCycleSwatch\(movingFrames[\s\S]{0,120}\(happyRow \|\| movingRow\)\.el\)/, "the toggle replaces the happy swatch");
  assert.match(html, /insertBefore\(makeCycleSwatch\(moodFrames[\s\S]{0,120}swatchRow\.firstChild\)/, "the mood cycle still leads the row");
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
// classIndex fixtures below are built the same way sprites.html's own
// client-side buildClassIndexFromDom does — real material/variant labels
// read off tierSwatchesFor's real output for the real large-tier templates,
// never a hand-typed color-word list. This is the same real-data posture
// the rest of this file already holds tierSwatchesFor/buildSpriteCatalogEntries
// to.

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
