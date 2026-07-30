// spriteFactRows walks the parsed sprite template sets into OWL-shaped fact
// rows. These tests hold it to the resolver's own never-guess posture: every
// emitted subject/predicate/object must trace back to a real entry in the
// template data it was handed — a class list, a [parameters.<name>] table, a
// values map key, a [match] value — never a minted term.
import test from "node:test";
import assert from "node:assert/strict";
import {
  spriteFactRows, spriteSubjectFor, spriteFactGraphPayload, isSpriteAcceptPredicate, SPRITE_PREDICATES,
} from "../../src/domain/sprite-facts.mjs";
import { matchConstraints } from "../../src/domain/sprite-templates.mjs";
import { readSpriteTemplateFiles } from "../../src/adapters/corpus/sprite-template-files.mjs";
import { readSpriteLargeTemplateFiles } from "../../src/adapters/corpus/sprite-large-template-files.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask } from "../../src/domain/ask.mjs";

const iconTemplates = readSpriteTemplateFiles();
const largeTemplates = readSpriteLargeTemplateFiles();
const rows = spriteFactRows({ iconTemplates, largeTemplates });

const classesOf = (t) => (Array.isArray(t?.classes) ? t.classes : []);
const classSet = (templates) => new Set(templates.flatMap(classesOf));
const iconClasses = classSet(iconTemplates);
const largeClasses = classSet(largeTemplates);
const allClasses = new Set([...iconClasses, ...largeClasses]);
const allTemplates = [...iconTemplates, ...largeTemplates];

/** The catalog class a "<class> sprite" subject names, or null when the
 *  subject is not that shape. */
function classOfSubject(subject) {
  const m = /^(.+) sprite$/.exec(subject);
  return m ? m[1] : null;
}

test("every emitted fact traces to a real template entry — no minted terms", () => {
  assert.ok(rows.length > 0, "the real template sets produce rows");
  const problems = [];
  for (const row of rows) {
    const { subject, predicate, object } = row;
    const cls = classOfSubject(subject);
    const templatesForCls = cls ? allTemplates.filter((t) => classesOf(t).includes(cls)) : [];
    const acceptMatch = /^mgx:accept-(.+)$/.exec(predicate);

    if (predicate === "rdf:type" && object === "sprite class") {
      if (!cls || !allClasses.has(cls)) problems.push(`${subject} typed as a sprite class but "${cls}" is in no template's classes list`);
    } else if (predicate === "rdf:type" && object === "sprite parameter") {
      const declared = allTemplates.some((t) => Object.hasOwn(t?.parameters || {}, subject));
      if (!declared) problems.push(`${subject} typed as a sprite parameter but no template declares [parameters.${subject}]`);
    } else if (predicate === "mgx:render-at") {
      const tierClasses = object === "icon tier" ? iconClasses : object === "sprite tier" ? largeClasses : null;
      if (!tierClasses) problems.push(`${subject} renders at unknown tier "${object}"`);
      else if (!cls || !tierClasses.has(cls)) problems.push(`${subject} claims the ${object} but "${cls}" has no template there`);
    } else if (predicate === "mgx:take-parameter") {
      const declared = templatesForCls.some((t) => Object.hasOwn(t?.parameters || {}, object));
      if (!declared) problems.push(`${subject} takes parameter "${object}" but no ${cls} template declares it`);
    } else if (acceptMatch) {
      const param = acceptMatch[1];
      const declared = templatesForCls.some((t) => Object.hasOwn(t?.parameters?.[param]?.values || {}, object));
      if (!declared) problems.push(`${subject} accepts ${param} "${object}" but no ${cls} template's values map carries it`);
    } else if (predicate === "mgx:offer-variant") {
      const declared = templatesForCls.some((t) => matchConstraints(t).some((c) => String(c.value) === object));
      if (!declared) problems.push(`${subject} offers variant "${object}" but no ${cls} template's [match] requires it`);
    } else {
      problems.push(`${subject} ${predicate} ${object}: predicate outside the generator's own closed vocabulary`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("the walk is deterministic and duplicate-free for the same template sets", () => {
  const again = spriteFactRows({ iconTemplates, largeTemplates });
  assert.deepEqual(again, rows);
  const keys = rows.map((r) => `${r.subject} ${r.predicate} ${r.object}`);
  assert.equal(new Set(keys).size, keys.length, "no row is emitted twice");
});

test("the person sprite's emotion parameter and its six values come through", () => {
  const subject = spriteSubjectFor("person");
  assert.ok(rows.some((r) => r.subject === subject && r.predicate === "rdf:type" && r.object === "sprite class"));
  assert.ok(rows.some((r) => r.subject === subject && r.predicate === "mgx:take-parameter" && r.object === "emotion"));
  const values = rows.filter((r) => r.subject === subject && r.predicate === "mgx:accept-emotion").map((r) => r.object);
  assert.deepEqual(values.sort(), ["angry", "calm", "happy", "sad", "scared", "surprised"]);
});

test("a hand-authored [match] variant emits its own offer-variant row", () => {
  assert.ok(rows.some((r) => r.subject === spriteSubjectFor("portrait") && r.predicate === "mgx:offer-variant" && r.object === "round"));
});

test("a variant requiring two facts at once stands behind both of them, one offer-variant row each", () => {
  const large = [{
    classes: ["dot"],
    svg: "<svg/>",
    match: [
      { property: "mgx:faces", value: "left" },
      { property: "mgx:pose", value: "moving" },
    ],
  }];
  const offered = spriteFactRows({ largeTemplates: large })
    .filter((r) => r.predicate === "mgx:offer-variant")
    .map((r) => r.object);
  assert.deepEqual(offered, ["left", "moving"]);
});

test("the sprite tier's own turntable angles and pose reach the fact rows for every class that draws them", () => {
  for (const cls of ["bear", "cat", "dog", "king"]) {
    const offered = rows
      .filter((r) => r.subject === spriteSubjectFor(cls) && r.predicate === "mgx:offer-variant")
      .map((r) => r.object)
      .sort();
    assert.deepEqual(offered, ["half-left", "half-right", "left", "moving", "right"], `${cls}: every angle it draws, plus the pose, is on record`);
  }
});

test("a class present at both tiers carries both render-at rows; an icon-only shape carries one", () => {
  const cabinet = rows.filter((r) => r.subject === spriteSubjectFor("cabinet") && r.predicate === "mgx:render-at").map((r) => r.object);
  assert.deepEqual(cabinet.sort(), ["icon tier", "sprite tier"]);
});

test("synthetic templates walk into exactly the expected row set", () => {
  const icon = [{ classes: ["dot"], svg: "<svg/>" }];
  const large = [{
    classes: ["dot"],
    svg: "<svg>{{FILL}}</svg>",
    parameters: { material: { property: "mgx:madeOf", placeholder: "{{FILL}}", values: { wood: "#a52" } } },
  }, {
    classes: ["dot"],
    svg: "<svg/>",
    match: { property: "mgx:hasProperty", value: "round" },
  }];
  assert.deepEqual(spriteFactRows({ iconTemplates: icon, largeTemplates: large }), [
    { subject: "dot sprite", predicate: "rdf:type", object: "sprite class" },
    { subject: "dot sprite", predicate: "mgx:render-at", object: "icon tier" },
    { subject: "dot sprite", predicate: "mgx:render-at", object: "sprite tier" },
    { subject: "dot sprite", predicate: "mgx:take-parameter", object: "material" },
    { subject: "dot sprite", predicate: "mgx:accept-material", object: "wood" },
    { subject: "dot sprite", predicate: "mgx:offer-variant", object: "round" },
    { subject: "material", predicate: "rdf:type", object: "sprite parameter" },
  ]);
});

test("empty template sets produce no rows at all", () => {
  assert.deepEqual(spriteFactRows({}), []);
  assert.deepEqual(spriteFactRows(), []);
});

test("isSpriteAcceptPredicate matches only a real mgx:accept-<name> tail", () => {
  assert.ok(isSpriteAcceptPredicate("mgx:accept-emotion"));
  assert.ok(isSpriteAcceptPredicate("mgx:accept-material"));
  assert.ok(!isSpriteAcceptPredicate("mgx:accept-"));
  assert.ok(!isSpriteAcceptPredicate("mgx:take-parameter"));
  assert.ok(!isSpriteAcceptPredicate(null));
});

test("spriteFactGraphPayload: synthetic rows project into individuals classed for a generic list/count query, plus the raw predicate edges", () => {
  const icon = [{ classes: ["dot"], svg: "<svg/>" }];
  const large = [{
    classes: ["dot"],
    svg: "<svg>{{FILL}}</svg>",
    parameters: { material: { property: "mgx:madeOf", placeholder: "{{FILL}}", values: { wood: "#a52" } } },
  }, {
    classes: ["dot"],
    svg: "<svg/>",
    match: { property: "mgx:hasProperty", value: "round" },
  }];
  const rows = spriteFactRows({ iconTemplates: icon, largeTemplates: large });
  const payload = spriteFactGraphPayload(rows);

  assert.deepEqual(
    [...payload.individuals].sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "dot sprite", label: "dot sprite", class: "sprite" },
      { id: "material", label: "material", class: "parameter" },
      { id: "wood", label: "wood", class: "material" },
    ],
  );

  const byPredicate = Object.fromEntries(payload.objectProperties.map((g) => [g.predicate, g.examples]));
  assert.deepEqual(byPredicate["mgx:take-parameter"], [{ subject: "dot sprite", object: "material" }]);
  assert.deepEqual(byPredicate["mgx:accept-material"], [{ subject: "dot sprite", object: "wood" }]);
  assert.deepEqual(byPredicate["mgx:offer-variant"], [{ subject: "dot sprite", object: "round" }]);
  // Every group key is either a fixed SPRITE_PREDICATES entry or a real
  // mgx:accept-<name> tail — never the rdf:type bookkeeping rows.
  for (const predicate of Object.keys(byPredicate)) {
    assert.ok(SPRITE_PREDICATES.includes(predicate) || isSpriteAcceptPredicate(predicate), predicate);
  }
});

test("spriteFactGraphPayload: an empty row set projects into an empty graph", () => {
  assert.deepEqual(spriteFactGraphPayload([]), { individuals: [], objectProperties: [] });
  assert.deepEqual(spriteFactGraphPayload(), { individuals: [], objectProperties: [] });
});

test("tmct.ask over the real catalog's projected graph answers a sprite's accepted emotions and parameters honestly", () => {
  const graph = parseEntities(spriteFactGraphPayload(rows));

  // A direct, generic (no new vocabulary) listing question over the catalog's
  // own mgx:accept-emotion rows — the same dynamicClassQuery capability
  // ask-memory-class-query.test.mjs already holds a memory graph's classes to.
  const emotions = ask(graph, "list emotions");
  assert.equal(emotions.tmct_ask.miss, false);
  const declaredEmotionValues = new Set(rows.filter((r) => r.predicate === "mgx:accept-emotion").map((r) => r.object));
  for (const value of declaredEmotionValues) assert.ok(emotions.content.includes(value), value);

  const parameterCount = ask(graph, "how many parameters are there");
  assert.equal(parameterCount.tmct_ask.miss, false);
  const declaredParameterNames = new Set(rows.filter((r) => r.predicate === "mgx:take-parameter").map((r) => r.object));
  assert.match(parameterCount.content, new RegExp(`^${declaredParameterNames.size}\\b`));

  // A class this graph carries no individual for honestly misses rather than
  // fabricating an answer, the same standard worldRelationGraphPayload holds.
  assert.equal(ask(graph, "list variants").tmct_ask.miss, true);
});
