# CRDTs — what tmct replicates, and where the convergence actually comes from

**Consumer in repo:** `src/adapters/memory/core.mjs` (`appendFacts`, `readFactRows`, `removeFacts`),
`src/domain/memory/compaction.mjs`, `src/domain/memory/retraction.mjs`,
`src/domain/memory/causal-stability.mjs`,
`src/services/p2p-room.mjs`, `src/domain/p2p/facts.mjs`,
`src/domain/p2p/provenance-relabel.mjs`, `src/services/adventure.mjs` (`foldWorldState`,
`rulingTestimonyClaim`), `PLAN_MUD_WEBRTC.md`.
**Retrieval date:** 2026-08-02. The 2011 Shapiro et al. artefacts, RFC 677, the CALM line and the
delta-state paper were checked against primary sources: the report PDFs' own title pages and ISRN
blocks, dblp, the ACM Digital Library, and the IETF datatracker. Four citations were not, and each
says so where it appears: the SSS 2011 chapter (auth redirect), Baquero/Almeida/Shoker's venue, and
Wuu and Bernstein. The claims about tmct's own merge behaviour were checked by running the code,
not by reading it (see "What the probes showed").
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

## Why the removal tmct has took the summary shape, not the OR-Set one

Retraction ships. `retraction.mjs` writes one record per (triple, source) carrying the record ids it
suppressed, the mesh replicates it like any other fact, and two enforcement points read it. This
section is why that shape rather than an OR-Set, since the OR-Set is the obvious candidate.

An OR-Set solves one problem: a remove that is concurrent with an add of the same element, where
the add should win and a later re-add must survive. It does that by giving every add a unique tag
and having a remove carry the tags it observed.

**Almost nothing removes.** "Stopping being true" is expressed four ways, all of them appends: a
newer `@turnN` snapshot for world state, a fresh testimony tag with a `:gone` suffix for what a
character knows, a newer tag for a name, and a recency window for a wave. A wave is the clean case.
Waving again re-asserts the same content-addressed triple, `appendFacts` unions a fresh tag onto
it, and `isRecentWave` decides whether it is current. The animation needs no remove because
"waving" was never stored. Retraction is the exception. What the summary shape costs is the re-add:
today a suppressed assertion comes back under a later instant rather than under its own identity.

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
`sync-response` merge in whatever order they arrive, by design. OR-Set semantics would mean
building causal delivery first, and a stability rule for its tombstones after that.

**So both tombstones take the summary shape.** `assertionGroupsFor` filters out any source a pool-1
rollup has already absorbed, through `isAbsorbedSource`, whose header states the reason: "without
this the next sync resurrects everything compaction just folded away, which is the failure mode
that makes deleting from a replicated set hard in the first place". `retraction.mjs` does the same
job for a real change of belief: one record per (triple, source) carrying the record ids it
suppressed, merging by union of those ids and max of the instant it carries. Neither hides a tag.
The compaction summary keeps the sources it absorbed in the citation; the retraction record keeps
the tags of what it suppressed, so the store's account of what it was told stays complete.

## Retiring a tombstone: what causal stability needs, and what this mesh has

Two records here work by staying put. A retraction record carries the record ids it suppressed, and
a peer that re-delivers one of those ids gets refused. A compaction rollup does the same for the
sources it absorbed. That is what makes a delete survive a sync over a grow-only set, and it is why
both accumulate. `causal-stability.mjs` holds the rule for when one has done its job, and it
retires nothing today: the rest of this section is which half is built and which is missing.

The literature calls the rule **causal stability**. A record is safe to drop once every
replica that could still send a conflicting copy has it. Baquero, Almeida and Shoker's *Pure
Operation-Based Replicated Data Types* (CoRR arXiv:1710.04469, 2017) is the one to read first: its
PO-Log discards per-operation metadata exactly when a stability check over a per-replica vector says
the operation is known everywhere. The ancestor is Wuu and Bernstein, *Efficient solutions to the
replicated log and dictionary problems*, PODC 1984, whose two-dimensional time table answers the
same question for a log. Neither was re-checked against a primary source in this entry's
verification pass, so treat both as leads rather than as pinned citations.

Every version of the rule needs two inputs: who the replicas are, and what each of them has
received. This mesh has the first and none of the second.

### What the mesh knows about its own membership

Three separate notions, and only one is durable and replicated.

| notion | where it lives | durable | replicated | what it answers |
|---|---|---|---|---|
| the peer map | `peers` in `p2p-room.mjs`'s closure | no, per page session | no | who this node has a channel to right now |
| the node id | `node-id.json` beside the store (a handle field in memory, a `meta` row in SQLite) | yes | no, by design | what this store calls itself |
| the admission graph | `node:<joiner> mgx:invitedBy node:<inviter>` facts | yes | yes, like any fact | every node this world has ever admitted |

**The peer map is session state.** `myPeerId` is a UUID minted per page load. The map fills from
`hello`, and a closed channel is marked `connected: false` rather than deleted, so it survives a
disconnect inside one session. A reload starts it empty. Nothing writes it to the store.

**The admission graph is a real roster.** `recordInviteEdge` writes one edge per join, on the
joiner's own store, keyed on node ids rather than peer ids. It is an ordinary fact, so it merges by
union, and both sync filters carry it: chat's admits it through the `operator` kind on its `ace:p2p:`
tag, mud's through `P2P_PREDICATES`. Union the node terms at both ends of every edge and you get a
grow-only set of node ids that every peer holding the same facts computes identically.
`admittedNodes` in `causal-stability.mjs` is that fold. Grow-only is the right shape here. A roster
that could shrink would let a forgotten node's stale copy back in.

Four gaps in the roster, all worth knowing before a rule leans on it:

- A world nobody has joined yet has an empty roster. The first inviter appears only once somebody
  joins it.
- An invite blob from a build that predates the `node` field records no edge, so a node admitted
  that way is invisible to the fold.
- Nothing records a departure. There is no leave message and no eviction.
- `resolveStoreNodeId` keeps whatever id the store already holds, so a copied store puts two live
  claims on one roster entry.

**Acknowledgement does not exist yet.** No message carries an ack. `op` and `sync-response` are
fire-and-forget, `sync-request` carries no cursor, and there is no version vector anywhere.
`seenProvenanceById` and `seenRetractionValueById` are the local send-diff baseline. They record what
this node has broadcast, never what a peer received.

It cannot be inferred from today's traffic either, and the reason is narrow enough to fix. A peer
answering a sync request does re-emit every retraction it holds, which is real evidence that it holds
them. But no message identifies the sender's node. `hello` carries `peerId` and `displayName`. `op`
carries `from: <peerId>`, a per-session UUID. `sync-response` carries no sender at all. The
retraction's own provenance tags name its author, not whoever relayed it. So "node X holds tombstone
T" is not derivable from any byte currently on the wire.

That is the hinge. The roster half is built and replicating. The acknowledgement half needs one field
on the wire before any rule can fire.

### The options, and what each costs

| rule | what it needs | what it costs | verdict |
|---|---|---|---|
| drop a tombstone after a fixed age | a clock | breaks the pure-function-of-the-set invariant, and the offline peer defeats it | rejected |
| drop once every currently connected peer has it | the peer map | reads a closed tab as a departure | rejected |
| drop once every admitted node has it | the roster plus an acknowledgement | one wire field, one sidecar | the route |
| fold tombstones together rather than dropping them | nothing new | fewer records, all the same ids | not a retirement rule |

**The age rule is the tempting one, and it is the one to refuse.** It needs nothing built. It fails
twice. First, the answer would depend on when you ask and whose clock you ask on, so two peers
holding an identical fact set would fold it differently. `foldWorldState` already taught this repo
that lesson once. Second, a peer offline across the window is the exact case it gets wrong.
Everybody else forgets, the peer comes back with a copy that predates the retraction, and the fact
returns. That failure is silent, it arrives late, and it reads as the memory inventing something.

**The live-peer rule fails the same way in fewer steps.** A browser tab closes and the peer map marks
that peer away. Nothing tells it apart from a peer that left for good.

**Folding tombstones together is worth naming because it looks like retirement.** Several per-source
retraction records over one triple could merge into one. That shrinks the record count and keeps
every id, so it retires nothing. It also breaks the instant: enforcement compares each assertion's
own time against the retraction's, and one merged instant is a max, so the merged record would
suppress a later, deliberate re-assertion by a source that never retracted anything.

### The shape that fits this mesh

Split the two inputs by what each one is.

**The roster wants to be a fact.** It is monotone, it has to converge, and it is small. The admission
graph already is one.

**The high-water mark wants to be node-local state beside the store.** It is a max per observer, it
is nobody else's business, and writing it as facts would turn it into history. A fact store keeps
every value a mark ever took, so an ack channel built from facts grows faster than the tombstones it
retires. `node-id.json` is the precedent already in the tree: `loadNodeId` and `saveNodeId` carry
per-store state that never replicates, across all three backends.

The min over the roster is `stableRecordIds`, and it is already written. What that leaves to build,
in order:

1. The sender's node id on the wire, on `hello` or on each message.
2. A per-peer record of which tombstones that node has been seen to hold, in a sidecar beside the
   node id.

### What is written, and why it retires nothing

`causal-stability.mjs` holds the rule as a pure function of its inputs. `admittedNodes` folds the
roster off the admission graph. `stableRecordIds` answers which records every rostered peer is known
to hold. `core.mjs` exposes `retirableRetractions` as a report and `retireRetractions` as the sweep.

The gate is the missing input, and it is a defaulted parameter rather than a flag. `acknowledgedBy`
defaults to `null`, so `stableRecordIds` returns the empty set before it looks at anything else, and
nothing in the product supplies a function. `retireRetractions` takes ids rather than choosing them,
so a caller has to run the rule and hand over its answer. Nothing in `src/`, `bin/` or `scripts/`
calls either one; the tests are the only callers. Every safety default points the same way: an empty
roster retires nothing, a roster holding only this node retires nothing, and one member that has
acknowledged nothing blocks every record.

### Departure is the open sub-problem

Under this rule a node that joins once and never comes back holds every tombstone standing. That is
correct rather than convenient. The node really might return with a copy. It is also why the
literature pairs stability with a group membership service, so the group the min runs over can
change. The admission graph is half of that already, a social record of who let whom in. Its
counterpart is a departure edge written the same way, plus a rule for what the remaining members can
conclude about a node nobody has seen for a long time. Whoever picks this up should read the view
synchrony and group membership literature beside the CRDT papers; that is where the vocabulary
lives. Until such a rule is designed, the answer stays what it is now: retire nothing, keep the
tombstones.

### Rollups pose two questions, not one

The compaction summaries have the same gap, and they split.

A **chain rollup** (pool 2) carries no prior. It is bookkeeping: the ids it absorbed, so a
re-delivered leaf stays absorbed. The rule above transfers to it unchanged.

A **head rollup** (pool 1) carries the noisy-OR base over the sources it absorbed, so it is
bookkeeping and a live vote in the group fold at once. Dropping it changes the answer a reader gets,
not just what the store refuses on ingest. "Retire a head rollup" is therefore a different question
from "retire a tombstone", and it needs its own account before either rule reaches it.

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
| two peers retract together, both invite directions | same roster, same tombstone, nothing retirable on either |
| a rostered peer away since before the retraction | nothing retirable. Retire the tombstone anyway and its rejoin puts the fact back |

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
the operation that sits outside all of it, and what puts it back inside is the retraction record.
`removeFacts` really does drop the matched Fact individuals from the local store, so the storage
is not grow-only. What is grow-only is what replicates: the retraction record is an APPEND, it
merges by union like any other fact, and it is what stops a peer's next sync re-materialising the
assertion. Suppression happens at the read. Same trade as the placement fold, one level down.

## The verdict for tmct

**The G-Set is the right choice, and "state-based G-Set" is an incomplete description of what
ships.** What replicates is a grow-only set of `(triple, source)` records, each carrying a grow-only
set of provenance tags, with a per-source revision chain that demotes rather than deletes, plus two
replicated summaries that merge by union of the ids they carry: a compaction rollup and a
retraction record. Union at every level. No causal delivery required anywhere. Local storage is the
one place that shrinks — `removeFacts` and `retireRetractions` both delete rows — and the tombstone
is what keeps that shrinkage from undoing itself on the next sync.

**The conflict resolution is a read-time query, and it must stay a pure function of the set.** That
is the invariant to protect. `foldWorldState` broke it and was fixed outside itself, by
`p2p-room.mjs` sorting Fact individuals by content-addressed id after every merge. Any future
resolver has to be checked the same way: feed one peer's facts in two different orders and demand
the same answer. A resolver that reads a wall clock, a local counter, or array position without
that sort will look correct in a single-browser test and diverge on the mesh.

**Retraction over the mesh took the summary route, because an OR-Set tombstone would put holes in
the provenance record and that record is a product feature.** `removeFacts` leaves a record behind,
one per (triple, source), carrying the record ids it suppressed and the moment it did, so absorption
merges by union and stays a join. It keeps the tags of what it suppressed rather than hiding them.
Two enforcement points read it: the fold strips a record it covers, and `assertionGroupsFor` refuses
to re-materialise one on ingest. Both compare the assertion's own embedded instant against the
retraction's, so a source that says the thing again later still lands. The suppressed ids are
re-keyed through the provenance tag on the way out and on the way in, because the broadcast relabel
means two stores file one assertion under two Source keys.

Two open problems sit next to it. The causal-stability rule is written as a pure function, with the
roster half derived from the admission graph and the acknowledgement half named as the one thing
still missing; "Retiring a tombstone" above has the design and the reason nothing retires yet. And an
OR-Set proper, with causal delivery, is the route that would let a suppressed assertion be re-added
under its own identity rather than under a later instant.

## Deepen-next

- **RR-7687 §2 against the sync path.** The report's delivery preconditions are the checklist for
  the mesh. Walk Definitions 2.1–2.6 against `p2p-room.mjs` and record which assumptions the
  two-paste handshake actually supplies.
- **Delta-state CRDTs.** Paulo Sérgio Almeida, Ali Shoker and Carlos Baquero, *Delta state
  replicated data types*, Journal of Parallel and Distributed Computing 111, 2018, pp. 162–173,
  DOI `10.1016/j.jpdc.2017.08.003` (preprint arXiv:1603.01529). Verified via dblp 2026-08-02. This
  is the answer to "the joiner downloads a full copy". `PLAN_MUD_WEBRTC.md`'s sharded manifest
  scheme is a hand-rolled version of the same idea. Read this before building it.
- **Causal stability.** Carlos Baquero, Paulo Sérgio Almeida and Ali Shoker, *Pure Operation-Based
  Replicated Data Types*, CoRR arXiv:1710.04469, 2017 (dblp-verified 2026-08-02; a peer-reviewed
  venue for it was not checked). Read it against "Retiring a tombstone" above, which has the design
  this mesh can reach and the wire field it still needs. Wuu and Bernstein's PODC 1984 log paper is
  the ancestor and has not been checked here.
- **Group membership and view synchrony.** The stability rule's min runs over a group, so a group
  that only ever grows makes one departed node hold every tombstone standing. The admission graph is
  half a membership service already. Find the other half in this literature before designing a
  departure edge.
- **The Bloom/CALM lineage.** Alvaro, Conway, Hellerstein and Marczak, *Consistency analysis in
  Bloom: a CALM and collected approach*, CIDR 2011, is cited in RR-7506 §6.3 as related to and more
  restrictive than the monotonic-semilattice condition. Worth reading for how it classifies a
  program's non-monotone points, which is the same question `foldWorldState` poses here.
- **Verify the SSS 2011 chapter directly** if a published-venue citation ever has to carry weight.
  The page range and DOI here come from dblp and Springer's landing metadata, not from the chapter.
