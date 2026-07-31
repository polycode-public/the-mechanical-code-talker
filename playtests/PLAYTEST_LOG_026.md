tmct playtest 026 — miss-wall re-map at the post-fix baseline — a map, not a hunt
==================================================================================

tmct version under test: 2.11.9

Area: a full outcome-class sweep across the conversation surface — not a search for a new
edge, but a snapshot of where a broad probe set lands right now: the miss wall, the
orientation card, the fact lane, a graph answer, or the research lane. No fixes are made in
this log; every row records what happened, nothing is changed to make a row pass. This is the
false-accept-inventory format `PLAN_NLU_BENCHMARKS.md` describes (an outcome-mapped diagnostic
slice, not a per-edge fix cycle).

Probe recipe: piped chat sessions with `TMCT_NARRATE=1` (or `--narrate`) so every row's lane is
read off the trace, not guessed. Five session contexts:

- **pristine** — `tmct init --repo <scratch>` then chat, no teaching beyond what the probe
  itself does (the seed corpus, e.g. dog/IsA/HasA/CapableOf, is loaded by default).
- **code-graph** — `npm run example:mini`'s fixture (`examples/mini-webapp`), via
  `chat --repo examples/mini-webapp --ephemeral`.
- **taught** — a pristine session carrying a small taught fact chain forward turn to turn
  (kinship facts, a grounded/ungrounded penguin).
- **research** — a fresh pristine session exercising the `research <topic>` / `research next`
  network lane.

```bash
node bin/tmct.mjs init --repo "$SCRATCH"
printf '<probe lines>\n/exit\n' | TMCT_NARRATE=1 node bin/tmct.mjs chat --repo "$SCRATCH"
# code-graph session:
printf '<probe lines>\n/exit\n' | TMCT_NARRATE=1 node --disable-warning=ExperimentalWarning \
  bin/tmct.mjs chat --repo examples/mini-webapp --ephemeral
```

Probe table
-----------

Outcome classes: **WALL** (honest miss/decline), **ORIENTATION** (self-intro/greeting/
conversational card), **FACT-LANE** (a taught or seeded fact, teach store, or read-back),
**GRAPH** (a code-graph traversal answer), **RESEARCH** (the Simple English Wikipedia lane).
No FALSE-ACCEPT or FALSE-WALL turned up this round (see Summary).

| # | utterance | session | outcome | lane (per narrate) | note |
|---|---|---|---|---|---|
| 1 | hi | pristine | ORIENTATION | conversational — greeting (GREET closed set) | not a miss |
| 2 | what is a dog | pristine | FACT-LANE | (3) memory facts | canonical control, passes |
| 3 | does a dog have a tail | pristine | FACT-LANE | (3) memory facts | "yes — dog has tail"; in-scope, correct |
| 4 | is a dog an animal | pristine | FACT-LANE | (3) memory facts | yes/no paraphrase, passes |
| 5 | what's a dog | pristine | FACT-LANE | (3) memory facts | contraction paraphrase, passes |
| 6 | could you tell me what a dog is | pristine | FACT-LANE | (3) memory facts | politeness wrap, passes |
| 7 | what cannot fly | pristine | WALL | (2b) BARE META FACT | "nothing I remember says anything cannot fly" — honest, informative |
| 8 | dogs bark | pristine | FACT-LANE | (4) TEACH | bare plural declarative stores "dog capableOf bark" cleanly — the historical "gets the self-intro card" failure mode is not reproducible at this baseline |
| 9 | penguins swim | pristine | WALL | (2) HABITUAL GROUNDING HINT | ungrounded subject; names exactly what's missing rather than storing garbage |
| 10 | what do you think about javascript | pristine | WALL | (5) SHORT TAILORED MISS | opinion request |
| 11 | what is 2+2 | pristine | WALL | conversational — arithmetic decline (ARITHMETIC_RE) | math |
| 12 | what time is it | pristine | WALL | (4c) CAPABILITY NUDGE | time |
| 13 | tell me a joke | pristine | WALL | (5) SHORT TAILORED MISS | generation imperative |
| 14 | write a poem about dogs | pristine | WALL | (5) SHORT TAILORED MISS | generation imperative |
| 15 | delete all my data | pristine | WALL | (5) SHORT TAILORED MISS | imperative |
| 16 | sort this array for me | pristine | WALL | (5) SHORT TAILORED MISS | task imperative |
| 17 | whats the weather today | pristine | WALL | (4c) CAPABILITY NUDGE | weather |
| 18 | who won the election | pristine | WALL | (5) SHORT TAILORED MISS | current-events |
| 19 | recommend a restaurant | pristine | ORIENTATION | (2) conversational orientation, full card | short/no graph intent, flagged as a would-miss |
| 20 | can you write code for me | pristine | WALL | (4c) CAPABILITY NUDGE | generation |
| 21 | what cant tmct do | pristine | WALL | (5) SHORT TAILORED MISS | meta/capability question |
| 22 | zzyx qwerty blorp | pristine | ORIENTATION | (2) conversational orientation, full card | nonsense short string |
| 23 | waht is a dog (typo'd "what") | pristine | FACT-LANE | (3) memory facts | typo tolerated — read back as "dog can bark" (focus already on dog from row 8) |
| 24 | hw do i teach you something (typo'd "how") | pristine | WALL | (5) SHORT TAILORED MISS | typo not tolerated here — see Summary |
| 25 | does a dog have a tail | code-graph | WALL | (5) SHORT TAILORED MISS | **the historical PLAYTEST_LOG_001 cross-domain false-accept does not reproduce** — a code session now walls this instead of answering "defines" |
| 26 | what does store.mjs import | code-graph | GRAPH | via=composed | forward imports, correct |
| 27 | who imports store.mjs | code-graph | GRAPH | via=composed | reverse imports, correct |
| 28 | what calls Store | code-graph | GRAPH | via=composed | reverse calls, correct |
| 29 | what is store.mjs | code-graph | GRAPH | (1) META/SELF | describe-style self-answer, correct |
| 30 | what is a dog | code-graph | FACT-LANE | (4h) CHILD PACK | ephemeral code session has no seeded human corpus, so a clean miss pulls the term from the shipped ConceptNet child pack instead — different source, still correctly in-scope |
| 31 | who won the election | code-graph | WALL | (5) SHORT TAILORED MISS | out-of-scope control holds on a code session too |
| 32 | ahab is john's father | taught | FACT-LANE | (4) TEACH | stores "ahab fathers john" |
| 33 | who is john's father | taught | FACT-LANE | (3) memory facts | 1-hop read-back, correct |
| 34 | ahab's father is peleg | taught | FACT-LANE | (4) TEACH | stores "peleg fathers ahab" |
| 35 | who is john's grandfather | taught | WALL | (3) memory facts | "I don't know a relation or rule called 'grandfather' yet" — see Summary |
| 36 | is a dog not a cat | taught | WALL | (3) memory facts (composed miss) | "I can't confirm that either way — nothing I remember links dog and cat" — honest, offers the exact teach form |
| 37 | do all dogs bark | taught | FACT-LANE | (3) memory facts | universal-quantifier hedge ("I can't speak for all dogs — what I remember is generic, not universal") plus the actual fact, both in one answer |
| 38 | every penguin is a thing | taught | FACT-LANE | (4) TEACH | grounds "penguin" |
| 39 | penguins swim | taught | FACT-LANE | (4) TEACH | now stores "penguin can swim" — contrast row 9, same sentence, ungrounded vs. grounded |
| 40 | what cannot fly | taught | WALL | (2b) BARE META FACT | still nothing stored says "cannot fly" — nothing false-accepted from the swim fact |
| 41 | who is the father of ahab | taught | FACT-LANE | (3) memory facts | explicit "father of X" phrasing composes correctly where the atomic kinship term "grandfather" (row 35) does not |
| 42 | a penguin cannot fly | taught | FACT-LANE | (4) TEACH | stores "penguin cannot fly" |
| 43 | what cannot fly | taught | FACT-LANE | (2b) BARE META FACT | now correctly returns "penguin cannot fly" |
| 44 | what can penguin do | taught | FACT-LANE | (3) memory facts | "penguin can swim", correct |
| 45 | research dogs | research | RESEARCH | RESEARCH — depth-0 topic fetched, linked topics queued | live Simple English Wikipedia fetch, cited, 5 linked topics queued |
| 46 | research next | research | RESEARCH | RESEARCH — one queued topic fetched and grounded | queue walk continues correctly |
| 47 | research zzqxnonexistentwikitermabc123 | research | RESEARCH | RESEARCH — depth-0 topic fetched, linked topics queued (miss) | "I couldn't ground ... from Simple English Wikipedia just now — no matching article" — honest miss inside the research lane, not a fabricated grounding |
| 48 | solve it (no rules taught) | research | WALL | (1p) PLAN — plan lane — honest decline: no action rules | "no action rules taught yet — teach the game first" |

Summary
-------

Counts by outcome class (48 rows):

| outcome | count |
|---|---|
| WALL | 20 |
| FACT-LANE | 18 |
| GRAPH | 4 |
| ORIENTATION | 3 |
| RESEARCH | 3 |
| FALSE-ACCEPT | 0 |
| FALSE-WALL | 0 |

**No FALSE-ACCEPT and no FALSE-WALL row this round.** Two rows are worth flagging as
boundary cases for a future hunt, without being miscategorized as either:

- **Row 24, "hw do i teach you something"** walls where row 23's "waht is a dog" doesn't.
  Typo tolerance is not uniform — a one-letter transposition on a short high-frequency word
  ("what"→"waht") survives because "dog" alone still resolves the query; a longer phrase with
  two typos ("hw", context word "teach" present but the whole shape unparsed) does not. This
  reads as an emergent property of keyword resolution rather than a deliberate typo-tolerance
  feature, so it is not a bug by the product's own contract (nothing promises fuzzy spelling),
  but it is exactly the kind of unevenness a future edge hunt on the paraphrase ladder would
  want to probe further.
- **Row 35, "who is john's grandfather"** declines by name ("I don't know a relation or rule
  called 'grandfather' yet") rather than composing the two taught "fathers" facts. This is an
  honest, correctly labeled miss, not a silent wrong answer — and row 41 confirms the same
  information is reachable through explicit "father of X" phrasing, so the underlying facts
  are not lost, only the English kinship shorthand is unrecognized. Whether "grandfather"
  (and its family) should join the closed relation vocabulary is a candidate lever for
  `PLAN_NLU_BENCHMARKS.md`'s relation-coverage axis, not a defect found here.

Two rows (25, 30) show a control that would have been a known false-accept in an earlier
baseline: PLAYTEST_LOG_001's cross-domain leak ("does a dog have a tail" answered as a code
`defines` relation on a code-graph session) does not reproduce at 2.11.9 — the same probe on
the same kind of session now walls honestly (row 25).

Axes explored this iteration: the paraphrase ladder (contraction, politeness wrap, yes/no
invert) on a canonical fact; the ≤3-word conversational catch-all; short typo'd lines;
opinion/math/time/joke/generation/imperative/current-events out-of-scope shapes; canonical
in-scope controls on both a vocab and a code-graph session; cross-domain false-accept replay
from PLAYTEST_LOG_001; bare-declarative teach vs. ungrounded-subject teach; 1-hop kinship
read-back and composition via explicit phrasing vs. an unrecognized atomic kinship term;
universal-quantifier hedging; negation between two unlinked classes; grounded vs. ungrounded
negated-capability ("what cannot fly") before and after the fact is taught; the research lane
across a successful fetch, a queue continuation, and a topic that doesn't exist; the plan
lane's cold honest decline.

Axes still untouched: deeper research queue walks (3+ hops); the adventure/spider-fly game
lanes (covered separately in their own playtest rounds); HWU64/CLINC150-flavoured domain
vocabulary (banking, travel, alarms) per `PLAN_NLU_BENCHMARKS.md`'s own gap list; anaphora
("what is a dog" → "can it bark" → "what about cats") chains longer than one hop; multi-word
and awkward compound terms.
