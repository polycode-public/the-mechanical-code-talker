# PLAN_EXTRACTION_CONFIDENCE.md — extraction says how it read each sentence: named findings, never scores

Status: DESIGN. Nothing in this plan is built. It answers three recorded extraction defects and
one consumer ask with a single mechanism: the extractor records named, testable findings about
how a triple was read, and each consumer decides which findings it declines. The trigger is
`archive/PLAN_NEWSWORTHINESS.md`'s N4 marker: "back to the link" and "normalizefeeditems" headed
news cards because the NYT fixture's own test-scaffolding sentence is well-formed prose. The
companions are the `latency tmct:needs result` and `latency rdfs:subClassOf name` rows the
article extractor minted from one Simple English Wikipedia sentence, and bedrock-meter's
standing ask for a way to decline unsure rows without guessing which ones are good.

This plan is written to be built by Sonnet-tier implementers with no further design work, with
the `extract-facts.mjs` phase marked Opus (its blast radius is the whole unit tier — every
ingest caller stores what it mints). Every phase names its module paths, function signatures,
test files and acceptance commands.

The feature in one paragraph: `ingestText` gains a small set of structural detectors. A
candidate the detectors show was mis-read (a verb picked out of a relative clause, a
definitional frame read as classification, a clause fragment posing as a term) is declined,
and the decline reason is reported in the ingest result. A candidate that is kept but carries
a structural caveat (an identifier-shaped token, a clause-fallback read, a pronoun-carried
subject) is stored with the finding on its assertion record. The news gate stops such rows
heading cards. bedrock-meter reads the findings off `factsTouched` and applies its own policy.
Nothing anywhere is a number; a finding is a fact about the parse, checked by a test.

---

## 1. What ships today, and the three live failures traced

**The two extraction tiers.** `src/services/extract-facts.mjs`'s `ingestText` runs every
sentence through the strict recognizer (the chat teach lane, via `runTurn`), then optionally
through the optimistic tier (`optimisticTriples`): a copula frame yields an isa (Pass 1), the
relation verbs past its object continue the sentence (Pass 2a), and with no copula frame the
relation verbs stand alone (Pass 2b). Optimistic rows already store under their own low-trust
source kind (`optimisticExtract`, prior 0.35, `src/domain/memory/trust.mjs`).

**The structural gate that exists.** `readsAsEntityTerm` bounds a stored term at six words and
rejects a leading conjunction, auxiliary or preposition, lexically and by POS tag. The strict
tier retracts rows that fail it; the optimistic tier filters candidates through it. The news
gate duplicates its lexical half as `looksLikeEntityTerm` (`src/domain/news-feed.mjs`) and
takes the richer function by injection.

**Failure one — the scaffolding sentence.** "An item with no guid tag, so normalizeFeedItems
falls back to the link." splits on `, so ` (`CLAUSE_MARKER_RE`) and the fragment
"normalizeFeedItems falls back to the link" grounds. Two junk terms result:
`normalizefeeditems` (an identifier, lower-cased by `normFactTerm` so nothing downstream can
see the camelCase) and `back to the link` (a phrasal-verb remainder; "back" is an adverb, and
`readsAsEntityTerm` blocks neither the word nor the ADV tag). Both headed news cards.

**Failure two — the relative-clause verb.** "In engineering, latency is the name for the time
period that needs to be waited to see a result." Pass 1 reads `latency ⊑ name`. Pass 2a then
finds "needs", `inRelativeFrame` sees "that" to its left, and binds the verb to the copula
subject: `latency tmct:needs result`. The binding rule is right for "a volcano is a mountain
that has lava" (the relative pronoun directly follows the copula object, so the clause
restricts the class the subject was just given) and wrong here (the pronoun follows "time
period", a noun buried in the object's prepositional complement).

**Failure three — the definitional frame.** The same sentence's `latency ⊑ name` row: "X is
the name for Y" defines X, it does not classify X under the class "name". The copula object
scan has no reading for a definitional head, so it takes "name" as the class.

**The consumer ask.** bedrock-meter (inbox, 2026-08-10): "A confidence gate would help us more
than better rules: if a triple the reader is unsure of were marked, we could decline to read it
back rather than guess which ones are good." Their spec correction the same day confirms the
`tmct:needs` row is a genuine fact-class row no storage-level bookkeeping class can retire.

**Why this is not a trust change.** `SOURCE_PRIOR` scores who asserted, per source kind, and
is frozen. A finding says how one assertion's sentence was parsed. The two compose: an
optimistic row from a clean main clause and an optimistic row minted off an identifier differ
in findings, not in source prior. No prior moves in this plan.

---

## 2. The decisions

### 2.1 Findings, never scores

The marker is a closed vocabulary of named structural findings, each a mechanical property of
the parse with its own detector and its own tests. There is no numeric confidence anywhere.
tmct abstains because nothing matched, never because a score fell below a threshold, and a
made-up decimal would be exactly the guessing the constitution exists to prevent. A consumer
declines findings by name, so its policy is legible ("we decline identifier-token rows") and
testable on both sides of the seam.

A finding is used one of two ways, decided per detector in 2.3:

- **A decline reason.** The candidate is wrong, not merely weak: it is never stored, and the
  reason is reported in the ingest result (`declined`, below) and the CLI summary. The
  existing fragment retraction already works this way without the name.
- **An attached finding.** The candidate is plausible and kept, and the finding rides its
  assertion record so a consumer can decline it later. What is junk in one context (an
  identifier heading a news card) is a real fact in another (a code document teaching what
  `normalizeFeedItems` does), so the extractor keeps it and the consumer chooses.

### 2.2 The vocabulary

Decline reasons (candidate suppressed; nothing stored):

| finding | meaning |
| --- | --- |
| `definitional-frame` | the copula object is a definitional head ("the name/word/term for Y") — a definition, not a classification |
| `relative-clause-verb` | the relation verb sits in a relative clause that does not restrict the copula object just read |
| `fragment-term` | an endpoint fails `readsAsEntityTerm` (existing behaviour, now named, plus the 2.3 widening) |

Attached findings (candidate stored; finding on the assertion):

| finding | meaning |
| --- | --- |
| `identifier-token` | an endpoint's raw surface is an identifier (camelCase, snake_case, dotted, or path-like) |
| `clause-fallback` | the row grounded from a clause fragment after the whole sentence declined |
| `pronoun-carry` | the subject was substituted from the paragraph's pronoun carry, not stated in the sentence |

The optimistic tier itself carries no finding: its provenance kind already says the tier, and
repeating it would make one fact claim the same caveat twice.

### 2.3 The detectors, case by case

**`identifier-token`** — detected at ingest time on the sentence's raw token, before
`normFactTerm` lower-cases it away: `splitIdentifierWords(raw)` (`src/domain/prose.mjs`)
yielding more than one word from a single token, or a token containing `_`, `.` between
letters, or a path separator, marks the endpoint. "normalizeFeedItems" splits to
normalize/feed/items and is marked; "guitar" is not. The detector runs in both tiers; the row
is kept with the finding attached. This is a keep, not a decline, because identifier facts are
legitimate in code-document ingestion, which is a first-class use of `tmct extract`.

**`relative-clause-verb`** — the binding rule in Pass 2a tightens to adjacency: a relation
verb in a relative frame binds to the copula subject only when the relative pronoun's
preceding token is the copula object run's own end (`copulaObjHi`). "a mountain that has
lava" binds ("that" follows "mountain"); "the name for the time period that needs …" declines
("that" follows "period", not "name"). In Pass 2b (no copula frame), a relation verb in any
relative frame declines: with no main predication resolved, a subordinate clause's verb is
below the tier's certainty bar. The volcano mint is pinned as a regression in both shapes.

**`definitional-frame`** — in `copulaObjectAt`, an object head in the closed set
`DEFINITIONAL_HEADS = {name, word, term, label, title}` whose next token is "for" or "of"
declines the isa. Nothing is minted in its place: `mgx:denotes` exists but its declared
semantics are a provider's glossary edge (`src/domain/ask-vocab.mjs`), and minting it from
optimistic prose would launder a guess into a provider-tier shape. The sentence's other
content is still read — with the copula frame declined, Pass 2b runs, where the
relative-clause rule above declines "needs" as well. The latency sentence therefore mints
nothing, and the ingest result says why, twice, by name.

**`fragment-term` widening** — `readsAsEntityTerm` additionally rejects a multi-word term
whose leading token tags ADV (`FRAGMENT_LEAD_TAGS` gains ADV for the multi-word case only) or
whose leading word is in the closed particle set `{back, up, down, out, off, away, along,
around}`. "back to the link" fails both ways; a one-word term stays exempt exactly as today.
The lexical mirror in `news-feed.mjs` (`looksLikeEntityTerm`) gains the particle set, not the
tag rule, preserving the domain layer's no-wink posture.

### 2.4 Where findings live

- **On the assertion record.** `appendFact`/`appendFacts` (`src/adapters/memory/core.mjs`)
  accept an optional `extraction` array of finding names, stored as a new per-assertion
  property `mgx:extractionFinding` beside `observedAt` — per assertion, not per fact, so a
  later clean re-assertion of the same triple carries no inherited caveat. The SHACL shapes
  (`ontology/memory-shapes.ttl`) and `ontology/tmct-core.ttl` gain the property; the SHACL
  gate throws on unknown properties today, so this lands before any writer uses it.
- **On read-back rows.** `readFactRows` rows expose each assertion's findings and a row-level
  union (`row.extraction`), the same union convention provenance already uses.
- **On `factsTouched`.** The row shape gains `extraction` additively, absent when empty. The
  shape is a stable consumer contract; additive is the only change allowed.
- **Through the wire row.** `PLAN_MEMORY_BACKEND.md`'s row backend serializes whole records,
  so findings ride `json` with no schema change there.

### 2.5 How consumers decline

- **The news gate.** `newsworthyHubs`' tests E and A reject a row whose `extraction` union is
  non-empty from heading a card or anchoring novelty; `splitCardRows` may still show it as
  background. One rule, all findings: extraction uncertainty is never card-heading evidence.
  The gate already takes `readsAsEntityTerm` by injection, and findings arrive as row data,
  so the domain layer needs no new import.
- **bedrock-meter.** Reads `extraction` off `factsTouched` and declines by name. Their demo
  guard (re-asking on a throwaway memory) can retire for marked rows.
- **tmct's own read-back.** Unchanged. A stored fact stays answerable; `/memory` and the
  narration may name findings, but no chat lane starts declining stored facts in this plan.

### 2.6 Compatibility

Every row stored before this plan has no findings. Absent means no findings were recorded,
never that the row was checked and found clean — consumers must not treat absence as a
guarantee, and the contract doc says so. The distinction is honest and cheap: rows written by
builds that detect findings either carry them or genuinely triggered none.

---

## 3. Borderline cases, decided now

| case | outcome |
| --- | --- |
| "normalizeFeedItems falls back to the link." (news fixture) | subject marked `identifier-token`, object declined `fragment-term` — no stored fact survives with a card-headable term; the fixture keeps its guid-fallback duty untouched |
| the same sentence in a code document fed to `tmct extract` | stored, marked `identifier-token`; a code-graph consumer accepts the finding and keeps the fact |
| "latency is the name for the time period that needs …" | nothing stored; declines `definitional-frame` and `relative-clause-verb`, both named in the result |
| "a volcano is a mountain that has lava" | both facts mint exactly as today; pinned as the adjacency regression |
| "A cell is a unit, and it divides." pronoun retry | stored, marked `pronoun-carry` |
| fluent meta-commentary with clean structure ("The parser stores the feed.") | extracts today, extracts after this plan — no structural tell exists; recorded as the residual in section 7 |

---

## 4. Phases

### E0 — the detectors and declines (`extract-facts.mjs`) (Opus)

**Owns** `src/services/extract-facts.mjs`, `test/adapters/extract-facts-from-text.test.mjs`
(extend), a new `test/adapters/extract-facts-findings.test.mjs`. Deliver: the three decline
detectors (2.3), the `fragment-term` widening, the ingest result gaining
`declined: [{ sentence, finding, candidate }]`, and the CLI summary naming decline counts by
finding. The identifier-token detector lands here too but only computes; attachment waits for
E1's storage field (E0 stores nothing new). Unit tests: the latency sentence end to end (zero
rows, two named declines), the volcano regression both shapes, "back to the link" declined,
identifier detection on camelCase/snake/dotted/path tokens, one-word exemption intact.

Blast radius: this file's changes reach every ingest caller — run the full unit tier
(`test/adapters`, `test/domain`, `test/services`, `test/corpus`) before the commit, plus
`npm run test:fast`. Acceptance: those runs green; `node --test test/adapters/extract-facts-findings.test.mjs`.

### E1 — findings on the assertion record (Opus)

**Owns** `src/adapters/memory/core.mjs` (`appendFact`/`appendFacts` optional `extraction`,
row exposure and union), `ontology/memory-shapes.ttl`, `ontology/tmct-core.ttl`,
`src/domain/memory/touched-facts.mjs` if the shape needs it, `test/adapters/memory-extraction-findings.test.mjs`
(new). `ingestText` attaches `identifier-token`, `clause-fallback`, `pronoun-carry` at its two
`appendFact` call sites. Tests: SHACL accepts the property, per-assertion scoping (clean
re-assert carries nothing), row union, `factsTouched` additive field, absent-on-old-rows.

Serialization note: `core.mjs` is also `PLAN_MEMORY_BACKEND.md`'s M1/M3 file. Whichever plan
builds second rebases on the other's landed `core.mjs`; the additive field itself is
projection-safe (the wire row serializes whole records).

Acceptance: the new test file, `test/estate/*.test.mjs` (the ontology changed), `npm run test:fast`.

### E2 — the news gate declines findings (Sonnet, after E1)

**Owns** `src/domain/news-feed.mjs` (tests E/A read `row.extraction`; `looksLikeEntityTerm`
particle widening), `test/domain/news-feed.test.mjs`, `test/services/news-service.test.mjs`,
`test-e2e/pages-news-feed.test.mjs`. Re-measure the fixtures the N4 marker measured and
record the numbers in this section's build marker. Acceptance target: `nyt-world.rss.xml`
yields exactly its three genuine hubs (`ceasefire terms`, `officials`, `talks`) and zero
scaffolding hubs; the other fixtures unchanged.

### E3 — docs and the consumer note (Haiku, after E2)

**Owns** `docs/adapter-contract.md` (the findings vocabulary and the absence rule beside the
`factsTouched` contract), `README.md` only if it documents `factsTouched` fields, and an
append-only note to `~/.claude/inboxes/bedrock-meter.md`: the vocabulary, the decline-by-name
pattern, per-assertion scoping, absence semantics, and that the latency row is now never
minted at all. Docs gate: `npm run check:links`, estate tier, `test:fast`.

---

## 5. Concurrency

| phase | files | tier | after |
| --- | --- | --- | --- |
| E0 detectors | extract-facts.mjs | Opus | — |
| E1 assertion field | core.mjs, ontology, touched-facts | Opus | E0 |
| E2 gate consumption | news-feed.mjs + news tests | Sonnet | E1 |
| E3 docs + handoff | adapter-contract.md, inbox | Haiku | E2 |

E0→E1 serialize (E1 attaches what E0 computes). `core.mjs` serializes against
`PLAN_MEMORY_BACKEND.md`'s M1/M3 as noted in E1. The full suite runs at the coordinator's
push moments; each phase's acceptance list is its blast radius, except E0's, which is the
whole unit tier by declared necessity.

## 6. Acceptance

1. Replaying the NYT fixture through the news pipeline yields three hubs and no term from the
   scaffolding sentence, with the fixture file byte-identical.
2. The latency sentence stores nothing under either tier; the ingest result names
   `definitional-frame` and `relative-clause-verb` declines.
3. The volcano sentence stores both its facts, unchanged.
4. A code-document ingest keeps identifier facts, marked; `factsTouched` shows the finding.
5. Every pre-existing corpus row, pin and fixture measurement not named above is unchanged.

## 7. Sharp edges and the horizon

- **Fluent meta-commentary has no structural tell.** "The parser stores the feed." parses as
  a clean main clause over ordinary nouns. No detector in this plan catches it, and forcing
  one would guess. It stays extractable, and the gate's other tests still bound what it can
  head. Distinguishing report from commentary at that fluency is the same open problem the
  archived plan already names, with NER, wikification and first-story detection as the
  candidate literatures.
- **Detection needs the raw sentence.** `identifier-token` reads the surface before folding;
  a consumer handing pre-folded terms straight to `appendFact` gets no findings, which the
  absence rule (2.6) covers.
- **The adjacency rule is one token deep.** An appositive or a parenthetical between the
  copula object and its restrictive relative ("a mountain, famously, that has lava") declines
  a bindable verb. That is the safe side of the bar: a lost true mint, never a false one.
- **E0's blast radius is real.** The last change to this file's guards re-pointed corpus
  rows and e2e pins across four suites. Budget the phase accordingly.
