// fact-phrase.mjs — the one predicate -> English-phrase table, shared by the
// news paraphrase renderer and chat's own fact read-back instead of growing a
// twin. chat.mjs imports FACT_PREDICATE_PHRASES from here rather than holding
// its own copy.
//
// This module's own `predicatePhrase`/`factSentence` are the plain reader a
// domain module can offer without chat.mjs's surrounding machinery (polarity
// flips, comparative/participle surface forms, teach-lane verb minting): a
// table hit, or the predicate's bare local name.

export const FACT_PREDICATE_PHRASES = Object.freeze({
  "rdfs:subClassOf": "is a kind of",
  "mgxneg:subClassOf": "is not a kind of",
  "rdf:type": "is a",
  "owl:disjointWith": "is not a",
  "owl:unionOf": "is either",
  "owl:complementOf": "is anything that is not",
  "owl:oneOf": "includes exactly",
  "owl:differentFrom": "is not the same as",
  "mgx:partOf": "is part of",
  "mgx:memberOf": "is a member of",
  "mgx:collectionOf": "is a collection of",
  "mgx:hasA": "has",
  "mgx:usedFor": "is used for",
  "mgx:capableOf": "can",
  "mgx:atLocation": "is found in",
  "mgx:causes": "causes",
  "mgx:hasProperty": "is",
  "mgx:madeOf": "is made of",
  "mgx:receivesAction": "can be",
  "mgx:createdBy": "is created by",
  "mgx:mannerOf": "is a way to",
  "mgx:desires": "wants",
  "mgx:locatedNear": "is typically near",
  "mgx:motivatedByGoal": "is motivated by",
  "mgx:obstructedBy": "can be prevented by",
  "mgx:causesDesire": "makes you want to",
  "mgx:hasSubevent": "involves",
  "mgx:hasFirstSubevent": "begins with",
  "mgx:hasLastSubevent": "ends with",
  "mgx:hasPrerequisite": "requires",
  "mgx:ownedBy": "is owned by", // the teach lane's ownership frame ("Priya owns tasks.mjs")
  "mgx:rendersAs": "renders as", // the render-template binding ("a disk renders as a block")
  "mgx:synonym": "means the same as",
  "mgx:antonym": "is the opposite of",
  "mgx:similarTo": "is similar to",
  "mgx:relatedTo": "is related to",
  "mgx:symbolOf": "is a symbol of",
  "mgx:currently-in": "is in",
  "mgx:located-in": "is in",
  "mgx:fixed-in": "is fixed in",
  "mgx:stands-locked-in": "stands locked in",
  "mgx:works-in": "works in",
});

/** A table hit, or the predicate's local name (the segment after its first
 *  colon, or the whole string when there is none). */
export function predicatePhrase(predicate) {
  if (FACT_PREDICATE_PHRASES[predicate]) return FACT_PREDICATE_PHRASES[predicate];
  const s = String(predicate ?? "");
  const colon = s.indexOf(":");
  return colon === -1 ? s : s.slice(colon + 1);
}

/** "a heart has a valve" from one { subject, predicate, object } fact row. */
export function factSentence(row) {
  return `${row.subject} ${predicatePhrase(row.predicate)} ${row.object}`;
}
