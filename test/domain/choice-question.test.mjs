// choice-question.test.mjs — the closed multiple-choice recognizer: one test
// per shape it accepts and one per sentence it must decline, so the two
// families stay distinguishable as the templates grow.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHOICE_SHAPES, CHOICE_MIN_OPTIONS, CHOICE_MAX_OPTIONS,
  splitChoiceQuestion, isChoiceQuestion, choiceDeclineReason,
  routeChoiceRelation, lemmaFoldVariants, headNounOf,
  stemTopicCandidates, stemConstraintTerms,
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

// ---- negative: a label marker has to stand alone ----

test("dotted module paths in A/B order are not read as a lettered option list", () => {
  const text = "which modules import app/lib/a.mjs or app/lib/b.mjs";
  assert.equal(splitChoiceQuestion(text), null);
  assert.equal(isChoiceQuestion(text), false);
});

test("a path pair inside a why-question is left for the presupposition lane", () => {
  const text = "why does app/lib/a.mjs still import app/lib/b.mjs";
  assert.equal(splitChoiceQuestion(text), null);
  assert.equal(isChoiceQuestion(text), false);
});

test("a file extension after a single letter is not a label marker", () => {
  const text = "which modules import a.mjs and b.mjs";
  assert.equal(splitChoiceQuestion(text), null);
});

test("a letter run inside a word never opens an option list", () => {
  const text = "which classes extend Base.Widget or Base.Button";
  assert.equal(splitChoiceQuestion(text), null);
});

test("a marker at the very end of the text still closes its option", () => {
  const parsed = splitChoiceQuestion("Which is it?\nA) apple B) pear");
  assert.deepEqual(optionTexts(parsed), ["apple", "pear"]);
});

test("parenthesized labels parse the same as bare ones", () => {
  const parsed = splitChoiceQuestion("Which fruit is it?\n(A) apple (B) pear");
  assert.equal(parsed.shape, CHOICE_SHAPES.enumerated);
  assert.deepEqual(optionLabels(parsed), ["A", "B"]);
  assert.deepEqual(optionTexts(parsed), ["apple", "pear"]);
});

test("dotted and colon label markers parse when they stand alone", () => {
  const dotted = splitChoiceQuestion("Which is it?\nA. apple B. pear");
  assert.deepEqual(optionTexts(dotted), ["apple", "pear"]);
  const colon = splitChoiceQuestion("Which is it?\nA: apple B: pear");
  assert.deepEqual(optionTexts(colon), ["apple", "pear"]);
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

// ---- stem source-term extraction: postponed and mid-sentence wh-shapes ----

test("a wh-word fronted behind a single preposition reads the clause after its auxiliary", () => {
  const text = "In what habitat do bears normally live?\nA) forest B) desert";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "bears");
});

test("a bare wh-word fronted behind a preposition still reads the clause after its auxiliary", () => {
  const text = "From where do aliens arrive?\nA) space B) ocean";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "aliens arrive");
});

test("a wh-word inverted around an auxiliary mid-sentence reads the clause ahead of it", () => {
  const text = "During a shark filled tornado where should you not be?\nA) inside B) outside";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "shark filled tornado");
});

test("a trailing clause opening with a question-lead word reads the declarative clause ahead of the comma", () => {
  const text = "The trucker plopped on the bench with a sense of relief, where did he arrive?\nA) station B) airport";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "bench");
});

test("a trailing clause with no locative preposition falls back to its own leading subject", () => {
  const text = "Stark was just having fun, and he wasn't hurting anyone. What might have he been doing?\nA) dancing B) sleeping";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "stark");
});

test("a bare trailing wh-word reads backward for the nearest content phrase", () => {
  const text = "The next day you will be doing what?\nA) sleeping B) eating";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "doing");
});

test("a bare trailing wh-word past a preposition reads the noun phrase ahead of it", () => {
  const text = "It brought her a great deal of what?\nA) joy B) money";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "great deal");
});

test("a mid-sentence wh-word already fronted at the stem's own start yields no postponed match", () => {
  const text = "How are the conditions for someone who is living in a homeless shelter?\nA) good B) bad";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "");
});

test("a single clause with no comma or period has no earlier clause to read for the trailing-clause template", () => {
  const text = "Where could a sloth live?\nA) tree B) desert";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "");
});

test("a two-clause stem whose last clause is not itself a question falls through to the bare trailing-wh template", () => {
  const text = "A beaver is known for building prowess, their supplies come from where?\nA) forest B) river";
  assert.equal(splitChoiceQuestion(text).sourceTerm, "supplies come");
});

// ---- relation routing ----

test("a where-cued stem routes to the AtLocation family", () => {
  const route = routeChoiceRelation("Where would you keep a book?");
  assert.equal(route.family, "AtLocation");
  assert.deepEqual(route.predicates, ["mgx:atLocation", "mgx:locatedNear"]);
});

test("an another-word-for stem routes to the IsA/Synonym/HasProperty family", () => {
  assert.equal(routeChoiceRelation("What is another word for happy?").family, "IsA/Synonym/HasProperty");
});

test("a before-cued stem routes to the HasPrerequisite/HasSubevent family", () => {
  assert.equal(routeChoiceRelation("What must you do before you can drive a car?").family, "HasPrerequisite/HasSubevent");
});

test("a want-cued stem routes to the Desires/MotivatedByGoal family", () => {
  assert.equal(routeChoiceRelation("Why did the man want to eat?").family, "Desires/MotivatedByGoal");
});

test("a causes-cued stem routes to the Causes family", () => {
  assert.equal(routeChoiceRelation("What causes a fire?").family, "Causes");
});

test("a part-of-cued stem routes to the PartOf/HasA/MadeOf family", () => {
  assert.equal(routeChoiceRelation("What is a wheel part of?").family, "PartOf/HasA/MadeOf");
});

test("a capable-of-cued stem routes to the CapableOf family", () => {
  assert.equal(routeChoiceRelation("What is a dog capable of?").family, "CapableOf");
});

test("a used-for-cued stem routes to the UsedFor family", () => {
  assert.equal(routeChoiceRelation("What is a hammer used for?").family, "UsedFor");
});

test("a stem naming no relation at all routes to null", () => {
  assert.equal(routeChoiceRelation("How did the man feel?"), null);
});

// ---- lemma normalization (rung 4) ----

test("a regular gerund folds back to its base form", () => {
  const variants = lemmaFoldVariants("getting full");
  assert.ok(variants.has("get full"));
});

test("a regular past-tense verb folds back to its base form", () => {
  const variants = lemmaFoldVariants("she reduced it");
  assert.ok(variants.has("she reduce it"));
});

test("a doubled-consonant gerund folds back without the doubled letter", () => {
  const variants = lemmaFoldVariants("stopping");
  assert.ok(variants.has("stop"));
});

test("a phrase with no regular -ing or -ed inflection yields no fold", () => {
  assert.deepEqual([...lemmaFoldVariants("bookstore")], []);
});

// ---- head-noun backoff (rung 4) ----

test("the head noun of a multi-word phrase is its last word", () => {
  assert.equal(headNounOf("fast food restaurant"), "restaurant");
});

test("a single-word phrase has no head noun to back off to", () => {
  assert.equal(headNounOf("restaurant"), "");
});

// ---- stem topic candidates (S1) ----

test("a stem's topic candidates exclude every word that appears in an option", () => {
  const options = [{ label: "A", text: "bookstore" }, { label: "B", text: "market" }];
  const candidates = stemTopicCandidates("Where would you find a magazine near a bookstore?", options);
  assert.ok(!candidates.some((c) => c.text.includes("bookstore")));
  assert.ok(candidates.some((c) => c.text === "magazine"));
});

test("a stem's topic candidates keep two-word phrases ahead of their own first word", () => {
  const options = [{ label: "A", text: "shop" }, { label: "B", text: "closet" }];
  const candidates = stemTopicCandidates("Where do you store fast food restaurant supplies?", options);
  const twoWordIndex = candidates.findIndex((c) => c.text === "fast food");
  const oneWordIndex = candidates.findIndex((c) => c.text === "fast");
  assert.ok(twoWordIndex !== -1 && oneWordIndex !== -1);
  assert.ok(twoWordIndex < oneWordIndex);
});

test("a stem made only of stopwords yields no topic candidate", () => {
  const options = [{ label: "A", text: "yes" }, { label: "B", text: "no" }];
  assert.deepEqual(stemTopicCandidates("What do you do?", options), []);
});

test("constraint terms exclude the topic's own words", () => {
  const options = [{ label: "A", text: "forest" }, { label: "B", text: "field" }];
  const terms = stemConstraintTerms("Where can you find a snake in tall grass?", "snake", options);
  assert.ok(!terms.includes("snake"));
  assert.ok(terms.includes("tall"));
  assert.ok(terms.includes("grass"));
});

test("the same stem twice yields the same candidate order", () => {
  const options = [{ label: "A", text: "kitchen" }, { label: "B", text: "garage" }];
  const stem = "Where is a kettle usually kept near the stove?";
  const first = stemTopicCandidates(stem, options);
  const second = stemTopicCandidates(stem, options);
  assert.deepEqual(first, second);
});

// ---- the exported bounds are the numbers the tests above rely on ----

test("the exported option bounds match what the option-count declines test against", () => {
  assert.equal(CHOICE_MIN_OPTIONS, 2);
  assert.equal(CHOICE_MAX_OPTIONS, 6);
});
