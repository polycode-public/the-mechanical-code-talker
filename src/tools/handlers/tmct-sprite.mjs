// tmct_sprite — the sprite markup for a class, resolved through the memory
// graph's own rdfs:subClassOf taxonomy, with the expression and size the caller
// asked for and the chain the resolver walked to find it.
//
// The resolution itself is sprite-request.mjs's pure core (the same function the
// spider-and-fly page splices into its script), so this module only does the
// three things a tool has to: read the real state, hold the miss wall, and say
// the answer twice — once as a sentence, once as data.
//
// The MISS WALL, since the resolver underneath never refuses (it falls through
// to the root sprite by design, which is right for a page painting a board and
// wrong for a question):
//   - an expression outside sprite-expressions.mjs's palette, or a size outside
//     sprite-size.mjs's scale table, is refused before anything is resolved;
//   - a class no term of whose ancestor chain carries a sprite is refused rather
//     than answered with the generic root sprite;
//   - an expression the resolved template does not actually take is refused
//     rather than silently dropped from an otherwise plausible answer.
//
// WHICH SENSE OF "LARGE" `size` CARRIES: the taught size PROPERTY, resolved to a
// numeric render scale (sprite-size.mjs's `sizeScaleFor` — small 0.8, large 1.3,
// long 1.2, tall 1.25), not the template TIER. Two reasons. It is a fact-shaped
// question: `mgx:hasProperty large` is a real predicate the memory store can
// carry and the resolver already consults, so the tool's `memoryFacts`
// precondition and its resolution chain stay one mechanism, where a tier is the
// caller's render target rather than anything true of the thing being drawn.
// And the tier a request could name is a packaging accident: data/sprites-large/
// is excluded from the npm package, so a tier-selecting `size` would answer
// differently depending on how tmct was installed, while a scale multiplier
// answers the same everywhere. The tier in play is still REPORTED in `data.tier`
// — observed, never asked for.

import { ToolError } from "../../adapters/config.mjs";
import { classAncestorChain, SPRITE_REGISTRY } from "../../domain/sprite-map.mjs";
import { resolveSpriteAsset } from "../../domain/sprite-templates.mjs";
import { EXPRESSION_PALETTE } from "../../domain/sprite-expressions.mjs";
import { sizeScaleFor } from "../../domain/sprite-size.mjs";
import { resolveSpriteRequest } from "../../domain/sprite-request.mjs";
import { ICON_TIER_NAME, SPRITE_TIER_NAME } from "../../domain/sprite-facts.mjs";
import { readSpriteTemplateFiles } from "../../adapters/corpus/sprite-template-files.mjs";
import { readSpriteLargeTemplateFiles } from "../../adapters/corpus/sprite-large-template-files.mjs";
import { memoryFactRows } from "../memory-fallthrough.mjs";
import { requiredArg, toolResult } from "./kit.mjs";

/** The property predicate sprite-size.mjs reads a size word off. Used to PROBE
 *  its own closed scale table rather than restate it: a word is a size word
 *  exactly when it moves the scale, so a word that module gains is a word this
 *  tool gains. */
const SIZE_FACT_PREDICATE = "mgx:hasProperty";

/** The expression words a sprite can be asked for — sprite-expressions.mjs's own
 *  palette, sorted, never a hand-kept copy. */
export const spriteExpressionWords = () => Object.keys(EXPRESSION_PALETTE).sort();

/** True iff `word` is a size sprite-size.mjs's scale table recognises. */
export const isSpriteSizeWord = (word) =>
  Boolean(word) && sizeScaleFor([{ predicate: SIZE_FACT_PREDICATE, object: String(word) }]) !== 1;

/** The template set to resolve against: the sprite tier when this installation
 *  can read it (a git checkout, or the demo site's own build), the icon tier
 *  otherwise. Reported alongside the answer so a caller never has to guess which
 *  one it got. */
function templateTier() {
  const large = readSpriteLargeTemplateFiles();
  if (large.length) return { templates: large, tier: SPRITE_TIER_NAME };
  return { templates: readSpriteTemplateFiles(), tier: ICON_TIER_NAME };
}

function chainSentence(chain) {
  return chain.map((step) => step.term).join(" -> ");
}

export async function tmct_sprite(args, { config, memoryBackend = null }) {
  const className = requiredArg(args, "class").toLowerCase();
  const expression = String(args?.expression || "").trim().toLowerCase();
  const size = String(args?.size || "").trim().toLowerCase();

  if (expression && !Object.hasOwn(EXPRESSION_PALETTE, expression)) {
    throw new ToolError(
      `"${expression}" is not a sprite expression. The palette holds: ${spriteExpressionWords().join(", ")}.`,
    );
  }
  if (size && !isSpriteSizeWord(size)) {
    throw new ToolError(
      `"${size}" is not a size the sprite scale recognises — it reads a taught mgx:hasProperty size word off the individual, and has no entry for this one.`,
    );
  }

  const { templates, tier } = templateTier();
  const factRows = await memoryFactRows(config, memoryBackend);
  const resolution = resolveSpriteRequest({ class: className, expression, size }, {
    factRows,
    templates,
    spriteRegistry: SPRITE_REGISTRY,
    resolveSpriteAsset,
    classAncestorChain,
    sizeScaleFor,
    expressionPalette: EXPRESSION_PALETTE,
  });

  if (!resolution.svg || resolution.fellBackToRoot) {
    throw new ToolError(
      `no sprite for "${className}" — neither it nor any rdfs:subClassOf ancestor the memory graph knows ` +
        `(${chainSentence(resolution.chain)}) carries one in the ${tier}. Teach the class its superclass first, or ask for a class the catalog draws.`,
    );
  }
  if (expression && !resolution.expressionApplied) {
    throw new ToolError(
      `the ${tier} draws "${className}" (matched at "${resolution.matched.term}") but that template takes no expression, ` +
        `so "${expression}" would not show. Ask for the plain sprite, or a class whose template carries an emotion parameter.`,
    );
  }

  const asked = [expression ? `expression ${expression}` : "", size ? `size ${size}` : ""].filter(Boolean);
  const lines = [
    `sprite for "${className}"${asked.length ? ` (${asked.join(", ")})` : ""}, from the ${tier}`,
    resolution.matched.hops === 0
      ? `matched at "${resolution.matched.term}", the class itself, via its own ${resolution.matched.via}`
      : `matched at "${resolution.matched.term}", ${resolution.matched.hops} hop(s) up the ancestor chain, via its ${resolution.matched.via}`,
    `ancestor chain walked: ${chainSentence(resolution.chain)}`,
  ];
  if (resolution.matched.template?.parameters.length) {
    lines.push(`template parameters: ${resolution.matched.template.parameters.join(", ")}`);
  }
  if (size) lines.push(`render scale: ${resolution.scale} (from the taught mgx:hasProperty "${size}")`);
  lines.push(`${resolution.svg.length} characters of SVG markup`);

  return toolResult({
    content: lines.join("\n"),
    data: {
      class: resolution.class,
      expression: resolution.expression,
      size: resolution.size,
      tier,
      scale: resolution.scale,
      svg: resolution.svg,
      chain: resolution.chain,
      matched: resolution.matched,
      expressionApplied: resolution.expressionApplied,
    },
  });
}

// The sprite catalog and the conversational-memory taxonomy are this tool's only
// sources — it answers with or without a code-map graph, so the shared code-graph
// load (which refuses an empty graph) must not gate it.
tmct_sprite.ownsGraphLoad = true;
