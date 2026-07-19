// sprite-size.mjs — a taught size-descriptive property (small/large/long/
// tall — words the corpus's own WordNet-derived property vocabulary already
// carries under mgx:hasProperty) resolved to a plain numeric render scale,
// NOT a new template file: vector sprite art scales for free, so this
// dimension costs nothing extra in the pack. The same "prove the mechanism,
// no live consumer required yet" posture the icon tier's dog-with-colour
// demo already established — no shipped world currently carries a size
// property on a real object, so nothing calls this yet.

const SIZE_PROPERTY_PREDICATE = "mgx:hasProperty";

/** Closed vocabulary only: a size word absent from this table never moves
 *  the scale, it simply doesn't match — the same never-guess posture every
 *  other property lookup in this pack takes. */
const SIZE_SCALE = Object.freeze({
  small: 0.8,
  large: 1.3,
  long: 1.2,
  tall: 1.25,
});

/**
 * The render scale factor for `propertyFacts` (an instance's own small
 * `{predicate, object}` fact set): the first mgx:hasProperty value found in
 * SIZE_SCALE, else 1 (no size fact at all => the sprite's own natural size).
 * Pure; `propertyFacts` is read only, never required to be non-empty.
 */
export function sizeScaleFor(propertyFacts) {
  for (const f of propertyFacts || []) {
    if (f?.predicate !== SIZE_PROPERTY_PREDICATE) continue;
    if (Object.prototype.hasOwnProperty.call(SIZE_SCALE, f.object)) return SIZE_SCALE[f.object];
  }
  return 1;
}
