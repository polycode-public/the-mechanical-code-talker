// The closed dialogue-act vocabulary: tmct's turn types named to ISO 24617-2's
// communicative functions, using the standard's own camelCase data-category
// spellings. The router already sorts every turn into a lane, so the label a
// consumer attaches is a fixed lookup over a decision already made — a table,
// never a classifier, and no model anywhere.
//
// The honesty-preserving line runs through this table: tmct's miss is
// autoNegative in the autoFeedback dimension — the sender reporting that its
// OWN processing could not ground the turn — never a task answer. A flat
// intent set collapses that distinction; keeping it is why the standard is
// worth adopting over an ad-hoc set.
//
// The subset here covers what tmct's lanes produce. The standard's responsive
// accept/decline family is deliberately absent; a session extending the table
// should know the standard's own cross-wiring: accepting a request or a
// suggestion is a COMMISSIVE, while accepting an offer is a DIRECTIVE, and the
// address* functions are the general "dealing with" nodes those specialise.
//
// Source of the names: docs/references/schemas/iso-24617-2-dialogue-acts.md —
// a good-faith reading of the editors' LREC 2020 paper and the public DIS
// draft, not a quotation of the paywalled published text.

/** The standard's ten dimensions (second edition), camelCase per its Annex F
 *  data-category names. Every act in DIALOGUE_ACTS carries exactly one. */
export const DIALOGUE_ACT_DIMENSIONS = Object.freeze([
  "task",
  "autoFeedback",
  "alloFeedback",
  "turnManagement",
  "timeManagement",
  "discourseStructuring",
  "ownCommunicationManagement",
  "partnerCommunicationManagement",
  "socialObligationsManagement",
  "contactManagement",
]);

/** Every communicative function tmct's lanes cover. General-purpose functions
 *  (questions, informs, directives, commissives) carry the dimension tmct
 *  annotates them in — task; the feedback and social functions carry the fixed
 *  dimension the standard gives them. `gloss` says what the function is on the
 *  standard's terms, with tmct's use in brackets where one exists. */
export const DIALOGUE_ACTS = Object.freeze({
  propositionalQuestion: Object.freeze({
    dimension: "task",
    gloss: "a yes/no question about whether a proposition holds ('does X import Y?')",
  }),
  checkQuestion: Object.freeze({
    dimension: "task",
    gloss: "a yes/no question whose asker already expects the answer yes ('..., right?')",
  }),
  setQuestion: Object.freeze({
    dimension: "task",
    gloss: "a wh-question asking for the members of a set ('what does X import?')",
  }),
  choiceQuestion: Object.freeze({
    dimension: "task",
    gloss: "a question asking which of the listed alternatives holds ('is X a module or a class?')",
  }),
  inform: Object.freeze({
    dimension: "task",
    gloss: "a declarative telling the addressee something (a teach turn; also tmct explaining its own function)",
  }),
  answer: Object.freeze({
    dimension: "task",
    gloss: "an inform that discharges a question just asked (an answer grounded in the graph)",
  }),
  confirm: Object.freeze({
    dimension: "task",
    gloss: "an answer 'yes' to a check question",
  }),
  disconfirm: Object.freeze({
    dimension: "task",
    gloss: "an answer 'no' to a check question",
  }),
  agreement: Object.freeze({
    dimension: "task",
    gloss: "an inform stating that the speaker holds what the addressee just stated to be true",
  }),
  disagreement: Object.freeze({
    dimension: "task",
    gloss: "an inform stating that the speaker holds what the addressee just stated to be false",
  }),
  correction: Object.freeze({
    dimension: "task",
    gloss: "a disagreement that also supplies the replacement ('no, I meant Y')",
  }),
  request: Object.freeze({
    dimension: "task",
    gloss: "asks the addressee to perform an action ('solve it' — a goal turn)",
  }),
  instruct: Object.freeze({
    dimension: "task",
    gloss: "a request the addressee is expected to carry out without negotiation (a bare imperative)",
  }),
  suggestion: Object.freeze({
    dimension: "task",
    gloss: "puts an action forward as advisable without claiming authority over the addressee",
  }),
  offer: Object.freeze({
    dimension: "task",
    gloss: "commits the speaker to an action, conditional on the addressee wanting it",
  }),
  autoPositive: Object.freeze({
    dimension: "autoFeedback",
    gloss: "the sender reports its own processing of the previous turn succeeded (an acknowledgement)",
  }),
  autoNegative: Object.freeze({
    dimension: "autoFeedback",
    gloss: "the sender reports its own processing of the previous turn failed — tmct's honest miss",
  }),
  initialGreeting: Object.freeze({
    dimension: "socialObligationsManagement",
    gloss: "opens an exchange of greetings ('hi')",
  }),
  returnGreeting: Object.freeze({
    dimension: "socialObligationsManagement",
    gloss: "answers a greeting with a greeting",
  }),
  thanking: Object.freeze({
    dimension: "socialObligationsManagement",
    gloss: "expresses gratitude for something the addressee did",
  }),
  apology: Object.freeze({
    dimension: "socialObligationsManagement",
    gloss: "expresses regret for something the speaker did",
  }),
});

/** The router-lane → dialogue-act lookup the chat surface attaches per turn: a
 *  deterministic map over the lane the router already picked. Keys name router
 *  lanes; values name DIALOGUE_ACTS entries. The honest-miss row is the one
 *  that must never drift: a miss is autoFeedback about tmct's own processing,
 *  not a task answer. */
export const LANE_DIALOGUE_ACTS = Object.freeze({
  teach: "inform",
  "ask-set": "setQuestion",
  "ask-propositional": "propositionalQuestion",
  goal: "request",
  imperative: "instruct",
  "honest-miss": "autoNegative",
  greeting: "initialGreeting",
  thanks: "thanking",
  help: "inform",
});

/** The dialogue act a router lane resolves to, with its dimension — or null
 *  for a lane the lookup does not cover (the caller keeps its own naming). */
export function dialogueActForLane(lane) {
  // hasOwn, so an inherited name ("constructor") is uncovered, never a hit
  // found on the prototype chain.
  if (typeof lane !== "string" || !Object.hasOwn(LANE_DIALOGUE_ACTS, lane)) return null;
  const act = LANE_DIALOGUE_ACTS[lane];
  return { act, dimension: DIALOGUE_ACTS[act].dimension };
}
