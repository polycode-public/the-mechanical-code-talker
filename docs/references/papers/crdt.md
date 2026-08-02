# CRDTs — what tmct replicates, and where the convergence actually comes from

**Consumer in repo:** `src/adapters/memory/core.mjs` (`appendFacts`, `readFactRows`, `removeFacts`),
`src/domain/memory/compaction.mjs`, `src/domain/memory/retraction.mjs`,
`src/services/p2p-room.mjs`, `src/domain/p2p/facts.mjs`,
`src/domain/p2p/provenance-relabel.mjs`, `src/services/adventure.mjs` (`foldWorldState`,
`rulingTestimonyClaim`), `PLAN_MUD_WEBRTC.md`.
**Retrieval date:** 2026-08-02 — VERIFIED. Every citation below was checked against a primary
source: the report PDFs' own title pages and ISRN blocks, dblp, the ACM Digital Library, and the
IETF datatracker. The two claims about tmct's own merge behaviour that are easy to get wrong were
checked by running the code, not by reading it (see "What the probes showed").
**Licence:** link and short factual excerpt only. The INRIA reports are free to read on HAL and
mirrors, but carry no redistribution grant, so no PDF is committed here. Quotes are brief factual
excerpts with attribution.

## Why this entry exists

`PLAN_MUD_WEBRTC.md` says the peer layer is "a state-based G-Set CRDT: merge by set union", and
says `appendFacts` "is a G-Set's merge rule, byte for byte". Both are close enough to build from
and imprecise enough to mislead. The set's element is not a triple. The merge is not the only
thing that has to converge. And the part that decides what a player actually sees is not a CRDT at
all.

This entry pins the literature, then says what the code does.

## The 2011 papers are four documents, not one

People cite "Shapiro et al. 2011" as though it were a single paper. Four artefacts came out that
year, by the same four authors in the same order: Marc Shapiro (INRIA and LIP6), Nuno Preguiça
(CITI, Universidade Nova de Lisboa), Carlos Baquero (Universidade do Minho), Marek Zawirski (INRIA
and UPMC).

| document | kind | number / venue | date | what it holds |
|---|---|---|---|---|
| *A comprehensive study of Convergent and Commutative Replicated Data Types* | INRIA research report | RR-7506, 47pp, HAL `inria-00555588` | January 2011 | the full catalogue: §3.2–3.3, Specifications 8–15 |
| *Convergent and Commutative Replicated Data Types* | journal column | Bulletin of the EATCS no. 104, pp. 67–88 | June 2011 | the Distributed Computing Column version of RR-7506 |
| *Conflict-free Replicated Data Types* | INRIA research report | RR-7687, 18pp, v2 | initial 2011-07-19, revised 2011-08-25 | the formal apparatus: Definitions 2.1–2.6, Theorems 2.1–2.2 |
| *Conflict-Free Replicated Data Types* | conference paper | SSS 2011, LNCS 6976, pp. 386–400, DOI `10.1007/978-3-642-24550-3_29` | Grenoble, 10–12 October 2011 | the published version of RR-7687 |

SSS 2011 is the 13th International Symposium on Stabilization, Safety, and Security of Distributed
Systems, editors Défago, Petit and Villain. Its metadata was confirmed through dblp
(`conf/sss/ShapiroPBZ11`); the Springer chapter page itself sits behind an auth redirect, so the
page range and DOI are dblp's and Springer's landing metadata rather than a read of the chapter.

**Cite the right one.** RR-7506 has the catalogue. RR-7687 and the SSS paper have the definitions.
The named definition of strong eventual consistency is in RR-7687, and it is **not** in RR-7506's
body. That report's abstract uses the phrase "a formal Strong Eventual Consistency (SEC) model"
while §2.3 formalises the same property under the name "Eventual Convergence". A citation of
RR-7506 for the SEC definition points at a document that does not carry it.

## What the definitions say

RR-7687, Definition 2.3:

> "**Strong eventual consistency (SEC).** An object is Strongly Eventually Consistent if it is
> Eventually Consistent and: **Strong Convergence:** Correct replicas that have delivered the same
> updates have equivalent state."

Eventual consistency, in the same document, is eventual delivery, convergence and termination.
Strong convergence adds the part that matters here: same updates delivered means same state, with
no rollback and no consensus round in between.

The two families, both from RR-7687:

- **State-based, CvRDT** (convergent). Definition 2.4, the *monotonic semilattice object*: the
  payload values form a join semilattice under a partial order, `merge` computes the least upper
  bound of two states, and every update moves the state upward (`s ≤ s•u`). Theorem 2.1: given
  eventual delivery and termination, that is enough for SEC.
- **Operation-based, CmRDT** (commutative). Definition 2.6 requires concurrent updates to commute.
  Theorem 2.2 adds a precondition the state-based side never needs: **causal delivery**.

**tmct is state-based.** Its merge takes a batch of facts and joins them into the store; it never
requires that a peer's operations arrive in causal order, and it has no vector clock, no version
vector and no delivery precondition. `p2p-room.mjs` merges a historical `sync-response` and a live
`op` through the same path on purpose, with the comment "merging is idempotent by id, so overlap
between the historical response and live ops needs no sequencing". That is the CvRDT bargain: pay
in state size, buy freedom from delivery order.

## The catalogue, and what each one costs

All from RR-7506 §3.2–3.3.

| type | spec | what it buys | what it costs |
|---|---|---|---|
| G-Set | Spec 11, §3.3.1 | add only, merge by union | nothing ever leaves |
| 2P-Set | Spec 12, §3.3.2 | remove once | a tombstone per element, kept for good, and a removed element stays removed |
| LWW-Register | Spec 8 (state), Spec 9 (op), §3.2.1 | one value per key | a timestamp people must agree on, and a silently dropped concurrent write |
| MV-Register | Spec 10, §3.2.2 | keeps every concurrent write | the reader has to resolve the multi-value |
| OR-Set | Spec 15, §3.3.5 | add wins over concurrent remove; re-add works | a unique tag per add, and a remove that carries the tags it observed |

OR-Set is introduced in RR-7506 itself. The report presents it as its own construction, with no
prior citation, against the 2P-Set and LWW-Set approaches it critiques in the same section.

**One correction worth carrying.** RR-7506 attributes the LWW-Register to Johnson and Thomas and
dates its reference [20] to "January 1976". RFC 677, *The Maintenance of Duplicate Databases*, Paul
R. Johnson and Robert H. Thomas, is dated **27 January 1975** (IETF datatracker). The authors and
title are right; the year in that bibliography entry is off by one, and it propagates into papers
that copy it. Thomas's later *A majority consensus approach to concurrency control for multiple
copy databases*, ACM TODS 4(2), June 1979, pp. 180–209, DOI `10.1145/320071.320076`, is a separate
paper.

## What tmct actually replicates

### The element is a (triple, source) record, not a triple

`core.mjs` files every assertion under `<groupId>@<sourceId>`. The group id is the content address
of the normalised subject, predicate and object. The source id comes from the provenance tag. Two
peers asserting the same triple hold two records that share a group. `readFactRows` folds the
group's live heads into one row.

Inside one record, the provenance tags themselves union
(`planFactAssertion`: `tags = [...new Set([...headTags, ...group.tags])]`). So the store is a G-Set
of records, and each record carries a G-Set of tags. Both levels merge by union.

`PLAN_MUD_WEBRTC.md`'s claim that `appendFacts` already is the merge function holds. What the plan
gets wrong is the granularity: it says `appendFacts` "unions the incoming provenance tag onto
whatever's already stored at that id", as if the id were the triple. The id is the triple plus the
source. That difference is the whole reason two peers who independently taught the same fact end
up corroborating it rather than overwriting each other.

### Three things make the union idempotent on the wire, not just in the store

- **One wire fact per tag.** `toWireFacts` in `p2p-room.mjs` emits one fact row per provenance tag
  rather than one row carrying the `" | "`-joined union. A joined union arrives as one opaque
  string that matches no stored tag, so it would union again on every hop and never settle.
- **Relabelling is a fixpoint.** `relabelForBroadcast` rewrites a local `teach:`/`operator:` tag to
  `teach:peer:<name>#node:<id>@<ts>`, keeping the tag's own assertion time rather than the moment
  it went over the wire. `p2p-room.mjs` then refuses to relabel anything already matching
  `/^teach:peer:/`. Relaying a tag you received reproduces it byte for byte, so the union stops
  growing once every peer has seen it.
- **Compaction replicates as a union too.** `compaction.mjs`'s rollup summary carries the ids it
  absorbed, and two summaries at one id merge by union of those ids. Every other field on a summary
  (count, bounds, prior) is derived from that union, so the whole record is a pure function of it.
  Its header states the reason plainly: "deleting from a replicated grow-only set is not a G-Set
  operation — an uncoordinated delete comes back on the next sync."

### There is a per-source revision chain, and it is still add-only

The same source asserting the same triple again with a **later embedded timestamp** does not union.
`supersedesPriorAssertion` fires, the old head moves to `<recordId>#v<n>` carrying the same bytes
plus a `supersededBy` link, and the new head takes the stable id. Nothing is deleted. `readFactRows`
skips demoted leaves, so the chain is history rather than belief.

This is the one place the plan doc's "byte for byte a G-Set" is loose. A pure G-Set has no head and
no leaf.

## Where "latest wins" happens, and why it is not a CRDT primitive

Nothing in the replication layer resolves a conflict. Resolution is a **read**.

- `foldWorldState` (`adventure.mjs`) ranks placement, position, openness and mass rows by the
  `(epoch, turn)` pair read off the row's own subject. `snapshotSubject` writes `subject@turnN`
  while the world is on epoch 0 and `subject@epochE@turnN` after a recast; `parseSnapshotSubject`
  reads it back. `outranks` is `!prior || rowEpoch > prior.epoch || (rowEpoch === prior.epoch &&
  turn >= prior.turn)`. A base row with no stamp ranks as turn 0 of the current epoch, so a recast
  re-seeds a world that no pre-recast snapshot can outrank.
- `rulingTestimonyClaim` ranks the tags on one `knows-about` edge by epoch, then firsthand over
  hearsay, then turn, then a `:gone` suffix. `PLAN_MUD_WEBRTC.md` says these claims "still rank by
  bare turn across epochs". They do not. `characterTestimonyTag` writes an `epoch<N>:turn<N>`
  segment once the world has been recast, `testimonyClaim` parses it, and `outranksClaim` puts
  epoch above every other field.
- `latestFact` and `isRecentWave` (`domain/p2p/facts.mjs`) take the newest tag timestamp for a
  node name, and treat "currently waving" as a recency window over a tag rather than a stored flag.

The plan doc calls this "an application-level 'latest wins' read, not a new CRDT primitive", and
that survives contact with the code. The distinction earns its keep for three reasons.

**It keeps the merge total.** A CRDT LWW-Register drops the loser at merge time. Once dropped, it
is gone from every replica, and the drop depends on a clock two machines have to agree about. Under
a read-time rank, both rows are still in the store on every peer. A peer that later learns the
clocks were skewed can be given a better ranking rule and re-derive a different answer from data it
never threw away.

**It keeps the provenance whole.** A merge-time LWW would have to discard the losing assertion.
That assertion is a citation. tmct's product promise is that an answer names who said it, so the
loser has to stay readable.

**It moves the correctness burden.** A read-time resolver is only safe if it is a pure function of
the replicated set. `foldWorldState` is not, on its own. `outranks` uses `turn >= prior.turn`, so at
equal `(epoch, turn)` the row appearing **later in the array** wins. Two peers holding an identical
fact set fold it differently while their arrival orders differ. `p2p-room.mjs`'s
`sortFactIndividualsById` closes that: after every merge it sorts the Fact individuals by
content-addressed id, in codepoint order and never `localeCompare`, and `readFactRows` reads them
in that order. `rulingTestimonyClaim` needs no such help. Its comparator is a strict order over
four fields, so its fold is order-independent by construction.

So the ranking is a last-writer-wins register whose "last" is `(epoch, turn)` and whose tiebreak is
content-address order. Arbitrary at ties, identical on every peer, and computed fresh from the set
every time.

## Why a G-Set is enough

Four properties of the store do the work.

1. **Assertion is the only primitive that replicates.** A move, a wave, a dig, a taught fact and a
   rename are all appends. `adventure-editor.mjs` states the discipline for its own family:
   editing a placement is "a plain new write superseding the old one, never a retraction".
2. **Every element is content-addressed.** Re-delivery of an identical fact resolves onto the same
   record, so duplicate mesh paths, a re-seed and a sync that overlaps the live stream are all
   no-ops. That is the idempotence a G-Set needs, and tmct gets it from hashing rather than from
   per-add tags.
3. **Every element carries who and when.** The provenance tag already holds the node id and the
   instant. Read-time ranking has the data it needs without a second structure.
4. **Nothing is a "current value" in storage.** Current values are derived: `foldWorldState`,
   `rulingTestimonyClaim`, `latestFact`. There is no register to overwrite, so there is no
   register conflict to resolve at merge time.

## Why not an OR-Set

An OR-Set solves one problem: a remove that is concurrent with an add of the same element, where
the add should win and a later re-add must survive. It does that by giving every add a unique tag
and having a remove carry the tags it observed.

The price is wrong for tmct, and the one removal it does have is narrow enough not to need it.

**Almost nothing removes.** "Stopping being true" is expressed four ways, all of them appends: a
newer `@turnN` snapshot for world state, a fresh testimony tag with a `:gone` suffix for what a
character knows, a newer tag for a name, and a recency window for a wave. A wave is the clean case.
Waving again re-asserts the same content-addressed triple, `appendFacts` unions a fresh tag onto
it, and `isRecentWave` decides whether it is current. The animation needs no remove because
"waving" was never stored. Retraction is the exception, and it takes the summary shape rather than
the OR-Set one for the reasons below. What that costs is the re-add: a suppressed assertion comes
back only under a later instant, never under its own identity.

**tmct already has the unique tag, and it is a product feature.** `teach:peer:<name>#node:<id>@<ts>`
is exactly the shape an OR-Set's add-tag takes: a node identity plus an instant, unique per add.
The difference is that an OR-Set's tag is opaque bookkeeping, invisible to the user, safe to
garbage-collect. tmct's is the citation the answer chip renders as "taught by X", and the input to
trust scoring. It is read, not just compared.

**Tombstones would damage that record.** An OR-Set remove keeps the removed tags. In tmct those
tags are the audit trail, which leaves two bad options: hide a tombstoned tag from the citation, so
the store's account of what it was told is now incomplete, or show it, in which case the removal
removed nothing a reader can see. A store whose central promise is grounded-or-refuse cannot have a
provenance record that quietly omits assertions it received.

**The delivery guarantee is not there.** OR-Set is specified op-based (RR-7506 Spec 15), and
Theorem 2.2 makes causal delivery a precondition. tmct's mesh gives no such guarantee: `op` and
`sync-response` merge in whatever order they arrive, by design. Adopting OR-Set semantics would
mean building causal delivery first, then a causal-stability rule before any tombstone could ever
be dropped.

**Two tombstones exist, and both take the summary shape rather than the OR-Set one.**
`assertionGroupsFor` filters out any source a pool-1 rollup has already absorbed, "without it the
next sync resurrects everything compaction just folded, which is what makes deleting from a
replicated set hard at all". `retraction.mjs` does the same job for a real change of belief: one
record per (triple, source) carrying the record ids it suppressed, merging by union of those ids
and max of the instant it carries. Neither hides a tag. The compaction summary keeps the sources it
absorbed in the citation; the retraction record keeps the tags of what it suppressed, so the store's
account of what it was told stays complete.

## What does not converge

Two things. Named as present behaviour, not as design limits.

**One source's own revision history is order-sensitive in the provenance projection.** If a source
asserts a triple at `t1` and again at `t2 > t1`, delivery order changes what the read row's
provenance string holds. Arriving `t1` then `t2` demotes the `t1` record, so the row shows only
`t2`. Arriving `t2` then `t1` falls through the else branch in `planFactAssertion`, unions `t1`
onto the head, and the row shows both. The triple converges, the newest tag is present either way,
and everything computed from the maximum agrees. The tag set does not.

**Ties are arbitrary, not wrong.** At equal `(epoch, turn)` the fold picks by content-address
order. Every peer picks the same one. Nobody chose which.

## What the probes showed

Run against the real modules, in memory, on 2026-08-02.

| probe | result |
|---|---|
| same tag appended twice | one row, one tag. Idempotent |
| two distinct sources, both orders | identical row, identical tag order (`alpha \| beta` either way). Commutative |
| one source at two instants, both orders | row provenance differs: `{t2}` versus `{t1, t2}` |
| delete then peer re-delivery, before the retraction record existed | the fact returns, same id, same tag |
| retract then peer re-delivery | refused on ingest; the fact stays gone, in either arrival order |
| equal `(epoch, turn)`, array order flipped | fold answer flips; after the id sort, both orders agree |
| `epoch 2 turn 1` against `epoch 0 turn 9` | the later epoch wins in both array orders |

## The monotonicity connection

The CALM theorem says a program has a coordination-free, eventually-consistent distributed
implementation exactly when it is monotonic. Hellerstein stated it as a conjecture in *The
Declarative Imperative: Experiences and Conjectures in Distributed Logic*, ACM SIGMOD Record 39(1),
**2010**, pp. 5–19, DOI `10.1145/1860702.1860704`. The year is 2010; the paper is often misdated.
Ameloot, Neven and Van den Bussche proved it for relational transducer networks in *Relational
Transducers for Declarative Networking*, PODS 2011, pp. 283–292, with the journal version in JACM
60(2), Article 15, 2013, DOI `10.1145/2450142.2450151` (preprint arXiv:1012.2858). Hellerstein and
Alvaro's *Keeping CALM: When Distributed Consistency Is Easy*, CACM 63(9), September 2020,
pp. 72–81, DOI `10.1145/3369736` (arXiv:1901.01930), is the readable restatement.

The short version of the framing says an append-only store is monotonic, retraction is the
non-monotonic part, and tmct pushes it out of replication into the read. That is right about the
base layer and wrong about what the move buys.

**Right about the base layer.** `appendFacts` only grows the store. Nothing coordinates: no leader,
no quorum, no lock, no consensus round. That is CALM's coordination-free case, and it is why the
two-paste WebRTC mesh works with no rendezvous server.

**Wrong about the read.** Ranking rows and taking the newest is a non-monotone operator. It means
"there is no later row", which is negation over the whole set, so its output is not monotone in the
input. Moving it to the read does not make it monotone. The placement really does change from
`burrow` to `meadow` when a later snapshot arrives.

What the move buys is **confluence**, not monotonicity: the view is a deterministic function of the
replicated set, so two peers holding the same set compute the same view. Divergence becomes
temporary rather than permanent. That is SEC stated at the view rather than at the base relation,
and it holds only because `sortFactIndividualsById` makes the fold a function of the set. Without
that sort the view is neither monotone nor confluent, and the whole argument fails.

So: monotone base, non-monotone but confluent view, coordination-free throughout. `removeFacts` is
the operation that sits outside all of it, and what puts it back inside is the retraction record:
the delete becomes an APPEND of a tombstone, the base relation keeps growing, and the suppression
happens at the read. Same trade as the placement fold, one level down.

## The verdict for tmct

**The G-Set is the right choice, and "state-based G-Set" is an incomplete description of what
ships.** What ships is a grow-only set of `(triple, source)` records, each carrying a grow-only set
of provenance tags, with a per-source revision chain that demotes rather than deletes, plus two
replicated summaries that merge by union of the ids they carry: a compaction rollup and a
retraction record. Union at every level. No causal delivery required anywhere.

**The conflict resolution is a read-time query, and it must stay a pure function of the set.** That
is the invariant to protect. `foldWorldState` broke it and was fixed outside itself, by
`p2p-room.mjs` sorting Fact individuals by content-addressed id after every merge. Any future
resolver has to be checked the same way: feed one peer's facts in two different orders and demand
the same answer. A resolver that reads a wall clock, a local counter, or array position without
that sort will look correct in a single-browser test and diverge on the mesh.

**The OR-Set's price is the wrong one for tmct: its tombstone would put holes in the provenance
record.** The provenance record is a product feature, and that is the reason the removal tmct does
have takes the summary shape instead — a retraction record carries the tags of what it suppressed
rather than hiding them.

**Retraction over the mesh took the summary route, not the OR-Set one.** `removeFacts` now leaves
a record behind, one per (triple, source), carrying the record ids it suppressed and the moment it
did, so absorption merges by union and stays a join. Two enforcement points read it: the fold
strips a record it covers, and `assertionGroupsFor` refuses to re-materialise one on ingest. Both
compare the assertion's own embedded instant against the retraction's, so a source that says the
thing again later still lands. The suppressed ids are re-keyed through the provenance tag on the
way out and on the way in, because the broadcast relabel means two stores file one assertion under
two Source keys.

Two open problems sit next to it. A retraction record has no causal-stability rule, so nothing
tells it when it could be dropped — the same gap the compaction rollup has. And an OR-Set proper,
with causal delivery, remains the route that would let a suppressed assertion be re-added under its
own identity rather than under a later instant.

## Deepen-next

- **RR-7687 §2 against the sync path.** The report's delivery preconditions are the checklist for
  the mesh. Walk Definitions 2.1–2.6 against `p2p-room.mjs` and record which assumptions the
  two-paste handshake actually supplies.
- **Delta-state CRDTs.** Paulo Sérgio Almeida, Ali Shoker and Carlos Baquero, *Delta state
  replicated data types*, Journal of Parallel and Distributed Computing 111, 2018, pp. 162–173,
  DOI `10.1016/j.jpdc.2017.08.003` (preprint arXiv:1603.01529). Verified via dblp 2026-08-02. This
  is the answer to "the joiner downloads a full copy". `PLAN_MUD_WEBRTC.md`'s sharded manifest
  scheme is a hand-rolled version of the same idea. Read this before building it.
- **Causal stability.** Every tombstone scheme needs a rule for when a tombstone can be dropped.
  Carlos Baquero, Paulo Sérgio Almeida and Ali Shoker, *Pure Operation-Based Replicated Data
  Types*, CoRR arXiv:1710.04469, 2017 (dblp-verified 2026-08-02; a peer-reviewed venue for it was
  not checked). It is the piece the compaction rollup currently does without.
- **The Bloom/CALM lineage.** Alvaro, Conway, Hellerstein and Marczak, *Consistency analysis in
  Bloom: a CALM and collected approach*, CIDR 2011, is cited in RR-7506 §6.3 as related to and more
  restrictive than the monotonic-semilattice condition. Worth reading for how it classifies a
  program's non-monotone points, which is the same question `foldWorldState` poses here.
- **Verify the SSS 2011 chapter directly** if a published-venue citation ever has to carry weight.
  The page range and DOI here come from dblp and Springer's landing metadata, not from the chapter.
