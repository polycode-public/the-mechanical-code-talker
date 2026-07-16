// synthbench/phrasing/examples.mjs — Stage 0 hand-written labeled examples
// (PLAN_CODE.md §6, stage-0 exit bar: "synthesizes >=1 of the 6 existing
// frame families byte-identically from its own hand-written examples"). Each
// entry names a real PHRASING_FRAMES family (src/domain/interpret/normalize.mjs) and
// gives >=2 paired {from, to} utterances sharing that family's fixed
// scaffold, varying only the object — exactly the shape synthesize.mjs's
// synthesizeFrame() consumes. These are hand-authored INPUT DATA, never a
// regex — the frame itself is synthesized, not copied from normalize.mjs.

export const FAMILIES = Object.freeze({
  // mirrors normalize.mjs PHRASING_FRAMES's first members-of-class entry
  // ("what functions are in X" -> "what does X contain").
  "members-of-class": Object.freeze([
    { from: "what functions are in Task", to: "what does Task contain" },
    { from: "what functions are in Widget", to: "what does Widget contain" },
    { from: "what functions are in Button", to: "what does Button contain" },
  ]),
  // mirrors normalize.mjs PHRASING_FRAMES's where-defined (past-tense) entry
  // ("what defined X" -> "where is X defined").
  "where-defined": Object.freeze([
    { from: "what defined Task", to: "where is Task defined" },
    { from: "what defined Widget", to: "where is Widget defined" },
    { from: "what defined Button", to: "where is Button defined" },
  ]),
  // mirrors normalize.mjs PHRASING_FRAMES's has-tests entry
  // ("is X tested" -> "what tests X").
  "has-tests": Object.freeze([
    { from: "is Task tested", to: "what tests Task" },
    { from: "is Widget tested", to: "what tests Widget" },
    { from: "is Button tested", to: "what tests Button" },
  ]),
});
