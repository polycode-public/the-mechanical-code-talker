# Content addressing, temporal data, and the storage vocabulary

**Consumer in repo:** `src/domain/hash.mjs` (`factIdFor`, `fnv1a32`), `src/adapters/memory/core.mjs`,
`src/services/ledger-viz.mjs`, `ontology/tmct-core.ttl`, `PLAN_NORMATIVE.md` §9.
**Retrieval date:** 2026-07-17.
**Licence:** link + brief factual excerpt. Nothing is committed here.

## 1. Content addressing

**The term.** "Content-addressed storage" / "content-addressable storage" / "content addressing" are
all attested and used interchangeably. The definitional property is only that **the identifier is
derived from the content rather than the location**. No definition makes a cryptographic hash part
of the definition.

**But readers import one.** The two canonical examples both use cryptographic hashes:

- Git — *Pro Git*, 2nd ed., Chacon & Straub, Apress 2014, §10.2: "Git is a content-addressable
  filesystem." Git used SHA-1 and is migrating to SHA-256 (see the git-scm hash-function-transition
  document) precisely because SHA-1 broke.
- IPFS — "CIDs are based on the content's cryptographic hash". Multihash makes the algorithm
  upgradable by design.

**Naming trap:** "CAS" also means **compare-and-swap**. Spell out "content-addressed" near anything
concurrent.

**Recommended phrasing for tmct:** "content-derived identifiers (non-cryptographic 32-bit hash)"
rather than bare "content-addressed", which borrows Git and IPFS's implied collision resistance.
See §1.2 — that borrowed implication is not decoration, it hid a bug.

### 1.1 FNV-1a

Glenn Fowler, Landon Curt Noll, Kiem-Phong Vo. Originated in IEEE POSIX P1003.2 committee comments,
1991. Published as **RFC 9923, "The FNV Non-Cryptographic Hash Algorithm"** (Noll, Vo, Eastlake,
Hansen), Informational, Independent Submission stream, **February 2026**.
*The RFC's front page could not be rendered; the date comes from the RFC Editor and datatracker
listings — verify before printing it.*

RFC 9923, verbatim:

> "No assertion of suitability for cryptographic applications is made for the FNV hash algorithms"

and FNV is "NOT RECOMMENDED for any application that requires that it be computationally infeasible"
to find collisions or preimages.

32-bit parameters: offset basis `0x811c9dc5`, prime `0x01000193`. Known weaknesses: a sticky zero
state, and poor diffusion — "the least significant bit of a direct FNV hash is the XOR of the least
significant bits of every input byte".

### 1.2 The birthday bound, against tmct's own numbers

`src/domain/hash.mjs:139` — `factIdFor(s, p, o) = fact:${fnv1aHex(s\0p\0o)}`, and `fnv1aHex` is
**32-bit**, 8 hex characters. So N = 2³² and P(collision) ≈ 1 − e^(−k²/2N).

`HANDOVER.md` publishes the fact counts, measured on real hardware:

| init tier | facts | P(at least one collision) |
|---|--:|--:|
| `init` (default) | 664 | 0.0% |
| `init:large` | 37,797 | **15.3%** |
| `init:xl` | 72,075 | **45.4%** |
| `init:xxl` | 238,866 | **99.9%** |

This is not a theoretical bound. **A real collision was found by brute force at 26,034 triples** —
below `init:large`:

```
(thing23102, mgx:atLocation, value3156)  -> fact:495ee929
(thing26033, mgx:causes,     value6087)  -> fact:495ee929
```

And a collision is **silent data loss**, not an error. Written to a real store, two distinct facts
in, one fact out, no error raised:

```
facts written: 2
facts stored : 1
  fact:495ee929  ->  (thing26033, mgx:causes, value6087)
```

`hash.mjs:23`'s comment says "Same (s,p,o) → same id → upsert, never a dup". That direction holds.
The converse — different (s,p,o) → different id — is what fails, and the upsert path turns the
failure into a **merge** rather than a crash.

At 64 bits the same 100,000 facts give ≈ 2.7 × 10⁻¹⁰.

**A note on the word "collision-proof".** `hash.mjs:137` says the NUL delimiter is "collision-proof
unlike a space". That is true *of the delimiter* — NUL cannot occur in a normalised term, so
`a\0b` cannot alias `ab\0`. It sits two lines above a 32-bit hash that is emphatically not
collision-proof. The term is correct locally and misleading in place.

**When is a non-cryptographic hash acceptable for content addressing?** When both hold:

1. No attacker-controlled input, so second-preimage resistance is moot. Plausible for a local
   single-user store — but check the `web` and `extracted` source types, which ingest external text.
2. The width makes accidental collision negligible. **32 bits does not.**

## 2. Temporal data

**The glossary to cite** (a better primary source than any textbook): Jensen, Clifford, Elmasri,
Gadia, Hayes, Jajodia et al., **"A Consensus Glossary of Temporal Database Concepts"**, *SIGMOD
Record* 23(1), March 1994, pp. 52–64. Verbatim:

> **Valid time**: "The *valid time* of a fact is the time when the fact is true in the modeled
> reality… Valid times are usually supplied by the user."
>
> **Transaction time**: "The *transaction time* of a database fact is the time when the fact is
> current in the database and may be retrieved… as it is impossible to change the past,
> **transaction times cannot be changed**. Transaction times… are system-generated and -supplied."
>
> **Snapshot relation**: "Relations… incorporating neither valid-time nor transaction-time
> timestamps are *snapshot relations*."
>
> **Bitemporal relation**: "a relation with exactly one system supported valid time and exactly one
> system-supported transaction time."

**"Decision time" is not in the primary literature.** Both the 1992 and 1994 glossaries were read in
full; it does not appear. Do not cite it.

**Snodgrass**, *Developing Time-Oriented Database Applications in SQL*, Morgan Kaufmann, ISBN
1-55860-436-7. The copyright page says **© 2000**; many secondary sources say 1999. Free PDF from
the author at https://www2.cs.arizona.edu/~rts/tdbbook.pdf — hosted by Snodgrass himself, though the
copyright page carries an all-rights-reserved notice and no explicit licence grant.

**SQL:2011** — ISO/IEC 9075-2:2011 Part 2 (a standalone temporal part was cancelled in 2001).
Freely readable secondary reference: Kulkarni & Michels, "Temporal features in SQL:2011", *SIGMOD
Record* 41(3), Sept 2012, pp. 34–43. Periods are **closed-open `[start, end)`**. Application-time
period tables are valid time and user-maintained; system-versioned tables are transaction time,
`GENERATED ALWAYS`, and cannot be set by the user.

### 2.1 tmct is not bitemporal

| tmct term | correct classification |
|---|---|
| `mgx:createdAt` | transaction-time **start**, and only the start. Matches a `SYSTEM_TIME` row-start. There is no matching end, so it is not an interval. |
| `mgx:updatedAt` | **not transaction time.** Transaction time is defined as unchangeable; an update must preserve the prior version with its own closed `[start, end)`. A single mutable stamp does the opposite — each mutation destroys when the previous version stopped being current. This is an **audit / last-modified stamp on a snapshot relation**. |
| `mgx:utteranceTs` | **valid time**, as an instant — the glossary permits instants — but only while the modelled fact is the utterance-event itself ("the visitor said X at T"), which is what the ontology says it is. |

The concrete test tmct fails: the **transaction-timeslice query** — "what did we believe last
Tuesday". It can answer "when did the current belief become current" and nothing more.

Becoming bitemporal means replacing the mutable `updatedAt` with a closed-open system-time period
per version, where a mutation inserts a new version and closes the old one. The ontology already
frames this cost correctly on `mgx:updatedAt`.

## 3. Merkle trees — cite the thesis, not the CRYPTO paper

- **The origin of the hash tree:** Ralph C. Merkle, *Secrecy, Authentication, and Public Key
  Systems*, PhD thesis, Stanford University, **1979**. Full text at
  https://www.ralphmerkle.com/papers/Thesis1979.pdf. First peer-reviewed appearance: "Protocols for
  Public Key Cryptosystems", IEEE S&P 1980, pp. 122–134.
- The commonly-cited **"A Digital Signature Based on a Conventional Encryption Function"**, CRYPTO
  '87, LNCS 293, Springer, pp. 369–378, DOI 10.1007/3-540-48184-2_32, **builds a many-time signature
  using a hash tree and assumes the tree exists.** It is a downstream application, not the origin.

**tmct is correctly not a Merkle tree**, and should not claim to be. A Merkle tree has internal nodes
hashing their children, a root committing to the whole leaf set, and O(log n) inclusion proofs.
`factIdFor` hashes each fact independently: no parents, no root, nothing committing to the set.
"Merkle" or "tamper-evident" would be a factual misstatement.

## 4. "Ledger" is a metaphor. The term is "append-only log"

**"Ledger" is absent as a term of art from the entire systems lineage** — LSM-tree, log-structured
file systems, WAL/ARIES, Kafka. It appears in none of them.

The only standards-body definition is **ISO 22739, "Blockchain and distributed ledger technologies —
Vocabulary"** (ISO/TC 307; editions 2020 and 2024): a ledger is "an information store that keeps
records of transactions that are intended to be final, definitive and immutable", and a distributed
ledger adds "immutable, tamper-resistant, tamper-evident and append-only".
*The standard is paywalled; this wording was reconstructed from repeated verbatim snippets across
independent aggregators, not read from the primary PDF.*

What the literature actually says: **append-only log**, **commit log** (Kafka), **transaction log**,
**journal**, **event log**, **event store**.

- Jay Kreps, "The Log: What every software engineer should know about real-time data's unifying
  abstraction", LinkedIn Engineering, **December 2013**: "the simplest possible storage abstraction…
  an append-only, totally-ordered sequence of records ordered by time." *Exact day unconfirmed.*
- **LSM-tree**: O'Neil, Cheng, Gawlick, O'Neil, "The Log-Structured Merge-Tree (LSM-Tree)", *Acta
  Informatica* 33(4), 1996, pp. 351–385, DOI 10.1007/s002360050048. **A plain append-only file is not
  an LSM-tree** — that needs a memtable, sorted runs and compaction.
- **Log-structured file system**: Rosenblum & Ousterhout, *ACM TOCS* 10(1), Feb 1992, pp. 26–52,
  DOI 10.1145/146941.146943.
- **WAL / ARIES**: Mohan, Haderle, Lindsay, Pirahesh, Schwarz, *ACM TODS* 17(1), 1992, pp. 94–162,
  DOI 10.1145/128765.128770. **A WAL protects a separate mutable store and is truncated after
  checkpoint. It is not an append-only log that IS the system of record.**
- **Event sourcing**: Fowler, https://martinfowler.com/eaaDev/EventSourcing.html, **2005-12-12**.
  "Capture all changes to an application state as a sequence of events." **Not in *PoEAA* (2002)** —
  it is `eaaDev`-only, three years later. Do not cite it as being in the book.
- **CQRS**: Fowler, https://martinfowler.com/bliki/CQRS.html, **2011-07-14**. "It's a pattern that I
  first heard described by Greg Young."

**Terminology trap:** "persistent data structure" (Driscoll, Sarnak, Sleator, Tarjan, "Making Data
Structures Persistent", *JCSS* 38(1), 1989, pp. 86–124) means *preserves all past versions* — a
structural property, possibly RAM-only. That is orthogonal to "persistent" meaning *survives
restart*. Disambiguate on sight.

## 5. Inference strategy

**Russell & Norvig**, *Artificial Intelligence: A Modern Approach*, **4th ed., Pearson, 2020**. ISBN
978-0-13-461099-3 (US hardcover); Global Edition 978-1-292-40113-3. §7.5.4 forward and backward
chaining (propositional); §9.3 Forward Chaining, §9.4 Backward Chaining (first-order), Ch. 9
pp. 280–313. *Sections confirmed against the official TOC at aima.cs.berkeley.edu; verbatim
definitions not fetched (commercial book).*

**Materialisation vs query rewriting**, with W3C backing — **SPARQL 1.1 Entailment Regimes**, W3C
Recommendation, **2013-03-21**:

> "the entailment regimes do not prescribe any particular implementation technique. Thus, one can use
> materialization… Instead of materializing inferences, techniques based on query rewriting are
> equally possible to implement the regime."

**OWL 2 Profiles (Second Edition)**, W3C Recommendation, **2012-12-11**. Document order is
**EL = §2, QL = §3, RL = §4** — not alphabetical, which is a drift trap when citing section numbers.
RL is "a syntactic subset of OWL 2 which is amenable to implementation using rule-based
technologies", and §4.3 presents "a partial axiomatization of the OWL 2 RDF-Based Semantics… in the
form of first-order implications; this axiomatization is called the OWL 2 RL/RDF rules". QL is the
rewriting profile: "rewriting the query into an SQL query".

The tradeoff: materialisation buys cheap queries and pays on update, storage and especially
**deletion** — a retracted fact may support derived facts still re-derivable by other routes, so
naive cascade deletion is unsound. See Gupta, Mumick, Subrahmanian, "Maintaining Views
Incrementally", SIGMOD 1993, pp. 157–166, DOI 10.1145/170035.170066. *Cite the paper for the
technique; the "DRed" name could not be confirmed as originating there.*

**Query rewriting / DL-Lite**: Calvanese, De Giacomo, Lembo, Lenzerini, Rosati, "Tractable Reasoning
and Efficient Query Answering in Description Logics: The DL-Lite Family", *Journal of Automated
Reasoning* 39(3), 2007, pp. 385–429, DOI 10.1007/s10817-007-9078-x.

## 6. Provenance beyond PROV-O

**The whole PROV family shipped on 2013-04-30. Exactly four are Recommendations:**

| document | status |
|---|---|
| PROV-DM, PROV-CONSTRAINTS, PROV-N, **PROV-O** | **Recommendation** |
| **PROV-AQ** (Provenance Access and Query) | **Working Group Note** |
| PROV-PRIMER, PROV-XML, PROV-DICTIONARY, PROV-LINKS, PROV-SEM, PROV-OVERVIEW | Working Group Note |

**PROV-AQ is a Note, not a Recommendation** — it is the one most often mis-cited, because it sits
beside the Recs in the family diagram. The Provenance WG closed 2013-06-19; there is no successor.

**Database provenance** — a different literature that uses the same word:

- Green, Karvounarakis, Tannen, **"Provenance Semirings"**, PODS 2007, pp. 31–40,
  DOI 10.1145/1265530.1265535.
- Buneman, Khanna, Tan, **"Why and Where: A Characterization of Data Provenance"**, ICDT 2001,
  LNCS 1973, pp. 316–330, DOI 10.1007/3-540-44503-X_20.
- Cheney, Chiticariu, Tan, **"Provenance in Databases: Why, How, and Where"**, *Foundations and
  Trends in Databases* 1(4), pp. 379–474, DOI 10.1561/1900000006. *dblp and ACM say 2009; the
  author's own PDF masthead says 2007.*
- RDF-specific bridge: Zimmermann, Lopes, Polleres, Straccia, "A general framework for representing,
  reasoning and querying with annotated Semantic Web data", *Journal of Web Semantics* 11, 2012,
  pp. 72–95 — generalises RDFS entailment to be parametric in a semiring-like annotation domain.
  This is the closest thing to a blueprint for wiring semiring provenance into an entailment pass.

The three flavours, on one example — result `t` derivable as `r₁⋈s₁` and as `r₂⋈s₁`:

- **Why-provenance**: the witness sets, `{{r₁,s₁},{r₂,s₁}}`. Which source combinations suffice.
- **Where-provenance**: for a specific *value*, the source location it was copied from.
- **How-provenance**: the polynomial `r₁·s₁ + r₂·s₁ = (r₁+r₂)·s₁`. Keeps both derivations and how
  each combined. Strictly subsumes why.

**Does it apply to tmct?** Conditionally, and the condition is the interesting part.

Per-fact source tagging with no derivation is **source annotation**; every polynomial is a bare
indeterminate and the semiring framework is vacuous. That does not make it unprovenanced — PROV-DM's
"provenance" is a model for recording attribution as asserted metadata, and
`:fact prov:wasAttributedTo :src` is a complete PROV assertion needing no inference. **The two
literatures use "provenance" for different things.** Calling tmct's source tagging "provenance" in
the PROV-O sense is correct; calling it "how-provenance" would overclaim.

**But tmct materialises OWL 2 RL entailments, which is exactly Green et al. §5's setting** — a fixed
Datalog program over triples, so derived triples are recursive-query output. tmct already mints
`src:entailed:<rule>` and records `mgx:sourceRule`, so it records **which rule** derived a fact but
**not which antecedent facts** fed it. That gap is the whole distance to why-provenance. Carrying
antecedent fact ids through the fixed point that already runs would earn the term.

## Verified-source caveats

- RFC 9923's February 2026 date: from the RFC Editor and datatracker listings; front page not
  rendered.
- ISO 22739's "ledger" definition: paywalled, reconstructed from aggregator snippets.
- AIMA 4th ed.: sections from the official TOC; verbatim definitions not fetched.
- Snodgrass: © 2000 on the copyright page vs 1999 in secondary sources; no explicit licence grant
  found for the free PDF.
- LSM-tree, LFS, ARIES, PODS 2007 page numbers: publisher pages returned 403; cross-confirmed across
  dblp and ACM records.
- Pacioli 1494 (the ledger's accounting origin): secondary scholarship only; no period source read.
