# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`**: read its
**"Where we are now"** block first; this file is the commit-level detail behind it.
Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic` — see
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live).

## Where we are (2026-07-09)

`npm test` green (**1299**, up from 1258 at the start of this dispatch — see "Operator-found bugs
A-F" and items 3/4/5/6 in "Open follow-ups" below for this session's own continuation). **v1.0.7,
pushed** (0.9.11 → 0.9.12 → 1.0.0 → 1.0.7 across this session). Prior session's detailed handover
(0.9.5 era — the playtest sprint, Bug 6/7/8, the predicate-find feature, infbench stages 0-2) is
superseded by everything below; its content still lives in git history of this file if needed.

*Later addendum (same 2026-07-09, a separate follow-on dispatch): Tier 5 of the dialogue-flow
playtest loop (deferred above) ran to completion — 5 cycles, `npm test` now **1328** passing. Not
pushed; version still 1.0.9 locally, unchanged. See "The dialogue-flow playtest loop" section's
Tier 5 entry and "Open follow-ups" item 1, both updated in place below.*

### The trigger and the fix: 0.9.12 → 1.0.0

Operator ran a real `npm install` + bare `tmct chat` in a fresh directory and got an apology for
every input, including plain greetings — "Hi. There's no code graph loaded here..." even for
`hello`/`what are you`, despite the seeded ontology/lexicon already being able to answer general
questions correctly. Root cause: a 0.6.0-era onboarding design (`ROADMAP.md` Phase 10) that
over-applied its own honest empty-graph orientation to conversational turns that were never
structural queries at all.

Fixed (commit `6542621`, then `7cbcf76`, `ecf0ad5`): identity/capability-led responses (lead with
"I'm tmct — ..." and a working capability, caveat second, never first), a real self-description
distinct from the capability blurb, a dedicated "no LLM involved" answer for the identity/AI-ID
family, and — the subtler bug — **provably-correct "try this" examples**. All five surfaces that
suggested `try "what is a cache"` did so unconditionally, even under `TMCT_NO_SEED=1` where that
exact query would fail; `vocabExampleHint()`/`hasSeededVocabulary()` now compute, once per
session, whether the vocabulary seed actually ran, and only ever offer an example proven to
resolve in that session's real state. Also broadened conversational recognition substantially
(dialect/register/slang/elongation via expanded closed sets, plus a new bounded-fuzzy-match typo
layer reusing `interpret/fuzzy.mjs`'s existing edit-distance primitives) — all additive to the
existing closed-set architecture, no generalized grammar rule, per this project's standing
preference for templates/pattern-matching over general rules where the fix allows it.

### The dialogue-flow playtest loop (`SKILL_CHAT_PLAYTEST.md`), run across 5 tiers

- **Tier 0 (bootstrap/identity)** — 1 pass, clean. Commit `7cbcf76`: ESL word-order identity
  phrasing, a "try this" example that itself failed when tried (fixed alongside the vocab-hint
  work above).
- **Tier 1 (single touch + one drill-down)** — 1 pass, clean, run explicitly late in the session
  after being accidentally skipped earlier. 5 dead-ends: "does X `<verb>` anything else" grammar-
  strategy mismatch, a leading staccato connective breaking parse, "that class"/"this module"
  anaphora ties, "what else is in X" falling to a bare wall instead of an honest empty, and a
  genuinely missing capability — single-entity qualifier checks ("is Task.title public") had no
  recognizer at all. Commits `379d984`, `07879fb`, `cdafeb0`, `6fd5ae5`, `aa676af`.
- **Tier 2 (drill-down chains with anaphora)** — 1 pass, clean. Commit `70d9b24`: where-defined
  typo tolerance, an explain-wrapper unwind frame, describe+anaphora dead-ends ("describe X" →
  "what about it" → "describe that" needed a 3-part fix across `isConversational`, the describe-
  rescue lane, and `asBareCommand`'s pronoun handling).
- **Tier 3 (cross-concept & relation touches) — 7 passes**, the deep one. Cycles 3-9
  (`ef319f6`, `018cb34`+`80c075c`, `5cbbffa`, `dddcc4e`, `199fda5`, a 12-commit cycle 8 ending
  `66b82e0`, then `4f97429`+`124df15`) progressively found and patched a **recurring
  `resolveObject` substring-match weakness**: a missing minimum-length floor let short staccato
  connectives ("and", "it") silently hijack the conversation's FOCUS via accidental substring
  matches against real entity labels — producing confidently WRONG answers on a *later* turn
  while the turn that caused it still looked honest. Patched three times point-by-point
  (cochange routing, connective leakage, bare-pronoun-no-focus) before cycle 9 found the actual
  root cause (`resolveObject`'s tier-3 containment check had no length floor, unlike tier 5's
  established `length >= 4` fuzzy floor) and fixed it once, at the source. Cycle 9 also fixed a
  related-but-distinct component-overlap bug (a nonexistent slashed path resolving to a real
  module by sharing generic path components) and a Goal-inference gap on relation-force answers.
- **Tier 4 (compositional & comparative)** — 1 pass, clean, including a diagnosed-in-advance
  fix: the boolean-AND compositional fold couldn't handle a bare "and are `<qualifier>`" branch
  (`"which functions call X and are untested"` mis-parsed as a garbled ambiguous-match). Fixed
  narrowly (`610915a`) — widening the marker gate to accept ANY boolean connective would have
  broken an intentional compat-guard test pinning a genuinely ambiguous two-different-verbs case
  as still-ambiguous, so the fix gates on the qualifier-only-branch shape specifically, reusing
  the existing `splitBoolean`/`buildPredicateAtoms` fold machinery unchanged. The playtest pass
  itself (commits `0140680`, `0d2a22a`, `4a8b39c`) then closed the sibling gap the diagnosis had
  deliberately left open ("call X and call Y" without "that"), plus a superlative fix (metric
  word leading "the most" instead of following it) and entity-kind receipts on empty
  qualifier/anaphora results.
- **Tier 5 (teach + recall + reasoning in dialogue) — DONE, 5 cycles (the cap), genuinely clean at
  the end.** A dedicated dispatch, separate from the session above (commits `fc48e18`, `a3231f5`,
  `c5d1ddc`, `d485020`, `09d4e7a`). Ran the full 5-cycle cap (each cycle found real fixable
  dead-ends, so it never hit the "two clean cycles in a row" early-stop) — 12 routing/recognition
  fixes plus one genuinely important correctness bug, all in `src/chat.mjs` (+ one line in
  `src/memory/core.mjs`):
    - **Cycle 1** (6 fixes): `normFactTerm` never stripped a leading "the"/"a"/"an", so EVERY
      recall regex in the file (which all call `factTermVariants` → `normFactTerm` with no strip
      of their own) missed a just-taught multi-word-subject fact the moment a query used an
      article or shortened the subject to its head word — fixed once, centrally, plus a head-word
      overlap fallback in `factAnswer`'s "what do you know about X". A frequency ADVERB between a
      bare-name subject and the real verb (the operator's own example, "TaskController usually
      needs review") mis-split the adverb AS the verb, garbling the confirmation into "usuallies";
      fixed with a closed adverb-skip reused by the teach shape and its query-side twins.
      `OWNS_TEACH_RE`'s object widened from single-token to a short noun phrase ("margo maintains
      the tasks handler" used to WALL entirely); added `OWNS_YESNO_RE` for the missing yes/no
      ownership claim form. Added `IS_ADJECTIVE_YESNO_RE` (a taught property fact like "X is
      deprecated" had NO direct-question reader at all), with anaphora against the live focus and
      a "known-subject-wrong-property" honest receipt. A genuinely-unknown-everywhere "what is X"
      miss now gets a TEACH-OFFER appended (verified in-state per the skill's own rule — required
      widening `UNKNOWN_SUBJECT_RE` to 2 tokens too, since the first offered example failed).
    - **Cycle 2** (3 fixes): passive ownership ("`<X>` is owned by `<Name>`") had zero recognizer,
      teach or read, even though it's at least as natural as the active form cycle 1 fixed; added
      `OWNS_PASSIVE_TEACH_RE`/`OWNS_PASSIVE_YESNO_RE`. A quantified PROPERTY claim ("some functions
      are risky") silently mis-taught the literal string "some functions" as a bogus subject
      (SOME_A_FEW_RE's own subclass-only gate correctly declined, but a later vocabulary-blind
      frame caught it anyway) — now declines honestly. A genuinely first-ever "is X `<adjective>`"
      question (zero facts in memory at all) fell to the raw wall because `factReadBack`'s
      `!rows.length` fast path bailed out before the cycle-1 teach-offer code ever ran — special-
      cased narrowly (found + fixed two real regressions on the first attempt, "is a zebra a
      mammal"/"is there anything bigger", both caught by the full suite before shipping).
    - **Cycle 3** (2 fixes): a quantified subject + non-copula verb ("remember that every
      controller needs review") fit no recognizer at all, so `teachLane` returned null silently
      and the sentence fell through to the raw structural wall — now always gives an honest
      decline once "remember/note/…" wrapped it. "what do you know about X" (genuinely unknown)
      gained the same TEACH-OFFER treatment as "what is X" (shared wording via a new
      `unknownVocabTermOffer()` helper); `TEACH_PROPERTY_RE` widened to accept past-tense
      "was"/"were" too. Two genuine ceilings named, not forced: negated property assertions ("X
      is NOT deprecated") have no supported shape anywhere in tmct's grammar; a bare class-
      inheritance existence check against the GRAPH ("is TaskController a Controller") has no
      structural reader — real, but Tier-3/4 territory.
    - **Cycle 4** (1 fix): a leading hedge adverb ("actually"/"really"/"honestly") put a sentence
      one word out of alignment with the session's own three new yes/no openers — fixed narrowly
      (`qHedge`, scoped to just those three regexes). One more genuine ceiling: a general-verb
      teach with a multi-word subject only gets a generic decline — a widening attempt was tried
      and reverted (the laziness cycle 1's adverb-skip needs directly conflicts with the
      greediness a multi-word subject needs; a positional regex can't satisfy both).
    - **Cycle 5** (1 fix, the important one — a FABRICATION, not a dead-end): "is the validate
      module deprecated" answered a confident "yes — you told me: logger module is deprecated" —
      the WRONG fact, off the shared generic word "module" alone (cycle 1's head-word overlap
      fallback used a bare length-floor with no exclusion for common code-noun suffixes). Fixed
      with a `GENERIC_ENTITY_WORDS` stopset (module/class/function/handler/controller/…), the same
      principle `RECALL_STOPWORDS` already applies to path-noise tokens. Found via a deliberately
      adversarial two-different-subjects-sharing-a-generic-head-word conversation the earlier
      cycles' single-subject conversations never exercised — a reminder that this class of bug
      (accidental substring/word overlap hijacking a DIFFERENT entity's fact) is a recurring risk
      whenever a fallback loosens exact-matching, echoing Tier 3's own `resolveObject` history
      above.
  `test/chatflow-tier5.test.mjs` (new, 21 cases) freezes every fixed conversation. `npm test`:
  1328 passing (from the 1307 baseline at dispatch start), 0 failing.
- **Tier 6 (the messy real user) — not yet run.** Next session's starting point for the playtest
  loop, now that Tier 5 is confirmed clean.

Two real process incidents fed back into `SKILL_CHAT_PLAYTEST.md` itself: a cycle's cleanup step
ran `rm -rf /tmp/pt-*` (a wildcard glob in *shared* `/tmp`, flagged by the harness's own safety
policy — no actual damage, since no other agent's scratch dir happened to collide that time, but
a real cross-agent risk) — the skill doc now mandates `mktemp -d` + exact-path cleanup, never a
wildcard. And the original "never `chat --repo` the committed example fixture directly" rule
(added mid-session after several cycles independently dirtied `examples/mini-webapp/.tmct/` with
stray session/provenance writes) is now enforced from Step 1 of the loop, not just its frozen
regression tests.

### A live, client-side chat demo on the GitLab Pages homepage

Not a scripted/pre-recorded fake. The real `src/ask.mjs` query engine (confirmed via a full
transitive-import-graph audit to be already browser-clean pure JS, zero Node-only runtime API
usage) runs directly in the visitor's browser. wink-nlp/wink-eng-lite-web-model load from
`esm.sh` (both are pure CJS with only relative `require()`s — no vendoring needed, matching the
operator's own "pull it from npm" instinct). Three leaf files' unconditional Node-only static
`import`s (`wink-model.mjs`, `grammar/lexicon.mjs`, `embed.mjs`) were the only blocker, closed
with an import-map shim (new tiny stub modules for `node:fs`/`node:path`/`node:url`/`node:module`
— one of them, `node-fs.mjs`, turned out to need to be genuinely functional rather than a pure
throwing stub, since live instrumentation proved `parseAce`'s default-param lexicon load fires on
every `ask()` call after all, contradicting the initial research's premise; the shim now
`fetch()`es the real committed `lexicon-core.json`). A minimal CI copy-step (`.gitlab-ci.yml`'s
`pages` job, plain `cp`, no bundler/transpiler) keeps `src/` the single source of truth for the
copied engine files.

The page (trimmed to just title/lede/quickstart plus the demo, per operator instruction) boots
with a real banner, replays a few pre-verified real Q&A turns as "history," then asks one
randomized (10 templates × real-entity substitutions, every combination verified non-miss against
the real engine before shipping) or `?q=`-primed question live. `?compact=1` gives a minimal
primed-link view. `window.tmctAnswer`/`tmctAsk`/`tmctParseEntities` are exposed for headless/
Playwright consumers — plain `curl`/`jq` can never see a computed answer (no backend on GitLab
Pages, JS never executes for a non-browser HTTP client), documented plainly in the code rather
than oversold. As of the session's last addition, the widget also has a genuine interactive text
input so a visitor can type their own questions after the scripted intro finishes and get real
computed answers — verified with a real headless-Chromium Playwright run typing two brand-new
questions not in the history or template set.

(Investigated but not adopted: sibling project seonix's own in-browser demo mechanism — an
esbuild bundle + a `node:*`-stub build plugin, with wink-nlp dropped from the browser entirely
after two generations of trying to make it work. Useful as a documented fallback path if the
esm.sh CDN load ever proves unreliable, but the CDN approach worked cleanly on the first attempt
here.)

### Operator-found bugs, fixed as found by hand-testing the shipped CLI

- **Relation-specific vocabulary filtering** (`c5a0a64`). "what is a tree used for" was dumping
  every known ConceptNet relation about "tree" (IsA, UsedFor, CapableOf, ...) instead of
  filtering to just UsedFor — a structural gap affecting every relation phrasing, not just this
  one; fixed with a `TRAILING_PREDICATE_MARKERS` recognizer reusing `FACT_PREDICATE_PHRASES`'s
  existing predicate-phrase table.
- **Teach-lane suggestion echo + honest unknown-word miss** (`75011a9`). `teachSuggestion`
  hardcoded the object's article as "a" regardless of vowel sound; combined with `finish.mjs`'s
  legitimate generic article-repair pass running AFTER the suggestion's equality check, this
  could show a "did you mean: X?" suggestion byte-identical to what the user just typed. Fixed by
  giving the suggestion real a/an agreement. Also made the miss message name the specific
  unrecognized word(s) instead of a generic "I couldn't store that."
- **Out-of-domain small talk** (`a0f7298`). "what time is it" hit the raw structural-query wall;
  now an honest capability nudge, matching this codebase's existing decline-lane pattern.
- **Teach-lane pronoun-subject guard** (`fc58c19`). "remember you are a womble" produced a
  nonsensical "did you mean: every you is a womble?" suggestion — worse, a pronoun subject paired
  with a KNOWN object (e.g. "he is a module") would have been silently stored as a bogus fact.
  Closed with a dedicated pronoun-subject decline, checked before any write path.
- **Existence-question correctness** (`d1491e6`, Seonix Batch 1). "is there a class called Store
  anywhere" was silently answering a DIFFERENT question (a relationship check — "which classes
  call Store") and rendering it as if it were a verified existence negative, even though Store
  genuinely exists. A new closed-set existence recognizer intercepts before the relationship
  parsers can misclaim it; scoped module-existence ("is there a class in `<module>`") fixed
  alongside.
- **"What else is X" repeated the primary definition verbatim** instead of surfacing additional
  facts; **bare "what is X" (no article) had no fact-lookup route at all**, including for a fact
  the user had *just* taught (`"john is a function"` → `"what is john"` → the generic capability
  card, as if "john" had never been taught); **general verb-to-predicate teaching** didn't exist
  ("remember margo eats ribs" fell through to the structural code-graph grammar with a confusing
  wrong-context miss). All three fixed together (`6a07214`) since they share `chat.mjs`'s
  vocabulary/teach/fact-retrieval layer: a `whatElseAnswer` lane recognized off the raw query
  before the relaxation cascade could drop "else" as noise; a `BARE_WHATIS_RE` + a `bareMetaHit`
  pre-check that only diverts from the conversational card when a real fact resolves; and a
  general verb-to-predicate mechanism (`GENERAL_VERB_TEACH_RE`) that mints `mgx:<verb-lemma>` for
  novel verbs and maps "has"/"have" onto the existing `mgx:hasA` predicate for interop with
  ConceptNet-sourced data. (Operator note on scope: this last one was initially miscategorized by
  the coordinator as out-of-bounds "general-rule" territory per the project's template-preference
  guidance — corrected on operator instruction: the teach lane's *recognition* stays closed/gated,
  only the *predicate minted from a recognized verb* generalizes, which doesn't carry the same
  false-positive risk the template-preference guidance exists to prevent.)

### Operator-found bugs A-F (2026-07-09, manual chat-testing this session)

Six more bugs found by the operator hand-testing the shipped CLI live, on top of Batch 3 and
item 5 above (same dispatch, landed as separate commits per group):

- **Bug A** — "remember X had soup" taught the malformed "x haves soup". `generalVerbPredicate`
  only special-cased the raw strings "has"/"have", so past-tense "had" (lemma "have") fell
  through to the generic `mgx:<lemma>` mint, and `predicatePhrase`'s naive third-person-singular
  fallback appended "s" to the unrecognized lemma ending. Fixed by checking the LEMMA (not just
  the raw verb) for "have" in `generalVerbPredicate`, plus a safety-net irregular case in
  `thirdPersonSingularSurface` itself.
- **Bug B** — past tense in the new general-verb query recognizers (item 5, above) — covered by
  that same fix ("did" joins "does" in both `GENERAL_VERB_YESNO_RE`/`GENERAL_VERB_OPEN_RE`).
- **Bug C** — "count soup" with no code graph loaded rendered the grammatically-broken "I count:
  ." (a dangling empty list) and then suggested "how many classes are there", which would ALSO
  fail. `answerCount` now special-cases `countableKinds(graph)` being empty with an honest
  message pointing at `--repo`/`example:mini`.
- **Bug D** — "what is in your memory" (bare) fell to the structural code-graph miss ("no module
  matching 'your memory'"). `WHAT_KNOW_RE` widened to accept it (and "what's"/"whats in your
  memory") as a synonym of bare "what do you know" — deliberately NOT "what do you remember",
  which is already `WHOLE_RECALL_RE`'s own, more specific (fact-listing) territory.
- **Bug E** — "what is in your memory about X" phrasing gap + a subtype walk (operator follow-up
  request): `KNOW_ABOUT_RE` widened to accept "what is/what's in your memory about X"/"what do
  you remember about X"; the handler now also walks TRANSITIVE SUBTYPES of X (a cycle-safe BFS
  over TAUGHT isa-family facts only, capped at 8 hops — corpus/web-provenance isa rows are
  excluded from the walk itself, found live to otherwise flood almost any term into hundreds of
  coincidental "subtypes"), so "what do you know about component" surfaces a fact about "button"
  once "every widget is a component" + "button is a widget" are both taught, even though "button"
  never literally mentions "component". A subtype-derived hit gets a distinguishing "(including
  its known subtypes)" header suffix.
- **Bug F** — closed-set indirect-request wrapper stripping, five sub-points: "I want you to
  remember X"/"I'd like you to remember X" teaches like bare "remember X" (`TEACH_RE` widened);
  "search for X" (bare) strips the leading "for" filler before it becomes the search term
  (`asBareCommand`); "I want you to search for X" strips the whole lead-in centrally, very early
  in `runTurn` (a new `INDIRECT_REQUEST_RE`/`workingLine`) — found live: without this, it was
  mis-swallowed by `GENERAL_VERB_TEACH_RE` as a bare `<subject> <verb> <object>` teach triple
  (subject "I"), declined by the pronoun-subject guard with a confusing message instead of ever
  reaching `/search`; "please tell me X" (no "about") now answers like "describe X"
  (`DESCRIBE_WRAPPER_RE`'s "tell me" branch made "about" optional); and a new `GOAL_BY_COMMAND`
  table threaded through `runCommand`'s `mk()` gives every command dispatch (search/find/
  describe/…) a real "Goal (inferred): …" line, reusing `GOAL_BY_KIND`'s existing wording
  verbatim wherever a command's intent overlaps one of those kinds — generalizing the
  Goal-inference mechanism to command dispatches, not just `ask()`-parsed queries.

New tests: `test/chat-teach-quantifier.test.mjs` (Bug A + Bug E, 6 cases), `test/chat.test.mjs`
(Bug C), `test/chat-ux.test.mjs` (Bug D), `test/chat-indirect-request.test.mjs` (Bug F, 11 cases,
new file). Manually verified live via the real CLI (piped stdin) as well as unit tests — see this
session's own transcript for the exact chat excerpts.

**Future direction flagged by the operator (out of scope for this dispatch, noted for a dedicated
future design session):** a genuine planning/agentic loop — infer the goal, read the relevant
subgraph, reason about candidate action-paths and their effects, pick the next step, execute,
repeat — substantially bigger than the routing-level Goal-inference generalization above (which
only labels an already-computed answer's intent, never plans ahead of one).

### New-term teaching + quantifiers (`c9dd281`)

"redis is a cache" (a genuinely new term, not in the closed ~180-word ACE lexicon) is now
teachable — fixed write-side only: a new `unknownSubjectFallback` in `teachLane` gives an unknown
SUBJECT a free pass when the OBJECT still resolves as a known noun, writing directly via the
existing `appendFact` with `teach:chat:...` provenance (distinct from the `ace:chat:...` family
reserved for genuinely ACE-parsed sentences). The read path needed zero changes — `factAnswer`/
`factReadBack` and the live 2-hop transitive `IsA` proof chase already worked generically over any
subject string regardless of lexicon status, confirmed live with a real `redis → cache → store`
chain. Plus four new teach phrasings ("some/a few Xs are Ys" with stored quantifier, "your X is a
Y", bare "X is Y" as a property assertion when Y is an adjective) and a quantifier-recall query
("how many Xs are Ys" → "A few.", dispatched ahead of `answerCount` in `runTurn` specifically to
avoid being swallowed by its greedy noun-scan regex — the highest-risk wiring detail, verified not
to regress real "how many classes are there" style counts).

### An always-on Goal-inference line (`6eecca6`)

A short `Goal (inferred): ...` line now appears on every real structural/vocabulary answer,
distinct from the pre-existing opt-in `/narrate` full-trace debug mode (which stays as-is for
deeper debugging). Two correctness bugs in the goal-deduction hook itself surfaced and got fixed
during later work: a confidently WRONG goal shown on failed teach attempts (`6a07214`, now says
"Teach/remember a new fact"), and a missing goal on relation-force answers that resolve via a
different code path than the normal parse (`124df15`).

### Seonix's 17-round dogfooding backlog — triaged, Batch 1 shipped

Sibling project seonix (a real npm consumer of tmct) ran extensive dogfooding — a synthetic
self-index playtest sprint plus live findings against a real 27,929-module production estate —
and relayed 17 rounds of findings via the inter-session inbox (`~/.claude/inboxes/mechanic.md`).
Triaged into 5 priority batches (4 items already fixed by intervening work, confirmed live rather
than assumed). **Batch 1 (existence-query correctness) shipped** — see above. Batches 2-5 queued,
detail in "Open follow-ups" below and the full triage report in this session's transcript.

### Version-bump policy: set, then revised

Tried "bump immediately after every push, hold locally until the next batch ships" (to keep the
published npm version always matching the last pushed commit's version, avoiding a separate CI
publish per small change). Reverted mid-session after it produced confusing "referencing a
version that doesn't exist yet" noise — a phantom `1.0.4` sitting in local git while the operator
was separately, legitimately troubleshooting whether `1.0.3` had actually published read as more
confusion than the policy was worth. **Current policy** (recorded in `CLAUDE.md`): bump only at
the moment of actually pushing a release, as part of that same push.

## Open follow-ups (next session, in priority order)

1. **DONE: Tier 5 (teach + recall + reasoning in dialogue)** — run as its own dedicated dispatch,
   5 cycles (the cap), genuinely clean at the end (see "The dialogue-flow playtest loop" section
   above for the full per-cycle detail — 12 routing fixes + 1 important correctness bug, fabricated
   cross-subject answer, all in `src/chat.mjs`). **Tier 6 (the messy real user) — still not yet
   run**, now this dispatch's own next starting point.
2. **DONE: Seonix Batch 2 — cheap, high-confidence routing gaps.** All three landed. (a)
   `grammar.mjs`'s T5 ("meta-whatis") article is now optional, but the bare (no-article) form is
   restricted to `ENTITY_TO_TYPE`'s closed vocabulary (`what is Commit` now parses; the two pinned
   honest-miss regressions — "what is the meaning of this codebase", "what is exposed" — still
   return null). (b) Added the reverse `inherits` verb family (`is X a superclass/parent class of
   Y`) to `ask-vocab.mjs`, with subject/object swapped at parse time in both `grammar.mjs` T1 and
   `keywords.mjs`'s decomposition, so "is Base a superclass of Widget" and "is Widget a subclass of
   Base" agree; the "the"-definite forms ("is the superclass of") are named in the export but not
   yet wired into `VERB_TO_KIND` — folding them in leaked the bare word "the" into ask.mjs's
   CONTENT_VOCAB and broke the cascade's noise-strip tests, so that's deferred. (c) A curated
   `TRAILING_SCOPE_FILLER` table (`ask-vocab.mjs`) strips trailing clauses like "in this graph" off
   a `what is a <noun phrase>` capture, at both the grammar layer and chat.mjs's fact-lookup path.
   One pre-existing test (`chatflow-tier2.test.mjs` T11) was updated: bare "what is Class" now
   direct-hits the meta definition instead of falling through to the cascade's count-reading
   rescue — a strictly better, non-wall answer, so the test's expectation was updated to match.
3. **DONE (this session): Seonix Batch 3 — recurring wall patterns.** All three landed. (a)
   `MODULE_PURPOSE_RE` ("whats X for"/"what's X about"/"what is X for") joins `MODULE_ORIENT_RE`
   in `moduleOrientLane` (`chat.mjs`), reusing the same `resolveEntity` + `moduleOverviewText`
   rendering and pronoun-subject guard "what does X do" already had; does not shadow
   `META_ORIENT_RE`'s literal "what is this app for". (b) Bare "recent commits"/"latest commits"/
   "newest commits" (`ask.mjs`, a new `parseRelationalOrQualified` "recentCommits" AST node) render
   a real dated commit list instead of a false "no Commit found matching 'recent'" find-miss;
   "the last/latest/most recent commit" as a query SUBJECT is substituted for the actual newest
   Commit individual's own id BEFORE parsing (`ask()`'s new `substituteLastCommitPhrase`), so "what
   did the last commit touch" reads exactly like "what did commit `<sha>` touch"; a bare "when
   was/did commit X" left with no change-verb after substitution is bridged onto the existing
   "when" shape's own Commit-as-object special case by appending a neutral "touched" tail.
   `HISTORY_CAP` exported from `codegraph.mjs` and reused for the cap. (c) `META_ORIENT_RE` widened
   for onboarding/closing phrasings beyond the original closed set ("what should i read first [to
   understand this codebase]", "where should i start reading [this code]", "where do i begin
   reading", "what should i look at first"). Also (grouped here for file-locality, part of Batch
   4/5): `RELATIONS.cochange.verbs` (`ask-vocab.mjs`) gained the present-tense forms ("changes
   with", "change with", "tends/tend to change with", "usually changes with") — `VERB_ALT`'s
   longest-first sort already resolved the `ENTITY_TO_TYPE` "Change"-noun collision risk,
   verified empirically, so no parser guard was needed. New/updated tests in `test/chat-ux.test.mjs`,
   `test/ask.test.mjs`, `test/ask-vocab.test.mjs`.
4. **Seonix Batch 4/5 — lower priority.**
   - **DONE: the disambiguation-candidate-ranking weakness's exact-basename-vs-siblings case.**
     Built a realistic, committed fixture (`test/fixtures/large-scale/` — vendored commander.js +
     express.js source, 14 modules across two "repos") specifically because the bug never
     reproduced on tmct's own tiny `examples/mini-webapp`/`examples/polyglot` graphs (too few
     same-directory siblings to collide). Indexed it with seonix's own indexer
     (`seonix cli index_repository`), expanded its v2 interned wire format back to tmct's plain
     edge shape (`expandGraphPayload` from seonix's `src/graph-format.mjs`), merged in tmct's
     static schema docs (`ingestSchemaDocs`, confirmed a correct idempotent no-op here — seonix's
     own indexer already bakes in ID-compatible schema docs), and committed the result at
     `test/fixtures/large-scale/.tmct/graph.json` (allow-listed in `.gitignore`, mirroring the
     `examples/*/.tmct/graph.json` exception). Reproduced the bug on this graph (an exact
     basename match losing to a same-directory sibling that only shared a component) and fixed it
     in `resolveObject`'s tier-3 scoring (`src/ask.mjs`): a new basename-exact/prefix/suffix check
     (score 5000/~4000, length-floored at 4 chars for the prefix/suffix half to avoid reopening the
     short-word accidental-substring bug) now runs before the raw-containment/overlap passes, and
     the overlap-tier score is now normalized by the term's own component count instead of a flat
     `overlap * 10` — so a 1-of-N-component partial match can no longer outrank a clean
     exact/prefix/suffix hit. New regression test `test/ask-resolve-ranking.test.mjs` (6 cases:
     exact-beats-siblings ×2, genuine tie stays `ambiguous:true` ×1, cross-"repo" isolation ×2,
     fixture sanity ×1) — all passing; full suite green (1258/1258) at the time of this fix.
   - **DONE (this session): compositional-AND, the two-different-recognized-verbs case.**
     `sameVerbLed` (`src/ask.mjs`, `parseRelationalOrQualified`) only opened the marker gate for a
     same-kind repeat ("call X and call Y") or a bare ellipsis-borrowed object ("call X but not
     Y") — a later "and"-branch with its OWN DIFFERENT but still-recognized verb ("which functions
     call X and test Y": `calls` then `tests`) fell outside the gate entirely and dropped to the
     legacy `ambiguousParse` path. Added `differentVerbLed`, additive alongside `sameVerbLed`: opens
     when every later branch carries its own recognized verb at a SINGLE word (`vh.end - vh.start
     === 1`) — the atom-building loop needed no change, it already builds one independent atom per
     verb-led branch and `evalBoolean` intersects them regardless of kind. The single-word
     restriction is deliberate and load-bearing, not cosmetic: the pre-existing 610915a compat case
     ("which classes extends Base and couples to logging", pinned `ambiguousParse:true` in
     `test/ask-compositional.test.mjs:67` and `:144`) is STRUCTURALLY the same "two different,
     both-recognized verbs" shape (`couples to` genuinely resolves via `VERB_TO_KIND` to `imports`,
     despite that file's own prior comment implying otherwise) — accepting any recognized different
     verb regressed both pinned tests; restricting to a single-word later verb is the narrowest rule
     that admits the target case ("test") while leaving the multi-word compat case exactly as closed
     as before. New test `test/chatflow-tier4.test.mjs` ("boolean-AND two-different-recognized-verbs")
     verifies the real set intersection against `examples/mini-webapp` (a genuinely empty
     intersection there — the fixture's callers and testers are disjoint populations — receipted
     honestly, never the old ambiguousParse misread of the whole tail as one object string); a
     sibling test re-confirms the 610915a compat case end-to-end, unaffected.
   - **Still open**: cochange phrasing variants, a "multi-root" substring over-match (single
     instance, not independently reverified).
5. **DONE (this session): general verb-to-predicate teaching's natural follow-up.**
   `GENERAL_VERB_YESNO_RE` ("does/did X `<verb>` Y") and `GENERAL_VERB_OPEN_RE` ("what does/did X
   `<verb>`") wired into `factReadBack` (`chat.mjs`), directly after the `WHO_OWNS_RE` block: a
   taught general-verb fact answers back directly ("does margo eat ribs" → yes; "did margo eat
   ribs" → yes, past tense; "does margo eat cake" → an honest, closed-world no; "what does margo
   eat" → lists ribs). Both run the SAME `GENERAL_VERB_EXCLUDE_RE`/`GENERAL_VERB_ANYWHERE_EXCLUDE_RE`
   guards `generalVerbTeach` uses and route the verb through the SAME `generalVerbPredicate`, so the
   has/have bridge works on the query side too; `factReadBack` only ever runs on an already-true
   `miss`, so a real structural query ("does `<module>` import `<module>`") is never shadowed. Found
   + fixed live while writing tests: `GENERAL_VERB_EXCLUDE_RE` was written for `generalVerbTeach`'s
   fully-conjugated verb ("X OWNS Y"), but "does/did X `<verb>` Y" captures the bare infinitive after
   do-support ("does X OWN Y") — a real false "no" against a genuinely-true taught ownership fact,
   since `generalVerbPredicate("own")` mints a different predicate than the ownership frame's own
   `OWNED_BY_PREDICATE`. Added `GENERAL_VERB_QUERY_EXCLUDE_RE` (be/own/maintain) as the query-side's
   own bare-infinitive exclude set. A successful answer gets its own goal-line revision
   ("look up a taught fact about a subject/verb/object"), mirroring the TEACH lane's own pattern.
   New `test/chat-generalverb-query.test.mjs` (6 cases).
6. **DONE (this session): the Tier-4 "of X" membership gap, walk inheritance.** "public methods of
   TaskController" used to return a genuine-looking but incomplete empty because a class with no
   own members never checked whether it INHERITS members from a superclass. Fixed in `src/ask.mjs`:
   the old inline own-lookup in `evalSet`'s `"membership"` case was extracted into
   `membershipOwnSet(graph, id, entityType)`; a new `computeMembership(graph, ownerId, ownerClass,
   entityType, filterFn)` tries the owner's own (optionally `filterFn`-qualifier-filtered) member
   set first, and ONLY when that's empty AND `inheritsApplicable(graph, ownerClass)` walks
   `ancestorsOf` nearest-first, applying the SAME filter at each level (so a qualifier that empties
   an otherwise-non-empty own set still correctly triggers the walk — "public methods of X" is not
   equivalent to "methods of X" filtered once after resolving). A new top-level composite path,
   `evalMembershipComposite` (wired into `evalComposite` for both a bare `"membership"` node and a
   `"qualifier"` node wrapping one), carries the inheritance provenance through to
   `renderComposite` so an inherited answer is DISCLOSED out loud ("TaskController has no own
   methods — inherited from Controller: …") rather than ever silently presented as the owner's own;
   an owner with its own (even qualifier-filtered) members always wins outright, no blending.
   New tests in `test/ask-cascade.test.mjs` (Controller/TaskController/TaskControllerWithOwn
   fixture, 3 cases: inherited walk, qualifier-filtered inherited walk, own-always-wins discipline).
   Note: the BARE "methods of X" phrasing (no leading qualifier/`which`) is separately intercepted
   by `interpret/normalize.mjs`'s `PHRASING_FRAMES` onto the older, unrelated "what does X contain"
   simple-clause shape before the compositional grammar ever sees it — a pre-existing routing
   feature, out of this fix's scope; "which methods of X" (or any qualifier-led form) reaches this
   fix's actual code path.
7. **DONE: `test/chatflow-tier1.test.mjs` naming.** Was mislabeled — its own header described
   Tier 2's territory ("drill-down chains with anaphora... what calls it → what uses that"), not
   Tier 1's "single touch + one drill-down". Renamed to `test/chatflow-tier2-drilldown.test.mjs`
   this session (`git mv`, history preserved), its header corrected to describe Tier 2 content,
   and the now-obsolete naming note in `test/chatflow-tier1-single-touch.test.mjs` removed.
8. **Judged CHATBENCH re-run.** Not run this session — this session's changes touch answer text
   on judged surfaces again (onboarding/identity responses, teach-lane wording, new relation
   phrasings), so the next judged pass needs to re-derive its stale set from answer-text diffs,
   not assume anything carries over from the 0.8.2-era baseline still on record.
9. **DONE: the `resolveObject` tier-4 prose-token over-match** flagged during this session's
   playtest-freeze verification pass. Root cause was NOT actually in tier 4 itself: tier 3
   (`resolveObject`'s undotted/unslashed branch, `src/ask.mjs`) had no way to see that "logging"
   (the query word) and "logger" (`src/lib/logger.mjs`'s real basename) are the SAME underlying
   word one gerund/agent-noun suffix-swap apart — its stem/component checks are substring/exact
   only, no morphology — so tier 3 found nothing at all and fell straight through to tier 4, whose
   ONLY hit was an unrelated Commit's free-text message ("leveled logging"); tier 4 then correctly
   (per its own contract: a unique, non-tied prose hit stands) returned that commit, which was a
   confidently-WRONG entity, not the module. Fix: a narrow, closed, Module-only
   derivational-suffix basename bridge in tier 3 (`derivationalStem`, `src/ask.mjs`) — strips one of
   a small suffix set (`ing`/`er`/`ers`/`or`/`ors`) and collapses a doubled trailing consonant
   (`logging`/`logger` both reduce to `log`), scored between the existing exact/prefix-suffix tier
   and the raw-containment tier, and gated to never fire when the term is already within tier 5's
   own fuzzy-typo distance budget of an existing literal stem (so a genuine typo like "loging" for
   `src/logging.mjs` still falls through to tier 5 and is announced, unaffected). Module-only by
   design so it can never also fire for a same-stem Class/Method/Function and manufacture a false
   ambiguous tie (`Logger`/`Logger.info` do NOT also match). "whats logging for" against
   `examples/mini-webapp` now answers "src/lib/logger.mjs is a module — defines 3 (Logger,
   Logger.info, createLogger); no recorded tests. …", never the commit. New tests:
   `test/ask.test.mjs` (3 unit cases against the real `examples/mini-webapp` graph: resolves to the
   module not the commit, the prose index itself is untouched/still consultable via the separate
   `mentions` shape, and the typo-vs-derivational guard-rail) and
   `test/chatflow-tier1-single-touch.test.mjs` (one live end-to-end `whats logging for` case via
   `createSession`/`runTurn`).

### Playtest-freeze verification pass (2026-07-09, same session)

Per this session's own closing instruction: manually chat-tested (piped CLI, `mktemp -d` + exact-path
cleanup throughout, never `chat --repo` on the committed `examples/mini-webapp` fixture directly) the
Tier 0/1/2/4 fixes above plus operator bugs A-F, read every transcript top to bottom, and froze every
conversation that flowed clean as a new regression test:
- `test/chatflow-tier1-single-touch.test.mjs`: **"tier1/Seonix Batch 2+3 single-touch spot-check"** —
  bare no-article "what is Commit", purpose phrasing ("whats X for/about"), the reverse
  superclass/subclass verb pair, and the "in this graph" scope-filler trim, all against real
  mini-webapp data.
- `test/chatflow-tier2.test.mjs`: **"tier2/recent-commits drill-down"** ("recent commits" → "what did
  the last commit touch" → "what did it touch" → "when did it change" — temporal substitution +
  anaphora carry-through) and **"tier2/cochange natural follow-up"** ("what usually changes with X" →
  "what about model.mjs" → "where is it defined") — both against real mini-webapp commit/cochange
  data (the file's existing `entities.fixture.json`-based tests have neither).
- `test/chatflow-tier4.test.mjs`: **"tier4/membership inheritance walk (item 6) against real
  mini-webapp data"** — "public methods of TaskController" → "which class defines handle" → "what
  about UserController", confirming item 6's inheritance-disclosure fix live against the shipped
  example (the existing `test/ask-cascade.test.mjs` coverage only ever exercised a synthetic
  inline-built graph).
Bugs A-F (had/have conjugation, general-verb query retrieval, the no-graph count message, the memory
summary/subtype-walk lanes, and the indirect-request wrapper stripping + command Goal-line) were all
spot-checked live and confirmed flowing — no new tests needed there (already covered by the unit
tests landed alongside each bug this session). One genuine new dead-end surfaced and is recorded as
item 9 above, left unfixed per this pass's own verify-only scope. `npm test`: 1303 passing (up from
1299), 0 failing; `test/showcase.test.mjs` unaffected; CLI smoke test (`printf 'hi\n/exit\n' | node
bin/tmct.mjs`) exits 0.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`); `npm test` green at every
commit; coordinator + background sub-agents, disjoint file-ownership where possible, serialized on
shared files (this session: almost everything shares `src/chat.mjs`/`src/ask.mjs`, so playtest
cycles and bug-fix dispatches ran strictly sequentially, never in parallel, to avoid collisions —
confirmed necessary in practice, not just theoretical caution); background agents get push
permission only when the coordinator isn't holding a deliberate reason not to (a near-miss this
session: a push-enabled agent swept a deliberately-held-back version-bump commit into its own
push — no lasting harm, since the published version still matched the last pushed commit, but the
coordinator now defaults to pushing manually rather than delegating it); no LLM in the product
path, ever.

*Prior sessions' detailed handover (Phases 0–11, releases 0.2.0→0.9.11) lives in git history of
this file plus the `CHATBENCH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`STRATEGY_ADVISOR.log`/`archive/PLAN_*`
artifacts. This session's commit-level detail is above; `ROADMAP.md`'s "Where we are now" is the
short version of the same.*
