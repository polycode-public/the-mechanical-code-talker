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
  `"default"` (`src/chat.mjs:9444`). A flag on `init` writes straight into `tmct.toml`
  (`src/init.mjs`), so a later flagless `tmct chat` in that repo picks it up automatically — the
  exact mechanism this document's `server:<name>` value plugs into as a fourth backend, "Backend D."
- **The closed-set validator needs one small, precise extension.** `enumFlag` (`src/cli-args.mjs:82`)
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
  handle's reliability genuinely accumulates across every session that handle ever connects with —
  no new trust math needed, just a new Source-identity shape feeding the existing one.

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

**Why Tier 3 is dropped, not deferred**: the repository is open source. Anyone wanting a genuinely
private, specific-people-only shared world can already clone it and stand up their own AWS resources
— which is exactly Tier 2's own model, just run by a different person for a different table. Tier 3's
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
`renderFactLine` (`src/chat.mjs`, the function this session's `corpusWeak`/`possibly:` hedge work
already extended once today) currently special-cases `ace:chat`/`teach:chat` provenance into "you told
me: ...". Needs a new branch, checked before that one: if the provenance is `handle:<handle>@...`,
render `${handle} told me: ...` instead. On a single-user local session "you told me" is unambiguous;
on a shared multi-handle server it isn't — always naming the actual handle (even the CURRENTLY
connected one re-reading their own fact back) removes that ambiguity rather than switching between
"you" and a name depending on who's asking. Citations stay VERBATIM either way (the existing,
already-documented principle in `renderFactLine`'s own docblock) — the readable part is the sentence
prefix, not the `(source: ...)` tag, consistent with how every other provenance kind already works
here; no new citation-formatting logic needed, just a new prefix branch.

**New query shape: "what did `<handle>` tell you"** — a reverse-by-SOURCE lookup, a genuinely new lane
in `chat.mjs`'s routing (nothing today filters facts by WHO stated them, only by subject term). Design:
resolve `<handle>` to its Source id (`src:teach:handle:<handle>`), find every Fact `mgx:statedBy`-
linked to that Source (the SAME edge group `recomputeFactTrust`/`statedByObjectsFor` already read for
trust computation, `core.mjs:915-931` — this query is that same lookup run in the opposite direction:
"which Facts point at this Source" rather than "which Sources does this Fact point at"), then render
the result the same way the existing `/memory`-style "N remembered facts about X" per-subject listing
already does, just keyed by handle instead of subject term — reusing an existing render template, not
inventing a new one.

## Phasing

1. Backend D itself: the DynamoDB-backed store implementing the same individual read/write shape
   Backend A/B/C already share, `server:<name>`/`server:<handle>@<name>` value parsing in
   `enumFlag`/`openMemoryBackend`, unit tested against a local DynamoDB-compatible test double (e.g.
   `amazon/dynamodb-local` in Docker for CI — this is the one backend that genuinely needs
   network-call mocking in tests, unlike `node:sqlite` which needed none).
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
- Any change to tmct's own product-path architecture — still fully deterministic, no LLM, no new
  attack surface inside `chat.mjs`/`runTurn` itself. This document is entirely about which storage
  backend a chat session's facts land in, who it says wrote them, and how a client authenticates to
  reach it — not about changing what tmct does once connected.
