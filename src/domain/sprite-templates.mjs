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
//   - a fully-specific hand-authored VARIANT — carries the same `classes`
//     as the class it specializes, plus a `[match]` table (`property`,
//     `value`) naming the exact fact it requires, so it outranks the
//     parameterized template when both would otherwise apply. The filename
//     is free-form and reads `{class}-{what it shows}` in practice
//     (`portrait-round.toml` for mgx:hasProperty = round,
//     `bear-facing-left.toml` for mgx:faces = left) — the `[match]` table,
//     never the name, is what selects it.
//
// A parameterized template's `[parameters.<name>]` table comes in two
// shapes, picked by which of `placeholder`/`placeholders` it declares:
//   - single-placeholder (the shape above): one `placeholder` token, and
//     every `[parameters.<name>.values]` entry is a plain string substituted
//     for it directly.
//   - multi-placeholder (data/sprites-large/*.toml's gradient-shaded
//     materials): a `placeholders` table instead, naming several tokens at
//     once (e.g. `{ light = "{{FILL_LIGHT}}", base = "{{FILL}}", dark =
//     "{{FILL_DARK}}" }`), and every `[parameters.<name>.values]` entry is a
//     table with the SAME sub-keys (e.g. `{ light = "#f0dfa0", base =
//     "#c9a24b", dark = "#8a6a1e" }`), one substituted per token. A value
//     missing even one of the declared sub-keys is never a partial match —
//     the same never-guess posture as an unmapped value in the single shape.
//     sprite-materials.mjs's `expandMaterialReferences` is what lets a
//     sprite-large file write a short by-name reference (`gold = "metal"`)
//     instead of hand-copying the triple — this module never has to know
//     that indirection exists, it only ever sees the expanded table shape.
//
// An object with no taught material still gets a real gradient at the
// sprite tier (data/sprites-large/*.toml's own non-material files), built
// from currentColor via `color-mix(in srgb, currentColor N%, white/black)`
// rather than `stop-opacity` — opacity blends toward whatever sits BEHIND
// the shape, so its light/dark direction silently flips between a light
// theme (currentColor dark-on-light) and a dark one (currentColor
// light-on-dark); color-mix lightens/darkens currentColor itself, so the
// same corner of the shape reads as the lit one on either theme.
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
import { namespaceSvgIds } from "./svg-instance-ids.mjs";

/** Every template in `templates` whose `classes` list names `term`. */
function templatesForClass(term, templates) {
  return (templates || []).filter((t) => Array.isArray(t?.classes) && t.classes.includes(term));
}

function matchSatisfied(match, propertyFacts) {
  if (!match || !match.property || match.value === undefined) return false;
  return (propertyFacts || []).some((f) => f.predicate === match.property && f.object === match.value);
}

/** Substitute one matched `[parameters.*.values]` entry into `svg`: a plain
 *  string fills the parameter's single `placeholder` token; an object fills
 *  every token `param.placeholders` names from the SAME sub-key — returning
 *  null (never a partial gradient) if the object is missing even one of the
 *  sub-keys the parameter declares. */
function fillFromValue(svg, param, value) {
  if (typeof value === "string" && param.placeholder) return svg.split(param.placeholder).join(value);
  if (value && typeof value === "object" && param.placeholders) {
    let out = svg;
    for (const [sub, token] of Object.entries(param.placeholders)) {
      if (!Object.prototype.hasOwnProperty.call(value, sub)) return null;
      out = out.split(token).join(value[sub]);
    }
    return out;
  }
  return null;
}

/** Fill a parameterized template's `svg` from EVERY one of its own
 *  `[parameters.*]` whose observed property value maps to a substitution,
 *  accumulating each successful fill onto the RUNNING svg string rather
 *  than stopping at the first hit — so a template declaring both e.g.
 *  `[parameters.material]` and `[parameters.emotion]` fills both dimensions
 *  in one pass, one parameter's substitution never undoing another's.
 *  Returns null when not even one parameter filled (never a guess, and
 *  never a half-filled template with a leftover placeholder token) — the
 *  caller (resolveAtTerm) falls through to a less specific template exactly
 *  as it did before this function tried more than one dimension. */
function parameterizedFillAll(template, propertyFacts) {
  let svg = template.svg;
  let filledCount = 0;
  for (const param of Object.values(template.parameters || {})) {
    const values = param?.values || {};
    const hit = (propertyFacts || []).find(
      (f) => f.predicate === param.property && Object.prototype.hasOwnProperty.call(values, f.object),
    );
    if (!hit) continue;
    const filled = fillFromValue(svg, param, values[hit.object]);
    if (!filled) continue;
    svg = filled;
    filledCount += 1;
  }
  return filledCount > 0 ? svg : null;
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
    const filled = parameterizedFillAll(t, propertyFacts);
    if (filled) return filled;
  }
  const plain = candidates.find((t) => !t.match && !t.parameters);
  return plain ? plain.svg : null;
}

function resolveSpriteAssetRaw(className, factRows, propertyFacts, templates, spriteRegistry, rootFallback) {
  for (const term of classAncestorChain(className, factRows)) {
    const hit = resolveAtTerm(term, propertyFacts, templates);
    if (hit) return hit;
    if (Object.prototype.hasOwnProperty.call(spriteRegistry, term)) return spriteRegistry[term];
  }
  const rootHit = resolveAtTerm(rootFallback, propertyFacts, templates);
  if (rootHit) return rootHit;
  return spriteRegistry[rootFallback];
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
 *
 * `instanceKey`, when given, namespaces every gradient id the resolved svg
 * declares (svg-instance-ids.mjs's own `namespaceSvgIds`) — pass the
 * instance's own identity (e.g. its subject name) whenever more than one
 * resolved sprite can appear in the same document at once, so two
 * differently-valued instances of the SAME template (a gold lamp and a
 * ceramic lamp both on screen) never share one `<linearGradient id>` and
 * silently render each other's colours. Omit it for a single-instance
 * caller (a template with no ids at all is untouched either way).
 */
export function resolveSpriteAsset(className, factRows, propertyFacts, templates, spriteRegistry, { rootFallback = "animal", instanceKey } = {}) {
  const svg = resolveSpriteAssetRaw(className, factRows, propertyFacts, templates, spriteRegistry, rootFallback);
  return instanceKey ? namespaceSvgIds(svg, instanceKey) : svg;
}

/** Every internal-consistency problem with one parsed template, as plain
 *  strings — empty when the template is well-formed. Used both by
 *  test/adapters/sprite-templates.test.mjs (against the real loaded
 *  data/sprites/ directory) and available to any future loader that wants to
 *  warn rather than silently drop a broken file. Checks: `classes` is a
 *  non-empty array, `svg` is a real `<svg` string, a `[parameters.*]` table
 *  names a `property` and exactly one of `placeholder`/`placeholders` (every
 *  token named appears in `svg`), its `values` map is non-empty and every
 *  entry matches the shape its own `placeholder`/`placeholders` choice
 *  expects, a `[match]` table names both `property` and `value`, and
 *  `[face]`/`[parameters.emotion]` are always declared TOGETHER — a face
 *  anchor with nothing to select it, or an emotion parameter with nowhere to
 *  position its face fragment, is a real authoring mistake either way
 *  (sprite-expressions.mjs's own header explains why the face fragment
 *  needs the pairing). */
export function spriteTemplateProblems(template) {
  const problems = [];
  const t = template || {};
  if (!Array.isArray(t.classes) || t.classes.length === 0) problems.push("classes is missing or empty");
  if (typeof t.svg !== "string" || !t.svg.trim().startsWith("<svg")) problems.push("svg is missing or not an <svg> string");
  for (const [name, param] of Object.entries(t.parameters || {})) {
    if (!param?.property) problems.push(`parameters.${name}.property is missing`);
    if (param?.placeholder && param?.placeholders) {
      problems.push(`parameters.${name} sets both placeholder and placeholders — pick one`);
    } else if (param?.placeholders) {
      const tokens = Object.entries(param.placeholders);
      if (tokens.length === 0) problems.push(`parameters.${name}.placeholders is empty`);
      for (const [sub, token] of tokens) {
        if (typeof t.svg === "string" && !t.svg.includes(token)) {
          problems.push(`parameters.${name}.placeholders.${sub} ${JSON.stringify(token)} does not appear in svg`);
        }
      }
    } else if (!param?.placeholder) {
      problems.push(`parameters.${name}.placeholder is missing`);
    } else if (typeof t.svg === "string" && !t.svg.includes(param.placeholder)) {
      problems.push(`parameters.${name}.placeholder ${JSON.stringify(param.placeholder)} does not appear in svg`);
    }
    if (!param?.values || Object.keys(param.values).length === 0) {
      problems.push(`parameters.${name}.values is empty`);
    } else {
      for (const [key, value] of Object.entries(param.values)) {
        if (param.placeholders) {
          if (!value || typeof value !== "object") {
            problems.push(`parameters.${name}.values.${key} is not an expanded {${Object.keys(param.placeholders).join("/")}} object — an unresolved material reference?`);
          } else {
            for (const sub of Object.keys(param.placeholders)) {
              if (!Object.prototype.hasOwnProperty.call(value, sub)) problems.push(`parameters.${name}.values.${key} is missing "${sub}"`);
            }
          }
        } else if (typeof value !== "string") {
          problems.push(`parameters.${name}.values.${key} must be a plain string for a single-placeholder parameter`);
        }
      }
    }
  }
  if (t.match && (!t.match.property || t.match.value === undefined)) {
    problems.push("match is missing property or value");
  }
  if (t.face && !t.parameters?.emotion) {
    problems.push("face is declared without parameters.emotion — a face anchor with nothing to select it is dead data");
  }
  if (t.parameters?.emotion && !t.face) {
    problems.push("parameters.emotion is declared without a face — an emotion parameter needs its own [face] anchor to position the fragment it fills");
  }
  return problems;
}
