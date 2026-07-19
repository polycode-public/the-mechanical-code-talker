// sprite-templates.mjs — the property-aware sprite resolver, layered ON TOP
// of sprite-map.mjs's flat class registry rather than replacing it (its own
// header explains why the ancestor walk stays exactly as-is). Where
// resolveSpriteForClass only ever asks "what class is this", this module also
// asks "what does this INSTANCE'S OWN mgx:hasProperty-shaped fact say about
// it" — the operator's own worked example: a dog typed "dog" with a taught
// "black" property resolves to a filled-in coloured template, one typed
// "sheepdog" with the same property resolves through the ordinary ancestor
// walk to the SAME template, and a dog with no colour property at all falls
// through to the plain dog sprite.
//
// Naming convention for the two template kinds a specific class can carry
// beyond its own plain `{class}.toml` (data/sprites/*.toml, one file per
// sprite):
//   - a PARAMETERIZED template — `{class}-with-{property}.toml` (this pass
//     ships `dog-with-colour.toml`) — declares a `[parameters.<name>]` table
//     naming the fact predicate that carries the value (`property`, e.g.
//     "mgx:hasProperty"), a placeholder token the `svg` string contains
//     (`placeholder`, e.g. "{{FILL}}"), and a `[parameters.<name>.values]`
//     table translating an observed property VALUE into the literal
//     substitution (e.g. `black = "#22201d"`). A value with no entry in that
//     map is not a match for this template at all — it falls through to a
//     less specific one, never a guessed/invented substitution.
//   - a fully-specific hand-authored VARIANT — `{class}-with-{property}-
//     {value}.toml` (e.g. a hypothetical `dog-with-colour-black.toml`, not
//     authored this pass) — carries the same `classes` as the class it
//     specializes, plus a `[match]` table (`property`, `value`) naming the
//     exact fact it requires, so it outranks the parameterized template
//     when both would otherwise apply.
//
// Specificity order, checked at EACH term of the class's ancestor chain
// (nearest first, sprite-map.mjs's own classAncestorChain) before moving to
// the next ancestor: an exact fully-specific variant whose [match] is
// satisfied > a parameterized template filled with an observed matching
// value > a plain class template > (repeat at the next ancestor) > the
// existing flat spriteRegistry entry for that same term (so a class not yet
// migrated to its own template keeps resolving exactly as it did before this
// module existed) > once the chain is exhausted, the same three-step check
// against `rootFallback`, falling back to spriteRegistry's own root entry
// only if nothing there matches either.
import { classAncestorChain } from "./sprite-map.mjs";

/** Every template in `templates` whose `classes` list names `term`. */
function templatesForClass(term, templates) {
  return (templates || []).filter((t) => Array.isArray(t?.classes) && t.classes.includes(term));
}

function matchSatisfied(match, propertyFacts) {
  if (!match || !match.property || match.value === undefined) return false;
  return (propertyFacts || []).some((f) => f.predicate === match.property && f.object === match.value);
}

/** Fill a parameterized template's `svg` from the first of its own
 *  `[parameters.*]` whose observed property value maps to a substitution —
 *  or null when no property fact names a mapped value (never a guess). */
function parameterizedFill(template, propertyFacts) {
  for (const param of Object.values(template.parameters || {})) {
    const values = param?.values || {};
    const hit = (propertyFacts || []).find(
      (f) => f.predicate === param.property && Object.prototype.hasOwnProperty.call(values, f.object),
    );
    if (hit) return template.svg.split(param.placeholder).join(values[hit.object]);
  }
  return null;
}

/** Resolve ONE class term (no ancestor walk here — the caller repeats this
 *  at every level of the chain) against the template set, in specificity
 *  order: fully-specific match variant > parameterized template filled with
 *  an observed value > plain class template. Returns the SVG string, or null
 *  when nothing at this level matches. */
function resolveAtTerm(term, propertyFacts, templates) {
  const candidates = templatesForClass(term, templates);
  const matched = candidates.find((t) => t.match && matchSatisfied(t.match, propertyFacts));
  if (matched) return matched.svg;
  for (const t of candidates) {
    if (t.match || !t.parameters) continue;
    const filled = parameterizedFill(t, propertyFacts);
    if (filled) return filled;
  }
  const plain = candidates.find((t) => !t.match && !t.parameters);
  return plain ? plain.svg : null;
}

/**
 * Resolve `className` to sprite SVG markup, property-aware: the ancestor
 * chain (from `factRows`, sprite-map.mjs's own walk) is checked nearest-
 * first, and at each term the template set (`templates`, the parsed
 * data/sprites/*.toml set) is tried before falling back to `spriteRegistry`
 * for that same term — so a class with no template at all resolves exactly
 * as resolveSpriteForClass already does. `propertyFacts` is the instance's
 * own small `{predicate, object}` fact set (e.g. its mgx:hasProperty rows) —
 * read only, never required to be non-empty. Pure.
 */
export function resolveSpriteAsset(className, factRows, propertyFacts, templates, spriteRegistry, { rootFallback = "animal" } = {}) {
  for (const term of classAncestorChain(className, factRows)) {
    const hit = resolveAtTerm(term, propertyFacts, templates);
    if (hit) return hit;
    if (Object.prototype.hasOwnProperty.call(spriteRegistry, term)) return spriteRegistry[term];
  }
  const rootHit = resolveAtTerm(rootFallback, propertyFacts, templates);
  if (rootHit) return rootHit;
  return spriteRegistry[rootFallback];
}

/** Every internal-consistency problem with one parsed template, as plain
 *  strings — empty when the template is well-formed. Used both by
 *  test/adapters/sprite-templates.test.mjs (against the real loaded
 *  data/sprites/ directory) and available to any future loader that wants to
 *  warn rather than silently drop a broken file. Checks: `classes` is a
 *  non-empty array, `svg` is a real `<svg` string, a `[parameters.*]` table
 *  names a `property` and a non-empty `values` map, and a `[match]` table
 *  names both `property` and `value`. */
export function spriteTemplateProblems(template) {
  const problems = [];
  const t = template || {};
  if (!Array.isArray(t.classes) || t.classes.length === 0) problems.push("classes is missing or empty");
  if (typeof t.svg !== "string" || !t.svg.trim().startsWith("<svg")) problems.push("svg is missing or not an <svg> string");
  for (const [name, param] of Object.entries(t.parameters || {})) {
    if (!param?.property) problems.push(`parameters.${name}.property is missing`);
    if (!param?.placeholder) problems.push(`parameters.${name}.placeholder is missing`);
    else if (typeof t.svg === "string" && !t.svg.includes(param.placeholder)) {
      problems.push(`parameters.${name}.placeholder ${JSON.stringify(param.placeholder)} does not appear in svg`);
    }
    if (!param?.values || Object.keys(param.values).length === 0) problems.push(`parameters.${name}.values is empty`);
  }
  if (t.match && (!t.match.property || t.match.value === undefined)) {
    problems.push("match is missing property or value");
  }
  return problems;
}
