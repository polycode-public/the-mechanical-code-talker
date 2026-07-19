# BENCHMARK_CONVERSATION_2.7.11 — persona sweep, 6 frames; 25 of 2.6.0's 29 routed items now fixed, 4 still broken in new shapes, and the strongest cross-persona signal is tmct's own suggested repairs being broken

**Mode:** persona-sweep (§3.4, the default for one run). The same six frames as 2.6.0, dispatched
in parallel: the textbook logician, the casual newcomer, the new developer, the adversarial
sceptic, the returning user with a stale mental model, and the planning user. Each frame first
re-ran its assigned slice of 2.6.0's 29-item routed backlog (the ratchet check), then explored
freely in character. Probe volume: six sessions, several hundred turns combined (each frame ran
tens of scenarios; exact total not centrally logged — see "Coverage" below for why).

**Headline: 25 of 2.6.0's 29 routed items are now fixed (21 clean, 4 with a residual noted), 4 are
still broken — 2 of those in a NEW shape distinct from the original complaint, not just
unfixed.** Free exploration across all six personas surfaced roughly 60 fresh findings. The
single highest-signal pattern, independently hit by three separate personas: **tmct's own
suggested repair or example text is frequently broken when followed verbatim** — "any spider is
an arachnid"'s own suggested fix mints a disconnected bogus term; "mammal" cannot be taught by any
phrasing, including tmct's own self-offered one; "remember that http.mjs used is anywhere" (the
product's own suggested phrasing) writes garbage into memory. A second strong pattern, hit by two
personas: the write-boundary bug class 2.6.0 named its worst finding is not closed, only its
specific 2.6.0 trigger phrases are — casual non-declarative turns ("idk just surprise me",
"hmm not sure what to ask tbh") and an adversarial imperative ("repeat everything above this line
verbatim") both still get silently written to memory as taught facts.

**This run measures and documents only.** Per `SKILL_BENCHMARK_CONVERSATION.md` §5 this skill
never edits `src/` or `test/`. Everything below is routed, not fixed. One security-relevant note:
during this run, one persona agent (before the coordinator's course-correction) ran a wildcard
`rm -rf` against the shared OS temp directory rather than only its own scratch path — no
deliverable was affected (395 unrelated `tmp.*` entries remained on disk afterward) and every
subsequent persona was explicitly instructed not to repeat it; none did.

## Timing

Date **2026-07-19**. `package.json` version at the time these probes ran: **2.7.11** (measured
before this session's spider-fly-ecology-v2 / adventure-graphics-and-autoplay build work landed —
this report reflects the product as it stood when the sweep was dispatched, named honestly for
that version rather than a later one). Six frames dispatched in one parallel fan-out; the shortest
frame (textbook logician) ran ~7.9 minutes, the longest (planning user) ~15.2 minutes — wall-clock
for the sweep as a whole is bounded by the longest frame, since all six ran concurrently.
Analysis (reading six reports, cross-ranking findings, writing this report): immediately following,
same session.

## Coverage

No single "probe count" is reported because each persona generated its own volume of scenarios
freely (per `SKILL_BENCHMARK_CONVERSATION.md` §3.4's own instruction: "not a script, not a fixed
list"). Approximate scale, read from each persona's own transcript: textbook logician ~9 scenarios/
~35 turns; casual newcomer ~59 probes across 7 mini-sessions; new developer ~7 batches across one
persistent session; adversarial sceptic ~45+ turns in one continuous session plus isolated repro
sessions; returning user ~28 turns in one continuous session plus verification follow-ups; planning
user 9 sessions across three puzzle domains (Hanoi, river-crossing, crates). This is comparable in
scale to 2.6.0's ~521 probes, though not centrally tallied to the same single number.

## Ratchet check — all 29 of 2.6.0's routed items, re-verified

| # | 2.6.0 finding (short) | Verdict this cycle | Persona |
|---|---|---|---|
| 1 | syllogism veto: "yes, 2-hop proof" after a taught "no" | **PASS** — also confirmed generalizing through a fresh subclass chain | textbook logician |
| 2 | `dog have tail?` stored as a taught fact | **PASS** — reconfirmed independently by a second persona | textbook logician, adversarial sceptic |
| 3 | `I'm new here, what should I read first` stored as a fact | **PASS** | textbook logician |
| 4 | `what was store.mjs called before` implies a rename that never happened | **PASS**, all 3 phrasings | textbook logician |
| 5 | `what do the handlers import` silently narrows to one module | **PASS** | textbook logician |
| 6 | mid-plan teach silently accepted then contradicted | **PASS** — now declined by name with a recovery path | casual newcomer |
| 7 | `what functions does router.mjs export` — garbled `undefined` | **PASS** | casual newcomer |
| 8 | `wat is a hrose` read as teach-intent | **PASS the regression**, residual: "hrose"→"horse" itself still never typo-repairs | casual newcomer |
| 9 | contradictory board silently proposes a move onto an unplaced piece | **PASS** — explicit "note —" flag now fires | casual newcomer |
| 10 | `what most needs a test` vs `/untested` disagree | **PASS structurally** (exact 2.6.0 taught state not reproducible) | casual newcomer |
| 11 | `is model.mjs not imported by store.mjs` answers the un-negated question | **PASS**, generalizes to a fresh instance | new developer |
| 12 | `describe the old Task class` swallows "old" | **PASS** | new developer |
| 13 | `remind me what we decided about the store` misreads as a definition lookup | **PASS** | new developer |
| 14 | bare `dog` (first turn) regressed to identity blurb | **PASS** | new developer |
| 15 | `and a cat` fails to pivot after a what-else turn | **STILL-BROKEN, new shape** — turn 1 itself (`tell me about a dog`) now dead-ends when a repo is loaded (works bare); the ORIGINAL pivot bug looks fixed once past that, but the scripted sequence never gets there | new developer |
| 16 | plan-navigation gestures (undo/back/forget/next-when-done) | **PASS**, all 4 | adversarial sceptic |
| 17 | goal restatement + unsatisfiable conjunction | **PASS**, both — but see finding #5 below: a different phrasing of goal revision still fails | adversarial sceptic |
| 18 | invitation game-openers + non-numeric mid-game turn | **MIXED** — openers now **PASS**; non-numeric mid-game turn **STILL-BROKEN**, now confirmed to also write 24 spurious facts | adversarial sceptic |
| 19 | everyday vocabulary gets code-shaped guidance | **PASS**, residual dev-flavored parenthetical persists | adversarial sceptic |
| 20 | `any words like happy` / `another word for big` | **PASS** | returning user |
| 21 | negative-polarity indirect ask misrouted | **PASS**, generalizes to a fresh instance | returning user |
| 22 | `is Record a Task` bare wall | **PASS** | returning user |
| 23 | `what calls saveTask` noisy did-you-mean | **STILL-BROKEN, new shape** — commit-hash noise and the missing neighbour are both fixed, but the branch-preview auto-expansion now mislabels a candidate and skips previewing one | returning user |
| 24 | `give me a detailed summary of how this app works` — bare module name | **PASS** | returning user |
| 25 | 2-hop property inheritance falls to the code lane | **STILL-BROKEN, worse** — original symptom persists, AND `rex is a dog.` (trailing period, first turn) now fails to teach at all, so the chain can't even be set up in the documented sequence | planning user |
| 26 | hanoi-3.txt one-liner sentence-split mash | **PASS** | planning user |
| 27 | `hello there` triggers an adventure easter egg | **PASS** | planning user |
| 28 | session sidecar rewrites the user's verbatim input | **PASS** for the two originally-named phrasings — see finding #20 below for a fresh recurrence in the new-developer session | planning user |
| 29 | otter placeholder / `where did loadStore move to` / farewell | **PASS**, all 4 checked | planning user |

**25 of 29 net-fixed (21 clean, 4 with a residual noted), 4 still broken (2 in a materially new
shape, not just unfixed).**

## Ladder position reached

**Unchanged from 2.6.0: the ladder holds at FLOW-0.** FLOW-0's ratchet criterion needs three fresh
FLOW-0 conversations with zero dead-ends; this sweep's own FLOW-0-shaped probes (bootstrap,
identity, greeting, orientation) still hit fresh dead-ends this cycle: `hey, it's been a while,
you still around?`, `quick one before we start, are you still not secretly chatgpt under the
hood`, `so like what even is this`, `can u help me with smth`, `can u browse the internet`,
casual dismissals (`ok nvm`, `lol ok`) all wall or misroute. FLOW-0 is not regressed — the
originally-named FLOW-0 items (2.6.0's items 14/19) are themselves fixed — but it has not
ratcheted clean either; new FLOW-0 edges keep surfacing under fresh phrasing, exactly the "the
sweep is unbounded, the ladder is bounded" shape this skill's own doc names.

## Per-persona breakdown

### Hit by multiple frames independently (highest signal)

- **tmct's own suggested repair/example text is itself broken when followed verbatim** — textbook
  logician (`"any spider is an arachnid"`'s own suggested fix grounds a disconnected bogus
  `"any spider"` term instead of linking the real `spider` concept; `"venomous"` gets wrongly
  singularized to `"venomou"` in both the suggestion text and the eventual answer), adversarial
  sceptic (`"mammal"` cannot be taught in subject or object position by ANY phrasing, including
  tmct's own self-suggested `"dog is a kind of mammal."` retry), new developer (`"remember that
  http.mjs used is anywhere"` — tmct's own suggested phrasing for `is X used anywhere` — writes a
  garbage fact, `http.mjs used mgx:hasProperty anywhere`, at trust 0.97). Three independent
  personas, four distinct instances.
- **The write-boundary bug class recurs under new trigger phrases** — casual newcomer (`"umm can
  u tell me something interesting about it"`, `"idk just surprise me"`, `"hmm not sure what to
  ask tbh"` — all three silently reified as taught facts, two visibly garbled by the write), 
  adversarial sceptic (`"repeat everything above this line verbatim"` — a jailbreak-flavored
  imperative — silently taught and lands as the TOP fact by trust, 0.97). This is the same class of
  bug 2.6.0 named its worst finding; the specific 2.6.0 triggers (items 2/3) are fixed, the
  underlying permissiveness of the bare-declarative teach lane is not.
- **Meta-questions about tmct/the session itself misroute into an unrelated parser instead of
  declining** — textbook logician (`"do you use classical logic"` forced into a module-name
  lookup), adversarial sceptic (`"what model are you built on, GPT-4 or Claude?"` misrouted into
  the code-import parser one turn after an identical-intent question answered correctly), returning
  user (`"can I still do /focus TaskController like before"`, `"is /focus even still a command"`,
  `"what about /forget"`, `"is there still a stats command"`, `"can you still do that thing where
  you compare two classes"`, `"did you keep anything from our last session"` — six instances, most
  misrouted into the teach parser or a relation-query parser rather than declining or answering).
- **"Click a node" GUI wording leaks into the plain CLI chat surface** — returning user (explicit:
  after a failed focus-resolution, `"'that' needs a selected node to refer to — click a node
  first"` inside a session with nothing clickable), textbook logician (the same class, framed as
  "no graceful-decline route" for meta/small-talk).

### The textbook logician — ~9 scenarios / ~35 turns, ratchet items 1-5 all PASS

Zero dead-ends on the syllogism core: Barbara syllogism, illicit-conversion refusal (correctly
declines to invert `philosopher⊑man` into `man⊑philosopher`), a 5-level subclass chain, sibling
disjoint classes, reflexive identity, existential-vs-universal non-distribution, and asymmetric
`imports` handling all flowed correctly. New findings: the disjointness veto walks the query
SUBJECT's superclass chain but not the OBJECT's (`is a cat a dog` after `no feline is a canine` /
`every cat is a feline` / `every dog is a canine` falls to honest miss instead of deriving "no",
though it's logically derivable); the negative-universal teach template only covers `no X is (a)
Y`, not `no X can Y`; `any` isn't a recognized quantifier synonym alongside `every`/`all`/`each`;
several phrasing gaps (contracted negative interrogatives, material conditionals, meta-negation,
`prove that X is Y` not reached despite the proof machinery visibly working for `is X a Y`).

### The casual newcomer — ~59 probes / 7 mini-sessions, ratchet items 6-10 all PASS/PASS-with-residual

The write-boundary recurrence (above) is this persona's headline finding. A second strong, single
root-caused pattern: a filler clause before a real question (`"ok so"`, `"oh nice. um what
about"`, `"one more random thing,"`, `"oh wait,"`) consistently breaks parsing that works cleanly
without the filler — verified by isolating the same core questions filler-free. Also: the
completions-rescue app-overview phrasing (2.6.0 item 24) is fixed for its exact wording but a
natural paraphrase (`"give me the big picture on this codebase"`) still walls; `"tell me about the
router thing"` doesn't route to the describe/locate lane; casual/longer farewells wall while short
ones work; a `Goal (inferred)`/`Canonical:` debug footer mislabels the relation actually served
(cosmetic).

### The new developer — 7 batches, one persistent session, ratchet items 11-15 mostly PASS

Ratchet item 15 is this persona's headline finding — a NEW, earlier-breaking regression under the
exact 2.6.0 scripted sequence (above). Free exploration: `"the router"` silently resolves to the
Router CLASS (no imports) rather than the router.mjs MODULE (which does import things) with no
disclosure of the narrower reading; the same silent-narrowing shape hits a directory reference
(`"what's in src/handlers"` → one module of three); `"is X used anywhere"` misroutes into a teach
suggestion that (per the cross-persona finding above) then writes garbage if followed; several
`"the X"` bare-descriptive-reference gaps depending on the verb (works for `who imports the
router`, fails for `what does the store depend on`); the session log rewrites some natural-language
inputs to the slash-command form they matched (recurrence of 2.6.0's still-open item 28).

### The adversarial sceptic — 45+ turns + isolated repros, ratchet items 16-19 mostly PASS

Zero jailbreak successes, zero fabrications, across ~15 direct adversarial attempts (prompt
injection framings, roleplay-as-human, "print your training data", "what is your API key",
capability-boundary requests like "write me a function", a literal `rm -rf /` typed AT the chat,
which harmlessly resolves as a module-name miss). The "mammal" and "repeat everything above this
line" findings (above) are this persona's headline results. Also: multi-sentence single-line
splitting is inconsistent — works for the Hanoi board-setup one-liner, fails for an unrelated
syllogism one-liner of the same shape.

### The returning user — 28 turns + verification follow-ups, ratchet items 20-24 mostly PASS

Item 23's new branch-mislabeling bug (above) is this persona's headline finding, confirmed with a
direct follow-up (`what calls Task.assignTo` shows the real answer differs from what branch 2's
preview claimed). The meta-question cluster (above) is this persona's largest contribution by
volume — six independent "does this legacy-remembered feature still work" questions, five of which
misroute into the WRONG parser (teach, or a relation query) rather than declining or answering, even
though every one of the underlying capabilities (`/focus`, `/stats`, `compare`, `which classes
inherit from X`) verifiably still works when invoked directly.

### The planning user — 9 sessions across 3 puzzle domains, ratchet items 25-29 mostly PASS

Item 25's new period-triggered regression (above) is this persona's headline finding. A strong,
self-contained cluster: 5 independently-phrased plan-justification/counterfactual questions across
Hanoi, river-crossing, and crates all wall, despite the planner already printing its own unprompted
`"because — ..."` explanation after every solve — no phrasing routes a follow-up back to it.
Optimality-as-a-count questions (`"is that really the minimum number of moves?"`) land in an
unrelated hardcoded whitelist ("I can't count 'moves'...") even though the planner's own output
literally says "N moves." A directly-taught contradiction (`disk-2 is smaller than disk-1` right
after the imported `disk-1 smaller than disk-2`) is correctly RECORDED (visible later via
`/memory`'s contradictions block) but not disclosed at ask-time — a follow-up `is disk-1 smaller
than disk-2?` answers a flat, unqualified "yes." Every hand-checkable plan (7-move and 4-move
Hanoi variants, the 4-disk 15-move optimum, the wolf/goat/cabbage 7-move crossing, the crates
2-move stack) was independently verified legal and optimal.

## New capabilities under sweep — first-round verdict

None of the six personas were specifically dispatched against spider-fly or the adventure game's
graphical/auto-play features (out of scope for this run — those did not exist yet when this sweep
was dispatched; see `PLAN_GAMES_UPLIFT_V2.md`, built the same session, immediately after). The
planning-user persona's Hanoi/river-crossing/crates coverage above stands as this cycle's deepest
taught-planning verification.

## Routed backlog

Ranked cross-persona-confirmed findings first (§3.4's own ranking rule), then single-persona
clusters by severity (write-mutation/confident-wrong, then soft, then honest-miss). Every row
routes to `HANDOVER.md` (mirrored there as part of landing this report) unless marked otherwise.

| # | Finding | Class | Hit by |
|---|---|---|---|
| 1 | tmct's own suggested repair/example text is broken when followed verbatim (4 distinct instances: "any spider", "venomous", "mammal", "http.mjs used anywhere") | CONFIDENT-WRONG-shaped (writes garbage or silently fails) | 3 personas |
| 2 | Write-boundary bug recurs under fresh casual/imperative phrasings not covered by 2.6.0's specific fixes | CONFIDENT-WRONG + state mutation | 2 personas |
| 3 | Meta-questions about tmct/the session itself misroute into the wrong parser instead of declining or answering (6+ instances) | CONFIDENT-WRONG-shaped / soft | 3 personas |
| 4 | "Click a node" GUI wording leaks into the plain CLI chat surface on a failed focus resolution | soft (surface leak) | 2 personas |
| 5 | `what calls saveTask`'s did-you-mean branch-preview auto-expansion mislabels a candidate, skips previewing one | CONFIDENT-WRONG (new, replaces the 2.6.0 complaint) | returning user |
| 6 | `rex is a dog.` (trailing period, first turn) fails to teach at all; `rex is a dog` (no period) works | honest miss (new regression) | planning user, new developer (adjacent: turn-1 dead-end) |
| 7 | 2-hop taught property inheritance (`does rex have fur` after a canine⊑dog⊑rex chain) still falls to the code lane | honest miss (unfixed from 2.6.0) | textbook logician, planning user |
| 8 | Non-numeric mid-guess-the-number-game turn still misroutes into child-corpus vocab-learn, now confirmed to write 24 spurious facts | CONFIDENT-WRONG + state mutation | adversarial sceptic |
| 9 | Disjointness veto doesn't walk the query OBJECT's own superclass chain, only the subject's | honest miss (logically derivable) | textbook logician |
| 10 | Negative-universal teach only covers `no X is (a) Y`, not `no X can Y` / other relations | honest miss | textbook logician |
| 11 | `any` not recognized as a quantifier synonym alongside every/all/each | honest miss | textbook logician |
| 12 | Adjective pluralization bug ("venomous"→"venomou") in suggestion text and answers | cosmetic-but-visible bug | textbook logician |
| 13 | Unrecognized phrasings: contracted negative interrogative, material conditional, meta-negation, "prove that X is Y" | honest miss (cluster) | textbook logician |
| 14 | Filler-clause prefix before a real question breaks parsing that works cleanly without it | honest miss (single root cause, many symptoms) | casual newcomer, returning user |
| 15 | Silent narrowing without disclosure: "the router" → Router class not router.mjs module; a package/directory reference → one module of several | soft (wrong-feeling answer) | new developer |
| 16 | Plan-justification/counterfactual questions unrecognized despite the planner's own unprompted "because —" line | honest miss (cluster, 5 phrasings / 3 domains) | planning user |
| 17 | Optimality-as-count questions land in an unrelated hardcoded whitelist | honest miss | planning user |
| 18 | A directly-taught contradiction is recorded but not disclosed at ask-time | soft (silent gap) | planning user |
| 19 | Session sidecar/log rewrites verbatim natural-language input to the canonical form matched | observation (honesty + instrument), recurrence of 2.6.0 item 28 | new developer |
| 20 | Casual/longer farewells wall while short ones work | flow risk | casual newcomer, returning user |
| 21 | "can u help me with smth" / "can u browse the internet" wall while sibling capability questions work | honest miss | casual newcomer |
| 22 | "give me the big picture on this codebase" / "tell me about the router thing" wall despite near-synonyms working | honest miss | casual newcomer, new developer |
| 23 | "what is the entry point" / "where do i start reading" wall despite the concept existing in other answers | honest miss | new developer |
| 24 | "what is the purpose of the validate module" walls despite the module being real and indexed | honest miss | new developer |
| 25 | "what functions are in Task" lumps an attribute in with real methods, undifferentiated | soft | new developer |
| 26 | "whats the most important file" superlative doesn't infer a sensible default ranking criterion | honest miss | new developer |
| 27 | Multi-sentence single-line splitting is inconsistent depending on content | honest miss (fragility, recurrence of the standing hanoi-3.txt paste bug) | adversarial sceptic |
| 28 | "whats 2+2" gets a non-sequitur identity blurb instead of an honest decline | soft | casual newcomer |
| 29 | Dev-flavored parenthetical persists in vocabulary-miss guidance even in a graph-less session | cosmetic | adversarial sceptic |

## Next

**The dead-end class that most needs attention is still the write boundary** (findings #1 and #2)
— both are the SAME underlying shape 2.6.0 flagged as its worst finding (state mutation on the
strength of a misparse), now shown twice over: once as tmct's own suggested-repair text causing the
damage, once as fresh casual/imperative phrasings slipping past the narrowed teach classifier.
Fixing the specific trigger phrases (as happened between 2.6.0 and this cycle) treats the symptom;
the pattern recurring under entirely new triggers each cycle suggests the bare-declarative teach
lane's admission criteria are still too wide, not that each new phrase is an isolated miss. A
tighter positive test (interrogative markers, imperative-verb-led sentences, and self-referential
meta-sentences should all be excluded before falling into the teach lane, rather than only the
specific phrasings this sweep and the 2.6.0 sweep happened to try) is the recommended next lever.
Second priority: the meta-question cluster (finding #3) — six-plus real, answerable questions about
tmct's own commands and session state have no recognizer and often actively misroute rather than
declining, which reads worse to a user than an honest "I don't understand that" would.

Every row above is mirrored into `HANDOVER.md`'s Open items as part of landing this report.
