# PLAN_CONVERSATION.md — findings that graduated out of the fast loop's safe-fix scope

> **STATUS: Finding 1 is research/design notes, nothing implemented; Finding 2 is RESOLVED (commit
> 85d46f0)** — see its own section below for what shipped. Not a build plan with a staged
> implementation — this doc exists to hold findings precisely enough that a future session can
> pick them up, the same role `PLAN_SYLLOGIST.md` plays for reasoning-engine research pulled
> out of `PLAN_INFERENCE_TESTING.md`. Nothing here is scheduled, staffed, or blocking anything else.

## Why this doc exists

`SKILL_AGENT_FAST_LOOP.md`'s own operating principle, the operator's own framing: *"the fast loop
should be exploring within edges to catch the traps human visitors are likely to fall in, then
benchmarking is the way we explore the limit of a wider capability and decide where to push."* The
fast loop is for small, local routing/recognition gaps — fix it, verify it, ship it, in one round. It
is explicitly NOT for broader mechanism redesigns: forcing one of those through the loop's
low-attention, many-independent-rounds model is exactly how a bad fix compounds silently.

Rounds 2, 3, 5, and 6 of the loop's first run (2026-07-11, alongside a concurrent benchmark batch)
each investigated a real dead-end, and each correctly declined to patch it once the investigation
reached a genuine architectural question rather than a small safe fix. This doc is where those two
findings live now — traced precisely against the real code below (round 2's own report described its
finding by the wrong mechanism; corrected here), not just transcribed from the rounds' own prose.

---

## Finding 1 — an unknown "every X is Y" always mints Y as a class, never a property, because the mint fallback has no POS check

**Round 2's own framing was imprecise** — it named a "teach-routing race" between
`BARE_DECLARATIVE_RE` and `TEACH_PROPERTY_RE` in `src/chat.mjs`. That's not quite where the decision
actually happens. Traced against the real code:

1. `src/grammar/ace.mjs`'s `parseEvery` (line 260) already does the right thing when it can: for a
   single-word complement it tries `lookupAdjective(lexicon, rest[0])` FIRST (line 272-273) and only
   falls through to resolving the complement as a noun/class if that lookup misses. So "every cache
   is bespoke" works correctly today IF `"bespoke"` is a lexicon-declared adjective.
2. The bug is what happens when the complement is NOT a declared adjective at all — e.g. "every
   Record is persisted", where "persisted" is in neither the noun nor the adjective lexicon.
   `parseEvery` can't resolve it as a class term either (no matching noun), so `parseAce` returns a
   miss (residue), and `assertTurn` (`chat.mjs:7245`) returns `null` — falling through to the outer
   `teachLane` cascade.
3. That cascade tries, in order: `unknownSubjectFallback` → **`unknownObjectFallback`**
   (`chat.mjs:1959`) → `unknownAdjectiveFallback` (`chat.mjs:2036`) → `TEACH_PROPERTY_RE`
   (`chat.mjs:1660`, wrapped-only). `unknownObjectFallback` mints the object as a NEW CLASS
   (`rdfs:subClassOf`) whenever: the sentence carries a genuine "every/each/all" quantifier, the
   subject is grounded, and the object is NOT already a grounded term — with **no check at all for
   whether the object reads more like an adjective than a noun**. "Every Record is persisted"
   satisfies all three conditions, so it mints `persisted` as a class and stores `Record ⊑
   persisted`, before `unknownAdjectiveFallback` (which WOULD have minted the same word as a
   property — see its own decline guard, `chat.mjs:2116`, "Y already a known NOUN... never misread
   as a property") ever gets a turn. `unknownAdjectiveFallback` itself has no quantifier gate, so it
   would have handled "every Record is persisted" correctly on its own if it ran first — the
   ordering, not either function's individual logic, is the bug.

**Why this is out of the fast loop's scope**: fixing it means changing `unknownObjectFallback`'s own
mint guard to defer to `unknownAdjectiveFallback` for likely-adjective objects — not a one-line
routing tweak, because it touches the shared vocabulary-growth mechanism `PLAN_TAUGHT_RELATIONS.md`
built (Item 5 and its sibling), and both fallbacks have extensively-documented pinned-regression
guards in their own docblocks (`chat.mjs:1886-1958` for the object-mint asymmetry, `2011-2035` for
the adjective-mint's subject-groundedness rules) that a change here risks disturbing.

**A concrete fix sketch, for whoever picks this up**: `chat.mjs` already has a reusable POS-check
helper, `subjectIsNounOrPropn` (`chat.mjs:2213`), built on `nlpAdapter().posTags()`
(`src/ask-nlp.mjs:60`, the wink-nlp adapter already used for exactly this kind of disambiguation
elsewhere in the file). `unknownObjectFallback` could call an equivalent check on `objectRaw`
before minting — if wink tags it `ADJ`, decline (`return null`) instead of minting a class, letting
the cascade fall through to `unknownAdjectiveFallback` next. The risk to scope before building this:
confirm wink's POS tagger is reliable enough on short out-of-context single words (the same adapter
already degrades gracefully — see `ask-nlp.mjs`'s own "null on any surprise, never a throw"
discipline) and add regression coverage for the canonical case each fallback's docblock already
pins ("every controller is a handler" must still mint a class; "every cache is bespoke" must still
mint a property) plus the new case ("every Record is persisted" should now mint a property, not a
class).

---

## Finding 2 — noise-stripping's dependence on wink's generic stopword list is arbitrary, and can corrupt resolution rather than just fail to help [RESOLVED, commit 85d46f0]

**RESOLVED.** Fixed via the "generate a candidate, prune it against the graph" architecture this
finding's own fix sketch called for (below), not the curated verb list round 6 already ruled out.
Re-traced against the real code first — this write-up's diagnosis held with one correction: "hold"
turned out to already be registered `defines`-family vocabulary in `ask-vocab.mjs` (a container-verb
synonym, unrelated to this gap), so it never reaches the bare-"where" branch at all; "save" (no
curated entry anywhere) stood in as the fresh light-verb test case instead.

`noise-strip.mjs`'s `stripNoise()` now also flags KEPT words wink's POS tagger tags `VERB`, reading
the WHOLE original sentence for real grammatical context — an isolated "store router" fragment tags
both words `NOUN` (confirmed live), so this signal only works read off the full sentence, before the
object phrase is extracted. The same "store" in "where would i store a router" tags `VERB`; in "where
does the store live" it tags `NOUN` — both confirmed live, so the general POS signal correctly
resolves the exact case the fix sketch below worried a curated list couldn't. Scoped to exactly the
bare "where"/"mentions" shape (confirmed, by tracing every `keywords.mjs` decomposition branch, as
the one construction with no explicit relation verb gating its object) and attached to the parse as
`altObject` rather than stripped outright — `noise-strip.mjs` still has no graph to check a
resolution against (`interpret/pipeline.mjs`'s own documented boundary), so it proposes a second
reading, it never decides between them.

`ask.mjs`'s `traverse()` — where the graph actually lives — tries both readings at the shared
object-resolution call site and prunes: the reading that misses or ties loses to the one that
resolves cleanly (mirroring `resolveObject`'s own grain-word retry a few lines above it, and
`grammar/ace.mjs`'s `parseAceAmbiguous` — "keep only complete, valid parses, dead ends pruned"); a
genuine case where both readings resolve cleanly to DIFFERENT real entities surfaces as honest
ambiguity through the SAME tier-tie UX `resolveObject` already renders — no third
ambiguity-presentation surface was invented.

Live verification (scratch copy of `examples/mini-webapp`, never the committed fixture): "where
would i store a router" went from a 4/5-way ambiguous dump to a clean single answer identical to
"where is router defined"'s; "where would i save a router" (the fresh, uncurated light verb) went
from 2-way ambiguous to clean, confirming the fix generalizes rather than special-casing "store";
"where is router defined", "where would i keep a router" (the already-fixed case this finding cites),
and "i was wondering what calls addRoute" (a non-"where" noise-strip construction, keyword-spot's
verb-decomposition path) all render byte-unchanged. `npm test`: 1872/1872, same count as before the
fix, 0 failures.

Rounds 3, 5, and 6 converged on the same root cause from different angles; round 6's investigation
(which also disproved a plausible-but-wrong hypothesis — see below) is the most precise and is the
primary source here.

**The mechanism**: `src/interpret/strategies/noise-strip.mjs`'s `stripNoise()` (lines 74-86) treats
a lowercase alphabetic token as strippable "noise" if it's in a curated list (`FILLER_WORDS` +
`CASCADE_NOISE`) OR if `nlp.isStopWord(lc)` returns true. `isStopWord` (`src/ask-nlp.mjs:49`) is a
thin wrapper over wink-nlp's own built-in English stopword dictionary — a generic list, not
purpose-built for this codebase. That dictionary happens to flag some ordinary main verbs ("keep",
"put", "get") as stop words but not their close synonyms ("store", "place", "hold", "save") —
confirmed live, `isStopWord("keep") === true`, `isStopWord("store") === false`. So "where would I
keep a hammer" strips cleanly to "hammer" and resolves correctly, while "where would I store a
router" doesn't strip the verb at all, leaving "store router" as the object phrase handed to
`resolveObject` (`src/ask.mjs`).

**Round 6 disproved the more obvious-looking hypothesis**: this is NOT a `resolveObject` scoring
bug. Traced directly: when `store.mjs`, `router.mjs`, `Store`, and `Router` (all real individuals in
the fixture graph) each have a stem that exactly equals one of the two leftover query words, they
tie honestly under `resolveObject`'s own tiered scoring (`overlap/termComps.length`, normalized) —
a real 4/5-way tie over real graph individuals, the mathematically correct output given that input,
not a defect in the scoring tiers themselves. Round 6 also confirmed a narrow verb-list patch
inside `noise-strip.mjs` (mirroring `WHERE_MARKERS`'s own curated-list pattern) doesn't clear the
bar: the synonyms a real visitor would actually type ("store", "hold", "save", "place") are exactly
the ones most likely to collide with real identifiers in a real repo (`Store`, `Storage`, `save()`),
so curating them in reopens the same false-strip risk on legitimate lookups ("where does the store
live") that the fix is meant to avoid — and a collision-free subset only covers part of the family.

**Why this is out of the fast loop's scope**: `noise-strip.mjs`'s `stripNoise` is a SHARED path —
every query shape that reaches this strategy (not just "where" questions; see
`src/interpret/strategies/keywords.mjs`'s own bare-"where" branch, lines 87-97, which is one of
several consumers) is affected by whatever criteria decide what counts as noise. Changing that
criterion is a broad-surface change with wide regression exposure, not a local patch to one
phrasing.

**A concrete fix sketch, for whoever picks this up**: the same `nlpAdapter()` that backs
`isStopWord` already exposes `posTags()` (`src/ask-nlp.mjs:60`) — the exact mechanism Finding 1's
fix sketch also reuses. A POS-aware criterion ("strip any token wink tags as a main VERB in this
specific no-relation-verb construction, not just the ones on its incidental stopword list") would
close the arbitrary keep/put-vs-store/hold gap at its root, rather than growing a curated list one
synonym at a time. The real cost: `stripNoise` has no notion of *which construction* it's being
asked to strip within today (it's a flat token filter, not construction-aware) — teaching it "a verb
is only strippable when noise-strip is being asked to recover a no-relation-verb 'where' shape"
would need real design work (a construction-scoped variant of `stripNoise`, or a POS check gated
specifically inside `keywords.mjs`'s bare-"where" branch rather than the shared filter), plus a
regression sweep across every OTHER strategy that already depends on `stripNoise`'s current,
narrower criteria not changing underneath it.

---

## Cross-reference check

Neither `archive/PLAN_ADVANCED_GRAMMAR.md` nor `PLAN_AGENTS.md` mentions noise-stripping,
stopword handling, POS-aware disambiguation, or an adjective/noun teach-routing gap anywhere
(grepped directly, zero hits in both) — both findings above are genuinely new gaps, not already
tracked work being duplicated here.

---

## What this doc is not

Not a scoped build plan, not staffed, not blocking any other work. Finding 2 is now resolved (see
its own section above for what shipped, commit 85d46f0). When a future session wants to close
Finding 1, start here for the precise mechanism and the fix sketch's own caveats, then do the real
design work (regression coverage for the POS-check gate) that sketch flags as still open — this doc
intentionally stopped short of that design work for Finding 1, per its own stated role above.
