# HANDOVER — current state & kickoff

Living handover. Any session resumes from here. **Plan of record: `ROADMAP.md`** — read its
"Where we are now" section first for the fuller progress narrative, including the full detail of
the 2026-07-10 uplift batch (largest single session to date). This file holds only what to do next —
no completed-work narrative (that lives in `ROADMAP.md`), per this project's own standing discipline.

Session handle (inbox): `tmct` (this session; earlier sessions used `mechanic`). See
`~/.claude/inboxes/tmct.md` and `~/.claude/inboxes/mechanic.md`, both still live.

## Where we are (2026-07-10)

`v1.4.1` is the current version (not yet pushed this session — see "Discipline" below). The
2026-07-10 batch closed out `PLAN_CHAT_FEEL.md` (fully archived, all 12 items), shipped
`PLAN_COMPLETIONS.md` Stages 0–3 end to end (a brand-new capability), closed `PLAN_INFERENCE_TESTING.md`
stages 3–5 (the full 6-band INFBENCH ladder now passes the gate for the first time — INF-B1
33%→100%, INF-C2 0%→100%), closed out most of `PLAN_AGENTS.md` Phase 0, restructured CHATBENCH's
case set (case-set v3, a 109-case go-to default), and ran all four benchmarks fresh
(`AGENTBENCH_1.4.1.md`, `INFBENCH_1.4.1.md`, `CEFR_ENGLISH_1.4.1.md`, `PLAYTESTBENCH_1.4.1.md`) plus a
full capability audit (`CAPABILITIES_AUDIT_2026-07-10.md`). All pre-1.4.1 benchmark reports are now
in `archive/`.

## Open follow-ups (next session, in priority order — ranked by the 4 fresh benchmark reports' own findings)

1. **C2 `pronoun-binding` — CHATBENCH's clearest, highest-impact lever.** 0/10 tier-1 green, 4/10
   judged hard fails, every one confidently-wrong (0 on both correctness AND honesty — the worse
   failure mode, not an honest miss). Long-standing, `PLAN_CHAT_FEEL.md`'s own hardest-tier ceiling;
   no work landed on it this session. See `CEFR_ENGLISH_1.4.1.md`'s hard-fail table for the exact case
   ids and dimension scores.
2. **The closing-remark/farewell closed set is far too narrow — confirmed independently by 3 of 5
   personas in the first `SKILL_BENCHMARK_CONVERSATION.md` §3.4 persona sweep (2026-07-10).** The
   `THANKS`/`BYE` sets in `src/chat.mjs` (~line 894/913) are exact-match closed sets (with only
   character-elongation collapsing, e.g. "thankssss"), pinned by literal strings found one at a time
   across sessions ("cheers, that's everything for now, thanks" was added this session). Three
   independently-run personas each hit a fresh unlisted phrasing and got the generic self-intro or
   grammar wall instead of a sign-off: "thanks, that was fun" (stranger persona), "ok thank you very
   much, bye bye" (ESL persona), "thanks, bye" (small-talk persona — this one is especially notable:
   README implies "bye"/"goodbye" phrasing should end the session, but it fell through to the
   self-intro instead of ending it). This is the SAME class of gap fixed once already this session
   for one exact phrasing — the closed-set-of-literal-strings approach doesn't generalize, and this
   sweep shows it keeps failing on the very next phrasing tried. Worth a structural fix (a bounded
   fuzzy/template match over "thanks/bye" phrase shapes, not another one-off literal addition) rather
   than continuing to whack individual moles.
3. **The generic-fact teach-refusal message is actively misleading, and its behavior is
   inconsistent — found by the "total stranger" persona (§3.4 sweep, 2026-07-10).** Teaching an
   ungrounded pair fact ("a dog is an animal", "roses are flowers") returns: *"I can only teach facts
   using tmct's own code-vocabulary nouns (like module, class, function…), not arbitrary new
   terms"* — this is FALSE; general vocabulary teaching is fully supported and used elsewhere in the
   very same session ("Paris is the capital of France" → "noted — remembered: paris capitals
   france", accepted directly, no grounding demanded). The real rule (both terms must be grounded
   first, per this session's `ungroundedPairHint` fix) is sound; the message text describing it is
   not — it names a constraint ("code-vocabulary nouns only") that isn't the actual constraint
   (ungrounded pair, any vocabulary). Also found in the same transcript: a fact taught in one
   phrasing ("Paris is the capital of France") could not be asked back in the natural question
   phrasing ("what is the capital of France") — a teach-then-recall gap for a headline capability,
   not just teach-then-infer (§0's existing dead-end category). Fix the message text at minimum;
   scope the recall-phrasing gap separately. See the sweep's "total stranger" transcript (not yet
   written up as a numbered `PLAYTESTBENCH_*` — captured live in the persona-sweep dispatch this
   session).
4. **`cls-svf1`'s live chat-query wiring — INFBENCH's last open gap, and the best-scoped item on
   this list.** The kernel rule passes 100%; the chat arm shows `unproven` on all 10 new positive
   cases purely because the query-time wiring wasn't built this session (only `cax-dw` got it). The
   exact pattern to copy (`src/chat.mjs`'s `isaAsk` block, the `deriveDisjointViolations` live-chase
   shape) is fresh in the codebase from this session's own `cax-dw` fix. Would plausibly close
   INF-B2 from 80% to ~100%. See `INFBENCH_1.4.1.md`'s "Next" section.
5. **"who last touched X" ignores the superlative — PLAYTESTBENCH's clearest lever.** Lists the full
   touch history instead of the single most-recent toucher; no distinct code path exists for this
   shape at all (a single-answer "last touched" shape exists for *when*-questions, not
   *who*-questions). Closely related to this session's own temporal-composition work
   (`PLAN_CHAT_FEEL.md` item 6). See `PLAYTESTBENCH_1.4.1.md` round 2.
6. **`A2 naming-vocabulary`'s 2 new CHATBENCH hard fails** (`g-a2-naming-2`, `g-a2-naming-6`) —
   fresh signal, not a known ceiling the way C2 pronoun-binding is. Needs a transcript read before
   it can even be prioritized properly; may be a quick fix or may reveal something deeper.
7. **Wire `src/completions/` into live chat dispatch.** The extractive pipeline (Stages 0–3) shipped
   this session and is real, tested, and unreachable from any actual chat turn — confirmed live by
   PLAYTESTBENCH round 3 ("give me a detailed summary of how X works" still hits the plain grammar
   wall). This is expected (wiring was never in this session's scope), not a regression, but it's
   the single largest unlock available: a whole shipped capability nobody can currently reach from
   chat.
8. **Trailing filler word "then" not stripped** — "so what is a component then" parses as the
   literal unknown term `"component then"` instead of surfacing the just-taught fact. Likely a small
   fix (extend whatever filler-stripping frame doesn't currently cover trailing "then"). See
   `PLAYTESTBENCH_1.4.1.md` round 3.
9. **A has-a-method teach shape** ("every Component has a render method") fails with a vague,
   non-actionable error. **Needs an operator scope decision before any implementation** — is this a
   new ACE pattern worth building, or a deliberate scope boundary (mirroring the lines
   `PLAN_TAUGHT_RELATIONS.md` already drew around which teach shapes to support)? See
   `PLAYTESTBENCH_1.4.1.md` round 2.
10. **A handful of smaller, lower-signal misses from the same persona sweep** (items 2/3 above are
    the two highest-impact): the "deliberate breaker" persona found "are you secretly GPT" mis-
    segments the subject as `"you secretly"` and "class is not a class" mis-classifies as a negated
    set query (both still resolve to safe, honest misses — cosmetic, not urgent); the ESL persona
    found dropped-article phrasings ("what is cache" vs "what is a cache") and doubled-verb phrasings
    ("please describe about Task") fail to route where the grammatically-complete equivalent
    succeeds; the small-talk persona found "do you have feelings" misfires into a literal module
    lookup for the word "feelings", and a direct capability question ("ok so what can you actually
    do") gets the generic parse-failure template instead of being routed toward `/help`/orientation;
    the rushed-dev persona found the "mod" abbreviation prefix isn't stripped before matching
    ("mod store.mjs imports" lands in disambiguation instead of resolving cleanly). None of these
    individually block a session; worth a batch pass together since several share the same root
    cause (narrow closed-set/exact-match matching where a bounded-fuzzy match would generalize).
11. **`scm-svf`/cardinality monotonicity** (`PLAN_INFERENCE_TESTING.md` stage 4's remainder) —
    confirmed unmeasurable against today's INF-C1 fixture (it's already at 90%, unrelated to what
    either rule would fix); revisit only if a future case-generation pass adds a template that
    actually exercises them.
12. **The chat-surface debt re-measure** (`PLAN_AGENTS.md` §3) is the one Phase 0 item this session
    didn't touch — still open.
13. **AGENTBENCH needs no action** — confirmed byte-identical to `0.8.2`, fully gate-passing on
    every rung; the router/goal-reasoner surface is stable. Noted for completeness, not because
    anything is broken.

**Also from this session's own tail, not benchmark-derived:** `SKILL_BENCHMARK_PLAYTEST.md` →
`SKILL_BENCHMARK_CONVERSATION.md` (renamed and refocused — DONE) on fluid conversation/knowledge-
acceptance-and-inference/completions retrieval via the hub-avoiding crawl, with a new mandatory
§0.1 "canonical example first" step **and a new §3.4 "persona-sweep" mode** (parallel background
agents, each a genuinely different persona/frame rather than a different topic — the operator's own
proposed strategy for surfacing dead-ends like "john is a man" that single-frame exploration can't
reach by construction). The first live sweep already ran (5 parallel personas: total stranger,
deliberate breaker, non-native speaker, pure small talk, rushed/fragment-typing dev) and its two
highest-impact findings are folded into items 2 and 3 above; its lower-signal findings are item 10.
`CAPABILITIES_AUDIT_2026-07-10.md` refreshed against all four benchmark reports (DONE). Still open:
`SKILL_BENCHMARK_CEFR_ENGLISH.md` → `SKILL_BENCHMARK_CEFR_ENGLISH.md` with historic report renames to match,
a speculative comparative table (tmct vs. local/AWS/Anthropic model tiers, plus a to-be sketch), and
turning the persona-sweep's own transcripts into a proper `PLAYTESTBENCH_*` write-up plus regression
freezes for items 2/3 once fixed.

## Discipline (unchanged)

Repo-local identity (`antony@polycode.co.uk` / `Antony at Polycode`). `npm test` green at every
commit. Coordinator plus background sub-agents, disjoint file-ownership where possible, serialized
on shared files — this repo's heaviest-touched files (`src/chat.mjs`, `src/ask.mjs`) get edited by
one dispatch at a time, never in parallel, to avoid collisions. **A hard-won lesson from this
session**: background sub-agents sharing one working tree (no worktree isolation) can and did run
destructive/shared git operations (`git stash`) meant only for the coordinator — twice, both
recovered without loss, but now explicitly called out in every dispatch brief: sub-agents may only
`git add <their own files>` + `git commit`, never `git stash`/`reset`/`checkout --`/`clean`. Also:
the harness's permission system blocks `git commit` for *background* sub-agents entirely in some
configurations (no live user to approve a permission-gated action) — the coordinator does the
committing itself in the foreground when this happens, verifying `git status` immediately before
every stage to avoid sweeping in another track's pre-staged files (a real near-miss this session,
caught and fixed before it landed). No LLM in the product path, ever.

*Prior sessions' detailed handover (phases 0-13, releases 0.2.0 → 1.4.0) lives in this file's git
history plus the `CEFR_ENGLISH_*`/`AGENTBENCH_*`/`INFBENCH_*`/`PLAYTESTBENCH_*`/`archive/PLAN_*`
artifacts. `ROADMAP.md`'s "Where we are now" holds the fuller progress narrative for everything
shipped before the items above, including this session's own dated entry in full.*
