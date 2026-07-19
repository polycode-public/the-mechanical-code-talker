tmct playtest 010 — adventure round 2 of the second hunt — auto-play and the graphical renderer, driven directly (no dead-end found)
=====================================================================================================================================

tmct version under test: 2.7.16

Area: the adventure game's two brand-new features from `PLAN_GAMES_UPLIFT_V2.md` Part B — the
goal-inferring auto-play mode and the graphical room renderer — neither has a chat-CLI entry point
by design, so this round drives them directly via Node instead of the usual piped-CLI recipe.

Axes explored this iteration: a blind auto-play run from the opening room; a human-to-auto-play
handoff mid-session (manually picking up the key, then handing off with the human's own visited
rooms seeded as exposure); a full room-by-room trace of the exploration order and the exposure set
after each tick; the renderer's scene-object list both before and after a hidden container
(the portrait) is opened.

Axes still untouched: the actual browser page end-to-end (a headless-browser/e2e-style check, not
attempted this round); chat-told positional facts feeding auto-play's belief (not applicable —
auto-play has no belief/vision model, it reasons over full exposure, by design).

Probe recipe: a small Node script driving `adventureTurn`/`runAdventureAutoplayTick`/
`roomSceneObjects` directly (not reproduced here in full — see the round's own investigation for the
exact script; no product code needed a CLI reproducer this round since nothing broke).

Result
------

**No dead-end found.** Three things confirmed working correctly:

1. **Auto-play's exploration is efficient and correct.** A full trace from the opening room visits
   all 6 of Ashcombe Hall's rooms (study, cellar, library, kitchen, garden, drawing-room) in a
   sensible order — a short dead-end branch (cellar) explored and backtracked from immediately,
   then a longer branch (library → kitchen → garden) explored fully before backtracking efficiently
   (multi-step plans, not one wasted step at a time) — then correctly reports an honest stall once
   every reachable room is exposed with no objective ever found. This is the CORRECT outcome: the
   letter sits behind a locked-cabinet/hidden-key/portrait chain that auto-play's explore/fetch/win
   logic deliberately doesn't attempt (`PLAN_GAMES_UPLIFT_V2.md`'s own stated non-goal — "a world
   with a multi-step or conjunctive goal is a further increment, not solved here").
2. **A human-to-auto-play handoff behaves consistently**, even when the human already carries the
   key needed to unlock the cabinet: auto-play still only explores (never attempts unlock/open), so
   it still stalls honestly rather than fabricating progress toward a goal it can't reach with its
   current move vocabulary — the same documented limitation, not a new one.
3. **The graphical renderer never leaks a hidden object.** `roomSceneObjects` correctly omits the
   key from the drawing-room's scene before the portrait is opened, and correctly includes it
   (as a `portable`-class sprite) immediately after — verified directly, not just via existing test
   coverage.

No fix needed this round; no commit, roll, or push follows (nothing changed). Continuing to round
3 with a fresh probe angle.
