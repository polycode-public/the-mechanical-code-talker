// memory/trust.mjs — deterministic, explainable, auditable trust over a
// Fact's Sources. Trust = f(source-type prior, noisy-OR corroboration,
// recency decay), nudged by each Source's mgx:sourceReliability (neutral 1.0
// when absent). Entailed facts: min(premise trusts) × rule-confidence when
// premises are supplied, else the bare entailed prior. Pure, import-free of
// core.mjs; core.mjs materialises the result onto the Fact.

export const TRUST_SCORE_PROP = "mgx:trustScore";
export const TRUST_INPUTS_PROP = "mgx:trustInputs";

export const CREATED_AT_PROP = "mgx:createdAt";           // first-write-wins ISO-8601 on every individual
// For call sites that mutate an individual's own attributes without touching
// an edge (upsertSession, recomputeFactTrust, recomputeSourceReliability),
// where codegraph.mjs's derived-updatedAt rule alone can't see the change.
export const UPDATED_AT_PROP = "mgx:updatedAt";

/** Parse the "chat" shape both provenanceTag and teachProvenanceTag emit —
 *  `<source>[:<sessionId>][@<ts>]` — into { createdAt, sessionId? }. */
function parseChatTagRest(rest) {
  const at = rest.indexOf("@");
  const beforeAt = at >= 0 ? rest.slice(0, at) : rest;
  const createdAt = at >= 0 ? rest.slice(at + 1) : "";
  const colon = beforeAt.indexOf(":");
  const sessionId = colon >= 0 ? beforeAt.slice(colon + 1) : "";
  return { createdAt, ...(sessionId ? { sessionId } : {}) };
}

/** The segment a relabeled peer tag carries its origin's stable node id in.
 *  Chosen so the shipped parser above needs no change to tolerate it: it takes
 *  everything between the first `:` and the `@` as one opaque session slot, so
 *  a reader that predates this segment reads `<name>#node:<id>` whole and still
 *  keys on something node-unique. */
const PEER_NODE_MARKER = "#node:";
const PEER_TAG_PREFIX = "peer:";

/** `peer:<displayName>#node:<nodeId>@<ts>` — the wire shape a broadcasting peer
 *  relabels its own teach/operator tags into. The node id is the origin's
 *  stable identity and the only part that keys the Source; the display name is
 *  user-chosen, mutable and collidable, so it records who to SHOW, not who it
 *  is — the same discipline `child:`'s term and `world:`'s turn segments hold.
 *  Null for anything without the segment, so an older peer tag falls through to
 *  the plain teach parse unchanged. */
function parsePeerNodeTagRest(rest) {
  if (!rest.startsWith(PEER_TAG_PREFIX)) return null;
  const at = rest.indexOf("@");
  const beforeAt = at >= 0 ? rest.slice(0, at) : rest;
  const createdAt = at >= 0 ? rest.slice(at + 1) : "";
  const marker = beforeAt.indexOf(PEER_NODE_MARKER);
  if (marker < 0) return null;
  const nodeId = beforeAt.slice(marker + PEER_NODE_MARKER.length);
  if (!nodeId) return null;
  return { kind: "teachNode", nodeId, displayName: beforeAt.slice(PEER_TAG_PREFIX.length, marker), createdAt };
}

/**
 * Parse one legacy provenance TAG into a Source descriptor over the closed
 * kind set (the kinds SOURCE_PRIOR scores):
 *   corpus:conceptnet /r/IsA   -> { kind:"corpus",   name:"conceptnet" }
 *   corpus-weak:conceptnet /r/RelatedTo -> { kind:"corpusWeak", name:"conceptnet" }
 *   child:conceptnet:<term>    -> { kind:"corpus",   name:"conceptnet" }
 *     (the lazy child triples pack is curated ConceptNet — same corpus tier,
 *      same 0.7 prior, same shared Source as the bulk conceptnet import; the
 *      <term> segment records which miss pulled the fact in and is not part of
 *      the Source identity)
 *   world:<name>[:turnN]       -> { kind:"corpus",   name:<name> }
 *     (a loaded world's facts are first-party authored shipped content — the
 *      same tier the hand-written tier2 corpus already scores at; the :turnN
 *      segment a snapshot write carries records when, not who, and is not
 *      part of the Source identity)
 *   mud:<character>[:epochE][:turnN][:gone] -> { kind:"corpus", name:"mud:<character>" }
 *     (one character's own testimony in a multi-character world — what it told
 *      someone, what it examined for itself, and with `:gone` what it saw leave
 *      the world. Same tier as the world, but one Source per character; the
 *      `mud:` prefix in the name keeps that Source apart from a world of the
 *      same literal name. The trailing segments say which run of the world it
 *      was, when, and what — none of them says who, so none is part of the
 *      Source identity)
 *   ace:chat:<session>@<ts>    -> { kind:"operator",  createdAt:<ts>, sessionId:<session> }
 *   teach:chat:<session>@<ts>  -> { kind:"teach",     createdAt:<ts>, sessionId:<session> }
 *   teach:peer:<name>#node:<id>@<ts>
 *                              -> { kind:"teachNode", nodeId:<id>, displayName:<name>, createdAt:<ts> }
 *     (a peer's own tag, relabeled for the wire by whichever node authored it.
 *      The node id keys the Source; the display name is presentation only. A
 *      peer tag with no `#node:` segment predates the segment and parses as a
 *      plain "teach" whose session slot is the whole name — which is what lets
 *      old and new readers share one wire.)
 *   web:<url> | url:<url>      -> { kind:"web",       url:<url> }
 *   reference:<pack>:<article>[@revid] -> { kind:"reference", pack, article }
 *     (split on the first two colons only; the article keeps any @revid and
 *      any spaces — "reference:simplewiki:Polar bear@912" stays one article)
 *     EXCEPT the live-Wikipedia pack: reference:wikipedia-live:<article> parses
 *      as kind "referenceLive", which scores below the curated revision-pinned
 *      pack, so a live lookup never outranks the shipped article on the same term.
 *   extracted:<file-basename>  -> { kind:"extracted", name:<file-basename> }
 *   optimistic-extract:<file-basename> -> { kind:"optimisticExtract", name }
 *     (the fuzzy tier of `tmct extract --optimistic`: a candidate the strict
 *      recognizer skipped, stored under its OWN low prior so it never
 *      corroborates a curated pack — no operator/teach tag rides alongside)
 *   entailed:<rule>            -> { kind:"entailed",  rule:<rule> }
 * chat:/session: refs map to the operator; an unknown tag -> null (no Source).
 */
// The one reference pack whose content is fetched live at query time rather
// than shipped revision-pinned. Its facts score at the referenceLive prior
// (below curated `reference`), so a live lookup never outranks the shipped pack.
// Must equal reference-pack.mjs's LIVE_PACK_NAME; kept as a local literal so
// trust.mjs stays import-free of the lexicon-loading pack module.
const LIVE_REFERENCE_PACK = "wikipedia-live";
const referenceKindFor = (pack) => (pack === LIVE_REFERENCE_PACK ? "referenceLive" : "reference");

export function provenanceTagToSource(tag) {
  const t = String(tag || "").trim();
  if (!t) return null;
  if (t.startsWith("reference:")) {
    // parsed from the FULL tag, not the whitespace-split head: an article
    // title may contain spaces ("Polar bear@912").
    const rest = t.slice("reference:".length);
    const colon = rest.indexOf(":");
    if (colon < 0) return { kind: "reference", pack: rest || "unknown", article: "" };
    const pack = rest.slice(0, colon) || "unknown";
    return { kind: referenceKindFor(pack), pack, article: rest.slice(colon + 1) };
  }
  // research:<topic>@<depth> — the research lane's Simple English Wikipedia
  // loads. Live-fetched at query time like the wikipedia-live pack, so it
  // scores at the same referenceLive prior, below every curated pack. Parsed
  // from the FULL tag (a topic may contain spaces); the depth segment records
  // how far the fan-out reached and is not part of the Source identity.
  if (t.startsWith("research:")) {
    const rest = t.slice("research:".length);
    const at = rest.lastIndexOf("@");
    const topic = (at >= 0 ? rest.slice(0, at) : rest).trim();
    return { kind: "referenceLive", pack: "research", article: topic || "unknown" };
  }
  const head = t.split(/\s+/)[0]; // drop trailing " /r/IsA" etc.
  if (head.startsWith("corpus-weak:")) return { kind: "corpusWeak", name: head.slice("corpus-weak:".length) || "unknown" };
  if (head.startsWith("corpus:")) return { kind: "corpus", name: head.slice("corpus:".length) || "unknown" };
  // child:<pack>:<term> — the lazy child triples pack, scored at the corpus tier
  // under the pack's shared Source; the per-term tail is dropped from the id.
  if (head.startsWith("child:")) return { kind: "corpus", name: head.slice("child:".length).split(":")[0] || "unknown" };
  // world:<name>[:turnN] — a loaded world's facts and snapshots, first-party
  // authored shipped content scored at the corpus tier; the per-turn tail is
  // dropped from the id so every write of one world corroborates one Source.
  if (head.startsWith("world:")) return { kind: "corpus", name: head.slice("world:".length).split(":")[0] || "unknown" };
  // mud:<character>[:epochE][:turnN] — one character's own testimony inside a multi-
  // character world: what it told another character, and what it saw for
  // itself. Same corpus tier as the world it stands in, but a Source per
  // CHARACTER, so every claim an animal makes over a whole game accumulates on
  // that animal's own track record rather than the world's. The name keeps the
  // `mud:` prefix so `src:corpus:mud:<character>` can never collide with a
  // `world:<name>` Source that happens to share the literal name.
  if (head.startsWith("mud:")) return { kind: "corpus", name: `mud:${head.slice("mud:".length).split(":")[0] || "unknown"}` };
  if (head.startsWith("ace:")) return { kind: "operator", ...parseChatTagRest(head.slice("ace:".length)) };
  if (head.startsWith("teach:")) {
    const rest = head.slice("teach:".length);
    // teach:peer:<name>#node:<id>@<ts> — a peer's own relabeled tag off the
    // wire, keyed on the node id rather than the name beside it.
    const peerNode = parsePeerNodeTagRest(rest);
    if (peerNode) return peerNode;
    // the chat teach lane's natural frames — chat.mjs's teachProvenanceTag
    return { kind: "teach", ...parseChatTagRest(rest) };
  }
  if (head.startsWith("web:")) return { kind: "web", url: head.slice("web:".length) };
  if (head.startsWith("url:")) return { kind: "web", url: head.slice("url:".length) };
  if (head.startsWith("optimistic-extract:")) return { kind: "optimisticExtract", name: head.slice("optimistic-extract:".length) || "unknown" };
  if (head.startsWith("extracted:")) return { kind: "extracted", name: head.slice("extracted:".length) || "unknown" };
  if (head.startsWith("entailed:")) return { kind: "entailed", rule: head.slice("entailed:".length) };
  if (head.startsWith("chat:") || head.startsWith("session:") || head.startsWith("operator")) return { kind: "operator" };
  return null;
}

/** Source-type priors — computed from the Source's type only, never hand-set
 *  on a Fact directly. */
export const SOURCE_PRIOR = Object.freeze({
  operator: 1.0,
  teach: 0.95,
  provider: 0.9,
  corpus: 0.7,
  reference: 0.6,
  corpusWeak: 0.55,
  referenceLive: 0.5,
  extracted: 0.45,
  web: 0.4,
  optimisticExtract: 0.35,
  entailed: 0.3,
});

const RECENCY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const RECENCY_FLOOR = 0.9; // recency multiplier stays within [0.9, 1.0]

// Actor-level (session-scoped) trust — a bounded nudge on a Source's type
// prior. Neutral (1.0) until core.mjs's recomputeSourceReliability writes it,
// so this stays additive-safe.
export const SOURCE_RELIABILITY_MIN = 0.5;
export const SOURCE_RELIABILITY_MAX = 1.5;
export const SOURCE_RELIABILITY_NEUTRAL = 1.0;

const round = (n, p = 6) => Number(n.toFixed(p));
const sourceTypeOf = (s) => (s?.attributes || []).find((a) => a.prop === "mgx:sourceType")?.value || "";

/** A Source's reliability multiplier: raw mgx:sourceReliability, clamped to
 *  [SOURCE_RELIABILITY_MIN, MAX], or neutral 1.0 when absent/unparseable. */
function sourceReliabilityOf(s) {
  const raw = (s?.attributes || []).find((a) => a.prop === "mgx:sourceReliability")?.value;
  if (raw === undefined) return SOURCE_RELIABILITY_NEUTRAL;
  const n = Number(raw);
  if (!Number.isFinite(n)) return SOURCE_RELIABILITY_NEUTRAL;
  return Math.max(SOURCE_RELIABILITY_MIN, Math.min(SOURCE_RELIABILITY_MAX, n));
}

/** Bounded recency multiplier in [RECENCY_FLOOR, 1], half-life decayed from
 *  createdAt. An unparseable timestamp yields 1.0 (no penalty). */
export function recencyNudge(createdAt, now = Date.now(), halfLifeMs = RECENCY_HALF_LIFE_MS) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return 1;
  const ageMs = Math.max(0, now - t);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * Pure trust for one Fact. `fact` supplies `{ sourceIds: [...], createdAt }`;
 * Source individuals resolve from `sourcesById` ({ id: Source }). Distinct
 * sources are corroborated by noisy-OR over their type priors and nudged by
 * recency. Deterministic given the same inputs and `opts.now`.
 *
 * opts: now, halfLifeMs, premiseTrusts/ruleConfidence (entailed hook).
 * Returns { score, inputs } — inputs recorded for audit.
 */
export function computeTrust(fact, sourcesById = {}, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const ids = Array.isArray(fact?.sourceIds) ? fact.sourceIds : [];

  // distinct sources -> type priors × mgx:sourceReliability, clamped to [0,1]
  const seen = new Set();
  const types = [];
  const priors = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const source = sourcesById[id];
    const t = sourceTypeOf(source);
    if (!t) continue;
    types.push(t);
    const p = (SOURCE_PRIOR[t] ?? 0) * sourceReliabilityOf(source);
    priors.push(Math.max(0, Math.min(1, p)));
  }

  // corroboration via noisy-OR over distinct-source EFFECTIVE priors, capped at 1
  let base = 0;
  let complement = 1;
  for (const p of priors) complement *= 1 - p;
  if (priors.length) base = Math.min(1, 1 - complement);

  // entailed hook (tier-5): a conclusion is only as trustworthy as its weakest
  // premise × the rule confidence. Engages only when premises are supplied;
  // otherwise an entailed fact rides its bare prior through the noisy-OR above.
  if (types.includes("entailed") && Array.isArray(opts.premiseTrusts) && opts.premiseTrusts.length) {
    const rc = typeof opts.ruleConfidence === "number" ? opts.ruleConfidence : 1;
    base = Math.max(0, Math.min(1, Math.min(...opts.premiseTrusts) * rc));
  }

  const recency = recencyNudge(fact?.createdAt, now, opts.halfLifeMs);
  const score = round(Math.min(1, base * recency));
  const inputs = {
    sourceTypes: types.slice().sort(),
    corroboration: types.length,
    createdAt: fact?.createdAt || "",
    recency: round(recency),
  };
  return { score, inputs };
}

/** One assertion record's OWN effective prior: its single source's type prior,
 *  nudged by that source's own reliability, clamped to [0,1]. A write-time
 *  constant — recency is deliberately absent, because recency is a function of
 *  the READING moment, not the writing one, and a stored number that bakes it
 *  in is already wrong by the time anyone reads it. `source` is that record's
 *  own Source individual; an absent/unknown one reads as the neutral 1.0. */
export function assertionPrior(sourceType, source) {
  const p = (SOURCE_PRIOR[sourceType] ?? 0) * sourceReliabilityOf(source);
  return round(Math.max(0, Math.min(1, p)));
}

/**
 * Trust for one assertion GROUP — every live head sharing a triple hash, one
 * record per asserting source. Noisy-OR over each record's own effective prior,
 * each decayed by ITS OWN assertion time rather than the group's first write:
 * every hop ages separately, so a fresh assertion is no longer dragged down by
 * an old corpus record's timestamp beside it.
 *
 * `records` supplies `{ ownTrust, assertedAt, sourceId?, sourceType? }` per
 * head. Deterministic given the same inputs and `opts.now`. Returns
 * { score, inputs }, inputs in the per-record order it was handed.
 */
export function computeAssertionGroupTrust(records, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const heads = Array.isArray(records) ? records : [];
  let complement = 1;
  const inputs = [];
  for (const r of heads) {
    const recency = recencyNudge(r?.assertedAt, now, opts.halfLifeMs);
    const own = Math.max(0, Math.min(1, Number(r?.ownTrust) || 0));
    complement *= 1 - Math.max(0, Math.min(1, own * recency));
    inputs.push({
      sourceId: r?.sourceId || "", sourceType: r?.sourceType || "",
      ownTrust: own, recency: round(recency),
    });
  }
  return { score: heads.length ? round(Math.min(1, 1 - complement)) : 0, inputs };
}

// Laplace/"add-k" pseudo-count: without it a single data point would saturate
// mgx:sourceReliability to the bare max/min immediately.
const RELIABILITY_CONFIDENCE_PSEUDOCOUNT = 19;

/** Pure actor-level reliability from a session's asserted-vs-contradicted
 *  track record (findContradictions, core.mjs), confidence-scaled by sample
 *  size so a thin record stays near neutral (1.0). Bounded to
 *  [SOURCE_RELIABILITY_MIN, MAX]. A contradicted fact costs double an
 *  asserted one's weight. */
export function sessionReliabilityFrom({ factsAsserted = 0, factsContradicted = 0 } = {}) {
  const asserted = Math.max(0, Number(factsAsserted) || 0);
  const contradicted = Math.max(0, Number(factsContradicted) || 0);
  const net = Math.max(-1, Math.min(1, (asserted - 2 * contradicted) / Math.max(1, asserted)));
  const confidence = asserted / (asserted + RELIABILITY_CONFIDENCE_PSEUDOCOUNT);
  const ratio = (net * confidence + 1) / 2;
  return round(SOURCE_RELIABILITY_MIN + (SOURCE_RELIABILITY_MAX - SOURCE_RELIABILITY_MIN) * ratio);
}
