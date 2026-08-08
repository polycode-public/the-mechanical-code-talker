// choice-question.test.mjs — the closed multiple-choice recognizer: one test
// per shape it accepts and one per sentence it must decline, so the two
// families stay distinguishable as the templates grow.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHOICE_SHAPES, CHOICE_MIN_OPTIONS, CHOICE_MAX_OPTIONS,
  splitChoiceQuestion, isChoiceQuestion, choiceDeclineReason,
} from "../../src/domain/choice-question.mjs";

const optionTexts = (parsed) => parsed.options.map((o) => o.text);
const optionLabels = (parsed) => parsed.options.map((o) => o.label);

// ---- positive: inline shape ----

test("a bare juxtaposition question splits into its subject and its two alternatives", () => {
  const parsed = splitChoiceQuestion("is a whale a fish or a mammal?");
  assert.equal(parsed.shape, CHOICE_SHAPES.inline);
  assert.equal(parsed.stem, "is a whale?");
  assert.equal(parsed.sourceTerm, "whale");
  assert.deepEqual(optionTexts(parsed), ["a fish", "a mammal"]);
  assert.equal(choiceDeclineReason("is a whale a fish or a mammal?"), "");
});

test("a comma-anchored which-is question reads its source clause up to the comma", () => {
  const parsed = splitChoiceQuestion("which is a kitchen in, a house or a car?");
  assert.equal(parsed.shape, CHOICE_SHAPES.inline);
  assert.equal(parsed.sourceTerm, "kitchen");
  assert.deepEqual(optionTexts(parsed), ["a house", "a car"]);
});

test("a does-question with a verb-preposition phrase separates the verb from the options", () => {
  const parsed = splitChoiceQuestion("does a bird live in a nest or a burrow?");
  assert.equal(parsed.shape, CHOICE_SHAPES.inline);
  assert.equal(parsed.sourceTerm, "bird");
  assert.deepEqual(optionTexts(parsed), ["a nest", "a burrow"]);
});

test("a relational source clause with an internal of is read whole, not split at the first word", () => {
  const parsed = splitChoiceQuestion("is the capital of france paris, lyon or marseille?");
  assert.equal(parsed.shape, CHOICE_SHAPES.inline);
  assert.equal(parsed.sourceTerm, "capital of france");
  assert.deepEqual(optionTexts(parsed), ["paris", "lyon", "marseille"]);
});

// ---- positive: enumerated shape ----

test("a labelled enumerated question separates its stem from its lettered options", () => {
  const text = "Where would you find magazines along side many other printed works?\n"
    + "A) doctor B) bookstore C) market D) train station E) mortuary";
  const parsed = splitChoiceQuestion(text);
  assert.equal(parsed.shape, CHOICE_SHAPES.enumerated);
  assert.equal(parsed.stem, "Where would you find magazines along side many other printed works?");
  assert.equal(parsed.sourceTerm, "magazines");
  assert.deepEqual(optionTexts(parsed), ["doctor", "bookstore", "market", "train station", "mortuary"]);
});

// ---- negative: the write-boundary set (5.3) ----

test("a disjunctive class definition is a teach sentence, never a choice question", () => {
  assert.equal(splitChoiceQuestion("every pet is a cat or a dog"), null);
  assert.equal(isChoiceQuestion("every pet is a cat or a dog"), false);
  assert.equal(choiceDeclineReason("every pet is a cat or a dog"), "not-a-question");
});

test("a polar question with a negated tail is not read as two alternatives", () => {
  assert.equal(splitChoiceQuestion("is a whale a fish or not"), null);
  assert.equal(choiceDeclineReason("is a whale a fish or not"), "no-alternation");
});

test("a what-question over a disjunction is a set question, not a choice question", () => {
  assert.equal(splitChoiceQuestion("what is a cat or a dog"), null);
  assert.equal(choiceDeclineReason("what is a cat or a dog"), "no-alternation");
});

test("an imperative with no interrogative lead is declined outright", () => {
  assert.equal(splitChoiceQuestion("tell me about cats or dogs"), null);
  assert.equal(choiceDeclineReason("tell me about cats or dogs"), "not-a-question");
});

test("or inside a quantity phrase with no question lead is not alternation", () => {
  assert.equal(splitChoiceQuestion("a bird or two flew past"), null);
  assert.equal(choiceDeclineReason("a bird or two flew past"), "not-a-question");
});

test("a fixed sooner-or-later phrase with no question lead is not alternation", () => {
  assert.equal(splitChoiceQuestion("sooner or later it rains"), null);
  assert.equal(choiceDeclineReason("sooner or later it rains"), "not-a-question");
});

test("two separate polar questions joined by or are not one choice question", () => {
  assert.equal(splitChoiceQuestion("is it a bird or is it a plane"), null);
  assert.equal(choiceDeclineReason("is it a bird or is it a plane"), "no-alternation");
});

test("a comparison with no listed alternatives has nothing to split", () => {
  assert.equal(splitChoiceQuestion("which is bigger"), null);
  assert.equal(choiceDeclineReason("which is bigger"), "no-alternation");
});

// ---- the six required extras ----

test("an enumerated five-choice question keeps its upstream labels", () => {
  const text = "Where would you find magazines along side many other printed works?\n"
    + "A) doctor B) bookstore C) market D) train station E) mortuary";
  const parsed = splitChoiceQuestion(text);
  assert.deepEqual(optionLabels(parsed), ["A", "B", "C", "D", "E"]);
});

test("an inline two-option question numbers its options positionally", () => {
  const parsed = splitChoiceQuestion("does a cat sleep on a bed or a couch?");
  assert.equal(parsed.shape, CHOICE_SHAPES.inline);
  assert.deepEqual(optionLabels(parsed), ["1", "2"]);
});

test("an option list longer than the cap declines rather than truncating", () => {
  const text = "Which fruit is this?\n"
    + "A) apple B) pear C) plum D) fig E) date F) kiwi G) mango";
  assert.equal(splitChoiceQuestion(text), null);
  assert.equal(choiceDeclineReason(text), "too-many-options");
});

test("a repeated option declines rather than deduplicating", () => {
  assert.equal(splitChoiceQuestion("is a whale a fish or a fish?"), null);
  assert.equal(choiceDeclineReason("is a whale a fish or a fish?"), "duplicate-options");
});

test("the same input twice returns the same option order", () => {
  const text = "is the capital of france paris, lyon or marseille?";
  const first = splitChoiceQuestion(text);
  const second = splitChoiceQuestion(text);
  assert.deepEqual(first, second);
});

test("a teach sentence with a disjunctive class never parses as a choice question", () => {
  assert.equal(splitChoiceQuestion("every insect is a beetle or an ant"), null);
  assert.equal(isChoiceQuestion("every insect is a beetle or an ant"), false);
});

// ---- contract coverage: the two decline reasons the tables above never hit ----

test("a single labelled option declines for having too few to choose between", () => {
  const text = "Which is it?\nA) apple";
  assert.equal(splitChoiceQuestion(text), null);
  assert.equal(choiceDeclineReason(text), "too-few-options");
});

test("a label with no text after it declines rather than treating it as an empty choice", () => {
  const text = "Which is it?\nA) apple B)";
  assert.equal(splitChoiceQuestion(text), null);
  assert.equal(choiceDeclineReason(text), "option-empty");
});

test("a newline-separated option list with no letters parses like the labelled form", () => {
  const parsed = splitChoiceQuestion("Which is best?\nfirst\nsecond");
  assert.equal(parsed.shape, CHOICE_SHAPES.enumerated);
  assert.deepEqual(optionLabels(parsed), ["A", "B"]);
  assert.deepEqual(optionTexts(parsed), ["first", "second"]);
});

// ---- stem source-term extraction: the broadened template set ----

test("a broadened placement verb reads its object up to the option list's comma", () => {
  const text = "Where can you buy a clock, watch or wallet?\nA) shop B) house";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "clock");
});

test("a what-do-support stem reads the subject between the auxiliary and the closing verb", () => {
  const text = "What do beavers use to build dams?\nA) teeth B) claws";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "beavers");
});

test("a what-is-the-subject stem reads the verb's direct object instead of a subject", () => {
  const text = "What uses a battery to work?\nA) remote B) book";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "battery");
});

test("a where-copula stem reads its subject past the leading article", () => {
  const text = "Where is a kettle usually kept?\nA) kitchen B) garage";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "kettle");
});

test("a trailing of-clause names the term over the stem's own grammatical subject", () => {
  const text = "What is the habitat of the fox?\nA) den B) nest";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "fox");
});

test("a want-to stem reads the verb's object when the verb takes one", () => {
  const text = "Would you want to open a bakery before dawn?\nA) today B) later";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "bakery");
});

test("a want-to stem falls back to the bare verb when nothing follows it", () => {
  const text = "What would you need if you want to smoke?\nA) lighter B) fork";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "smoke");
});

test("a possessive noun ends the captured phrase and drops its own trailing s", () => {
  const text = "Where can you find a restaurant's phone number?\nA) sign B) website";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "restaurant");
});

test("a pronoun subject yields no source term rather than reading the pronoun as one", () => {
  const text = "Where are you when you are ready to leave?\nA) home B) door";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "");
});

test("a stem with no recognized cue at all still parses, with an empty source term", () => {
  const text = "How are the conditions for someone who lives in a shelter?\nA) good B) bad";
  const parsed = splitChoiceQuestion(text);
  assert.notEqual(parsed, null);
  assert.equal(parsed.sourceTerm, "");
});

// ---- the exported bounds are the numbers the tests above rely on ----

test("the exported option bounds match what the option-count declines test against", () => {
  assert.equal(CHOICE_MIN_OPTIONS, 2);
  assert.equal(CHOICE_MAX_OPTIONS, 6);
});
