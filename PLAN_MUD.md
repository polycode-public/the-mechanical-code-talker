# PLAN_MUD.md — persistent, shared tmct worlds over a `server:` memory backend

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-12 session, evolved across six rounds of the operator's own framing (kept verbatim, in
order, since each round revised the design and the reasoning for the revision matters):

1. "How can I expose an ssh server that people can ssh into anonymously run just the `npx ... chat`
   command and nothing else so the ssh session quits if the program quits and the logged in user
   only has execute permissions for that node command and that node command runs a shared sqlite
   graph on fargate instance and it periodically writes and export to s3, and reads the latest export
   on task re-load so that real users could interact with a persistent agent in a sandbox safe enough
   to have trivial ssh credentials?" — the original SSH/Fargate/S3 design (superseded, see below).
2. "I am an advocate of serverless and scale to zero, is there an sqlite look-a-like in AWS in a
   serverless model, and can we have a sessionless ssh so actually each call opens a new ssh
   connection, does what it needs to and exits and then use a lambda as an ssh server?" — the pivot
   away from a persistent listener.
3. "Actually, I think the route is better without ssh, we expose an API which is called if we run
   `npm run chat --server <server-name>` which then uses an API which access a namespaced storage
   backend matching server-name, ideally we would do almost nothing to host this, just expose
   whatever is the easiest AWS storage engine that exposes an API for free, then we have a new
   storage backend so it's actually not `--server` but the `--memory-backend` (or whatever) with the
   value being `server:<server-name>`" — dropping SSH entirely: no shared host to log into at all,
   every user runs tmct locally against a shared remote backend. Confirmed as the direction.
4. "Yes use this new design and can we have the server name actually being a dynamodb table name
   with the tmct package published use a package.json picking a specific anonymous guest server, and
   this also be trivially extensible to create a new table, with a specific set of cognito accounts
   that can access it and these people would somehow auth via their socials to access a shared
   private server?" — the DynamoDB-table-per-server design, with a Cognito-social-login private tier
   (Tier 3, since superseded — see round 5).
5. "Anonymous tier 1 users can write ... we will give anonymously created data an 8 hour TTL, long
   enough to try for a day, and seed this from an authed AWS session from the ci server so the
   lexicon etc... is durable and I assume we can set a throttle on the table to keep in the free
   tier. Then Tier 2 is the only interesting one, I can create an identity center account for private
   server users and that's enough. The repository is open source so users can clone it and deploy
   their own AWS resources and Tier 2 is then serving the audience of tier 3 so we can drop tier 3."
   — resolves Tier 1's open trust question (TTL, not a new trust tier), replaces Tier 3's
   Cognito-social-login design with IAM Identity Center (Tier 2 only, no custom auth code needed at
   all), and drops Tier 3 outright: self-hosting (already Tier 2's own model, and the repo being open
   source) already serves the "specific people, privately" audience Tier 3 was built for.
6. "`npm run chat --memory-backend server:<handle>@<server>` this sets a user handle this is a source
   in the graph, and we will adapt the 'you told me', to be '<handle> told me' and we should be able
   to ask about that source 'what did <handle> tell you' and see this in source attribution when you
   hit on a touched fact." — adds a per-user identity layer on top of the storage design: a `handle`
   becomes a real, queryable Source, not just a display label. **This is the confirmed, current
   design.**

Still named `PLAN_MUD.md`: a persistent, shared world-state multiple users mutate together is still
the governing shape (`PLAN_ADVENTURE.md`'s single-player groundwork is a different axis — grammar,
not multi-user persistence). What changed across the six rounds is entirely *how a client reaches
that shared state, and who it says it is once there* — SSH-into-a-shared-host, then
Lambda-as-SSH-server (rejected, Lambda has no raw TCP listener), then a remote storage backend
reached directly over AWS's own SDK with no custom server at all, then a real per-user identity
carried on every fact that backend writes.

## Confirmed baseline (tmct's own code, verified this session)

- tmct now has a real, working multi-backend memory seam, landed this same session
  (`src/adapters/memory/core.mjs`): **Backend A** (the flat OWL-labelled JSON file, the default, unchanged),
  **Backend B** (`createInMemoryStore`, pure in-process, `core.mjs:199-220`), **Backend C**
  (`createSqliteMemoryStore`, a resident `node:sqlite` connection, WAL mode, `core.mjs:221-308`).
  Selected via `openMemoryBackend(repoRoot, backendChoice)` (`core.mjs:339`), the ONE shared resolver
  both `tmct init`'s corpus seeding and `chat.mjs`'s `createSession` now call — closing a real bug
  found and fixed this same session where seeding didn't respect the configured backend.
- Selection precedence, already real and tested: `--memory-backend <value>` CLI flag (on
  `init`/`import`/`chat`) > `TMCT_MEMORY_BACKEND` env > `tmct.toml`'s `[memory] backend` field >
  `"default"` (`src/services/chat.mjs:9444`). A flag on `init` writes straight into `tmct.toml`
  (`src/services/init.mjs`), so a later flagless `tmct chat` in that repo picks it up automatically — the
  exact mechanism this document's `server:<name>` value plugs into as a fourth backend, "Backend D."
- **The closed-set validator needs one small, precise extension.** `enumFlag` (`src/services/cli-args.mjs:82`)
  currently validates `--memory-backend` against an exact-match closed list
  (`["default","memory","sqlite"]`). `server:<handle>@<name>` isn't a member of a closed set — it's a
  parameterized value, the same *shape* (not reusing the same function) as this codebase's own
  well-established `scheme:value` provenance-tag convention (`corpus:`, `corpus-weak:`, `web:`,
  `ace:chat:`, `extracted:` — all parsed by prefix in `src/adapters/memory/core.mjs`'s
  `provenanceTagToSource`). The validator needs a second branch: accept the closed set OR a value
  matching `/^server:([a-z0-9_-]{1,32})@([a-z0-9-]{1,64})$/` — group 1 the handle, group 2 the server
  name (name-length-bounded, since it becomes part of a real AWS resource name below). A bare
  `server:<name>` with no `@handle` should stay valid too (see Handles, below — a handle is optional,
  not required to reach a server). `openMemoryBackend` gets a matching new branch dispatching to this
  document's new Backend D module.
- **Existing precedent for exactly this per-source trust/reliability tracking already exists** —
  `memory/trust.mjs`'s `sessionReliabilityFrom` (`trust.mjs:219`) and `mgx:sourceReliability`
  already implement "one Source accumulates a track record across multiple writes, nudging its own
  trust contribution up or down," currently keyed by SESSION id. A handle is the natural
  generalization:
  the SAME mechanism, keyed by a stable per-user identity instead of a throwaway session UUID, so a
  handle's reliability accumulates across every session that handle ever connects with.
  No new trust math is needed, just a new Source-identity shape feeding the existing one.

## Backend D — a DynamoDB table per named server, reached directly over the AWS SDK

**No server to write, host, or operate.** DynamoDB's own SigV4-signed HTTP API *is* the API — this
was the operator's own explicit ask ("whatever is the easiest AWS storage engine that exposes an API
for free"). tmct's Backend D module calls `@aws-sdk/client-dynamodb` directly; there is no Lambda, no
API Gateway, no custom backend service anywhere in this design. DynamoDB on-demand billing is
pay-per-request with a real always-free tier, and an idle table (no requests) costs nothing beyond a
small storage fee — the "one table per server" shape the operator specified (not one shared table
with a partition-key prefix) costs effectively $0 per additional idle server, which is what makes
"trivially extensible to create a new table" cheap to actually offer.

**Table shape**: one item per Fact/Source/Utterance/Session individual (the same individual shape
`loadMemory`/`appendFacts` already produce for Backend A/C — Backend D's job is translating that
shape to/from DynamoDB `PutItem`/`Query`/`BatchWriteItem` calls, not inventing a new data model).
Partition key = individual `id` (already globally unique per graph, content-hashed for Facts); no
sort key needed for the basic shape, though a `class` attribute with a Global Secondary Index lets a
future `/memory`-style listing query "every Fact" without a full table scan. A per-item `expiresAt`
attribute (Unix epoch seconds) is DynamoDB's own native TTL field (see Tier 1, below) — present only
on items that should expire, absent (and therefore permanent) on everything else.

**`server:<name>` resolves to table name `tmct-server-<name>`** (the `tmct-server-` prefix avoids
collision with anything else in the same AWS account, and keeps the mapping from CLI value to AWS
resource name mechanical and auditable). Region is a second, separately-resolved setting (env var or
a `[memory] server_region` `tmct.toml` field, default to a single fixed region for the shipped guest
server specifically, see below) — DynamoDB table names are only unique per account+region, so the
region has to be pinned somewhere, not inferred from the table name alone.

## Tier 1 — the anonymous guest server, shipped in the npm package, zero setup

The operator's ask: "the tmct package published use a package.json picking a specific anonymous
guest server." Concretely:

- One AWS account (the tmct maintainer's) owns a single DynamoDB table, `tmct-server-guest`, in one
  fixed region.
- One **Cognito Identity Pool** with unauthenticated (guest) identities enabled, its attached IAM role
  scoped to exactly `dynamodb:GetItem`/`PutItem`/`Query`/`BatchWriteItem` on ONLY that one table's ARN
  — no `CreateTable`, no `DeleteTable`, no access to any other resource. This is the direct
  replacement for the original design's "trivial ssh credentials": a Cognito Identity Pool ID is
  *meant* to be public and embedded in client apps (that's the whole point of unauthenticated
  identities) — leaking it changes nothing, since the attached IAM role is the real, narrow security
  boundary, precisely mirroring how the original SSH design's shared key was safe because
  `ForceCommand` (not the key) was the boundary.
- The Identity Pool ID (and the fixed region) ship as a small, plain default-config object — either a
  new field the operator's own instruction named, e.g. `package.json`'s own custom field
  (`"tmct": {"guestServer": {"identityPoolId": "...", "region": "...", "table": "tmct-server-guest"}}`,
  following the precedent of other tools that stash tool-specific config under a namespaced
  `package.json` key), or a small shipped `src/memory/backend-server-defaults.mjs` constant — either
  is fine, the requirement is just that it ships IN the published package, not fetched at runtime, so
  `server:guest` (or `--memory-backend server:guest`, or possibly a bare `server` defaulting to
  `guest`) works the moment someone runs `npx @polycode-projects/the-mechanical-code-talker chat
  --memory-backend server:guest` with zero prior setup — no account, no AWS credentials of their own,
  nothing to configure.
- Client-side credential flow at connect time: exchange the (public) Identity Pool ID for temporary,
  narrowly-scoped AWS credentials via Cognito's `GetId`/`GetCredentialsForIdentity` unauthenticated
  flow (a standard two-call AWS SDK sequence, no custom code beyond calling it) — those temporary
  credentials are what Backend D's DynamoDB calls actually use. Nothing long-lived is ever stored on
  the connecting user's machine.

**Anonymous writes get an 8-hour DynamoDB-native TTL — resolves the "does anonymous write access need
its own trust tier" question this document originally left open, without inventing a new
`SOURCE_PRIOR` tier at all.** Every item Backend D writes while connected as the unauthenticated guest
identity gets `expiresAt = now + 8h` set at write time (client-side, by Backend D itself — DynamoDB
doesn't decide this on its own, it only auto-deletes items that already carry a past-dated TTL
attribute). "Long enough to try for a day" (the operator's own framing) — a visitor's session
survives, and so does anything they taught, for as long as a normal exploratory visit needs, then it
quietly ages out. One honest caveat worth stating plainly: DynamoDB's own documentation describes TTL
deletion as happening within roughly 48 hours of the expiry timestamp on a background sweep, not at
the exact second — fine for "long enough to try for a day" (the operator's own bar), not something to
rely on for split-second precision.

**The durable baseline (corpus/lexicon knowledge) is seeded separately, by CI, with no TTL at all.**
A CI job — using a real, authenticated AWS session (an OIDC-federated role assumption from the CI
provider, the standard modern zero-long-lived-secret pattern for CI-to-AWS, not a static access key
checked into a secret store) — runs the SAME corpus-seeding path `init:large`/`init:xl`/`init:xxl`
already produce (this session's own corpus scale-up work), writing those facts into
`tmct-server-guest` WITHOUT ever setting the `expiresAt` attribute. CI re-runs (on each release, or
whenever the corpus changes) upsert this baseline, keeping the guest server's foundational knowledge
in step with whatever `init:large` seeds locally — durable, never TTL'd, distinguished from
guest-taught data purely by the presence or absence of one attribute, no separate trust tier or
schema needed.

**A table-level throughput cap keeps this inside the DynamoDB free tier.** DynamoDB on-demand tables
support configuring maximum read/write request-unit throughput (a real, documented AWS cost-control
feature, not something tmct has to build) — set low enough that even sustained anonymous traffic
can't exceed the always-free allowance. Requests beyond the cap are throttled (an ordinary retryable
DynamoDB error), not billed — a hard ceiling on the guest server's cost, not a soft budget alert.

## Tier 2 — self-service private servers, gated by IAM Identity Center

The operator's ask, across rounds 4-5: "trivially extensible to create a new table... I can create an
identity center account for private server users and that's enough... Tier 2 is then serving the
audience of tier 3 so we can drop tier 3." Tier 2 is now the ONLY tier beyond the anonymous guest
server — it serves both the original "just my own private table" case and the "specific named people"
case Tier 3 was built for, at a fraction of the implementation cost.

**Table creation**: `tmct server create <name>`, using the OPERATOR-RUNNING-THE-COMMAND'S OWN real AWS
credentials (standard AWS SDK credential resolution — nothing new to build for this half) to call
`CreateTable` directly for `tmct-server-<name>` (on-demand billing, no capacity planning — one SDK
call, no CloudFormation/CDK stack needed), then write `[memory] backend = "server:<name>"` into the
local `tmct.toml` — reusing the exact "a CLI action writes into tmct.toml so a later flagless command
picks it up" mechanism `--with-persona`/`--memory-backend` already established this session.

**Named-account access control uses AWS IAM Identity Center (formerly AWS SSO) instead of Cognito
social-login federation — and needs ZERO custom authentication code in tmct at all.** This is the
key simplification round 5 brought: Identity Center already provides real, individually-provisioned
(or externally-federated, e.g. from Google Workspace/Entra ID if the self-hoster's AWS Organization is
already set up that way) named user accounts, its own hosted login UI, and session-token issuance —
and, critically, the **AWS SDK's standard credential provider chain already natively resolves
Identity-Center-based SSO profiles** (an `sso_start_url`/`sso_account_id`/`sso_role_name`-configured
profile in `~/.aws/config`, exactly what `aws configure sso` already produces). A self-hoster:
1. Enables IAM Identity Center on their own AWS account (a one-time, ordinary AWS administration
   task, entirely outside tmct's own code).
2. Creates or invites named users, and assigns each a Permission Set scoped to exactly
   `tmct-server-<name>`'s DynamoDB actions — ordinary IAM/Identity-Center administration, not
   anything tmct-specific.
3. Tells each invited person to run `aws sso login --profile <name>` once (a real, existing,
   well-documented AWS CLI command tmct doesn't need to reimplement) and then run
   `tmct chat --memory-backend server:<handle>@<name>` with that profile active. The AWS SDK's own
   credential resolution handles the rest — tmct's Backend D calls DynamoDB exactly the same way
   regardless of whether the active credentials came from Tier 1's guest identity or a Tier 2
   Identity-Center profile; only what the resulting IAM permissions actually allow differs.

**Why Tier 3 is dropped**: the repository is open source. Anyone wanting a
private, specific-people-only shared world can already clone it and stand up their own AWS resources,
which is exactly Tier 2's own model, just run by a different person for a different table. Tier 3's
entire purpose (restrict a shared world to a named set of real people) is already fully served by
"self-host your own Tier 2 server and manage your own Identity Center users," at zero additional tmct
code. Building a second, parallel, tmct-hosted multi-tenant identity system (Cognito social login,
per-server Groups, a custom OAuth callback flow) would duplicate what Identity Center + self-hosting
already gives away for free.

## Handles — a per-user identity carried on every fact, not just a display label

The operator's newest ask (round 6): `--memory-backend server:<handle>@<server>` should make `handle`
a real Source in the graph, change how facts render ("<handle> told me" instead of the generic "you
told me"), support a new query ("what did `<handle>` tell you"), and show up in source attribution
whenever a handle-taught fact is the one that answers some other, unrelated question.

**A handle is about attribution, not trust — the trust question is already resolved above by tier.**
Tier 1 (anonymous guest) writes get the 8-hour TTL regardless of what handle a visitor types (handles
here are unverified, closer to an IRC nickname — fun and readable, not a claim of identity). Tier 2
writes, made with a real Identity-Center-authenticated profile, get full `teach`-tier trust — the
handle there corresponds to a real, administered account. The two concerns (who does this claim to be
called → attribution; how much should this claim be trusted → tier + TTL) are independent, and this
design keeps them that way rather than conflating "has a handle" with "is trusted."

**Source shape — reuses the `teach` mechanism, keyed by handle instead of session.** A new provenance
tag shape, `handle:<handle>@<ts>`, parsed by `provenanceTagToSource` (`src/adapters/memory/core.mjs`) into
`{ kind: "teach", handle: "<handle>", createdAt: <ts> }`. `sourceIdFor`'s existing `"teach"` branch
(`core.mjs:808`) currently mints `${TEACH_SOURCE_ID}:${sessionId}` when a session id is present —
needs a parallel branch minting `src:teach:handle:<handle>` instead when a handle is present, ONE
Source per handle, reused across every session that handle ever connects with (not a new Source per
session, unlike the anonymous case) — this is exactly what lets `mgx:sourceReliability`
(`trust.mjs`'s existing per-Source track-record nudge) accumulate real signal for a returning,
identified user over time, the same mechanism `sessionReliabilityFrom` already implements, just fed a
stabler identity key.

**Rendering: "`<handle>` told me" replaces the generic "you told me" for handle-attributed facts.**
`renderFactLine` (`src/services/chat.mjs`, the function this session's `corpusWeak`/`possibly:` hedge work
already extended once today) currently special-cases `ace:chat`/`teach:chat` provenance into "you told
me: ...". Needs a new branch, checked before that one: if the provenance is `handle:<handle>@...`,
render `${handle} told me: ...` instead. On a single-user local session "you told me" is unambiguous;
on a shared multi-handle server it isn't — always naming the actual handle (even the CURRENTLY
connected one re-reading their own fact back) removes that ambiguity rather than switching between
"you" and a name depending on who's asking. Citations stay VERBATIM either way (the existing,
already-documented principle in `renderFactLine`'s own docblock) — the readable part is the sentence
prefix, not the `(source: ...)` tag, consistent with how every other provenance kind already works
here; no new citation-formatting logic needed, just a new prefix branch.

**New query shape: "what did `<handle>` tell you"** is a reverse-by-SOURCE lookup, a new lane
in `chat.mjs`'s routing (nothing today filters facts by WHO stated them, only by subject term). Design:
resolve `<handle>` to its Source id (`src:teach:handle:<handle>`), find every Fact `mgx:statedBy`-
linked to that Source (the SAME edge group `recomputeFactTrust`/`statedByObjectsFor` already read for
trust computation, `core.mjs:915-931` — this query is that same lookup run in the opposite direction:
"which Facts point at this Source" rather than "which Sources does this Fact point at"), then render
the result the same way the existing `/memory`-style "N remembered facts about X" per-subject listing
already does, just keyed by handle instead of subject term — reusing an existing render template, not
inventing a new one.

## Exercising this design against `PLAN_OUDEZIJD.md`'s needs

`PLAN_OUDEZIJD.md` (a persistent, temporally-grounded city adventure) is this design's first
concrete second consumer beyond its own original ask — a real test of whether Backend D's shape
generalizes or needs a redesign. It mostly generalizes. Four gaps are real; each maps to a small,
additive extension of what's already designed above, not a new architecture.

**1. Durable world-content writes from an anonymous (Tier 1) session.** Tier 1's 8-hour TTL
(above) is correct for a guest's own teach/take actions, but wrong for `PLAN_OUDEZIJD.md`'s
lazily-generated room/NPC content (its §2), which needs to outlive the session that first
generated it even when that session was anonymous — otherwise every constructed fact a casual
visitor's exploration fills in vanishes in 8 hours, and the next visitor pays the same generation
cost over again for the same spot. **Fix: `expiresAt` is a per-item write-time decision, already
independent of which identity is connected** — Backend D already sets it per item, not per
connection (Tier 1's own text: "gets `expiresAt = now + 8h` set at write time... by Backend D
itself"). A new write-time rule, checked before the existing tier-based default: a write tagged
as world-content generation (§2/§2a's `constructed` provenance) omits `expiresAt` regardless of
tier, the same way CI-seeded baseline writes already do. No new mechanism — one more case in a
branch that already exists.

**2. A presence index: "has anyone been recorded at this (place, time)?"** `PLAN_OUDEZIJD.md`
§2a needs to answer this without a full table scan, for both the schedule-driven NPC read path and
the player-presence-replay path. **Already generalizes**: the table shape above already names
"a `class` attribute with a Global Secondary Index" as the mechanism for exactly this kind of
query. This needs one more GSI, on a composite `place`/`timeSlot` attribute pair, alongside the
existing `class` GSI already proposed — an additive index, not a schema change to the base item
shape.

**3. Revision without rewriting the past.** `PLAN_OUDEZIJD.md` §2a's resolution — a player
revisiting an identical (place, time) supersedes their own prior recorded actions there, but an
observer who already recorded a cross-player encounter keeps their own dated fact — is the SAME
same-slot-replacement pattern `src/domain/discourse.mjs`'s `register()` already implements this
session for discourse referents (a new registration replaces the same slot going forward; nothing
already read is retroactively changed). Backend D doesn't need new machinery for this either: a
revised action-history item is a new content-addressed individual with a `supersedes: <old-id>`
attribute, exactly the shape Fact rows already use for corrections elsewhere in tmct. The GSI from
point 2 always resolves to the newest (non-superseded) item for a given (place, time); anything
written by an observer before the revision keeps pointing at the id it actually observed.

**4. Cross-player write-back into another player's own record needs no new permission model.**
`PLAN_OUDEZIJD.md` §2a's open question is abuse mitigation (still unresolved, named there,
not here) — but the mechanics of "player B writes a fact that becomes part of player A's durable
history" turn out to need nothing new from this design specifically, because Tier 2's access
control is already table-scoped, not row-scoped (point 3 in "Named-account access control," above:
a Permission Set is scoped to `tmct-server-<name>`'s DynamoDB actions as a whole). Any
authenticated player on a server can already write any item in that table today, by design — so an
item recording "player B's action, concerning player A's presence at (place, time)" is an ordinary
write with an `actor`/`concerns` attribute pair, not a permissions problem this document has to
solve. Worth stating plainly since it could easily be assumed to need new IAM design and doesn't.

None of these four require a new backend, a new tier, or new credential/authentication machinery
— every one is an additive attribute, an additive GSI, or a write-time rule on top of what's
already specified. That's the actual finding of this exercise: the design holds up against a
second, structurally different consumer without a redesign.

## Demo phase — `mud.html`: a self-contained proof of the shared, multi-character shape

**This demo does not touch Backend D, Tier 1/2, or a real network at all.** It's a single-page,
client-side, deterministic simulation — the same architecture `spider-fly.html`/`adventure.html`/
`plan.html` already ship (the real engine runs in the visitor's browser, no server, no LLM
anywhere). What it proves is the *governing shape* this whole document is named for: a persistent
world several characters mutate together, one of them able to dig new content into existence,
each pathing toward a goal built from what it's actually been told. Backend D is how that shape
eventually reaches a network; `mud.html` is proof the shape itself works, independent of and prior
to that question.

Shipped and linked from the home page as the tenth demonstration (`public/index.html`'s
two-block-per-demo shape: a claim card plus a fuller feature section with a screenshot).
Capability claim: **"Multiple actors, one shared world."**

### Layout — a soil cross-section, not a flat grid

Every demo page picks one visual register and commits to it: spider-fly's flat top-down canvas
grid, adventure's text-first room digest, plan's step-by-step block replay. `mud.html`'s own
register is a **layered soil cross-section** — two burrow panes, side by side on desktop and
stacked on mobile, with a control deck and a graphical burrow survey sharing the page's own top
row: the deck takes the left two-thirds (play, reset, the delay and max-turns sliders, the
explanatory note), the survey takes the right third. The survey draws every currently-dug room as
a real connected graph — named chambers, tunnels as strokes, a vertical shaft dashed — rather than
a flat text list, so it reads as an actual map of the burrow.

**Palette** — named for the subject, not a template default (not cream+terracotta, not
near-black+acid-green): `--soil-deep #2B1D14` (background), `--soil-mid #4A3324`, `--soil-light
#7A5A3D` (upper strata), `--root-moss #6B7A4F` (the garden surface), `--parchment #EFE6D8`
(pane/card background — dug clay, not white), `--ink #2A211A` (text, warm near-black),
`--burrow-glow #E8A33D` (the one warm accent — active panes, the current turn, a freshly-dug
room's flourish — spent in one place, not scattered).

**Type** — a characterful, slightly hand-cut display face for headings and room names (something
in Fraunces' register — an ink-trap serif with real personality, used with restraint), a plain
sans body face for descriptive text (IBM Plex Sans or Inter), and a monospace utility face for the
dense simulation readouts — turn counters, coordinates, mass/pouch stats (IBM Plex Mono) — so the
page's two registers (storybook burrow, live simulation telemetry) read as deliberately distinct
rather than accidentally inconsistent.

**Wireframe**:

```
+----------------------------------------+-------------------+
|  control deck                          |  BURROW SURVEY    |
|  play · reset · delay · max turns ·    |  (every dug room, |
|  the explanatory note                  |   every character,|
|                                         |   no fog of war)  |
+--------------------+--------------------+-------------------+
|  pane A            |          pane B                        |
|  (room · pouch ·   |          (room · pouch ·                |
|   compass ring ·   |           compass ring ·                |
|   chat+pills ·     |           chat+pills ·                  |
|   known ground)    |           known ground)                 |
+---------------------+---------------------+
```

Mobile stacks the same pieces top to bottom instead of side by side: the deck-and-survey row
first, then pane A, then pane B, scrolling — each pane a fixed size regardless of how much its
room description grows.

**Signature element**: a dug room visibly opens into the survey the turn it's created — a short,
`prefers-reduced-motion`-respecting dirt-particle flourish in `--burrow-glow` — the one bold move
on the page, everything else stays quiet and disciplined around it.

### Per-pane UI (×2)

- **Character**: two of the four burrowing-animal species (mole, vole, badger, groundhog) are
  drawn at random each time the world starts or resets, one per pane.
- **Room view**: one row tall. The viewing character's own sprite stands on the right; any other
  character present in the room stands on the left; loose objects hang on the back wall in
  portrait frames rather than scattered across the floor. Built over the same shared world state
  the chat log reads — the graphic is a rendering of it, not a second source of truth. **When two
  characters share a room and one talks to the other, a speech bubble renders over the speaker** in
  both panes that can see the room, holding the short form of what was said (the full exchange
  still lands in the chat log). A short, `prefers-reduced-motion`-respecting fade, matching the
  dug-room flourish's own restraint.
- **Pouch** (this demo's name for the inventory — a satchel doesn't fit a burrowing animal): shows
  clean item names, not the underlying minted id a dug object carries internally.
- **Chat, with pills**: a compass ring lays the six directions out at their own points on the
  room view — north/south centered top and bottom, east/west at the side edges, up/down as their
  own round chips — and offers only a `go` or a `dig` the world actually allows in that direction;
  a direction with neither draws nothing. Non-movement pills (`look`, `what do you know about
  food`, `talk to <character>`) sit below the ring, and only ever name a character actually
  present in the room.
- **Movement / dig**: `go <direction>` unchanged from the original grammar work. `dig <direction>`
  still only succeeds where no exit exists yet, and now also respects the room's own kind: an
  underground room can be dug on any exit-less side, the surface can only ever be dug straight
  down (and back up again, once underground) — never sideways.
- **Per-pane play/pause/step, and a genuine per-character turn count** — that character's own
  tally, distinct from the deck's shared count.
- **Known ground** (this demo's fog-of-war minimap): the room names that character has personally
  visited, nothing more.
- **Out of play, two ways**: a character that walks into the fox's den (below) is eaten, and one
  whose mass reaches zero starves. Either way its pane grays out, its controls disappear behind a
  plain "eaten · N turns" / "starved · N turns" notice, and it takes no further turns. The engine
  places it at a sentinel named for the fate ("eaten", "starved"); `outOfPlayReasonOf(state,
  character)` and each session window's own `outOfPlayReason()` give the page the word to show.

### The control deck (the page's own top row, shared with the survey)

- **Play**: starts every pane's ticker at once. Nothing plays on page load — a pane only starts
  once its own play control, or the deck's, is clicked.
- **Turn counter**: the shared count, incremented whenever any pane's character takes a turn —
  shown alongside, and distinct from, each pane's own count.
- **Delay slider**: the wait between turns in play mode.
- **Max-turns slider**: a hard cap on the simulation length.
- **Reset**: starts a fresh world and redraws which two characters are cast.
- **A short explanatory note**: plain prose describing what's actually happening on the page — two
  independent characters, one shared world, gaps that stay unknown rather than get guessed at —
  not sales copy, an orientation for a first-time visitor.

### World / map model

- **The garden is the surface** — pre-authored, all outdoor, and can only be dug straight down
  from, never sideways; the surface is the ceiling. A stationary fox lives in a den one dig off
  the underground start room and never moves on its own; a character that digs into it is eaten.
- **One level underground**, reached by digging down from the garden and extended sideways from
  there by digging any side with no exit yet.
- **The burrow has an edge.** The world names its own origin (`garden mgx:is-origin true`) and no
  dig may open a room more than six exits from it. A room at that distance offers no dig at all,
  so the compass ring never suggests one and the verb never has to refuse one; typing the dig
  anyway is declined in the world's own terms. Without the cap a character digs itself twenty-odd
  hops out into rooms nobody else will ever reach.
- **Some digs open a den.** One dug room in five is a food store rather than a bare tunnel, and
  one den in three is lived in — a resident mouse that knows what its own den holds, so a
  character that digs one out has somebody new to ask about food. What a dig turns up is the
  world's to say, through `mgx:dig-spawns`, `mgx:den-spawns` and `mgx:den-resident` on the room
  kind; the engine only decides how many and how often.
- **The central survey is the operator's omniscient view** — every dug room, every character, no
  fog of war, drawn as a real graph rather than a flat list. Each pane's own "known ground" is
  where fog of war still applies.

### Creature stats

Per-species mass and hunger-drain rate, generalizing `game-config.mjs`'s per-species constants —
one table entry per species. The fox is stationary and doesn't carry the same move/dig-reach stat
the roaming species do; it only ever needs to be present in its den.

The drain is charged for real, at the end of every scripted turn, and a character that reaches
zero starves. The rates are sized against the page's own default run (400 shared turns, so about
200 each for two animals): an animal that never eats dies about two thirds of the way through, and
one that forages does not.

### The turn algorithm

Every acting character's turn, in order:

1. **Investigate the room** (always, every turn):
   1. If another character is present, talking to it is preferred over the other investigate
      steps below — two characters sharing a room default to talking to each other, not past each
      other.
   2. Otherwise, ask what's known about food, answer if asked, and learn from the answer — a real,
      provenanced fact written into the asking character's own memory, not a one-tick value.
   3. If an unexamined object or food item is present, examine it and remember the detail, also as
      a durable, provenanced fact.
   4. Randomly do one of: take an object, put an object, eat an object (if it's food and the
      character is below 50% mass) — eating transfers the eaten item's remaining mass.
   5. Update memory with whatever changed.
2. **Walk toward the nearest unexplored edge**, via a room-graph pathfinder. The goal is a room
   holding a food fact this character actually knows about. A character with no food fact yet has
   nothing to path toward, and the pathfinder returns a plain miss — that miss *is* "I don't know
   where any food is," not a bug to patch around.
3. **If this turn's walk reaches an edge**, independently roll a chance for *each* of the
   following (a separate roll per option, not a single pick-one-of-three):
   - each available exit toward food,
   - each available dig direction the room's own kind allows — digging into the fox's den ends
     that character's run instead of opening a room,
   - each edge direction, to just keep following the edge toward food.
4. **If nothing above moved it, set off for a room it has never stood in.** This step makes a
   different claim from the food walk: it reads the character's own placement history, not
   anything about where food might be, so it invents nothing. It skips rooms a predator stands in,
   which keeps the fox a gamble rather than the nearest unvisited room everyone walks into. When
   every room within reach has already been walked, it says so and the character stands still —
   and the mass drain then decides how that ends.
5. **Charge the turn's mass drain**, and place the character out of play if it hits zero.

### A new NLP lane: listing what a character knows

"What food do you know about," and the same question addressed to a specific character by name
("groundhog-1, what do you know about food"), both answer from that character's own accumulated
food-knowledge facts — never the whole world's food, and never falling through to the code-graph
chat lane's own fallback reply on a near-miss phrasing.

### Sprites and the nature corpus

Mole, vole, badger, and groundhog all have hand-authored sprites; badger set the quality bar
(a fixed-palette marking carrying the animal's own identity, limbs breaking the silhouette, a
highlight that stays inside the body), and vole, mole, and groundhog have since been brought up to
match it. A new fox sprite, sitting and marked as a predator rather than one of the playable
species, was added for the den. The meerkat sprite, used elsewhere in the sprite set and not part
of this demo's own roster, is now the visually weakest of the group and is a candidate for the
same treatment. Nature-corpus content (real facts about each animal and its food) is unchanged
from the original plan.

### Multiplayer threading

Done: `adventure.mjs` threads a real acting-subject parameter through its command path instead of
a hardcoded `"player"`, and this demo casts as many simultaneous characters as it needs from that
— no shared "agent loop" abstraction across spider-fly/adventure/plan/mud was needed to get there,
consistent with `PLAN_ADVENTURE.md`'s own earlier call that a common wrapper isn't warranted.

## Proposed next architecture — real multi-browser worlds over WebRTC

**No networking or state-sharing code exists in `mud.html` today.** Everything above this section
runs the whole simulation inside one browser tab; nothing a visitor does ever leaves their machine.
What follows is a proposed design for the next real step: two or more separate people, each in
their own browser, sharing one live mud world over the network. It is design capture only. Nothing
here is built, and this section names it as a distinct next architecture rather than a description
of what ships. It's a different shape from Backend D, above: Backend D routes reads and writes
through a hosted DynamoDB table one client at a time. This design has no server for game state at
all — every browser holds a full copy of the world and stays in sync by talking directly to the
other browsers in the room.

**Networking**: no rendezvous service, not even a public one. Every connection is a direct WebRTC
offer/answer exchange between two browsers, and nothing else is involved. Starting a world generates
one UUID in the browser, on the spot — it never touches a server; it's the stable id a browser uses
to keep this world's triple store separate from any other one it's part of. The page also draws a
few words from its own taxonomy, the same lexicon that grounds every fact, to give the world a
human-readable name — a mnemonic for the players, not a credential. To invite someone, a live
member's page creates a fresh SDP offer and encodes it into a URL alongside the world id and name:
`mud.html?offer=<blob>&world=<uuid>&name=<generated-name>`. That link travels however the two people
already talk: pasted into a message, AirDropped, read out over the phone, whatever's at hand. Opening
it makes the joiner's browser generate the matching answer and offer it straight back as its own copy
action, so sending it home is the same motion as receiving the invite was — paste the reply into the
same thread. The inviter's page sits with a small "paste a reply to connect" box open, waiting; pasting
the friend's reply there is what actually completes the connection. Two paste actions, one each way,
and nothing automatic in between. This only works while the peer being invited is actually online to
answer — it's a phone call, not a mailbox, and a link on its own can't finish a connection to someone
who's stepped away. Once that first DataChannel opens, joining the rest of the room needs no further
manual exchanges: the peer who answered already knows everyone else currently connected and introduces
the newcomer to each of them automatically over the channel that's now open.
The archivist peer described under Persistence, below, is the natural target for invites for exactly
this reason — it's the one member guaranteed to be there to answer.

**The lexicon as ingest validator.** `mud.html`'s world vocabulary already ships in the page as a
closed-world grammar. Free-text input gets parsed against it today, and only facts grounded in that
ontology are ever accepted. A networked world reuses that same gate as the front door for shared
state: validate before storing or broadcasting a fact, and validate again on receipt of any peer's
fact. Re-checking on receipt is defense in depth. It means a malicious or simply buggy peer can
never inject an ungrounded fact just by being on the wire.

**Replication as a CRDT.** The closed-world triple store becomes a state-based G-Set CRDT: merge by
set union. Union is commutative, associative, and idempotent, so peers converge on the same state
regardless of what order facts arrive in or how many times the same fact shows up. Each accepted
triple broadcasts as an op to the room. On peer join, exchange full state (or just a hash of it
first, skipping the transfer entirely when it already matches). Plain union has no way to remove a
fact, so retraction needs one more piece: an OR-Set, tagging each assertion with a UUID and
retracting by tag, or last-writer-wins on a (subject, predicate) pair for functional predicates like
a character's location, with timestamp and peer id as the tiebreak.

**Efficient world sync for a new joiner: deterministic sharding.** Partition the converged triple
set by `hash(canonicalTriple) % K` for a fixed K (say 64). Every peer computes the same shard
hashes from the same triples, so the partition needs no coordination. A joiner asks everyone in the
room for a manifest, `{rootHash, shardHashes[K]}`, takes whichever manifest most peers agree on,
then assigns the K shards round robin across the P peers who answered. Each peer uploads roughly
1/P of the world, so the joiner's total download is about one full copy split across many
connections instead of one. The joiner checks each shard against its hash and re-requests any
mismatch from a different peer. It subscribes to live fact ops from the moment it starts syncing,
not after — because the CRDT merge is idempotent, any overlap between the historical sync and the
live stream is harmless. A later, slower per-shard Merkle comparison can mop up stragglers if some
peers hadn't fully converged before the sync ran.

**Direct pairwise chat.** With a mesh of DataChannels already open to everyone in the room, a
targeted chat action, `sendChat(msg, peerId)`, is already point to point. It never transits another
participant's browser. Chat itself stays out of the triple store entirely: it's ephemeral, never
gossiped, sharded, or exported. What does belong in the triple store is a small character-to-peer
registry, kept as last-writer-wins facts such as `(alice, playedBy, peer:abc123)`, so a chat target
still resolves correctly after someone reconnects with a new peer id.

**Persistence — an infinite, serverless-durable world.** Each browser persists its triple store to
IndexedDB, not `localStorage` (too small, and synchronous). Calling `navigator.storage.persist()`
asks the browser not to evict it under storage pressure. On rejoin, a peer loads its local copy
first, then runs the shard/Merkle sync above to catch up on anything it missed. Because merge is
union, offline time, divergence while disconnected, and a later reunion are all harmless — there's
no canonical server copy to protect, every player's browser is a mirror of the whole world. The
world only dies if every copy is cleared at once. The existing JSONL export/import format doubles
as a backup and reseed path. For durability that doesn't depend on any player being online, a
dedicated "archivist" peer works well: a pinned browser tab (an old phone on charger, kept awake
with `navigator.wakeLock.request('screen')`, added to the home screen as a PWA, and exempted from
battery optimization) or a small headless Node process, joining the same room but never playing.
Two things about this shape are worth naming as open design questions rather than solved: the
triple set (and its retraction tombstones) only ever grows, so it eventually wants compaction or
spatial sharding, and the world currently has no membership gate beyond someone being online to
answer your connection offer — see forgery prevention, below, for the piece that adds real
per-player identity on top.

**Preventing forgery.** Give every player an Ed25519 keypair, generated with WebCrypto and
persisted in IndexedDB. Sign every fact as it's created: `{triple, author: pubkey, opId, timestamp,
sig}`. Peers verify the signature on ingest, as one more step in the same validation pipeline that
already checks a fact against the lexicon, and drop anything that doesn't verify — a forged fact
never enters the CRDT, even if a well-behaved peer unknowingly relays it. Bind a character to a key
inside the ontology itself, `(alice, controlledBy, key:abc...)`, decided first-claim-wins through
the same CRDT merge, so the lexicon can enforce that only the matching key's signature can assert
facts about that character. Impersonation becomes a failed validation check, not something players
have to police socially. Sign the timestamps used for last-writer-wins tiebreaks too, otherwise a
malicious peer could replay an old fact under a fresh timestamp — unique op ids plus signed
timestamps make a replayed fact a harmless no-op instead of a rollback. The same per-player keys
also support optional pairwise-encrypted private chat, using an ECDH-derived key between the two
participants.

**Snooping.** WebRTC DataChannels are mandatorily DTLS-encrypted on every pairwise connection, even
when a TURN relay is needed for NAT traversal, since DTLS terminates at the two peers rather than at
the relay. An observer on the network path, an ISP or a shared Wi-Fi network, sees only ciphertext.
There's no signaling relay left to protect, either, since the offer and answer travel directly
between the two people through whatever channel they already use — the same channel they'd trust to
coordinate anything else. What none of this hides is traffic metadata: that two IP addresses talked,
and when. That's a real, known limitation of this design, not a solved problem, and it's worth
stating as such rather than glossing over it.

Finding a world to join needs no infrastructure at all: a world's UUID is generated client-side and
never touches any server, including `tmct.polycode.co.uk`'s own hosting, so there is nothing to
discover except by receiving the link directly from someone already in the world. The only channel
for that is whatever the two people already share — a message, an email, AirDrop, a paste. This
keeps the design fully serverless: there's no public listing, no announce step, and no third party
that ever learns a world exists.

This combination doesn't appear to exist yet as a shipped project. The individual pieces are each
precedented on their own — serverless peer-to-peer games built on Trystero, CRDT-over-WebRTC
research prototypes like BrickSync, browser mud clients that shell out to a telnet server — but a
lexicon-constrained closed-world triple store, replicated as a CRDT over WebRTC and used as a game's
entire state substrate, doesn't turn up in what's been surveyed so far. That's worth noting as an
observation, not a strong claim; the search may simply not have found it. The point of this section
is the design itself, not the novelty claim.

### v1 implementation design

The section above sets the shape. This one is concrete enough to build from: exact wire messages,
exact files, exact test scenarios, for a v1 that ships two things — networked `mud.html` and
networked `chat.html` — sharing one P2P/CRDT layer between them. Nothing here is built yet; this is
still design, not code. Two discoveries changed how much of it needs writing at all.

**The CRDT merge function already exists.** `appendFacts` (`src/adapters/memory/core.mjs`) upserts a
fact by its content-addressed id (a hash of subject, predicate, object) and unions the incoming
provenance tag onto whatever's already stored at that id. That's a G-Set's merge rule, byte for
byte. A peer's incoming fact batch needs validating, then one call to `appendFacts` — no new merge
algorithm to write.

**The provenance UI already renders "taught by X."** `chat-page-viz.mjs`'s answer chip and citation
text already parse a fact's raw `teach:...` provenance tag and show it as "taught." A tag shaped
`teach:peer:<node name>@<timestamp>` parses under that same existing rule with no rendering changes
at all — the `sessionId` slot the parser already expects just holds a peer's node name instead of a
local session id.

**Signaling.** A share action creates an SDP offer and encodes it, along with the world id and world
name, into one base64url JSON blob carried in the URL (`?offer=<blob>&world=<uuid>&name=<name>`).
`RTCPeerConnection` is created with `iceServers: []` — no STUN, no TURN, nobody's infrastructure in
the loop at all. That's the real production setting the earlier section already committed to, not a
shortcut: it means signaling only completes between peers that can already reach each other directly
(same machine, same LAN, or a NAT that happens to allow it), which is a stated boundary of staying
fully serverless, not a bug to fix later. Candidate gathering runs to completion before the
offer is read out (no trickle needed without STUN), so the two-paste flow from the section above
stays exactly as described: one blob out, one blob back, done.

**Messages, once a channel is open**, all plain JSON:

- `hello { peerId, displayName }` — sent the moment any channel opens.
- `peer-list { peers: [{peerId, displayName}] }` — sent right after `hello`, so a newcomer learns
  who else is in the room.
- `intro-offer` / `intro-answer { from, to, sdp }` — mesh introduction. When peer C's first
  connection lands on peer B, and B already holds a channel to A, B relays a fresh offer from A to C
  and C's answer back to A, over the channels that are already open. This reuses the exact same SDP
  offer/answer machinery the manual link flow uses — only the transport for exchanging the blobs
  changes, from copy-paste to an open DataChannel. Once `intro-answer` lands, A and C are directly
  connected; B never relays game traffic afterward, only that one signaling round trip. Every peer
  ends up directly connected to every other peer this way — for a room of two or three people this
  is the right amount of mesh, not gossip relay.
- `sync-request` / `sync-response { facts: [...] }` — see state sync, below.
- `op { from, facts: [...] }` — a batch of newly-asserted facts, broadcast to every directly
  connected peer after a turn completes.

**Provenance relabeling.** A fact a person actually taught keeps its own local tag,
`teach:chat:<sessionId>@<ts>`, in their own store, untouched. Only the copy going out over the wire
gets relabeled: any `teach`- or `operator`-kind tag becomes `teach:peer:<my node name>@<ts>` before
broadcast. World-state and testimony tags from mud.html (`world:...`, `mud:...`) pass through
unchanged — they're already attributed to a world or a character, not a person, and relabeling them
would lose information rather than add it. On the receiving side, `appendFacts` unions this new tag
onto the same fact id exactly like any other provenance, including the case where the receiving
peer independently taught the identical fact — both tags corroborate the same id, correctly.

**Node identity is a fact, not a UI setting.** The host names the shared world when they start
sharing; that name is written once as `(<worldId>, mgx:worldName, "<name>")`. Every participant,
host and joiner alike, can set their own node's display name, written as `(peer:<peerId>,
mgx:nodeName, "<name>")` whenever it's set or changed. Both are ordinary add-only facts — changing a
name asserts a new one rather than retracting the old, and whoever's reading just takes the latest
by timestamp for that subject. That's an application-level "latest wins" read, not a new CRDT
primitive, and it stays consistent with the pure add-only design below. The default for both the
world name and a node's own name, before anyone overrides it, is two words drawn from the graph's
own lexicon — the same taxonomy-naming idea already used elsewhere in this document — with no
forced numbering; a number only gets appended if a live collision actually shows up among peers
currently in the room.

**The node list, on chat.html.** A panel listing every peer this graph currently knows about: each
one's node name (from its latest `mgx:nodeName` fact) and the timestamp of its most recent
contributed fact, sorted most-recently-active first. It reads existing data through the existing
panel-rendering conventions already used elsewhere on that page — it doesn't need new plumbing, just
a new query over facts that are already there.

**State sync on a join.** Every peer's page already ships with the identical build-time seed data,
so those facts already share the same content-addressed ids before any network traffic happens —
sending them again would be pure waste. What actually needs syncing is the delta: on chat.html,
every fact whose provenance is teach- or operator-kind; on mud.html, every fact carrying a per-turn
provenance tag (a move, an action, testimony) rather than the bare unsuffixed seed tag. A joiner
subscribes to live `op` traffic from the moment sync starts, not after it finishes — because merging
is idempotent by id, any overlap between the historical sync and the live stream is harmless. This
is deliberately simpler than the sharded/manifest scheme described above in this document; that
scheme is for a world too large for one browser to hold, and nothing at this scale needs it yet.

**mud.html: one human, one character.** A person claims a character by asserting `(<characterId>,
mgx:playedBy, <peerId>)` — an add-only fact, first claim wins by timestamp. A character nobody has
claimed simply sits still; deciding who autoplays an unclaimed character across several peers, with
no shared clock, is real coordination work that no scenario here actually needs yet, so it's left
for later rather than solved speculatively now. Talking to another player's character needs nothing
new at all: the room-cast lookup and the `talk` verb already read whoever's placed in a room from
shared facts, with no check for who controls them — a remote peer's character asserting an ordinary
movement fact is indistinguishable, to that machinery, from a local one.

**Conflict handling stays a pure add-only set for v1.** None of the scenarios this version needs to
support ever retract a fact, so there's no OR-Set or last-writer-wins predicate to build yet. The one
real, narrow risk worth naming: two peers both acting on the same object at nearly the same moment
could transiently fold to different results if their local fact arrays happen to be ordered
differently when each one reads them. The fix lives entirely in the new networking layer — sort
facts deterministically after every merge — so once two peers hold the same set of facts they always
fold it the same way, and the mismatch is only ever momentary. A fuller fix, giving every move its
own causally-ordered clock, is real future work and is named here so it's a known next step, not a
surprise.

**Persistence.** chat.html already snapshots its whole fact store to IndexedDB a moment after any
turn that changes it; because a peer-synced fact merges into that same store, it's covered by that
existing mechanism with no new save path, just one small added field recording which world a session
belongs to. mud.html has no persistence today and gets none in v1 either — nothing in the scenarios
this version supports exercises a mud reload, so a reload behaves as it already does: a fresh local
world, rejoin by a fresh invite.

**New files**: small, pure, Node-testable modules for peer/world id and default-name generation, for
the wire message shapes, for the sync filters, and for provenance relabeling; two browser-only
modules for the WebRTC transport itself and for room orchestration (mesh introduction, diff-and-
broadcast, merge, sync); one new build script producing a single shared bundle for both pages to
load at runtime, following the same pattern this project already uses for its one other real
browser dependency, so the networking code isn't duplicated into two separate page bundles; and one
small additive export from the mud world engine, bundling predicates that already exist but are
currently private, so the sync filter can tell state-changing facts apart from anything else. No
existing session factory's signature changes.

**Build order**: the pure modules first, since nothing else can be tested without them; then the
WebRTC transport alone, proven with the smallest possible two-page handshake test, so the one
genuinely novel and least-precedented piece in this whole design gets its own fast-failing checkpoint
before any page integration exists to obscure a failure in it; then room orchestration against a
fake transport, so its logic is fully covered without needing real WebRTC in every test; then the
shared bundle; then chat.html, since it's the smaller integration and it's where the taught-fact
scenario below lives, so it proves the whole stack end to end first; then mud.html; then the
scenarios that need more than two peers.

**The scenarios a working v1 needs to demonstrate**, each simulated by reading a generated link or
reply directly out of one browser context and feeding it into another's — never a real clipboard,
never a real chat app, since that's not what's under test:

- Two peers connect by the manual link-and-reply exchange, and a message sent over the resulting
  channel arrives.
- On chat.html: one peer asks about something ungrounded and gets an honest miss; another peer
  teaches the fact; the first peer asks again and gets a grounded answer whose citation names the
  peer who taught it, with the matching "taught" chip.
- On mud.html: two peers each claim a different character, meet in the same room, and can talk to
  each other's character through the ordinary `talk` verb, getting back that character's own
  knowledge.
- Three peers connect in a chain — the third only ever manually exchanges links with the second —
  and end up directly connected to all three, with a fact taught after the chain completes reaching
  everyone.
- One peer disconnects; the remaining two keep converging on new facts between themselves; a fresh
  browser context (storage cleared, standing in for a new device) asks the same ungrounded question
  and gets an honest miss again, then rejoins the room using a fresh link from one of the two who
  stayed, and recovers the grounded answer along with its provenance.

## Phasing

1. Backend D itself: the DynamoDB-backed store implementing the same individual read/write shape
   Backend A/B/C already share, `server:<name>`/`server:<handle>@<name>` value parsing in
   `enumFlag`/`openMemoryBackend`, unit tested against a local DynamoDB-compatible test double
   (e.g. `amazon/dynamodb-local` in Docker for CI). This is the one backend that needs
   network-call mocking in tests, unlike `node:sqlite` which needed none.
2. Tier 1: provision the real guest table + Identity Pool + TTL attribute + throughput cap by hand
   once (documented as an ops runbook, not automated — a one-time setup, not something every install
   repeats), ship its public config in the published package, verify the full anonymous round trip
   AND that TTL'd items actually age out.
3. The CI seeding job: an OIDC-federated CI role, upserting `init:large`'s (or a chosen larger tier's)
   corpus into the guest table with no `expiresAt` attribute, re-run on release/corpus changes.
4. Tier 2: `tmct server create <name>` (table creation + `tmct.toml` write-back) — no Identity Center
   dependency for this half, usable standalone the moment Backend D exists.
5. Handles: the `@<handle>` value-parsing extension, the `handle:` provenance kind and its
   per-handle Source (`sourceIdFor`), the `renderFactLine` prefix branch, and the new "what did
   `<handle>` tell you" query lane — layered on top of both tiers once they exist, since handles are
   orthogonal to which table/tier is in use.
6. An ops runbook for enabling IAM Identity Center + Permission Sets on a self-hoster's own account —
   documentation, not tmct code, since Identity Center administration is intentionally outside this
   design's own surface.
7. The `PLAN_OUDEZIJD.md`-specific extensions named above (the write-time durable-content rule,
   the place/timeSlot GSI, the `supersedes` attribute) — layered on top of Backend D once it exists,
   built only when `PLAN_OUDEZIJD.md` itself is actually picked up, not before. Nothing above
   blocks phases 1-6; this phase exists so the extension is scoped and named rather than improvised
   later.

## Non-goals

- No Lambda-as-SSH-server, no raw TCP listener anywhere in this design — explicitly ruled out this
  session (Lambda has no mechanism to accept an inbound SSH/TCP connection directly).
- No SSH at all. The pivot from round 1→3 (Origin, above) is complete: nobody logs into a shared host;
  every user runs tmct on their own machine against a remote backend.
- No Cognito social-login federation, no per-server Cognito Groups, no custom local-browser OAuth
  callback flow — Tier 3's entire mechanism, dropped in round 5 in favor of self-hosting + IAM
  Identity Center, which needs none of it.
- No new `SOURCE_PRIOR` trust tier for anonymous writes — resolved via DynamoDB-native per-item TTL
  instead (Tier 1, above), not a trust-scoring question.
- Horizontal multi-writer scale-out beyond DynamoDB's own native handling — DynamoDB already handles
  concurrent writers correctly (unlike the original sqlite-on-shared-storage design, which needed an
  explicit single-writer deployment strategy to avoid corruption); this document doesn't need an
  equivalent "avoid two writers" section because the storage engine itself removes that problem.
- Handle *verification* on Tier 1 (the anonymous guest server) — a guest-tier handle is a self-chosen
  display label, not an identity claim tmct verifies in any way; only Tier 2's Identity-Center-gated
  handles correspond to a real, administered account.
- Row-level (per-item) access control. Considered and rejected while exercising this design against
  `PLAN_OUDEZIJD.md` (above): Tier 2's table-scoped Permission Set already lets any authenticated
  player write any item on a shared server, which is what that plan's cross-player write-back needs
  anyway. A finer-grained ACL would be new machinery this design doesn't otherwise require.
- Any change to tmct's own product-path architecture — still fully deterministic, no LLM, no new
  attack surface inside `chat.mjs`/`runTurn` itself. This document is entirely about which storage
  backend a chat session's facts land in, who it says wrote them, and how a client authenticates to
  reach it — not about changing what tmct does once connected.
