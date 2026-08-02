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
// A variant can require MORE THAN ONE fact at once, written as repeated
// `[[match]]` tables (the array-of-tables idiom data/templates/
// grammar-rules.toml's own `[[rule]]` already uses) instead of a single
// `[match]` one. Every entry must hold for the variant to be selected, so
// `bear-facing-left-moving.toml` asks for mgx:faces = left AND
// mgx:pose = moving and draws the left profile mid-stride. The two spellings
// are one constraint or many, never a different meaning: a lone `[match]`
// table is exactly a one-entry list, which is why every file authored before
// the plural spelling existed still resolves byte-for-byte as it did.
//
// Where two satisfied variants overlap, the one requiring MORE facts wins —
// an instance taught both the facing and the pose gets the combined art, and
// the same instance taught only the facing gets the plain profile, because
// the combined variant's second constraint no longer holds. Specificity is
// counted from the constraints, never read off the filename, so adding a
// file can't silently reorder what an existing instance resolves to.
//
// The two kinds compose rather than exclude each other: a VARIANT may also
// declare its own `[parameters.*]` tables, and once its `[match]` selects
// it those parameters fill from the instance's OTHER facts (the facing pair
// files each carry `[face]` + `[parameters.emotion]`, so a bear taught both
// mgx:faces = left and mgx:feels = happy renders the left profile wearing
// the happy face). A satisfied `[match]` is the instance naming this art
// directly, so a variant is never allowed to fall through the way an
// unfilled parameterized template is — any placeholder no fact filled is
// dropped instead, which keeps the returned markup complete.
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
// the next ancestor: the satisfied fully-specific variant requiring the most
// facts (filled from its own [parameters.*] if it declares any) > a
// parameterized template filled with an observed matching value > a plain
// class template > (repeat at the next ancestor) > the
// existing flat spriteRegistry entry for that same term (so a class not yet
// migrated to its own template keeps resolving exactly as it did before this
// module existed) > once the chain is exhausted, the same three-step check
// against `rootFallback`, falling back to spriteRegistry's own root entry
// only if nothing there matches either.
import { classAncestorChain } from "./sprite-map.mjs";
import { namespaceSvgIds } from "./svg-instance-ids.mjs";

/** The predicate a variant matches on to pick a facing angle. */
export const FACING_PROPERTY = "mgx:faces";

/** The predicate a variant matches on to pick a pose. */
export const POSE_PROPERTY = "mgx:pose";

/** The facing angles a variant's [match] may require of mgx:faces — a
 *  turntable read as five steps, of which four are named. Centre is the
 *  ABSENT fact, never a word here: a figure with nothing on record about
 *  which way it faces already renders its own front-facing art, so spending
 *  a value on that would give one picture two names and let an instance ask
 *  for the front view two different ways. */
export const FACING_VALUES = Object.freeze(["left", "half-left", "half-right", "right"]);

/** The poses a variant's [match] may require of mgx:pose. At rest is the
 *  ABSENT fact, the same reasoning centre-facing gets above: a figure with no
 *  pose on record is standing still, and that is what every plain template
 *  already draws. "moving" is the one intermediate frame between two rests —
 *  the read a walk cycle needs and the only pose that has to exist before
 *  movement can be animated at all. */
export const POSE_VALUES = Object.freeze(["moving"]);

/** Every template in `templates` whose `classes` list names `term`. */
function templatesForClass(term, templates) {
  return (templates || []).filter((t) => Array.isArray(t?.classes) && t.classes.includes(term));
}

/** One template's `[match]`/`[[match]]` tables as a flat list of raw entries,
 *  whichever of the two spellings it used — the shape every reader wants
 *  before it decides anything, so no caller re-answers "did I get a table or
 *  a list of them" for itself. */
function matchEntries(template) {
  const match = template?.match;
  if (!match) return [];
  return Array.isArray(match) ? match : [match];
}

/**
 * Every `{property, value}` fact one template's `[match]` requires, all of
 * which must hold for the variant to apply. A single `[match]` table yields
 * one constraint, repeated `[[match]]` tables one each, and a template with
 * no `[match]` at all yields none. An entry missing either half is dropped
 * rather than treated as a wildcard — a half-written constraint must never
 * widen what a variant claims to match (spriteTemplateProblems reports it as
 * the authoring mistake it is). Pure.
 */
export function matchConstraints(template) {
  return matchEntries(template).filter((c) => c?.property && c.value !== undefined);
}

function matchSatisfied(constraints, propertyFacts) {
  if (!constraints.length) return false;
  return constraints.every((c) => (propertyFacts || []).some((f) => f.predicate === c.property && f.object === c.value));
}

/** The satisfied `[match]` variant among `candidates` requiring the MOST
 *  facts, or null when none is satisfied — so a combined facing-and-pose
 *  variant outranks the facing-only one it shares an angle with, and drops
 *  back to it the moment the instance stops carrying the pose. A tie keeps
 *  the earliest candidate, which is the load order the caller handed in. */
function bestSatisfiedVariant(candidates, propertyFacts) {
  let best = null;
  let bestCount = 0;
  for (const t of candidates) {
    const constraints = matchConstraints(t);
    if (constraints.length <= bestCount) continue;
    if (!matchSatisfied(constraints, propertyFacts)) continue;
    best = t;
    bestCount = constraints.length;
  }
  return best;
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

/** Every placeholder token a template's own `[parameters.*]` tables name,
 *  across both shapes — the single `placeholder` and every token in a
 *  `placeholders` table. */
function declaredPlaceholderTokens(template) {
  const tokens = [];
  for (const param of Object.values(template.parameters || {})) {
    if (param?.placeholder) tokens.push(param.placeholder);
    for (const token of Object.values(param?.placeholders || {})) tokens.push(token);
  }
  return tokens;
}

/** `svg` with every token `template` declares that no observed fact filled
 *  dropped outright. Only the [match]-selected path wants this: a satisfied
 *  [match] means the instance asked for THIS art by name, so the variant
 *  can't fall through to a less specific template the way an unfilled
 *  parameterized template does, and dropping the leftover token is what
 *  keeps the returned markup complete rather than shipping a literal
 *  "{{FACE}}" into the page. */
function withUnfilledPlaceholdersDropped(template, svg) {
  let out = svg;
  for (const token of declaredPlaceholderTokens(template)) out = out.split(token).join("");
  return out;
}

/** Resolve ONE class term (no ancestor walk here — the caller repeats this
 *  at every level of the chain) against the template set, in specificity
 *  order: fully-specific match variant > parameterized template filled with
 *  an observed value > plain class template > a parameterized template with
 *  no fact to fill it, its own unfilled placeholders dropped. Among
 *  satisfied match variants the most demanding one wins (bestSatisfiedVariant).
 *  A match variant that declares its own `[parameters.*]` is filled from them
 *  first, so a facing profile also carrying `[face]`/`[parameters.emotion]`
 *  renders the mood the instance's own mgx:feels fact names. Returns the SVG
 *  string, or null when nothing at this level matches.
 *
 *  The last step matters for a class whose only art IS a parameterized
 *  template (e.g. lamp/cabinet at the sprite tier: one `[parameters.material]`
 *  file, no plain sibling) — with no fact to fill it, `parameterizedFillAll`
 *  correctly declines rather than guessing a material, but the class still
 *  has real dedicated art. Dropping the unfilled tokens and returning that
 *  art (the same treatment a satisfied match variant's own unfilled
 *  placeholders already get) means an untaught instance renders as ITS OWN
 *  class, not as whatever a less-specific ancestor happens to resolve to. */
function resolveAtTerm(term, propertyFacts, templates) {
  const candidates = templatesForClass(term, templates);
  const matched = bestSatisfiedVariant(candidates, propertyFacts);
  if (matched && !matched.parameters) return matched.svg;
  if (matched) {
    return withUnfilledPlaceholdersDropped(matched, parameterizedFillAll(matched, propertyFacts) || matched.svg);
  }
  for (const t of candidates) {
    if (t.match || !t.parameters) continue;
    const filled = parameterizedFillAll(t, propertyFacts);
    if (filled) return filled;
  }
  const plain = candidates.find((t) => !t.match && !t.parameters);
  if (plain) return plain.svg;
  const parameterizedOnly = candidates.find((t) => !t.match && t.parameters);
  return parameterizedOnly ? withUnfilledPlaceholdersDropped(parameterizedOnly, parameterizedOnly.svg) : null;
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
 *  expects, every `[match]`/`[[match]]` entry names both `property` and
 *  `value`, no two entries demand different values of the SAME property (a
 *  constraint set no instance can ever satisfy is dead art, not a stricter
 *  variant), a constraint on one of the two CLOSED axes names a value that
 *  axis actually has (mgx:faces one of FACING_VALUES, mgx:pose one of
 *  POSE_VALUES — every other predicate stays open, since a variant may match
 *  on any fact at all, mgx:hasProperty included), and
 *  `[face]`/`[parameters.emotion]` are always declared TOGETHER — a face
 *  anchor with nothing to select it, or an emotion parameter with nowhere to
 *  position its face fragment, is a real authoring mistake either way
 *  (sprite-expressions.mjs's own header explains why the face fragment
 *  needs the pairing). Every check reads the tables a template actually
 *  declares and none of them cares whether a `[match]` sits alongside, so a
 *  facing variant carrying `[match]` + `[face]` + `[parameters.emotion]` is
 *  held to exactly the same pairing and placeholder rules as a plain
 *  `*-with-emotion.toml` file. */
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
  const entries = matchEntries(t);
  for (const entry of entries) {
    if (!entry?.property || entry?.value === undefined) problems.push("match is missing property or value");
  }
  const requiredBy = new Map();
  for (const { property, value } of matchConstraints(t)) {
    if (requiredBy.has(property) && requiredBy.get(property) !== value) {
      problems.push(`match requires ${property} to be both "${requiredBy.get(property)}" and "${value}" — no instance can satisfy that`);
    }
    requiredBy.set(property, value);
    if (property === FACING_PROPERTY && !FACING_VALUES.includes(value)) {
      problems.push(`match requires ${FACING_PROPERTY} "${value}", which is not one of the turntable's angles (${FACING_VALUES.join(", ")}; the centre view is the absent fact)`);
    }
    if (property === POSE_PROPERTY && !POSE_VALUES.includes(value)) {
      problems.push(`match requires ${POSE_PROPERTY} "${value}", which is not one of the known poses (${POSE_VALUES.join(", ")}; at rest is the absent fact)`);
    }
  }
  if (t.face && !t.parameters?.emotion) {
    problems.push("face is declared without parameters.emotion — a face anchor with nothing to select it is dead data");
  }
  if (t.parameters?.emotion && !t.face) {
    problems.push("parameters.emotion is declared without a face — an emotion parameter needs its own [face] anchor to position the fragment it fills");
  }
  return problems;
}
