// sprite-request.mjs — one sprite request ("the large sprite for a happy
// spider") resolved to markup PLUS the chain that found it. This is the pure
// core the tmct_sprite tool handler wraps and the spider-and-fly page splices,
// so the page and the tool answer the same question with the same code instead
// of two hand-kept call sites drifting apart.
//
// Every collaborator is INJECTED rather than imported — sprite-templates.mjs's
// resolveSpriteAsset, sprite-map.mjs's classAncestorChain, sprite-size.mjs's
// sizeScaleFor, sprite-expressions.mjs's EXPRESSION_PALETTE. Same reason
// spider-fly-viz.mjs's threadCellsForSpiderPlan takes its grid geometry as an
// argument: a function with no module-scope references survives `.toString()`
// splicing into a page script, and the browser already holds its own copies of
// those primitives on window.tmctSpiderFly.
//
// The resolution CHAIN is derived by OBSERVATION, never by re-implementing
// sprite-templates.mjs's specificity order. At each term of the ancestor chain
// the same resolver is asked to resolve that ONE term against an empty
// registry, so "did this level match" is answered by the real resolver rather
// than by a copy of its rules that can drift out of step with it. Whether a
// requested expression was actually honoured is observed the same way: resolve
// once with the mgx:feels fact and once without, and compare.
//
// The two optional slots carry two different senses:
//   - `expression` becomes an `mgx:feels` fact, the parameter every
//     *-with-emotion template selects on.
//   - `size` becomes an `mgx:hasProperty` fact and resolves to a numeric render
//     SCALE (sprite-size.mjs's own closed scale table). It is the taught size of
//     the thing being drawn, not a choice of template tier — the caller picks
//     the tier by which template set it hands in.
//
// Nothing here refuses. A caller that needs a miss wall (the tool does) reads
// `fellBackToRoot` / `expressionApplied` / `sizeKnown` / `expressionKnown` and
// decides; a caller that wants today's fall-through-to-the-root-sprite
// behaviour (the page does) just reads `svg`.

/**
 * Resolve `request` (`{ class, expression?, size? }`) against a template set.
 *
 * `deps` carries the injected collaborators and the state to resolve against:
 * `resolveSpriteAsset` (required), `templates`, `spriteRegistry`, `factRows`
 * (the taxonomy rows the ancestor walk reads), `rootFallback`, `instanceKey`,
 * and — for the reported chain and vocabulary checks — `classAncestorChain`,
 * `sizeScaleFor` and `expressionPalette`. Omit any of the last three and the
 * fields they feed come back `null` rather than guessed.
 *
 * Returns `{ class, expression, size, svg, scale, sizeKnown, expressionKnown,
 * expressionApplied, rootFallback, fellBackToRoot, chain, matched }`. Pure.
 */
export function resolveSpriteRequest(request, deps) {
  const FEELS_PREDICATE = "mgx:feels";
  const PROPERTY_PREDICATE = "mgx:hasProperty";

  const className = String((request && request.class) || "").trim();
  const expression = String((request && request.expression) || "").trim();
  const size = String((request && request.size) || "").trim();

  const options = deps || {};
  const resolveAsset = options.resolveSpriteAsset;
  if (typeof resolveAsset !== "function") {
    throw new TypeError("resolveSpriteRequest needs deps.resolveSpriteAsset");
  }
  const templates = options.templates || [];
  const registry = options.spriteRegistry || {};
  const factRows = options.factRows || [];
  const rootFallback = options.rootFallback || "animal";
  const walkAncestors = options.classAncestorChain;
  const scaleFor = options.sizeScaleFor;
  const palette = options.expressionPalette;

  const propertyFacts = [];
  if (expression) propertyFacts.push({ predicate: FEELS_PREDICATE, object: expression });
  if (size) propertyFacts.push({ predicate: PROPERTY_PREDICATE, object: size });

  const assetOptions = { rootFallback };
  if (options.instanceKey) assetOptions.instanceKey = options.instanceKey;
  const svg = resolveAsset(className, factRows, propertyFacts, templates, registry, assetOptions);

  // One resolve of a SINGLE term against an empty registry and its own root:
  // the real resolver's answer to "does this level of the chain match", with no
  // ancestor walk and no fall-through of its own.
  const templateAt = (term) => resolveAsset(term, [], propertyFacts, templates, {}, { rootFallback: term });
  const carriedByRegistry = (term) => Object.prototype.hasOwnProperty.call(registry, term);

  // The template that produced `hit` at `term`: a fully-specific variant and a
  // plain class template both hand their `svg` through untouched, so equality
  // finds them; a parameterized template's substitutions change the string, and
  // it is the only remaining candidate shape resolveAtTerm can have used.
  const templateBehind = (term, hit) => {
    const candidates = templates.filter((t) => t && Array.isArray(t.classes) && t.classes.indexOf(term) >= 0);
    const authored = candidates.find((t) => t.svg === hit);
    const template = authored || candidates.find((t) => !t.match && t.parameters) || null;
    if (!template) return null;
    return {
      classes: template.classes.slice(),
      parameters: Object.keys(template.parameters || {}).sort(),
      match: template.match || null,
    };
  };

  let chain = null;
  let matched = null;
  if (typeof walkAncestors === "function") {
    chain = [];
    for (const term of walkAncestors(className, factRows)) {
      const hit = templateAt(term);
      chain.push({ term, template: Boolean(hit), registry: carriedByRegistry(term) });
      if (hit) {
        matched = { term, via: "template", hops: chain.length - 1, root: false, template: templateBehind(term, hit) };
        break;
      }
      if (carriedByRegistry(term)) {
        matched = { term, via: "registry", hops: chain.length - 1, root: false, template: null };
        break;
      }
    }
    if (!matched) {
      const rootHit = templateAt(rootFallback);
      chain.push({ term: rootFallback, template: Boolean(rootHit), registry: carriedByRegistry(rootFallback), root: true });
      matched = {
        term: rootFallback,
        via: rootHit ? "template" : "registry",
        hops: chain.length - 1,
        root: true,
        template: rootHit ? templateBehind(rootFallback, rootHit) : null,
      };
    }
  }

  // Compared without the instance-id namespacing, which rewrites gradient ids
  // and would make two otherwise identical resolutions look different.
  const plainSvg = options.instanceKey
    ? resolveAsset(className, factRows, propertyFacts, templates, registry, { rootFallback })
    : svg;
  const withoutExpression = expression
    ? resolveAsset(className, factRows, propertyFacts.filter((f) => f.predicate !== FEELS_PREDICATE), templates, registry, { rootFallback })
    : null;

  return {
    class: className,
    expression: expression || null,
    size: size || null,
    svg,
    scale: typeof scaleFor === "function" ? scaleFor(propertyFacts) : 1,
    sizeKnown: size && typeof scaleFor === "function"
      ? scaleFor([{ predicate: PROPERTY_PREDICATE, object: size }]) !== 1
      : null,
    expressionKnown: expression && palette
      ? Object.prototype.hasOwnProperty.call(palette, expression)
      : null,
    expressionApplied: expression ? plainSvg !== withoutExpression : null,
    rootFallback,
    fellBackToRoot: matched ? Boolean(matched.root) : null,
    chain,
    matched,
  };
}
