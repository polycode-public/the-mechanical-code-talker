# PLAN_MUD.md — persistent, shared tmct worlds over a `server:` memory backend

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-12 session, evolved across four rounds of the operator's own framing (kept verbatim, in
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
   private server?" — the confirmed, current design this document now describes.

Still named `PLAN_MUD.md`: a persistent, shared world-state multiple users mutate together is still
the governing shape (`PLAN_ADVENTURE.md`'s single-player groundwork is a different axis — grammar,
not multi-user persistence). What changed across the four rounds is entirely *how a client reaches
that shared state* — SSH-into-a-shared-host, then Lambda-as-SSH-server (rejected, Lambda has no raw
TCP listener), then a remote storage backend reached directly over AWS's own SDK, no custom server at
all. The last one is what ships.

## Confirmed baseline (tmct's own code, verified this session)

- tmct now has a real, working multi-backend memory seam, landed this same session
  (`src/memory/core.mjs`): **Backend A** (the flat OWL-labelled JSON file, the default, unchanged),
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
  (`["default","memory","sqlite"]`). `server:<name>` isn't a member of a closed set — it's a
  parameterized value, the same *shape* (not reusing the same function) as this codebase's own
  well-established `scheme:value` provenance-tag convention (`corpus:`, `corpus-weak:`, `web:`,
  `ace:chat:`, `extracted:` — all parsed by prefix in `src/memory/core.mjs`'s
  `provenanceTagToSource`). The validator needs a second branch: accept the closed set OR a value
  matching `/^server:[a-z0-9-]{1,64}$/` (name-length-bounded, since it becomes part of a real AWS
  resource name below). `openMemoryBackend` gets a matching new branch dispatching to this document's
  new Backend D module.

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
future `/memory`-style listing query "every Fact" without a full table scan.

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
  identities — see AWS's own guidance on this exact pattern) — leaking it changes nothing, since the
  attached IAM role is the real, narrow security boundary, precisely mirroring how the original SSH
  design's shared key was safe because `ForceCommand` (not the key) was the boundary.
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

## Tier 2 — self-service private table creation

The operator's ask: "trivially extensible to create a new table." A new CLI command,
`tmct server create <name>`, using the OPERATOR-RUNNING-THE-COMMAND'S OWN real AWS credentials
(standard AWS SDK credential resolution — `~/.aws/credentials`, env vars, an assumed role, whatever
they already have configured; nothing new to build for this half) to:

1. Call `CreateTable` directly for `tmct-server-<name>` (on-demand billing mode, so no capacity
   planning) — one SDK call, no CloudFormation/CDK stack required for the basic case.
2. Write `[memory] backend = "server:<name>"` (and the resolved region) into the local `tmct.toml` —
   reusing the EXACT "a CLI action writes into tmct.toml so a later flagless command picks it up"
   mechanism `--with-persona`/`--memory-backend` already established this session, not a new pattern.

This alone (no Cognito, no auth) gives a self-hoster a private, no-anonymous-access world: only
someone with the creator's own AWS credentials (or credentials the creator explicitly grants IAM
access to, via ordinary AWS IAM — nothing tmct-specific) can reach it. That's a real, useful, MUCH
simpler middle tier between "fully public guest world" and Tier 3's social-login-gated sharing below —
worth shipping and using on its own before Tier 3 exists.

## Tier 3 — private, named-account servers with social login

The operator's ask: "a specific set of cognito accounts that can access it and these people would
somehow auth via their socials to access a shared private server." This is the largest, most involved
piece — real, well-precedented AWS mechanisms, but genuine implementation work, not a config toggle.

**AWS shape**: ONE shared Cognito **User Pool** (not one per private server — a User Pool has real
per-pool setup overhead; reusing one across every private server this design ever creates is the
standard AWS pattern for "many resources, one identity provider"), federated with social identity
providers (Google, Facebook, Sign in with Apple, etc. — Cognito supports this natively via Hosted UI
or direct OIDC/OAuth federation, no custom auth code). Access control per private server uses Cognito
**Groups**: `tmct server create <name> --private` creates a Cognito Group named to match the table
(`server-<name>`), and the Identity Pool's role-mapping (Cognito's "choose role from token" feature,
keyed on group membership) grants the IAM role scoped to `tmct-server-<name>` ONLY to users in that
group — a standard, documented AWS access-control shape, not a novel mechanism.

**Granting access**: `tmct server invite <name> <email>` (a thin wrapper over Cognito's
`AdminAddUserToGroup` — the inviter needs Cognito admin rights over the shared User Pool, which is a
smaller, more targeted permission than the raw DynamoDB access Tier 2 already assumes the creator
has). The invited person still authenticates via their own social identity — the operator never
handles or stores a password or a social platform credential directly; Cognito's federation does that
handshake.

**Client-side login flow** — the genuinely new implementation work, well-precedented but not trivial:
a local, browser-based OAuth flow the same shape as `gh auth login`/`aws sso login`/`gcloud auth
login` already use — the CLI opens a temporary local HTTP listener on an ephemeral port, opens the
user's default browser to Cognito's Hosted UI URL (which itself federates out to whichever social
provider the user picks), captures the returned authorization code on the local callback when the
browser redirects back, exchanges it server-side (still local — "server-side" here just means "not
in the browser") for Cognito tokens, then calls the SAME `GetCredentialsForIdentity` Cognito flow
Tier 1 uses (now with an authenticated identity, not the guest one) to get temporary, group-scoped AWS
credentials. Cache the refresh token locally (e.g. alongside `tmct.toml`, gitignored) so this is a
one-time login per machine, not a login-every-session experience, with silent refresh on subsequent
connects.

## Phasing

1. Backend D itself: the DynamoDB-backed store implementing the same individual read/write shape
   Backend A/B/C already share, `server:<name>` value parsing in `enumFlag`/`openMemoryBackend`, unit
   tested against a local DynamoDB-compatible test double (e.g. `amazon/dynamodb-local` in Docker for
   CI, matching how `node:sqlite` needed no such double since it's fully local — this is the one
   backend that genuinely needs network-call mocking in tests).
2. Tier 1: provision the real guest table + Identity Pool by hand once (documented as an ops runbook,
   not automated — it's a one-time setup, not something every install repeats), ship its public config
   in the published package, verify the full anonymous round trip (`npx ... chat --memory-backend
   server:guest`, teach a fact, confirm it's readable from a second independent process).
3. Tier 2: `tmct server create <name>` — table creation + `tmct.toml` write-back. No Cognito yet;
   this tier is deliberately usable and shippable before Tier 3 exists.
4. The anonymous-write trust-tier question (below) resolved before Tier 1's guest server is ever
   publicly announced — same open item the original SSH design carried, unchanged by the redesign.
5. Tier 3: the shared Cognito User Pool + social IdP federation setup (ops runbook, one-time), the
   Group-per-private-server + role-mapping mechanism, `tmct server invite`, and the local
   browser-based OAuth login flow — the largest single phase, sequenced last since Tiers 1-2 are
   independently useful without it.

## Open design question — does anonymous write access need its own trust tier?

Unchanged from the original design, still unresolved, still load-bearing: every connecting guest-tier
user can `teach` the shared graph new facts. This session's `corpusWeak`/`extracted` trust tiers
(`memory/trust.mjs` `SOURCE_PRIOR`) grade CURATED or MECHANICALLY-EXTRACTED data — an anonymous guest
teach is genuinely unreviewed and adversarial-by-default (anyone can call `server:guest` with no
credential of their own beyond the public Identity Pool ID). Two options, not decided here:
1. A new `anonGuest` `SOURCE_PRIOR` tier, trusted below `web` — the facts land in the shared graph
   (matching "the world remembers what visitors taught it") but rank low enough to never crowd out
   corpus/operator facts in an answer.
2. Keep guest-tier teaches SESSION-SCOPED ONLY (read the shared graph, but a guest's own `remember X`
   writes stay in a local ephemeral overlay, never actually reaching the DynamoDB table) — the guest
   world is read-only to anonymous visitors; only Tier 2/3's identified servers accept real writes.
Tier 2/3 servers (a self-hoster's own table, or an invited/authenticated user) don't need this
question resolved the same way — an operator's own table, or an invited named account, is a
meaningfully different trust situation than a fully anonymous guest identity, and could reasonably
default to full trust (`operator`/`teach`-tier) instead. Flagging both halves as real decisions, not
defaulting either way here.

## Non-goals

- No Lambda-as-SSH-server, no raw TCP listener anywhere in this design — explicitly ruled out this
  session (Lambda has no mechanism to accept an inbound SSH/TCP connection directly).
- No SSH at all. The pivot from round 1→3 (Origin, above) is complete: nobody logs into a shared host;
  every user runs tmct on their own machine against a remote backend.
- Horizontal multi-writer scale-out beyond DynamoDB's own native handling — DynamoDB already handles
  concurrent writers correctly (unlike the original sqlite-on-shared-storage design, which needed an
  explicit single-writer deployment strategy to avoid corruption); this document doesn't need an
  equivalent "avoid two writers" section because the storage engine itself removes that problem.
- A from-scratch identity system. Tier 3 is entirely built from Cognito's own existing federation and
  group-role-mapping features — no custom account/password/session system anywhere in this design.
- Any change to tmct's own product-path architecture — still fully deterministic, no LLM, no new
  attack surface inside `chat.mjs`/`runTurn` itself. This document is entirely about which storage
  backend a chat session's facts land in and how a client authenticates to reach it, not about
  changing what tmct does once connected.
