
tmct playtest 010 — quantifiers and the capability paraphrase family
====================================================================

Version under test: 1.11.0 (local working copy, `node bin/tmct.mjs`).

Probe recipe (per session, fresh isolated memory):
```bash
S=$(mktemp -d)
node bin/tmct.mjs init --repo "$S" >/dev/null
printf '<probe lines>\n/exit\n' | node bin/tmct.mjs chat --repo "$S"
```

Area: quantifiers and quantified capability questions — "which animals can
fly", "do all birds fly", "what can fly" — plus the adjacent bare-do and
short-form capability shapes probing turned up.

Axes explored so far: relation coverage of forward yes/no (001), honesty on
miss (002/003), forward yes/no class (004), inference depth (005),
negation (006), anaphora (007), two-word noun phrases + prepositional-verb
facts (008), comparatives (009), quantifiers/capability paraphrases (this).
Axes still untouched: teach-side variation, the teach/query boundary, the
full politeness rungs of the paraphrase ladder.


test: which animals can fly
===========================

Expectations
------------

When the following prompts were entered on a fresh session:

```log
tmct> can a bird fly
tmct> do birds fly
tmct> what can bark
tmct> what can fly
tmct> which animals can fly
tmct> do all birds fly
```

Expected: "can a bird fly" answers yes (it does); every other phrasing of
the same capableOf lookups answers from the same facts — or declines
honestly. "do all birds fly" must never claim universality from a generic
fact.

Actual: only "can a bird fly" answered. "do birds fly", "can birds fly"
and "what can bark" (all exactly 3 words) fell into isConversational()'s
short-input catch-all and got the full self-introduction card — a
mis-route, worse than a decline. "which animals can fly" and "do all
birds fly" had no reader at all and fell to the code-graph parse wall.

Result
------

Fail


Play test session log
---------------------

```txt
tmct> can a bird fly
yes — bird can fly (source: corpus:human /r/CapableOf)

tmct> do birds fly
I'm tmct — a deterministic, offline chat assistant (no LLM). Try "what is a dog" for general vocabulary. /memory for what I remember. …

tmct> what can bark
I'm tmct — a deterministic, offline chat assistant (no LLM). …

tmct> which animals can fly
couldn't parse this as a graph question. Try: "which modules import <name>" or "what calls <name>". …

tmct> do all birds fly
still couldn't parse that — /help lists every query shape. …
```


Fix
---

`src/chat.mjs`, all in the factAnswer reader cascade plus its short-input
divert gate:

1. **Do-support yes/no** — `DO_VERB_ASK_RE` ("do birds fly", "does a dog
   bark"), same capableOf lookup as the existing can-reader. The quantified
   form ("do all birds fly") answers generically and says so — the stored
   facts are generic, so a bare universal "yes" would overclaim.
2. **Reverse-by-verb** — `WHAT_CAN_VERB_RE` ("what can fly"): every
   capableOf fact matched by OBJECT, the capability mirror of the existing
   "what is used for riding" reverse reader.
3. **Kind-restricted reverse** — `WHICH_KIND_CAN_RE` ("which animals can
   fly"): the reverse-by-verb list filtered to subjects a direct isa-family
   fact ties to the named kind; when nothing ties, the answer says so
   rather than silently listing.
4. **Gate** — the capability family's 3-word members now join the
   divert-only-on-a-real-hit gate ahead of the conversational orientation
   card (same treatment the reverse-predicate shapes already had). A
   capability can't-confirm is allowed through too: it names the subject's
   real capabilities plus a round-trip teach hint, strictly more useful
   than the orientation card.
5. **Hint honesty (adjacent, folded in)** — the can-lane's teach hint on a
   plural subject read 'teach me: "a birds can swim"'; it now names the
   subject as the graph stores it ("a bird can swim"), verified to
   round-trip.

Regression tests: six cases in `test/wiring-facts-reverse.test.mjs`
(do-support yes at 3 words via the fact lane; quantified never-universal;
reverse-by-verb at 3 words; kind-restricted reverse through the isa link;
can't-confirm beats the orientation card with a round-tripping hint and
miss stays recorded; plural teach-hint singularization).

Known remainder (stated): "which animals can fly" resolves kind
membership through DIRECT isa facts only — a 2-hop chain (poodle → dog →
animal) won't surface under the kind filter. The multi-hop proof chase
exists in the is-a lane (playtest 005); wiring it into this reverse filter
is interpreter work, not a chat-lane fix.


Retest
======


Retest result
-------------

Pass


Retest session log
------------------

```txt
tmct> do birds fly
yes — bird can fly (source: corpus:human /r/CapableOf)

tmct> what can bark
dog can bark (source: corpus:human /r/CapableOf)

tmct> what can fly
bird can fly (source: corpus:human /r/CapableOf)

tmct> which animals can fly
bird can fly (source: corpus:human /r/CapableOf)

tmct> do all birds fly
I can't speak for all birds — what I remember is generic, not universal. I do know: bird can fly (source: corpus:human /r/CapableOf).

tmct> do birds swim
I can't confirm that — nothing I remember says birds can swim. I do know: bird can fly (source: corpus:human /r/CapableOf). If it's true, teach me: "a bird can swim".

tmct> a bird can swim
noted — remembered 1 fact: bird mgx:capableOf swim

tmct> can birds swim
yes — you told me: bird can swim (source: ace:chat:…)
```

Full suite: 2271 pass, 0 fail (including the 6 new regression cases). CLI
smoke: greets and exits 0.


## Supplemental retest — 2026-07-15, v1.12.0 working tree (uber run 018)

Result: Pass

```txt
tmct> do birds fly
yes — bird can fly (source: corpus:human /r/CapableOf)

tmct> what can bark
dog can bark (source: corpus:human /r/CapableOf)

tmct> what can fly
bird can fly (source: corpus:human /r/CapableOf)

tmct> which animals can fly
bird can fly (source: corpus:human /r/CapableOf)

tmct> do all birds fly
I can't speak for all birds — what I remember is generic, not universal. I do know: bird can fly (source: corpus:human /r/CapableOf).

tmct> do birds swim
I can't confirm that — nothing I remember says birds can swim. I do know: bird can fly (source: corpus:human /r/CapableOf). If it's true, teach me: "a bird can swim".

tmct> a bird can swim
noted — remembered 1 fact: bird mgx:capableOf swim

tmct> can birds swim
yes — you told me: bird can swim (source: ace:chat:…)
```
