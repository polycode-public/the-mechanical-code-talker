// The spider-and-fly page's sprite call, after it collapsed onto the same pure
// resolver tmct_sprite wraps. The pin that matters is byte-identity: the page's
// one-argument request must still produce exactly the markup the old
// five-positional resolveSpriteAsset call did, for every class and expression
// the board actually paints.
import { test } from "node:test";
import assert from "node:assert/strict";

import { renderSpiderFlyHtml } from "../../src/services/spider-fly-viz.mjs";
import { resolveSpriteRequest } from "../../src/domain/sprite-request.mjs";
import { resolveSpriteAsset } from "../../src/domain/sprite-templates.mjs";
import { SPRITE_REGISTRY } from "../../src/domain/sprite-map.mjs";
import { EXPRESSION_PALETTE } from "../../src/domain/sprite-expressions.mjs";
import { worldFactRows } from "../../src/domain/spider-fly-world.mjs";
import { readSpriteLargeTemplateFiles } from "../../src/adapters/corpus/sprite-large-template-files.mjs";

const TEMPLATES = readSpriteLargeTemplateFiles();

// The exact rows createSpiderFlySession hands the page as session.taxonomyRows.
const TAXONOMY_ROWS = worldFactRows()
  .filter((f) => f.predicate === "rdfs:subClassOf")
  .map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object }));

/** The call the page used to make: five positional arguments, four of them
 *  page-held state. Kept here as the baseline the collapse is pinned against. */
function oldFiveArgumentCall(cls, propertyFacts) {
  return resolveSpriteAsset(cls, TAXONOMY_ROWS, propertyFacts, TEMPLATES, SPRITE_REGISTRY);
}

/** The call the page makes now: one request object, the same shape tmct_sprite
 *  takes, answered by the shared pure resolver. */
function newSpriteRequestCall(spriteRequest) {
  return resolveSpriteRequest(spriteRequest, {
    factRows: TAXONOMY_ROWS,
    templates: TEMPLATES,
    spriteRegistry: SPRITE_REGISTRY,
    resolveSpriteAsset,
  }).svg || "";
}

test("every emotion the board can paint on a spider or a fly renders byte-identically to the old call", () => {
  for (const cls of ["spider", "fly"]) {
    for (const expression of Object.keys(EXPRESSION_PALETTE)) {
      assert.equal(
        newSpriteRequestCall({ class: cls, expression }),
        oldFiveArgumentCall(cls, [{ predicate: "mgx:feels", object: expression }]),
        `${cls} feeling ${expression}`,
      );
    }
  }
});

test("the classes that carry no expression at all render byte-identically to the old empty-propertyFacts call", () => {
  for (const cls of ["egg", "spider", "fly"]) {
    assert.equal(newSpriteRequestCall({ class: cls }), oldFiveArgumentCall(cls, []), cls);
  }
});

test("a corpse's frozen, expression-free request renders byte-identically to the old call for the same class", () => {
  for (const cls of ["spider", "fly", "egg"]) {
    assert.equal(newSpriteRequestCall({ class: cls }), oldFiveArgumentCall(cls, []), `corpse ${cls}`);
  }
});

test("the emotion still changes what is drawn — the pin is identity with the old call, not with a plain sprite", () => {
  const happy = newSpriteRequestCall({ class: "spider", expression: "happy" });
  const plain = newSpriteRequestCall({ class: "spider" });
  assert.notEqual(happy, plain);
  assert.ok(happy.startsWith("<svg"));
});

test("a class the page has no template for still falls through rather than blanking, as it did before", () => {
  assert.equal(newSpriteRequestCall({ class: "web" }), oldFiveArgumentCall("web", []));
});

// ---- what the rendered page now contains ------------------------------------

test("the page splices the shared resolver in and no longer spells out a five-argument sprite call", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /const resolveSpriteRequest = /, "the shared pure resolver is spliced in, not re-implemented");
  assert.match(html, /resolveSpriteRequest\(spriteRequest, \{/, "the page calls it with one request object");
  assert.doesNotMatch(
    html,
    /resolveSpriteAsset\([^)]*,[^)]*,[^)]*,[^)]*,[^)]*\)/,
    "no positional resolveSpriteAsset call is left in the page script",
  );
});

test("the page still hands the resolver its own state — taxonomy rows, embedded templates, the shared registry", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /factRows: \(session && session\.taxonomyRows\) \|\| \[\]/);
  assert.match(html, /templates: SPIDERFLY\.spriteTemplates/);
  assert.match(html, /spriteRegistry: tmctSpiderFly\.SPRITE_REGISTRY/);
  assert.match(html, /resolveSpriteAsset: tmctSpiderFly\.resolveSpriteAsset/);
});

test("the page asks for an expression by name, never by hand-building an mgx:feels fact row", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /resolveSpriteFace\(\{ class: cls, expression: mood \}\)/);
  assert.doesNotMatch(html, /predicate: "mgx:feels"/, "the fact shape is the resolver's business now");
});
