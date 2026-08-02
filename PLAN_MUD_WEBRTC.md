# PLAN_MUD_WEBRTC.md — multi-browser worlds over WebRTC

Status: SHIPPED 2026-07-29 on both mud.html and chat.html. Mesh introduction carries three or
more peers, and retraction now replicates across the mesh with a causal-stability rule behind a
gate. Split out of `PLAN_MUD.md` (2026-08-01); that document keeps the shared origin and baseline.

## Multi-browser worlds over WebRTC — shipped 2026-07-29

Two or more separate people, each in their own browser, share one live world over the network
with no server for game state at all: every browser holds a full copy of the world and stays in
sync by talking directly to the other browsers in the room. It's a different shape from Backend D
(PLAN_MUD_SERVER.md): Backend D routes reads and writes through a hosted DynamoDB table one client at a time.

**Networking**: no rendezvous service, not even a public one. Every connection is a direct WebRTC
offer/answer exchange between two browsers, and nothing else is involved. Starting a world generates
one UUID in the browser, on the spot — it never touches a server; it's the stable id a browser uses
to keep this world's triple store separate from any other one it's part of. The page also draws a
few words from its own taxonomy, the same lexicon that grounds every fact, to give the world a
human-readable name — a mnemonic for the players, not a credential. To invite someone, a live
member's page creates a fresh SDP offer and encodes it into a URL alongside the world id and name:
`mud.html?offer=<blob>&world=<uuid>&name=<generated-name>`. That link travels however the two people
already talk: pasted into a message, AirDropped, read out over the phone, whatever's at hand. Opening
it lands the joiner on a join card naming the world; one click generates the matching answer and
offers it straight back as its own copy action, so sending it home is the same motion as receiving
the invite was — paste the reply into the same thread. The inviter's page sits with a small "paste a reply to connect" box open, waiting; pasting
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
fact, so retraction needs one more piece. It took the summary route rather than the OR-Set one: a
retraction record per (triple, source) carrying the record ids it suppressed, merging by union of
those ids. `docs/references/papers/crdt.md` has the settled account, including why the OR-Set's
tombstone was the wrong price for a store whose provenance is a product feature.

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
networked `chat.html` — sharing one P2P/CRDT layer between them. Two discoveries changed how much
of it needs writing at all.

Built so far: the pure modules, the WebRTC transport, room orchestration, the shared
`public/vendor/p2p.js` asset, chat.html's whole integration (share, join, paste-reply, connection
state, the node list, live wire traffic and waving), and mud.html's own — share and join, character
claiming, the origin-node label, the wave button and its typed twin, and the sync filter wired to
`adventure.mjs`'s `isMudStatePredicate`. Mesh introduction carries the three-or-more-peer
scenarios: `p2p-room.mjs` sends the peer list and the intro-offer, and
`p2p-mesh-three-peers.test.mjs` and `pages-mud-p2p-mesh.test.mjs` cover them end to end.

Two things the mud integration settled that the design above left open. Claiming covers every animal
a page drives, npcs included, not only the ones with panes: two peers each running scripted turns for
one animal is the actual failure mode, and one claim per driven animal removes it without needing the
leader election v1 leaves out. And a room used to be bound to the store it was opened over, so
recasting the world dropped the link — **landed**: `p2p-room.mjs`'s `room.rebind({ memoryDir,
worldName, myDisplayName })` swaps the store under a live room, keeping peer connections open and
re-syncing them against the new world, and `adventure.mjs`'s `foldWorldState` is now epoch-aware
(ranks by `(epoch, turn)` rather than bare `turn`) so a stale pre-recast snapshot can never outrank a
fresh post-recast one for the same subject. World-state predicates (placements, exits, names) are
covered; `knows-about` testimony claims still rank by bare turn across epochs, tracked in `NEXT.md`.

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
`RTCPeerConnection` is created with `iceServers: []` today — no STUN, no TURN. That means signaling
only completes between peers that can already reach each other on host candidates alone (same
machine, same LAN, or a NAT that happens to allow it); real-browser cross-engine testing this session
found this depends on OS-level local-network/mDNS behavior that varies by machine, not just network
topology, and can fail for a real user even where the raw handshake works in an automated test. Open
to revisiting with a STUN server (server-reflexive candidates, still no relay/TURN, no data through a
third party — see NEXT.md). Candidate gathering runs to completion before the offer is read out (no
trickle needed without STUN), so the two-paste flow from the section above stays exactly as
described: one blob out, one blob back, done.

**Blob shape, and validation on paste.** Both blobs — the offer carried in the link and the reply
pasted back — are the same base64url JSON envelope: `{ v: 1, kind: "offer" | "answer", world,
worldName, sdp }`. Every paste target decodes and checks the envelope before touching WebRTC, and
each failure gets its own specific message rather than a generic one:

- decode or parse failure (the common case is a truncated copy): "that doesn't look like a
  complete reply — check the whole thing was copied, then paste it again";
- right envelope, wrong `kind` (an invite link pasted into the reply box): "that's an invite, not
  a reply — send it to the person you're inviting, or open it in a new tab to join their world";
- right kind, wrong `world`: "that reply is for '<their world name>' — this page is sharing
  '<this world name>'".

The pasted text stays in the box on every one of these, so the person can fix the copy instead of
starting over. A paste that validates clears the box and moves the connection on; the box is
never left holding a consumed blob. The link's own offer blob gets the same check on page load: a
`?offer=` that fails to decode shows "this invite looks cut short — ask for it to be sent again"
instead of quietly loading the ordinary page, so a mangled link reads as a mangled link, not as
no invite at all.

**One link admits one person.** An SDP offer belongs to one `RTCPeerConnection`, so a link can
complete exactly one connection. The share control mints a fresh offer every time it's used, and
the page says so beside it ("each link invites one person — share again for the next"). If two
people open the same link anyway, both can generate a reply, but only the first reply pasted
connects; the second arrives after the pending connection has left its offer state, and the page
says so plainly ("that reply matched an invite that's already been used — create a fresh link and
send that instead") rather than failing silently.

**Connection state is a small closed set, and the page always shows which one it's in.** Each
pending or live connection is in exactly one of: `sharing` (offer minted, link copied, reply box
open), `answering` (invite opened, reply generated, nothing left to do but send it), `connecting`
(reply consumed, ICE running), `connected` (DataChannel open), or `failed` (ICE gave up). Waiting
gets stated as what it is: before a reply is pasted nothing is in flight — there is no network
activity to time out on — so `sharing` and `answering` are open-ended by design and styled as calm
status ("waiting for their reply — this stays live as long as this tab is open"), with no error
styling. `connecting` is the opposite case: once both blobs are exchanged, ICE either opens the
channel or fails within seconds, so a failure there gets error styling and names what actually
happened in plain terms — "your two machines couldn't find a path to each other. a public STUN
server helps with most networks, but some firewalls or strict NATs still block it."

**The invite flow, as each person sees it.** The wire design above only works if nobody is ever
left guessing what to do next. Walked end to end:

1. Alice clicks "invite someone". The page copies a link to her clipboard and flips into
   `sharing`: it shows the link itself (in case the clipboard copy didn't take), one labeled box
   — "paste their reply here" — and the status line "waiting for a reply…". The reply box is the
   only paste target on her page, so there is no wrong box to choose.
2. Bob opens the link. He doesn't land in a live world; he lands on a join card — "you've been
   invited to '<world name>'" — with one button, "create my reply". Nothing runs until he clicks
   it, and the card says what clicking will do. The click generates the answer, copies it, and
   shows it in its own copyable box with the one instruction that matters: "send this back the
   same way the invite reached you." His page is now in `answering`, status "waiting for them to
   paste your reply…". Bob's page has no paste box at all — his half of the flow is copy and
   send, and removing the box removes the mistake.
3. Alice pastes the reply into her labeled box. It validates (above), the box clears, and both
   pages flip to `connected` within seconds — hers because the answer completed the connection,
   his because the DataChannel opened, which is the joiner's only signal and enough. Each page
   now shows the other's node name in its node list; that row appearing is the confirmation, the
   same signal on both sides.
4. Carol joins through Bob. Bob clicks the same "invite someone" control — inviting is something
   any live member can do, not a host privilege — and the same three steps repeat between Bob and
   Carol. The moment Carol's channel to Bob opens, mesh introduction (the
   `intro-offer`/`intro-answer` messages below) connects her to Alice with nothing more to paste;
   Carol sees Alice's row appear in her node list a beat after Bob's.

Both pages link to a shared help page from a small "?" in the page chrome; its content is
specified in `PLAN_HELP.md`, and its sharing section walks this same flow in end-user words.

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
a new query over facts that are already there. A peer whose channel has closed stays in the list,
marked away rather than removed: its facts and its name are still part of the graph, and
reconnecting is just a fresh invite.

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

**A remote character carries its node's name on its label.** The room view's sprite name labels
(the same style adventure.html uses) gain one addition when a world is shared: a character whose
latest `mgx:playedBy` fact names a peer other than the viewing page's own draws a second, smaller
line under its name — that peer's node name, read from its latest `mgx:nodeName` fact, dimmer and
about two-thirds the size, e.g. "badger-1" over "via mossy-acorn". A character your own node
plays, or one nobody has claimed, shows just its name, exactly as the single-browser demo draws
it. If the controlling peer's `mgx:nodeName` fact hasn't synced yet, the line shows the shortened
peer id until it does; the label doesn't wait for the name to arrive. This is an extension of the
local label, not a second label system: same font, same placement, one extra line that only
remote characters have.

**Waving.** The wave gesture (PLAN_MUD_DEMO.md's per-pane UI) is a fact, `(<characterId>, mgx:waved,
<roomId>)`, carrying the same per-turn provenance tag every other mud action already carries.
That's the whole networking story: an add-only fact replicates through `op` broadcast and
`appendFacts` exactly like a move does — no new CRDT primitive, no new message type. Every page
currently rendering that room, one browser today or several under this design, plays the same
brief hand-wave animation over the waver's sprite when the fact reaches it, the waver's own page
included, so everyone sees the same moment.

A wave has no lasting meaning once the moment passes, and v1 retracts nothing. The resolution:
"currently waving" is a read-time question, not a stored state. The renderer animates a wave fact
only while its provenance timestamp sits inside a short recent window (a few seconds); an older
wave simply stops rendering, with nothing deleted from the graph. Repeat waves need no special
casing either: the same character waving in the same room re-asserts the same content-addressed
triple, `appendFacts` unions the new provenance tag onto the existing fact id, and the recency
read takes the newest tag — so waving again after the window has passed animates again, through
the merge rule that already exists.

**Conflict handling was a pure add-only set for v1, and retraction has since landed on top of it.**
`retraction.mjs` writes one record per (triple, source), the mesh replicates it like any other fact,
and both enforcement points compare the assertion's own instant against the retraction's.
`causal-stability.mjs` holds the rule for retiring a tombstone as a pure function; nothing in the
product supplies its acknowledgement input yet, so it retires nothing. The one
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

All five run as real-browser tests, in that order: `test-e2e/p2p-webrtc-handshake.test.mjs`,
`pages-chat-p2p.test.mjs`, `pages-mud-p2p.test.mjs`, `p2p-mesh-three-peers.test.mjs` with
`pages-mud-p2p-mesh.test.mjs` for the same mesh on mud.html, and `p2p-disconnect-rejoin.test.mjs`.
`pages-chat-p2p-distributed-inference.test.mjs` adds the one the list doesn't name: a chain with one
link taught on each page, proved on both.

