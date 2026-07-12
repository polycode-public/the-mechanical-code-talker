# PLAN_MUD.md — a persistent, shared, anonymous-SSH tmct instance on Fargate

Status: RESEARCH / DESIGN — not yet implemented. Nothing in this document is live code.

## Origin

2026-07-12 session. The operator's own framing, verbatim: "How can I expose an ssh server that
people can ssh into anonymously run just the `npx ... chat` command and nothing else so the ssh
session quits if the program quits and the logged in user only has execute permissions for that node
command and that node command runs a shared sqlite graph on fargate instance and it periodically
writes and export to s3, and reads the latest export on task re-load so that real users could
interact with a persistent agent in a sandbox safe enough to have trivial ssh credentials?"

Named `PLAN_MUD.md` (not `PLAN_DEPLOY.md`) deliberately: a single persistent world-state every
connecting user shares and mutates is the same shape as a classic multi-user dungeon (MUD) —
`PLAN_ADVENTURE.md`'s single-player text-adventure stretch already built imperative-command
groundwork; this document is the multi-user, persistent-world deployment question, a different axis
entirely (infrastructure, not grammar).

This pattern — anonymous SSH into a locked-down forced command — is proven and public: `ssh
sshtron.zachlatta.com`, `ssh mapscii.me`, `telehack.com`'s SSH mode all run exactly this shape (a
shared or published key/no-real-auth, `ForceCommand` locking the session to one program, the SSH
session dying when that program exits). Nothing here is a novel security mechanism; it's assembling
well-understood pieces around tmct's own already-existing sqlite backend.

## Confirmed baseline (tmct's own code, verified this session)

- tmct already has a real sqlite backend: `src/memory/core.mjs:288-303` opens a resident
  `node:sqlite` `DatabaseSync` connection (lazily imported, Node's built-in sqlite — no native
  dependency to compile/ship), sets `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL`
  (`core.mjs:302-303`), and stores at `<repo>/.tmct/memory/graph.sqlite`
  (`src/chat.mjs:9426`).
- Selecting it today: `TMCT_MEMORY_BACKEND=sqlite` env var, or (landing today, same session — see
  `HANDOVER.md`) a new `--memory-backend sqlite` CLI flag on `tmct init`/`import`/`chat`, written
  into `tmct.toml`'s `[memory] backend` field so a plain flagless `tmct chat` afterward picks it up
  automatically. **This deployment should use `--memory-backend sqlite` at image-build/first-boot
  time** (bake it into the shipped `tmct.toml`, or pass the env var) rather than requiring every
  connecting user to type a flag they'll never see anyway (the forced command controls the exact
  invocation).
- **WAL mode's consequence for backup**: a live WAL-mode sqlite database is split across THREE files
  (`graph.sqlite`, `graph.sqlite-wal`, `graph.sqlite-shm`) while open. A plain `cp` of just the main
  file mid-session can capture an inconsistent, torn snapshot. Any export step MUST either (a) run
  `sqlite3 graph.sqlite ".backup /path/snapshot.sqlite"` (sqlite's own online backup API, safe against
  concurrent writers, single consistent output file) or (b) run `PRAGMA wal_checkpoint(TRUNCATE)`
  first to fold the WAL back into the main file, then copy just that one file. Prefer (a) — it's
  correct even if a checkpoint can't fully drain (an active reader can block a TRUNCATE checkpoint).

## Layer 1 — the SSH front door: forced command, no shell, session dies with the program

Standard OpenSSH (`sshd`), one dedicated unprivileged system account (e.g. `tmctguest`), locked down
in `sshd_config`:

```
Match User tmctguest
    ForceCommand /usr/local/bin/tmct-ssh-entry
    X11Forwarding no
    AllowTcpForwarding no
    AllowAgentForwarding no
    PermitTunnel no
    GatewayPorts no
    PermitTTY yes
```

`ForceCommand` overrides whatever command the connecting client actually requested — an anonymous
user typing `ssh -i shared_key tmctguest@host anything-they-want` always runs
`/usr/local/bin/tmct-ssh-entry` regardless. `PermitTTY yes` is kept (the chat UI is an interactive
terminal app, unlike the usual forced-command git-shell-style lockdown that disables PTY entirely).
Everything else that could turn the SSH connection into a general-purpose network tool
(port-forwarding, X11, agent-forwarding, tunnelling) is disabled — the operator only gets a terminal
talking to one program, nothing else.

`/usr/local/bin/tmct-ssh-entry` is a one-line wrapper that **execs, never forks**:

```sh
#!/bin/sh
exec node /opt/tmct/bin/tmct.mjs chat
```

`exec` replaces the wrapper's own process with the node process — there is no parent shell left
running once `chat` starts. When the chat program exits (the user types `/exit`, hits EOF/Ctrl-D, or
the process crashes), there is nothing left to return control to, so `sshd` closes the channel and
the SSH session ends on its own. This is the entire mechanism behind "the ssh session quits if the
program quits" — no extra supervision code needed, it falls out of `exec` semantics.

"The logged-in user only has execute permission for that node command": enforced at two independent
layers, so a bug in one doesn't undermine the other —
1. **SSH layer**: `ForceCommand` means no other command can ever run over this SSH connection, full
   stop, regardless of what filesystem permissions would otherwise allow.
2. **Filesystem layer** (defense in depth, in case Layer 1 is ever misconfigured or bypassed via a
   non-SSH path): `tmctguest` owns nothing on the container's filesystem. Its home directory doesn't
   exist or is empty and unwritable. `/opt/tmct` (the installed tmct package) is owned by `root`,
   world-readable+executable, not writable by `tmctguest`. The ONLY path `tmctguest` can write to is
   a narrow, explicitly-granted scratch location for its own session log
   (`.tmct/sessions/<session-id>.log`, tmct's own existing per-session log convention) if that's
   wanted at all — the shared `graph.sqlite` itself should be owned by a SEPARATE service account the
   `chat` process runs as via a `setuid`-style wrapper or a privilege-separated launcher, not directly
   writable by the raw `tmctguest` login identity, so a contained escape from the chat program still
   can't touch the database file directly, only through the program's own API.
3. Also set `tmctguest`'s real login shell to `/usr/sbin/nologin` in `/etc/passwd` — pure defense in
   depth for any non-SSH login path (there shouldn't be one, but cheap to close).

"Trivial ssh credentials" — a single shared keypair, publicly documented (e.g. "run `curl
.../shared_key -o key && chmod 600 key && ssh -i key tmctguest@host` to connect"), never rotated,
never treated as a secret. This is safe PRECISELY BECAUSE Layers 1-2 above bound what that credential
can do to "start exactly one already-locked-down program" — leaking it changes nothing, which is the
whole design goal. (A real per-user credential system, rate-limiting by identity, or ban lists are
explicitly NOT this document's scope — see Non-goals.)

## Layer 2 — the Fargate task: one writer, sqlite in WAL mode, container hardening

**Single task, not auto-scaled.** A shared sqlite graph is a single-file, single-host database — this
deployment wants an ECS Service with `desiredCount = 1`, not horizontal scaling. Concurrent SSH
sessions on the SAME task are fine (WAL mode allows concurrent readers with one writer, and
`node:sqlite`'s `DatabaseSync` serializes writes within the one Node process anyway since every
`chat` invocation on this host is a separate process opening the SAME db file — WAL's file-level
locking handles the cross-process coordination). Multiple TASKS each independently opening the same
local ephemeral file don't apply here since Fargate task storage isn't shared across tasks by
default — this design deliberately keeps it that way rather than reaching for EFS (sqlite-over-NFS
locking is fragile and explicitly discouraged upstream). If real multi-task horizontal scale is ever
needed, that's a backend swap (Postgres/DynamoDB), not a bigger version of this design — named as a
scaling escape hatch, not built here.

**Container hardening** (independent of the SSH-layer lockdown — defense against the chat program
itself being abused, not just against shell access):
- Read-only root filesystem, with exactly one writable, explicitly-mounted path for
  `.tmct/memory/graph.sqlite` (+ its `-wal`/`-shm` siblings) and session logs.
- `--cap-drop=ALL`, run the container as a non-root UID.
- No outbound network egress except to S3 (a VPC endpoint for S3 + a security group denying
  everything else outbound) — the chat program has no legitimate reason to reach anywhere else, and
  this closes off using a compromised session as a network pivot.
- A per-connection resource/session cap at the `sshd`/security-group level (max session duration, a
  connection-rate limit per source IP) so one abusive or runaway session can't monopolize the single
  writer or degrade the shared experience for everyone else.

**Networking**: SSH is raw TCP, not HTTP — use a Network Load Balancer (NLB), not an ALB, in front of
the Fargate service, forwarding port 22 (or a nonstandard port to dodge casual internet-wide port-22
scanning noise, e.g. 2222, cosmetic only — not a real security control on its own).

## Layer 3 — persistence: S3 export/import around ephemeral Fargate storage

**On task start, before `sshd` accepts connections**: fetch the latest snapshot from a well-known S3
key (`s3://<bucket>/tmct-graph/latest.sqlite`) to the local path `graph.sqlite` will live at. If the
key doesn't exist yet (first-ever boot), start with an empty/freshly-`tmct-init`'d graph. Only then
start `sshd` — a user should never be able to connect to a task that hasn't finished loading the
shared world state.

**Periodic export, while running**: a background loop in the same task (a small sidecar
process/thread, not a separate Fargate task — it needs to reach the SAME task's local ephemeral
filesystem, which isn't shared across tasks) that every N minutes: runs `sqlite3 graph.sqlite
".backup /tmp/snapshot.sqlite"` (the WAL-safe online backup, see Confirmed Baseline above), then `aws
s3 cp /tmp/snapshot.sqlite s3://<bucket>/tmct-graph/latest.sqlite`. A rolling few generations
(`latest.sqlite`, `latest-1.sqlite`, ...) rather than one single overwritten key gives a cheap
rollback path if a bad export or a vandalism incident (see Non-goals — anonymous write access to a
persistent shared graph) needs undoing.

**On graceful shutdown** (ECS sending `SIGTERM` before a deploy/scale-down, with a configured
`stopTimeout` grace window): trigger one FINAL export synchronously before the process actually
exits, so the periodic loop's interval doesn't become a window of guaranteed data loss on every
routine deploy. The periodic loop is the safety net for ungraceful crashes (which skip the `SIGTERM`
handler entirely); the shutdown export is the primary consistency mechanism for planned restarts.

**Deployment strategy — avoid a two-writer window.** ECS's default rolling deployment starts the NEW
task and waits for it healthy BEFORE stopping the OLD one — for a normal stateless service that's
correct, but here it creates a real risk: the new task boots, imports whatever was in S3 at THAT
moment (possibly stale relative to the old task's most recent, not-yet-exported writes), starts
accepting connections and taking new writes, and then the old task's own shutdown export could
overwrite the new task's fresher state with older data. Fix: set this specific service's deployment
configuration to `minimumHealthyPercent = 0, maximumPercent = 100` (stop-then-start, not
start-then-stop) — trading a brief connection-refused gap during every deploy for a guarantee that
only one task is ever alive (and thus ever writing) at a time. For a single shared toy-world state
store, that tradeoff is clearly correct; it would NOT be for a real production HA service, which is
exactly why this is named as a deliberate, scoped choice.

## Open design question — does anonymous write access need its own trust tier?

Not infrastructure, but load-bearing for what this deployment actually produces: every connecting
anonymous user can `teach` the shared graph new facts (tmct's existing teach lane, unrelated to this
document). Unlike this session's `corpusWeak`/`extracted` trust tiers (`memory/trust.mjs`
`SOURCE_PRIOR`, landed earlier today) — which grade CURATED or MECHANICALLY-EXTRACTED data — an
anonymous SSH teach is genuinely unreviewed, unauthenticated, and adversarial-by-default (anyone with
the published shared key can type anything). Two real options, not decided here:
1. Extend `SOURCE_PRIOR` with a new `anonSsh` tier, trusted below `web` — the facts land in the SHARED
   graph (so "the world remembers what visitors taught it" stays true, matching the MUD framing) but
   rank low enough that they never crowd out corpus/operator facts in an answer.
   2. Keep anonymous teaches SESSION-SCOPED ONLY (read from the shared graph, but a connecting user's
   own `remember X` writes stay in an ephemeral per-session overlay, discarded when they disconnect)
   — the shared world is read-only to visitors, only an operator-run maintenance path can grow it.
Option 1 is more in the spirit of "a persistent agent real users interact with" (a MUD's world
genuinely changes from player action); option 2 is safer against vandalism/prompt-injection-style
abuse of a public write surface. Flagging this as a real decision for whoever implements this, not
defaulting either way here.

## Phasing

1. sqlite backend + `--memory-backend sqlite` (landing today, separately from this document).
2. Container image: tmct + sshd + the `tmct-ssh-entry` wrapper + hardening (read-only rootfs,
   dropped caps, non-root UID), built and runnable locally first (`docker run` + `ssh -p 2222
   localhost`) before any AWS involvement — cheapest place to catch a `ForceCommand`/permission
   mistake.
3. S3 export/import scripts (`.backup`-based, tested for WAL-safety) + the SIGTERM shutdown hook,
   still local (a mounted local dir standing in for the S3 bucket) before wiring real AWS calls.
4. Fargate task definition + ECS service (`desiredCount=1`, `minimumHealthyPercent=0/maximumPercent=
   100`) + NLB, real S3 bucket, VPC egress locked to the S3 endpoint only.
5. Resolve the anonymous-write trust-tier question (above) before any real public announcement of the
   shared key — this is a product decision, not incidental plumbing, and should not default silently
   by omission.
6. A published, throwaway shared keypair + a short public instructions page.

## Non-goals

- Per-user identity, rate-limiting by identity, ban lists, or any real authentication — "trivial ssh
  credentials" is the explicit design goal, not a gap to close later.
- Horizontal scale-out of the shared graph across multiple concurrent Fargate tasks — named as a
  backend-swap escape hatch (Layer 2), not designed here.
- Any change to tmct's own product-path architecture (still fully deterministic, no LLM, no new
  attack surface inside `chat.mjs` itself) — this document is purely about how an existing, unchanged
  `tmct chat` gets exposed to anonymous network users safely, not about changing what it does.
