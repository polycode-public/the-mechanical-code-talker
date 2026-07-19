// sprite-materials.mjs — the shared {light, base, dark} colour-triple palette
// the sprite tier's gradient-shaded materials draw from, one treatment per
// key. It exists so a hex triple is written ONCE and referenced by name from
// every data/sprites-large/*.toml file that uses it, rather than the same
// three hex values being hand-copied into six or more files (the drift this
// project's own conventions already try to avoid elsewhere, e.g.
// SOURCE_PRIOR/SPRITE_REGISTRY's single-frozen-table idiom).
//
// A raw taught mgx:madeOf value maps to a TREATMENT here, not one-for-one:
// "gold" and "metal" both read as the same warm shiny-metal treatment,
// "paper" and "cardboard" both read as the same matte-paper treatment — a
// per-file [parameters.material.values] table names which of ITS OWN
// plausible raw values map to which treatment (see data/sprites-large/*.toml),
// this module only owns the treatments themselves.
//
// expandMaterialReferences is the one place that indirection gets resolved:
// it turns a short by-name reference (`gold = "metal"`, valid TOML, safe to
// repeat across files) into the full triple object sprite-templates.mjs's
// resolver actually substitutes into an svg's three gradient stops. Domain
// code downstream of this never needs to know the palette exists at all — it
// only ever sees a [parameters.*.values] entry that is already either a
// plain string (single-placeholder fill) or a complete {light,base,dark}
// object (multi-placeholder fill), the same two shapes a hand-built test
// fixture can supply directly with no palette involved.

/** The 8 rendering treatments this pass covers (the operator's own read of
 *  init's 17 raw mgx:madeOf strings: 8 are distinct shiny/matte/finish
 *  treatments, the remaining 9 food/organic materials are a different
 *  rendering problem and out of scope here). Every value is a real, plain
 *  frozen {light, base, dark} hex triple — no computed shades — so the
 *  gradient a sprite draws is exactly the three stops this table names. */
export const MATERIAL_PALETTE = Object.freeze({
  metal: Object.freeze({ light: "#f0dfa0", base: "#c9a24b", dark: "#8a6a1e" }),
  paper: Object.freeze({ light: "#fdfaf1", base: "#e8dcbf", dark: "#b7a47c" }),
  glass: Object.freeze({ light: "#eaf6f7", base: "#bfe2e7", dark: "#7fb6c1" }),
  ceramic: Object.freeze({ light: "#fefefe", base: "#e6e1d8", dark: "#aba69c" }),
  wood: Object.freeze({ light: "#c98f56", base: "#8a5a2e", dark: "#5a3a1c" }),
  plastic: Object.freeze({ light: "#f3f3f3", base: "#c8c8c8", dark: "#8a8a8a" }),
  wax: Object.freeze({ light: "#fff6de", base: "#f0d98c", dark: "#c9a94a" }),
  "woven material": Object.freeze({ light: "#e8d9b7", base: "#c9a869", dark: "#8a6c3d" }),
});

/**
 * Every [parameters.*.values] string entry, in every template, expanded from
 * a treatment KEY (e.g. "metal") to that treatment's full {light,base,dark}
 * object from `palette` — but only for a parameter that declares
 * `placeholders` (the multi-placeholder shape); a parameter with only the
 * older singular `placeholder` is left alone, since its values are literal
 * fills, never palette references. A values entry that is already an object
 * (a one-off hand-authored triple, not drawn from the shared palette) is
 * left alone too. A string naming no known treatment is left as the plain
 * string it was — spriteTemplateProblems then flags the leftover reference
 * rather than this function silently rendering the wrong colour. Pure;
 * `templates` is read only.
 */
export function expandMaterialReferences(templates, palette = MATERIAL_PALETTE) {
  return (templates || []).map((t) => {
    if (!t?.parameters) return t;
    const parameters = {};
    for (const [name, param] of Object.entries(t.parameters)) {
      if (!param?.placeholders || !param?.values) {
        parameters[name] = param;
        continue;
      }
      const values = {};
      for (const [key, value] of Object.entries(param.values)) {
        values[key] = typeof value === "string" && palette[value] ? palette[value] : value;
      }
      parameters[name] = { ...param, values };
    }
    return { ...t, parameters };
  });
}
