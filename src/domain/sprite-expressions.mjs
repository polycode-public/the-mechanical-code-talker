// sprite-expressions.mjs — the shared face-fragment scheme the sprite tier's
// mgx:feels parameter draws from, one small dot/curve-eyes-plus-mouth
// drawing per curated emotion word, mirroring sprite-materials.mjs's own
// by-name-reference shape exactly: a frozen palette of raw treatment data,
// and a pure expand function that turns a short by-name reference in a
// template's own [parameters.emotion.values] table into the full
// substitution — so a face fragment is authored ONCE here and referenced by
// name from every data/sprites-large/*-with-emotion.toml file, rather than
// six-plus files each hand-copying the same eyes-and-mouth paths.
//
// The one real difference from a material treatment: a hex triple needs no
// context to drop into a template's placeholder, but a face fragment does —
// classes vary enough in head geometry (a dog's head circle is
// cx=7 cy=9 r=3.6, a cat's is cx=9 cy=9.4 r=4.4, a person's is
// cx=12 cy=6.6 r=3.3) that one universal anchor position would misplace the
// eyes on at least one of them. So EXPRESSION_PALETTE's own fragments are
// authored in a UNIT face — eyes and mouth drawn as if the head were a
// radius-1 circle centred on the origin — and expandExpressionReferences
// wraps the matched fragment in `<g transform="translate({cx} {cy})
// scale({scale})">` using the SAME template's own required `[face]` table
// (cx/cy/scale) to place and size it for that one class's real head. A
// template with a [parameters.emotion] table but no [face] table is left
// unexpanded (spriteTemplateProblems flags the pairing as a real problem —
// see sprite-templates.mjs — this function itself stays defensive, never
// throws on a malformed template).
//
// Every fragment uses a fixed dark ink colour rather than currentColor —
// a face needs to read against ANY body fill (a gold lamp's flame stays a
// fixed amber for the same reason: what the face/flame looks like doesn't
// come from what the body is made of or coloured).
//
// Convention for every future `*-with-emotion.toml` file (content-authoring
// agents: read this before copying the shape) — `{{FACE}}` is always the
// LAST child before `</svg>`, so the resolved face fragment paints over
// the body/highlight shapes beneath it, never the reverse.

/** The dark ink colour every face fragment draws its eyes/mouth in,
 *  regardless of the sprite's own body fill — the same fixed-colour
 *  reasoning lamp.toml's flame already uses (sprite-templates.mjs's own
 *  header explains the precedent). */
const FACE_INK = "#000000";

/** One `<g>`-ready fragment per curated emotion word, dot/curve eyes plus a
 *  mouth curve, authored in a unit face (radius 1, centred on the origin) —
 *  expandExpressionReferences positions and scales it per class. Distinct
 *  by more than mouth curvature alone: scared/surprised both open wide, but
 *  scared's mouth stays a small tense "o" while surprised's is a large
 *  dropped-jaw oval; calm's eyes are closed contented arcs where happy's
 *  are open dots, so no two of the six collapse into the same read at a
 *  glance. */
export const EXPRESSION_PALETTE = Object.freeze({
  happy:
    `<circle cx="-0.4" cy="-0.15" r="0.11" fill="${FACE_INK}" opacity="0.85"/>`
    + `<circle cx="0.4" cy="-0.15" r="0.11" fill="${FACE_INK}" opacity="0.85"/>`
    + `<path d="M -0.4 0.35 Q 0 0.68 0.4 0.35" fill="none" stroke="${FACE_INK}" stroke-width="0.09" stroke-linecap="round" opacity="0.85"/>`,
  sad:
    `<circle cx="-0.4" cy="-0.1" r="0.1" fill="${FACE_INK}" opacity="0.85"/>`
    + `<circle cx="0.4" cy="-0.1" r="0.1" fill="${FACE_INK}" opacity="0.85"/>`
    + `<path d="M -0.38 0.55 Q 0 0.3 0.38 0.55" fill="none" stroke="${FACE_INK}" stroke-width="0.09" stroke-linecap="round" opacity="0.85"/>`,
  angry:
    `<path d="M -0.58 -0.32 L -0.22 -0.16" stroke="${FACE_INK}" stroke-width="0.09" stroke-linecap="round" opacity="0.85"/>`
    + `<path d="M 0.58 -0.32 L 0.22 -0.16" stroke="${FACE_INK}" stroke-width="0.09" stroke-linecap="round" opacity="0.85"/>`
    + `<circle cx="-0.32" cy="-0.02" r="0.09" fill="${FACE_INK}" opacity="0.85"/>`
    + `<circle cx="0.32" cy="-0.02" r="0.09" fill="${FACE_INK}" opacity="0.85"/>`
    + `<path d="M -0.36 0.5 L 0.36 0.42" stroke="${FACE_INK}" stroke-width="0.1" stroke-linecap="round" opacity="0.85"/>`,
  scared:
    `<circle cx="-0.4" cy="-0.12" r="0.2" fill="none" stroke="${FACE_INK}" stroke-width="0.07" opacity="0.85"/>`
    + `<circle cx="-0.4" cy="-0.12" r="0.07" fill="${FACE_INK}" opacity="0.85"/>`
    + `<circle cx="0.4" cy="-0.12" r="0.2" fill="none" stroke="${FACE_INK}" stroke-width="0.07" opacity="0.85"/>`
    + `<circle cx="0.4" cy="-0.12" r="0.07" fill="${FACE_INK}" opacity="0.85"/>`
    + `<circle cx="0" cy="0.42" r="0.09" fill="none" stroke="${FACE_INK}" stroke-width="0.07" opacity="0.85"/>`,
  surprised:
    `<circle cx="-0.38" cy="-0.12" r="0.17" fill="none" stroke="${FACE_INK}" stroke-width="0.07" opacity="0.85"/>`
    + `<circle cx="-0.38" cy="-0.12" r="0.06" fill="${FACE_INK}" opacity="0.85"/>`
    + `<circle cx="0.38" cy="-0.12" r="0.17" fill="none" stroke="${FACE_INK}" stroke-width="0.07" opacity="0.85"/>`
    + `<circle cx="0.38" cy="-0.12" r="0.06" fill="${FACE_INK}" opacity="0.85"/>`
    + `<ellipse cx="0" cy="0.42" rx="0.16" ry="0.22" fill="${FACE_INK}" opacity="0.7"/>`,
  calm:
    `<path d="M -0.5 -0.1 Q -0.4 -0.2 -0.3 -0.1" fill="none" stroke="${FACE_INK}" stroke-width="0.08" stroke-linecap="round" opacity="0.85"/>`
    + `<path d="M 0.3 -0.1 Q 0.4 -0.2 0.5 -0.1" fill="none" stroke="${FACE_INK}" stroke-width="0.08" stroke-linecap="round" opacity="0.85"/>`
    + `<path d="M -0.3 0.4 Q 0 0.5 0.3 0.4" fill="none" stroke="${FACE_INK}" stroke-width="0.08" stroke-linecap="round" opacity="0.85"/>`,
});

/** The mgx:feels property name every emotion-bearing template's
 *  `[parameters.emotion]` table names — sprite-templates.mjs never needs
 *  to know this constant exists (it reads `param.property` generically),
 *  this module only uses it to recognise which parameter table is ITS OWN
 *  to expand, the same role sprite-materials.mjs's `param.placeholders`
 *  shape check plays for a material table. */
const FEELS_PROPERTY = "mgx:feels";

/**
 * Every `[parameters.emotion].values` string entry, in every template,
 * expanded from a curated emotion-word KEY (e.g. "happy") to the full
 * `<g transform="translate(cx cy) scale(scale)">…</g>` substitution for
 * THIS template's own required `[face]` table — but only for a template
 * whose `[parameters.emotion]` table names `mgx:feels` as its property
 * (sprite-templates.mjs's `param.property`) and that also carries a
 * `[face]` table; a template missing either is left alone (defensive, never
 * throws — spriteTemplateProblems is what flags that pairing as a real
 * authoring mistake). A values entry naming no known palette word is left
 * as the plain string it was, the same never-guess posture
 * expandMaterialReferences already uses for an unknown treatment name.
 * Pure; `templates` is read only.
 */
export function expandExpressionReferences(templates, palette = EXPRESSION_PALETTE) {
  return (templates || []).map((t) => {
    const emotion = t?.parameters?.emotion;
    if (!emotion?.property || emotion.property !== FEELS_PROPERTY) return t;
    if (!emotion.placeholder || !emotion.values || !t.face) return t;
    const { cx, cy, scale } = t.face;
    const values = {};
    for (const [key, value] of Object.entries(emotion.values)) {
      values[key] = typeof value === "string" && palette[value]
        ? `<g transform="translate(${cx} ${cy}) scale(${scale})">${palette[value]}</g>`
        : value;
    }
    return { ...t, parameters: { ...t.parameters, emotion: { ...emotion, values } } };
  });
}
