# PLAN_FACT.md — one record per assertion, not one record per triple

Status: DESIGN, implementation-ready, all choices settled (operator, 2026-07-30). The engine
changes are not yet implemented; what IS landed already is the coverage that waits for them —
infbench's `c2SiblingResolution` template and `SKILL_PLAYTEST_EDGE_HUNT.md`'s sibling-resolution
axis (see Landing order). Every code claim below was verified against the real files this
session; file and line references name where. External claims cite the Sources section at the
end.

## Origin

2026-07-29 session, during a chat.html corpus-scale-up pass. The operator, looking at a worked
example of `trustInputs`, named the shape they actually want: **"trustInputs, working like a MIME
received header"** — every fact-assertion event its own append-only entry, one per hop, in order,
never merged or collapsed into a single summary. This document works out what that means for tmct's
fact model, against what's shipped today, and against the published work on the same problems.

One reading of the MIME analogy is fixed here up front, because everything else keys on it: a
`Received:` header carries one line per HOP, not one line per retransmission attempt. The unit of
record in this plan is therefore the (triple, source) pair — one record per distinct asserting
source, updated in place when that same source re-asserts — never one record per utterance of the
same claim by the same source. A repeat wave from one node is the same hop saying it again.

## The current model (shipped)

A Fact's identity is a hash of `(subject, predicate, object)` alone — nothing else
(`factIdFor`, `src/domain/hash.mjs:161`: `fact:` + 16 hex of SHA-256 over the NUL-joined triple).
`appendFacts` (`src/adapters/memory/core.mjs:1237`) upserts by that id: if the triple already
exists, the incoming provenance tag is unioned onto it (a `" | "`-joined compat string) and a new
Source is added if the tag derives a distinct Source id; if not, a new Fact is created.
`mgx:trustScore`/`mgx:trustInputs` (`src/domain/memory/trust.mjs`'s `computeTrust`) are then
recomputed over ALL distinct sources on that one id: noisy-OR over each source type's prior
(`operator` 1.0, `teach` 0.95, `provider` 0.9, `corpus` 0.7, `reference` 0.6, `corpusWeak` 0.55,
`referenceLive` 0.5, `extracted` 0.45, `web` 0.4, `optimisticExtract` 0.35, `entailed` 0.3), each
nudged by that source's own `mgx:sourceReliability`, times a recency decay off the fact's own
`createdAt`. `trustInputs` is the audit trail of that ONE computation:
`{ sourceTypes: [...distinct types], corroboration: types.length, createdAt, recency }`.

Two details of `computeTrust` re-verified this session, because later sections build on them:

- Corroboration counts distinct source **IDS**, not distinct types (`trust.mjs:187-210` — the
  `seen` set dedupes `fact.sourceIds`; every distinct id contributes its own effective prior to
  the noisy-OR). Two different teach sessions already corroborate each other today. The
  Sybil-resistance section below starts from this fact: the exposure is not new, only more
  visible under the proposed model.
- `sessionReliabilityFrom` (`trust.mjs:240-247`) treats "1 asserted, 0 contradicted" as mildly
  positive at any sample size: net 1, confidence 1/20, giving 1.025 — never neutral 1.0.

This is deliberate, not an oversight. `PLAN_MUD.md`: *"The CRDT merge function already exists.
`appendFacts`... upserts a fact by its content-addressed id... and unions the incoming provenance tag
onto whatever's already stored at that id. That's a G-Set's merge rule, byte for byte,"* and
explicitly: *"including the case where the receiving peer independently taught the identical fact —
both tags corroborate the same id, correctly."* A G-Set (grow-only set) merges idempotently and
commutatively regardless of delivery order or duplication (Shapiro, Preguiça, Baquero & Zawirski
2011 — see Sources) — exactly what a P2P mesh needs when the same fact can arrive redundantly over
multiple paths. A code comment on `findContradictions` (`core.mjs:1818`) states the underlying
principle: *"Same (s,p,o) is corroboration, not contradiction."*

Multiple records for the same `(subject, predicate)` already exist today, but only for real
disagreement: `findContradictions` keeps separate Fact records apart when the OBJECT differs (two
characters claiming different locations for something), reporting them as a group — *"both kept,
never silently resolved."* Multi-valued predicates (`mgx:hasA`, `mgx:capableOf`, and their negations
— `MULTI_VALUED_PREDICATES`, `core.mjs:1810`) are excluded from ever counting as a contradiction:
"a dog has legs AND a dog has a tail" are both true, not a disagreement.

The real worked example from this session (a peer independently teaching a fact the corpus already
had, over the real relabel-and-receive path):

```json
{
  "id": "fact:d5327019d311a956",
  "label": "dog mgx:capableOf bark",
  "class": "Fact",
  "derived_from": [], "mentions": [],
  "trustInputs": [
    { "key": "sourceTypes", "value": ["corpus", "teach"] },
    { "key": "corroboration", "value": 2 },
    { "key": "createdAt", "value": "<timestamp>" },
    { "key": "recency", "value": 1 }
  ],
  "attributes": [
    { "prop": "rdf:type", "key": "type", "value": "rdf:Statement" },
    { "prop": "rdf:subject", "key": "subject", "value": "dog" },
    { "prop": "rdf:predicate", "key": "predicate", "value": "mgx:capableOf" },
    { "prop": "rdf:object", "key": "object", "value": "bark" },
    { "prop": "mgx:createdAt", "key": "createdAt", "value": "<timestamp>" },
    { "prop": "mgx:factProvenance", "key": "provenance", "value": "corpus:human /r/CapableOf | teach:peer:scavenger-dial@<timestamp>" },
    { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "bark capableof dog mgx" },
    { "prop": "mgx:trustScore", "key": "trustScore", "value": "0.992125" },
    { "prop": "mgx:updatedAt", "key": "updatedAt", "value": "<timestamp>" }
  ]
}
```

The 0.992125 is real, not illustrative: noisy-OR of corpus's 0.7 and teach's EFFECTIVE prior
0.95 × 1.025 (the peer's Source already carried `sourceReliability: 1.025` on its first-ever fact,
per `sessionReliabilityFrom` above) gives `1 - (1-0.7)(1-0.97375) = 0.992125` exactly.

What this model cannot show: WHICH node taught it, when, distinct from the corpus's own origin —
that's compressed into one blended number and a provenance string you'd have to re-parse.

## What the literature contributes, in one paragraph each

The design below leans on five bodies of published work. Each is cited in place where it decides
something; this is the map.

- **CRDTs** (Shapiro et al. 2011). A state-based CRDT converges if merge is a join on a
  semilattice: commutative, associative, idempotent. The G-Set and the LWW-register are both
  standard types from that paper. The proposed model is a G-Set of assertion records whose
  per-record update rule is an LWW-register keyed by the origin's own embedded timestamp — both
  merges are joins, so the composition converges.
- **Riak's sibling model** (Riak docs; Preguiça, Baquero et al.'s dotted version vectors). Keep
  conflicting writes as siblings instead of guessing a winner (`allow_mult`, default true since
  Riak 2.0), resolve via a per-bucket-type strategy, and bound sibling growth to truly
  concurrent writes (DVVs exist because unbounded siblings are a real failure mode — "sibling
  explosion"). tmct takes the keep-and-resolve split and the growth warning; it does not need the
  concurrency-detection machinery, because identity partitions by source up front.
- **Truth discovery / data fusion** (Li et al. 2016 survey; Yin, Han & Yu's TruthFinder, KDD 2007;
  Dong, Berti-Équille & Srivastava, PVLDB 2009). A whole subfield estimates source reliability and
  claim truth jointly: a source is reliable if it makes true claims, a claim is likely true if
  reliable sources make it. Two findings matter here. First, per-source reliability weights belong
  in the aggregation — tmct's `sourceReliability` nudge is a small, deterministic member of that
  family. Second, and sharper: Dong et al. show corroboration is only worth anything between
  INDEPENDENT sources — copied claims must be discounted, and copying can be detected. That is the
  formal version of this plan's Sybil problem.
- **Bitemporal modeling** (Snodgrass's TSQL2 work; SQL:2011's temporal features, Kulkarni &
  Michels 2012). Valid time (when a fact held in the world) and transaction time (when the
  database recorded it) are different axes and standard SQL now carries both
  (application-time periods vs system-versioned tables). tmct's `mgx:observedAt` vs
  `mgx:createdAt` is exactly this split, simplified to an instant instead of a period.
- **Trust calculi and Sybil resistance** (Jøsang 2001 and his fusion/discounting operators;
  Douceur's Sybil attack, IPTPS 2002; Kamvar et al.'s EigenTrust, WWW 2003; Yu et al.'s
  SybilGuard, SIGCOMM 2006). Douceur's result: without a trusted authority, an attacker can always
  mint unlimited identities, so identity-count alone can never carry trust. The countermeasures
  that survive are capping what any identity class can contribute (Jøsang's discounting caps
  testimony by trust in the testifier), reputation anchored to a pre-trusted seed (EigenTrust),
  and social/invitation-graph structure (SybilGuard: Sybils mint identities freely but trust
  edges dearly). All three shapes appear in the mitigation section.

Also worth naming: per-assertion provenance for RDF triples is itself well-trodden ground — Carroll,
Bizer, Hayes & Stickler's named graphs (WWW 2005) exist precisely because a bare triple can't say
who asserted it. tmct's assertion records are a flat-file cousin of that idea: the "graph name" is
the record id's source suffix.

## The proposed model

Give every fact-ASSERTION its own record, not every fact-TRIPLE. Concretely:

- **Identity becomes `fact:<tripleHash>@<sourceId>`**, not `fact:<tripleHash>` alone.
  `tripleHash` is unchanged (`factIdFor`'s 16-hex SHA-256). `sourceId` is the SAME deterministic
  Source id the codebase already derives from a provenance tag today —
  `sourceIdFor(provenanceTagToSource(tag))`, `core.mjs:765-786` — e.g. `src:corpus:conceptnet`,
  `src:teach-chat:<sessionId>`, `src:reference:simplewiki:Polar bear@912`. Reusing that closed
  derivation, instead of inventing a parallel "node id" concept, answers most of "who sets the
  source key" for free: every tag kind already has one. The one gap (peer identity) gets its own
  section below.
- **Two different sources asserting the same triple get two different records** sharing the
  `tripleHash` prefix. The SAME source re-asserting the SAME triple resolves onto its own lineage —
  a genuine no-op for an identical re-delivery, a new head superseding the prior one for an
  actually newer assertion (next bullet). This preserves the G-Set property for the case that
  actually needs it — repeated or duplicate delivery from one origin over different mesh paths —
  without merging away distinct origins.
- **A same-source re-assertion with a NEWER embedded timestamp supersedes the record instead of
  overwriting it** (decided, operator, 2026-07-30 — supersedes the earlier draft of this bullet,
  which called it an in-place update; see "Supersession" below for the full mechanism and why).
  The new assertion is written under the SAME stable id — `fact:<tripleHash>@<sourceId>` — so
  nothing already holding that id goes stale; the record it replaces is kept, unmutated, under a
  new id, linked by `mgx:supersedes`/`mgx:supersededBy`. `mgx:createdAt` still stays
  first-write-wins on each individual record. This is still an LWW-register in spirit — newest
  embedded timestamp wins the head slot — but the register's PRIOR values are retained rather than
  discarded. `latestProvenanceTimestamp` reads the head's own tag exactly as before, so the wave
  mechanic (a repeat wave refreshing the timestamp) is unaffected. Chain construction is still a
  join (Shapiro et al. 2011) — see "Supersession" for the proof.
- **`trustScore`/`trustInputs` move from "stored aggregate on the record" to "computed over the
  group"** — "how much do I trust dog-can-bark" means: fetch every record sharing the
  `tripleHash`, then noisy-OR over each record's own single effective prior. Same math as today,
  deferred from write time to read time. Each record still stores its OWN `mgx:trustScore` (its
  single source's effective prior — a write-time constant, cheap to keep), so per-record trust
  needs no computation at all.
- **Each record's own `trustInputs` simplifies** to describe one source:
  `{ sourceType, sourceId, createdAt }` — no array. The array-of-hops the MIME analogy wants is
  the SET of records sharing a `tripleHash`, not a field inside any one of them.
- **`mgx:factProvenance`** holds that one record's own tag(s) — normally exactly one; two tags
  only when both derive the same Source id (e.g. `corpus:conceptnet /r/IsA` and
  `child:conceptnet:<term>` both map to `src:corpus:conceptnet`) — rather than a cross-source
  `" | "` union. The union still exists, synthesized at read time for compatibility (see the
  reading section).

### Assertion-key derivation, the full table

| provenance tag shape | derived sourceId (existing code) | one record per |
| --- | --- | --- |
| `corpus:<name> ...` / `child:<name>:...` / `world:<name>...` | `src:corpus:<name>` | corpus/world |
| `corpus-weak:<name>` | `src:corpus-weak:<name>` | weak corpus |
| `mud:<character>...` | `src:corpus:mud:<character>` | character |
| `ace:chat:<session>@<ts>` / `ace:p2p:<id>@<ts>` | `src:operator-chat:<session>` | operator session |
| `teach:chat:<session>@<ts>` | `src:teach-chat:<session>` | local teach session |
| `teach:peer:<name>#node:<nodeId>@<ts>` (NEW, below) | `src:teach-node:<nodeId>` (NEW) | peer node |
| `reference:<pack>:<article>` | `src:reference:<pack>:<article>` | article |
| `extracted:<file>` / `optimistic-extract:<file>` | `src:extracted:<file>` / `src:optimistic-extract:<file>` | file |
| `web:<url>` | `src:learned:web:<fnv1a(url)>` | url |
| `entailed:<rule>` | `src:entailed:<rule>` | rule |
| empty, or a tag `provenanceTagToSource` maps to null | `src:none` (NEW singleton) | — |

`src:none` is new and small: today a fact with an unparseable or empty tag simply gets no Source.
Under this model every record needs a key, so the null case gets a named singleton, and the record
keeps its original tag string verbatim so nothing is dropped. A mud world's bare seed rows (empty
provenance, see `worldActionRows`, `adventure.mjs:223`) land here too, which is correct: the seed
ships identically in every page build, so every peer derives the identical record id.

Key form — decided (operator, 2026-07-30): the readable Source id goes into the record id as-is
(`fact:d5327019…@src:corpus:human`). The alternative — hash the sourceId to 8 hex to bound id
length — was considered and not picked: ids are internal, TEXT-keyed in both backends, and a
greppable id has repeatedly earned its keep in this repo's debugging. If id length ever becomes a
measured problem, hashing the suffix is a mechanical change behind one function.

## Worked example: the operator's scenario, two records

Same "dog can bark" fact, corpus-origin and peer-taught, as two records instead of one. Every
record stays a plain, flat `attributes[]` list — the same shape every fact already has. The group
key isn't a separate field: it's the part of `id` before the `@` (and a real indexed column in the
SQL projection below). No `recency` is ever stored — it's `recencyNudge(assertedAt, now)`, a
function of the current moment, computed fresh at read time; that was already the only correct
form in the old model, and the read-time aggregate finally honors it (a stored aggregate goes
stale by pure passage of time; see the reading section).

```json
{
  "id": "fact:d5327019d311a956@src:corpus:human",
  "label": "dog mgx:capableOf bark",
  "class": "Fact",
  "derived_from": [], "mentions": [],
  "attributes": [
    { "prop": "rdf:type", "key": "type", "value": "rdf:Statement" },
    { "prop": "rdf:subject", "key": "subject", "value": "dog" },
    { "prop": "rdf:predicate", "key": "predicate", "value": "mgx:capableOf" },
    { "prop": "rdf:object", "key": "object", "value": "bark" },
    { "prop": "mgx:createdAt", "key": "createdAt", "value": "2026-07-29T07:31:11.613Z" },
    { "prop": "mgx:sourceId", "key": "sourceId", "value": "src:corpus:human" },
    { "prop": "mgx:factProvenance", "key": "provenance", "value": "corpus:human /r/CapableOf" },
    { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "bark capableof dog mgx" },
    { "prop": "mgx:trustScore", "key": "trustScore", "value": "0.7" },
    { "prop": "mgx:updatedAt", "key": "updatedAt", "value": "2026-07-29T07:31:11.613Z" }
  ]
}
```

```json
{
  "id": "fact:d5327019d311a956@src:teach-node:7f3a9c2e",
  "label": "dog mgx:capableOf bark",
  "class": "Fact",
  "derived_from": [], "mentions": [],
  "attributes": [
    { "prop": "rdf:type", "key": "type", "value": "rdf:Statement" },
    { "prop": "rdf:subject", "key": "subject", "value": "dog" },
    { "prop": "rdf:predicate", "key": "predicate", "value": "mgx:capableOf" },
    { "prop": "rdf:object", "key": "object", "value": "bark" },
    { "prop": "mgx:createdAt", "key": "createdAt", "value": "2026-07-29T20:00:00.000Z" },
    { "prop": "mgx:sourceId", "key": "sourceId", "value": "src:teach-node:7f3a9c2e" },
    { "prop": "mgx:factProvenance", "key": "provenance", "value": "teach:peer:scavenger-dial#node:7f3a9c2e@2026-07-29T20:00:00.000Z" },
    { "prop": "mgx:hasProseTokens", "key": "prose_tokens", "value": "bark capableof dog mgx" },
    { "prop": "mgx:sourceReliability", "key": "sourceReliability", "value": "1.025" },
    { "prop": "mgx:trustScore", "key": "trustScore", "value": "0.97375" },
    { "prop": "mgx:updatedAt", "key": "updatedAt", "value": "2026-07-29T20:00:00.000Z" }
  ]
}
```

Each record's own `trustScore` is its own source's effective prior (corpus: bare 0.7; peer teach:
0.95 × 1.025 reliability = 0.97375 — the SAME effective prior the old model folded into its
noisy-OR, now visible on its own). Neither record stores `mgx:observedAt`, because neither caller
supplied one; the default chain below covers both at read time. Reading "how much do I trust this"
groups both records and runs the same noisy-OR as before:
`1 - (1-0.7)(1-0.97375) = 0.992125` — identical to today's stored number (both records fresh, so
both recency multipliers are 1). Nothing about the user-facing answer changes; what changes is that
the two events are separately visible, separately timestamped, separately attributable.

## CRDT convergence under PLAN_MUD's real replication paths

This was an open question; it's now checked against the actual code. Inventory of every path a
fact travels (`src/services/p2p-room.mjs`, verified this session):

1. **Local write** — a page calls `appendFacts` directly. The provenance tag carries session
   identity (`teach:chat:<session>@<ts>`), which derives a per-session sourceId. Covered.
2. **`op` broadcast** (`p2p-room.mjs:250-266`) — after a local turn, changed rows are relabeled
   (`relabelForBroadcast`, `src/domain/p2p/provenance-relabel.mjs`: teach/operator tags become
   `teach:peer:<displayName>@<assertion-ts>`) and sent as wire facts
   `{subject, predicate, object, provenance}`, one wire fact per tag (`toWireFacts`,
   `p2p-room.mjs:105`). The envelope's `from: myPeerId` is the TRANSPORT hop, not the origin.
3. **`sync-request`/`sync-response`** — same wire-fact shape, same relabeling, for the join-time
   delta.
4. **Relay** — a peer re-broadcasting a fact it received keeps `teach:peer:...` tags untouched
   (`ALREADY_PEER_LABELED`, `p2p-room.mjs:73`), so origin attribution survives multiple hops, and
   the relabel is idempotent (re-relabeled output is byte-identical, so the union stops growing —
   the comment at `p2p-room.mjs:75-92` states this contract).

**The gap:** the only origin identity that survives the wire is the display name inside the
relabeled tag. Display names are user-chosen, mutable, and collidable; `myPeerId` is minted per
connection and changes on reconnect (`PLAN_MUD.md` builds a `playedBy` registry precisely because
of that). Neither is a stable key. So the answer to "does every delivery path already carry a
stable node id early enough to key on" is **no — the tag must start carrying one.**

**The fix, two parts:**

- **A stable per-store node id.** Mint a random id (16 hex is plenty) the first time a store
  participates in P2P; persist it beside the store (IndexedDB for the browser store, `.tmct/` for
  a Node store); never regenerate it. When `PLAN_MUD.md`'s planned Ed25519 keypairs land, the key
  fingerprint is the natural node id for NEW stores — but an existing store keeps the id it
  already broadcast under, because changing a node's id mid-life would re-key that node's future
  assertions and (only if it re-asserts the same triples) double-count it. One id per store,
  forever, is the rule; the signing key attaches to the id rather than replacing it.
- **The tag grammar grows one segment:** `teach:peer:<displayName>#node:<nodeId>@<ts>`. This is
  deliberately backward-compatible with the shipped parser: `parseChatTagRest` (`trust.mjs:19-26`)
  takes everything between the first `:` and the `@` as the session slot, so an OLD reader sees
  `scavenger-dial#node:7f3a9c2e` as an opaque session id — already node-unique, nothing breaks. A
  NEW reader splits on `#node:` and derives `src:teach-node:<nodeId>`, with the display name kept
  for presentation only — the same "this segment records who to show, not who it is" discipline
  the tag parsers already apply to `child:`'s term and `world:`'s turn segments
  (`trust.mjs:33-49`). `ALREADY_PEER_LABELED` still matches. The one render touch: the provenance
  chip that shows "taught by X" strips from `#` before display.
  - Considered alternative: a separate `origin` field per wire fact plus an `mgx:sourceNodeId`
    attribute, leaving the tag alone. Cleaner as a data model, but it adds a wire-envelope change,
    a second place origin identity lives, and a compat story for old peers that drop unknown
    fields — while the tag extension rides every existing path (including relays and the
    dedupe-by-exact-tag merge) unchanged. Not picked for those reasons; revisit if the tag grammar
    ever gets a real parser rather than string splits.

**Why the merge stays a valid CRDT.** The store's replicated state is a set of records keyed by
`tripleHash@sourceId`. Merge is: union by id; on an id collision, keep the record whose embedded
assertion timestamp is newest; on an exact timestamp tie, a record carrying `mgx:observedAt`
supersedes the same record without it (presence-wins — see the dated teach frame's wire note),
and otherwise the records are byte-equal, so no-op. Union is a join; max-of-timestamp per key is
a join; presence-wins on a tie is a join; a product of joins is a join — so merge is commutative,
associative, and idempotent, which is Shapiro et al.'s sufficient condition for state-based
convergence. Two
provisos, each required for the convergence claim to hold:

- **Record content must be a pure function of the wire fact.** `mgx:createdAt` on a received
  record derives from the tag's embedded timestamp, never from local receipt time — otherwise two
  peers receiving the same assertion at different moments hold same-id records with different
  bytes. Only a tag with no timestamp at all (corpus kinds, which don't replicate — the sync
  filters exclude them, `src/domain/p2p/sync-filter.mjs`) falls back to local time.
- **Convergence is over the wire-visible set.** A node's own store keeps finer local detail (two
  local teach sessions = two records locally; the wire relabels both to the one
  `src:teach-node:<id>` record remotely). Local stores were never byte-identical to remote ones —
  the shipped relabel design already made that choice (`PLAN_MUD.md`, "Provenance relabeling") —
  and local trust can read slightly higher than remote trust for the same triple for the same
  reason. This plan keeps that shape rather than fighting it.

What tmct does NOT need from Riak's machinery: vector clocks / dotted version vectors exist to
DETECT whether two writes to one key were concurrent. Here, identity partitions by source up
front, so there is nothing to detect — every distinct origin gets its own record by construction,
and one origin's own writes are totally ordered by its own timestamps. What's taken from Riak is
the architectural split: KEEP conflicting values as siblings (`allow_mult`), resolve by a strategy
chosen per data type, never silently pick a winner (Riak docs, Conflict Resolution).

## Sibling resolution: the strategy enum

Riak resolves siblings with a pluggable resolver chosen per bucket type. tmct's equivalent is a
small closed enum keyed by PREDICATE — matching this codebase's standing preference for closed
vocabularies over general rules (`SOURCE_PRIOR`, `MULTI_VALUED_PREDICATES`, the ISA set are all
the same shape). Four strategies, plus corroboration which is not per-predicate at all:

- **`corroborate` (same triple, different sources).** Applies WITHIN a `tripleHash` group, for
  every predicate, always: the noisy-OR trust math. No disagreement exists; strength of belief
  goes up. This is stage 1 of every read and is not in the predicate table.
- **`merge` (multi-valued; a second object is a second fact).** Present all objects, aggregate
  into one answer. Exactly today's `MULTI_VALUED_PREDICATES` behavior.
- **`latest-observation-wins` (state of the world).** Different objects are successive states,
  not a disagreement; prefer the newest OBSERVATION time, which is not the newest ingestion time
  — the full rule is in the `observedAt` section below. The comparison itself stays read-time (see
  "Supersession" below), but every time it finds the winner has changed, it records that as an
  edge between the two groups' own stable ids — a breadcrumb over an already-correct computation,
  not a new authority, and not replicated.
- **`first-claim-wins` (registrations).** Different objects race; the OLDEST assertion wins.
  Already the shipped semantic for `mgx:playedBy` (`PLAN_MUD.md`: "first claim wins by
  timestamp"; `latestFact`'s doc comment in `src/domain/p2p/facts.mjs` points the same way). The
  enum names it so the rule lives in one lookup instead of per-caller lore.
- **`contradiction` (settled facts; the default).** Different objects above the trust floor are a
  real disagreement: `findContradictions`'s existing job, unchanged — both kept, reported, never
  silently resolved.

A predicate's strategy is a lookup with `contradiction` as the default — computed at READ time,
never stored per record, since the same predicate always resolves the same way.

### The predicate table, enumerated

tmct's fact-predicate vocabulary is closed and small: the ConceptNet map
(`src/adapters/corpus/conceptnet-map.toml` — 24 emitting relations), the taught/ISA set, the mud
world's state predicates (`src/services/adventure.mjs:178-245`), and the P2P layer's four
(`src/domain/p2p/facts.mjs`). Classified in full:

**`merge`** — many objects at once are all true:

| predicate | note |
| --- | --- |
| `mgx:hasA`, `mgxneg:hasA` | today's set, unchanged |
| `mgx:capableOf`, `mgxneg:capableOf` | today's set, unchanged |
| `rdfs:subClassOf` | multiple superclasses are real (a dog is a mammal and a pet) |
| `rdf:type` | same |
| `owl:disjointWith` | disjoint from many things |
| `mgx:partOf` | a wheel is part of a car and of a bike |
| `mgx:usedFor`, `mgx:receivesAction`, `mgx:causes`, `mgx:causesDesire` | many per subject |
| `mgx:hasSubevent`, `mgx:hasPrerequisite`, `mgx:motivatedByGoal`, `mgx:obstructedBy` | same |
| `mgx:desires`, `mgx:hasProperty`, `mgx:madeOf`, `mgx:atLocation`, `mgx:locatedNear` | same |
| `mgx:createdBy` | collaborations are real |
| `mgx:mannerOf`, `mgx:relatedTo`, `mgx:synonym`, `mgx:antonym`, `mgx:similarTo`, `mgx:symbolOf` | lexical/associative, inherently many |
| `mgx:knows-about` | knowledge accumulates |
| negative twins (`mgxneg:<name>`) of every row above | "cannot fly" and "cannot sing" are two claims |

**`latest-observation-wins`** — the object is a current state:

| predicate | note |
| --- | --- |
| `mgx:currently-in`, `mgx:located-in`, `mgx:fixed-in`, `mgx:stands-locked-in`, `mgx:hidden-in` | placements |
| `mgx:on-top-of`, `mgx:on-plane`, `mgx:under` | positions |
| `mgx:is-open`, `mgx:hasMass`, `mgx:feels`, `mgx:faces`, `mgx:pose` | mutable state (mass drains per turn) |
| `mgx:display-name`, `mgx:nodeName`, `mgx:worldName` | latest rename wins — `PLAN_MUD.md` already reads these "latest by timestamp" |
| `mgx:has-exit-<direction>` (the `EXIT_PREDICATE_RE` family) | digging rewires exits |

**`first-claim-wins`:**

| predicate | note |
| --- | --- |
| `mgx:playedBy` | shipped semantic, now table-driven |
| (`controlledBy` key-binding, when PLAN_MUD's signing lands) | same race shape |

**`contradiction` (default; also every predicate not listed):** `mgx:hasFirstSubevent`,
`mgx:hasLastSubevent` ("the FIRST thing you do" is functional by meaning), `mgx:father`,
`mgx:mass`, and anything new until it's classified.

Two scope notes, both deliberate:

- **This table WIDENS the merge set** relative to today's two-predicate `MULTI_VALUED_PREDICATES`
  (e.g. `mgx:atLocation`: "a dog in a kennel" and "a dog in a park" currently both clear the 0.5
  floor at corpus trust 0.7 and would report as a contradiction group). Implementation:
  `MULTI_VALUED_PREDICATES` becomes derived — `strategy(p) === "merge"` — so its consumers
  (`findContradictions` in `core.mjs`; the readers in `chat.mjs`/`capability.mjs` that import the
  negation convention) follow automatically. The widening changes `findContradictions` output and
  therefore `recomputeSourceReliability`'s contradiction counts; the conservative fallback (keep
  merge = exactly today's two + twins, classify the rest `contradiction`) is a one-table edit if
  the widened behavior regresses anything. Decided (operator, 2026-07-30): the widened table
  ships. It encodes what the relations mean (the surface templates in `conceptnet-map.toml` —
  "you are LIKELY to find a {start} in a {end}" — say "typically", not "uniquely").
- **The mud world-state fold keeps its own clock.** `foldWorldState` orders by turn snapshots and
  filters to world-authored rows (`worldActionRows`); its newest-per-subject fold is
  latest-observation-wins in spirit, but its "time" is the turn counter, not `observedAt`. The
  resolver table serves the CHAT/answer read path; it does not replace the fold, and the fold's
  rows never reach the chat resolver with conflicting sources anyway (one world, one authority).

## Supersession: preserving history instead of overwriting in place

Decided (operator, 2026-07-30), refining two rules stated above: the same-source LWW-register
update in "The proposed model," and the `latest-observation-wins` strategy just above. Both
currently describe "the newer one wins" as either an overwrite or a computation redone from
scratch on every read; this section makes "wins" mean SUPERSEDES — an explicit, walkable edge,
never a mutation and never a discard. The two mechanisms it touches are structurally different, so
supersession takes two different shapes.

### Same-source re-assertion: a real, replicated version chain

The rule stated above already changed: a same-source re-assertion with a newer embedded timestamp
no longer updates its record in place. Concretely:

- The incoming assertion is written under the ORIGINAL stable id —
  `fact:<tripleHash>@<sourceId>` — so nothing that already holds that id (a
  `mgx:factJustification` premise list, a citation, a page's cached reference) ever goes stale. It
  is the HEAD of this source's own lineage for this triple.
- The record it replaces is neither deleted nor mutated. It is re-keyed to
  `fact:<tripleHash>@<sourceId>#v<n>` (`n` counting up: how many times this source's own record for
  this triple has been superseded) and kept, byte-identical in content, as a leaf of the chain.
- The new head gets `mgx:supersedes`, naming the id(s) it replaces; the demoted record gets
  `mgx:supersededBy`, naming the id(s) that replaced it. **Both are collections** (id lists), not
  single values — see below for why.
- Idempotency is unchanged: an exact re-delivery (byte-identical content AND timestamp) is still a
  no-op, never a new version. Only a genuinely newer assertion — a later embedded timestamp, or an
  equal-timestamp tie broken by `observedAt`-presence per the rule already stated for the dated
  teach frame's wire section — creates one.

**Why a collection, not a single pointer.** In the common case a source's own writes are totally
ordered by its own clock, and the chain is a straight line: one `supersededBy`, one `supersedes`,
each a singleton. But nothing in this mesh forbids one logical source having more than one live
replica — the same node open in two tabs, or a genuine multi-device session — each locally
superseding the same prior version before the two sides ever sync with each other. That is a real,
concurrent fork, not a bug, and `mgx:supersededBy` on the old record can then legitimately hold TWO
successor ids until the peers converge. `mgx:supersedes` mirrors the shape for the same reason,
though nothing in this write path ever produces a fork on that side — no operation merges two
prior versions into one new record — so it stays a list of one in practice; kept plural only so the
shape does not have to change if that ever stops being true. This is the same choice already made
for contradictions and for the Sybil ceilings: keep-and-resolve, never silently pick a winner that
erases the other. A genuine fork resolves at READ time by the tie-break the LWW-register rule
already states — newest embedded timestamp; equal timestamps, `observedAt`-presence wins; still
tied, codepoint-smallest content wins — walking to whichever `supersededBy` successor that rule
prefers, not a new rule invented for this.

**Merge stays a join.** `mgx:supersededBy` on a demoted record is a write-once field: absent, then
set — at most twice, in the fork case above — never cleared and never overwritten to a DIFFERENT
value once a peer has recorded one. Two peers superseding the same record with the SAME new id
converge trivially (identical write, identical result); superseding it with two DIFFERENT new ids
converges to the union of both — an addition to a set, which is a join. Chain construction
composes with every join this document already establishes (union of provenance tags,
max-of-timestamp, presence-wins-on-a-tie), so the whole merge stays commutative, associative and
idempotent — Shapiro et al.'s sufficient condition for convergence, same as everywhere else in this
plan.

### Cross-object latest-observation-wins: an edge, not a re-key

`latest-observation-wins` resolves ACROSS different `tripleHash` groups sharing one (subject,
predicate) — a placement's old room and its new one are different objects, hence different
content-addressed ids, and an id can never be reassigned onto different content the way the
same-source case reuses its own slot. Supersession here is an EDGE only, drawn between two groups'
own stable ids (`fact:<tripleHash>`, the group id) when a fresh resolution finds the winner has
changed since the last one recorded:

- No write path proactively maintains this edge. Every fact behind it is already fully replicated,
  and the strategy comparison already runs at read time (`effectiveObservedAt` across the
  object-groups of one subject+predicate, per the section below). Recording "A used to be current,
  B is now" is a breadcrumb over an already-correct computation, not new authority, and it changes
  nothing about how the winner is chosen.
- It is exactly the shape `fact_heads` already is: local, derived, useful for "what changed" views
  and for the "as of &lt;date&gt;" walk below, and never replicated — writing it into the wire
  model would manufacture the same class of conflict the aggregate section already rejected a
  stored, replicated aggregate for. Built alongside `fact_heads` (landing order step 8), not
  before.

### Walking the chain: "as of &lt;date&gt;" and incremental re-resolution

Both shapes exist so a reader can answer "what was this fact at time T" and "does this new
candidate beat what's already there" by walking a small chain instead of re-deriving the answer
from every record in a group on every read.

**Rendering a view at a time.** Given any record in a chain (a head or a demoted leaf) and a
target instant T: if its own `effectiveObservedAt` is after T, step backward along
`mgx:supersedes`; if before-or-at T, check every id named in its `mgx:supersededBy` — if one of
those is ALSO before-or-at T, step forward to it instead, since it is a closer answer. Stop at the
record whose own instant is before-or-at T and none of whose successors are; that is the value as
of T. The walk goes both directions on purpose: arriving at a too-old record from one branch of a
fork can still have a still-valid successor down a DIFFERENT branch that is closer to T without
overshooting it, and a single-direction walk would miss it.

**Incremental sibling re-resolution.** When a new candidate for a chain arrives — a same-source
new assertion, or a fresh object-group entering `latest-observation-wins` contention — compare it
against the walked-to CURRENT head, not against the group's whole history: the head already
represents everything before it that mattered. If the candidate is newer, it becomes (or, for the
cross-group case, is recorded as) the new head; if older, it slots in behind whatever it actually
precedes, found by the same backward walk. This is the practical payoff of never discarding a
demoted record: comparison is against "the latest fact known" — an O(chain depth to the fork
point) walk, not an O(group size) scan.

## `mgx:observedAt`: who sets it, and the exact fallback chain

The bitemporal split, named precisely (Snodgrass; SQL:2011): `mgx:createdAt` is transaction time —
when THIS store recorded the assertion. `mgx:observedAt` is valid time — when the asserting party
witnessed the claim being true. The operator's sun example is the whole motivation: a stale
newspaper article READ today (createdAt = today, observedAt = 2019) must lose to an eyewitness
report from yesterday (observedAt = yesterday). Ingestion order gets this exactly backwards.

tmct stores an instant, not a period. SQL:2011's application-time is a [from, to) period; a period
model would also carry "true UNTIL", which nothing in tmct asks yet. No settled need exists today;
if one appears, `mgx:observedUntil` is the additive extension and the comparison rule below
already generalizes (compare period ends). Until then, instants keep every rule one comparison.

**Who sets it — the per-source rules:**

| source kind | `mgx:observedAt` stored? | rule |
| --- | --- | --- |
| corpus / corpusWeak import | no | a corpus row is definitional; stamping import time would be false precision |
| reference pack article | only when the pack manifest carries a revision/snapshot date — the loader passes it through | the article's date, not the read date |
| teach (chat) | only when the sentence carries an `as of <date>` suffix | the dated-teach frame (next section) parses the suffix and passes the instant through; an undated teach is a live witness and the default chain covers it |
| peer teach (wire) | no | the tag's embedded `@<ts>` is the origin's assertion moment; the chain reads it |
| mud / world turns | no | the fold owns world-state time (turn counter); see the scope note above |
| entailed | no | derivation is not observation; an entailed conclusion has no witness moment of its own |
| explicit caller | yes | `appendFacts` grows an optional per-fact `observedAt` passthrough; whoever supplies one owns its meaning |

**Storage rule:** store `mgx:observedAt` only when a caller supplied one. Never fabricate it, and
migration (below) never backfills it.

**The read-time chain — `effectiveObservedAt(record)`:**

1. Stored `mgx:observedAt`, when present and `Date.parse`-able.
2. Else, for AGENT-kind sources only (`operator`, `teach`, `provider` — exactly the
   `prov:Agent` rows of `PROV_CLASS_BY_SOURCE_TYPE`, `core.mjs:795-807`): the provenance tag's
   embedded timestamp, else `mgx:createdAt`. A live agent asserting now is witnessing now.
3. Else `undefined`. Document-kind sources (`corpus`, `reference`, `web`, `extracted`, …) and
   activity-kind (`entailed`) never fall back to `createdAt` — their `createdAt` is ingestion
   time and says nothing about observation. This is what makes the sun example resolve right: the
   undated corpus row yields `undefined` and loses to any dated eyewitness.

**The full `latest-observation-wins` resolution, including ties** (run over the object-groups of
one subject+predicate, each object-group already corroborated into one aggregate):

1. Score each object-group by the max `effectiveObservedAt` across its records; `undefined`
   scores as minus infinity.
2. Highest score wins. An `undefined`-only group loses to any dated group.
3. Tie (equal instants, or all groups undefined): the group with the higher aggregate trust wins
   the RENDERED answer.
4. Still tied: the codepoint-smallest object string wins — plain `<`, never `localeCompare`, for
   the same cross-peer determinism reason `sortFactIndividualsById` already bans locale order
   (`p2p-room.mjs:218-220`).
5. Any resolution decided at step 3 or 4 ALSO emits the group into the contradiction report:
   steps 3–4 exist so a page always has one deterministic answer to render, and the report is
   what keeps "never silently resolved" true for the cases time couldn't order.

## The dated teach frame: "as of <date>"

The one chat surface this plan adds. "the evening star's owner is edmund as of 2019" teaches the
same possessive fact the undated sentence does, plus an explicit `mgx:observedAt` — the user's own
way to say "this was true THEN", which is what makes the sun/newspaper resolution reachable from
chat at all.

**Surface grammar — a closed trailing suffix, not a grammar change.** The frame is a suffix strip
in the interpret layer, never a parseAce extension: ACE's grammar and lexicon are untouched, and
the stripped remainder is exactly a sentence the teach lanes already parse. This is the same
"surface wrapper around a shape that already works" placement the interpret layer map assigns to
`normalize.mjs`, and `a1UniversalConditional`'s conditional-coat rewrite in infbench documents the
precedent. The accepted date forms are a closed set of three:

```
as of <yyyy>                    e.g. "as of 2019"        (yyyy in 19xx/20xx)
as of <yyyy>-<mm>[-<dd>]        e.g. "as of 2019-03-01"
as of <month> <yyyy>            e.g. "as of march 2019"  (twelve month names)
```

One regex, anchored to the end of the input (trailing punctuation tolerated):

```
/\s+as\s+of\s+((?:19|20)\d{2}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:19|20)\d{2})\s*[.!?]*$/i
```

"as of" only — "as at", "back in", and bare "in 2019" stay out (the last is ambiguous with
locatives: "the dog is in 2019" vs "the meeting is in room 4"). Widening the trigger set later is
a table addition, not a redesign.

**Date → instant, deterministically.** The stored instant is the START of the named period: a
bare year becomes `<yyyy>-01-01T00:00:00.000Z`, month+year the first of that month, a full date
that day at midnight UTC. Start-of-period is the conservative choice for
`latest-observation-wins`: it can under-claim how recent the observation was, never over-claim
it, so a dated assertion never beats a fresher one on the strength of date-form vagueness.

**Pipeline hook — a read-only probe, called by the teach lanes.** `normalize.mjs` gains
`datedTeachSuffix(text) → { stripped, observedAt, dateText } | null`, the same read-only-probe
shape `kindNounAnaphoraHint` already has there (a helper a caller consults, never a mutation of
`normalizeQuery`'s own text→text path — threading a side value through the shared normalize pass
would change its contract for every consumer). Each teach lane (the ACE assert lane and the
teach-frame lane) consults it first:

1. Probe hits → the lane attempts its normal parse on `stripped`.
2. Parse succeeds as a teach → the fact writes through `appendFact`/`appendFacts` with the new
   per-fact `observedAt` passthrough (the explicit-caller row of the table above), storing
   `mgx:observedAt` verbatim. The acknowledgment echoes the date — "noted — remembered … (as of
   march 2019)" — so the user sees the date registered, not silently dropped.
3. Parse fails, or the turn was never a teach → the lane proceeds with the ORIGINAL text as if
   the probe never fired. A question that happens to end in "as of 2019" keeps its meaning; no
   silent rewrite of non-teach turns.

The failure mode this ordering forbids, worth naming because it inverts the whole feature: a
dated teach must never store UNDATED. Today the suffixed sentence is declined outright (verified
live, 4.0.0) — an acceptable floor. Storing it while dropping the date would rank the 2019 claim
as observed now, which is the sun/newspaper mistake made mechanical. The playtest axis
(`SKILL_PLAYTEST_EDGE_HUNT.md` §4.1) names this as its highest-value edge.

**The wire.** `mgx:observedAt` is record content, so a dated taught fact's broadcast carries it:
the wire fact gains an optional `observedAt` field beside `provenance`, and `mergeIncomingFacts`
passes it through. The convergence proviso ("record content is a pure function of the wire
fact") holds because the field IS wire-fact data — with one merge-rule addition: on an id
collision with EQUAL assertion timestamps, a record carrying `mgx:observedAt` supersedes the
same record without it (only the origin could have supplied the field, so presence-wins is a
join — idempotent, commutative, and it can only add information). A mixed-version mesh degrades
predictably: an old peer drops the field and ranks that record by assertion time (the sun
mistake, confined to dated records on unupgraded peers), then heals on its first post-upgrade
sync, because the re-sent wire fact still carries the field and presence-wins merges it in.

**Bench and playtest coverage, shipped ahead of the implementation.** infbench's
`c2SiblingResolution` template (INF-6, 20 cases) pins today's floors: the identical re-teach
corroborates, a multi-valued second object merges, a single-valued conflict keeps and surfaces
both, and the `observed-at-conflict` cell holds the dated-surface-declined floor with a `ceiling`
naming this frame. When the frame ships, that cell's pin is raised IN PLACE (mentions grow to
both objects, the undated live teach still preferred) — c1Cardinality's fixed-in-place precedent;
leaving the stale floor pinned would itself be the regression.

## Reading siblings: the group fold, and where the aggregate lives

**The single adaptation point is `readFactRows`** (`core.mjs:1755-1770`). Today it emits one row
per Fact individual with `trust` read off the stored attribute; every consumer — `chat.mjs`'s
`renderFactLine` and its ~40 call sites, `findContradictions`, the sync filters, the p2p diff —
consumes those rows. Under this model `readFactRows` groups records by `tripleHash` and emits one
row per GROUP, shaped exactly as today plus one addition:

**The group fold reads HEADS only — `superseded_by IS NULL` — never a demoted record.** A record a
source has since superseded is that source's own past belief, not a second independent vote for
the current one; folding it in would let one source's OWN edit history inflate its own
corroboration, exactly the lever the Sybil-resistance section exists to close, just aimed inward
instead of across fabricated identities. `row.trust`, `row.provenance`, `row.sourceIds`/
`row.sourceTypes`, and `row.assertions` below are ALL computed over the group's live heads alone.
Demoted records are real data — walkable via `mgx:supersedes`/`mgx:supersededBy`, per the
"Supersession" section above — but they answer "what did this source used to say and when," never
"how much do I currently trust this," which is a question about the present.

- `row.id` = the bare `fact:<tripleHash>` — the group id, byte-identical to today's fact id.
- `row.provenance` = the members' tags, `" | "`-joined, sorted codepoint order — the same compat
  union string readers already parse. `renderFactLine`'s `.includes("teach:chat")` checks, the
  sync filters' tag-kind gates, and `latestProvenanceTimestamp` all keep working unmodified.
- `row.trust` = the group aggregate, computed fresh (formula below).
- `row.sourceIds`/`row.sourceTypes` = the union, as today.
- `row.assertions` = NEW: the per-record detail
  `[{ id, sourceId, sourceType, provenance, createdAt, observedAt?, ownTrust }]`, for readers
  that want the hop list. Nothing shipped reads it yet; the provenance chip and `examples/
  raw-fact-shape.mjs` are the first customers.

Consequence worth stating plainly: because the row surface is preserved, `chat.mjs` needs no
per-lane edits, and the whole P2P layer (`p2p-room.mjs`'s `(id, provenance)` diff key, `toWireFacts`'
union-splitting, the baseline/seen bookkeeping) runs UNCHANGED over the synthesized rows — a new
sibling record grows the synthesized union, the diff sees it, the broadcast fires, exactly as a
unioned tag does today.

**The aggregate formula** (`computeAssertionGroupTrust`, new in `trust.mjs`, sibling to the kept
`computeTrust` which Rules still use):

```
groupTrust(records, now) =
  1 − ∏ over records ( 1 − clamp01( prior(sourceType) × reliability × recencyNudge(assertedAt, now) ) )
```

with `assertedAt` = the record's tag timestamp, else its `createdAt`. The entailed hook is
unchanged: when the group holds an entailed-source record and premise trusts are supplied, the
base becomes `min(premiseTrusts) × ruleConfidence` (premise ids in `mgx:factJustification` are
GROUP ids — see migration — so premise trust is itself a group aggregate). One deliberate delta
from today: recency applies PER RECORD inside the noisy-OR, not once over the whole fact from its
first-write `createdAt`. This is the MIME framing carried into the math — each hop ages on its
own — and it fixes a real skew: today a fresh peer assertion is dragged down by the corpus
record's old `createdAt`, and a stored aggregate decays only when something happens to rewrite
it. Multi-source facts older than ~a week will shift by up to the recency band (floor 0.9);
single-source facts are unchanged. The trust-sensitive corpus rows in the test estate need their
expectations re-derived, not pinned around.

**Where the aggregate lives — three candidate homes, one recommendation:**

- **(a) Pure query-time, no cache.** Compute in `readFactRows` on every load. Correct by
  construction, zero invalidation. Cost: one grouping pass over facts per payload build — against
  an architecture that already loads and scans everything per read, this is noise today.
- **(b) A materialized `fact_heads` table** (`triple_hash` PK → aggregate, inputs JSON,
  `updated_at`), recomputed inside the SAME `mutateMemory` transaction as any write touching the
  group — the transactional recompute is exactly `recomputeFactTrust`'s existing discipline,
  re-keyed from "sources on one fact" to "records in one group". Concurrent writers: within a
  process, `mutateMemory` serializes; across connections, SQLite WAL serializes transactions and
  the second writer recomputes over both rows because it reads the group inside its own
  transaction; the `PRAGMA data_version` cache guard (`core.mjs:279-287`) already invalidates the
  in-process payload cache when another connection commits. Heads are derived LOCAL state and are
  NEVER replicated — replicating a derived aggregate would manufacture exactly the merge
  conflicts the assertion set removes (and recency makes any shipped aggregate stale on arrival).
- **(c) The existing in-process payload cache.** Aggregates computed at row-build time (as in a)
  live inside `handle.cachedPayload`, which already has a correct invalidation story
  (lockstep patching + `data_version`). No new storage, no new invalidation path.

**Decided (operator, 2026-07-30): (c) first, then (b) as this plan's own final landing step.**
(c) — which is (a) plus the cache the backend already has — carries every read from the re-key
onward. (b), the materialized `fact_heads` table, is built as the last phase of THIS plan
(landing order, step 8), not handed to a future session: a head row per group is what lets
`SELECT ... WHERE subject = ?` return ranked answers without fanning out per group, which the
AWS/SQL-native read path (`PLAN_MEMORY_BACKEND_AWS.md`, NEXT.md's open item) then consumes
ready-made. The transactional recompute rule above is its correctness contract. One rule carries
over unchanged: a stored head must still treat recency as read-time (store the aggregate BASE,
apply `recencyNudge` on read) — a head that bakes recency in is wrong the moment it's written.

## `findContradictions`: exact interop

Two mechanisms, two axes, and now a precise call order:

- Stage 1 — WITHIN a `tripleHash` group (same s, p, o): `corroborate` + same-source LWW update.
  Runs inside `readFactRows`. A group is internally agreeing by construction; nothing here is
  ever a contradiction. Output: one triple-row per group.
- Stage 2 — ACROSS objects for one (subject, predicate): the strategy lookup, running over
  stage-1 rows.
  - `merge` predicates: skipped by `findContradictions` (as `MULTI_VALUED_PREDICATES` is today —
    same code path, table-driven now).
  - `latest-observation-wins` / `first-claim-wins` predicates: the resolver (previous section)
    picks the rendered winner; `findContradictions` receives ONLY the groups the resolver flagged
    at tie steps 3–4. Ordinary succession (dated states in sequence) stops being reportable as
    disagreement, which is a behavior change and the point.
  - everything else: `findContradictions` exactly as shipped — same (subject, predicate),
    different object, both ≥ the 0.5 floor, groups returned trust-desc, both kept.

Consumers, all verified: `findContradictions` is called by `recomputeSourceReliability`
(`core.mjs:943` — contradiction counts drive `sessionReliabilityFrom`), `inspect.mjs:75` (the
`tmct inspect` report), and `ledger-viz.mjs:191` (the ledger page). All three consume grouped rows
and are indifferent to whether the rows came from stage-1 groups; they inherit the table's
widened-merge and tie-only-for-state-predicates changes and need review for expectation drift,
not code change.

## Gaming corroboration: Sybil resistance

The threat, stated concretely: under `one record per (triple, source)`, N cooperating (or
fabricated) node ids asserting one triple produce N records, and the noisy-OR climbs toward 1 with
each. Verified baseline: this is NOT new exposure — `computeTrust` already noisy-ORs distinct
source IDS (`trust.mjs:195-204`), so N teach sessions already do this today. The new model makes
the lever visible and cheap (mint node ids), which is Douceur's result in miniature: without a
central authority, identities are free, so identity COUNT must never be worth much on its own
(Douceur 2002). Dong et al. 2009 give the data-quality mirror: corroboration only counts between
independent sources; dependent (copying) sources must be discounted, and dependence is detectable
from shared claims. Candidate mitigations, breadth-first:

1. **Per-type aggregate ceiling** — SHIPS (landing order, step 6). Compute the noisy-OR aggregate
   `a_t = 1 − ∏(1 − p_i)` separately per source TYPE, clamp each to `ceiling(t)`, then combine
   across types: `1 − ∏_t (1 − min(a_t, ceiling(t)))`. The shipped default is
   `ceiling(t) = (SOURCE_PRIOR[t] + 1) / 2`, except `operator` stays 1.0 — so teach caps at
   0.975, corpus at 0.85, web at 0.7. Decided (operator, 2026-07-30), with one label attached:
   the formula is a starting guess, not a measured or tuned value — revisit it once real usage or
   abuse data exists, the same standing the compaction constants carry. Properties either way:
   unlimited same-type corroboration asymptotes at
   the ceiling instead of 1 (a thousand Sybil peers max out at 0.975, below operator certainty);
   cross-type corroboration still climbs; the change is closed-form, deterministic, and identical
   on every peer (it's read-time math over the same converged records). This is Jøsang's
   discounting instinct in tmct's own vocabulary: testimony is capped by trust in the class of
   testifier, not counted linearly (Jøsang 2001; fusion/discounting operators).
2. **Node-scoped reliability track record** — SHIPS with 1 (landing order, step 6). Extend
   `isSessionScopedSourceId` (`core.mjs:928`) to include `src:teach-node:` ids;
   `recomputeSourceReliability` then already counts each peer node's asserted-vs-contradicted
   record and writes the bounded multiplier (0.5–1.5), damped by the pseudo-count of 19. A node
   that asserts junk drags its own every-fact prior toward half. This is the shipped, small,
   deterministic member of the truth-discovery family (source reliability estimated from claim
   agreement — TruthFinder's loop, cut to one bounded pass; Li et al.'s survey frames the whole
   space).
3. **Diminishing per-source weights within a type** (k-th same-type source contributes
   `p × d^(k−1)`, order = descending own reliability then id). Softer than a ceiling and closer
   to Dong et al.'s dependence discounting, but it makes each source's contribution depend on its
   RANK among siblings — harder to explain in a `trustInputs` audit trail than "type capped at
   0.975". Not picked while 1 covers the same asymptote; keep on file.
4. **Hard cap on counted sources per type** (only the K most reliable count). A cruder 3. Not
   picked: a legitimate K+1-th independent witness adds literally nothing, and the cliff edge is
   arbitrary where the ceiling's asymptote is smooth.
5. **Distinct-TYPE corroboration only** (same-type extras raise the aggregate only via max, never
   product). Kills the Sybil lever entirely and kills real corroboration with it — two
   independent humans confirming each other is the core value of the mesh. Not picked.
6. **Identity cost + invitation graph** — the structural tier, aligned with work PLAN_MUD already
   plans. tmct's mesh has NO open discovery: every node joins through an explicit invite from a
   member. That is a social-admission graph by construction, which is exactly the structure
   SybilGuard exploits (Sybils mint identities freely but human-granted edges dearly — Yu et al.
   2006). Record the edge as a fact, `(<nodeId>, mgx:invitedBy, <nodeId>)`, at join time.
   With Ed25519 keys (PLAN_MUD's forgery section) binding assertions to node ids, reputational
   consequences stick to identities that cost an invite to obtain. Options that open up once the
   edges exist, in rising ambition: discount corroboration among nodes in one invite subtree
   (they share one trust edge into the mesh — the SybilGuard cut argument); seed reputation from
   the store owner's own node and propagate (EigenTrust's pre-trusted seed, power iteration cut
   to the mesh's scale). No settled deterministic design for the propagation step is chosen here;
   candidate literatures are named (EigenTrust; SybilGuard; Levine et al.'s survey of Sybil
   defenses), and until a tier is designed, mitigations 1+2 are the shipped answer.
7. **Copy detection as a signal** — horizon note from Dong, Berti-Équille & Srivastava (PVLDB
   2009, and the 2010 "Global Detection of Complex Copying Relationships" follow-on): two
   "independent" nodes whose asserted fact SETS overlap near-totally, including on false claims,
   are statistically detectable copiers. tmct has the data to compute overlap per node pair from
   assertion records. No design here yet; named so the option is visible.

The shipped set, in one line: 1 + 2 (both are small, closed-form, and convergent), plus recording
the invite edge now (it's one fact at join, and the data cannot be reconstructed later). 6's
propagation and 7 stay designed-when-needed, with their literatures named above.

## Storage growth and compaction

Scale check, with real numbers: the xl seed is 72,098 facts at ~85.6 MB raw (NEXT.md). Corpus
records stay one-per-triple under this model (single source each), so the seed does not grow.
Growth is proportional to CORROBORATION — records = assertions, and a fact taught by N distinct
nodes/sessions holds N records where today it holds 1 record + N sources (the individuals count
rises, the Source/edge count falls; net bytes per extra asserter are comparable, roughly a KB).
A mesh is small (a room of 2–10 peers), so the realistic pressure case is long-lived stores
accumulating hundreds of sessions/nodes on popular triples.

Riak's history says treat this as real before it hurts: unbounded siblings ("sibling explosion")
were a production failure mode severe enough that dotted version vectors were built to bound them
(Riak docs; Preguiça/Baquero's DVV work). tmct's analog, designed now, triggered later:

**Supersession opens a second, distinct growth axis, and the two need different compaction, not
one shared rule.** Corroboration growth (above) is many DIFFERENT sources, each contributing its
own head to the current trust number — compacting it changes what "how much do I trust this"
reads as, so the rollup pseudo-record must carry forward an approximate trust contribution
(`rollupPrior`) or the compacted answer would silently under-trust. A same-source supersession
chain (the "Supersession" section above) is the opposite case: every demoted leaf already
contributes NOTHING to the group fold (`superseded_by IS NULL` is the fold's own filter), so
absorbing a source's own old leaves changes no live number at all — only how far back an "as of
&lt;date&gt;" walk can reach. Treating both as one flat "keep newest K, roll the rest" pool would be
wrong in a concrete way: a chatty source's many RECENT demoted leaves would rank above a
quiet-but-currently-live OTHER source's own head by recency alone, and compacting that head away
is exactly the "changes what I currently trust" mistake this section exists to avoid. So: two
pools per `(tripleHash, source_type)`, each with its own trigger and its own rollup id, never
mixed.

**Pool 1 — heads (`superseded_by IS NULL`), the original design, unchanged in shape.**

- **Trigger:** the type's LIVE HEAD count crosses `GROUP_ROLLUP_THRESHOLD` (default 64), checked on
  the write path. No time-based compaction. The defaults (64, and keep-8-per-type below) are
  decided as the shipped values (operator, 2026-07-30) and are starting guesses, not measurements —
  revisit them against real store data once `tmct inspect`'s max-group-size metric (landing order,
  step 3) has something to report.
- **Action:** keep the newest `ROLLUP_KEEP_PER_TYPE` (default 8) heads; roll every older head of
  type `t` into ONE summary record with id `fact:<tripleHash>@rollup:<t>`, carrying:
  `mgx:rollupSourceIds` (the absorbed source ids, space-joined), `mgx:rollupCount`,
  `mgx:rollupEarliest`/`mgx:rollupLatest` (assertion-time bounds), and `mgx:rollupPrior` — the
  noisy-OR base `1 − ∏(1 − p_i)` over the absorbed records' effective priors, recency NOT baked in.
  At read time the rollup joins the group fold as one pseudo-record whose recency comes from
  `rollupLatest` — it DOES count toward current trust, approximating what the absorbed heads
  contributed. A rolled-up head's own supersession chain (if it had one) rolls up with it: the
  chain is only reachable from a head or from another chain member, and once the head itself is
  summarized, its demoted history is no longer the current answer to any query this plan defines,
  so it absorbs into the same summary rather than being orphaned.
- **Replication safety — the part that makes this a design and not a wish.** Deleting from a
  replicated grow-only set is not expressible as a G-Set operation; an uncoordinated delete gets
  resurrected by the next sync. Two pieces close the hole:
  - Rollup records REPLICATE, and same-id rollups MERGE by: union of `rollupSourceIds`, recount,
    recompute `rollupPrior` over the union, min of earliest, max of latest. Union is a join, so
    two peers that compacted at different moments converge (the OR-Set tombstone insight run in
    reverse: the summary carries the ids it absorbed, so absorption itself replicates).
  - On ANY merge path, an incoming assertion record whose source id appears in one of its group's
    rollup id-lists is dropped, not inserted — a late or re-synced copy of an absorbed assertion
    is recognized and stays absorbed.
- **What compaction costs, stated plainly:** absorbed heads lose their individual timestamps and
  per-record audit lines; the count, the id list, the time bounds, and the trust contribution
  survive. The newest-K window means the recent, disputable tail is always intact.
  `rollupSourceIds` grows linearly with absorbed count (~25 bytes/id — a thousand absorbed ids is
  ~25 KB against the ~1 MB of records they replace); if id lists ever dominate, a
  counting/Bloom representation is the successor, not designed here.

**Pool 2 — demoted leaves of one source's own chain, compacted independently and more freely.**

- **Trigger:** one source's own chain depth for one triple crosses `CHAIN_ROLLUP_THRESHOLD`
  (default 8 — far lower than pool 1's, since nothing here is trust-sensitive and there is no
  reason to let a chatty source's history grow large before trimming it).
- **Action:** keep the newest `CHAIN_KEEP_DEPTH` (default 2 — the head plus one demoted
  predecessor, enough for "what did it just say before this" without walking a rollup) demoted
  leaves of that chain; roll every older leaf into ONE summary record with id
  `fact:<tripleHash>@<sourceId>#rollup`, carrying the absorbed ids, their count, and their time
  bounds — no `rollupPrior`, since these were never trust-contributing and a compacted chain
  segment must not start contributing on the way out. An "as of &lt;date&gt;" walk that reaches the
  rollup and needs a point inside its absorbed span gets the rollup's own bounds as the best
  available answer ("sometime in this window"), not a fabricated exact instant — the same honest
  degradation the rest of this plan insists on elsewhere.
- **Replication safety:** identical to pool 1's — rollup records replicate and merge by union;
  merging in a source's own already-absorbed id is a no-op re-absorption, not a re-insertion.
- **This pool needs no `rollupPrior`, no type ceiling interaction, and no read-time trust
  recomputation**, which is what makes it safe to trigger far more eagerly than pool 1.

- **When NOT to compact (both pools):** never across source TYPES (a rollup is one type, so type
  ceilings and priors stay computable for pool 1), never the sole record of a type/chain, and
  never for a pool under its own threshold — the default state of nearly every fact is "no rollup
  exists" in either pool.

`PLAN_MUD.md` already names whole-store growth (and retraction tombstones) as open for the mesh at
large; this section resolves the fact-sibling slice of it only.

## Delegating search to the RDBMS: real indexed columns

Confirmed this session (read from `core.mjs:181-187`): today's sqlite backend stores every
individual as one opaque JSON blob — `individuals(id PK, ord, class, label, json)` — with no
subject/predicate/object columns for facts anywhere. `loadMemory` runs
`SELECT json FROM individuals ORDER BY ord` (`core.mjs:300`) — the WHOLE table, every call — and
everything downstream is a JS array scan. SQLite is a durable blob store here, not a query engine.

The operator wants sqlite locally and a cloud relational backend later
(`PLAN_MEMORY_BACKEND_AWS.md`; NEXT.md's marginalia item), so the schema is plain portable SQL —
nothing sqlite-specific, works against Postgres/MySQL/Aurora as written:

```sql
CREATE TABLE IF NOT EXISTS facts (
  id            TEXT PRIMARY KEY,  -- "fact:<tripleHash>@<sourceId>", or "...#v<n>" once superseded
  triple_hash   TEXT NOT NULL,     -- "fact:<tripleHash>" — the group key and public/compat fact id
  subject       TEXT NOT NULL,
  predicate     TEXT NOT NULL,
  object        TEXT NOT NULL,
  source_id     TEXT NOT NULL,     -- "src:corpus:conceptnet", "src:teach-node:7f3a9c2e", "src:none"
  source_type   TEXT NOT NULL,     -- SOURCE_PRIOR key ("corpus", "teach", ...); "" for src:none
  trust_score   REAL NOT NULL,     -- this record's OWN effective prior — never the group aggregate
  created_at    TEXT NOT NULL,
  observed_at   TEXT,              -- nullable BY DESIGN: stored only when a caller supplied one
  superseded_by TEXT,               -- nullable: the common-case single successor id, NULL = head
  json          TEXT NOT NULL      -- the full individual — source of truth, same as today
);
CREATE INDEX IF NOT EXISTS facts_by_triple_hash       ON facts(triple_hash);
CREATE INDEX IF NOT EXISTS facts_by_subject_predicate ON facts(subject, predicate);
CREATE INDEX IF NOT EXISTS facts_by_predicate_object  ON facts(predicate, object);
CREATE INDEX IF NOT EXISTS facts_current              ON facts(triple_hash, source_id, superseded_by);
```

Fixes and decisions relative to this document's earlier draft of the same table, all made
deliberately:

- `source_node_id TEXT` (nullable) → `source_id TEXT NOT NULL`: every record has exactly one
  source key under this model, including the `src:none` fallback, so NULL has no meaning here.
  Renamed because corpus/reference sources aren't nodes; the column holds the assertion key,
  which is a Source id.
- **`UNIQUE (triple_hash, source_id)` REMOVED, superseded by supersession** (this document's
  earlier draft had it; the "Supersession" section above is why it no longer holds). Once a
  source's own re-assertion is kept rather than discarded, a demoted record and its head share the
  same `(triple_hash, source_id)` pair by construction — that pair is no longer a database-provable
  uniqueness fact, only "at most one record with this pair has `superseded_by IS NULL`," an
  application-enforced invariant (checked by the writer before insert), not a schema constraint.
  A `WHERE superseded_by IS NULL` partial unique index would express it directly, but partial
  indexes aren't universally portable across the Postgres/MySQL/Aurora targets this schema is
  written for, so the invariant stays at the application layer and `facts_current` (a plain,
  portable composite index) makes the "find the head for this source" query fast without claiming
  to enforce uniqueness itself.
- `superseded_by` is a nullable projection of the FULL `mgx:supersededBy` collection living in the
  JSON blob — the single common-case successor, fast to filter on (`WHERE superseded_by IS NULL`
  finds every live head in one indexed scan). The rare fork case (more than one successor) is only
  ever visible in the blob; a forked record's projection column holds one of the two arbitrarily,
  which is fine because the column exists purely to make "is this a head" and "what superseded it,
  usually" cheap, never to be the source of truth for the fork itself. `mgx:supersedes` gets no
  column at all — walking backward is rarer than filtering for heads, and it's one JSON read away.
- `trust_score` NOT NULL with its meaning pinned in the comment: the per-record prior is a
  write-time constant; the GROUP aggregate deliberately has no column (see the head discussion —
  a stored aggregate without its recompute contract is a stale-read bug waiting).
- `source_type` added: the Sybil ceilings and the sync filters both select by type; deriving it
  by parsing `source_id` in SQL would be backend-specific string work, which this schema bans.
- `observed_at` stays nullable with the reason corrected: not "only state predicates set this"
  (wrong — any source may supply one) but "stored only when supplied"; the fallback chain is
  read-time logic, not a column default.
- Index names carry `IF NOT EXISTS`, matching the shipped DDL's idempotent style.

The columns are a write-time-maintained projection of the JSON blob (populate on every
insert/update in the same statement batch), with the blob remaining the single source of truth —
the same discipline `individuals` already applies to `class`/`label`. This piece is orthogonal to
the multi-record model and is worth landing FIRST even alone: `SELECT json FROM facts WHERE
subject = 'dog'` is an indexed lookup in any backend, against today's load-everything-and-scan.
It needs its own read-path perf guard; today's only perf test
(`test/adapters/memory-seed-perf.test.mjs`) covers write batches only.

The head table (path b of the aggregate section; built as this plan's final landing step):

```sql
CREATE TABLE IF NOT EXISTS fact_heads (
  triple_hash  TEXT PRIMARY KEY,
  trust_base   REAL NOT NULL,      -- aggregate BASE (no recency — recency applies on read)
  inputs_json  TEXT NOT NULL,      -- the group's audit trail
  updated_at   TEXT NOT NULL
);
```

## Migration: every existing store, every shipped seed

Decision: migrate in place, lazily, on load — the same slot and contract as the two shipped
precedents: `migrateFactIds` (`core.mjs:598-640` — the 8-hex → 16-hex fact-id re-key, including
remapping justification ids) and `migrateLegacyProvenance` (`core.mjs:908-923` — the
provenance-string → Source-individuals materialization). Both are idempotent, deterministic,
converge to no-ops on migrated stores, and are already tested machinery. The alternative — leave
old single-record facts as-is and let two shapes coexist — was examined and not chosen: every
reader would carry both shapes indefinitely, and the group fold's rule "a bare `fact:<hash>` id is
a GROUP reference" becomes ambiguous if a bare id can also be a live legacy record. One shape on
disk, one migration, run once per store.

The algorithm, exactly (a pure payload transform, running where `migrateFactIds` runs, after it):

1. For each individual of class Fact whose id contains no `@`: read (s, p, o); recompute
   `tripleHash = factIdFor(s, p, o)` (this also inherits `migrateFactIds`' healing of any
   pre-widening id).
2. Split `mgx:factProvenance` on `" | "`. Derive each tag's sourceId
   (`sourceIdFor(provenanceTagToSource(tag))`; null/empty → `src:none`). Group tags by sourceId.
3. Emit one record per sourceId group: id `fact:<tripleHash>@<sourceId>`; provenance = that
   group's tag(s); `mgx:sourceId` attribute set; `mgx:createdAt` = the earliest tag-embedded
   timestamp in the group, else the legacy fact's `createdAt`; `mgx:observedAt` never backfilled;
   `mgx:trustScore` = the record's own effective prior (recomputed);
   `mgx:hasProseTokens`/`mgx:factQuantifier` copied onto every sibling (triple-level values,
   duplicated — a few bytes each, and it keeps every record self-contained);
   `mgx:factJustification` copied ONLY onto the entailed-source record (it explains the
   entailment, not the corroborators).
4. Delete the legacy individual. Scrub its `statedBy` edges; run `syncFactSources` per new record
   (rebuilds Source individuals, edges, per-record trust — the add-only, idempotent path that
   already exists).
5. Leave every OTHER reference to the bare id — `mgx:factJustification` premise lists,
   `derived_from`, edge endpoints — untouched. A bare `fact:<hash>` is the group id by
   definition under this model; readers resolve it via the `triple_hash` column (SQL path) or the
   id-prefix index (payload path). No remap pass, no dangling references, and the public fact id
   printed by `tmct inspect`/the ledger stays stable across the migration.

Determinism: the transform is a pure function of the payload, so every peer migrating the same
converged store lands on byte-identical records — a peer that migrated early and one that migrated
late still merge cleanly, because the wire re-derives the same ids from the same tags.

Shipped seeds (`chat-seed.json`, the init corpora) regenerate at build time through `appendFacts`
and need no data migration — they come out in the new shape on the next `npm run roll`. The SHACL
gate (`assertIndividualValid`, `ontology/memory-shapes.ttl`) needs its Fact shape extended for
`mgx:sourceId`/`mgx:observedAt`, the `@`-suffixed id form, the `#v<n>` demoted-record id form, and
the optional `mgx:supersedes`/`mgx:supersededBy` collections (present only once a chain's first
supersession happens — absent, never empty, on every record migration itself produces) BEFORE the
write path flips; the gate throws on violations, so shipping the writer first would brick every
write.

## Landing order

Each step is independently green; nothing below requires a later step to function.

1. **SQL projection columns + read perf guard** (current model, no re-keying — pays for itself
   regardless of the rest).
2. **Stable node id + tag grammar** (`#node:<id>` segment, `src:teach-node:` derivation,
   relabel + chip strip). Wire-compatible with old peers by construction.
3. **The re-key**: per-assertion writes in `appendFact`/`appendFacts`, the on-load migration, the
   `readFactRows` group fold + `computeAssertionGroupTrust`, SHACL shape update, AND the
   same-source supersession chain ("Supersession" above — re-key the demoted record to
   `#v<n>`, write `mgx:supersedes`/`mgx:supersededBy`, keep the head at the stable id). One step:
   a same-source re-assertion has always needed the re-key logic to detect "this is the same
   source updating its own record," and supersession is what that detection now does instead of an
   in-place mutation. This is the big, subtle step; its blast radius is `core.mjs`, `trust.mjs`,
   their test files, and every trust-expectation pin in the estate.
4. **Resolver table + `effectiveObservedAt` + `findContradictions` re-wire** (strategy enum,
   widened merge set, tie routing).
5. **The dated teach frame** (`datedTeachSuffix` probe in `normalize.mjs`, the teach lanes'
   strip-parse-passthrough, the `observedAt` wire field). Needs step 4's chain and the
   `appendFacts` passthrough. Shipping it raises infbench's `observed-at-conflict` pin in place
   (see the frame's own section) — that update is part of this step, not a follow-up.
6. **Sybil tier 1+2** (type ceilings in the group fold; `src:teach-node:` joins the
   reliability-tracked set; invite-edge fact at join).
7. **Compaction** — build when a real store first approaches the threshold; the guard metric
   (max group size, reported by `tmct inspect`) ships with step 3 so the moment is visible.
8. **The `fact_heads` materialization** — the final phase: the table (DDL above), the recompute
   inside the same `mutateMemory` transaction as any write touching a group, reads consuming a
   head when one exists and falling back to the group fold when none does, and the
   recency-stays-read-time rule enforced by construction (heads store the aggregate BASE only).
   Never replicated, never exported — local derived state, exactly as the aggregate section
   specifies. The cross-object `latest-observation-wins` supersession edge ("Supersession" above)
   is built alongside this step, for the same reason: both are local, derived breadcrumbs over an
   already-correct read-time computation, never wire state.

Bench and playtest coverage for the sibling-resolution surface ships AHEAD of all of this and is
already landed: infbench's `c2SiblingResolution` template (INF-6, 20 cases — repeat-teach
corroboration, multi-valued merge, both-kept contradiction, and the floor-pinned dated-conflict
cell) and `SKILL_PLAYTEST_EDGE_HUNT.md` §4.1's sibling-resolution axis. Steps 3–5 each have a pin
waiting for them.

## Sources

- M. Shapiro, N. Preguiça, C. Baquero, M. Zawirski, "Conflict-free Replicated Data Types," SSS
  2011 (also INRIA RR-7687). Strong eventual consistency; state-based merge as semilattice join;
  the G-Set and LWW-register constructions used throughout.
  https://inria.hal.science/inria-00609399v2
- N. Preguiça, C. Baquero et al., "Dotted Version Vectors: Logical Clocks for Optimistic
  Replication" (arXiv:1011.5808), and Riak's engineering write-up "Vector Clocks Revisited Part
  2: Dotted Version Vectors" — sibling explosion as a real failure mode, bounded by DVVs.
  https://riak.com/posts/technical/vector-clocks-revisited-part-2-dotted-version-vectors/
- Riak KV documentation, "Conflict Resolution" and "Causal Context" — `allow_mult` (default true
  since 2.0), siblings, per-bucket-type resolution strategies, last-write-wins caveats.
  https://docs.riak.com/riak/kv/latest/developing/usage/conflict-resolution/
- Y. Li, J. Gao, C. Meng, Q. Li, L. Su, B. Zhao, W. Fan, J. Han, "A Survey on Truth Discovery,"
  SIGKDD Explorations 17(2), 2016 (arXiv:1505.02463) — the joint source-reliability /
  claim-truth estimation frame.
- X. Yin, J. Han, P. S. Yu, "Truth Discovery with Multiple Conflicting Information Providers on
  the Web," KDD 2007 — TruthFinder; trustworthy-source ↔ true-claim iteration.
- X. L. Dong, L. Berti-Équille, D. Srivastava, "Integrating Conflicting Data: The Role of Source
  Dependence," PVLDB 2(1), 2009; same authors, "Truth Discovery and Copying Detection in a
  Dynamic World," PVLDB 2(1), 2009; with Y. Hu, "Global Detection of Complex Copying
  Relationships Between Sources," PVLDB 2010 — corroboration requires independence; copying is
  detectable and must be discounted. http://www.vldb.org/pvldb/vol2/vldb09-pvldb47.pdf
- X. L. Dong, L. Berti-Équille, D. Srivastava, "Data Fusion: Resolving Conflicts from Multiple
  Sources," in Handbook of Data Quality, Springer 2013 — the survey form of the above.
- R. T. Snodgrass (ed.), "The TSQL2 Temporal Query Language," 1995; C. S. Jensen & R. T.
  Snodgrass, "The TSQL2 Data Model" — valid time vs transaction time.
  https://people.cs.aau.dk/~csj/Thesis/pdf/chapter12.pdf
- K. Kulkarni, J.-E. Michels, "Temporal Features in SQL:2011," SIGMOD Record 41(3), 2012 —
  application-time periods and system-versioned tables standardized.
- A. Jøsang, "A Logic for Uncertain Probabilities," Int. J. of Uncertainty, Fuzziness and
  Knowledge-Based Systems 9(3), 2001; A. Jøsang et al., "Cumulative and Averaging Fusion of
  Beliefs," Information Fusion, 2010 — opinion fusion and trust discounting.
- J. R. Douceur, "The Sybil Attack," IPTPS 2002 — without trusted certification, unlimited
  identities are always possible. https://link.springer.com/chapter/10.1007/3-540-45748-8_24
- S. D. Kamvar, M. T. Schlosser, H. Garcia-Molina, "The EigenTrust Algorithm for Reputation
  Management in P2P Networks," WWW 2003 — global trust by power iteration from a pre-trusted
  seed. https://dl.acm.org/doi/10.1145/775152.775242
- H. Yu, M. Kaminsky, P. B. Gibbons, A. Flaxman, "SybilGuard: Defending Against Sybil Attacks via
  Social Networks," SIGCOMM 2006 — Sybils mint identities freely, trust edges dearly; the small
  cut between Sybil and honest regions. https://dl.acm.org/doi/10.1145/1159913.1159945
- B. N. Levine, C. Shields, N. B. Margolin, "A Survey of Solutions to the Sybil Attack," UMass
  tech report, 2006. https://nymity.ch/sybilhunting/pdf/Levine2006a.pdf
- J. J. Carroll, C. Bizer, P. Hayes, P. Stickler, "Named Graphs, Provenance and Trust," WWW 2005
  — per-graph (per-assertion-set) provenance for RDF. https://dl.acm.org/doi/10.1145/1060745.1060835
