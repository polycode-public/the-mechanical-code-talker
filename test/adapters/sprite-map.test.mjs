// sprite-map: the ontology-to-sprite ancestor walk (PLAN_SPIDER_FLY.md §7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSpriteForClass, SPRITE_REGISTRY } from "../../src/domain/sprite-map.mjs";

const isA = (subject, object) => ({ subject, predicate: "rdfs:subClassOf", object });

// The world pack's own seed taxonomy (src/domain/spider-fly-world.mjs's
// SEED_TAXONOMY) — the worked example PLAN_SPIDER_FLY.md §7 names: a poodle
// gets its own sprite, a sheepdog doesn't and falls back to the generic dog
// sprite via the ancestor walk.
const SEED_TAXONOMY_ROWS = [
  isA("poodle", "dog"),
  isA("sheepdog", "dog"),
  isA("dog", "animal"),
  isA("spider", "arachnid"),
  isA("arachnid", "animal"),
  isA("fly", "insect"),
  isA("insect", "animal"),
];

test("a class registered directly resolves to its own sprite, no walk needed", () => {
  assert.equal(resolveSpriteForClass("poodle", SEED_TAXONOMY_ROWS, SPRITE_REGISTRY), SPRITE_REGISTRY.poodle);
  assert.equal(resolveSpriteForClass("spider", SEED_TAXONOMY_ROWS, SPRITE_REGISTRY), SPRITE_REGISTRY.spider);
});

test("a class with no direct sprite entry resolves to its nearest registered ancestor — sheepdog falls back to dog", () => {
  assert.equal(resolveSpriteForClass("sheepdog", SEED_TAXONOMY_ROWS, SPRITE_REGISTRY), SPRITE_REGISTRY.dog);
});

test("a class two hops from any registered ancestor still resolves, through an UNREGISTERED intermediate — spider's own arachnid ancestor isn't in the registry", () => {
  // spider IS directly registered, so remove it from a copy of the registry to
  // force the walk through its unregistered "arachnid" ancestor up to "animal".
  const { spider: _omit, ...withoutSpider } = SPRITE_REGISTRY;
  assert.equal(resolveSpriteForClass("spider", SEED_TAXONOMY_ROWS, withoutSpider), SPRITE_REGISTRY.animal);
});

test("a class with no taxonomy edges at all, and no direct registry entry, falls back to the declared root", () => {
  assert.equal(resolveSpriteForClass("wombat", [], SPRITE_REGISTRY), SPRITE_REGISTRY.animal);
});

test("the walk is nearest-ancestor-first: a class with a closer AND a farther registered ancestor picks the closer one", () => {
  // dog (closer, registered) sits between poodle and animal (farther, also
  // registered) — the walk must stop at dog, never continue past it to animal.
  assert.equal(resolveSpriteForClass("poodle", SEED_TAXONOMY_ROWS, SPRITE_REGISTRY), SPRITE_REGISTRY.poodle);
  assert.equal(resolveSpriteForClass("sheepdog", SEED_TAXONOMY_ROWS, SPRITE_REGISTRY), SPRITE_REGISTRY.dog);
  assert.notEqual(SPRITE_REGISTRY.dog, SPRITE_REGISTRY.animal, "the fixture actually distinguishes the two sprites");
});

test("a custom rootFallback overrides the default 'animal' key", () => {
  const registry = Object.freeze({ plant: "<svg>plant</svg>" });
  assert.equal(
    resolveSpriteForClass("oak", [isA("oak", "tree")], registry, { rootFallback: "plant" }),
    registry.plant,
  );
});

test("class names are normFactTerm-normalized before lookup — case and article-insensitive", () => {
  assert.equal(resolveSpriteForClass("A Poodle", [], SPRITE_REGISTRY), SPRITE_REGISTRY.poodle);
  assert.equal(resolveSpriteForClass("SPIDER", [], SPRITE_REGISTRY), SPRITE_REGISTRY.spider);
});

test("SPRITE_REGISTRY covers every class this game's board ever places a sprite for", () => {
  for (const key of ["spider", "fly", "egg", "poodle", "dog", "animal"]) {
    assert.ok(typeof SPRITE_REGISTRY[key] === "string" && SPRITE_REGISTRY[key].startsWith("<svg"), `${key} is a real inline SVG`);
  }
});

test("SPRITE_REGISTRY is frozen — a caller cannot mutate the shared table", () => {
  assert.ok(Object.isFrozen(SPRITE_REGISTRY));
});
