tmct playtest 007 — a typo on a VERB_SYNONYMS word itself is not fuzzy-repaired
================================================================================

tmct version under test: 2.7.10

Area: the adventure game (Ashcombe Hall) — the imperative grammar's fuzzy typo-repair
tier, probed against a typo on a recognised synonym word rather than a bare closed verb.

Axes explored this iteration: a full win-condition playthrough of Ashcombe Hall using
only the new verbs (`have a look at`, `pick up`, `talk to`, etc. — no dead ends found);
whether a typo on a multi-word idiom's own lead word ("hav a look at") or a single-word
synonym ("pikc the lamp") gets repaired the same way a typo on a bare closed verb
("lookl", "got south") already does.

Axes still untouched: none identified this round beyond the fix's own scope.

Probe recipe:
```bash
SCRATCH=$(mktemp -d)
node bin/tmct.mjs init --repo "$SCRATCH" >/dev/null
printf 'play ashcombe hall\nhav a look at the desk\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
printf 'play ashcombe hall\npikc the lamp\n/exit\n' \
  | node bin/tmct.mjs chat --repo "$SCRATCH" --plain
```

test: a typo on a synonym word (bare or idiom-lead) falls through entirely
============================================================================

Expectations
------------

When the following prompts were entered:
```log
tmct> hav a look at the desk
tmct> pikc the lamp
```

Expected: the same bounded, distance-1 fuzzy repair that already catches a typo on a
bare closed verb ("lookl" -> "look", "got south" -> "go south") also catches a typo on
a recognised SYNONYM word, whether that synonym is one token ("pick") or the leading
word of a multi-word idiom ("have" in "have a look at") — reading the line as the
corrected command, exactly as the existing bare-verb repair already announces itself.

Actual: both fell through entirely to the generic conversational miss ("I couldn't
read that as a question I can answer...") — not even an honest per-room decline, let
alone a repaired command.

Result
------

Fail

Play test session log
----------------------

```txt
tmct> play ashcombe hall
the adventure begins. You are in the study of Ashcombe Hall. ...

tmct> hav a look at the desk
I'm tmct — a deterministic, offline chat assistant (no LLM). Try "what is a dog" for
general vocabulary. /memory for what I remember.
For code structure (imports, calls, definitions) point me at a repo: `--repo <path>`,
or try the shipped example `npm run example:mini`. tmct reads graphs; it doesn't index
code itself.
```

```txt
tmct> play ashcombe hall
the adventure begins. ...

tmct> pikc the lamp
I'm tmct — a deterministic, offline chat assistant (no LLM). Try "what is a dog" for
general vocabulary. /memory for what I remember.
```

Fix
---

`src/domain/grammar/ace.mjs`'s `resolveImperativeVerb` fuzzy tier only ever fuzzy-matched
the leading token against `VERB_FUZZY_CANDIDATES` — the CANONICAL verb targets
(`take`/`drop`/`talk`/`examine`/...) — never the recognised SYNONYM surface words
themselves (`pick`, `grab`, `have`, `check`, `chat`, `converse`, ...). A synonym word only
ever appears as a `VERB_SYNONYMS` map key (or the first word of one), so a typo on it had
nothing to repair against at all.

Split the old single function into `exactImperativeVerb` (the three deterministic tiers:
multi-word prefix, bare verb, one-word synonym — unchanged) and a `resolveImperativeVerb`
that tries the exact tiers first, then fuzzy-corrects the LEADING TOKEN against
`VERB_SURFACE_WORDS` (every bare verb plus every `VERB_SYNONYMS` key's own first word) and
retries `exactImperativeVerb` with the corrected token substituted in. Retrying the exact
tiers (rather than jumping straight to a canonical verb) means the multi-word prefix loop
still runs on the corrected phrase — "hav a look at" repairs to "have a look at" and still
consumes the whole idiom, not just a bare-verb guess. The existing `NEVER_FUZZY_VERB`
exemption (walk/wake/make) is checked before any fuzzy repair is attempted, same as before.

Regression: `test/adapters/grammar-imperative.test.mjs` gains a case covering a bare-synonym
typo ("pikc"), an idiom-lead-word typo ("hav"), and an idiom-lead-word typo repaired via a
different real word ("chekc" -> "check"); `games/adventure` gains
`adv-typo-on-synonym-surface-word`. A genuinely ambiguous typo ("tak", equidistant from
"take" and "talk") was checked directly and correctly still declines rather than guessing —
the existing tie-break in `fuzzyMatchInSet` isn't touched by this fix.

Retest
======

Retest result
-------------

Pass

Retest session log
-------------------

```txt
tmct> hav a look at the desk
(reading that as "examine desk") Desk is a furniture. Desk is fixed in the study.

Goal (inferred): Take a closer look at the desk.

tmct> pikc the lamp
(reading that as "take lamp") you take the lamp. ...

Goal (inferred): Carry the lamp.
```
