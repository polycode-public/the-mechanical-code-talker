// sprite-request.mjs — one sprite request resolved to markup plus the chain
// that found it. The chain is derived by asking the REAL resolver about one
// term at a time, so these tests pin that the chain agrees with the full
// resolution rather than describing a second, drifting one.
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveSpriteRequest } from "../../src/domain/sprite-request.mjs";
import { resolveSpriteAsset } from "../../src/domain/sprite-templates.mjs";
import { classAncestorChain, SPRITE_REGISTRY } from "../../src/domain/sprite-map.mjs";
import { sizeScaleFor } from "../../src/domain/sprite-size.mjs";
import { EXPRESSION_PALETTE } from "../../src/domain/sprite-expressions.mjs";
import { readSpriteLargeTemplateFiles } from "../../src/adapters/corpus/sprite-large-template-files.mjs";

const TEMPLATES = readSpriteLargeTemplateFiles();

const deps = (over = {}) => ({
  factRows: [],
  templates: TEMPLATES,
  spriteRegistry: SPRITE_REGISTRY,
  resolveSpriteAsset,
  classAncestorChain,
  sizeScaleFor,
  expressionPalette: EXPRESSION_PALETTE,
  ...over,
});

test("a class with its own emotion template resolves at hop 0, and says which template it matched", () => {
  const r = resolveSpriteRequest({ class: "spider", expression: "happy" }, deps());
  assert.equal(r.matched.term, "spider");
  assert.equal(r.matched.via, "template");
  assert.equal(r.matched.hops, 0);
  assert.equal(r.fellBackToRoot, false);
  assert.deepEqual(r.chain.map((s) => s.term), ["spider"]);
  assert.ok(r.matched.template.parameters.includes("emotion"), "the matched template is the one carrying the emotion parameter");
  assert.ok(r.svg.startsWith("<svg"), "real markup came back");
});

test("the svg is exactly what the underlying resolver returns for the same arguments — the chain never changes the answer", () => {
  const r = resolveSpriteRequest({ class: "spider", expression: "happy" }, deps());
  const direct = resolveSpriteAsset("spider", [], [{ predicate: "mgx:feels", object: "happy" }], TEMPLATES, SPRITE_REGISTRY);
  assert.equal(r.svg, direct);
});

test("an expression the matched template takes visibly changes the markup, and is reported as applied", () => {
  const happy = resolveSpriteRequest({ class: "spider", expression: "happy" }, deps());
  const sad = resolveSpriteRequest({ class: "spider", expression: "sad" }, deps());
  const plain = resolveSpriteRequest({ class: "spider" }, deps());
  assert.equal(happy.expressionApplied, true);
  assert.equal(sad.expressionApplied, true);
  assert.notEqual(happy.svg, sad.svg, "two expressions draw two different faces");
  assert.notEqual(happy.svg, plain.svg, "an expression changes the plain sprite");
  assert.equal(plain.expressionApplied, null, "nothing was asked for, so nothing is claimed");
});

test("an expression the palette does not hold is reported unknown and never invented into the markup", () => {
  const r = resolveSpriteRequest({ class: "spider", expression: "smug" }, deps());
  assert.equal(r.expressionKnown, false);
  assert.equal(r.expressionApplied, false, "an unmapped value is not a match for the emotion template");
  assert.equal(r.svg, resolveSpriteRequest({ class: "spider" }, deps()).svg, "it resolved the plain sprite, not a guessed face");
});

test("size resolves to sprite-size.mjs's own scale and never touches the markup", () => {
  const large = resolveSpriteRequest({ class: "spider", size: "large" }, deps());
  const small = resolveSpriteRequest({ class: "spider", size: "small" }, deps());
  assert.equal(large.scale, 1.3);
  assert.equal(small.scale, 0.8);
  assert.equal(large.sizeKnown, true);
  assert.equal(large.svg, small.svg, "size is a render scale, not a different sprite");
});

test("a size word outside the scale table is reported unknown and leaves the scale at 1", () => {
  const r = resolveSpriteRequest({ class: "spider", size: "enormous" }, deps());
  assert.equal(r.sizeKnown, false);
  assert.equal(r.scale, 1);
});

test("a class with no sprite of its own walks up the taught subClassOf chain and reports the hop it landed on", () => {
  const factRows = [
    { subject: "wolf-spider", predicate: "rdfs:subClassOf", object: "spider" },
  ];
  const r = resolveSpriteRequest({ class: "wolf-spider", expression: "happy" }, deps({ factRows }));
  assert.deepEqual(r.chain.map((s) => s.term), ["wolf-spider", "spider"]);
  assert.equal(r.matched.term, "spider");
  assert.equal(r.matched.hops, 1);
  assert.equal(r.fellBackToRoot, false);
  assert.equal(r.svg, resolveSpriteRequest({ class: "spider", expression: "happy" }, deps()).svg);
});

test("a class no term of whose chain carries a sprite lands on the root fallback and says so", () => {
  const r = resolveSpriteRequest({ class: "quibbleflax" }, deps());
  assert.equal(r.fellBackToRoot, true);
  assert.equal(r.matched.root, true);
  assert.equal(r.matched.term, "animal");
  assert.equal(r.chain[0].term, "quibbleflax");
  assert.equal(r.chain[0].template, false);
  assert.equal(r.chain[0].registry, false);
});

test("the reported chain agrees with the underlying resolver at every term it walked", () => {
  const factRows = [{ subject: "wolf-spider", predicate: "rdfs:subClassOf", object: "spider" }];
  const r = resolveSpriteRequest({ class: "wolf-spider" }, deps({ factRows }));
  for (const step of r.chain) {
    const alone = resolveSpriteAsset(step.term, [], [], TEMPLATES, {}, { rootFallback: step.term });
    assert.equal(Boolean(alone), step.template, `chain step "${step.term}" agrees with a direct single-term resolve`);
  }
});

test("the vocabulary fields come back null when their vocabulary was not injected — reported, never guessed", () => {
  const r = resolveSpriteRequest({ class: "spider", expression: "happy", size: "large" }, {
    templates: TEMPLATES, spriteRegistry: SPRITE_REGISTRY, resolveSpriteAsset,
  });
  assert.equal(r.expressionKnown, null);
  assert.equal(r.sizeKnown, null);
  assert.equal(r.scale, 1);
  assert.equal(r.chain, null, "no ancestor walk was injected, so no chain is claimed");
  assert.ok(r.svg.startsWith("<svg"), "the markup still resolves");
});

test("it stays self-contained: the function survives being serialized and rebuilt, which is how the page gets it", () => {
  const rebuilt = new Function(`return ${resolveSpriteRequest.toString()}`)();
  const spliced = rebuilt({ class: "spider", expression: "happy" }, {
    templates: TEMPLATES, spriteRegistry: SPRITE_REGISTRY, resolveSpriteAsset,
  });
  const imported = resolveSpriteRequest({ class: "spider", expression: "happy" }, {
    templates: TEMPLATES, spriteRegistry: SPRITE_REGISTRY, resolveSpriteAsset,
  });
  assert.equal(spliced.svg, imported.svg);
});

test("an instanceKey namespaces the markup's own ids without disturbing what the resolution reports", () => {
  const keyed = resolveSpriteRequest({ class: "spider", expression: "happy" }, deps({ instanceKey: "spider-7" }));
  const plain = resolveSpriteRequest({ class: "spider", expression: "happy" }, deps());
  assert.equal(keyed.expressionApplied, true, "compared without the id namespacing, so it still reads as applied");
  assert.equal(keyed.matched.term, plain.matched.term);
});
