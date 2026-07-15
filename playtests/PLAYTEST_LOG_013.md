
tmct playtest 013 — the teach/query boundary (bare habitual declaratives)
=========================================================================

Version under test: 1.11.3 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: the teach/query boundary — bare declaratives with plain verbs
("dogs bark", "a dog barks", "penguins swim", "john likes mary"): teach,
query, or refusal, and is it consistent?

Axes explored so far: relation coverage of forward yes/no (001), honesty
on miss (002/003), forward yes/no class (004), inference depth (005),
negation (006), anaphora (007), two-word nouns + prepositional verbs
(008), comparatives (009), quantifiers/capability paraphrases (010),
teach-side variation (011), politeness rungs (012), teach/query boundary
(this).


test: dogs bark
===============

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> dogs bark
tmct> a dog barks
tmct> penguins swim
tmct> john likes mary
```

Expected: each either teaches (the copula-free habitual is the surface of
"a dog can bark", the reading the seed corpus itself uses for
/r/CapableOf) or declines honestly with an actionable hint. The same
input gives the same answer every time.

Actual: deterministic but mis-routed — every one of these fell into
isConversational()'s ≤3-word catch-all and answered with the
self-introduction card. Nothing taught, nothing hinted; a declarative
sentence read as small-talk.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> dogs bark
I'm tmct — a deterministic, offline chat assistant (no LLM). …

tmct> a dog barks
still the same overview — /help lists every command and query shape.

tmct> penguins swim
I'm tmct — a deterministic, offline chat assistant (no LLM). …
```


Fix
---

`src/chat.mjs`, one closed recognizer feeding three existing seams:

1. **`matchBareHabitualTeach`** — the two habitual surfaces as one shape:
   "dogs bark" (plural subject + base verb) and "a dog barks" (articled
   singular + 3sg verb), folded to {subject, verb} singular/base forms.
   Closed on three sides: structural verbs (imports/calls/tests …) are
   excluded so a truncated code query never becomes a capability claim; a
   plural-looking verb tail is rejected ("dogs animals" is not a habitual
   sentence); a politeness/discourse tail is rejected ("jokes please",
   "dogs too" — live-caught when "please" first sat in the verb slot and
   hijacked the orientation card).
2. **assertCandidates** adds the rewritten "a <subject> can <verb>"
   candidate — the capability teach the lane already owns, so grounding
   discipline is inherited: "penguins swim" (unknown subject) still
   declines, exactly like "a penguin can swim".
3. The teach-lane entry gate and the conversational-gate exemption (011's
   plural-membership deferral, widened to the habitual sibling, still
   gated on a KNOWN lexicon-noun subject).

Known remainders (stated): bare "john likes mary" (proper-name
general-verb) keeps the wrapper-required discipline — that is a
deliberate, documented storage-safety decision, not an oversight; the
wrapped "remember that john likes mary" stores and "does john like mary"
answers yes. "penguins swim" (unknown subject) stays with the
conversational card rather than a tailored decline — same visibility as
before, and the wrapped form gets the honest unknown-word message.

Regression tests: four cases in `test/chat-teach-quantifier.test.mjs`
(plural habitual stores + round-trips; 3sg surface stores the base-verb
fact; the "jokes please" exclusion holds with nothing stored; unknown
subject never fabricates a fact).


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> dogs bark
noted — remembered 1 fact: dog mgx:capableOf bark

tmct> a dog barks
noted — remembered 1 fact: dog mgx:capableOf bark

tmct> can a dog bark
yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:…)

tmct> dogs sing
noted — remembered 1 fact: dog mgx:capableOf sing

tmct> can a dog sing
yes — you told me: dog can sing (source: ace:chat:…)

tmct> remember that john likes mary
noted — remembered: john likes mary

tmct> does john like mary
yes — you told me: john likes mary (source: teach:chat:…)
```

Full suite: 2285 pass, 0 fail (including the 4 new regression cases). CLI
smoke: greets and exits 0.


## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass (drift: the "can a dog sing" yes carries a stale "uses" goal/canonical receipt — display-only)

```txt
tmct> dogs bark
noted — remembered 1 fact: dog mgx:capableOf bark

tmct> a dog barks
noted — remembered 1 fact: dog mgx:capableOf bark

tmct> can a dog bark
yes — you told me: dog can bark (source: corpus:human /r/CapableOf | ace:chat:… | ace:chat:…)

tmct> dogs sing
noted — remembered 1 fact: dog mgx:capableOf sing

tmct> can a dog sing
yes — you told me: dog can sing (source: ace:chat:…)

tmct> remember that john likes mary
noted — remembered: john likes mary

tmct> does john like mary
yes — you told me: john likes mary (source: teach:chat:…)
```
