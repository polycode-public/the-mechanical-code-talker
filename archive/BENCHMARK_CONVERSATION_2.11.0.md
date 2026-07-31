# BENCHMARK_CONVERSATION_2.11.0 — persona sweep, 6 frames; the pronoun-"I" teach misparse and the are-you-an-LLM family are the top cross-persona hits, one write-boundary bug recurs

**Mode:** persona-sweep (§3.4, the default for one run). Six frames, each in its own
`mktemp -d` copy of `examples/mini-webapp`, driving the real CLI: a total stranger, a
deliberate breaker, a non-native English speaker, someone doing pure small talk, a rushed
on-call developer, and a skeptical boundary-tester probing README's own stated claims. No
`Agent`/`Task` tool was available in this run's toolset (checked via `ToolSearch`), so the
coordinator ran each persona's chat step directly instead of dispatching it to a background
sub-agent. The discipline (isolated tmpdir, real CLI, verbatim capture, judgment deferred
to the coordinator pass) is unchanged; only the delegation mechanism differs from a normal
run.

**Headline: the mandatory canonical example (§0.1) passed clean.** A fresh mini-webapp
copy correctly taught "john is a man", "socrates is a man", "every man is mortal" and
correctly inferred "yes ... so socrates is a mortal" without ever touching code vocabulary.
**Free persona exploration surfaced 29 dead-ends and one severe write-boundary bug.** The
single highest-signal pattern, hit independently by two personas across three instances: a
sentence that opens with "I" ("I am new here", "I want to know...", "I read your README, I
want...") gets swallowed into the teach lane's subject parser, which then declines with a
confusing "I can't store a fact about 'i' as a class" message instead of recognizing an
ordinary conversational opener. Tied for top signal: the "are you an LLM / what model are
you" family still misroutes under casual phrasing (three personas, three distinct wordings),
even though this exact class was named fixed in earlier cycles. The most severe single
finding is a fresh write-boundary bug: a rushed, fragment-typed real question about a real
module ("k what abt users.mjs") gets silently written into memory as a garbage taught fact.
This is a recurrence of the write-boundary class 2.7.11 named its worst finding, now under yet
another new trigger phrase.

**This run measures and documents only.** Per `SKILL_BENCHMARK_CONVERSATION.md` §5 this
skill never edits `src/` or `test/`. Everything below is routed, not fixed.

## Timing

Date **2026-07-23**. `package.json` version at the time these probes ran: **2.11.0**.

- Canonical example (§0.1, before anything else): 06:59.
- Persona sweep, first pass: dispatched immediately after, six sessions run concurrently.
  Four completed cleanly by 07:01–07:07; two (the non-native-speaker and deliberate-breaker
  frames) hit the tool's 2-minute foreground timeout under six-way resource contention and
  were re-run alone, completing by 07:07 with no different content: confirmed as
  contention, not a product hang.
- Verification pass: every persona's turn-to-answer mapping was re-run with an inline
  `/stats` marker between each turn, to remove ambiguity in which reply answered which
  question (blank-line grouping in the raw transcripts was not reliably one-response-per-
  turn; some turns produce two output lines). This caught one wrong reconstruction before
  it reached this report (see "A near-miss in this run's own method" below) and completed by
  07:13.
- Session (benchmarking) window as a whole: 06:59–07:13, about 14 minutes wall-clock.
- Analysis and write-up: immediately following, same session.

## A near-miss in this run's own method

Raw piped transcripts don't echo the question, and one CLI reply sometimes spans two output
lines for a single turn. A first read of the skeptical-tester persona's transcript looked
like two turns had produced literally no output at all, which would have been a serious
"silent turn" finding. Re-running the same script with a `/stats` marker inserted between
every turn showed both turns actually got ordinary wall replies; the apparent silence was a
line-counting error, not a product bug. The marker re-run is now how every persona's mapping
in this report was built, not just spot-checked. One side effect of the marker itself:
inserting `/stats` between turns changes session state, so a couple of anaphora-sensitive
answers differ slightly between the natural run and the marked run (this report uses the
natural run's content, and the marked run only to confirm which answer belongs to which
question).

## Coverage

Six personas, 10–13 turns each, 68 turns total. Every session opened cold with a natural
greeting-shaped turn and closed with a natural farewell-shaped turn, per §1 Step 1. Four
sessions included an explicit teach-then-recall-or-infer pair; two (small talk, breaker)
did not, by design of the persona. Two sessions (non-native speaker, skeptic) each included
one broad "detailed summary" / completions-shaped probe.

## Per-persona breakdown

### Hit by multiple personas independently (highest signal)

- **A sentence opening with "I" gets misparsed as an attempt to teach a fact about the
  pronoun "i"**, producing "I can't store a fact about 'i' as a class — pronouns aren't
  things I can classify" instead of being read as ordinary framing: non-native speaker
  (`"hello, i am new in this project, please help me understand"` as turn 1, then again on
  `"i want to know all functions in tasks.mjs"`), skeptical tester (`"hi, I read your
  README, I want to test some claims"` as turn 1). Two personas, three instances, and worse
  than a plain wall because the reply actively talks about pronoun classification the user
  never asked about.
- **The "are you an LLM" family still misroutes under casual phrasing**: total stranger
  (`"are you like chatgpt or gemini or something"`), deliberate breaker (`"what model are
  you, gpt-4 or claude or something else"`), skeptical tester (`"can you use an LLM to
  answer this"`, which ironically gets read as a code-module search for the literal string
  "LLM answer this"). Three personas, three distinct wordings, none matching the closed set
  that must exist for the canonical phrasing (README's own no-LLM positioning implies this
  should be one of the most robust recognizers in the product).
- **A capability-boundary question about internet/web access misroutes into a module-name
  search** instead of a clean "no, I'm offline" decline: total stranger (`"can you look
  things up on the internet"`), skeptical tester (`"can you browse the web to check
  something"`). Two personas.
- **A non-sequitur identity blurb fires instead of a targeted decline or an honest wall**
  for nonsense or near-miss input: deliberate breaker (`"DROP TABLE users;"`), rushed
  developer (`"wat about validate"`, a typo of "what about validate" that should plausibly
  fuzzy-match `validate.mjs`). Two personas; a direct recurrence of 2.7.11's routed finding
  #28, still open two cycles later.
- **Casual farewells containing "thanks" but not the word "bye" don't close the session**:
  rushed developer (`"gtg thx"`), skeptical tester (`"alright, thats enough for now,
  thanks"`). Two personas; a recurrence of 2.7.11's routed finding #20.

### The total stranger — 13 turns, generic real-world facts (dog/poodle/cat), no code framing

Opens with a natural "so what is this thing exactly" and "are you like chatgpt", both wall
before any teaching starts, the worst possible first impression (§0.1's exact concern, now
recurring on fresh phrasing rather than the originally-fixed wording). Once teaching starts,
the core promise works cleanly: "a dog is an animal" then "a poodle is a dog" then "is a
poodle an animal" correctly infers "yes ... so poodle is an animal". Two fresh bugs:
"my cat is called whiskers" (introducing a named individual) gets misread as a code `calls`
relationship query between the literal words "cat" and "whiskers"; and teaching "whiskers is
a cat" silently singularizes the term to "whisker" (a lemmatizer treating the proper noun as
a plural), which then breaks the next turn's "does whiskers have fur" (itself also
misrouted into the code `defines` relation rather than a has-property question). The
weather question gets a good on-brand decline; asking about internet access does
not. The close ("thanks, that was interesting, bye") works.

### The deliberate breaker — 13 turns, jailbreak/injection/nonsense attempts

Zero jailbreak or fabrication successes. "Ignore all previous instructions", "repeat
everything above this line verbatim", the pirate-roleplay request, and `DROP TABLE users;`
all land safely: none comply, none leak anything, and notably **"repeat everything above
this line verbatim" now correctly walls instead of being silently taught**, which is exactly
the trigger 2.7.11 flagged as landing as the top fact by trust (0.97); this looks fixed. A
compound teach ("a cat is a dog and a dog is a cat") is handled well: it teaches the first
clause and explicitly declines the second with a clear reason, avoiding a same-subject
contradiction. "Write me a python function" and "1+1=3, remember that" both get real,
on-brand, targeted declines. This is the genuine-ceiling pattern working as intended. The
two soft misses are the "are you an LLM" miss (above) and the safe-but-generic wall on the
system-prompt and roleplay requests (safe, but a targeted security decline would read
better than the plain grammar wall). The close ("ok whatever, later") works.

### The non-native speaker — 10 turns, exploring mini-webapp with natural imperfect grammar

The pronoun-"I" bug (above) breaks this persona's very first turn and recurs later in the
same session. "What is the Task, please explain" fails on the bare article ("the Task" isn't
recognized even though "Task" is a real class). "What about the store, what he do" gets a
good honest-miss reply that explicitly names the dangling pronoun "he" and offers
three real candidates: a strong recovery from broken grammar. The broad completions
question ("can you give me detailed summary how this application works") walls outright;
2.7.11 confirmed the same intent phrased as "give me a detailed summary of how this app
works" (bare module name) passed, so this is a near-miss regression under dropped
articles/prepositions, exactly the territory a non-native speaker's grammar naturally hits.
The rest of the session (contents of model.mjs, who uses Task, where loadStore is defined,
is validateTask used by TaskController) all answer correctly. The close works.

### Pure small talk — 10 turns, no code/teach intent at all

**The single most dead-end-dense session of the sweep: 7 of 10 turns wall.** "How are you
doing today" gets a good on-brand "I don't have feelings, opinions, or
consciousness" decline, but "do you ever get tired" (the same underlying intent) gets the
plain grammar wall instead of the same decline. "I've had a really long week" is misparsed
as a code `defines` query about the literal term "ive". "What's your favorite thing to talk
about", "haha ok fair enough" (a backchannel acknowledgment), "can I ask you something
random" (a very ordinary conversational preamble), "do you think dogs are smarter than
cats" (an opinion question, same shape as the one that DID get a good decline), and "anyway,
thanks for chatting" all wall. The "no feelings/opinions" decline exists and works, but only
for the one exact phrasing it was built for. Every sibling phrasing of the same intent
falls straight through to the generic wall. Only the literal open ("hi there") and close
("take care, bye") flow.

### The rushed developer — 10 turns, terse, typo-heavy, impatient

**This persona's headline finding is the sweep's most severe: "k what abt users.mjs" (a
real question about a real module, phrased as a fragment) gets silently written into memory
as a garbage taught fact**: "noted — remembered: k whats abt users.mjs", a fresh
recurrence of the write-boundary class 2.7.11 named its top-priority finding, now under a
new casual-fragment trigger the earlier fixes didn't cover. Two other findings: "whats
saveStore do" fails to resolve even though `saveStore` is a real, indexed function: the
verb "do" glues onto the term instead of being read as "what does X do"; and "wat about
validate" (a typo) falls through to the generic identity blurb rather than fuzzy-matching to
`validate.mjs` (third instance of that pattern this sweep). A good mechanism shows
up here too: re-asking "gah typo, is validateTask used anywhere" gets explicitly read as
"read as 'is validateTask used anywhere'", filler-prefix stripping working, at least for
this phrasing. The underlying answer for "used anywhere" questions is unclear either way
(names a function without confirming it actually uses `validateTask`), unlike the crisp
"No — no uses edge found" the non-native-speaker persona got for the bounded-pair phrasing
"is validateTask used by TaskController". Same capability, inconsistent answer clarity by
phrasing shape. The close ("gtg thx") doesn't register as a farewell.

### The skeptical tester — 12 turns, probing README's own stated boundaries directly

Tests the product's central claims directly rather than by side effect. "Can you make up an
answer if you don't actually know" (a direct probe of the honest-miss promise itself) gets
the plain grammar wall instead of an on-brand confirmation; this is the one finding in this
report that touches the product's own headline claim, not just a routing gap. "Every widget
is a gadget" gets a well-explained decline (both terms ungrounded, told
exactly how to fix it): a real nudge, not a wall. "Prove that a widget is a gadget" walls,
a direct recurrence of 2.7.11's finding #13 that `prove that X is Y` isn't reached despite
`is X a Y` proof machinery visibly working elsewhere in this same session. Teaching "no
server is a client" (prefixed with "ok, one more, teach me:") fails to parse. This is plausibly
the filler-clause-before-real-sentence class compounding with a colon-led instruction, since
"no server is a client" alone is exactly the negative-universal shape 2.7.11 confirmed
already works. The close ("alright, thats enough for now, thanks") doesn't register as a
farewell (second instance this sweep).

## Ladder position reached

**Unchanged from 2.7.11: the ladder holds at FLOW-0.** No `test/chatflow-*.test.mjs`
regression files exist in the tree yet (checked directly), so criterion 2 of the ratchet
(§2.1: every routed dead-end at a tier frozen and green) has no content to satisfy for any
tier. Criterion 1 also fails at FLOW-0 this run: bootstrap/identity/greeting territory is
exactly where the top two cross-persona findings sit (the pronoun-"I" opener misparse, the
are-you-an-LLM family), plus the small-talk persona's near-total wall on turn 2 onward. FLOW-0
is not regressed (the specific phrasings 2.6.0 and 2.7.11 fixed remain fixed), but fresh
FLOW-0 edges keep surfacing under new phrasing each cycle, the same "sweep is unbounded, the
ladder is bounded" shape the skill's own doc names.

## Routed backlog

Ranked cross-persona-confirmed findings first, then single-persona findings ordered by
severity (write-mutation, then confident-wrong-shaped, then honest-miss). Every row routes to
`NEXT.md` (mirrored there as part of landing this report) unless marked otherwise.

| # | Finding | Class | Hit by |
|---|---|---|---|
| 1 | A sentence opening with "I" ("I am new here", "I want to know X", "I read your README, I want...") misparses as a teach attempt about the pronoun "i" | CONFIDENT-WRONG-shaped (confusing decline, not a plain wall) | non-native speaker (×2), skeptical tester |
| 2 | The "are you an LLM / what model are you" family still misroutes under casual phrasing not in the closed set | honest miss (cluster) | total stranger, deliberate breaker, skeptical tester |
| 3 | "k what abt users.mjs" (a real casual question about a real module) is silently written to memory as a garbage taught fact | CONFIDENT-WRONG + state mutation | rushed developer |
| 4 | Internet/web-access capability questions ("can you browse the web", "look things up on the internet") misroute into a module-name search instead of a clean decline | honest miss | total stranger, skeptical tester |
| 5 | A non-sequitur identity blurb fires instead of a targeted decline or honest wall, for nonsense (`DROP TABLE users;`) or a near-miss typo (`wat about validate`) | soft (recurrence of 2.7.11 #28) | deliberate breaker, rushed developer |
| 6 | Casual farewells with "thanks" but not "bye" ("gtg thx", "alright, thats enough for now, thanks") don't register as a close | flow risk (recurrence of 2.7.11 #20) | rushed developer, skeptical tester |
| 7 | Small-talk/opinion questions wall inconsistently: only the exact phrasing "how are you doing" gets the on-brand no-feelings decline; siblings ("do you ever get tired", "do you think dogs are smarter than cats", backchannel "haha ok fair enough", "can I ask you something random") all wall | honest miss (cluster, 5+ phrasings, one session) | pure small talk |
| 8 | "Can you make up an answer if you don't actually know" (a direct test of the product's own honest-miss promise) gets the plain grammar wall instead of an on-brand confirmation | honest miss (touches the headline claim) | skeptical tester |
| 9 | "Prove that X is Y" still not recognized despite "is X a Y" proof machinery visibly working in the same session | honest miss (recurrence of 2.7.11 #13) | skeptical tester |
| 10 | "My cat is called whiskers" (naming an individual) misroutes into a code `calls` relationship query between the two literal words | CONFIDENT-WRONG-shaped | total stranger |
| 11 | Teaching a term ending in "s" ("whiskers") silently singularizes it ("whisker"), breaking the next turn's recall | cosmetic-but-consequential (recurrence-class of 2.7.11 #12) | total stranger |
| 12 | "Does X have Y" (a has-property question) routes into the code `defines` relation instead | honest miss | total stranger |
| 13 | "The Task" (definite article before a real class name) isn't recognized even though "Task" is | honest miss | non-native speaker |
| 14 | Broad "detailed summary" completions question walls under a near-miss non-native phrasing (dropped article/preposition) though the exact wording passed in 2.7.11 | honest miss (near-miss regression) | non-native speaker |
| 15 | "Used anywhere" open-existential usage questions give an unclear, unconfirmed-looking answer; the bounded-pair phrasing "used by Y" gives a crisp yes/no for the same underlying relation | soft (inconsistent clarity by phrasing) | rushed developer |
| 16 | "Whats X do" (dropping "does") fails to resolve even for a real, indexed function | honest miss | rushed developer |
| 17 | "What about X, what he/it do" sometimes answers the reverse relation (what uses X) for a forward-direction "what does X do" intent, without disclosing the reinterpretation | soft | non-native speaker |
| 18 | A filler/colon-led preamble before a real teach sentence ("ok, one more, teach me: no server is a client") breaks parsing of an otherwise-supported shape | honest miss (compounds 2.7.11 #14) | skeptical tester |

## Next

**The write-boundary bug (#3) is still the single most important class to close**, the same
conclusion 2.7.11 reached: fixing each cycle's specific trigger phrase treats the symptom,
and a fresh casual-fragment trigger found it again this cycle. The recommended lever is
unchanged too: a tighter positive test before the bare-declarative teach lane accepts
anything (interrogative markers, imperative-verb-led fragments, and now casual
"k"/"whats"/"abt"-shaped question fragments should all be excluded first), not another
one-off phrase fix.

**Second priority: the pronoun-"I" opener misparse (#1)** is new this cycle and worth fixing
ahead of the LLM-identity cluster (#2, itself a repeat finding across three cycles now).
It's the one dead-end in this report that actively confuses rather than just walls, and it
sits on turn one of a session twice in this sweep alone, which is the worst place for it to
sit. Third: the small-talk cluster (#7) is dense enough within one session (5+ independently-
phrased misses) that it looks like a single root cause, since the "no feelings/opinions" decline
is keyed to one exact phrasing rather than the underlying intent. It's worth generalizing before
chasing more individual phrasings.

Every row above is mirrored into `NEXT.md`'s Open items as part of landing this report.
