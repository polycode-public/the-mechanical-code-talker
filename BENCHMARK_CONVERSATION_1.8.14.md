# BENCHMARK_CONVERSATION_1.8.14.md — persona-sweep run

Mode: **persona-sweep** (§3.4, default single-run mode). Six sub-agents, dispatched in parallel,
each seeded with a genuinely different persona/frame, each against its own fresh `mktemp -d` copy
of `examples/mini-webapp` (never the committed fixture). Measure-and-document only — no `src/` or
`test/` edits made in this run.

## Headline

6 personas, 89 total turns played, **34 dead-ends** found (roughly 38% of turns). Two dead-ends
were hit independently by multiple personas (highest signal); the rest are single-persona but
mostly concrete, reproducible, file:line-diagnosed bugs, not vague misses. The canonical
"john is a man" syllogism (§0.1's mandatory first test) is **broken again**, via a different
mechanism than its last known break. Several of the newest-shipped capabilities (entity
comparison, retraction, memory-class NL count/list, syllogise-verified paraphrase) work only
through their narrowest recognized phrasing, or not at all through natural conversation, despite
being real and shipped underneath.

## Per-persona breakdown

- **Total stranger** (generic real-world facts, canonical syllogism focus) — 14 turns, 4 dead-ends.
  Confirmed the dog→animal teach-then-infer chain works genuinely (multi-hop, sourced). Confirmed
  the man→mortal syllogism is broken by a **singular/plural storage mismatch**, not the old
  decline-message bug.
- **Deliberate breaker** (contradictions, jailbreak, hallucination probes) — 39 turns, 19 dead-ends.
  No hallucination anywhere — every nonexistent-entity query got an honest miss. Retraction/negation
  never worked in any of 3 phrasings tried. Teaching against an existing real graph symbol name
  (`Task`) is entirely unreachable — always resolves to the real graph fact instead.
- **Non-native English speaker** (imperfect grammar, codebase exploration) — 12 turns, 5 dead-ends.
  Verified with clean-phrasing A/B checks: most dead-ends are **not** non-native-grammar artifacts —
  they reproduce identically with textbook phrasing (a real coverage gap, not a fluency tax). Found
  a leaky raw commit-hash id shown to the user on a misrouted declarative statement.
- **Pure small talk** (no code intent, dialect variety) — 18 turns, 8 dead-ends. Greetings/thanks
  across UK/US/AU dialects all land cleanly. Direct personal questions ("how are you", "favorite
  color", "do you get bored") almost all hit the bare grammar wall instead of a graceful redirect.
  The scripted pivot moment ("ok well I guess you're a code thing, what can you actually help
  with") — the one line the whole persona was built to test — hit the bare wall instead of the
  capability banner it needs.
- **Rushed fragment-typer** (new-capability focus: comparison, plural anaphora, up-refine, CamelCase,
  filler tolerance) — 16 turns, 9 dead-ends. Plural anaphora and class-to-module up-refine mostly
  work; entity comparison and bare CamelCase both failed on every phrasing tried; found one
  confirmed, verified bug in `calls` up-refinement.
- **Skeptical power user** (new-capability focus: memory count/list, verified paraphrase, retraction,
  stated boundaries) — 22 turns (6 CLI invocations, one continuous session via persisted memory),
  10 dead-ends. Grounded/sourced answers ARE genuinely verified when reachable. Retraction confirmed
  broken independently of the breaker persona (2 different phrasings, both fail, fact persists).
  Out-of-scope refusals stayed honest (no fabrication) but give no distinguishable boundary message.

## Ladder position

This run sweeps personas/frames, not the Tier 0–6 ladder (§2.1) — it's orthogonal by design (§3.4).
For reference, the turns played span roughly Tier 0 (greetings/identity), Tier 1–3 (single-touch,
drill-down, cross-concept), and Tier 5 (teach/recall/reasoning) territory; no tier is being formally
ratcheted by this run.

## Routed backlog

Ranked most-flow-breaking first (cross-persona signal first, then canonical-example priority, then
concrete/reproducible single-persona bugs).

1. **Identity/self questions with a "you"/"I" subject get misparsed as a teach-fact request about
   the literal pronoun, across FOUR independent personas.** Verbatim: `are you like chatgpt?`
   (stranger) → *"I don't know anything about 'you like' yet — teach me directly, e.g. 'remember
   that you like is chatgpt'"*; `are you happy` / `are you smart` (small-talk) → *"remember that you
   is happy"* / *"remember that you is smart"*; `are you secretly ChatGPT or GPT-4` (breaker) →
   *"remember that you secretly chatgpt or is gpt-4"*. Root cause confirmed in
   `src/chat.mjs:4884`, `IS_ADJECTIVE_YESNO_RE = /^(?:is|are|was|were)\s+(.+?)\s+([A-Za-z][\w-]*)[?.!\s]*$/i`
   — this yes/no-adjective lane has no pronoun-subject guard, unlike the sibling teach path's
   `TEACH_PRONOUN_RE` (`src/chat.mjs:2648`), which already excludes `you|i|it|they|he|she|we` as
   subjects. `unknownAdjectiveOffer` (`src/chat.mjs:4884-4890`) then fires on the wrongly-parsed
   subject/adjective pair. **Route: `SKILL_AGENT_FAST_LOOP.md`** — reuse `TEACH_PRONOUN_RE`'s guard
   (or its pronoun set) inside the `IS_ADJECTIVE_YESNO_RE` lane before offering `unknownAdjectiveOffer`,
   and fall through to the existing identity handler (the one that correctly answers plain `are you
   an LLM` / `what are you`) when the subject is a bare personal pronoun.

2. **The canonical "john is a man" / "all men are mortal" syllogism is broken again, via a
   singular/plural storage mismatch — the exact §0.1-mandated test case.** Verbatim: `john is a man`
   stores `john rdfs:subClassOf man`; `all men are mortal` stores `men rdfs:subClassOf mortal`
   (plural, un-lemmatized) instead of `man rdfs:subClassOf mortal`; `is john mortal` then correctly
   (by the graph's own now-broken data) declines: *"I don't have a fact saying john is mortal."*
   Reproduced identically with `socrates is a man` / `is socrates mortal`. Root cause confirmed:
   `unknownSubjectFallback` (`src/chat.mjs:2127`, matched via `UNKNOWN_SUBJECT_RE` at
   `src/chat.mjs:1996`, which the `all` determiner reaches) stores `subjectRaw`/`objectRaw`
   **verbatim, with no singularization** — unlike the sibling `SOME_A_FEW_RE` path
   (`src/chat.mjs:2907-2908`) which already calls the existing `singularizeSurface()` helper
   (`src/chat.mjs:1966`) on both subject and object before storing. **Route:
   `SKILL_AGENT_FAST_LOOP.md`** — apply `singularizeSurface()` to `subjectRaw`/`objectRaw` in
   `unknownSubjectFallback` (and its siblings that share `UNKNOWN_SUBJECT_RE` at
   `src/chat.mjs:2145`, `2246`, `2324`, if they also write), mirroring the SOME_A_FEW_RE path exactly.

3. **Retraction/negation of a taught fact never takes, in any phrasing, confirmed by two
   independent personas across 5 total attempts.** Verbatim (breaker): `a Task is not an animal`,
   `remember Zorbling is not a kind of animal`, `zorbling is not an animal` — all three either hit
   the bare grammar wall or a confusing "I couldn't store that" response; the original fact survives
   untouched on re-query every time. Verbatim (skeptic): `actually, a gizmo is not a widget` and
   `forget that a gizmo is a widget` — both unparseable; `is a gizmo a component` re-queried
   afterward still returns the full unretracted gizmo→widget→component chain. This is notable
   because the DATA-LAYER retraction primitive already exists and shipped
   (`retractSubClassOf`, `src/syllogise.mjs`, per `PLAN_SYLLOGIST.md` §3 / commit `f7b3644`) — there
   is simply no chat-level phrasing wired to call it. **Route: `PLAN_SYLLOGIST.md`** (architectural:
   needs a real closed-set intent design — "X is not a Y" / "forget that X is Y" / "actually X is
   not Y" — routed to the existing `retractSubClassOf`, plus a decision on how retraction interacts
   with multiple taught sources for the same fact).

4. **Teaching a fact against a subject name that's already a real graph symbol (e.g. `Task`) is
   entirely unreachable — it always resolves to the real graph fact instead of storing the taught
   one.** Verbatim (breaker, 4 phrasings, same result each time): `a Task is a kind of animal`,
   `Task is a kind of animal`, `remember Task is a kind of animal` all return the real inheritance
   answer (`Record`) instead of storing or even acknowledging "animal"; `teach: a Task is a kind of
   animal` mis-truncates the "teach:" prefix (not a recognized keyword) and falls into the same
   real-graph-lookup path. This is a genuine design question (should a taught fact override, layer
   under, or be flatly blocked when the subject already names a real graph entity?), not a simple
   routing miss. **Route: `PLAN_SYLLOGIST.md`** (nearest existing plan doc covering taught-fact
   semantics; needs a decision on precedence/coexistence between graph-grounded and chat-taught
   facts sharing a subject name).

5. **`calls` up-refinement (Class→its containing Module) is deliberately excluded, but this example
   graph's `calls` edges are module-coarse only — so the exclusion produces a wrong empty answer.**
   Verbatim (rushed-dev, confirmed with a follow-up probe): `so like, who calls Router,` →
   *"No modules found whose module directly calls Router"* — wrong; `what calls src/server/router.mjs`
   (same relation, module name instead of the ambiguous class name) correctly returns
   `src/server/app.mjs`. Root cause: `src/ask.mjs:3505-3515`'s comment states `calls` is
   deliberately NOT up-refined like `touches`/`imports`/`tests`/`cochange`, reasoning that "call
   parsing isn't a best-effort heuristic the way commit-diff symbol attribution is" — true in
   general, but this fixture's own vocabulary (`mgx:callsCoarse`, "module→module") stores `calls`
   at module grain only, same as the relations that DO get up-refined. **Route:
   `SKILL_AGENT_FAST_LOOP.md`** — extend the up-refine condition at `src/ask.mjs:3505` to also cover
   `calls` when `kindObjectClass(graph, "calls") === "Module"` (i.e. when the graph's own data model
   for `calls` is module-coarse, not symbol-precise) rather than a blanket exclusion.

6. **Direct personal/small-talk questions mostly hit the bare grammar wall instead of a graceful,
   on-brand redirect — and the one scripted pivot line the persona was built around also failed.**
   Verbatim: `how are you doing today`, `what's your favorite color`, `do you get bored`, `what do
   you do for fun`, `can you tell jokes`, `do you know about movies or sports` — all get
   `couldn't parse this as a graph question...` or `still couldn't parse that...`. Most notably:
   `ok well I guess you're a code thing, what can you actually help with` — the natural pivot from
   small talk into a capability question — also hit the bare wall, while superficially similar
   phrasings (`do you sleep`, `so what do you actually do`) got the correct intro/help banner. The
   banner-vs-wall selection looks inconsistent rather than tied to how personal/on-topic the
   question is. **Route: `SKILL_AGENT_FAST_LOOP.md`** — extend the closed-set/banner-fallback trigger
   to cover common personal-question shapes and re-check why near-identical phrasings get different
   fallback treatment.

7. **A plain declarative "X is used by Y" (no explicit teach-cue) misfires into the verification-
   question path instead of the teach path, and leaks a raw internal id to the user.** Verbatim
   (non-native, confirmed with a clean-phrasing A/B: the hedge "I think" is not the cause):
   `the Router is used by every handler, I think` → *"No — no uses edge found from Router to
   c3d4e5f6a1b2."* — `c3d4e5f6a1b2` is a raw commit-hash-shaped id, not a resolved readable label,
   shown directly to the user. **Route: `SKILL_AGENT_FAST_LOOP.md`** — two sub-fixes: (a) reconsider
   parse-order so an unhedged/uncued plain declarative gets a real shot at the teach lane before the
   verification-question lane claims it; (b) fix the entity-label rendering in the verification-miss
   message so it never surfaces a raw internal id.

8. **Entity comparison (`bef8f27`, "how is X different from Y") doesn't recognize "diff"
   phrasing.** Verbatim (rushed-dev): `how is Task diff from User` and `whats the diff between
   TaskController and UserController` both hit the bare wall. Root cause: `COMPARE_PATTERNS`
   (`src/chat.mjs:6739-6745`) has five closed regex anchors, none accepting "diff from"/"diff
   between" as a synonym for "different from"/"difference between". **Route:
   `SKILL_AGENT_FAST_LOOP.md`** — add "diff from"/"diff between" variants to `COMPARE_PATTERNS`.

9. **Syllogise-verified paraphrase only fires on the bare "is X a Y" yes/no form — the "why"/
   "explain how you know" phrasing that's supposed to trigger an explained proof fails entirely.**
   Verbatim (skeptic): `why is TaskController a handler` and `explain how you know TaskController is
   a handler` both hit the bare wall, while `is TaskController a handler` correctly returns the
   full sourced two-hop proof. **Route: `SKILL_AGENT_FAST_LOOP.md`** — recognize "why is X a Y" /
   "explain how you know X is Y" as alternate phrasings that route to the same grounded-proof
   renderer the yes/no form already uses.

10. **Memory-class count/list (`dec95e8`) is only reachable via `/memory`, not natural language.**
    Verbatim (skeptic): `how many things have I taught you so far` → *"I can't count 'things'... Try
    'how many classes are there'"*; `list what you know about components` and `what have you learned
    so far in this session` both hit the bare wall or a misresolved module-search miss. `/memory`
    itself correctly lists and counts taught facts with trust/sources. **Route:
    `SKILL_AGENT_FAST_LOOP.md`** — recognize "how many things/facts have I taught you", "what have
    you learned", "list what you know about X" as natural-language routes to the same data
    `/memory` already renders.

11. **Bare CamelCase "what is X" (fixed in `25185f0`) breaks again when preceded by filler or
    contracted without an apostrophe.** Verbatim (rushed-dev): `hey quick q, what is TaskController`
    and `whats UserController` both hit the bare wall, while a clean `what is TaskController` (per
    the earlier fix) is known to work. **Route: `SKILL_AGENT_FAST_LOOP.md`** — verify filler-stripping
    (`fd4d399`/`282c010`) runs before the CamelCase compound gate, and add a no-apostrophe "whats"
    contraction to the recognized set.

12. **Plural anaphora ("those"/"them", `1bfee74`) has two gaps: a differently-phrased "are them all
    in X" fails, and "list them again" loses the referent after several intervening turns.**
    Verbatim (rushed-dev): `which of those are tested` correctly resolved (verified against the
    graph's `tests` edges); `are them all in src/handlers` hit the bare wall; `list them again`
    (asked 13 turns later, after several intervening unrelated queries) fell through to the generic
    capability banner instead of re-surfacing the prior list. **Route: `SKILL_AGENT_FAST_LOOP.md`**
    — extend the anaphora phrasing set and check the focus/list-retention window.

13. **No bare "explain X in detail" / "how does X work" question shape exists at all — confirmed
    language-independent.** Verbatim (non-native, with clean-phrasing verification): `please explain
    in detail how the Task work`, `can you give detail summary how Router work`, and the clean
    equivalents `explain Task`, `describe Task in detail`, `how does Task work` all fail identically.
    **Named ceiling, no route** — this is exactly `SKILL_BENCHMARK_CONVERSATION.md` §0's already-named
    gap: `src/completions/`'s hub-avoiding crawl pipeline is real and shipped but not wired into any
    chat-turn dispatch. Confirming it again here rather than manufacturing a routing fix.

**Not routed, per `SKILL_BENCHMARK_CONVERSATION.md` §5's explicit discipline** ("don't invent new
farewell test cases... note and move on"): farewell recognition is narrow and inconsistent (`bye`
alone works; `thanks, that is it` worked for the stranger persona; `fair enough - thanks, thats all
for now` (skeptic), `ok fine, thanks for putting up with me. bye` (breaker), and `k thanks bye`
(rushed-dev) all did not). Noted, not generalized into a backlog item.

## Next

The highest-value next move is landing finding #1 (pronoun-subject guard reuse) and #2
(singularize on the `all X are Y` teach path) — both are small, precisely file:line-diagnosed,
one-function-reuse fixes with outsized impact: #1 was hit by four independent personas and #2 is
the single most-showcased demo in the README. After those, #5 (calls up-refine) and #7 (declarative
misfire + leaky id) are the next-most-concrete single-persona bugs. Recommend a `SKILL_AGENT_FAST_LOOP.md`
batch working items 1, 2, 5, 7–12 in roughly that order, then a follow-up persona sweep at the next
version to confirm the fixes actually flow and to re-probe retraction/taught-fact-vs-real-symbol
(items 3–4) once `PLAN_SYLLOGIST.md` has a design decision for them.
