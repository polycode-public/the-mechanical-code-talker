// hub-terms.mjs — the class-hierarchy terms too abstract for a plain-English
// answer to climb into, whichever caller is walking a superclass chain. A
// leaf module (no imports) so both the persona-tier curator (a corpus build
// script, heavy WordNet-walking logic that has no business in a browser
// bundle) and sense-split.mjs's runtime chain walker (bundled client-side by
// the digest layer) can depend on the same set without either pulling in
// the other's weight.

// human-base's own category roots, plus every hypernym TARGET term Small's
// curation already established as a "root" word (generate.mjs's own comment:
// "category-root nouns used as a hypernym TARGET") — a real hypernym chain
// walk stops here rather than continuing on to WordNet's ultra-abstract
// "entity"/"abstraction"/"physical_entity" tops, which would add depth
// without adding anything a plain-English question would ever ask about.
export const STOP_SET = new Set([
  "person", "place", "object", "event", "time", "quantity", "organization", "group",
  "animal", "plant", "furniture", "vehicle", "insect", "emotion", "metal", "liquid",
  "weather", "planet", "jewelry", "cutlery", "government", "material", "artifact",
  "location", "structure", "food", "drink", "clothing", "body", "language", "mind",
  "family", "meal", "season", "number", "entity", "abstraction", "physical_entity",
  "attribute", "state", "act", "communication", "cognition", "measure", "unit",
]);

// A wider hub set for a chat ANSWER's own chain rendering, where the climb
// walks further than the persona-tier corpus curation ever needs to: without
// it a plain "what is a letter" chain runs on past "character" into
// "property → concept → idea → content", each step less concrete than the
// last. STOP_SET itself stays exactly as the persona-tier curator reads it.
export const ANSWER_STOP_SET = new Set([...STOP_SET, "property", "concept", "idea", "content"]);
