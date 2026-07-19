// sprite-map.mjs — the ontology-to-sprite mapping (PLAN_SPIDER_FLY.md §7): a
// flat registry of small, original inline-SVG icons keyed on class name, and
// the ancestor-walk resolver that maps ANY class down to whichever registered
// ancestor is nearest — so a taxonomy can teach `poodle IsA dog` and
// `sheepdog IsA dog` once, register a sprite only for `poodle` and `dog`, and
// have `sheepdog` fall back to the generic dog sprite automatically.
//
// resolveSpriteForClass is styled after src/domain/ask.mjs's private
// ancestorsOf (BFS, nearest-ancestor-first, a flat queue with `shift()`) but
// walks generic rdfs:subClassOf fact-store edges (subject IsA object) rather
// than ask.mjs's code-graph `inherits` edges — the two data shapes are
// different graphs, so the walk is re-derived here rather than imported.
//
// SPRITE_REGISTRY follows the flat closed-vocabulary registry idiom this
// project already uses elsewhere (SOURCE_PRIOR in domain/memory/trust.mjs,
// EDGE_KIND_TO_TMCT in adapters/repository-interface.mjs): an
// Object.freeze({...}) string-to-value map with a doc comment, keyed on the
// same normFactTerm-normalized spelling the fact store already uses, so a
// lookup never has to re-normalise its own keys before comparing.
//
// normFactTerm is imported from domain/hash.mjs directly, not
// adapters/memory/core.mjs's re-export of it — this module lives in
// src/domain/, and domain stays pure of src/adapters/ (test/estate/
// import-layers.test.mjs enforces the direction).

import { normFactTerm } from "./hash.mjs";

const SUBJECT_TO_SUPERCLASS_PREDICATE = "rdfs:subClassOf";

// Every value is a complete, self-contained <svg> string using
// `fill="currentColor"`/`stroke="currentColor"` so the renderer colors an
// icon with plain CSS (the spider's green accent, the fly's amber one — §9)
// rather than baking a color into the markup. Small, geometric, hand-drawn
// shapes only — no external asset files, no licence to track (§8's whole
// point of dropping RPG-JS in favor of this).
const SPIDER_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="10" r="3.4" fill="currentColor"/>'
  + '<circle cx="12" cy="15.6" r="4.6" fill="currentColor"/>'
  + '<g stroke="currentColor" stroke-width="1.1" fill="none" stroke-linecap="round">'
  + '<path d="M9 8 L2 4"/><path d="M9 10 L1.5 9"/><path d="M9 12.5 L2 14"/><path d="M9 15.5 L3 19"/>'
  + '<path d="M15 8 L22 4"/><path d="M15 10 L22.5 9"/><path d="M15 12.5 L22 14"/><path d="M15 15.5 L21 19"/>'
  + "</g></svg>";

const FLY_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="13.2" rx="3.2" ry="5" fill="currentColor"/>'
  + '<circle cx="12" cy="7" r="2.6" fill="currentColor"/>'
  + '<g fill="currentColor" opacity="0.55">'
  + '<path d="M9 10 C3 6 2 4 3 2 C6 2 9 6 10.5 10 Z"/>'
  + '<path d="M15 10 C21 6 22 4 21 2 C18 2 15 6 13.5 10 Z"/>'
  + "</g></svg>";

const EGG_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 C7 2 4 10 4 15.5 C4 20 7.6 22 12 22 '
  + 'C16.4 22 20 20 20 15.5 C20 10 17 2 12 2 Z" fill="currentColor"/></svg>';

const POODLE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="13" cy="15" rx="6.4" ry="4.6" fill="currentColor"/>'
  + '<circle cx="7" cy="8.5" r="4" fill="currentColor"/>'
  + '<g fill="currentColor"><circle cx="4" cy="6" r="1.6"/><circle cx="7" cy="4.2" r="1.7"/><circle cx="10" cy="6" r="1.6"/></g>'
  + '<rect x="18.5" y="14" width="2.2" height="6" rx="1.1" fill="currentColor"/>'
  + '<circle cx="19.6" cy="13" r="1.5" fill="currentColor"/>'
  + '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="9" y1="19.5" x2="9" y2="22"/><line x1="17" y1="19.5" x2="17" y2="22"/></g>'
  + "</svg>";

const DOG_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="13" cy="15" rx="6.4" ry="4.2" fill="currentColor"/>'
  + '<circle cx="7" cy="9" r="3.6" fill="currentColor"/>'
  + '<path d="M4.5 6.5 L2 3 L6 5 Z" fill="currentColor"/>'
  + '<path d="M19 13 C22 12 22.5 15 20 16 Z" fill="currentColor"/>'
  + '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="9" y1="19" x2="9" y2="22"/><line x1="17" y1="19" x2="17" y2="22"/></g>'
  + "</svg>";

// The generic fallback — deliberately the plainest shape in the set (an
// unadorned four-legged blob) so it reads as "some animal" rather than
// suggesting a species the taxonomy never named.
const ANIMAL_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="13" rx="7" ry="4.4" fill="currentColor"/>'
  + '<circle cx="12" cy="7" r="3.4" fill="currentColor"/>'
  + '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><line x1="7" y1="17" x2="7" y2="21"/><line x1="17" y1="17" x2="17" y2="21"/></g>'
  + "</svg>";

// ---- the adventure world's own class family (PLAN_GAMES_UPLIFT_V2.md Part B)
// — a room's floor plan, a piece of furniture, a portable, a person, the
// player's own adventurer sprite, and a container. Ashcombe Hall's own
// classes resolve to these directly (no ancestor walk needed, since the
// shipped world has no rdfs:subClassOf chain at all yet); the walk stays
// ready for a future world whose taxonomy goes deeper, the same "poodle IsA
// dog" mechanism spider-fly already exercises.

const ROOM_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/>'
  + '<path d="M9 21 L9 13 A3 3 0 0 1 15 13 L15 21" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const FURNITURE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="3" rx="1" fill="currentColor"/>'
  + '<rect x="4" y="8" width="3" height="12" fill="currentColor"/>'
  + '<rect x="17" y="8" width="3" height="12" fill="currentColor"/></svg>';

const PORTABLE_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="9" width="14" height="11" rx="1.5" fill="currentColor"/>'
  + '<path d="M9 9 V6.5 A3 3 0 0 1 15 6.5 V9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const PERSON_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.5" r="3.2" fill="currentColor"/>'
  + '<path d="M6 21 C6 15.5 8.7 13 12 13 C15.3 13 18 15.5 18 21 Z" fill="currentColor"/></svg>';

// The adventurer is the player's own sprite — the same silhouette as `person`
// plus a small satchel, so the one individual the player controls always
// reads as visually distinct from the cast of NPCs sharing the room.
const ADVENTURER_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6.5" r="3.2" fill="currentColor"/>'
  + '<path d="M6 21 C6 15.5 8.7 13 12 13 C15.3 13 18 15.5 18 21 Z" fill="currentColor"/>'
  + '<rect x="15.5" y="13.5" width="4.5" height="5" rx="1" fill="currentColor" opacity="0.6"/></svg>';

const CONTAINER_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="10" width="18" height="10" rx="1.2" fill="currentColor"/>'
  + '<path d="M3 10 L5 5 H19 L21 10 Z" fill="currentColor" opacity="0.7"/>'
  + '<rect x="10.6" y="9.4" width="2.8" height="2.2" rx="0.4" fill="currentColor" opacity="0.35"/></svg>';

/** The sprite registry: class name (normFactTerm-normalized) -> inline SVG
 *  markup. `animal` is this world's declared root fallback (PLAN_SPIDER_FLY.md
 *  §7 names "animal"/"object"/"plant" as the family of possible roots — a
 *  spider-and-fly board only ever needs "animal") — resolveSpriteForClass
 *  falls back to it once the ancestor walk exhausts with no closer hit. The
 *  adventure world's classes (room/furniture/portable/person/adventurer/
 *  container) are a second, unrelated root family sharing the one flat table —
 *  a board only ever resolves classes from its own world, so the two never
 *  collide in practice. */
export const SPRITE_REGISTRY = Object.freeze({
  spider: SPIDER_SVG,
  fly: FLY_SVG,
  egg: EGG_SVG,
  poodle: POODLE_SVG,
  dog: DOG_SVG,
  animal: ANIMAL_SVG,
  room: ROOM_SVG,
  furniture: FURNITURE_SVG,
  portable: PORTABLE_SVG,
  person: PERSON_SVG,
  adventurer: ADVENTURER_SVG,
  container: CONTAINER_SVG,
});

/** Every direct rdfs:subClassOf superclass of `term`, from a flat fact-row
 *  array (`{ subject, predicate, object }`, generic — the same shape both
 *  the fact store and a plain taxonomy fixture already use). */
function directSuperclassesOf(term, factRows) {
  const out = [];
  for (const row of factRows || []) {
    if (row?.predicate !== SUBJECT_TO_SUPERCLASS_PREDICATE) continue;
    if (normFactTerm(row.subject) !== term) continue;
    out.push(normFactTerm(row.object));
  }
  return out;
}

/**
 * Resolve a class name to a sprite: `className` itself if the registry
 * carries it directly, otherwise the nearest rdfs:subClassOf ancestor
 * (breadth-first, nearest first — styled after ask.mjs's own ancestorsOf)
 * that the registry carries, otherwise `rootFallback` ("animal" by default —
 * override it for a registry whose own declared root is "object" or "plant").
 * Pure; `factRows` is read only, never mutated.
 */
export function resolveSpriteForClass(className, factRows, spriteRegistry, { rootFallback = "animal" } = {}) {
  const start = normFactTerm(className);
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const term = queue.shift();
    if (seen.has(term)) continue;
    seen.add(term);
    if (Object.prototype.hasOwnProperty.call(spriteRegistry, term)) return spriteRegistry[term];
    for (const parent of directSuperclassesOf(term, factRows)) {
      if (!seen.has(parent)) queue.push(parent);
    }
  }
  return spriteRegistry[rootFallback];
}
