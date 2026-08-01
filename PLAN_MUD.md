# PLAN_MUD.md — persistent, shared tmct worlds: origin, baseline, and the plan index

Status: an umbrella. Each major deliverable lives in its own document (the index below); this
file keeps the origin story and the verified code baseline they all build on, so the sibling
documents link back here rather than restating them.

## The plan documents

- **`PLAN_MUD_SERVER.md`** — Backend D: a DynamoDB table per named server reached directly over
  the AWS SDK, the anonymous guest tier, self-service Identity-Center-gated private servers,
  per-user handles, the phasing, and the non-goals. RESEARCH / DESIGN, not yet implemented.
- **`PLAN_MUD_DEMO.md`** — mud.html, the single-page burrow demo: proof of the shared
  multi-character world shape with no server anywhere. SHIPPED.
- **`PLAN_MUD_WEBRTC.md`** — multi-browser worlds over WebRTC: serverless share/join by
  copy-paste signaling, CRDT replication over the fact store. SHIPPED 2026-07-29 on mud.html
  and chat.html; the 3+-peer scenarios are still design.
- **`PLAN_MUD_MUDIII.md`** — MUDIII: a Three.js town square (wolf and goblins) over the
  spider-fly planning engine, with its coordinator/sub-agent delivery packaging. DESIGN; its
  scope completes with `mudiii.html` deployed alongside https://tmct.polycode.co.uk/mud.html.
- **`PLAN_MUD_MUDIII_SHARED.md`** — mud.html's share/join layer arriving on mudiii.html, a
  phase of its own after that page ships. DESIGN.
- **`PLAN_MUD_MUDMMORPG.md`** — MUDIII's published shared world: HLS-style snapshot/delta
  publishing over Backend D, the authoritative ticker, rewind. DESIGN ONLY, deliberately last.

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

## Confirmed baseline (tmct's own code, verified 2026-07-12)

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
  exact mechanism `PLAN_MUD_SERVER.md`'s `server:<name>` value plugs into as a fourth backend,
  "Backend D."
- **The closed-set validator needs one small, precise extension.** `enumFlag` (`src/services/cli-args.mjs:82`)
  currently validates `--memory-backend` against an exact-match closed list
  (`["default","memory","sqlite"]`). `server:<handle>@<name>` isn't a member of a closed set — it's a
  parameterized value, the same *shape* (not reusing the same function) as this codebase's own
  well-established `scheme:value` provenance-tag convention (`corpus:`, `corpus-weak:`, `web:`,
  `ace:chat:`, `extracted:` — all parsed by prefix in `src/adapters/memory/core.mjs`'s
  `provenanceTagToSource`). The validator needs a second branch: accept the closed set OR a value
  matching `/^server:([a-z0-9_-]{1,32})@([a-z0-9-]{1,64})$/` — group 1 the handle, group 2 the server
  name (name-length-bounded, since it becomes part of a real AWS resource name). A bare
  `server:<name>` with no `@handle` should stay valid too (see `PLAN_MUD_SERVER.md`'s Handles — a
  handle is optional, not required to reach a server). `openMemoryBackend` gets a matching new branch
  dispatching to `PLAN_MUD_SERVER.md`'s Backend D module.
- **Existing precedent for exactly this per-source trust/reliability tracking already exists** —
  `memory/trust.mjs`'s `sessionReliabilityFrom` (`trust.mjs:219`) and `mgx:sourceReliability`
  already implement "one Source accumulates a track record across multiple writes, nudging its own
  trust contribution up or down," currently keyed by SESSION id. A handle is the natural
  generalization:
  the SAME mechanism, keyed by a stable per-user identity instead of a throwaway session UUID, so a
  handle's reliability accumulates across every session that handle ever connects with.
  No new trust math is needed, just a new Source-identity shape feeding the existing one.
