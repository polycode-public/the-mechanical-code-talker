# CRDTs — what tmct replicates, and where the convergence actually comes from

**Consumer in repo:** `src/adapters/memory/core.mjs` (`appendFacts`, `readFactRows`, `removeFacts`),
`src/adapters/memory/rows.mjs` (`sortFactIndividualsById`),
`src/domain/memory/compaction.mjs`, `src/domain/memory/retraction.mjs`,
`src/domain/memory/causal-stability.mjs`, `src/domain/memory/fact-order.mjs`,
`src/domain/memory/provenance-time.mjs`, `src/services/adventure.mjs` (`foldWorldState`,
`rulingTestimonyClaim`), `src/services/adventure-editor.mjs` (`planWorldEditorSync`),
`src/services/mud-editor.mjs` (`planMudEditorSync`),
`src/services/mudiii-turn.mjs` and `src/services/predator-prey.mjs` (`foldTownSquareState`).
Those are the replication layer. The read layer is wider — `inspect.mjs`
(`/memory`), `news-feed.mjs`, `digest/select.mjs`, `completions/infer.mjs`,
`tools/memory-fallthrough.mjs` and `chat.mjs`'s premise readers each take the first or the strongest
of a group, so each would answer by row order if the fold did not sort before they see a row.
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

The fact store gets described as a state-based G-Set CRDT that merges by set union, with
`appendFacts` as that merge rule byte for byte. That is close enough to build from and imprecise
enough to mislead. The set's element is not a triple. The merge is not the only thing that has to
converge. And the part that decides what a reader actually sees is not a CRDT at all.

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

**tmct is state-based.** Its merge takes a batch of facts and joins them into the store. It never
requires that a writer's operations arrive in causal order, and it has no vector clock, no version
vector and no delivery precondition. Two batches that overlap take the same path as two that do
not, because merging is idempotent by id. That is the CvRDT bargain: pay in state size, buy freedom
from delivery order.

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
sources asserting the same triple hold two records that share a group. `readFactRows` folds the
group's live heads into one row.

Inside one record, the provenance tags themselves union
(`planFactAssertion`: `tags = [...new Set([...headTags, ...group.tags])]`). So the store is a G-Set
of records, and each record carries a G-Set of tags. Both levels merge by union.

`appendFacts` is the merge function, and the granularity is the part to get right. It unions the
incoming provenance tag onto whatever is already stored at that id, and that id is the triple plus
the source, not the triple alone. That difference is the whole reason two writers who independently
taught the same fact end up corroborating it rather than overwriting each other.

### Compaction replicates by union too

`compaction.mjs`'s rollup summary carries the ids it absorbed, and two summaries at one id merge by
union of those ids. Every other field on a summary (count, bounds, prior) is derived from that
union, so the whole record is a pure function of it. Its header states the reason plainly:
"deleting from a replicated grow-only set is not a G-Set operation — an uncoordinated delete comes
back on the next sync."

### There is a per-source revision chain, and it is still add-only

The same source asserting the same triple again with a **later embedded timestamp** does not union.
`supersedesPriorAssertion` fires, the old head moves to `<recordId>#v<n>` carrying the same bytes
plus a `supersededBy` link, and the new head takes the stable id. Nothing is deleted. `readFactRows`
skips demoted leaves, so the chain is history rather than belief.

This is the one place "byte for byte a G-Set" is loose. A pure G-Set has no head and no leaf.

## Where "latest wins" happens, and why it is not a CRDT primitive

Nothing in the replication layer resolves a conflict. Resolution is a **read**.

- `foldWorldState` (`adventure.mjs`) ranks placement, position, openness and mass rows by the
  `(epoch, turn)` pair read off the row's own subject. `snapshotSubject` writes `subject@turnN`
  while the world is on epoch 0 and `subject@epochE@turnN` after a recast; `parseSnapshotSubject`
  reads it back. `outranks` is `!prior || rowEpoch > prior.epoch || (rowEpoch === prior.epoch &&
  turn >= prior.turn)`. A base row with no stamp ranks as turn 0 of the current epoch, so a recast
  re-seeds a world that no pre-recast snapshot can outrank.
- `rulingTestimonyClaim` ranks the tags on one `knows-about` edge by epoch, then firsthand over
  hearsay, then turn, then a `:gone` suffix. `characterTestimonyTag` writes an `epoch<N>:turn<N>`
  segment once the world has been recast, `testimonyClaim` parses it, and `outranksClaim` puts
  epoch above every other field.
- `latestFact` (`domain/memory/provenance-time.mjs`) takes the newest tag timestamp across the rows
  for one subject and predicate. "Current value" is a read over the tags rather than a stored flag.

This is an application-level "latest wins" read rather than a new CRDT primitive. The distinction
earns its keep for three reasons.

**It keeps the merge total.** A CRDT LWW-Register drops the loser at merge time. Once dropped, it
is gone from every replica, and the drop depends on a clock two machines have to agree about. Under
a read-time rank, both rows are still in the store on every replica. A store that later learns the
clocks were skewed can be given a better ranking rule and re-derive a different answer from data it
never threw away.

**It keeps the provenance whole.** A merge-time LWW would have to discard the losing assertion.
That assertion is a citation. tmct's product promise is that an answer names who said it, so the
loser has to stay readable.

**It moves the correctness burden.** A read-time resolver is only safe if it is a pure function of
the replicated set. `foldWorldState` is not, on its own. `outranks` uses `turn >= prior.turn`, so at
equal `(epoch, turn)` the row appearing **later in the array** wins. Two replicas holding an
identical fact set fold it differently while their arrival orders differ. Sorting closes that, at
every layer where arrival order could leak through.
`src/adapters/memory/rows.mjs`'s `sortFactIndividualsById` sorts the stored Fact individuals by
content-addressed id after every merge, in codepoint order and never `localeCompare`. `appendFacts`
reaches it through `renormalizeAssembledPayload`. `readFactRows` then sorts the rows it folds out of
them by content: subject, predicate, object, provenance, the same codepoint rule. A reader
downstream of the fold gets content order whether or not the store has ever merged anything.
`fact-order.mjs`'s `factOrderKey` and `compareFactsByContent` hand that same key to every later rank
over fact rows, so a tie in bias, trust or relevance lands on content rather than on array index.
`rulingTestimonyClaim` needs no such help. Its comparator is a strict order over four fields, so its
fold is order-independent by construction.

**The writers keep off the tie.** The sort makes a tie land the same way everywhere; a writer that
never ties needs no sort at all. Every write to a fold-versioned family stamps its own
`(epoch, turn)` at one past the world's current turn count, so it outranks what it supersedes by
rank. A played turn always did this. The world editor now does too: `planWorldEditorSync` and its
burrow counterpart `planMudEditorSync` return their placement, openness and (for the burrow) mass
rows already stamped `subject@turnN`, where they used to hand back a bare triple. A bare triple
folds as turn 0 of the current epoch, which ties with the base row it was meant to replace and
beats it only by sitting later in the array — so an edit to a world nobody had played yet was
exactly that tie, and reversing the row order made the edit disappear. The
"other" family (types, exits, the container and puzzle facts) keeps its bare subject, because every
reader takes those raw and none of them ranks. `mgx:placed-by` is the same lesson in the town
square: `placeFood` writes the first placer bare when it mints an item, so `mudiii-turn.mjs` stamps
a taught placer rather than letting it tie at turn 0 and win by arriving second.

So the ranking is a last-writer-wins register whose "last" is `(epoch, turn)` and whose tiebreak is
content-address order. Arbitrary at ties, identical on every peer, and computed fresh from the set
every time.

## Why a G-Set is enough

Four properties of the store do the work.

1. **Assertion is the only primitive that replicates.** A move, a dig, a taught fact and a
   rename are all appends. `adventure-editor.mjs` states the discipline for its own family:
   editing a placement is "a plain new write superseding the old one, never a retraction".
2. **Every element is content-addressed.** Re-delivery of an identical fact resolves onto the same
   record, so a re-merged batch, a re-seed and an import that overlaps what the store already holds
   are all no-ops. That is the idempotence a G-Set needs, and tmct gets it from hashing rather than
   from per-add tags.
3. **Every element carries who and when.** The provenance tag already holds the node id and the
   instant. Read-time ranking has the data it needs without a second structure.
4. **Nothing is a "current value" in storage.** Current values are derived: `foldWorldState`,
   `rulingTestimonyClaim`, `latestFact`. There is no register to overwrite, so there is no
   register conflict to resolve at merge time.

## Why the removal tmct has took the summary shape, not the OR-Set one

Retraction ships. `retraction.mjs` writes one record per (triple, source) carrying the record ids it
suppressed, it replicates like any other fact, and two enforcement points read it. This section is
why that shape rather than an OR-Set, since the OR-Set is the obvious candidate.

An OR-Set solves one problem: a remove that is concurrent with an add of the same element, where
the add should win and a later re-add must survive. It does that by giving every add a unique tag
and having a remove carry the tags it observed.

**Almost nothing removes.** "Stopping being true" is expressed three ways, all of them appends: a
newer `@turnN` snapshot for world state, a fresh testimony tag with a `:gone` suffix for what a
character knows, and a newer tag for a name. The name is the clean case. Naming again re-asserts
the same content-addressed triple, `appendFacts` unions a fresh tag onto it, and `latestFact`
decides which tag is current. Nothing has to be removed, because "the current name" was never
stored. Retraction is the exception. What the summary shape costs is the re-add: today a suppressed
assertion comes back under a later instant rather than under its own identity.

**tmct already has the unique tag, and it is a product feature.** A provenance tag is
exactly the shape an OR-Set's add-tag takes: a source identity plus an instant, unique per add.
The difference is that an OR-Set's tag is opaque bookkeeping, invisible to the user, safe to
garbage-collect. tmct's is the citation the answer chip renders as "taught by X", and the input to
trust scoring. It is read, not just compared.

**Tombstones would damage that record.** An OR-Set remove keeps the removed tags. In tmct those
tags are the audit trail, which leaves two bad options: hide a tombstoned tag from the citation, so
the store's account of what it was told is now incomplete, or show it, in which case the removal
removed nothing a reader can see. A store whose central promise is grounded-or-refuse cannot have a
provenance record that quietly omits assertions it received.

**The delivery guarantee is not there.** OR-Set is specified op-based (RR-7506 Spec 15), and
Theorem 2.2 makes causal delivery a precondition. tmct's merge gives no such guarantee: batches
merge in whatever order they arrive, by design. OR-Set semantics would mean building causal
delivery first, and a stability rule for its tombstones after that.

**So both tombstones take the summary shape.** `assertionGroupsFor` filters out any source a pool-1
rollup has already absorbed, through `isAbsorbedSource`, whose header states the reason: "without
this the next sync resurrects everything compaction just folded away, which is the failure mode
that makes deleting from a replicated set hard in the first place". `retraction.mjs` does the same
job for a real change of belief: one record per (triple, source) carrying the record ids it
suppressed, merging by union of those ids and max of the instant it carries. Neither hides a tag.
The compaction summary keeps the sources it absorbed in the citation; the retraction record keeps
the tags of what it suppressed, so the store's account of what it was told stays complete.

## Retiring a tombstone: what causal stability needs, and what the store has

Two records here work by staying put. A retraction record carries the record ids it suppressed, and
a merge that re-delivers one of those ids gets refused. A compaction rollup does the same for the
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
received. The store has the first and none of the second.

### What the store knows about its own membership

Two separate notions, and only one is replicated.

| notion | where it lives | replicated | what it answers |
|---|---|---|---|
| the node id | `node-id.json` beside the store (a handle field in memory, a `meta` row in SQLite) | no, by design | what this store calls itself |
| the admission graph | `node:<joiner> mgx:invitedBy node:<inviter>` facts | yes, like any fact | every node this world has ever admitted |

**The admission graph is a real roster.** `invitedByFact` in `causal-stability.mjs` mints one edge
per admission, written by the joining store and keyed on node ids. It is an ordinary fact, so it
merges by union. Union the node terms at both ends of every edge and you get a grow-only set of
node ids that every replica holding the same facts computes identically. `admittedNodes` is that
fold. Grow-only is the right shape here. A roster that could shrink would let a forgotten node's
stale copy back in.

Three gaps in the roster, all worth knowing before a rule leans on it:

- A store with no admission edges has an empty roster. The first inviter appears only once
  somebody joins.
- Nothing records a departure.
- The node id sits beside the facts and never replicates, so a copied store puts two live claims on
  one roster entry.

**Acknowledgement does not exist yet.** Nothing records that a named node holds a named record.
`stableRecordIds` takes `acknowledgedBy` as an argument rather than inventing it, and answers
"nothing is stable" when it is absent. The facts cannot supply it either: a record's provenance tags
name its author, never whoever handed the record on, so "node X holds tombstone T" is not derivable
from the set itself.

That is the hinge. The roster half is built and replicating. The acknowledgement half needs a
source of evidence that a named node holds a named record before any rule can fire.

### The options, and what each costs

| rule | what it needs | what it costs | verdict |
|---|---|---|---|
| drop a tombstone after a fixed age | a clock | breaks the pure-function-of-the-set invariant, and the absent replica defeats it | rejected |
| drop once every admitted node has it | the roster plus an acknowledgement | an evidence channel, one sidecar | the route |
| fold tombstones together rather than dropping them | nothing new | fewer records, all the same ids | not a retirement rule |

**The age rule is the tempting one, and it is the one to refuse.** It needs nothing built. It fails
twice. First, the answer would depend on when you ask and whose clock you ask on, so two replicas
holding an identical fact set would fold it differently. `foldWorldState` already taught this repo
that lesson once. Second, a replica out of contact across the window is the exact case it gets
wrong. Everybody else forgets, it comes back with a copy that predates the retraction, and the fact
returns. That failure is silent, it arrives late, and it reads as the memory inventing something.

**Folding tombstones together is worth naming because it looks like retirement.** Several per-source
retraction records over one triple could merge into one. That shrinks the record count and keeps
every id, so it retires nothing. It also breaks the instant: enforcement compares each assertion's
own time against the retraction's, and one merged instant is a max, so the merged record would
suppress a later, deliberate re-assertion by a source that never retracted anything.

### The shape that fits this store

Split the two inputs by what each one is.

**The roster wants to be a fact.** It is monotone, it has to converge, and it is small. The admission
graph already is one.

**The high-water mark wants to be node-local state beside the store.** It is a max per observer, it
is nobody else's business, and writing it as facts would turn it into history. A fact store keeps
every value a mark ever took, so an ack channel built from facts grows faster than the tombstones it
retires. `node-id.json` is the precedent already in the tree: `loadNodeId` and `saveNodeId` carry
per-store state that never replicates, across every backend.

The min over the roster is `stableRecordIds`, and it is already written. What that leaves to build,
in order:

1. A merge that names the node its facts came from.
2. A per-node record of which tombstones that node has been seen to hold, in a sidecar beside the
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
| delete then a re-merge of the same facts, before the retraction record existed | the fact returns, same id, same tag |
| retract then a re-merge of the same facts | refused on ingest; the fact stays gone, in either arrival order |
| equal `(epoch, turn)`, array order flipped | fold answer flips; after the id sort, both orders agree |
| `epoch 2 turn 1` against `epoch 0 turn 9` | the later epoch wins in both array orders |
| two stores retract together, both admission-edge directions | same roster, same tombstone, nothing retirable on either |
| a rostered node that has acknowledged nothing | nothing retirable. Retire the tombstone anyway and that node's next merge puts the fact back |

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
no quorum, no lock, no consensus round. That is CALM's coordination-free case.

**Wrong about the read.** Ranking rows and taking the newest is a non-monotone operator. It means
"there is no later row", which is negation over the whole set, so its output is not monotone in the
input. Moving it to the read does not make it monotone. The placement really does change from
`burrow` to `meadow` when a later snapshot arrives.

What the move buys is **confluence**, not monotonicity: the view is a deterministic function of the
replicated set, so two replicas holding the same set compute the same view. Divergence becomes
temporary rather than permanent. That is SEC stated at the view rather than at the base relation,
and it holds only because `sortFactIndividualsById` and `readFactRows`' own content sort make the
fold a function of the set. Without those the view is neither monotone nor confluent, and the whole
argument fails.

So: monotone base, non-monotone but confluent view, coordination-free throughout. `removeFacts` is
the operation that sits outside all of it, and what puts it back inside is the retraction record.
`removeFacts` really does drop the matched Fact individuals from the local store, so the storage
is not grow-only. What is grow-only is what replicates: the retraction record is an APPEND, it
merges by union like any other fact, and it is what stops the next merge re-materialising the
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
is the invariant to protect. `foldWorldState` broke it and was fixed from three sides:
`rows.mjs`'s `sortFactIndividualsById` sorts Fact individuals by content-addressed id after every
merge, `readFactRows` sorts the rows it folds so a reader that never sees a merge still gets content
order, and every writer to a fold-versioned family stamps a turn that outranks what it supersedes
rather than counting on arriving after it. Any future resolver has to be checked the same way: feed
one store's facts in two different orders and demand the same answer. A resolver that reads a wall
clock, a local counter, or array position without that sort will look correct against one store's
own writes and diverge the moment two fact sets merge.

**Retraction took the summary route, because an OR-Set tombstone would put holes in the provenance
record and that record is a product feature.** `removeFacts` leaves a record behind, one per
(triple, source), carrying the record ids it suppressed and the moment it did, so absorption merges
by union and stays a join. It keeps the tags of what it suppressed rather than hiding them. Two
enforcement points read it: the fold strips a record it covers, and `assertionGroupsFor` refuses to
re-materialise one on ingest. Both compare the assertion's own embedded instant against the
retraction's, so a source that says the thing again later still lands. The suppressed ids are
re-keyed through the provenance tag on the way out and on the way in, because two stores can file
one assertion under different Source keys.

Two open problems sit next to it. The causal-stability rule is written as a pure function, with the
roster half derived from the admission graph and the acknowledgement half named as the one thing
still missing; "Retiring a tombstone" above has the design and the reason nothing retires yet. And an
OR-Set proper, with causal delivery, is the route that would let a suppressed assertion be re-added
under its own identity rather than under a later instant.

## Deepen-next

- **Delta-state CRDTs.** Paulo Sérgio Almeida, Ali Shoker and Carlos Baquero, *Delta state
  replicated data types*, Journal of Parallel and Distributed Computing 111, 2018, pp. 162–173,
  DOI `10.1016/j.jpdc.2017.08.003` (preprint arXiv:1603.01529). Verified via dblp 2026-08-02. This
  is the answer to "a store that wants another one's facts takes a full copy". Read it before
  designing anything that ships less than the whole set.
- **Causal stability.** Carlos Baquero, Paulo Sérgio Almeida and Ali Shoker, *Pure Operation-Based
  Replicated Data Types*, CoRR arXiv:1710.04469, 2017 (dblp-verified 2026-08-02; a peer-reviewed
  venue for it was not checked). Read it against "Retiring a tombstone" above, which has the design
  and the acknowledgement evidence it still needs. Wuu and Bernstein's PODC 1984 log paper is the
  ancestor and has not been checked here.
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
