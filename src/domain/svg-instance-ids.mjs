// svg-instance-ids.mjs — a resolved sprite's own `id="…"`/`url(#…)` pairs
// (a gradient def and its fill/stroke reference) made unique per rendered
// instance. It exists because two DIFFERENT resolved values of the SAME
// class's SAME template — e.g. a gold lamp and a ceramic lamp, both on
// screen at once — share the identical `id="lamp-fill"` string (the id lives
// in the TEMPLATE, not the substituted colour), and duplicate ids are a real
// bug, not a cosmetic one: a browser's `url(#id)` reference resolves to
// whichever element with that id it saw FIRST in the document, so every
// later instance silently renders the FIRST instance's colours. Namespacing
// each id (and every reference to it) by the caller's own instanceKey before
// two instances share a DOM keeps each gradient its own.
//
// A resolved sprite with no ids at all (most non-material templates carry
// none) is untouched — this is a no-op unless there's actually a collision
// to prevent.

/** Every id `svg` declares, in first-appearance order. */
function idsIn(svg) {
  return [...new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))];
}

/**
 * Suffix every `id="X"` and every `url(#X)` reference to it in `svg` with
 * `-{instanceKey}` (sanitized to id-safe characters) — so the SAME template
 * resolved for two different instances never collides once both are in the
 * same document. `instanceKey` falsy (undefined/""/0) returns `svg`
 * unchanged, the same never-touch-it-unless-asked posture as any other
 * optional pass-through in this pack. Pure.
 */
export function namespaceSvgIds(svg, instanceKey) {
  if (!instanceKey || typeof svg !== "string") return svg;
  const safe = String(instanceKey).replace(/[^a-zA-Z0-9_-]/g, "-");
  let out = svg;
  for (const id of idsIn(svg)) {
    const namespaced = `${id}-${safe}`;
    out = out.split(`id="${id}"`).join(`id="${namespaced}"`);
    out = out.split(`url(#${id})`).join(`url(#${namespaced})`);
  }
  return out;
}
