# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`**: read its
**"Where we are now"** block first; this file is the commit-level detail behind it.
Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic` — see
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live).

## Where we are (2026-07-09)

`npm test` green (**1245**). **v1.0.7, pushed** (0.9.11 → 0.9.12 → 1.0.0 → 1.0.7 across this
session). Prior session's detailed handover (0.9.5 era — the playtest sprint, Bug 6/7/8, the
predicate-find feature, infbench stages 0-2) is superseded by everything below; its content
still lives in git history of this file if needed.

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
- **Tier 5 (teach + recall + reasoning in dialogue) and Tier 6 (the messy real user) — not yet
  run.** Next session's starting point for the playtest loop.

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

1. **Tier 5 (teach + recall + reasoning in dialogue) and Tier 6 (the messy real user)** — not yet
   run. Tier 5's territory substantially overlaps this session's own new-term/quantifier-teaching
   work, but hasn't been through the playtest loop's own dead-end-hunting discipline yet.
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
3. **Seonix Batch 3 — recurring wall patterns, 3+ independent confirmations each.** Purpose/
   identity phrasing ("whats X for/about") walling while "what does X do" and superlatives work;
   temporal qualifiers on Commit queries ("the last commit", "recent commits") treated as literal
   filter values; onboarding/closing questions ("what should I read first") read as literal
   search strings.
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
   - **Still open**: cochange phrasing variants, compositional-AND edge cases beyond what Tier 4
     covered, a "multi-root" substring over-match (single instance, not independently reverified).
5. **General verb-to-predicate teaching's natural follow-up**: dedicated direct-question
   recognition ("does margo eat ribs", "what does margo eat") — this session shipped teaching +
   generic retrieval only, not verb-specific query phrasings.
6. **The Tier-4 "of X" membership gap**: "public methods of TaskController" returns a genuine,
   receipted empty because the class declares no methods of its own (inherited from `Controller`)
   — extending membership queries to walk inheritance is a bigger structural change than a
   routing fix, deliberately deferred.
7. **DONE: `test/chatflow-tier1.test.mjs` naming.** Was mislabeled — its own header described
   Tier 2's territory ("drill-down chains with anaphora... what calls it → what uses that"), not
   Tier 1's "single touch + one drill-down". Renamed to `test/chatflow-tier2-drilldown.test.mjs`
   this session (`git mv`, history preserved), its header corrected to describe Tier 2 content,
   and the now-obsolete naming note in `test/chatflow-tier1-single-touch.test.mjs` removed.
8. **Judged CHATBENCH re-run.** Not run this session — this session's changes touch answer text
   on judged surfaces again (onboarding/identity responses, teach-lane wording, new relation
   phrasings), so the next judged pass needs to re-derive its stale set from answer-text diffs,
   not assume anything carries over from the 0.8.2-era baseline still on record.

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
