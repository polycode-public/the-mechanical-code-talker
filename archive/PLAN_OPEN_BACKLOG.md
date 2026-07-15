# PLAN_OPEN_BACKLOG.md — delivering the deferred playtest edges and every open HANDOVER item

Status: DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

Two sources, folded into one delivery plan:

1. The edges playtest logs 009–014 deferred openly (each named in its own log's "Known
   remainder" section) rather than fixing in-dispatch.
2. The `HANDOVER.md` "Open items" list as of v1.11.5.

Each item below names its owner file(s), the fix layer per `SKILL_PLAYTEST_EDGE_HUNT.md` §5's
map, and its acceptance test. Workstreams have disjoint file ownership so they can run as
concurrent background sub-agents (coordinator model, `CLAUDE.md`); the two heavy files
(`src/chat.mjs`, `src/ask.mjs`) are each owned by exactly one workstream.

## Workstream A — chat-layer language edges (owns `src/chat.mjs`, `src/grammar/`)

Ordered by expected yield. All follow the templating discipline: closed frames or candidate
rewrites onto lanes that already exist, never a widened general rule.

- **A1. Verb-inflected relational teach** — "ahab fathered john" (log 011). A closed
  past-tense fold onto the existing relational teach: "X <verb>ed Y" → the same
  `generalVerbPredicate` mint "X is the <verb-base> of Y" uses, for a curated -ed shape
  (strip "-ed"/"-d", tolerate the doubled-consonant form). Same grounding gates as
  `RELATION_FACT_TEACH_RE`. Accept: teach "ahab fathered john", then "who is the father of
  john" answers ahab; a non-relational past verb ("the build failed") never stores.
- **A2. Conjunction teach** — "ahab is male and is the father of john" (log 011). Split on
  a top-level " and (is|has|can) " into two payloads run through the ordinary teach cascade
  in order; confirmation names both stored facts, and a half-failure says which half
  declined (never a silent partial store). Accept: both facts stored and readable; "ahab is
  male and the weather is nice" stores the first and declines the second honestly.
- **A3. Multi-hop kind filter in reverse capability** — "which animals can fly" resolves
  kind membership through DIRECT isa facts only (log 010). Reuse `findIsaChain`
  (`src/syllogise.mjs`) in `WHICH_KIND_CAN_RE`'s filter, bounded to the same hop budget the
  is-a proof chase uses. Accept: teach "every sparrow is a bird" (bird already isa animal),
  teach "a sparrow can hop", ask "which animals can hop" — sparrow surfaces with the chain
  cited.
- **A4. Unknown-subject habitual decline** — "penguins swim" falls to the conversational
  card (log 013). When `matchBareHabitualTeach` matches but the subject noun is ungrounded,
  divert to the honest teach-decline ("I don't know 'penguin' yet — ground it first, e.g.
  'every penguin is a thing'") instead of the self-intro card. Accept: "penguins swim" gets
  the grounding hint; the hint's own phrasing round-trips; "jokes please" still gets the
  conversational card.
- **A5. Proper-name general-verb teach nudge** — bare "john likes mary" stays
  wrapper-required BY DESIGN (log 013; storage-safety decision, not re-litigated here). Add
  the nudge only: a closed Name-verb-Name recognizer on the would-miss path suggesting the
  wrapped form ('to store that, say: remember that john likes mary'). Accept: bare form
  nudges and stores nothing; wrapped form still stores; "is john happy" untouched.
- **A6. Superlative over taught comparatives** — "which disk is smallest" after teaching
  pairwise "disk-1 is smaller than disk-2 …" (log 009). A bounded transitive chase over one
  `mgx:<comparative>-than` predicate: answer only when the taught pairs form a single
  unambiguous chain; two disconnected components stay an honest can't-order decline naming
  the missing comparison. Accept: 3 taught pairs → "disk-1" with the chain cited;
  incomplete orderings decline and name what's missing.

## Workstream B — ask-engine items (owns `src/ask.mjs`, render/label helpers)

From the seonix cross-repo backlog (`HANDOVER.md`; origin `~/.claude/inboxes/mechanic.md`).

- **B1. Describe-paraphrase coverage** — "what is X for" and "what does X do in Y" aren't
  recognized shapes for code-graph entities even when other phrasings resolve the same data
  (3 confirmed instances). Fix layer: `PHRASING_FRAMES` rewrites onto the existing describe/
  purpose shapes — no new traversal. Accept: both phrasings answer identically to the
  passing paraphrase on the seonix repro graphs; vocabulary-side "what is a horse for"
  keeps its memory-facts answer (regression-pin it — A-side owns that behavior).
- **B2. Disambiguation ranking for entry points** — "where is the main entry point defined"
  sprays across unrelated Java/test-fixture `main` matches with no relevance ranking. Add a
  deterministic rank (exact-label > path proximity to the graph root > non-fixture over
  fixture paths), disclosed in the answer ("ranked N matches; top: …"), never dropping
  matches silently. Accept: the seonix repro puts the real entry point first and says how
  many others matched.
- **B3. Label-spacing cosmetic** — a rendered type like `GlobalVariable` loses its word
  break. One display-side fix in the label renderer + a byte-exact test. Accept: rendered
  as "Global Variable" (or the codebase's chosen convention) everywhere labels render.

## Workstream C — planner/game follow-ups (owns `src/router/`, `src/domain.mjs`, `src/plan*.mjs`)

The 1.11.0 follow-ups named in `ROADMAP.md`, code half.

- **C1. River-crossing completion** — the two missing frames plus the multi-effect
  interpreter extension. Accept: the river-crossing domain teaches, plans, and replays
  end-to-end in a piped session, same bar the hanoi/crates domains meet.
- **C2. Planner-side consumption of `taught:` capability records** — the router's
  registered capabilities exist; the planner doesn't consume taught ones yet. Accept: a
  taught action rule becomes a usable planner operator in the same session, verified by a
  solve that needs it.

## Workstream D — syllogist justification extension (owns `src/syllogise.mjs`, `src/memory/` trust hooks)

- **D1. Justification for the four remaining entailment rules** — scm-sco's retraction
  slice shipped; cax-sco / cax-dw / cls-svf1 / scm-svf1 don't carry justification yet.
  `HANDOVER.md` calls this a mechanical extension of the shipped pattern, and that is the
  scope: same bounded re-verified local check, one rule at a time, one test per rule
  (retract a premise → the entailment retracts; an independently-justified fact survives).
  The full ATMS generalization (de Kleer 1986) stays on `ROADMAP.md`'s research horizon —
  explicitly OUT of this plan.

## Workstream E — playtest dispatch (process, no code ownership)

- **E1. Instance-name ask-lane sweep** — the one Phase-1R boundary sweep never run:
  hyphenated/numbered instance names (disk-1, peg-a) through the code-graph ask/resolve
  lanes. Kickoff verbatim from `HANDOVER.md`: "Follow SKILL_PLAYTEST_EDGE_HUNT.md, sweep
  instance-name shapes through the ask lanes." Runs main-thread per that skill; schedule it
  when A and B are NOT mid-flight (it edits whatever layer the edges land in, most likely
  `src/chat.mjs`/`src/ask.mjs`).
- **E2. Probe rule-teach frames and goal sentences as features** — both shipped in 1.11.0;
  they've never had a hostile playtest as features (the old boundary probes predate the
  implementation). One edge-hunt iteration each, logged in the 015+ series.

## Workstream F — measurements and operator decisions (docs/site track, no src ownership)

- **F1. `init:xxl` real fact count** — run `npm run init:xxl` once, record the measured
  count and wall-clock in `HANDOVER.md`, close the standing follow-up.
- **F2. Ledger bundle weight** — ~533 KB measured. Decide: budget it (document the number
  and stop), or trim (the viz bundles are the known heavy part). Outcome is a decision
  recorded in `PLAN_VIZ_LEDGER.md`'s addendum, with implementation only if "trim" is chosen.
- **F3. factAnswer goal-field in the ledger dock** — needs operator sign-off
  (`ROADMAP.md`). Present the question with a mockup line; implement only on approval.
- **F4. findContradictions cardinality question** — same shape: a design question named in
  `ROADMAP.md`, needs a decision before code.

## Explicitly out of scope

- **ATMS generalization** — research horizon (see D1).
- **`PLAN_ADVENTURE.md`** — has its own design doc; delivering it is its own dispatch, not
  a backlog line here.
- **seonix `tmct.toml` persona re-activation** — cannot close from this repo
  (`HANDOVER.md`'s standing cross-repo note); stays where it is.

## Sequencing and ship discipline

1. A and B run first, concurrently (disjoint ownership: A owns `src/chat.mjs`, B owns
   `src/ask.mjs`; the one shared seam — B1's regression pin on A-owned vocabulary behavior —
   is a test file, coordinated through the coordinator). C and D can start alongside; F is
   fire-and-forget background measurement plus two operator questions to raise early.
2. E1/E2 run AFTER A and B land (they will find edges in the same files; one dispatch at a
   time on `src/chat.mjs`/`src/ask.mjs` per the standing discipline).
3. Every workstream ships per completed item: regression test named for the behavior,
   `npm test` green, CLI smoke green, commit with the repo-local identity. Version/push
   cadence follows the operator's prompt instructions at dispatch time — this plan does not
   set one.
4. Each item's log/addendum goes where its family lives: A/E items in `playtests/` logs,
   B items cross-referenced back to the seonix inbox, C/D/F as dated addenda in their
   owning PLAN docs. `HANDOVER.md`'s open-items list shrinks by one line per shipped item —
   pointers move, narrative stays out.
