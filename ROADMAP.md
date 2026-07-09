# tmct ROADMAP

tmct v0.1.0 was a **whole-package lift** of the seonix chat surface (published
as `@polycode-projects/mct`): identical shape, green tests, new branding. That
was deliberate. It gave every ambition below a working, tested starting point
instead of a green field. v0.2.0 is the **reshape**: the lift's LLM fallback,
extraction stack, and MCP server are gone, and the package, naming, and license
now match the product this document describes.

This roadmap is organized into phases. The original 16 ambition items are
mapped into them (item numbers retained for traceability); the seven sketches
formerly held in `code-talker-ideas.txt` are folded into items 8–11 below and
the file has been deleted.

## Where we are now (2026-07-09)

The full `SKILL_CHAT_PLAYTEST.md` dialogue-flow tier ladder is complete, tiers 0 through 6.
Tiers 0, 1, 2, and 4 each closed in one pass. Tier 3 took 7 passes to track down a recurring
`resolveObject` substring-match weakness. Tiers 5 and 6 each ran the full 5-cycle cap and each
turned up one genuinely important correctness bug alongside a batch of routing fixes. Full
per-cycle detail is in `HANDOVER.md`'s "The dialogue-flow playtest loop" section.

`npm test` is green at **1355** (up from 1258 at the start of this session). v1.0.7 is
published (0.9.11 → 1.0.0 → 1.0.7 across an earlier session; the exact release chain and
file:line detail are in `HANDOVER.md`). Nothing has pushed since, so the local version sits at
1.0.9 per the bump-at-push-time policy.

Test count across the session's later stretch:

| Work | `npm test` |
| --- | --- |
| Playtest-freeze verification pass (Tiers 0/1/2/4 + operator bugs A-F, chat-tested live and frozen as regressions) | 1299 → 1303 |
| `resolveObject` tier-3 derivational-stem bridge, closing the one dead-end the freeze pass found | 1303 → 1307 |
| Tier 5 (teach + recall + reasoning in dialogue), 5 cycles | 1307 → 1328 |
| Tier 6 (the messy real user), 5 cycles, run alongside a background test-suite health pass | 1328 → 1345 |
| Compound-name resolution (multi-word queries to joined-token symbol names) | 1345 → 1352 |
| Vocabulary-growth mirror fix — known-subject/unknown-object mint (`unknownObjectFallback`), so new terms compound turn over turn | 1352 → 1355 |
| `findActionPath` (`src/planning.mjs`) — generic bounded on-demand-successor state-space search, `PLAN_HANOI.md`'s Phase 2 kernel, proven against a small toy graph; not wired into chat, Hanoi itself not started | 1355 → 1361 |

**INFBENCH re-measured against 1.2.0** (measurement-only dispatch, 2026-07-09): `INFBENCH_1.2.0.md`
confirms chat/INF-A2 now closes to 100% (the cax-sco/proof-chase win the STATUS banner above already
claimed) but also finds chat/INF-C1 has flipped from an honest ceiling to a genuine 93%-fabrication
regression, traced to the new general-verb-to-predicate query lane answering "no" on an absent fact
instead of declining — a real correctness bug, separate from and cheaper than the still-gating
INF-B1 (`cax-dw`) work.

**INF-C1 fabrication FIXED (2026-07-09, follow-up dispatch)**: `GENERAL_VERB_YESNO_RE`'s no-hit
branch (`src/chat.mjs`) now declines (`null`) instead of asserting a confident "no" when no taught
fact matches the queried subject/predicate/object triple, falling through to the ordinary
honest-miss cascade — same convention as `WHO_OWNS_RE`'s own no-hit branch. Re-ran `npm run
infbench`: chat/INF-C1 is back to **93% completion / 0% fabrication**, its `0.8.2`-era honest
ceiling, exactly as predicted (up from `1.2.0`'s 0% completion / 93% fabrication). Everything else
in the ladder is unchanged — still gated at INF-B1 (33% completion), unaffected by this fix.
`npm test` 1361 → 1362 (this fix's own contribution; see `HANDOVER.md` for the combined total
alongside the concurrent Rule-storage dispatch).

**`PLAN_TAUGHT_RELATIONS.md`** (research/design, 2026-07-09, nothing implemented): scopes teaching
tmct brand-new relations and rules through ordinary chat (a Prolog-style family tree — father,
parent, grandparent, descendant — none of it hardcoded, all of it taught), reusing
`findActionPath` for the hop-counted relation chase and a new sibling kernel, `findReachableSet`,
for open-ended enumeration. Live-testing while designing it surfaced real, already-shipped gaps:
the "is a kind of" teach phrasing isn't accepted anywhere today, a "parent" example in the original
scoping conversation only worked by an accidental lexicon collision, and a wrapped property-teach
shape (`TEACH_PROPERTY_RE`) has no groundedness check at all, unlike the newer subject/object
mint-fallback pair's explicit discipline. See `HANDOVER.md` for the full finding list; this is
next-session pickup material, not yet started.

**`PLAN_TAUGHT_RELATIONS.md` Phase 3 — DONE (2026-07-09)**: the Rule storage foundation landed in
`src/memory/core.mjs` (`RULE_CLASS`, `appendRule`, `findRuleByName`) — pure plumbing, zero
`chat.mjs` change, reusing the existing Source/trust pipeline unmodified. `npm test` 1361 → 1371.
Phase 4 (compose2 query-side wiring) is next in that plan's build order.

**`PLAN_TAUGHT_RELATIONS.md` Phase 1 — DONE (2026-07-09)**: Item 1 (relational fact teach,
`RELATION_FACT_TEACH_RE` — "ahab is the father of john" mints an ordinary Fact via
`generalVerbPredicate`, reused verbatim) and Item 5 (adjective-mint, `unknownAdjectiveFallback` —
"the cache is bespoke" / "TaskController is bespoke" mint `mgx:hasProperty`) both landed in
`src/chat.mjs`. Query-side readback for Item 1 needed zero new machinery ("what do you know about
X" / "does X <role> Y" both already confirm it); Item 5's own groundedness guard needed tightening
beyond the original design to avoid reopening the pinned "module is banana" regression — see
`PLAN_TAUGHT_RELATIONS.md`'s "Phase 1 — DONE" note for the full adjustment, plus a sharper,
live-confirmed restatement of that doc's Verification finding 4 (`isConversational`'s ≤3-word gate
pre-empts the teach lane entirely for a short bare sentence, not just its decline text — flagged,
not fixed, still out of scope). `npm test` 1371 → 1377.

**`PLAN_TAUGHT_RELATIONS.md` Phase 6, KERNEL half — DONE (2026-07-09)**: `findReachableSet`
(`src/planning.mjs`), a sibling of `findActionPath` with no `isGoal` at all — every state reachable
from the start within `maxDepth` is a result, not just one goal. Shares only the frontier-seeding
step with `findActionPath`; the expand loops stayed independent (halting/accumulation semantics
differ enough to make a shared core more complex, not less). Proven against a toy graph with a real
cycle and a same-length two-path convergence. `test/planning.test.mjs`, 5 new tests. The WIRING half
(teach-shape recognizer + query-dispatcher branch, both in `chat.mjs`) is deliberately deferred,
kernel-only per this task's own scoping — see `PLAN_TAUGHT_RELATIONS.md`/`HANDOVER.md` for detail.

**`PLAN_TAUGHT_RELATIONS.md` Phase 2 — DONE (2026-07-09)**: closes Item 1's own live-found
query-side gap ("is ahab the father of john" now resolves directly) and Item 2 (relation alias/union
query-side chase — a taught "father ⊑ parent" alias lets "is ahab a parent of john" resolve off the
father fact). One new recognizer (`RELATION_FACT_YESNO_RE`) and one new local helper
(`relationFactsFor`) in `factReadBack`, tried BEFORE `ISA_ASK_RE` gets a chance at the overlapping
shape. The teach-side "kind of"/"type of" fix (`stripKindOf`) is a genuine one-liner.
`test/chat-taught-relations.test.mjs` (new file), 4 tests. `npm test` 1382 → 1386. Phase 4 (compose2
rule, next in this plan's build order) reuses `relationFactsFor` as its own per-hop edge lookup.

**`PLAN_TAUGHT_RELATIONS.md` Phase 4 — DONE (2026-07-09)**: Item 3 (fixed-hop `compose2` composition
rule — "a grandparent is a parent of a parent" teaches a Rule, and "is ahab a grandparent of
ishmael" resolves via a hop-counted `findActionPath` search over the taught father facts,
alias-chased through "parent" via Phase 2's own `relationFactsFor`). The hop-counting discipline
(`{ entity, hopsTaken }` state, `isGoal` requiring exactly 2 hops) is live-verified load-bearing: a
1-hop and a 3-hop path through the SAME father/parent edges both correctly decline in the same store
where the genuine 2-hop pair resolves yes. Full family-tree chain (two father facts + the alias + the
compose2 rule) live-verified end-to-end via the piped CLI. `test/chat-taught-relations.test.mjs`
extended with 5 more tests (9 total). `npm test` 1386 → 1391.

**`PLAN_TAUGHT_RELATIONS.md` Phase 5 — DONE (2026-07-09)**: Item 4 (property-filtered composition
rule — "a grandfather is a grandparent who is male" teaches a `filter`-kind Rule). Required
refactoring Phase 2/4's `relAsk` dispatcher's three inline steps into one recursive closure,
`resolveRelationChase`, so a filter rule's base resolves GENERICALLY — the function calling itself —
whether the base is a plain taught relation or another Rule (e.g. compose2), never assuming which.
A hit requires both the base chase to resolve AND the subject to carry the taught property
(`mgx:hasProperty`); live-verified both failure modes separately (base fails outright vs. base holds
but the property filter correctly excludes the candidate) plus a filter whose base is a plain
relation (not a compose2 rule at all), proving the genericity. `test/chat-taught-relations.test.mjs`
extended with 4 more tests (13 total). `npm test` 1391 → 1395.

**`PLAN_TAUGHT_RELATIONS.md` Phase 6 — DONE (2026-07-09), WIRING half — the plan's build is now
COMPLETE, all six items.** Item 6 (recursive/reachability rule — "a descendant is a parent, or a
parent of a descendant" teaches a `recursive`-kind Rule; "list the descendants of ahab" enumerates
the full reachability set via `findReachableSet`, the kernel half already shipped, reused unchanged).
The query side is the one genuine kind-change among all six items (a reachability-SET enumeration,
not a yes/no chase), landed as a sibling of Phase 5's `resolveRelationChase` rather than a fourth
branch inside it — mirroring `findActionPath`/`findReachableSet`'s own sibling split at the kernel
level. Cycle safety (two individuals mutually taught as each other's parent) and a malformed
self-reference teach attempt (guarded for free by the teach regex's own backreference) both
live-verified. `test/chat-taught-relations.test.mjs` extended with 5 more tests, including one
comprehensive ALL-SIX-items integration test (18 total). `npm test` 1395 → 1400. **Nothing remains
outstanding from `PLAN_TAUGHT_RELATIONS.md`'s original six-item scope.**

**INFBENCH re-measured against 1.3.1** (measurement-only dispatch, 2026-07-09): `INFBENCH_1.3.1.md`
finds the ladder unchanged, byte-for-byte, since `1.3.0` — the four `PLAN_TAUGHT_RELATIONS.md`
phases that completed the plan (alias/union, `compose2`, property-filter, recursive/reachability
wiring) don't touch any band, confirmed by a zero-diff row comparison of both runs' raw product
files plus a direct check that no INFBENCH case's premises/query ever reach the new relational-teach
phrasing. Still gated at INF-B1 (33% completion), unchanged for a fourth consecutive measured
version — an honest, expected result given the new surface and the ladder measure different things.

### Shipped this session

- **Tier 5** found 12 routing/recognition fixes across teach and recall: article/head-word gaps
  in "what do you know about X", an adverb mis-parsed as a verb in general-verb teach, passive
  ownership phrasing, a quantified-property mis-teach, missing yes/no readers for taught facts, a
  silently-null teach path, past-tense property support, a leading hedge-adverb gap. The final
  cycle also caught a real correctness bug: "is the validate module deprecated" confidently
  answered off an unrelated "logger module" fact, through a word-overlap fallback with no
  exclusion for common code-noun suffixes like "module". New `test/chatflow-tier5.test.mjs` (21
  cases).
- **Tier 6**, the last rung of the ladder, found 23 routing/recognition fixes: a grain-word
  resolution ambiguity ("the logger module" tying a Module against a same-stem Class); five new
  closed preamble frames in `interpret/normalize.mjs` for topic-switch, self-interruption,
  acknowledgement, hedge-adverb, and browsing discourse markers, chaining correctly when several
  stack together; bare "inherits"/"inherit" alongside its sibling "extends"; a dozen more
  vague-opener idioms; dialect and register gaps like "yeah nah", "howdy pardner", "aight", "no
  worries". It also caught one important bug: "is the logger module tested" answered a
  fabricated "I don't know that yet" even though the structural engine had already computed the
  real, honest answer. An over-eager property-adjective matcher discarded it whenever a real
  graph-computed parse already existed. New `test/chatflow-tier6.test.mjs` (17 cases).
- **A test-suite health pass**, run in the background alongside Tier 6: batched `syllogise()`'s
  per-fact writes via `appendFacts`; let two chatbench plumbing tests opt out of the corpus seed
  (`TMCT_NO_SEED`); added a shared once-per-process seeded-fixture builder
  (`test/helpers/seeded-fixture.mjs`) for tests that only consume seeded content; replaced a
  hand-rolled copy of `WALL_MISS_RE` with the real export; and extracted a shared session-driver
  helper (`test/helpers/session.mjs`), replacing 11 near-duplicate `drive()`/`driveSession()`
  implementations. Full detail is in `HANDOVER.md`'s "Test-suite health pass" entry.
- **Vocabulary-growth mirror fix.** New vocabulary used to grow one-directionally only: "redis is
  a cache" could mint the unknown subject "redis" because the object "cache" was already a known
  noun, but the reverse ("every cache is a store," subject known, object unknown) declined
  outright. Added `unknownObjectFallback`, gated on a genuine universal quantifier ("every"/"each"/
  "all") so it can't reopen the general lexicon bypass the existing bare/"a" shapes rely on. A term
  minted by either direction now grounds a later sentence exactly like a lexicon word, using
  taught-only groundedness checks that deliberately exclude the bulk ConceptNet corpus seed (the
  corpus mentions ordinary English words constantly and must never silently count as "grounded").
  When both sides are totally ungrounded, tmct still declines, but now with an actionable grounding
  nudge instead of a bare "I couldn't store that." New coverage in
  `test/chat-teach-quantifier.test.mjs`.
- **Compound-name resolution**, from the operator's own worked example: "the payment system" now
  finds `PaymentSystem`, `payment-system`, a compound path like
  `westfield-payment-system/src/MyCode.cs`, and an interface-style name like
  `IPaymentSystemImpl.cs`. `resolveObject` (`src/ask.mjs`) gained a multi-word compound-term
  tier, the same shape as the existing single-word basename-exact/prefix-suffix (`9dde2b3`) and
  derivational-stem (`6e2d96b`) tiers, gated to require an explicit separator in the candidate
  label so a pure-camelCase identifier still falls to tier 4's prose fallback unaffected (this
  protects a frozen "total price" → `calculateTotalPrice` test). New
  `test/ask-compound-resolve.test.mjs` (7 cases). Full detail is in `HANDOVER.md`'s
  "Compound-name resolution addendum" entry.
- **The first-run chat experience, rewritten (1.0.0).** A brand-new `npm install` plus a bare
  `tmct chat` used to lead with a "no code graph loaded" apology for any input, including plain
  greetings, even though the seeded ontology/lexicon could already answer them. This was a
  0.6.0-era design over-applying its own honest empty-graph orientation. The fix: identity/
  capability-led responses ("I'm tmct — ..." before any caveat), a real self-description and a
  distinct "no LLM involved" answer for the identity/AI-ID family, provably-correct "try this"
  examples (a `vocabExampleHint` that only offers a term confirmed to resolve in the session's
  actual seed state), and broadened conversational recognition (dialect, register, slang,
  elongation, a bounded-fuzzy typo layer). All of it landed as curated closed-set additions, per
  the project's standing preference over general grammar rules.
- **The dialogue-flow playtest loop, tiers 0-4.** Tier 0 (bootstrap/identity), Tier 1 (single
  touch plus one drill-down), Tier 2 (drill-down chains with anaphora), and Tier 4
  (compositional and comparative) each closed in one pass. Tier 3 (cross-concept and relation
  touches) took 7 passes: cycles 3-9 progressively found and fixed a recurring `resolveObject`
  substring-match weakness, where a missing minimum-length floor let short staccato connectives
  like "and"/"it" silently hijack the conversation's focus and produce confidently wrong answers
  on a later turn while the triggering turn still looked honest. It took three point-by-point
  patches before cycle 9 found and fixed the actual root cause in one place. The skill doc itself
  gained two rules from real incidents this run: always `mktemp -d` plus exact-path cleanup for
  scratch fixtures, and never `chat --repo` the committed example fixture directly.
- **A live, client-side chat demo on the GitLab Pages homepage.** The real `src/ask.mjs` query
  engine runs directly in the visitor's browser as a live demo, not a scripted replay. wink-nlp
  loads from `esm.sh`, an import-map shim works around 3 leaf files' Node-only static imports, and
  the engine itself needed no changes since it was already browser-clean pure JS. It boots with a
  banner, replays a few real pre-verified Q&A turns as "history", asks one randomized (or
  `?q=`-primed) question live, and gives the visitor a genuine interactive input box to type
  their own questions and get real computed answers. `?compact=1` gives a minimal primed-link
  view; `window.tmctAnswer`/`tmctAsk`/`tmctParseEntities` are exposed for headless/Playwright
  consumers. There's no backend on GitLab Pages, so plain `curl`/`jq` never sees a computed
  answer, which is stated plainly in the code rather than oversold.
- **Operator-found bugs, fixed as they turned up in hand-testing the shipped CLI.** Relation-
  specific vocabulary filtering (an ask like "what is a tree used for" was dumping every known
  relation instead of filtering to UsedFor); a teach-lane "did you mean" suggestion that could
  echo the user's own input byte-for-byte (a missing a/an agreement check); out-of-domain small
  talk ("what time is it") hitting the raw grammar wall instead of an honest nudge; a
  pronoun-subject teach-lane gap that could silently store a bogus fact ("he is a module"); a
  closed-set existence-question recognizer misreporting a relationship check as a verified
  existence negative; "what else is X" repeating the primary definition instead of surfacing
  more; bare "what is X" (no article) having no fact-lookup route at all, including for a fact
  the user had just taught; and general verb-to-predicate teaching ("remember margo eats ribs"
  mints its own predicate now, not just the closed is/has/are set, and "has a" interoperates with
  the existing ConceptNet-sourced `mgx:hasA` data).
- **Six more operator-found bugs (A-F), from a later manual chat-testing pass.** A malformed
  "haves soup" render for past-tense "had" (a lemma fix); a broken "count soup" message when no
  code graph is loaded; "what is in your memory" (bare, and "... about X") falling to the
  structural miss instead of the memory summary/fact-lookup lanes. The "about X" form now also
  walks transitive subtypes of X over taught (never corpus-noise) isa facts; a closed-set
  indirect-request wrapper ("I want you to search for Widget") that used to be swallowed whole by
  the general-verb teach recognizer, now stripped centrally before dispatch, plus a "search for
  X"/"tell me X" (no "about") phrasing fix; and a `GOAL_BY_COMMAND` table that gives every
  slash-command dispatch its own honest "Goal (inferred): ..." line. Full detail per bug is in
  `HANDOVER.md`'s "Operator-found bugs A-F" entry.
- **General verb-to-predicate teaching's query-side follow-up.** A taught general-verb fact now
  answers direct questions too: "does margo eat ribs" → yes, "did margo eat ribs" → yes, "does
  margo eat cake" → an honest no, "what does margo eat" → lists ribs. It reuses the same has/have
  predicate bridge the teach side already had.
- **New-term teaching and quantifiers.** "redis is a cache" (a genuinely new term, not
  previously in the closed ACE lexicon) is now teachable through a write-side-only fix; the read
  path already worked generically over any subject string, including the existing 2-hop
  transitive `IsA` proof chase. Plus four new phrasings ("some/a few Xs are Ys", "your X is a Y",
  bare "X is Y" as a property assertion) and a stored-quantifier recall ("how many Xs are Ys" →
  "A few.").
- **An always-on, short "Goal (inferred): ..." line** on every real structural or vocabulary
  answer, distinct from the pre-existing opt-in `/narrate` full-trace mode. Two correctness bugs
  in the goal-deduction hook itself got fixed along the way: a confidently wrong goal shown on
  failed teach attempts, and a missing goal on relation-force answers that resolve through a
  different path than the normal parse.
- **Seonix's 17-round dogfooding backlog, triaged and worked through.** Seonix, a sibling
  project consuming tmct as a real dependency, ran extensive dogfooding against both a synthetic
  self-index and a real 27,929-module production estate, and relayed the findings over the
  inter-session inbox. The backlog was triaged into 5 priority batches (4 items were already
  fixed by intervening work). **Batch 1** (existence-query correctness) shipped first. **Batch
  2**: bare "what is Commit" now parses (article optional, restricted to `ENTITY_TO_TYPE`'s
  closed vocabulary); a reverse `inherits` verb family ("is X a superclass/parent class of Y")
  swaps subject and object at parse time to agree with the existing forward phrasing; a curated
  trailing-scope-filler strip ("what is a Module in this graph" → "Module") works at both the
  grammar and chat-fact-lookup layers. **Batch 3**: purpose/identity phrasing ("whats X for/
  about") joins "what does X do"; bare "recent/latest/newest commits" render a real dated list
  instead of a false find-miss, and "the last/latest/most recent commit" as a query subject
  substitutes the actual newest Commit before parsing; onboarding/closing phrasings beyond the
  original closed set get the orientation nudge; present-tense cochange phrasing ("changes with")
  joins the past-tense form. **Batch 4/5**: the cross-graph disambiguation-ranking weakness never
  reproduced on tmct's own tiny example fixtures, so a new committed fixture graph
  (`test/fixtures/large-scale/`, vendored commander.js + express.js source) was built to
  reproduce it. It surfaced an exact basename match losing to a same-directory sibling that only
  shared a component; fixed in `resolveObject`'s tier-3 scoring, where a new exact/prefix/suffix
  basename tier now outranks the length-normalized overlap fallback. Separately, "which functions
  call X and test Y" (two different, both-recognized relation verbs joined by "and") used to fall
  to the legacy `ambiguousParse` path; the marker gate now also opens when every later
  "and"-branch names its own single-word recognized verb, composing a real set intersection,
  narrowly scoped so the pre-existing "which classes extends Base and couples to logging" compat
  case stays exactly as closed as before. Still open: cochange phrasing variants, and a single,
  not independently reverified "multi-root" substring over-match.
- **The Tier-4 "of X" membership gap, walked through inheritance.** "public methods of
  TaskController" used to return a genuine-looking but incomplete empty when the class declared
  no members of its own but inherited real ones from a superclass. `src/ask.mjs`'s membership
  eval now tries the owner's own (qualifier-filtered) members first, and only walks
  `ancestorsOf` nearest-first when that's empty and the class participates in `inherits`. An
  inherited answer is disclosed out loud ("… has no own methods — inherited from Controller:
  …"), never silently presented as the owner's own.
- **The version-bump policy, set then revised.** The session first tried bumping immediately
  after every push and holding the bump locally until the next batch shipped, to keep the
  published npm version matching the last pushed commit. That produced confusing "referencing a
  version that doesn't exist yet" noise, so it was reverted mid-session. Current policy, recorded
  in `CLAUDE.md`: bump only at the moment of actually pushing, as part of that same push.

### Next: the open follow-ups

1. **Judged CHATBENCH re-run.** Not run this session. This session's changes touch answer text
   on judged surfaces again (onboarding/identity responses, teach-lane wording, new relation
   phrasings), so the next judged pass needs to re-derive its stale set from answer-text diffs,
   not assume anything carries over from the 0.8.2-era baseline still on record.
2. **The reverse-`inherits` verb family's "the"-definite forms** from Seonix Batch 2 ("is the
   superclass of") aren't wired into `VERB_TO_KIND` yet. Doing so leaked the bare word "the"
   into `ask.mjs`'s CONTENT_VOCAB and broke the relaxation cascade's noise-strip tests, so it
   needs a CONTENT_VOCAB fix first.
3. **Seonix Batch 4/5's remaining items**: cochange phrasing variants, and the single,
   not-independently-reverified "multi-root" substring over-match noted above.
4. **Extend compound-symbol matching to `/describe`'s own resolver.** The compound-name
   resolution above only covers `resolveObject` (`src/ask.mjs`); `/describe`'s own resolver
   (`resolveSymbol` in `codegraph.mjs`) is a separate, stricter, pre-existing resolver that
   doesn't share `resolveObject`'s tiered scoring, so "describe the payment system" doesn't
   benefit yet. Not a regression, just not yet covered.

### Later: deferred by design, staged inside each plan

Each plan doc stages its own later phases; this list just points to them rather than repeating
their tables.

- **infbench stages 1-5** (`PLAN_INFERENCE_TESTING.md` §4). The disjointness proof rule (unlocks
  B1), proof-chain materialization, cardinality entailment, consistency checking. The repeatable
  measure/gate/advance cycle for this ladder is now also captured as an invokable skill,
  `SKILL_INFERENCE_TESTING.md`.
- **Advanced-grammar tracks b/d/e** (`PLAN_ADVANCED_GRAMMAR.md`). The constructions not landed
  this wave: stacked modality/passive, implicit arguments, and the rest of the CEFR inventory
  audit table.
- **Ontology stage 3+** (`PLAN_ontology-hierarchies.md`). Beyond the synonym-wiring and
  disjointness growth landed this wave.
- **`PLAN_CODE.md` tracks 2/3.** Small JS-function synthesis and HTML/CSS-fragment synthesis, both
  via a Playwright-sandboxed headless browser. Explicitly staged well behind Track 1, each gated
  on its own operator sign-off.

### History — what shipped in earlier releases

**v0.9.12 → v1.0.7** (this session — the first-run UX rewrite + the 5-tier playtest sweep +
the live browser demo): see "Where we are now" above for the full narrative; short form —
1.0.0 shipped the identity/capability-led onboarding rewrite; 1.0.1-1.0.7 shipped, in order, the
redis/new-term teaching + quantifier phrasings, the always-on Goal-inference line, a teach-lane
pronoun-subject guard, three operator-found bugs (used-for filtering, teach-suggestion echo,
out-of-domain small talk), Tier-0/1/2 playtest passes, Tier-3's 7-pass convergence (ending in a
root-cause fix for the recurring substring-match focus-corruption bug), the diagnosed Tier-4
compositional-fold fix, the live in-browser chat demo, Seonix Batch 1 (existence-query
correctness), Tier 4's own playtest pass, and a final bundle ("what else is X", bare "what is X",
general verb-to-predicate teaching). `npm test` 1055 → 1245 across the session, every commit
green. Full commit-level detail in `HANDOVER.md`.

**v0.8.2** (the chat-feel wave + rule-general C2): tier-1 CHATBENCH 334/334 (draw A) + 285/285
(draw B), zero regressions; the cycle-1 hard-fail `gq-functions-call-fnalpha` flipped green.
Landed recall hygiene, preamble/politeness frames, calls∪callsSymbol + grain/meta fallbacks, the
author lane, wall kindness + honest capability nudges, teach-lane widening, receipt tails
prose→detail, plus a live-found scale hotfix (`edgesOfKind` argument-spread overflow past ~100k
edges). AGENTBENCH ladder grew 43→56 cases; goal driver 100% plan / 98% result / 0% hallucination,
all rungs gate-PASS; resolver floor clean A0–C1 100/100; C2 became rule-general (two declared
goal-rules, pure `applicableRules` selection). Full detail: `CHATBENCH_0.8.2.md`,
`AGENTBENCH_0.8.2.md`.

**v0.8.1** (published): AGENTBENCH grades the executed composed result, not just the call-plan.
Resolver 97% plan / 91% result / 0% hallucination. Stage 5 (the C2 goal-reasoner, BDI + Goal-Driven
Autonomy) lifted result-completion +10pp on a like-for-like driver swap. Stage 2 (imperative intent
frames + ACE reach) shipped at 100% plan / 95% result / 0% hallucination, `tmct_calls` genuinely
NL-reachable. Chat surface: quick wins + two frozen playtest transcripts, no tier-1 regression vs
0.7.1. Full detail: `CHATBENCH_0.8.1.md`, `AGENTBENCH_0.8.1.md`.

**v0.8.0** (published): all five Phase-11 tracks. The `/v1/messages` shim + Stage-0 registry +
resolver/guardrail/planner (96% plan completion, 0% hallucination, closed-world C1); three chat
levers; the `../bedrock-meter` $0 rung; the playtest; Stage-2/Stage-5 research notes. Full detail:
`CHATBENCH_0.8.0.md`, `AGENTBENCH_0.8.0.md`.

## The umbrella product definition (item 1)

**A tolerant, ELIZA/PARRY-style chat, obsessed with software.** A best-efforts
conversational surface that guides users toward precision queries.
ELIZA/PARRY-style pattern reflection, but domain-obsessed the way PARRY was
obsessed with the mafia — tmct may heavily assume a narrow context (you are
asking about *this* codebase, or about what tmct itself remembers) and exploit
that assumption to answer cheaply and confidently. Tolerant of loose, fuzzy,
misspelled input; never silently wrong; **no LLM anywhere in the product**.
Every phase below serves this definition.

---

## Phase 0 — Reshape (v0.2.0) — the current work

One commit per step, `npm test` green at each.

- **DONE — Strip the LLM fallback** (`--with-claude` / `--with-copilot` and the
  `hook-augment` mode removed; the product path is now provably model-free).
- **DONE — Drop the extraction/viz stack** *(item 12: shed the codebase-index
  dependency)*: Python `ast`, tree-sitter, Roslyn/Java extractors, walk/viz/
  timeline/temporal modules, `roslyn/`, `java/`, `templates/` all deleted. tmct
  consumes a graph via the provider seam; it produces none.
- **DONE — Drop the MCP server**: `@modelcontextprotocol/sdk` removed;
  `dispatchTool` survives as the plain internal tool switch.
- **DONE — Carve `buildEntities`** into `src/graph-build.mjs`: the pure
  in-memory graph assembly function, kept as the future memory writer
  primitive.
- **DONE — Empty-graph bootstrap** *(item 14, partial)*: a missing graph file
  is no longer an error; tmct starts empty, says so, and creates
  `.tmct/graph.json` from the conversation. The full provider adapter contract
  is Phase 1.
- **DONE — tmct naming purge** *(item 15, widened)*: seonix AND the interim
  "mct" replaced throughout — package
  `@polycode-projects/the-mechanical-code-talker`, bin `tmct`
  (`bin/tmct.mjs`), tool prefix `tmct_*`, artifact dir `.tmct/`, env
  `TMCT_GRAPH_FILE`, prompt `tmct>`.
- **DONE — License swap to MPL-2.0** (from AGPL-3.0): free commercial use,
  file-level publish-and-attribute copyleft.
- **DONE — README rewrite + GitLab Pages home page** (`public/index.html`,
  `pages` CI job): https://polycode-projects.gitlab.io/the-mechanical-code-talker/
- **DONE — `docs/references/` skeleton + `ontology/`**: the reference-library
  index (canonical URL / retrieval date / licence / consumer per entry), OWL 2
  vocabulary notes, ACE-OWL sub-fragment pattern table, ConceptNet relation
  list, and the `ontology/tmct-core.ttl` placeholder. This feeds the Phase 2
  grammar work; the library grows as sources are web-verified.
- **DONE — Publish 0.2.0** under the new name; deprecate
  `@polycode-projects/mct@0.1.0` with a rename pointer.

---

## Phase 1 — Interpretation pipeline + memory foundations

### Item 8 — Multi-strategy request classification and ranking → `src/interpret/`
Instead of a single best-guess parse, run the request through **all the classes
of thing it could be**, parse it with each class's own strategy (grammar parse,
keyword picking, noise-word removal, fuzzy matching — later the ACE strategy
from Phase 2), execute the strategies that look like winners, then **merge
same-class results** and surround **distinct-class results** with "if you mean
X then …". Grows from `ask.mjs`'s existing 2-way merge into
`interpret/pipeline.mjs` + `interpret/merge.mjs` + `interpret/strategies/*`.
*(Covers sketch 1 of the former `code-talker-ideas.txt`: "request → all the
classes of things it could be → parse using each class-specific strategy →
execute winners → combine similar result classes and rank".)*

### Item 13 — The clean chat / primitives split
Pull the movable conversational grammar out of the core primitives
(`resolveObject`, `edgesOfKind`, `refineToEntities`, `traverse`) so the chat
engine stands alone. `chat.mjs` slims to the conversational layer + `runTurn`
orchestration.

### Item 10 — Input normalization pass (grammar / spell / style checks)
Run a grammar check, spell check, and style check over input as a
normalization pass alongside classification (item 8), so misspelled or
ungrammatical input is repaired or scored before template matching — the
concrete mechanism behind item 1's "tolerant of loose, fuzzy, misspelled
input" promise. The same checks later serve the "observe" ambition (item 6)
over repo prose. *(Covers sketches 3, 4, and 5 of the former ideas file:
grammar check, spell check, style check.)*

### Item 9 — Conversational memory as its own graph → `src/memory/`
Record every parsed request as an "a-visitor-said" item and every response
alongside it, in tmct's own OWL-labelled graph (`memory/core.mjs`), with text
blocks under a PageRank-style relevance index (`memory/blocks.mjs`) and
session-log cleaning/folding (`memory/fold.mjs`). Future input can then match
against **prior questions** by similarity, not just against a provided code
graph. This is tmct's own data under `.tmct/`, distinct from any
provider-supplied graph and not written back through the provider adapter.
*(Covers sketch 2 of the former ideas file: "once parsed the text is added to
the graph as a-visitor-said item; responses from queries go in the graph; text
matching may find similar questions".)*

### Item 14 (finish) — The graph-provider adapter contract
Define the provider touchpoint interface — a loader yielding
`{ individuals, byId, relations, proseIndex }` plus the published primitives —
so seonix or any other producer can feed tmct without tmct importing an
indexer. Phase 0 shipped the bootstrap seam; this finishes the contract.

### Item 16 — Library-first design for extension
Keep the `exports` map and the primitives stable and documented as the
internals are refactored.

### Shell work
- **Ink console shell** (`src/tui/app.mjs`, ink + react, no build step) around
  the shared session sink; readline `runChat` stays as `--plain` and as the
  test surface. *(Decision: OpenTUI ruled out — `@opentui/core` depends on Bun
  FFI (`bun-ffi-structs`, native Zig renderer), not Node-clean; revisit when it
  runs under plain Node.)*
- Fold the surviving `bin/cli.mjs` arms into `bin/tmct.mjs`; delete `cli.mjs`.

---

## Phase 2 — Grammar → OWL + corpus

### Item 2 — Its own well-defined grammar → `src/grammar/ace.mjs`
A first-class, documented, testable grammar — an **ACE-inspired controlled
fragment** (~8 sentence patterns; see
`docs/references/schemas/ace-owl-fragment.md`) that emits **OWL-labelled
triples** when text fits it, backed by a declared lexicon
(`grammar/lexicon.mjs`, TOML/JSONL data). Plugs into the item-8 pipeline as
one strategy among several: fitting the grammar is a strong signal, missing it
falls back to the tolerant strategies.

### Item 3 — Ontology grounding: core OWL/RDF + SE vocabularies
Ground the memory vocabulary in real ontologies: core **OWL 2 / RDF / RDFS**
scaffolding plus software-entity concepts (the SEON-derived terms the graph
already uses — `seon:`, `mgx:` prefixes — with **OWL-SEON** and **FAMIX** as
reference vocabularies). Deliverable: `ontology/tmct-core.ttl`.

### Items 4 + 7 — Template libraries, phrase book, plain data formats
Sentence-fragment template libraries for matching input and generating
responses, plus a software-engineering phrase book — all in plain, diffable
formats (**JSONL**, **TOML**, **.txt** line files).

### ConceptNet corpus slice
A committed, filtered English/tech-domain **ConceptNet slice** (CC-BY-SA 4.0
notice, size-budgeted) with the ~35-row relation→ACE-OWL-pattern mapping table
(`src/corpus/conceptnet.mjs` + `conceptnet-map.toml`; relation list in
`docs/references/schemas/conceptnet-relations.md`). The corpus seeds the
bootstrap graph so an empty tmct still has a vocabulary.

### Reference library growth
Grow `docs/references/` with web-verified sources: ACE/APE papers, ConceptNet
docs, ELIZA/PARRY lineage papers (only redistributable licences committed) —
and finish `ontology/tmct-core.ttl` alongside the grammar work.

---

## Phase 3 — Chat tuning cycle (autonomous)

The measurement loop that turns the above into a tunable product — specified
in `SKILL_TUNING_CYCLE.md`:

- a fixed, versioned **chatbench case set** (`chatbench/cases.jsonl`);
- a **deterministic replay runner** over `runTurn` (the product is
  deterministic — one run per arm suffices);
- **LLM-as-judge** scoring (N≥3 samples per case; groundedness / correctness /
  honesty-on-miss / rephrase-hint helpfulness). The judge lives in the **eval
  harness only** — the product stays no-LLM;
- `CHATBENCH_0NN.md` artifacts and an autonomous cycle loop (no hard pause;
  each cycle logs its ranked decision menu and continues).
- **The graded benchmark** (case-set v2, operator-specified 2026-07-04): a
  scaled ladder fitted to HUMAN LANGUAGE STANDARDS, not AI-benchmark mechanics
  (bAbI explicitly rejected — it tests expected-AI mechanics and overfits the
  same way our own cases would). Every case carries a **CEFR band (A1–C2)** +
  a **construction specialization** tag (TROG-2/CELF-5 style blocks, adapted:
  naming/vocabulary, SVO queries, pronoun binding, reversible/passive,
  relative/embedded clauses, quantifiers+counting, negation, temporal,
  coordination/compositional, multi-turn discourse reference, declarative
  assert+recall). Multiple questions per grade × specialization with a little
  overlap — authored as a POOL ~10× the per-run need (deterministic generator;
  each run samples ~10% stratified, ≥5 items per populated cell, recorded
  seed), with COMBINATION cells alongside single-area cells so weakness is
  attributable to an area alone or to a specific pairing.
  **Ladder gating:** advanced grades are SKIPPED until every grade
  below passes reliably; when a grade reaches unit-test-level reliability its
  cases become ALWAYS-RUN deterministic tests (judge-free, promoted alongside
  test/showcase.test.mjs). Winograd/WinoGrande items stay as permanent
  ceiling markers; CHILDES as naturalistic easy-band input source. Licence
  rule: TROG/CELF are commercial — borrow the construction taxonomy and
  grading structure, author ORIGINAL items, never copy instrument content.
  A case at 0% is a ceiling marker, not a failure.
- **Retained showcase** (landed): the five most complex achieved sequences are
  frozen as unit-timescale regression tests in `test/showcase.test.mjs`; a
  showcase regression voids a cycle PASS regardless of the mean.

Inside this loop, two earlier ambitions become **tuning levers** rather than
standalone features:

### Item 5 — Calculation surfaced as reasoning
Derived facts presented as lightweight reasoning ("there are a lot of tests
for a codebase of that size", "this module is unusually central") —
calculations, not inference: deterministic, explainable, cheap.

### Item 6 — Optionally running linters/tests to *observe*
Let tmct run linters or tests to observe whether something actually worked,
reporting the observation — measurement, not reasoning.

### Item 11 — Formal logical reasoning over the ontology (Prolog / Progol) — exploratory, gated; matured into Phase LATER tier-5 "entailment-on-miss"
Apply real rules of inference (modus tollens, etc.) to formulas extracted from
parsed prose, checked against the axioms in the ontology (item 3) — a step
beyond item 5's arithmetic. The sketch: map OWL constructs into templates over
parameter expressions (Prolog terms or similar), then use a theorem prover —
Progol (inductive logic programming) is the named candidate — to prove goals
against parsed prose. Materially bigger than item 5 and dependent on the
Phase 2 ontology landing; **exploratory until a spike confirms the
OWL-to-template mapping is tractable**. *(Covers sketches 6 and 7 of the
former ideas file: "reasoning as the application of logic rules to the formula
created from prose against the set of axioms in the graph, possibly search
using Prolog" and "fit OWL constructs into templates / parameter expressions,
then use Progol to theorem-prove against parsed prose".)*

---

## Phase 4 — The wiring wave (operator-directed 2026-07-04)

Five subsystems are built, tested, and consumed by NOTHING in the answer path. They measured
zero on case-set v1 because no case could see them. This phase wires each into answering, with
**unit tests at the seam AND graded-benchmark cells that measure it** (the graded pool creates
the cases that make each lever visible). Wired as one operator-directed wave; cycle-level
attribution resumes per-lever afterwards.

| # | Wiring | Seam | Unit test | Bench coverage |
|---|---|---|---|---|
| W1 | **Templates → render path** | answer rendering consumes `data/templates/responses.jsonl` via `src/corpus/templates.mjs` instead of hardcoded strings (same output first — byte-stable swap — then variation) | render parity + slot lint | every existing case re-measures the swap; `via:"template"` provenance |
| W2 | **retrieveBlocks → miss path** | a bare-question miss consults the memory block index before the honest miss; a hit answers with the recalled block + provenance ("you asked this on …") | recall hit/miss seam | memory-recall cells (mr-asked-before flips) |
| W3 | **seedMemory → bootstrap** | first run in a graph-less repo seeds a capped corpus slice (limit ~500) into `.tmct/memory/`; banner says so honestly | seeded-bootstrap test | bootstrap-empty + vocabulary cells ("what is a cache?") |
| W4 | **Asserted Facts → answers** | "what is a module?" / "is a module a component?" consults remembered `rdfs:subClassOf`/`rdf:type` facts alongside the code graph, cited with provenance | fact-lookup seam | assert-recall cells |
| W5 | **Corpus on-demand** | unknown-term misses may consult the corpus slice (local first; network tier only behind an explicit flag) | on-demand seam, offline-degrades test | naming-vocabulary cells at higher grades |

Answer-path **provenance** lands with W1: every turn record carries `via`
(composed | template | count | recall | fact | corpus) — the field the dual-banding
benchmark (Phase 5) and the memory inspector read.

### Corpus tiering policy (the committed/seeded/on-demand cutoff)

- **Tier 1 — committed & shipped in the npm tarball**: small, load-bearing, licence-clean,
  diffable — the lexicon, response templates, phrasebook, the relation→OWL map, and the CORE
  ConceptNet slice. Budget: **~2 MB total tarball**; rule: what the product needs to be useful
  offline out of the box.
- **Tier 2 — fetched at seed time into install-local folders** (`.tmct/corpus/` per repo, or a
  user-level cache): growable corpora — extended ConceptNet neighbourhoods, acquired template
  libraries (Phase 5), any corpus > ~2 MB. Fetched once by `tmct seed` (or first bootstrap with
  consent), checksummed, provenance-recorded, never committed.
- **Tier 3 — on-demand at question time**: unbounded/live sources (ConceptNet API for unknown
  terms, paper phrase-mining), consulted ONLY behind an explicit opt-in flag, cached down into
  tier 2 after use. **Network failure degrades to the honest miss** — the $0-offline default is
  inviolable; tiers 2-3 are additive, never required.
- **Tier 4 — learn-on-miss (Phase LATER, not now)**: the term IS in the lexicon and the query
  built cleanly, but the graph+memory+corpus all return nothing → web search, clean the fetched
  text into tmct's own dialect (the ACE-ish controlled grammar), store on disk (tier 2), ingest,
  THEN answer — the full acquisition loop at question time. See Phase LATER.

### Memory inspection (seeing into the memory)

Graph-vis exploration hasn't earned its keep; the in-ethos answer is TEXT. A `/memory` chat
command + `tmct memory` CLI: the memory graph grouped by **OWL superclass** (Utterance, Fact,
Session; code classes when present), counts per class with **balanced samples scaled to class
size** (log-scaled so a 10,000-fact class shows ~8 exemplars and a 3-session class shows all 3),
top facts ranked by provenance breadth (corpus+chat-agreed facts first), recent utterance pairs,
and the block-index summary (blocks, tokens, top PageRank blocks). Same renderer serves
`/stats`-style terse and `why`-style verbose.

## Phase 5 — The cycle-4+ tuning arc (near-term: make the floor reliable)

> **STATUS: in progress — the two headline B1 levers shipped.** Negation as a bounded SET
> COMPLEMENT ("which X do not <verb> Y") and reversible-passive traversal ("X is imported by Y")
> are live; the harness meta-fixes and the rest of the ranked lever board (levers 3–6 + the C2
> ceiling, below) continue. **This section is the durable home for the tuning arc** — the detailed
> cycle-4 plan was archived to `archive/PLAN_CYCLE_4.md` once its substance lived here.

> The dependency audit that also fed this phase is archived at `archive/PLAN_DEPENDENCY_STRATEGY.md`
> (verdict: no dep changes now; a standing adoption register + avoid-list for phases 6-9; two
> near-term actions, both shipped — see below).

The immediate work: drive the graded benchmark up the CEFR ladder, one lever per cycle, per
`SKILL_TUNING_CYCLE.md`. Cycle 3 (post-wiring-wave, CHATBENCH_003) gave the first full-spectrum
reading — A1 1.72 / A2 1.70 / **B1 0.77 (the cliff)** / B2 0.97 / C1 1.07 / C2 0.69 — and two
META-fixes gate everything:

- **Meta-1 — fix the harness artifact BEFORE trusting groundedness.** The judge systematically
  scores TRUTHFUL product output (/describe attributes, recall frames, session ids) as
  fabrication because `FIXTURE_CONTEXT` omits the detail the product legitimately emits.
  Measurement integrity: lands in its own cycle, re-measured, before any product lever — else
  every groundedness delta is confounded. A harness correction, logged as such (like cycle-2's
  H1a/H1b), not a product change.
- **Meta-2 — the ladder rule: get B1 reliable before judging C-grades.** Don't pay to judge a
  ceiling while the floor leaks. A/B grades carry the judged spend; C1/C2 stay tier-1-only
  ceiling markers, judged only occasionally to confirm they're still ceilings (the existing
  `--ladder`/`--grade` flags).

Then the product levers, one per cycle, in ranked order: **(1) B1 negation operator** — the
deepest gap, the engine tokenizes "not"/"don't" as an entity ("no module matching 'not' found");
add set-complement to traversal; predicted B1 0.77→~1.05, ~10 hard fails cleared. **(2)
reversible-passive** ("is imported by" reverses edge direction). **(3) under-covered pool
growth** (B1 pronoun/temporal, C1 temporal — instrument fix, parallelizable). **(4)
assert-recall read-back**, **(5) quantifier+temporal composition**, **(6) the help-text honesty
leak** (hardcoded examples naming non-fixture entities — a real product fabrication, distinct
from meta-1's harness artifact), **C2 ceiling LAST**. Operator decision 2026-07-05: **do all of
them**. Exit criterion in the plan (roughly: B1 grade mean ≥ ~1.5 with all cells dual-draw
agreeing unlocks C-grade judging).

## Near-term actions (from the dependency audit, archive/PLAN_DEPENDENCY_STRATEGY.md)

> **STATUS: both shipped.** The wink browser-loader seam is added (shared model loader with a
> browser registration path) and `fnv1a` is single-sourced into `src/hash.mjs`.

Two concrete, low-risk actions the audit surfaced — not features, not dep changes:

1. **Fix wink's `createRequire` browser-loader gap** — the wink model IS the browser build, but
   our adapters load it via `createRequire(import.meta.url)` (`ask-nlp.mjs:29`, `prose-nlp.mjs:31`),
   which is Node-only. Browser mode needs a bundler `import` path. **A Phase 8 (browser-mode)
   blocker** — budget it into `archive/PLAN_REPOSITORY_INTERFACE.md`; it is a wiring fix, not a dependency
   change (the model is already browser-capable).
2. **Single-source `fnv1a`** — extract the content-address hash to one `src/hash.mjs` so the
   cross-version-stable fact-id contract has a single definition. Trivial refactor, do any time;
   no dependency (the audit confirmed home-grown FNV-1a is the correct choice — sync + browser +
   version-stable, which every library candidate fails).

## Provenance & trust — the unified source-link primitive (cross-cutting)

> **STATUS: shipped.** `mgx:createdAt` universal; `Source` first-class individuals linked by
> `mgx:derivedFrom` / `mgx:statedBy` / `mgx:canonicalisedFrom`; a deterministic `computeTrust`
> (source-type prior × corroboration × recency); retrieval weighted by relevance × trust; the
> `/memory` inspector surfaces contradictions with provenance. Legacy `mgx:factProvenance` kept
> as a compat shim.

> Detailed plan: **archive/PLAN_PROVENANCE_TRUST.md**.

*(Operator-specified 2026-07-05, from the observation that Phase-6 canonicalise-and-link,
tier-4 learn-on-miss, and the ConceptNet slice all share one shape: raw source preserved,
derived form linked back.)* Promote that shape to a FIRST-CLASS primitive used everywhere a
fact enters memory:

- **Every fact/block carries a `Source` and a link to it** — one predicate family
  (`mgx:derivedFrom` / `mgx:canonicalisedFrom` / `mgx:statedBy`) instead of the current
  per-writer `mgx:factProvenance` string. Sources are first-class individuals (class `Source`:
  operator-chat, corpus:conceptnet, learned:web:<url>, entailed:<rule>, provider:seonix), so a
  fact can cite MANY sources (the existing "|"-union becomes real edges).
- **Everything created is TIMESTAMPED** (`mgx:createdAt`), universally — Facts don't carry one
  today (only Utterances do), a Phase-6-trust gap to close: recency is a trust input and the
  novelty signal (below) needs it. Backfill on write; the timestamp is itself provenance.
- **Calculable trust scores per source**, deterministic and explainable: a source-type prior
  (operator > provider graph > curated corpus > web > unverified entailment) combined with
  corroboration (how many independent sources assert the same fact — the union already tells us)
  and recency/agreement signals. Trust is a computed attribute, never hand-set, always
  traceable to its inputs.
- **Trust as RETRIEVAL WEIGHTING**: `retrieveBlocks` / fact lookup / the memory inspector rank
  by relevance × trust, not relevance alone — a corroborated operator-stated fact outranks a
  lone web scrape on the same query. Contradiction becomes visible (two high-trust sources
  disagree → surface both with their provenance, never silently pick).
- **Feeds tier-5**: the Syllogist's entailed facts get a derived trust (min/product of premise
  trusts × rule confidence) — a conclusion is only as trustworthy as its weakest premise, and
  that number is computed, not asserted.

## Phase 6 — Formulaic competence: the template-acquisition learning loop

> **STATUS: shipped.** A technical (C1) register of templates and productive/performance
> dual-banding (computed from the `via` provenance) are live in the benchmark.

> Detailed plan: **`archive/PLAN_FORMULAIC_COMPETENCE.md`**.

The operator's insight upgraded to the strategy: a consistently-failed C1/C2 graded cell whose
answer EXISTS as a stable phrasing in technical prose is not a ceiling — it is a
**template-acquisition lever**. tmct learns the way human learners do: formulaic chunks first
(Wray's formulaic sequences), productive competence later.

- **Dual banding**: every graded score splits into a **productive band** (composed answers only)
  and a **performance band** (templates allowed), computed from the `via` provenance (W1). The
  band GAP is a first-class metric: how much fluency is memorized vs generated.
- **Template-lane benchmarking**: cases that target templated capability are TAGGED as such —
  a template-carried C1 pass counts in the performance band and never inflates the productive
  band; template-lane cells get their own agreement/reliability treatment (they are additional
  benchmarking, not replacements — a level we would otherwise expect to fail at is being
  deliberately faked, and the bench must say so).
- **The shopping list**: each cycle, the write-up extracts consistently-failed C1/C2 cells and
  ranks them by template-acquirability (does a stable technical-prose phrasing exist? is the
  slot structure mechanical — counts, comparisons, provenance we already compute?). Acquiring
  the template IS the lever; the graded bench measures the flip in the performance band.
- **Mechanical conclusions at paragraph grade**: counting + comparison + superlatives (item 5)
  composed through acquired C1-register templates — "X has 340 tests across 12 suites, unusually
  dense for a codebase this size" — tech-domain answers can be genuinely advanced while the CEFR
  banding tells us honestly how good the conversation AROUND them is.
- **Generalization path**: fixed tech domain first (templates hand-picked from technical-paper
  register); then template acquisition generalizes — mining candidate templates from corpus
  blocks (tier-2), scored by slot-fillability, promoted into `data/templates/` with provenance.

## Phase 7 — Response finishing: the grammar pass (tone of voice dropped for now)

> **STATUS: shipped.** Answers segment into typed spans (prose vs protected); the grammar-rule
> pass runs on prose spans only under a protected-span invariance guard. The a/an article fix is
> active; broader voice/agreement rules are implemented-but-parked.

> Detailed plan: **`archive/PLAN_RESPONSE_FINISHING.md`**.

*(Refined 2026-07-05; decisions settled with the operator. Fact invariance is achieved by
CONSTRUCTION, not by hope. Finishing operates over a SEGMENTED answer, never a raw string.
Tone-of-voice synonym substitution is DROPPED: once every term with technical significance is
protected — entities, paths, vocabulary, receipts, provenance — the substitutable surface is
mostly connectives: high accuracy risk, thin reward. "Keen on the trickery to make a helpful
product, but not at the cost of accuracy." Moved to Phase LATER should a provably-safe subset
ever emerge.)*

- **The segmentation IR (the foundation, lever 1)**: every answer becomes a list of typed spans
  before it becomes text — `prose` vs PROTECTED (`entity`, `path`, `number`, `code`,
  `provenance`, `receipt`). Protected spans are byte-copied through finishing; only prose spans
  are ever touched. The W1 template renderer is already slot-aware (slots ARE the protected
  spans); composed renders adopt segmentation progressively via a conservative masker. Phase 5's
  dual banding reads the same spans.
- **Grammar pass (lever 2)**: a data-driven rule table (TOML, item-7 formats) over prose spans —
  article selection ("a artifact" → "an artifact", an observed defect class), subject–verb
  agreement against slot plurality, capitalization, list/terminal punctuation. Grammar
  corrections IMPROVE accuracy (they fix our own generated defects); that is why they survive
  the tone cut. Neutral behavior is byte-stable except where a rule fixes a genuine defect —
  each rule lands as a bench-measured lever.
- **Memory decision (settled)**: memory stores BOTH — the **as-spoken** turns live as larger
  prose blocks on the graph (the honest record), and the **canonical** form is derived and
  LINKED to its source prose blocks (canonise + link, never replace). Recall and folding read
  canonical; provenance walks back to as-spoken.
- **Verification**: unit invariance checker (protected-span multiset identical pre/post) +
  golden files per rule + the graded bench measuring each grammar rule as a lever.

## Phase 8 — The Repository Interface (seonix inverts to a tmct user)

> **STATUS: shipped.** A versioned (1.0.0), OWL-grounded service contract
> (`docs/repository-interface.md` + `.schema.json`); a typed graph-service with a first-class
> miss contract (a miss is a value, not a throw); fixture + bootstrap reference providers; a
> runnable conformance/compatibility suite; and `tmct init` (scaffold `.tmct/`, `tmct.toml`,
> tier-1 seed, provenance).

> Detailed plan: **`archive/PLAN_REPOSITORY_INTERFACE.md`**.

*(Operator-specified 2026-07-05; upgraded from research item to a build phase. tmct was spun OUT
of seonix; this inverts the relationship: seonix reorients as a USER that imports the tmct
library and exposes its graph to tmct as a typed service. Grows item 14's provider adapter from
a passive payload loader into the product's primary integration surface.)*

**Phase deliverables — define, reference-implement, and test the interface:**
1. **The interface DEFINITION**: the typed, OWL-grounded service contract as a versioned
   document + machine-readable shape (docs/repository-interface.md + a JSON-schema/typedef of
   every service, its arguments, result types, and error contract) — tmct owns and versions it.
2. **A REFERENCE IMPLEMENTATION tmct ships itself**: the in-repo provider (fixture graph +
   bootstrap/empty graph) implementing EVERY service of the interface — the executable
   specification any external producer reads first.
3. **The contract test suite (the compatibility kit)**: a runnable suite any implementation is
   tested against — tmct's reference implementation passes it in `npm test`; seonix runs the
   SAME suite against its native implementation to claim conformance. Conformance = the suite,
   not prose.
4. **The session-handle lifecycle**, implemented: create/dispose context handles (focus, last,
   memory dir, lexicon), provider-owned caching, documented re-entrancy — proven by the
   contract suite's concurrent-session cases.
5. **`tmct init`** shipped as part of this phase (it is the interface's onboarding surface).

- **tmct defines the adapter shape** — not the producer. Rationale: tmct is the brittle side
  (query interpretation), so it must own and optimize around a STABLE interface; because the
  vocabulary is OWL-grounded, the human/code world is already quantized into types both sides
  understand, so the interface is built from those shared types, not ad-hoc JSON.
- **A rich instruction set, translated from what seonix already exposes**: survey seonix's
  native tool surface (describe / members / subclasses / impact / callers / callees / tests-for /
  untested / history / exports / architecture / search / context / snippet / locate / digest —
  the dispatchTool catalog tmct carried at the lift) and translate it into tmct's language as
  the REPOSITORY INTERFACE: a consistent set of typed services any graph producer implements
  natively (seonix first; the empty/bootstrap and fixture providers are degenerate
  implementations tmct ships itself).
- **The flow** (LLM-agent front door): Claude Code et al. is briefed to use seonix → when the
  agent judges it useful, seonix's "ask" tools pass NATURAL LANGUAGE to tmct → seonix calls the
  tmct library in-process with the query PLUS a callbacks object (functions implementing the
  repository interface over its native graph) → tmct resolves the query mechanically, calling
  back into seonix's services for graph truth → results return through seonix to the LLM agent.
  The mechanical interpreter becomes the NL front-end for any agent-facing graph tool; the LLM
  stays outside tmct, exactly as the no-LLM ethos requires.
- **In-process lifecycle research (the hard part)**: seonix calls tmct directly, and the
  interface is wider than the in-house chat — so define explicitly what is HELD IN MEMORY
  between function calls: an explicit session/context handle (focus, last-answer, memory dir,
  loaded lexicon) created and disposed by the caller instead of process-global state; graph
  caching delegated to the provider (tmct never caches provider truth — the known source.mjs
  process-cache staleness in long-lived servers becomes the provider's concern, by contract);
  re-entrancy and concurrent-session guarantees documented per service.
- **seonix chat becomes tmct chat + a pointer**: seonix's chat surface loads tmct's chat with
  the repository-interface handle — one chat implementation, N graph backends.
- **Browser mode**: the same inversion works in seonix's browser/code-browser surface — seonix
  finds its own graph (it already ships one to the page) and embeds an OFF-THE-SHELF tmct: the
  engine core (interpret / ask / render, lexicon, templates) is already pure JS with no
  node-only dependency — wink's eng-lite-web-model is literally the browser build — so the
  repository interface + a browser storage seam for memory (or provider-supplied persistence)
  is all that separates the npm package from running in the page. The fs/readline/child_process
  seams stay node-side; the browser gets the library surface, not the shell.
- **Distribution: `tmct init`** — a CLI command that initializes a local directory for tmct:
  seeds/links the text corpuses (tier-1/2 policy applies), writes the externalized configuration
  (tmct.toml — the seonix.toml pattern), creates `.tmct/`, and records provenance — so a host
  package (seonix) or a bare user gets a working install with one command.

## Phase 9 — Speculative inference: a step toward the Syllogist

> **STATUS: shipped.** `tmct syllogise [--depth n] [--budget n]` — an offline, bounded,
> deterministic maintenance job that forward-chains the `rdfs:subClassOf` closure into low-trust,
> retractable entailed facts; runs once after seeding, never on the chat hot path.

*(Operator-specified 2026-07-05. Tier-5 entailment answers a MISS on demand; this is the step
before it — PROACTIVELY extending memory with inferences that will be useful later, forward and
backward chaining over the OWL base during idle/fold time rather than at query time.)*

> Detailed plan: **`archive/PLAN_SPECULATIVE_INFERENCE.md`**.

**A maintenance job, not a query-time cost.** Speculative inference runs as an explicit
batch — `npx tmct syllogise --depth <N>` (default depth bounded, e.g. 32) — and **once
automatically after seeding** (the W3 bootstrap seed is the natural trigger: a fresh corpus is
exactly when pre-deriving the useful closure pays off). Never on the chat's hot path.

**The selection criterion, sharpened by the operator (2026-07-05):** the guiding question is
*"what do the assertions of the sources I TRUST allow me to infer about this topic that is of
RELEVANCE"* — so **novelty × trust is the primary driver**: the pass walks
outward from high-trust premises (the provenance primitive) toward novel, relevant conclusions,
timestamping each so recency and novelty stay computable. The mechanics are the easy half
(bounded forward chaining materializes entailments; backward chaining from frequent query shapes
pre-derives likely answers). **The residual hard half is still the FRAME PROBLEM / relevance
realization — unsolved in the general case and not pretended otherwise.** This is not one problem
but two, of different hardness (full literature + citations in `PLAN_CAPABILITY_ROUTER.md`'s "The
open-world boundary" section):

- **The frame-*axiom* problem — solved, inside a declared world.** McCarthy & Hayes named it in
  1969 ("Some Philosophical Problems from the Standpoint of Artificial Intelligence", *Machine
  Intelligence* 4); Reiter's 1991 successor-state axioms and Kowalski & Sergot's 1986 event
  calculus (*New Generation Computing* 4(1)) both solve the narrow reading — stating what changes
  without enumerating what doesn't — inside a **declared** effect/predicate model. That's exactly
  the OWL base the Syllogist forward-chains over: the axioms and rules are declared, so applying
  them is mechanical, bounded, and already shipped (`src/syllogise.mjs`).
- **The relevance-*bounding* problem — genuinely open, and possibly not just unbuilt.** Given the
  unbounded set of entailments a rich KB licenses, which ones are worth materializing *before
  anyone asks* — without an oracle telling the pass what matters? That is McCarthy's deeper,
  unsolved reading, and it has no known algorithm. It is also, independently, the central problem
  a live cognitive-science literature has converged on: Vervaeke, Lillicrap & Richards ("Relevance
  Realization and the Emerging Framework in Cognitive Science", *Journal of Logic and Computation*
  22(1):79–99, 2012) frame it as the pervasive problem cognitive science keeps rediscovering: Jaeger,
  Riedl, Djedovic, Vervaeke & Walsh ("Naturalizing relevance realization: why agency and cognition
  are fundamentally not computational", *Frontiers in Psychology*, 2024) go further and argue —
  contestably, but rigorously, not as a popular-science claim — that relevance realization
  *cannot* be an algorithmic process at all, by an analogy to Gödelian incompleteness. Take that as
  a live, unresolved argument, not a proof: the honest position is that tmct doesn't know whether
  this is "hard" or "impossible", and says so.

trust+novelty+relevance (query-shape frequency, recent-focus connectivity, a hard depth/budget
cap) are the **tractable approximation** the plan actually ships — a proxy for relevance, not a
solution to it, and openly so. **A speculative angle, still respecting no-LLM-in-product:** the
same bounded-region trick sketched for the router's open-world goal recognition
(`PLAN_CAPABILITY_ROUTER.md`) applies here. Instead of trying to bound relevance globally (the
open problem above), bound it *per query-shape*: a query shape already declares which
predicates/fluents it touches — it's how `parseQuery` resolves it — so restricting speculative
forward-chaining to premises reachable within N hops of an **observed** query shape's declared
predicates is a *structurally*-bounded relevance filter, not a learned or statistical one. It is
narrower than "what's relevant in general" (that stays open) but might be enough to keep
materialization from drifting into computing entailments nobody will ever ask about — trading
"relevant to anyone" (unsolved) for "relevant to what this system has actually been asked"
(a proxy, but a principled, deterministic one). This has not been built or measured; it is a
candidate for the plan's next spike, not a claimed result. Everything else is deferred to the
plan's open questions, where the relevance problem is named as the open research risk it is.

### Open-source the ACE-OWL parser as a standalone library
> **STATUS: deferred follow-up** — not yet started; still gated on the Phase 8 library-surface
> work settling the extraction boundary. See `PLAN_OSS_ACE_PARSER.md`.

*(Operator-specified 2026-07-05, from the dependency audit's publish-not-replace finding.)* The
pure-JS, ESM, dependency-free ACE-OWL controlled-grammar parser (`src/grammar/ace.mjs` +
`lexicon.mjs`) that turns controlled-English sentences into OWL-labelled triples is a RARE thing:
the reference implementation (APE) is GPL + SWI-Prolog (native), so there is no permissive,
browser-capable, npm-installable ACE→OWL parser in the JS ecosystem. tmct's is exactly that.
Extract it to its own MPL-2.0 package (tmct depends on it back), so the wider RDF/OWL/semantic-web
JS community gains a controlled-natural-language front-end that runs in the browser. Gated on the
Repository Interface library-surface work (Phase 8) settling the extraction boundary; see
`PLAN_OSS_ACE_PARSER.md`. Sibling publish-candidates (the bounded-Damerau fuzzy matcher, the
PageRank+IDF block ranker) may follow the same path if there is demand.

## Phase 10 — Conversational competence & onboarding (0.6.0 → 0.7.0)

*(Operator-directed, from live new-user testing.)* Once a graph is loaded the engine is strong;
the weak surfaces were the FIRST RUN and the VAGUE question. This phase makes the miss graceful,
the empty state honest, and the vague touch a guided answer — realising item 1's "tolerant, guides
you toward precision" promise on the conversational surface.

- **Onboarding UX (shipped 0.6.0):** the grammar wall moved behind `/help` (a short, tailored miss
  instead); intent lanes for memory/teach ("remember that X"), meta/self ("what is this codebase",
  "what do you know"), routed only when a graph query would miss; empty/degenerate-graph
  orientation that distinguishes CODE STRUCTURE (needs a `.tmct/graph.json` via a producer or
  `--repo`; tmct reads graphs, it does not index code) from VOCABULARY (`tmct init`/bootstrap seeds
  concepts); `TMCT_GRAPH_FILE` honoured by chat; slash-optional commands (`stats`≡`/stats`);
  `/memory` explore hooks; up/down-arrow prompt history in the TUI.
- **Knowledge (shipped 0.6.0 → 0.7.0):** the curated `corpus/seon` ontology — a software-sense
  definition for EVERY lexicon term, language-neutral (Java/C#/Python `class` → one concept); the
  ConceptNet slice quality-filtered (word-sense noise cut) and regrown to ~40k facts; tier-2
  specialised corpuses (aws/python/java) with `tmct init --corpus`; batched `appendFacts` (one
  write, 419s→2.5s) enabling **seed-all** so a fresh repo knows the whole curated vocabulary.
- **The concept force (shipped 0.7.0):** a vague touch on a concept X, where tmct knows X and has instances,
  answers in three bands — **the definition** (from `corpus/seon`), **the examples** (real code-graph
  + memory instances of X), and **a soft guided follow-up** ("Want to go deeper?" + 2–3 questions
  built from the real instances × the query shapes valid for that kind, each pre-validated to
  resolve). Applies to NOUN concepts (`what is a class` → define + Base/Widget/Button + drill-ins)
  AND **RELATION concepts** (`what about imports` / `what calls are there` → the verb definition +
  example edges + guided queries), fixing the vague-query dead-ends. Fact rendering is
  de-anthropomorphised (no first-person "i learned:" over-claim — corpus facts read as data +
  provenance; `you told me` stays for operator-asserted facts); listings cap at 32 with a "say
  'more'" pagination that holds the remainder in session state.
- **Dead-end routing + read-only demos (shipped 0.7.0):** natural drill-down phrasings are routed
  onto the canonical shapes they mean — `what functions are in X` → members-of-class, `what defined
  X` → where-is-X-defined, a no-context `what about X` → the concept/relation force (the discourse
  continuation still wins when there IS a prior answer). `tmct chat --ephemeral` (and the
  `npm run example:*` demos) reads a graph but writes nothing back, so a checked-in example is never
  dirtied by a demo run.
- **The dialogue-flow loop (`SKILL_CHAT_PLAYTEST.md`, 0.7.0):** a fast, qualitative tuning loop that
  complements the LLM-judge benchmark — Claude plays a curious user, hunts *dead-ends* (walls,
  "unknown qualifier", phrasing-misses, invited follow-ups the engine can't take), fixes them by
  ROUTING to existing capabilities, replays the same conversations until they flow, freezes them as
  regression transcripts, then ratchets the complexity tier. The drill-down transcript above is its
  first frozen fixture (`test/chatflow-drilldown.test.mjs`).
- **Measured** by the version-matched benchmark (`CHATBENCH_<version>` per `SKILL_TUNING_CYCLE.md`),
  with new graded cells for the miss / empty-graph / concept-touch surfaces so these become
  regression-protected levers, not one-off polish.

## Phase 11 — The capability router & the agentic bench (0.8.0 shipped · 0.8.1 deepened · 0.8.2 feel + rule-general C2)

*(Operator-directed 2026-07-06; built the same day across five concurrent tracks.)* tmct as a **deterministic, no-LLM
tool router** behind an Anthropic-compatible API — the workstream specified in
`PLAN_CAPABILITY_ROUTER.md`, grounded in `docs/references/planning/`. This is a **new capability on a
new axis** (driving a tool loop, not answering a chat turn), so it gets its **own benchmark**:
**`AGENTBENCH`**, a sibling to CHATBENCH — same versioned-naming + grading discipline
(`AGENTBENCH_<version>.md`, `_00N` for re-runs), but the levels are the **A0→C2 agentic rungs** and a
**hallucinated tool call is an automatic fail**.

**Status: DEMONSTRATED (with a stated scope caveat).** The router is built and measured:
`AGENTBENCH_0.8.0_001` = **96% completion at 0% hallucination on every rung**, closed-world ladder
cleared to **C1**. The gate the phase was staked on — a **0% hallucination rate on a real domain** (the
graph-query toolset over the fixture) — **is met.** The honest scope line, held from the start:
AGENTBENCH grades the correct **call-plan + causal-link proof, not the executed composed result**; the
B1/B2/C1 rungs are **thin (2–3 cases)**; and the one C2 case is **refused** (the Stage-5 goal-reasoner
is designed, not built). So "closed-world C1" means *the router provably selects and binds the right
tool sequence*, not *end-to-end multi-step reasoning* — the demonstrated-vs-designed boundary is the
real deliverable. The five tracks below are all built; the two research-agent stages (Track 4 below)
remain designed-not-built by intent.

### Track 1 — chat-surface levers (next CHATBENCH; all three)

> **STATUS (0.8.2):** the surrounding feel surface landed — PLAN_CHAT_FEEL items **1–5, 7, 8**
> (recall hygiene, preamble frames, call-relation self-consistency, author lane, wall kindness,
> teach-lane widening, honest nudges) shipped and gate-verified deterministically. **The trio
> below is DEFERRED post-release with measured targets** (advisor tick-4): pronoun red set = 18
> g-b1-pron ids; temporal = g-b1-temp ×5 + g-c1-temp ×9; discourse-count re-measure first — it
> sampled 0/5 red and is likely already green. See HANDOVER follow-up #3.

The three levers `CHATBENCH_0.7.1` measured + ranked — which **double as router prerequisites** (they
gate the A2→B1→C1 rungs, per Phase B of the router plan):
1. **Pronoun / focus binding** — the "it → Commit" mis-bind (`B1 pron 1.24`); biggest movable mass.
2. **Discourse-count anaphora** — "count them / how many of those" over a prior listing (clears the 2
   `CHATBENCH_0.7.1` tier-1 misses).
3. **C1 temporal-over-relative composition** — the two-hop ceiling (`C1 temp 0.31`).
Land all three (not just #1); they raise the chat floor *and* the router's floor at once.

### Track 2 — the router build (the within-horizon slice, in order)

> **STATUS (0.8.2):** the C1 composition gap closed — the **member-filter HTN method + per-member
> callees hop** flips the standing C1 red in both drivers (resolver floor A0–C1 all 100/100); the
> ladder grew 43→56 fixture-linted cases; the bench-import smell is inverted
> (`src/router/call-validator.mjs` + `set-algebra.mjs`).

Buildable now with a frontier model as co-author (see PLAN §"solved vs unsolved"):
- **Phase A — the shim.** An Anthropic Messages API endpoint (`/v1/messages`, `tool_use`/`tool_result`
  blocks). **Extended:** also present as a **`bedrock-meter`-compatible routing target** (see below).
- **Phase B — measure today → `AGENTBENCH_0.7.2.md`.** Shim + a small graph-query toolset up the
  A0→C2 ladder; the honest baseline (expected A0 solid, A1–A2 partial, per the CHATBENCH_0.7.1
  inherited assets).
- **Phase C — the grading ladder.** The AGENTBENCH benchmark itself (rungs as levels, comparable
  local/hosted models as reference bands, zero-hallucination gate).
- **Stage 0 — capability registry** (`Capability`/`Parameter`/`Precondition`/`Effect` = STRIPS/PDDL
  operators as facts).
- **Stage 1 — the resolver** (unification + backward chaining / a mini Datalog).
- **Stage 4 — the guardrail** (validate an LLM's proposed `tool_use` against declared preconditions —
  the hybrid fast-path; cheap once 0–1 exist).
- **Stage 3 — the planner** (POP/HTN over operators + Steel & Ho monitor-and-replan → **closed-world
  C1**; optionally defer search to an external PDDL solver).

### Phase A extension — the `bedrock-meter` deployment surface
`../bedrock-meter` is pre-flight Bedrock cost metering + capping, with a **roadmap optimiser** that
"cheaply assesses a task's complexity … and routes to the lowest-cost capable model" (it already
meters Nova Lite + Nova Micro). tmct — **benchmarked against agent capabilities by AGENTBENCH** — slots
in as the **$0 floor *below* Nova-micro** in that routing ladder: for a request class AGENTBENCH proves
in-envelope, the optimiser routes to tmct (deterministic, ~$0, ms latency) instead of any metered
model. So Phase A's shim is built **bedrock-meter-pluggable**, and AGENTBENCH is what defines the
envelope the optimiser is allowed to trust. This is the concrete "near-free alternative" deployment.

### Track 3 — playtest alongside the build (`git worktree`)
Run `SKILL_CHAT_PLAYTEST.md` **in a parallel `git worktree`** while the router is built — the
dialogue-flow dead-end hunt keeps running without blocking the build, and its fixes **merge back**.
(The worktree is auto-cleaned if unchanged; merge the frozen `test/chatflow-*` transcripts in.)

### Track 4 — research agents (the "at the edge" stages)
Two stages need design judgment + exploration, so they run as **background research agents**, off the
critical build path:
- **Stage 2 — intent frames, controlled fragment** — imperative NL → structured intent for the
  controlled command language (the front-end; the general case stays out-of-scope / escalate).
- **Stage 5 — goal-reasoner, closed-world C2** — BDI + Goal-Driven Autonomy: deduce-goals (long-chain
  deduction) → plan-each (C1) → threat-aware, *persistent* first-step arbitration.

> **STATUS (0.8.2):** both research stages are now BUILT and measured. Stage 2 landed in 0.8.1_002;
> Stage 5's 0.8.1 "one thin rule" caveat is retired — **C2 is rule-general**: two declared
> goal-rules (`coverage-invariant`, `cochange-risk-invariant`) selected by pure `applicableRules`
> deduction with honest refusals at both failure modes (0 applicable = open-world, >1 = ambiguous),
> zero request keywords. Goal driver: 100% plan / 98% result / 0% hallucination over 56 cases.

## Phase LATER — recognized, deferred, not now

Features we have deliberately shaped seams for but will not build until the phases above have
earned them. **Not everything below is deferred for the same reason** — the design horizon,
stated explicitly (2026-07-08 research pass):

### Future direction: a genuine planning/agentic loop (flagged 2026-07-09, research pass done, not implemented)

The operator's own framing, explicitly out of scope for the routing-level `GOAL_BY_COMMAND`/
Goal-inference generalization this session shipped (HANDOVER's Bug F point 5, which only labels
an already-computed answer's intent — it never plans ahead of one): infer the goal, read the
relevant subgraph, reason about candidate action-paths and their effects, pick the next step,
execute, repeat.

Two companion research docs (2026-07-09, design only, zero code shipped) scope this against
minimal benchmark domains before anything domain-general is attempted:
- `PLAN_HANOI.md` — the OPEN-LOOP case (a whole solution path is computable up front from the
  start state). Recommends representing state as taught facts in the memory store (not the
  read-only, provider-owned code graph), a new `restsOn` edge encoding stack order, and genuine
  bounded state-space search — reusing `syllogise.mjs`'s `findIsaChain` (already, in shape, a
  bounded rooted BFS path search) — over hard-coding Hanoi's known closed-form recursive solution,
  so the result is an actual generalizable planner, not a Hanoi-shaped trick.
- `PLAN_GUESS_NUMBER.md` — the CLOSED-LOOP case ("I am thinking of a number," both as guesser —
  belief-interval bisection over repeated higher/lower observations — and as thinker — tmct holds
  a secret and gives honest feedback, no search needed). Recommends a new parallel session-state
  slot (`game`) threaded through `createSession`/`runTurn` exactly the way `focus` already is,
  kept deliberately separate from the `pending` pagination field since a game must survive an
  aside mid-play, unlike a listing remainder.
- `PLAN_TAUGHT_RELATIONS.md` — teaching tmct brand-new relations and rules through ordinary chat
  (a taught Prolog-style family tree, none of the kinship vocabulary hardcoded), the first of the
  three to need a successor function SYNTHESIZED from data the user taught in an earlier turn,
  rather than hand-written per domain the way Hanoi's `legalMoves` and guess-number's
  interval-update rule are. Its own enumeration capability ("list the descendants of X," no fixed
  goal) needs a genuine new sibling kernel, `findReachableSet`, since `findActionPath` only ever
  searches toward one goal.

All three docs converged on the one genuinely new primitive none of them found already built
anywhere in tmct: something that computes a SUCCESSOR STATE (apply a chosen action, produce the
next graph/belief to reason over) — every existing traversal (`ancestorsOf`, `computeFind`,
`findIsaChain` itself) is read-only. That primitive now exists (`findActionPath`, `src/planning.mjs`,
shipped this session — see "Shipped this session" above), proven against a small toy graph but not
wired into any of the three domains yet. The remaining next-session scope is that wiring, plus a
still-open recognition question: how tmct notices "the user wants goal-directed action" at all, and
whether multi-step execution needs confirmation before running.

### The design horizon

**Before the horizon — known-how, not-yet-built, no research risk.** Sequencing or engineering
debt: the technique exists (in tmct's own prior work or the wider literature), building it is a
matter of scheduling and effort, not discovery. Everything shipped this session lives here, plus:
tone-of-voice adaptation (below — deliberately dropped by design choice, not unsolved);
tier-4 learn-on-miss (below — prerequisites not yet met, not research-blocked); `PLAN_CODE.md`
Tracks 2–4 (mutation search/repair, JS/HTML/CSS synthesis — APR and CEGIS are established
techniques); `PLAN_OSS_ACE_PARSER.md` (pure extraction/packaging); OWL 2 RL forward-chaining and
DL tableau consistency checking (`PLAN_INFERENCE_TESTING.md` stages 3–5 — the W3C's own OWL 2 RL
profile is a published, complete rule table; Pellet/HermiT/RDFox/Jena are real production
reasoners built on solved theory); RETE/incremental forward-chaining (same doc — Forgy 1982 is a
citable, portable algorithm); contingent/conformant planning under initial-state uncertainty
(`PLAN_CAPABILITY_ROUTER.md` — Bonet & Geffner 2000, Hoffmann & Brafman 2006, Petrick & Bacchus
2002 all have working algorithms); ordinary closed-domain anaphora resolution (`nextFocus`,
already shipped, plus a real theoretical grounding available in Grosz/Joshi/Weinstein's centering
theory, 1995).

**After the horizon — genuinely unsolved in the field, or abandoned by the field in favor of
approaches tmct's no-LLM ethos rules out.** Named as real research targets, with citations, not
stop signs (full detail + full citation lists in each owning doc):
- **The frame problem / relevance realization** — the open-world planning boundary
  (`PLAN_CAPABILITY_ROUTER.md`'s "The open-world boundary" section; this doc's tier-5 Syllogist
  paragraph below). McCarthy & Hayes 1969 named it; Jaeger, Riedl, Djedovic, Vervaeke & Walsh
  (2024) argue it may not be algorithmically solvable in the general case at all. Speculative
  angle recorded: bounded (N+1) goal recognition — recognize declared goal 1..N, or reject to an
  explicit "escalate" class, via parse-shape membership (the same mechanism Bug 8's domain gate
  already uses) — not published anywhere found.
- **Symbolic (non-neural) dependency parsing at real coverage** — `PLAN_ADVANCED_GRAMMAR.md`
  track (c). Largely abandoned by mainstream NLP research once neural parsers won CoNLL
  2017/2018, not disproven at any fixed data budget. Speculative angle: a hand-built,
  closed-vocabulary disjunct/category dictionary (Link Grammar/CCG-style) scoped only to tmct's
  own closed relation vocabulary, registered as another additive interpretation strategy.
- **Winograd-hard commonsense coreference** — `PLAN_ADVANCED_GRAMMAR.md` track (g). Genuinely
  open without either massive statistical priors (ruled out) or a full commonsense KB (Cyc's
  decades-long cautionary history). Speculative angle: tmct's own closed, complete graph makes a
  *narrow slice* of Winograd-shaped ambiguity a graph-query-filtering problem rather than
  open-domain commonsense reasoning — explicitly not the same as solving Winograd.
- **Bounded, incremental, trust-tiered, retraction-safe justification tracking** —
  `PLAN_INFERENCE_TESTING.md`'s stage-3/4/5 discussion. Doyle's JTMS (1979) and de Kleer's ATMS
  (1986) solve retraction; DRed/RDFox's Backward-Forward solve incremental Datalog maintenance;
  nobody has published the specific combination with tmct's multi-trust-tier, hard-budget
  requirement. Speculative angle: an ATMS-lite extension to `syllogise.mjs`'s currently-flat
  provenance tag, sketched but unbuilt.
- **A shared ~2M-word cross-domain ontology (1M general-English base + 1M
  technical/scientific/engineering/programming-language/slang)** — `PLAN_ontology-hierarchies.md`
  §7, additive to (not a revision of) that doc's existing track (e), which stays about importing
  raw WordNet into tmct's own small tier-1 corpus specifically. Walked into, not avoided: merging
  two 1M-word vocabularies collides senses of lexically-shared words (`class`, `cache`, `thread`,
  `wave`, `cell`, `field`, `state`, …) across general/CS/physics/biology/slang registers —
  knowledge-based (non-neural) WSD is real but measurably weaker than supervised/neural WSD (Lesk
  1986; Raganato, Camacho-Collados & Navigli, EACL 2017), and BabelNet (Navigli & Ponzetto,
  *Artificial Intelligence* 193, 2012) proves automatic cross-resource sense merging at this scale
  is achievable — but its own pipeline moved toward statistical/graph-ML methods as it scaled,
  solves the cross-*lingual* not cross-*domain* axis, and carries a non-commercial licence, so it
  is a precedent, not a usable vehicle. Speculative angle recorded: mutual disambiguation from
  already-resolved neighbouring terms in tmct's own closed graph (a structurally-bounded,
  deterministic reading of Gale/Church/Yarowsky's "one sense per discourse/collocation"
  regularities) — not published anywhere found for this application.

Every item above is honestly labeled speculative — a direction recorded so it isn't
re-discovered from scratch, not a committed build plan. None of it is scheduled; the phases above
this line are still the actual near-term work.

### Tone-of-voice adaptation (dropped from Phase 6, 2026-07-05)
Per-voice synonym/phrase substitution over prose spans. Dropped because tmct's protected-span
analysis leaves too little safely-substitutable text: any term with technical significance is
untouchable, and accuracy outranks helpfulness trickery. Revisit only if a provably-safe
substitutable subset emerges (e.g. connective-only voice profiles, or per-voice template
overrides authored as whole alternatives rather than substitutions). The grammar-preference
half of the idea survives inside Phase 6's rule table.

### Tier-4 corpus: learn-on-miss acquisition
The strongest miss signal tmct can emit is: *lexicon term recognized, query built cleanly,
zero matches anywhere* — the question was well-formed and the knowledge is simply absent. The
tier-4 loop answers it by learning: web search on the resolved term → clean the fetched text
into tmct's own dialect (normalize into the ACE-OWL controlled grammar; whatever survives the
grammar becomes Facts, whatever doesn't becomes tier-2 text blocks under the PageRank index) →
store on disk with source provenance → ingest → answer the original question from the newly
learned material, citing what was just learned and from where. Strictly opt-in, network tier
rules apply (offline default inviolable; failure degrades to the honest miss). Prerequisites:
W1-W5 wired and measured, the Phase-5 template/dialect cleaning machinery (the "clean dialect"
IS the acquisition format), and a provenance-trust policy for web-sourced facts (never blended
silently with graph/operator facts — the `via`/provenance discipline extends to "learned:web").

### Tier-5: entailment-on-miss — "the Syllogist" (deductive inference over the OWL base)
*(Item 11 matured from exploratory sketch to a designed tier; the "theorem-prove against
parsed prose" thread of the original code-talker ideas.)*

**The concept, classically:** answering from the **deductive closure** of a knowledge base —
KB ⊨ φ ("the knowledge base *entails* φ") — content that is nowhere ASSERTED in the graph,
memory, or corpus, but is a logical CONSEQUENCE of what is. Deductive inference (modus ponens,
modus tollens, syllogistic chains) predates ELIZA by ~2,300 years (Aristotle's syllogisms →
Frege's predicate logic → Robinson's resolution principle 1965 → Kowalski's "logic as a
programming language" → Prolog's SLD resolution; on the rules side, forward-chaining production
systems and the Rete algorithm; on the OWL side, description-logic reasoners and the RDFS/OWL
entailment regimes). tmct's version: a well-formed query misses everywhere → run the inference
layer over the OWL-encoded facts + axioms → if the answer is ENTAILED, materialize it as a Fact
with `via:"entailed"` and a **proof-chain provenance** (the applied rules + premise facts,
renderable as a chain of thought in words: "every cache is a store; every store is a component;
so a cache is a component") → the same query now yields an answer that shows its derivation.

**Worked shape (modus tollens over the code graph):** axiom "every tested module is covered by
a suite"; fact "m.mjs is covered by no suite" ⊨ "m.mjs is not tested" — never asserted,
honestly derived, provenance = the two premises + the rule name.

**Engine choice (the Prolog / graph-query question):** the classical candidates are embedded
Prolog (SLD, backward-chaining, item 11's original sketch), a graph query syntax (SPARQL under
entailment regimes / datalog / openCypher), or a description-logic tableau reasoner. The
recommended target is **OWL 2 RL** — the profile DESIGNED to be implemented as forward-chaining
rules (datalog-style semi-naive materialization, polynomial, decidable): pure-JS implementable,
mechanical, explainable rule-by-rule — exactly in ethos. Prolog-style backward chaining stays
the fallback for query-time-only derivation if materialization proves too eager. Progol/ILP
(learning NEW rules from examples) remains a separate, further-out spike.

**Gates:** the full-domain lexicon + OWL encoding in a queriable structure (Phases 2+4+5 and
tier-4's acquisition feed it), the provenance-trust policy (entailed facts must never silently
mix with asserted ones — a wrong axiom poisons the closure, so entailments are retractable by
provenance), and bench cells that measure inference specifically (premises in, conclusion
asked, derivation shown).

## Explicitly out of scope (for now)

- No AWS, no benchmark rig — tmct is a published npm library + CLI with a
  static GitLab Pages home page only.
- No auto-publish: releasing a version is gated on a deliberate version-bump
  commit plus a configured `NPM_TOKEN` in CI.
- No MCP server, no LLM in the product path — permanently out of scope, not
  just "for now".
