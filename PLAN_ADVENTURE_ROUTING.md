# PLAN_ADVENTURE_ROUTING.md — route Ashcombe Hall's dead ends to a useful action

Status: RESEARCH/DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-18. A real play session against tmct 2.7.2
(`.tmct/session-019f75d9-7586-793e-8c1c-e215776fbf69.log`, 424 lines, "play ashcombe hall" through
to the cellar) turned up eight recurring shapes of dead end. The operator asked for a plan to route
every one of them to a useful action instead of a decline. This document reads that transcript
against the actual `src/services/adventure.mjs` / `src/domain/grammar/ace.mjs` code that produced
each dead end, cited at the line, and designs one fix per shape — plus one structural finding that
ties four of the eight together.

Every quote below is verbatim from the session log; every root cause is read from the current tree,
not guessed.

## 0. The finding that ties categories 1, 6 and 7 together

`take`'s presence check (`adventure.mjs:441-460`) and the "look" digest (`worldDigestRows`,
`adventure.mjs:297-335`) currently answer two different questions from two different data sources.
`take` asks "does this subject have a real placement fact resolving to here" — the closed
`PLACEMENT_PREDICATES` set (`adventure.mjs:136-138`) via `visibleRoomOf` (`adventure.mjs:196-207`).
"Look" asks "what facts does the completions engine's broad-search turn up whose subject or object
mentions this room" — an open-ended query with no placement filter at all
(`worldDigestRows`'s per-row loop, `adventure.mjs:324-333`, ends in a catch-all
`push(row.subject, row.predicate, row.object)` at line 332 for anything not otherwise excluded).

Those two questions look the same in the transcript, and they aren't:

```
> look
Garden is a room. ... Garden mgx:hasA flower. Garden mgx:usedFor growing plants.
Vegetable mgx:atLocation garden.
...
> take flower
I don't see a flower here.
> take vegetable
I don't see a vegetable here.
```

`Garden mgx:hasA flower` and `Vegetable mgx:atLocation garden` are not Ashcombe Hall's own world
facts — they are the default **human persona**'s always-active background corpus
(`corpus/tier2/human.jsonl`; `archive/PLAN_ADVENTURE.md`'s own Origin cites this exact fact set —
"garden HasA flower", "kitchen usedFor cooking" — as reusable background colour). The persona
corpus and Ashcombe's room names were deliberately built to overlap; nobody worked through what
happens when the *look digest*, which searches the whole store rather than just the world's own
provenance, surfaces them indistinguishably from real, interactive props. `mgx:hasA`/
`mgx:usedFor`/`mgx:atLocation` have no entry in the digest's phrase table (`adventure.mjs:316-321`
only maps `currently-in`/`located-in`/`fixed-in`/`stands-locked-in`), so they fall through to the
raw catch-all and print with their bare predicate names showing (`"Garden mgx:hasA flower"`) —
which reads exactly like `"Lamp is in the study"` to a player with no way to tell the two apart.

**The fix is not "make `take` more lenient."** `book`/`flower`/`vegetable` were never meant to be
takeable — they're atmosphere, not props. The fix is to stop the look digest from implying they
are: build one new, small, pure function that enumerates a room's real affordances from the *exact*
data `take`/`open`/`give` already check, and use it, not the open-ended prose digest, as the
authoritative "what's here to act on" answer. Once that function exists, categories 6 and 7 (the
missing action list, exits-as-actions) are the same fix applied to rendering, and category 1 (a
stated object an operation denies) stops happening by construction — nothing is ever *offered* as
actionable that `take`/`open`/`talk`/`examine` wouldn't also recognize, because they read the same
source.

```
function roomAffordances(rows, state, here) {
  // exits: every state.exits.get(here) entry -> "go <direction>"
  // objects: every subject whose visibleRoomOf(subject, {rows, state}) === here,
  //   branched by its placement predicate / rdf:type person:
  //     fixed-in/stands-locked-in + is-container -> "open <x>" / "unlock <x>"
  //     fixed-in, not a container               -> "examine <x>" only (§4)
  //     currently-in + typed person              -> "talk to <x>" (§5)
  //     located-in (portable, not carried)        -> "take <x>"
  // never includes anything without a real placement fact — book/flower/
  // vegetable, having none, are structurally excluded, not filtered out.
}
```

This is the single most load-bearing piece of this document — §1, §6 and §7's fixes are all this
one function, used in different places.

## 1. Stated as existing, denied as present

Evidence above (`take flower`/`take vegetable`/`take book`, all against a `look` that just named
them). Root cause: the look digest has no placement filter (§0). Fix: §0's `roomAffordances` becomes
the "what's here" answer the player actually acts against; the flavour facts stay in the prose
description (they're real, sourced facts — `corpus/tier2/human.jsonl` background colour is a
legitimate part of what a room "is") but never appear in the affordance list, so a player is never
invited to `take` something that was only ever scenery.

**A companion, smaller fix worth doing at the same time**: `worldDigestRows`'s catch-all
(`adventure.mjs:332`) should stop printing a raw, untranslated predicate name
(`"Garden mgx:hasA flower"`) at all — either drop rows whose predicate has no phrase mapping, or add
`hasA`/`usedFor`/`atLocation` to the phrase table so they read as prose (`"the garden has a
flower"`) rather than a bare triple. This doesn't change what's *takeable* (§0 already fixed that);
it just stops the prose itself from reading like a bug report.

## 2. Minor typos found no match

```
> go easte
I'm tmct — a deterministic, offline chat assistant (no LLM). ...
> lookl
I'm tmct — a deterministic, offline chat assistant (no LLM). ...
> got south
I'm tmct — a deterministic, offline chat assistant (no LLM). ...
```

Root cause, read directly from `parseImperative` (`ace.mjs:493-497`):

```js
const verb = toks[0].toLowerCase();
if (!IMPERATIVE_VERBS.has(verb)) return null;
```

`IMPERATIVE_VERBS`/`IMPERATIVE_DIRECTIONS` (`ace.mjs:476-477`) are plain `Set`s — exact string
membership only. `"got"` isn't `"go"`, `"lookl"` isn't `"look"`, `"easte"` isn't `"east"` — each
check fails and the WHOLE line returns `null` before it's even recognised as an imperative attempt,
so it falls through to the ordinary ask/conversational pipeline and gets the generic miss banner.
Object nouns fare no better: `resolveNP`/`lookupNoun` (`ace.mjs:98-109`, `src/domain/grammar/
lexicon.mjs:156-189`) only fold plurals and irregulars — no edit-distance tolerance at all. This is
a different, LESS tolerant path than the ordinary declarative resolver's own multi-tier cascade
(README's "5+ resolution tiers... bounded fuzzy matching"); an imperative typo has nowhere to land
that a declarative one would.

**Fix**: `src/domain/interpret/fuzzy.mjs` already implements a bounded, cited (Damerau 1964 /
Levenshtein 1966, Optimal String Alignment) edit-distance matcher, used elsewhere in the tolerant
declarative pipeline. Wire it into `parseImperative`'s three closed checks, in this order — exact
match first (unchanged, zero behaviour change for anything that already works), then a bounded
fuzzy match (distance ≤ 1, this project's existing tolerance elsewhere) against `IMPERATIVE_VERBS`,
`IMPERATIVE_DIRECTIONS`, and (new) the room's own actionable object names from `roomAffordances`
(§0) — narrowing the fuzzy candidate pool to what's actually in scope this turn, not the whole
lexicon, so a typo can't accidentally fuzzy-match an unrelated word. A fuzzy hit still executes the
corrected command normally; there is no silent auto-correct without executing — the response can
name what it resolved to ("(reading that as 'go east')") so a genuine miss is never confused with a
correction.

## 3. Different phrasing didn't route

```
> pick up desk / pick up lamp / pick lamp
I'm tmct — a deterministic, offline chat assistant (no LLM). ...
> speak cook
still the same overview — /help lists every command and query shape.
> what do I carry
I couldn't read that as a question I can answer. ...
```

Root cause: `IMPERATIVE_VERBS` (`ace.mjs:476`) is `{go, take, drop, open, unlock, close, give,
look}` — a fixed one-token-per-verb set with no synonym table at all. "pick up"/"pick"/"grab" never
had a path to "take"; the verb-token check simply never runs for a leading token it doesn't
recognise. Separately, `INVENTORY_RE` (`adventure.mjs:185-186`) is a closed regex covering
"inventory"/"inv"/"what am I carrying"/"what do I have"/"what's in my bag/pockets/hands" — a
perfectly natural fifth phrasing, "what do I carry", simply isn't one of the alternatives.

**Fix**: a small verb-synonym table checked before the `IMPERATIVE_VERBS.has(verb)` gate, greedy on
the longest match so two-word phrases are checked before falling back to one word:

```js
const VERB_SYNONYMS = new Map([
  ["pick up", "take"], ["pick", "take"], ["grab", "take"],
  ["put down", "drop"], ["set down", "drop"], ["leave", "drop"],
  ["talk to", "talk"], ["speak to", "talk"], ["speak with", "talk"], ["talk", "talk"], ["speak", "talk"],
  ["look at", "examine"], ["examine", "examine"], ["inspect", "examine"],
  ["shut", "close"],
]);
```

consistent with this project's own standing preference for closed templates over general grammar
(the same posture the ACTION-RULE TEACH FRAMES and the construction bank already take). Add "what
do I carry" as a sixth `INVENTORY_RE` alternative — a one-line regex change, not a new mechanism.
`talk`/`examine` land as real new verbs in §4/§5 below, not just synonym targets.

## 4. A closer look should reveal information about an object

```
> look desk
I'm tmct — a deterministic, offline chat assistant (no LLM). ...
> look at desk
still the same overview — /help lists every command and query shape.
> look Portrait
still the same overview — /help lists every command and query shape.
```

Root cause, `parseImperative`'s `look` arm (`ace.mjs:503-505`):

```js
if (verb === "look") {
  if (!rest.length || (rest.length === 1 && lower[0] === "around")) return command({});
  return null;
}
```

Any object after "look" is a hard `null` — there is no targeted-look/examine capability at all
today, only the bare room-level "look".

**Fix**: a new `examine <object>` verb (reached via `"look at"` too, §3's synonym table), handled in
`runWorldCommand` alongside the existing verb branches. Precondition: the object must resolve
visible in the current room (`visibleRoomOf`, already used by `take`) — an honest "I don't see a
`<x>` here" otherwise, the same decline `take` already gives. On success, the response is a
`worldDigest` call scoped to the OBJECT term instead of the room term (`worldDigest(object, {...})`
vs. today's `worldDigest(here, {...})`) — reusing the exact same completions call, just re-pointed —
plus, for a container, its open/locked state stated plainly and (only if already open) its
contents. `mgx:hidden-in` stays excluded from the view exactly as `VIEW_EXCLUDED_PREDICATES`
already protects it (`adventure.mjs:286-289`) — examining the portrait never reveals the hidden key;
only `open`ing it still does, unchanged. This is the mechanism the archived
`archive/PLAN_ADVENTURE.md` worked example always intended ("open the portrait -> succeeds; key
becomes visible") — examine adds a way to learn ABOUT an object without touching its state, which
that document never designed because its own worked example only ever needed `open`.

## 5. A character was present but no basic interaction was found

```
> talk butler
I'm tmct — a deterministic, offline chat assistant (no LLM). ...
> talk to butler
no module matching "butler" found in the index. This store holds no code index...
Canonical: uses "butler" — reverse(uses, "butler")
```

Two stacked problems. First, `talk`/`speak` aren't in `IMPERATIVE_VERBS` at all, so `adventureTurn`
(`adventure.mjs:713-717`) returns `null` for the whole line and it falls through past the adventure
lane entirely. Second — and worse than a plain miss — "talk to butler" then partial-matches
somewhere in the ordinary code-structure ask pipeline (a "uses"-relation-shaped reading), producing
a confident, wrong, completely unrelated answer about a code index that doesn't exist in this
session. This is a genuine cross-domain misroute (the same shape `CAPABILITIES_2.6.0.md` row 145
names), not just an unhandled case.

Checked directly against the world data (`corpus/worlds/src/ashcombe-hall.jsonl`): every NPC
(`housekeeper`/`butler`/`cook`/`gardener`) carries `rdf:type person`, `mgx:currently-in`,
`mgx:works-in`, and the NPC-scheduler facts (`mgx:is-npc`/`mgx:acts-on-turn`/`mgx:acts-toward`) —
and nothing else. There is no dialogue content anywhere in the shipped world to route to; a real
conversation tree is not what this fixes.

**Fix**: `talk`/`talk to` become a real imperative verb (§3's synonym table normalizes onto it),
sharing `examine`'s implementation from §4 almost entirely — same precondition (visible in the
current room), same `worldDigest(target, {...})` call — branched only on `isTyped(rows, target,
"person")` to phrase the response as conversation rather than inspection: *"the butler doesn't have
much to say, but you know: the butler works in the drawing-room."* One mechanism, two response
templates, not two features. Because `talk`/`talk to` now belong to `IMPERATIVE_VERBS`,
`adventureTurn` claims the line before it can ever reach the ask pipeline — the misroute above is
closed structurally, by widening the vocabulary that claims the input first, not by patching
whatever ask-side match produced it.

## 6 & 7. Look doesn't list available actions, and exits aren't phrased as actions

```
> look
Cabinet stands locked in the study. Desk is fixed in the study. Lamp is in the study. Player is in
the study. Study is a room. Cellar has an exit up to the study. Library has an exit south to the
study. Study has an exit down to the cellar. Study has an exit north to the library.
```

Every "look" in the whole 424-line transcript is a flat fact dump — exits are stated as facts
("Study has an exit down to the cellar"), never as commands, and nothing enumerates what the lamp
or the housekeeper can actually be done to. Root cause and fix are both §0's `roomAffordances`:
append its output to every `worldDigest` response (the `cmd.verb === "look"` branch,
`adventure.mjs:390-397`) as a short suffix — *"you can: go north, go down, take the lamp, open the
cabinet."* Exits render as `"go <direction>"` verbatim (closing item 7 exactly as asked), and every
other line comes from the identical data `take`/`open`/`talk`/`examine` already check, so the list
can never promise something those verbs would then refuse.

## 8. Moving or picking something up doesn't re-show the new state

```
> go north
you go north. Now in the library.
> [nothing shown until the player types "look" again]
```

This pattern repeats after essentially every `go`/`take`/`drop` in the transcript — the player
re-types "look" by hand dozens of times. Root cause: every state-changing verb branch in
`runWorldCommand` routes through one shared helper, `commit()` (`adventure.mjs:409-419`), and
`commit()`'s response is only ever the bare confirmation line plus any NPC-pass observability lines
— it never re-describes the room.

**Fix**: `commit()` is the single choke point for `go`/`take`/`drop`/`give`/`open`/`close`/`unlock`
— exactly one place to change. After `writeWorldTurn` lands the effect, re-read fresh fact rows and
re-fold state (the effect the command just wrote must be visible to what follows), call
`worldDigest(playerRoomAfter, {...fresh state...})` plus §0's `roomAffordances`, and append both to
the confirmation text — the same shape "look" itself already produces. A `go` command shows the NEW
room; every other state-changing verb shows the SAME room with its updated state (the cabinet now
open, the lamp now gone). This is the one behaviour change every one of this document's fixes
benefits from having already: once §0's affordance list exists and §4/§5's `examine`/`talk` exist,
this auto-relook is what actually puts them in front of the player without another manual "look".

## Build plan

Independently testable, `npm test` green throughout, following this project's own phased-doc
convention.

**Phase 1 — Grammar tolerance.** `VERB_SYNONYMS` (§3) checked before the `IMPERATIVE_VERBS` gate;
the bounded fuzzy pre-pass on verb/direction tokens (§2); the `INVENTORY_RE` phrasing fix (§3). No
new verbs yet — this phase only widens what already-existing verbs recognise.

**Phase 2 — `examine` and `talk`.** One shared implementation (§4/§5), dispatched on
`isTyped(rows, object, "person")`, wired into `runWorldCommand` and `IMPERATIVE_VERBS`.

**Phase 3 — `roomAffordances` and the action list.** §0's function; appended to the `look` branch's
response (§6/§7).

**Phase 4 — Auto-relook.** `commit()` re-folds fresh state and appends the digest + affordance list
after every state-changing command (§8).

**Phase 5 — Digest hygiene** (the companion fix in §1): stop `worldDigestRows`'s catch-all from
printing untranslated predicate names; either drop unmapped predicates from the view or extend the
phrase table to cover `hasA`/`usedFor`/`atLocation`.

Each phase's regression tests extend `test/services/adventure.test.mjs` (unit-level: `roomAffordances`
shape, the synonym table, the fuzzy pre-pass) and the `games/adventure` corpus lane
(`test/corpus/games/adventure.jsonl`, flat-hyphenated keys per that lane's own established
convention — e.g. `adventure-examine-portrait`, `adventure-talk-butler`, `adventure-relook-after-move`)
— the minimal pair from each transcript excerpt above (the exact failing line, and the closest form
that already worked) is the regression test per `SKILL_PLAYTEST_EDGE_HUNT.md`'s own convention.

## Open risks and questions

- **Auto-relook verbosity.** §8 re-describes the room after every single state-changing command,
  unconditionally, per the operator's own framing ("chaning locations... or state... the look
  action is repeated"). Whether this reads as helpful or noisy once real people play it is worth
  watching once built, not decided here.
- **Fuzzy-match scope.** §2 narrows the fuzzy candidate pool to the current turn's actionable verbs/
  directions/objects specifically to avoid an unrelated accidental match; whether distance-≤-1 is
  the right bound (vs. distance-≤-2, which would also catch "loook") is a tuning question the build
  phase settles against real typos, not a design commitment made here.
- **The digest-hygiene fix (§1's companion, Phase 5) is optional relative to the rest.** §0's
  `roomAffordances` alone closes the actual dead end (category 1); Phase 5 only improves the prose
  quality of what's left over. Sequencing it last means it can be dropped without blocking anything
  else if it turns out to need more care than expected (e.g. some `hasA`/`usedFor` facts elsewhere
  in the store may be worth keeping raw for other, non-adventure callers of the same digest code).

## Non-goals for this document

- Not a real NPC dialogue system — `talk` (§5) reads back an NPC's own existing facts; it does not
  add branching conversation, memory of what was said, or new world content. A fully conversational
  NPC is a larger, separate feature.
- Not a rewrite of the fuzzy-matching architecture — §2 wires the existing, already-cited
  `fuzzy.mjs` primitive into one new call site; it does not change how the declarative grammar's own
  resolver works.
- Not a fix for every possible unrecognised imperative — the vocabulary stays closed by design
  (this project's standing preference); an input outside every verb/synonym/fuzzy-tolerance this
  document adds still gets an honest decline, never a guessed action.
