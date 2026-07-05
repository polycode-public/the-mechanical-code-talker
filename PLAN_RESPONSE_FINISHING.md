# PLAN_RESPONSE_FINISHING.md — Phase 7: the grammar pass over a segmented answer

> **STATUS: shipped (Phase 7).** Answers segment into typed spans (prose vs protected
> entity/path/number/code/provenance/receipt); a data-driven grammar-rule pass runs on prose
> spans only, under a protected-span invariance guard. The a/an article fix is active; broader
> voice/agreement rules are implemented-but-parked.

A Phase-7 execution plan (operator, decisions settled 2026-07-05). Phase 7 is FULLY DECIDED in
ROADMAP.md; this doc elaborates HOW the finishing layer is built, not WHETHER — it reopens no
decision. The governing principle: **fact invariance BY CONSTRUCTION**. Finishing operates over a
SEGMENTED answer, never a raw string, so a grammar rule *cannot* touch an entity, a path, a number,
a receipt or a provenance tag — those are byte-copied through, and only prose is ever transformed.
"Finish over a segmented answer, not a string" (operator-agreed).

## Context — what an answer is today

Every chat turn ends in `runTurn` (src/chat.mjs) as `{ answer, logLines, record, focus, via }` — a
FLAT string plus a `via` provenance band (`composed | template | count | command | conversational |
assert | recall | fact | corpus`). Two production paths build that string:

- **Templated** surfaces (W1) render through `corpus/templates.mjs render(id, slots)`: a template
  string with `{slot}` holes filled from grounded data only. The renderer already KNOWS the seam —
  `slotsOf()` enumerates the holes; literal text between holes is fixed wording, slot fills are the
  grounded facts. This surface is segmentation-ready almost for free.
- **Composed** surfaces (the ask engine, src/ask.mjs `renderCore`/`renderComposite`) assemble prose
  around graph labels, paths, counts, traversal receipts (`(traversal: calls edges where object =
  fnAlpha)`), repair receipts (`read as "which modules import a.mjs"`) and licence/provenance tails
  (`(source: …)`, `ConceptNet, CC-BY-SA`). These are hand-built strings with no structure today.

The whole thing is pinned by BYTE-EXACT assertions — test/showcase.test.mjs matches literal strings
(`app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs`, `3 classes.`, the receipt phrasings). Those
assertions are the contract finishing must honour: neutral behaviour is byte-stable.

## Why finish at all, and why over segments

tmct GENERATES defective English of its own — "a artifact" in the assert echo, a singular verb
against a plural slot, an uncapitalised opener. Fixing those IMPROVES accuracy: they are our own
manufacturing defects, not the user's facts. That is exactly why the grammar pass survives the
tone-of-voice cut (below) — a correction is a fix, not a flourish. But an unstructured
search-and-replace over a whole answer string is how you turn `app/lib/a.mjs` into `app/lib/an.mjs`.
Segmentation makes that class of error UNREPRESENTABLE: the rule engine is only ever handed prose
spans; protected spans are not in its input at all.

## The segmentation IR (lever 1 — the foundation)

An answer becomes a list of typed spans BEFORE it becomes text. The shape, carried alongside the
flat string (never replacing it):

```
segments: [ { type, text }, … ]      type ∈ prose | entity | path | number | code | provenance | receipt
```

Invariant law: `flatten(segments) === answer`, byte for byte, where `flatten` is a pure
`segments.map(s => s.text).join("")`. Protected = every type except `prose`. Finishing maps only
prose spans through the rule engine, re-flattens, and that is the finished answer. If no rule fires,
the output is byte-identical to today (the showcase stays green untouched).

- **Templated path — segments nearly free.** Add `renderSegments(id, slots, templates)` beside
  `render()` in corpus/templates.mjs: split the template on `SLOT_RE`, literal chunks become `prose`
  spans, each slot fill becomes a PROTECTED span typed from the slot (a `{subject}`/`{object}`/
  `{location}`/`{commit}` fill is `entity` or `path`; `{count}`/`{when}` is `number`; `{provenance}`
  is `provenance`). `render()` becomes `flatten(renderSegments(...))` so its existing byte output is
  provably unchanged.
- **Composed path — a conservative masker, adopted progressively.** `maskSegments(answer, ctx)`
  walks the flat string and marks PROTECTED anything matching: a known graph label (resolved against
  the loaded graph's individuals at answer time), a path token (contains `/` or a `.mjs`-style
  extension), a bare number, a parenthesized receipt tail (`(traversal: …)`, `(read as "…")`), or a
  provenance/licence tag (`source: …`, `ConceptNet, CC-BY-SA`). Everything else is prose. The masker
  is CONSERVATIVE by policy: when unsure, protect. Ask renders adopt it one render site at a time; an
  un-adopted site simply presents its whole answer as a single prose span, and the invariance checker
  still guards it.
- **Where it lives.** Finishing is the LAST transform in the turn: producers (`runAsk`, `plainTurn`,
  `conversationalTurn`, `runCommand`) optionally attach `segments`; a `finish(result, ctx)` step in
  `runTurn` — applied at the `withLast` seam so every dispatched turn passes through it — flattens,
  grammar-corrects the prose spans, re-flattens, and rewrites `result.answer` (and thus `logLines`).
  A producer that attaches no segments is masked there instead. `via` is unchanged by finishing.
- Phase 5's dual banding (see **PLAN_FORMULAIC_COMPETENCE.md**) reads the SAME spans: the
  protected/prose split is exactly the surface it scores, so the IR is shared infrastructure, built
  once here.

## The grammar pass (lever 2)

A DATA-DRIVEN rule table in TOML (the item-7 `[[…]]` formats already used for lever config), applied
to prose spans only. The starter rule set, each landing as an individually bench-measured lever:

1. **Article selection** — `a`/`an` by the following word's phonetics. The live defect: the assert
   echo says "every module is *a artifact*" → "an artifact". A genuine fix.
2. **Subject–verb agreement** — verb number against slot plurality (a one-element vs many-element
   `{objects}` fill drives is/are, was/were). The IR carries the plurality on the protected span, so
   the rule reads structure, never guesses from surface.
3. **Sentence capitalisation** — capitalise the first alphabetic of a prose-initial span.
4. **List punctuation** — Oxford/`and` joins in composed lists (bounded to prose connectives, never
   the entity spans they join).
5. **Terminal punctuation** — exactly one sentence-final stop.

Each rule carries APPLICABILITY CONDITIONS in its TOML row (register, span type context, position),
which is where the grammar-PREFERENCE half of the dropped tone idea survives — as conditions on
corrective rules, not as a substitution engine. A rule's NEUTRAL behaviour is byte-stable; the only
byte changes it may introduce are GENUINE fixes. Where a fix changes a byte-exact showcase/test
assertion, that assertion is updated IN THE SAME cycle, with the before/after diff quoted verbatim
in the tuning-cycle write-up (SKILL_TUNING_CYCLE.md) — a fix is never smuggled past a green test.

## Tone-of-voice: DROPPED (record the decision)

Per-voice synonym/phrase substitution over prose is NOT built. Rationale, recorded: once everything
technically significant is protected — entities, paths, numbers, code, receipts, provenance — the
substitutable surface is mostly connectives: high accuracy risk, thin reward. "Keen on the trickery
to make a helpful product, but not at the cost of accuracy." Parked in Phase LATER; revisit only if a
provably-safe subset emerges (connective-only profiles, or whole per-voice template alternatives —
never substitutions). Do NOT design tone machinery in this phase. The grammar-preference concept
survives INSIDE the rule table's applicability conditions, and nowhere else.

## The memory decision (settled): canonise + link, never replace

Finishing must not corrupt the honest record. So memory stores BOTH:

- **As-spoken** turns remain the honest record. Today `recordSessionMemory` (src/sessions.mjs) already
  writes each turn as larger prose `Utterance` individuals (visitor + tmct, recovered from the
  transcript), and `fold.mjs` cleans surviving Q/A into prose blocks (memory/blocks.mjs). That path is
  UNCHANGED — raw prose is preserved verbatim.
- **Canonical** forms are DERIVED and LINKED, never overwritten. A canonicalised `Fact` (memory/
  core.mjs's reified `rdf:Statement`) points back to the prose it came from via a new edge
  `mgx:canonicalisedFrom` (Fact → source `Utterance`/block id), added to `MEMORY_VOCABULARY`
  alongside the existing `mgx:factProvenance`. Recall and folding READ canonical; provenance walks the
  edge back to the as-spoken source. This is the SAME shape tier-4 acquisition and the ConceptNet
  slice already use — raw text preserved, canonical derived + linked — so the predicate is
  general, not finishing-specific. This touches sessions.mjs/fold.mjs; coordinate with the
  answer-capture invariants (STRATEGY_ADVISOR.log T1a): the `ts`-keyed transcript recovery and the
  writeLog → upsertGraph ordering are load-bearing and must not regress silently.

## Verification

- **Invariance checker** (unit): for every finished turn, assert the PROTECTED-span multiset is
  identical pre- and post-finishing — the machine proof that no fact moved. Runs over the showcase
  corpus and every golden.
- **Per-rule golden files**: each rule ships a golden of inputs → finished outputs, so a rule's exact
  effect is frozen and reviewable.
- **Bench measurement per rule**: each rule is a lever on the graded bench (PLAN_FORMULAIC_COMPETENCE
  measures the banding); a rule that doesn't move the mean, or that reddens the showcase, doesn't land.
- **The byte-exact base** (test/showcase.test.mjs) is the backstop: neutral finishing keeps it green;
  a genuine fix updates it with the diff quoted.

## Sequencing

1. **IR first** — pure structure, ZERO behaviour change. `renderSegments` + `flatten` + `maskSegments`
   + the invariance checker, with `finish` a no-op flatten. Showcase must stay byte-green.
2. **Grammar rules, one per tuning cycle** — article selection first (it fixes a real observed defect),
   then agreement, capitalisation, list, terminal. Each its own bench-measured lever + golden.
3. **Memory canonise + link** — add `mgx:canonicalisedFrom`, derive canonical Facts linked to their
   as-spoken blocks; coordinate with the T1a answer-capture invariants before touching sessions/fold.

## First steps

1. Add `renderSegments()` + exported `flatten()` to corpus/templates.mjs; prove `render()` byte-output
   is unchanged (`flatten(renderSegments(...)) === render(...)` over the whole responses.jsonl).
2. Write `maskSegments(answer, { graph })` + the invariance checker; wire a no-op `finish()` at the
   `withLast` seam in runTurn; land the whole thing with the showcase byte-green (structure only).
3. Author the rule-table TOML schema + the article-selection rule; land it as one tuning cycle,
   quoting the "a artifact" → "an artifact" fix diff.
4. Add `mgx:canonicalisedFrom` to MEMORY_VOCABULARY and the canonical-Fact link in the fold path.


**Timestamping (trust prerequisite).** Every created individual gains `mgx:createdAt` on
write — Facts lack one today (only Utterances carry `ts`). It is provenance in its own right:
the recency input to trust scoring and the novelty signal Phase 8's deduction pass needs.
Backfill in `appendFact`/block writes; deterministic-id upsert keeps the FIRST createdAt
(when a fact was first learned), never overwriting it on re-assert.

## Open questions (genuinely open)

- **Masker term source**: does the composed-path protected-term list derive from the loaded GRAPH at
  answer time (precise, but couples finishing to a live graph) or from the LEXICON (cheaper, graph-
  independent, but staler)? Leaning graph-at-answer-time for entity/path spans, lexicon as fallback.
- **Sidecar serialization**: how do segments persist into the structured sidecar record without
  bloating it? Options: don't persist (re-derive on fold from the transcript + graph), or persist a
  COMPACT span index (offsets + types, not repeated text). Re-derivation keeps the sidecar lean and
  respects the T1a invariant that the transcript is the sole answer-text artifact — preferred unless
  re-derivation proves lossy.
- **Rule ordering / idempotence**: confirm the starter rules commute (or fix an order) so `finish` is
  idempotent — `finish(finish(x)) === finish(x)` — a checkable property worth a test.
