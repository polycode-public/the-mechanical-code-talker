# PLAN_MUD_MUDMMORPG.md — MUDIII's published, shared world

Status: DESIGN ONLY; deliberately the last phase, built only after the MUDIII page and its
shared-worlds phase have earned it. Split out of `PLAN_MUD.md` (2026-08-01).

## MUDMMORPG — MUDIII's published, shared world (a later phase, design only)

Everything before this phase (PLAN_MUD_MUDIII.md, PLAN_MUD_MUDIII_SHARED.md) is serverless:
one in-memory store per browser, shared only browser-to-browser over the P2P layer, with no
hosted state anywhere. This phase
adds one shared, AWS-hosted world with a public site. It is deliberately not v1, and it invents
no parallel hosting story — it reuses Backend D and the tiers (PLAN_MUD_SERVER.md), and fills the one gap they
leave open.

**The read path is a published snapshot, not a live query.** The precedent already ships:
chat.html fetches `./chat-seed.json`, a corpus snapshot built by `scripts/build-chat-seed.mjs`
and served as a static file. MUDIII online generalizes that from a fixed file to a changing
world, and the model to copy is how live video travels over HTTP. HLS (IETF RFC 8216) serves a
stream as an `.m3u8` playlist — a manifest listing short media segments — which a live player
re-fetches as a sliding window; MPEG-DASH (ISO/IEC 23009-1) does the same with an XML `.mpd`
manifest. Both exist because a client joining a live stream must never replay it from frame
zero: encoders insert periodic keyframes, and a joiner starts at the nearest one. The tmct
equivalents, all static JSON on the same host as the page:

- `world-manifest.json` — the playlist: world name, the latest whole's URL and turn number,
  the delta segments published since it (each with its turn range and content hash), and the
  retained older wholes (for rewind, below).
- `whole-<turn>.json` — the keyframe: the full consolidated fact snapshot as of that turn.
- `delta-<fromTurn>-<toTurn>.json` — the frames between keyframes. Facts are append-only rows,
  so a delta is literally the rows appended in that interval — cut at turn boundaries, no diff
  algorithm anywhere.

A joining client fetches the manifest, the latest whole, and any newer deltas; a playing
client polls the manifest for fresh deltas, exactly an HLS live-playlist reload. The publisher
periodically consolidates a new whole and trims the oldest deltas, continuously rebuilding the
starting point so no client ever replays unbounded history.

**This is the same artifact pair PLAN_MEMORY_BACKEND_AWS.md already designed, published.**
That plan's marginalia precedent is one JSON object per graph version in S3 (`tree.vN.json`)
with DynamoDB holding only a lightweight manifest/version-pointer row. The whole-plus-pointer
half of this design is that pattern verbatim; what this phase adds is the delta segments
between versions and a client-facing manifest on a public static host (S3 + CloudFront —
PLAN_AWS.md's territory). Point at that plan; do not derive a second manifest design.

**The publisher is also the authoritative ticker.** Somebody has to advance a shared world
whose players are mostly absent. A scheduled batch job (the same CI-shaped species as Tier 1's
corpus-seeding job — no request-serving Lambda, no API Gateway, keeping Backend D's
no-server-to-operate posture) reads the world's Backend D table, runs K deterministic ticks,
appends the world facts back, cuts the delta, consolidates a whole when the cadence says so,
and publishes to the static host. The engine's determinism makes this job reproducible and
auditable.

**How this reconciles with the tiers: it is the missing read path, not a new tier.** Tier 1
and Tier 2 answer who may write which DynamoDB table. Neither says how someone with no AWS
credentials at all reads a world — the manifest is that answer, and it is a property any
server can have: the guest world gets it from the maintainer's publisher job, and a Tier 2
self-hoster can run the same job against their own table. Reading costs nothing and needs no
identity. Writing splits three ways:

- **Anonymous browser play**: read the snapshot, mutate locally, full game, nothing pushed.
  Offline play is the same thing with the fetch skipped — and the local simulation continuing
  the NPCs from their last-published state is just v1's own client-side engine doing what it
  already does; no new mechanism.
- **Authenticated write-back — Cognito, without resurrecting Tier 3.** Tier 1 already defines
  a Cognito Identity Pool and uses its unauthenticated side. The browser write path is that
  same pool's authenticated side: a Cognito User Pool sign-in feeding it, with the
  authenticated IAM role allowed durable writes (no 8-hour TTL, or a much longer one) to the
  shared world's table. PLAN_MUD_SERVER.md's non-goal dropped Cognito social-login federation with
  per-server Groups as the mechanism for private servers; that stays dropped. This is
  authenticated access to the one shared public world — the browser-shaped sibling of the
  guest identity, on infrastructure Tier 1 already owns. Tier 2's Identity Center flow stays
  the CLI answer for private servers; `aws sso login` has no place inside a browser page,
  which is exactly why the browser path lands on Cognito.
- **What pushes up**: the player-authored fact layer — placed morsels, told-facts, taught
  knowledge — each already carrying player provenance. The world-turn history never pushes
  up: the publisher owns the authoritative turn sequence, and two diverged `@turnN` histories
  cannot merge (both fork minted their own turn 12). An offline session is a fork; rejoining
  means fetching the latest whole plus deltas and replaying your own player-authored facts on
  top, deduplicated by the same content-hashed-id idempotence `mergeIncomingFacts` already
  gives the P2P path. Conflicting authed teaches resolve exactly as PLAN_FACT.md resolves
  them everywhere else: latest-observation-wins with the tie steps and the contradiction
  report — nothing MUDIII-specific.
- **P2P**: a fetched snapshot is also a share-able world. The shipped WebRTC mesh (PLAN_MUD_WEBRTC.md) works on
  the same fact-row store, so a player can invite peers into their fork without the server
  ever knowing.

**Rewind is a filter, on two clocks that already exist.** Nothing here is a new mechanism —
this is the fact-model work paying off:

- **Board rewind (turns).** World facts are `subject@turnN` snapshots and the fold derives
  its turn counter as the largest suffix seen. "Show the square at turn T" is the same fold
  run over only the rows with suffix ≤ T. PLAN_FACT.md draws this boundary on purpose: its
  per-source table stores no `mgx:observedAt` for mud/world turns, and it notes the fold is
  latest-observation-wins in spirit "but its 'time' is the turn counter, not `observedAt`" —
  the turn counter is the world's own clock.
- **Testimony rewind (wall clock).** For the taught/told layer, PLAN_FACT.md's bitemporal
  split (Snodgrass; SQL:2011) already defines the axis: `mgx:createdAt` is transaction time,
  `mgx:observedAt` is valid time, and `effectiveObservedAt`'s fallback chain (stored
  `observedAt`; agent-kind sources fall back to the provenance tag's timestamp then
  `createdAt`; document-kind and entailed sources never fall back) gives every record its
  place on it. "The world as of <date>" is a filter to `effectiveObservedAt ≤ T`, and that
  plan's "as of <date>" teach frame already gives chat the vocabulary for dates.

The published artifacts then make deep rewind cheap: a whole is a keyframe, so seeking to
turn T means fetching the nearest retained whole at or before T and replaying deltas up to T
— the exact seek-to-keyframe pattern every video player uses. How far back rewind reaches is
a retention choice the manifest states outright (which old wholes and deltas stay published),
never an unbounded promise.

**Held open, for when this phase is picked up**: the whole-consolidation cadence (every K
turns) and delta granularity; the retention window; whether anonymous writes to the shared
world keep Tier 1's 8-hour TTL exactly (the default answer is yes); and whether the guest
world and the published MUDIII world are one table or two.

