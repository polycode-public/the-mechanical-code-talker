# PLAN_MUD_MUDIII_SHARED.md — shared MUDIII worlds over the mud.html share/join layer

Status: DESIGN; a later phase, built only after `PLAN_MUD_MUDIII.md`'s page ships. Split out of
`PLAN_MUD.md` (2026-08-01).

## MUDIII shared worlds — mud.html's share/join layer on mudiii.html (a later phase)

Scoped 2026-08-01 as its own phase: PLAN_MUD_MUDIII.md completes with `mudiii.html`
deployed alongside mud.html, and this phase then brings mud.html's shipped share/join/waiting
flow to that live page — the same solo-first order mud.html itself
followed. It reuses the shipped layer wholesale rather than porting anything. One requirement
reaches back into the MUDIII engine build (the epoch-aware fold, below), and is called out in
PLAN_MUD_MUDIII.md's build order so it lands early.

- **The layer comes in as-is.** The lazily-imported shared bundle (`import("./vendor/p2p.js")`
  on share/join only), the invite link and join card, the two-paste offer/answer exchange, the
  closed connection-state set (`sharing`/`answering`/`connecting`/`connected`/`failed`) with its
  `.state-pill`, the net panel, and `room.rebind` on Reset. None of it is mud-specific, and the
  session store is the same shape — the reason deferring it was cheap is the same reason this
  phase is.
- **Claims, verbatim.** One claim per driven animal (`mgx:playedBy`, first-claim-wins by
  timestamp), wolves and goblins alike — the rule the mud integration settled. A page runs
  tickers only for the animals it claims; an unclaimed animal sits still, and cross-peer
  autoplay coordination stays deferred exactly where mud.html left it. The agent-select dropdown
  defaults to this page's claimed animal, so follow and POV open on your own character.
- **One new export for the sync filter.** The delta a joiner needs is per-turn-tagged facts,
  seed rows excluded — mud.html's rule verbatim — so `predator-prey.mjs` bundles its
  state-predicate set as the counterpart of `adventure.mjs`'s `isMudStatePredicate`. The
  told-fact channel rides the same sync (told facts are ordinary appended rows), which is what
  makes cross-peer deception work: a lie taught on one page lands in the belief panel of the
  peer driving the target animal.
- **Seeded world events are already replication-safe.** Crumb spawns, eats and starvation are
  deterministic functions of the folded facts (seeded by world name, turn and id), so any two
  peers running the same pass mint byte-identical rows with the same content-addressed ids, and
  `appendFacts` unions them into one fact. The seeding chosen for byte-identical replays doubles
  as idempotent world events over the wire, with no coordinator to elect.
- **The engine requirement built in during MUDIII itself:** the predator-prey fold ranks by
  `(epoch, turn)` from day one, the way `foldWorldState` now does, so a Reset on a shared world
  (a recast plus `room.rebind`) can never be outranked by a stale pre-recast snapshot. mud.html
  learned this as a retrofit; MUDIII builds it in.
- **Remote labels.** An animal whose latest `mgx:playedBy` names another peer gets mud.html's
  "via <node name>" second line on its HUD card, and a small billboard nameplate over its mesh
  in the 3D view (dimmer, about two-thirds the name's size — the sprite-label convention
  restated for meshes). Local and unclaimed animals get neither.
- **Transient divergence stays the same known, momentary risk** — two peers acting on the same
  object before convergence — and the same deterministic post-merge sort in the networking layer
  covers it. Nothing new to build.
- **The e2e scenario.** `test-e2e/pages-mudiii-p2p.test.mjs`, mirroring
  `pages-mud-p2p.test.mjs`: two peers share a square, claim the wolf and a goblin, one places a
  morsel the other's animal paths to, and a false teach-frame ("@goblin the wolf is west") shows
  up in the belief panel on the peer driving that goblin — deception proven across the wire.

