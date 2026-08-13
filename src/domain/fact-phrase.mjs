// fact-phrase.mjs — the one predicate -> English-phrase table AND the one
// reader over it. The news paraphrase renderer, the news page's own inline
// script and chat.mjs's answer path all render a stored fact through the
// functions below, so no two surfaces can disagree about what a predicate
// says in English.
//
// The reader is layered: a curated table hit first, then the mechanical
// surface forms for the predicates tmct MINTS at teach time (polarity flips,
// comparatives, participle + preposition, "same <attribute> as", and the
// "mgx:<lemma>[-<prep>]" verb fold), and last the predicate's bare local
// name. Every layer is mechanical — a phrase is derived from the predicate or
// it is the predicate's own local name. Nothing here guesses.

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
  "mgx:nameFor": "is the name for", // the definitional frame's edge ("latency is the name for time period")
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
  "mgx:pursues": "pursues",
  "mgx:evades": "evades",
  "mgx:consumes": "eats",
  "mgx:vision-radius": "sees within",
  "mgx:guards": "guards",
});

/** The closed participle set the relational teach frames read as "X is
 *  <participle> <prep> Y" — a past participle whose own form is the word, so it
 *  reads back with no morphology. Closed by list (templates over general
 *  grammar), so the frame can never widen onto an arbitrary "-ed" adjective.
 *  The teach parser mints predicates from this list and the reader below turns
 *  them back into English, so both read the one vocabulary. */
export const TEACH_PARTICIPLE_SRC = "connected|related|associated|linked|based|derived|composed|made|used|known|located|found|involved|concerned";

/** The participles a news report's agentless passive states its subject's own
 *  condition with — "is banned from", "was deported to". One per verb in the
 *  extractor's closed newswire event band, so the same list that decides which
 *  events read also decides which passives read back as English. Kept apart
 *  from TEACH_PARTICIPLE_SRC because the teach lane parses that list into its
 *  own frames and nothing should widen those by writing here. */
export const NEWS_PASSIVE_PARTICIPLE_SRC = [
  "hit", "struck", "killed", "injured", "wounded", "damaged", "destroyed", "devastated",
  "banned", "halted", "blocked", "barred", "suspended", "imposed",
  "arrested", "detained", "jailed", "charged", "convicted", "sentenced", "deported", "released", "freed",
  "elected", "appointed", "ousted", "overthrown",
  "signed", "adopted", "approved", "rejected", "vetoed",
  "launched", "unveiled", "seized", "captured", "invaded", "attacked", "bombed", "targeted",
  "discovered", "uncovered", "rescued", "evacuated",
  "sparked", "triggered", "caused", "forced", "deployed", "restored", "expanded",
].join("|");

/** The MECHANICAL fallback for a predicate the table has no curated entry
 *  for — specifically the minted "mgx:<lemma>" predicates ("mgx:eat",
 *  "mgx:drive", …) — the mechanical INVERSE of the naive -s/-es/-ies fold the
 *  teach lane's own singularizer uses, same accepted-limitation trade (no real
 *  morphology; a handful of doubly-irregular verbs render slightly off but
 *  never wrong-MEANING). "has"/"have" never reach this fallback — the teach
 *  lane special-cases them onto the CURATED mgx:hasA entry above before a
 *  predicate is ever minted. */
export function thirdPersonSingularSurface(lemma) {
  const w = String(lemma || "");
  // "have" should never reach this naive fallback at all (the teach lane
  // special-cases it onto mgx:hasA before a predicate is ever minted), but if
  // some OTHER path ever reaches here with it as typed — e.g. wink-nlp
  // unavailable so the lemma degrades to the raw verb — the naive "+s" rule
  // would produce the wrong-MEANING "haves" instead of the correct "has".
  if (/^have$/i.test(w)) return "has";
  if (/[a-z]y$/i.test(w) && !/[aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh|o)$/i.test(w)) return `${w}es`;
  return `${w}s`;
}

/** The INVERSE of thirdPersonSingularSurface — "eats" -> "eat", "flies" ->
 *  "fly", "has" -> "have". Do-support wants the bare infinitive after it
 *  ("does not EAT", never "does not eats"), and so does every derived
 *  forward yes/no reader ("does X cause Y"), so both fold through this one
 *  function and can never drift apart on a verb. */
export function baseVerbSurface(verb) {
  const w = String(verb || "");
  if (/^has$/i.test(w)) return "have";
  if (/[a-z]ies$/i.test(w) && !/[aeiou]ies$/i.test(w)) return `${w.slice(0, -3)}y`;
  if (/(?:ss|zz|x|ch|sh|o)es$/i.test(w)) return w.slice(0, -2);
  // A SINGLE s or z before "es" means the base already ended in "e" and took a
  // plain "s": cause/use/raise/size, not caus/us/rais/siz. Only the doubled
  // sibilants above ("passes", "buzzes") really carry an "-es" ending.
  if (/[sz]es$/i.test(w)) return w.slice(0, -1);
  return w.replace(/s$/i, "");
}

/** The gerund surface of a 3sg-minted role predicate — "contains" ->
 *  "containing", "touches" -> "touching" — the naive INVERSE of the
 *  "-ing"-stripping fold the ACE parser already accepts alongside a 3sg
 *  surface. Same accepted naive-morphology trade as its two siblings above. */
export function gerundVerbSurface(verb) {
  const base = baseVerbSurface(verb);
  return /[^aeiou]e$/i.test(base) && base.length > 2 ? `${base.slice(0, -1)}ing` : `${base}ing`;
}

/** Irregular plural nouns whose surface carries no "-s" at all, so the suffix
 *  check in isSubjectPlural below would read them as singular. A small closed
 *  table, not this file's own pluralizer — it answers one question only
 *  ("is this head noun plural"), never generates a form. */
const IRREGULAR_PLURAL_NOUNS = new Set([
  "people", "men", "women", "children", "mice", "geese", "feet", "teeth", "oxen",
]);

/** Nouns that end in "s" but stay grammatically SINGULAR ("the news
 *  spreads", not "the news spread") — the suffix check below would otherwise
 *  misread them as plural. */
const SINGULAR_NOUNS_ENDING_S = new Set([
  "news", "physics", "species", "series", "means", "measles", "mathematics", "politics", "economics",
]);

/**
 * Is a stored fact's SUBJECT text grammatically plural, for the one thing
 * this file needs it for: choosing a minted verb's surface form. Reads the
 * HEAD noun only — the word right after any leading article, before a
 * trailing "of ..." phrase, so "the group of scientists" agrees on "group"
 * ("the group of scientists reports"), not "scientists". From there: the
 * closed irregular table above, then the regular "-s" suffix, same
 * naive-morphology trade thirdPersonSingularSurface already takes above. A
 * subject this can't read (empty, or a plural-invariant noun like "sheep")
 * defaults to singular — English's own unmarked form, and also this file's
 * pre-existing default for every caller that passes no subject at all.
 */
export function isSubjectPlural(subject) {
  const head = String(subject || "").trim().replace(/^(?:the|a|an)\s+/i, "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!head) return false;
  if (IRREGULAR_PLURAL_NOUNS.has(head)) return true;
  if (SINGULAR_NOUNS_ENDING_S.has(head)) return false;
  return /[a-z]s$/.test(head) && !/ss$/.test(head);
}

/**
 * How a stored predicate reads in English: a curated table hit, else the
 * mechanical surface form of a minted predicate, else the predicate's local
 * name (the segment after its first colon, or the whole string when there is
 * none). The local-name tail is what keeps a namespace tmct itself mints —
 * `tmct:needs`, stamped by the lexicon — out of a public-facing sentence.
 *
 * `subject` is optional and used ONLY by the minted "mgx:<lemma>" verb fold
 * (and the do-support it derives under negation): a plural subject reads the
 * lemma's bare form ("scientists report"), anything else reads its
 * third-person-singular fold ("an earthquake strikes"). A CURATED phrase is
 * returned exactly as written regardless of subject — the table is fixed
 * English on purpose, no morphology applied to it here or anywhere else.
 * Callers with no subject to offer (most of chat.mjs's call sites, which
 * render a bare predicate with no sentence around it) get today's singular
 * default, unchanged.
 *
 * Self-contained on purpose: the news page runs this exact function in the
 * browser (phraseRendererSource below stringifies it and everything it calls
 * into), so it reaches for nothing outside this module.
 */
export function predicatePhrase(predicate, subject) {
  if (FACT_PREDICATE_PHRASES[predicate]) return FACT_PREDICATE_PHRASES[predicate];
  const p = String(predicate ?? "");
  // NEGATIVE polarity renders as its own positive phrase, negated — ONE branch
  // for every predicate that can carry a polarity, curated or minted. The
  // negative twins are deliberately absent from FACT_PREDICATE_PHRASES: chat's
  // query-marker families all derive their vocabulary from that table, so an
  // entry there would auto-mint readers for "what cannot X" and "does X cannot
  // Y" that nobody wrote and nothing pins. The prefix swap is the whole rule
  // here because the one polarity pair that ISN'T a prefix swap
  // (mgxneg:subClassOf / rdfs:subClassOf) carries its own curated entry above
  // and returns before this branch.
  // The three surface shapes split as the forward yes/no readers split them,
  // for the same reason: a modal, a copula and a plain verb take different
  // negations, and nothing else does.
  if (p.startsWith("mgxneg:")) {
    const phrase = predicatePhrase(`mgx:${p.slice("mgxneg:".length)}`, subject);
    if (phrase === "can") return "cannot";
    if (phrase === "can be") return "cannot be";
    if (phrase === "is" || phrase.startsWith("is ")) return `is not${phrase.slice(2)}`;
    const [head, ...tail] = phrase.split(" ");
    const doSupport = isSubjectPlural(subject) ? "do not" : "does not";
    return [doSupport, baseVerbSurface(head), ...tail].join(" ");
  }
  // a comparative renders as its copula surface: mgx:smaller-than ->
  // "is smaller than" (never a 3sg fold — "smallers" isn't a word)
  const comp = /^mgx:([a-z]+(?:-[a-z]+)*)-than$/i.exec(p);
  if (comp) return `is ${comp[1].replace(/-/g, " ")} than`;
  // a participle + preposition renders as its copula surface: mgx:connected-with
  // -> "is connected with" (the participle is already a participle, so no 3sg
  // fold — "connecteds" isn't a word)
  const part = new RegExp(`^mgx:(${TEACH_PARTICIPLE_SRC}|${NEWS_PASSIVE_PARTICIPLE_SRC})-([a-z]+)$`, "i").exec(p);
  if (part) return `is ${part[1].toLowerCase()} ${part[2].toLowerCase()}`;
  // a shared-attribute predicate: mgx:same-goal-as -> "has the same goal as"
  const same = /^mgx:same-([a-z]+)-as$/i.exec(p);
  if (same) return `has the same ${same[1].toLowerCase()} as`;
  // a folded preposition renders back naturally: mgx:rest-on -> "rests on"
  // (subject-verb agreement lives here alone: mgx:<lemma> is minted from the
  // verb's OWN base form, so a plural subject reads it bare — "scientists
  // report" — and anything else takes the 3sg fold — "an earthquake strikes")
  const minted = /^mgx:([a-z]+)(?:-([a-z]+))?$/i.exec(p);
  if (minted) {
    const verb = isSubjectPlural(subject) ? minted[1] : thirdPersonSingularSurface(minted[1]);
    return `${verb}${minted[2] ? ` ${minted[2]}` : ""}`;
  }
  // The lexicon's own minted verb predicates come pre-inflected: it builds
  // "tmct:<3sg>[<Prep>]" from a declared verb, so "release" is stored as
  // "tmct:releases" and "rely" + "on" as "tmct:reliesOn". Singular subjects
  // read that surface as it stands. A plural one takes the bare form through
  // baseVerbSurface, the documented inverse of the fold that made it, so
  // "rescuers release" comes out of the same rule that gives "rescuers report".
  // The camel-cased preposition is its own word in a sentence.
  const declared = /^tmct:([a-z]+)([A-Z][a-z]+)?$/.exec(p);
  if (declared) {
    const verb = isSubjectPlural(subject) ? baseVerbSurface(declared[1]) : declared[1];
    return `${verb}${declared[2] ? ` ${declared[2].toLowerCase()}` : ""}`;
  }
  const colon = p.indexOf(":");
  return colon === -1 ? p : p.slice(colon + 1);
}

/** "a heart has a valve" from one { subject, predicate, object } fact row —
 *  "scientists report a finding" for a plural row.subject, off the same
 *  agreement rule in predicatePhrase above. */
export function factSentence(row) {
  return `${row.subject} ${predicatePhrase(row.predicate, row.subject)} ${row.object}`;
}

/**
 * The short curated caveat each KEPT extraction finding reads as beside a
 * citation. One template per finding, byte-pinned, so an answer that leans on a
 * row the extractor had something to say about says so in the same words every
 * time.
 *
 * `definitional-frame` is deliberately absent: its own phrase ("is the name
 * for") already says how the row was read, so a caveat would repeat it. So are
 * the decline reasons — a declined candidate was never stored, so no answer can
 * lean on it.
 */
export const FINDING_CAVEATS = Object.freeze({
  "clause-fallback": "(read from a clause fragment)",
  "pronoun-carry": "(subject carried from the previous sentence)",
  "identifier-token": "(identifier token)",
});

/**
 * The caveat text for one fact row's findings, or "" when it has none to
 * declare. Takes a row ({ extraction: [...] }, readFactRows' shape), a bare
 * finding name, or a list of them, so a renderer can pass whatever it holds.
 *
 * A row carrying several findings reads them in the table's own order above,
 * never the row's, so the same finding set always renders the same string.
 * Returns the caveats alone — the caller owns the space before them and the
 * citation after.
 */
export function findingCaveat(finding) {
  const named = typeof finding === "string"
    ? [finding]
    : Array.isArray(finding) ? finding : finding?.extraction;
  if (!Array.isArray(named) || !named.length) return "";
  const held = new Set(named.map((f) => String(f)));
  return Object.entries(FINDING_CAVEATS)
    .filter(([name]) => held.has(name))
    .map(([, caveat]) => caveat)
    .join(" ");
}

/** The phrase layer as browser source, for a generated page that renders fact
 *  rows in its own inline script. The page supplies FACT_PREDICATE_PHRASES
 *  (it embeds the table as JSON) and this supplies everything the reader
 *  above stands on, so a new branch here reaches the page without the page
 *  being edited. */
export function phraseRendererSource() {
  return [
    `const TEACH_PARTICIPLE_SRC = ${JSON.stringify(TEACH_PARTICIPLE_SRC)};`,
    `const NEWS_PASSIVE_PARTICIPLE_SRC = ${JSON.stringify(NEWS_PASSIVE_PARTICIPLE_SRC)};`,
    `const thirdPersonSingularSurface = ${thirdPersonSingularSurface};`,
    `const baseVerbSurface = ${baseVerbSurface};`,
    `const IRREGULAR_PLURAL_NOUNS = new Set(${JSON.stringify([...IRREGULAR_PLURAL_NOUNS])});`,
    `const SINGULAR_NOUNS_ENDING_S = new Set(${JSON.stringify([...SINGULAR_NOUNS_ENDING_S])});`,
    `const isSubjectPlural = ${isSubjectPlural};`,
    `const predicatePhrase = ${predicatePhrase};`,
    `const factSentence = ${factSentence};`,
  ].join("\n  ");
}
