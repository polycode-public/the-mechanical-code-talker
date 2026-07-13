# BENCHMARK_CONVERSATION_1.5.7 — capped sprint (2 of 3 rounds, capped early by operator instruction), 4 dead-ends found and fixed

**Headline:** capped sprint mode (`SKILL_BENCHMARK_CONVERSATION.md` §3), round cap 3, **stopped after
round 2 on explicit operator instruction, mid-sprint** — not the doc's own "two clean rounds in a
row" stop condition. Both rounds that ran shipped a real fix (round 1 shipped three, round 2 shipped
one), so the well had not run dry; round 3 was never dispatched. Round 1 ran against
`examples/mini-webapp` via the real CLI (`node bin/tmct.mjs chat`), cold-opening with a Phase A
bootstrap-persona check (`SKILL_BENCHMARK_CONVERSATION.md` §0.1's mandatory canonical-example-first
move) before Phase B's codebase exploration. Round 2 continued naturally from round 1's own
transcript, chained by a background sub-agent per §3.1. **4 real dead-ends found and fixed and
shipped**, each verified live against the exact failing turn before commit, each frozen as a
regression test. **3 further real findings documented but not fixed** (two genuine grammar-shape
ceilings needing an operator scope decision, one intermittent completions-pipeline formatting bug
that didn't reproduce cleanly on a second attempt) — see each round's breakdown below. `npm test`:
**1869/1869 green** after both rounds' fixes.

**Timing (all times BST, from `git log`):**

| stage | time / hash |
| --- | --- |
| round 1 chat dispatched | 2026-07-11 ~09:57 (sub-agent launch) |
| round 1 fixes committed | 2026-07-11 10:27:48 — `e74a335` |
| round 2 chat dispatched | 2026-07-11 ~10:35 (sub-agent launch, chained off round 1's transcript) |
| round 2 fix committed | 2026-07-11 11:55:58 — `60505e6` |
| sprint capped by operator instruction | 2026-07-11 ~11:56, before round 3 dispatch |
| concurrency | 2 sequential background sub-agents (one per round, chained per §3.1), each round's CHAT step delegated while the coordinator appraised, fixed, and shipped in the primary session — this session also ran under heavy concurrent machine load from other simultaneous agent sessions, which materially slowed every `npm test` run (several single full-suite runs took 90s–500s; one run was killed by an over-tight timeout wrapper and looked like mass failure until re-run with a proper background job) |

## Per-round breakdown

### Round 1 — Phase A bootstrap canonical check + Phase B codebase exploration

**Tested (Phase A, §0.1's mandatory first move):** a bare bootstrap session (no `--repo`) —
greeting, the honest "are you an AI" identity question, the classic textbook syllogism ("john is a
man"), its recall ("is john a man"), a general-vocabulary lookup ("what is a dog"), and a closing
remark. **Tested (Phase B, against a tmpdir copy of `examples/mini-webapp`):** orientation,
class listing, `tell me more about Task`, three anaphoric follow-ups ("what calls it", "where's
that defined", "what does it inherit from"), a filler-word variant ("what's Record then"), imports,
calls, a compound-sentence teach attempt, a teach-then-infer follow-up, a broad "detailed summary"
question, a typo'd class lookup, commit-touch history, a cochange query, and a closing remark.

**Found and shipped (3 real dead-ends, all verified live against the exact failing transcript turn):**

1. **"thanks, that's everything for now" hit the raw grammar wall as the session's 6th turn**, even
   though an existing frozen single-turn regression test for the exact same phrase already passed.
   That test only pinned "the answer doesn't match the wall text" — which the isolated-turn
   fallthrough miss happened not to, masking that this phrase never actually reached the real warm
   sign-off in *any* session state. Root cause: the multi-clause thanks/farewell matcher
   (`farewellOrThanksSignal`, `src/chat.mjs`) gates every non-thanks clause to ≤3 words to avoid
   swallowing a real question ("cheers, what does X do") — "that's everything for now" is 4 words,
   so it never qualified. Fixed with a curated `CLOSING_FILLER_CLAUSES` exemption. Commit `e74a335`.
2. **`describeWrapperAnswer` ("tell me more about X") resolves and confidently describes a real
   entity but never told its caller which one** — so the session's focus was never updated, and the
   very next natural anaphoric follow-up ("what calls it", "where's that defined", "what does it
   inherit from") dead-ended on `"it" needs a selected node to refer to` right after the engine had
   just named one. This is the single highest-value fix of the sprint: it broke the exact drill-down
   pattern (`describe X` → `it`/`that` follow-ups) the product's own README leads with. Fixed by
   having `describeWrapperAnswer` also return the resolved entity, threaded through `nextFocus()` the
   same way the ordinary `ask()` object-resolution path already does. Commit `e74a335`.
3. **`describeWrapperAnswer`'s captured term never stripped a trailing bare discourse tag**
   ("tell me about Record then" tried to resolve the literal symbol `"Record then"` and failed) — the
   same class of bug `HANDOVER.md` 2026-07-10 item 8 already fixed for the meta-whatis vocab lane,
   never extended to this lane. Fixed by reusing the existing `stripTrailingDiscourseTag`. Commit
   `e74a335`.

**Found and documented, not fixed this round (real, but out of this sprint's scope):**

- **"what's Record then" (bare "what's ProperNoun", no "tell me about"/"describe" wrapper) fell to
  the generic orientation card**, not a description of Record. `DESCRIBE_WRAPPER_RE` only recognizes
  "tell me (more) about X" / "describe X" / "what(') s about X" — a bare "what's X" naming a proper
  entity is a genuinely new, unimplemented grammar shape, not a routing gap in an existing one. Same
  class of decision as the previously-documented "has-a-method teach shape" — needs an operator scope
  call, not a quick fix.
- **A compound-conditional teach sentence** ("every task needs to be approved by a user before it
  gets saved") hit the raw wall with no acknowledgment it was an attempted teach. This is a complex
  passive/temporal-clause sentence well outside the closed ACE-teach grammar's current shape set — a
  genuine ceiling, not a routing gap. The immediate follow-up compositional query it fed
  ("what imports something that writes to the database", round 2) correctly returned an honest,
  guided miss rather than a bare wall, which is the right behavior downstream of an unteachable premise.
- **"did TaskController and UserController ever cochange"** mis-parsed the whole conjunction phrase
  as one ambiguous entity name, producing a nonsensical self-referential disambiguation loop ("did
  you mean TaskController and UserController? Try one of those" — repeating back the exact phrase
  just given). The working sibling form ("does TaskController cochange with UserController") confirms
  the underlying capability is real; "X and Y `<symmetric-verb>`" is a distinct sentence shape (no
  "with", a bare conjunction subject) that the grammar doesn't parse into two entities at all. Real,
  but needs new parsing work, not a textual rewrite — left open for a future round.
- **A 3-clause elaborate closing remark** ("thanks, this was really helpful, that's all for now")
  still hit the wall even after fix #1 above, because its middle editorializing clause ("this was
  really helpful") is neither a thanks/bye phrase nor a curated closing filler. Per this project's own
  standing operator decision (`SKILL_BENCHMARK_CONVERSATION.md` §5, 

### Round 2 — continuing naturally from round 1, chained by a background sub-agent

**Tested:** re-establishing context (class listing, `tell me about Task`), a new entity
(`what about User`), imports, `tell me about UserController` (setting focus away from Task), a
test-coverage existential question, a codebase-fact teach attempt (a metaphorical "writes to the
database" claim), the compositional follow-up it fed, another broad "detailed summary" probe, and a
simple one-clause closing ("thanks, bye").

**Found and shipped (1 real dead-end, verified live):**

- **"is there anything that tests Task", asked right after focus had landed on UserController
  (from the immediately preceding "tell me about UserController"), answered "No — no tests edge
  found from UserController to Task"** — silently substituting the standing focus as the subject
  instead of treating "anything" as an open existential search. This is worse than a miss: a
  confidently wrong answer, stated with the same tone as a correct one. The sibling gerund phrasing
  ("is anything testing Task") already worked correctly (parses as the reverse-relation lookup, same
  as "what tests Task") — the relative-clause form ("...that tests Task") fell through
  `parseExistence`'s honest decline (`"anything"` isn't a real entity-kind noun) into the generic
  anaphoric ask-shape instead of the reverse lookup. Fixed with a closed textual rewrite,
  `existentialAnythingRewrite`: `"is there anything/something/anyone/anybody that/which/who
  <verb-phrase>"` → `"what <verb-phrase>"`, reusing the already-correct reverse-relation shape rather
  than adding new AST logic. Verified the rewrite doesn't touch the unrelated `"is there a <kind>
  called <name>"` existence-check shape (both still answer correctly). Commit `60505e6`.

**Found, tried to reproduce, not confirmed as fixable this round:**

- **A broad "detailed summary of how user handling works" question hit the raw grammar wall.** In
  round 1's own transcript, an equivalent "detailed summary" question against a *different* prior
  session history produced a garbled, malformed artifact (raw `Q:`/`A:` fragments pasted together)
  rather than either a coherent summary or a clean decline — a real, previously-observed bug in the
  `src/completions/` rescue lane's handling of a non-literal subject phrase ("task handling" / "user
  handling" isn't itself a graph entity). A deliberate attempt this round to reproduce the exact
  garbled-output shape (matching round 1's session history as closely as practical) instead produced
  a clean wall (an honest decline, not garbage) — the garbled-output condition is real (it was seen
  verbatim in round 1's actual transcript) but state-dependent in a way that didn't reproduce
  on a second, slightly different history. Flagged as the clearest next lever for a future round,
  not force-fixed on an unconfirmed repro.

## Ladder position

This sprint ran capped sprint mode against a fixed graph, not the qualitative Tier 0–6 flow ladder
(§2). Round 1's Phase A confirmed Tier 0 (bootstrap/identity surface, both plain and seeded) clean.
Across both rounds, what flowed without a dead-end spans Tier 1–3 territory (single-touch,
anaphora-carrying drill-down chains — now genuinely fixed, not just apparently passing — cross-concept
touches, existential/reverse-relation queries) plus a working teach-then-recall round-trip at Tier 5.
Real edges were hit at: a new (unimplemented) bare-"what's X" grammar shape, compound-conditional
teach sentences, symmetric-relation conjunction phrasing ("X and Y cochange"), 

## Next

- **This sprint was capped at round 2 by explicit operator instruction, mid-flight — not because it
  ran out of things to find.** Both rounds that ran shipped a real, verified fix (round 1 shipped
  three; round 2 shipped one); nothing suggests the well was dry. **Recommendation: run round 3 (or
  a fresh capped sprint) as the next step** — round 2's own remaining open item (the completions
  garbled-output repro) is a natural round-3 opener, continuing the chain.
- **Highest-leverage completed fix:** the `describeWrapperAnswer` focus-carry fix (round 1, #2) — it
  repairs the core "describe X → it/that follow-ups" drill-down pattern the product's own README
  leads with, not just the one flow it was found in.
- **Two real gaps need an operator scope decision, not a quick routing fix:** the bare "what's
  ProperNoun" grammar shape, and "X and Y `<symmetric-verb>`" conjunction parsing for cochange (and
  plausibly other symmetric/two-place relations).
- **One real gap needs a cleaner repro before it can be fixed:** the completions-rescue lane's
  garbled `Q:`/`A:` output for a "detailed summary" question under specific session histories.
- **Regression suite grew by 6 tests this run**, frozen in `test/chatflow-conversation-1.5.7-round1.test.mjs`
  (3 tests) and `test/chatflow-conversation-1.5.7-round2.test.mjs` (3 tests).
