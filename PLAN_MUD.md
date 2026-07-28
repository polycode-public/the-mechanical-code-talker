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
to that question — the same relationship `PLAN_ADVENTURE.md`'s single-player groundwork had to
this document's own multi-user shift (see "Still named `PLAN_MUD.md`," above).

Linked from the home page like the other nine demonstrations (`public/index.html`'s existing
two-block-per-demo shape: a compact claim card in `<section class="claims">` — icon, `<h3>`
headline, one-line description, `<span class="claim-page">` — plus a fuller feature section with
an `<a class="open-link">` and a `<figure class="plate">` screenshot; bump the "nine
demonstrations" eyebrow to "ten"). Capability claim: **"Multiple actors, one shared world."**
`gen-screenshots.mjs`'s `PAGE_ORDER` array and per-page ready-wait function need a `"mud"` entry;
`screenshots/manifest.json` follows automatically once that runs.

### Layout — a soil cross-section, not a flat grid

Every existing demo page picks one visual register and commits to it: spider-fly's flat top-down
canvas grid, adventure's text-first room digest, plan's step-by-step block replay. `mud.html`'s
own register is a **layered soil cross-section** — four burrow-window cards in a 2×2 grid, with
one large world map drawn as stacked strata bands (level 0 at the top down to level -4) that
physically overlaps the seam between all four windows. The map gets in the way a little on
purpose: it's the one visual reminder that all four "separate" windows are really one shared,
physical world underneath them.

**Palette** — named for the subject, not a template default (not cream+terracotta, not
near-black+acid-green): `--soil-deep #2B1D14` (level −4, background), `--soil-mid #4A3324`,
`--soil-light #7A5A3D` (upper strata), `--root-moss #6B7A4F` (level 0's garden surface),
`--parchment #EFE6D8` (window/card background — dug clay, not white), `--ink #2A211A` (text, warm
near-black), `--burrow-glow #E8A33D` (the one warm accent — active windows, the currently-selected
turn, a freshly-dug room's flourish — spent in one place, not scattered).

**Type** — a characterful, slightly hand-cut display face for headings and room names (something
in Fraunces' register — an ink-trap serif with real personality, used with restraint), a plain
sans body face for descriptive text (IBM Plex Sans or Inter), and a monospace utility face for the
dense simulation readouts — turn counters, coordinates, mass/pouch stats (IBM Plex Mono) — so the
page's two registers (storybook burrow, live simulation telemetry) read as deliberately distinct
rather than accidentally inconsistent.

**Wireframe**:

```
+---------------------+---------------------+
|  window NW           |          window NE  |
|  (room · pouch ·     |    (room · pouch ·  |
|   chat+pills · ctrl) |     chat+pills ·    |
|            +---------+----------+  ctrl)   |
|            |    WORLD MAP        |         |
|            |  (all 5 strata,     |         |
|            |   all 4 characters, |         |
|            |   no fog of war)    |         |
|            +---------+----------+          |
|  window SW           |          window SE  |
+---------------------+---------------------+
   [auto] [turns: N] [delay ▬▬○▬▬] [max turns ▬▬▬○▬] [reset]   <- global rail
```

**Signature element**: a dug room visibly opens into its strata band the turn it's created — a
short, `prefers-reduced-motion`-respecting dirt-particle flourish in `--burrow-glow` — the one bold
move on the page, everything else (the four windows, the rail) stays quiet and disciplined around
it.

### Per-window UI (×4)

- **Character**: one randomly selected burrowing-animal sprite, spawned at a random map location.
- **Room view**: a burrow-graphic rendering of the current room, built over `adventure.mjs`'s
  existing `worldDigest`/`worldDigestRows` text digest (`adventure.mjs:598,500`) the same way
  spider-fly-viz.mjs layers absolutely-positioned sprite `<div>`s over a `<canvas>` board — the
  digest stays the ground truth, the graphic is a rendering of it, not a replacement. **When two
  characters share a room and one speaks** (the turn algorithm's ask/answer step, below) — **a
  speech bubble renders over the room view**, anchored to the speaking character's sprite, holding
  the short form of what was said (the full exchange still lands in that window's chat log). This
  applies to any window whose room happens to hold the conversation, not just the two participants'
  own windows — a bystander character's window shows the bubble too, since they're looking at the
  same shared room. A short, `prefers-reduced-motion`-respecting fade, matching the dug-room
  flourish's own restraint — not a second competing animation.
- **Pouch** (this demo's name for the inventory — a satchel doesn't fit a burrowing animal).
- **Chat, with pills**: reuse `plan-viz.mjs`'s existing `.chatlog`/`.chatask`/`.chatpills` block
  close to verbatim — it already ships a scrolling log, a text input, and quick-fill pill buttons
  (`data-fill="..."`), which is exactly the "chat with last messages and pills" the brief asks for.
- **Movement**: `go <direction>` including `up`/`down` — **zero new grammar work**, `ace.mjs`'s
  `IMPERATIVE_DIRECTIONS` (`ace.mjs:529`) already includes `up`/`down`, and `EXIT_PREDICATE_RE`
  (`adventure.mjs:186`) already treats direction as a generic capture group, not a hardcoded
  cardinal list. Multi-level movement needs new world *content* (exit facts wiring levels
  together), not new parsing.
- **`dig <direction>`** where no exit currently exists: creates a new room. This is genuinely new
  interpreter code, not a taught-action-family extension — `IMPERATIVE_VERBS`
  (`ace.mjs:528`) is a hard closed set with no `dig`/`eat`/`put` today, and every existing taught
  action (Ashcombe's `RULE_KIND_ACTION_SIGNATURE`/`PRECOND`/`EFFECT`/`CONSTRAINT`) only ever states
  facts about *existing* individuals — none of them mint a brand-new one. Digging mints a new room
  individual, writes its exit facts, and spawns a random number of objects inside it. Say this
  plainly rather than undersell it as "just another verb."
- **Per-window play/pause/step, and a per-player turn counter**: reuse `viz-ticker.mjs`'s
  `createTicker` — already extracted, already shared between spider-fly-viz.mjs and the
  guess-number demo — one ticker instance per window.
- **Mini-map** (top-right): the player's own level only, showing only what that character has
  personally discovered — real fog of war. No existing precedent for this (neither adventure nor
  spider-fly ships a minimap); new rendering work.

### Global controls (the rail)

- **Auto**: switches all four windows to play at once. Default on page load: only the top-left
  window is in play mode, the other three start paused.
- **Turn counter**: increments whenever *any* window's character takes a turn (not four separate
  counters — this one is global, on top of each window's own per-player count).
- **Delay slider**: the wait between turns in play mode. `plan-viz.mjs`'s existing play mode uses a
  fixed-pace `wait(ms) => new Promise(r => setTimeout(r, ms))` helper — the slider is new, feeding
  that same helper a variable value instead of a constant.
- **Max-turns slider**: a hard cap on the simulation length.
- **Reset**.
- **A short explanatory note**: plain prose describing what's actually happening on the page (four
  independent characters, a shared world, honest not-yet-known gaps rather than omniscience) — not
  sales copy, an orientation for a first-time visitor.

### World / map model

- **Level 0 is the garden** — pre-authored, all-surface, can only be dug *down* from (never up;
  the surface is the ceiling). Predators live here, drawing on spider-fly's ecology-pass ordering
  (`runEcologyPass`, `spider-fly.mjs:388` — catch → eat → starve → lay → hatch → spawn) as the
  precedent for a threat sequence, though a predator's own decision rules are a smaller, separate
  detail this document names rather than fully specifies here.
- **Levels −1 through −4**: reached only by digging down from a room that has one.
- **The central world map is the operator's omniscient view** — every level, every character, no
  fog of war. This is deliberately the one place fog-of-war doesn't apply; each window's own
  mini-map is where it does.

### Creature stats

Per-species mass and hunger-drain rate, directly generalizing `game-config.mjs`'s already
per-species constants (`spiderMassDecrementPerTurn`, `flyMassDecrementPerTurn`,
`game-config.mjs:16-29`) — one new constant table entry per burrowing-animal species, not a new
mechanism. Larger species move and dig more than one position per turn — a new per-species
speed/dig-reach stat with no existing precedent (spider-fly's agents always move exactly one cell).

### The turn algorithm

Every acting character's turn, in order:

1. **Investigate the room** (always, every turn):
   1. Ask another character present (or reachable) what food they know about.
   2. Answer, if asked.
   3. Learn: whatever the answer was becomes a new fact in the asking character's *own* memory,
      with real provenance — this is new. Spider-fly's own told-fact mechanism
      (`spider-fly-turn.mjs:401-429`) is an ephemeral single-tick JS object today, discarded after
      the turn it arrives on, and there is no agent-to-agent ask/tell anywhere in the codebase —
      only a human addressing one agent via chat. `mud.html` needs a genuinely durable version of
      the same idea: a real fact write, not a one-tick parameter.
   4. If an unexamined object or food item is present, examine it and remember the detail — also a
      new durable, provenanced fact. `personKnowledgeLines`/`personRoomReport`
      (`adventure.mjs:672,690`) are the closest existing precedent, but they read *static,
      pre-authored* `mgx:knows-*` facts about NPCs, not facts a character accumulates dynamically
      while playing — this needs new per-character fact-accumulation, not a reuse of that path
      as-is.
   5. Randomly do one of: take an object, put an object, eat an object (if it's food and the
      character is below 50% mass) — reuses spider-fly's real mass economy directly: eating
      transfers the eaten item's remaining mass, the same way the ecology pass's catch→eat step
      already works.
   6. Update memory with whatever changed.
2. **Walk toward the nearest unexplored edge**, via a room-graph pathfinder built on
   `planning.mjs`'s `findActionPath`/`findReachableSet` (`planning.mjs:30,63`) — domain-agnostic
   BFS, exactly the layer `domain.mjs`'s generic taught-action interpreter already sits on for the
   Hanoi/river-crossing chat lane, **not** `src/domain/codeplan/` (that planner is real but
   code-graph-specific; forcing an animal's position into its entities/edges shape would be a
   stretch). The goal: reach a room containing a food fact this character actually knows about.
   Because `domain.mjs` is not omniscient by construction — every fact/action it can see comes
   from the memory store's own rows — a character with no food fact yet simply has nothing to path
   toward, and `findActionPath` returns its honest `null`. That miss *is* "I don't know where any
   food is," not a bug to patch around.
3. **If this turn's walk reaches an edge**, independently roll a chance for *each* of the
   following (not a single pick-one-of-three — a separate roll per option, per the brief's own
   "1 chance per exit"/"1 chance per available direction"/"1 chance per edge direction"):
   - each available exit toward food,
   - each available dig direction (including down) — digging spends the whole turn, no movement,
     and spawns a random number of objects in the new room,
   - each edge direction, to just keep following the edge toward food.

### A new NLP lane: listing what a character knows

"What food do you know about" (and similar simple-English phrasings) needs a new reverse query:
every food-class individual *this specific character* has a fact about — not the whole world's
food. `objectClassChain` (`adventure.mjs:580`) already walks `rdf:type`/`rdfs:subClassOf` edges to
check whether one object *is* food; listing every food a character knows about is a new, small
query in the other direction, following the render conventions `personKnowledgeLines` already
uses.

### Sprites and the nature corpus — real new content, not a stretch

- **Sprites**: `data/sprites/*.toml` (icon tier) and `data/sprites-large/*.toml` (large tier) are
  hand-authored SVG-in-TOML, keyed by a `classes` field — `rabbit` and `mouse` already exist as
  real precedent; mole, vole, badger, groundhog, and meerkat don't. Adding one is authoring a new
  `.toml` file with an inline SVG body — no script changes, `sprite-facts.mjs`/`gen-sprite-facts.mjs`
  auto-derive the rendering-metadata facts from any new `classes` entry. This only grounds facts
  *about the icon* (what renders at what tier) — not real-world facts about the animal, which is
  the corpus's job, below.
- **Nature corpus**: `corpus/tier2/human.jsonl`/`human-large.jsonl`, fed by the already-defined
  `"human-nature"` persona clump (`persona/codegen.mjs`), already has real precedent — `rabbit IsA
  animal`, `badger IsA musteline mammal`, and a real `food` class with members like `bread`,
  `vegetable`, `egg`. It does **not** have `carrot`, or any of mole/vole/groundhog/meerkat — this
  confirms the brief's own instinct that it needs real new content, not just sprites, but there's a
  clean, already-tested way to add it: either hand-extend `human.jsonl`/`human-large.jsonl` in the
  same `{start, rel, end, weight, surfaceText}` row shape the existing rabbit/badger/food rows use,
  or grow `corpus/conceptnet/filter-dump.mjs`'s `SEED_TERMS`/`EXTRA_SEEDS` list the same documented
  way the tech domain was already grown once (`corpus/conceptnet/README.md`'s "Growing the slice").
  Also more food spawning in the garden (level 0) generally — a content-tuning request, not new
  mechanism.

### Multiplayer threading

`adventure.mjs`'s command-execution path hardcodes the literal string `"player"` in roughly 15
call sites (`adventureTurn` and its precondition/effect/position/inventory helpers) — but the
underlying state-reading primitives it calls (`currentPosition`, `visibleRoomOf`,
`roomAffordances`, `objectClassChain`) already take an arbitrary subject individual, not
`"player"` specifically. The real gap is threading an acting-subject parameter through those ~15
call sites so four characters can each issue commands against the same shared world — a moderate,
scoped refactor, not a rewrite. `runNpcPass` (`adventure.mjs:402`) is the closest existing
precedent for driving several characters per tick, but only its *shape* (walk N individuals, read
each one's own state, fire an action) is reusable — its actual decision logic (one deterministic,
turn-gated taught Rule per NPC) is far simpler than this turn algorithm's ask/answer/learn/
examine/take-or-put-or-eat/edge-walk-or-dig tree, so the decision function itself is new code, not
a reuse.

**No shared "agent loop" abstraction across spider-fly/adventure/plan/mud.** `PLAN_ADVENTURE.md`'s
own Phase 5 already considered and explicitly closed this as not warranted — every existing demo
composes the same underlying primitives (`findActionPath`, `domain.mjs`, `viz-ticker.mjs`) without
a common wrapper, and `mud.html` follows that same precedent rather than inventing one.

**Phasing for this demo** (independent of Backend D's phases 1-7, above — none of the following
touches a network):

1. World-model extension: multi-level exit facts (level 0 down to −4), the `dig`/`eat`/`put`
   interpreter work (new room-minting code, new closed-set verbs), and the acting-subject threading
   through `adventureTurn` for four simultaneous characters.
2. Durable per-character learned facts and a real agent-to-agent ask/tell mechanism — extending
   spider-fly's ephemeral told-fact into a genuine provenanced write; this piece doesn't exist
   anywhere today and is the least precedented part of the whole demo.
3. The food-seeking planner: a new room-graph operator catalogue over `planning.mjs`'s
   `findActionPath`, honest-miss-by-construction via `domain.mjs`'s not-omniscient property.
4. The new "what food do you know about" NLP query lane.
5. Sprites (new burrowing-animal `.toml` files) and nature-corpus content (new
   `human.jsonl`/`human-large.jsonl` rows or a grown ConceptNet seed slice).
6. The page itself: the 2×2 grid + soil-cross-section map (the design plan above), per-window
   controls (`viz-ticker.mjs` + `plan-viz.mjs`'s chat/pills UI), the global rail, and the new
   per-window mini-map.
7. Home-page and screenshot wiring: `index.html`'s tenth claim card + feature section,
   `gen-screenshots.mjs`'s `PAGE_ORDER` entry.

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
