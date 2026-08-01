# PLAN_MUD_SERVER.md — Backend D: DynamoDB `server:` backends, tiers, and handles

Status: RESEARCH / DESIGN, not yet implemented. Split out of `PLAN_MUD.md` (2026-08-01), which
keeps the origin story (the six operator rounds this design distilled from) and the verified
code baseline (the Backend A/B/C memory seam, `enumFlag`, the trust machinery) this document
builds on — read that first.

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
- No SSH at all. The pivot from round 1→3 (PLAN_MUD.md's Origin) is complete: nobody logs into a shared host;
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
