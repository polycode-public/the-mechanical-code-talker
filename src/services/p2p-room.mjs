// services/p2p-room.mjs — room orchestration for the P2P layer: the two-paste
// signaling handoff, the mesh of direct connections it grows into, and the
// diff/broadcast/merge loop that keeps every peer's fact store converged.
// Everything WebRTC arrives through an injected `transportFactory`, so this
// module and every test of it run in plain Node with no browser and no network.
// src/adapters/p2p/webrtc-transport.mjs supplies the real factory; the pure
// message shapes live in src/domain/p2p/.
import {
  encodeInviteBlob,
  decodeInviteBlob,
  helloMessage,
  peerListMessage,
  introOfferMessage,
  introAnswerMessage,
  syncRequestMessage,
  syncResponseMessage,
  opMessage,
  isValidRoomMessage,
} from "../domain/p2p/wire.mjs";
import { relabelForBroadcast } from "../domain/p2p/provenance-relabel.mjs";
import {
  worldNameFact,
  nodeNameFact,
  invitedByFact,
  waveFact,
  latestFact,
  latestProvenanceTimestamp,
  isRecentWave,
  NODE_NAME_PREDICATE,
  WAVED_PREDICATE,
} from "../domain/p2p/facts.mjs";
import { generateNodeId } from "../domain/p2p/peer-id.mjs";
import { RETRACTION_PREDICATE } from "../domain/memory/retraction.mjs";
import {
  appendFacts, appendRetractions, loadMemory, loadNodeId, saveNodeId,
  readFactRows, readRetractions, normFactTerm, FACT_CLASS,
} from "../adapters/memory/core.mjs";

export const ROOM_IDLE = "idle";
export const ROOM_SHARING = "sharing";
export const ROOM_ANSWERING = "answering";
export const ROOM_CONNECTING = "connecting";
export const ROOM_CONNECTED = "connected";
export const ROOM_FAILED = "failed";

/** The object term a wave carries when it isn't scoped to a mud room —
 *  chat.html has presence but no geography, and a wave still needs a real
 *  object term because a triple with an empty slot is skipped on write. */
export const PRESENCE_SCOPE = "presence";

const INVITE_PROBLEM_MESSAGES = {
  invite: {
    empty: "paste the invite you were sent, then try again",
    truncated: "this invite looks cut short — ask for it to be sent again",
    malformed: "this invite looks cut short — ask for it to be sent again",
    "unsupported-version": "this invite came from a newer version of the page than this one",
    "wrong-kind": "that's a reply, not an invite — paste it into the box on the page that sent the invite",
    "wrong-world": "that invite is for a different world than this page is sharing",
  },
  reply: {
    empty: "paste their reply here, then try again",
    truncated: "that doesn't look like a complete reply — check the whole thing was copied, then paste it again",
    malformed: "that doesn't look like a complete reply — check the whole thing was copied, then paste it again",
    "unsupported-version": "that reply came from a newer version of the page than this one",
    "wrong-kind": "that's an invite, not a reply — send it to the person you're inviting, or open it in a new tab to join their world",
    "no-pending-invite": "that reply matched an invite that's already been used — create a fresh link and send that instead",
    "connect-failed": "your two machines couldn't find a path to each other — a public STUN server helps with most networks, but some firewalls or strict NATs still block it",
  },
};

const problem = (context, code) => ({
  error: code,
  message: INVITE_PROBLEM_MESSAGES[context]?.[code] || INVITE_PROBLEM_MESSAGES[context]?.malformed || code,
});

// A tag this shape has already been rewritten for the wire by whichever peer
// authored it. Relabeling it again would overwrite their node name with ours
// and lose the attribution the receiving page renders as "taught by X". The
// prefix is all this needs to match: everything a relabel adds after it — the
// display name, the `#node:<id>` origin segment, the timestamp — is that
// peer's, so a relayed tag stays byte-identical however much it carries.
const ALREADY_PEER_LABELED = /^teach:peer:/;

/** One outgoing tag per stored tag, each relabeled under the timestamp it
 *  already carries. Keeping a relabeled tag on the fact's own assertion time
 *  rather than the moment it went over the wire is what stops a months-old
 *  wave replayed inside a sync response reading as freshly waved, and it makes
 *  the rewrite idempotent: a peer that relays a tag it received produces the
 *  same tag again, so the union stops growing once every peer has seen it. */
/** `observedAtBySegment` maps a STORED (pre-relabel) tag to the observedAt its
 *  own record carries, when it has one — the dated-teach frame's own
 *  `mgx:observedAt`, threaded onto the wire fact each tag becomes. Returns
 *  `{ tag, observedAt }` pairs, deduped by the RELABELED tag (the first
 *  observedAt seen for a given output tag wins, matching the prior de-dup by
 *  tag string alone). */
function wireProvenanceTags(provenance, identity, fallbackTimestamp, observedAtBySegment) {
  const stored = String(provenance || "").split(" | ").filter(Boolean);
  if (!stored.length) return [{ tag: "", observedAt: undefined }];
  const byTag = new Map();
  for (const segment of stored) {
    const observedAt = observedAtBySegment?.get(segment);
    const tag = ALREADY_PEER_LABELED.test(segment) ? segment : (() => {
      const assertedAt = latestProvenanceTimestamp(segment);
      const timestamp = assertedAt === null ? fallbackTimestamp : new Date(assertedAt).toISOString();
      return relabelForBroadcast(segment, identity.displayName, timestamp, identity.nodeId);
    })();
    if (!byTag.has(tag)) byTag.set(tag, observedAt);
  }
  return [...byTag].map(([tag, observedAt]) => ({ tag, observedAt }));
}

/** This store's own node id, minted on first use and never regenerated: it
 *  keys every assertion the node broadcasts, so re-minting one would split a
 *  single node's history into two apparent origins that then corroborate each
 *  other. An id already on the store always wins over `preferred` (what a
 *  browser page carries across reloads) for exactly that reason — `preferred`
 *  only seeds a store that has never joined a room. */
export async function resolveStoreNodeId(memoryDir, preferred = "") {
  const stored = await loadNodeId(memoryDir);
  if (stored) return stored;
  const minted = preferred || generateNodeId();
  await saveNodeId(memoryDir, minted);
  return minted;
}

const isFactShaped = (f) => !!f
  && typeof f.subject === "string" && f.subject.length > 0
  && typeof f.predicate === "string" && f.predicate.length > 0
  && typeof f.object === "string" && f.object.length > 0;

/** One wire fact per provenance tag rather than one carrying the whole
 *  " | "-joined union. appendFacts dedupes an incoming tag against the tags it
 *  already stores, and a joined union arrives as one opaque string that matches
 *  none of them — so a fact whose provenance had grown would union again on
 *  every hop and never settle. Sending each tag on its own row keeps the merge
 *  idempotent, and a repeated triple inside one batch unions correctly.
 *
 *  `mgx:observedAt` is record content the same way the tag is: each of
 *  row.assertions is one live head, and its own `provenance` (that head's own
 *  tags) is the join key back to which outgoing wire fact carries its
 *  observedAt. A dated taught fact's broadcast carries the date, so a peer
 *  that receives it can resolve it against a fresher OR staler claim the same
 *  way the local store already does (memory/resolution.mjs's
 *  effectiveObservedAt chain). */
const toWireFacts = (row, identity, fallbackTimestamp) => {
  const observedAtBySegment = new Map();
  for (const a of row.assertions || []) {
    if (!a.observedAt) continue;
    for (const segment of String(a.provenance || "").split(" | ").filter(Boolean)) {
      observedAtBySegment.set(segment, a.observedAt);
    }
  }
  return wireProvenanceTags(row.provenance, identity, fallbackTimestamp, observedAtBySegment)
    .map(({ tag, observedAt }) => ({
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      provenance: tag,
      ...(observedAt ? { observedAt } : {}),
    }));
};

/** A room: one shared world, one local fact store, and however many direct
 *  peer connections have been made into it.
 *
 *  `syncableFacts(rows) -> rows` is injected because a chat room and a mud
 *  room disagree about which facts are worth replicating, and this module has
 *  no business knowing which one it is serving. It gates both directions: what
 *  a sync response carries out, and what an incoming batch is allowed to merge.
 */
export function createP2pRoom({
  memoryDir,
  myPeerId,
  myDisplayName,
  // Optional. A browser page carries its node id across reloads itself (the
  // in-memory store it rebuilds each visit cannot), so it passes the id it
  // kept; a store that already holds one keeps that instead. Omitted, the
  // room mints one onto the store the first time it joins a room.
  myNodeId = "",
  worldId,
  worldName,
  transportFactory,
  syncableFacts,
  now: rawNow = () => new Date().toISOString(),
}) {
  // Wall-clock resolution is 1ms; two facts minted in the same tick (a
  // double-click wave, two rapid local writes) would otherwise share one
  // timestamp — and since the diff key is (id, provenance), an identical
  // provenance string for the same triple looks like no change at all, so
  // the second write silently fails to broadcast. Monotonic nudging fixes
  // that at the source rather than asking every caller to space calls out.
  let lastTimestampMs = -Infinity;
  const now = () => {
    const raw = rawNow();
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) return raw; // an injected non-ISO now() is trusted as-is
    const nudged = Math.max(ms, lastTimestampMs + 1);
    lastTimestampMs = nudged;
    return new Date(nudged).toISOString();
  };
  let displayName = myDisplayName;
  let nodeId = myNodeId;
  // What this node's own assertions go out under: the name people read, and
  // the stable id that keys them. Read fresh per broadcast — a rename or a
  // recast can move either between one turn and the next.
  const wireIdentity = () => ({ displayName, nodeId });
  let state = ROOM_IDLE;
  let lastError = null;
  let started = false;
  let closed = false;
  let droppedMessages = 0;

  const peers = new Map(); // peerId -> { peerId, displayName, transport, connected }
  const transportPeerId = new Map(); // transport -> peerId, for routing a reply back where it came from
  const pendingIntros = new Map(); // peerId -> transport we minted an offer for and are awaiting an answer on
  let pendingShare = null; // the transport behind the most recently minted invite link

  // id -> the provenance string this room last saw on that fact. The diff key
  // is (id, provenance) rather than id alone because a repeat wave re-asserts
  // the SAME content-addressed triple and only unions a fresh tag onto it, so
  // an id-only diff would never see the second wave. Recording a merged fact's
  // post-merge provenance here immediately after appendFacts is what stops a
  // fact that arrived from a peer being re-broadcast as if we had authored it.
  const seenProvenanceById = new Map();
  let cachedRows = [];
  // A retraction is not a fact row — readFactRows can never return one, because
  // the whole point of the record is that the rows it names are gone. So it
  // gets its own cache and its own diff, keyed on what it actually carries: the
  // ids it suppressed. Those grow by union as peers merge, and a grown record
  // is a change worth broadcasting even though its provenance never moved.
  let cachedRetractions = [];
  const seenRetractionValueById = new Map();
  const retractionDiffValue = (fact) => `${fact.provenance} ${fact.object}`;

  // Store-touching work runs one job at a time, in arrival order. Every path
  // that reads or writes memoryDir/seenProvenanceById/cachedRows crosses at
  // least one await, so without this a rebind could swap the store while a
  // merge is half-written into the old one — the merged rows would then
  // baseline against the wrong store, or vanish. Jobs queued behind a rebind
  // land on the store the rebind installed.
  let storeChain = Promise.resolve();
  function withStore(job) {
    const run = storeChain.then(job);
    storeChain = run.then(() => {}, () => {});
    return run;
  }

  const factsListeners = new Set();
  const stateListeners = new Set();
  const peersListeners = new Set();

  const emit = (listeners, payload) => { for (const fn of listeners) fn(payload); };

  function setState(next) {
    if (state === next) return;
    state = next;
    emit(stateListeners, state);
  }

  // A channel that died mid-send is a disconnect, reported by its own onClose
  // handler; it should never fail the turn that happened to be broadcasting.
  function send(transport, message) {
    try { transport.send(message); } catch { /* handled by onClose */ }
  }

  const connectedPeers = () => [...peers.values()].filter((p) => p.connected);

  function broadcast(message) {
    for (const peer of connectedPeers()) send(peer.transport, message);
  }

  function relayTo(peerId, message) {
    const peer = peers.get(peerId);
    if (peer?.connected) send(peer.transport, message);
  }

  async function refreshRows() {
    const memory = await loadMemory(memoryDir);
    cachedRows = readFactRows(memory);
    cachedRetractions = readRetractions(memory);
    return cachedRows;
  }

  /** readFactRows walks `individuals` in array order and the fold reads them in
   *  that order, so two peers holding an identical fact set can still fold it
   *  differently while their arrival orders differ. Sorting the Fact
   *  individuals by content-addressed id after every merge makes that order the
   *  same on every peer. The sort is in place on the payload loadMemory
   *  returned, which for the in-memory backend a browser bundle uses is the
   *  live store itself. */
  async function sortFactIndividualsById() {
    const individuals = (await loadMemory(memoryDir))?.individuals;
    if (!Array.isArray(individuals)) return;
    const slots = [];
    const facts = [];
    for (let i = 0; i < individuals.length; i += 1) {
      if (individuals[i]?.class !== FACT_CLASS) continue;
      slots.push(i);
      facts.push(individuals[i]);
    }
    // Codepoint order, never localeCompare: the whole point is that two peers
    // in different locales land on the same order.
    facts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < slots.length; i += 1) individuals[slots[i]] = facts[i];
  }

  async function baselineSeen() {
    await refreshRows();
    for (const row of cachedRows) seenProvenanceById.set(row.id, row.provenance);
    for (const fact of cachedRetractions) seenRetractionValueById.set(fact.id, retractionDiffValue(fact));
  }

  async function ensureStarted() {
    if (started) return;
    started = true;
    // Joining a room is the first moment this store needs an identity other
    // peers can key on, so it is where the node id is minted.
    nodeId = await resolveStoreNodeId(memoryDir, myNodeId);
    // Every fact already on disk is history, not something this session
    // authored, so it is baselined as seen. A joiner gets it through sync
    // instead, which is what the sync filter exists to size down.
    await baselineSeen();
    const timestamp = now();
    const identity = [];
    if (worldId && worldName) identity.push(worldNameFact(worldId, worldName, timestamp));
    if (myPeerId && displayName) identity.push(nodeNameFact(myPeerId, displayName, timestamp));
    if (identity.length) {
      await appendFacts(memoryDir, identity);
      await sortFactIndividualsById();
      await refreshRows();
    }
  }

  /** Diff the store against what this room last saw, relabel each changed
   *  fact's provenance for the wire, and broadcast the batch. The page calls
   *  this (as `afterLocalChange`) once after every local turn or action. */
  async function flushLocalChange() {
    await ensureStarted();
    await refreshRows();
    const changed = [];
    for (const row of cachedRows) {
      if (seenProvenanceById.get(row.id) === row.provenance) continue;
      seenProvenanceById.set(row.id, row.provenance);
      changed.push(row);
    }
    for (const fact of cachedRetractions) {
      const value = retractionDiffValue(fact);
      if (seenRetractionValueById.get(fact.id) === value) continue;
      seenRetractionValueById.set(fact.id, value);
      changed.push(fact);
    }
    if (!changed.length) return { broadcast: 0 };
    const targets = connectedPeers();
    if (!targets.length) return { broadcast: 0 };
    const timestamp = now();
    const facts = changed.flatMap((row) => toWireFacts(row, wireIdentity(), timestamp));
    broadcast(opMessage({ from: myPeerId, facts }));
    return { broadcast: changed.length };
  }

  async function mergeIncomingFacts(incoming) {
    const accepted = syncableFacts((incoming || []).filter(isFactShaped));
    if (!accepted.length) return { merged: 0 };
    // Flush first: a local fact still waiting to be diffed would otherwise be
    // recorded as merged below and never leave this browser.
    await flushLocalChange();
    // Retractions land BEFORE the assertions in the same batch, so a peer
    // sending both the fact and the record that suppresses it lands them in the
    // order that leaves the fact out. Either order converges — the read fold
    // strips a record a retraction covers however late the retraction arrives —
    // but doing it this way keeps a suppressed record from being written at all.
    const retractions = accepted.filter((f) => f.predicate === RETRACTION_PREDICATE);
    if (retractions.length) await appendRetractions(memoryDir, retractions);
    const assertions = retractions.length
      ? accepted.filter((f) => f.predicate !== RETRACTION_PREDICATE)
      : accepted;
    const { ids } = assertions.length ? await appendFacts(memoryDir, assertions.map((f) => ({
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      provenance: typeof f.provenance === "string" ? f.provenance : "",
      // Presence-wins on an id collision with equal assertion timestamps is
      // already the join appendFacts' own supersedesPriorAssertion performs —
      // this is the passthrough that lets a dated taught fact's wire fact
      // reach it at all.
      ...(typeof f.observedAt === "string" && f.observedAt ? { observedAt: f.observedAt } : {}),
    }))) : { ids: [] };
    await sortFactIndividualsById();
    await refreshRows();
    const mergedIds = new Set(ids);
    for (const row of cachedRows) {
      if (mergedIds.has(row.id)) seenProvenanceById.set(row.id, row.provenance);
    }
    // Same reason the fact baseline above exists: a retraction that arrived
    // from a peer must not go back out as though this node had authored it.
    // Every peer broadcasts its OWN record when it makes one, so the union each
    // peer ends up with is reached from the originals rather than from relays.
    for (const fact of cachedRetractions) seenRetractionValueById.set(fact.id, retractionDiffValue(fact));
    const merged = ids.length + retractions.length;
    emit(factsListeners, { merged, rows: cachedRows });
    return { merged };
  }

  function registerPeer(peerId, peerDisplayName, transport) {
    const existing = peers.get(peerId);
    if (existing?.connected && existing.transport !== transport) {
      // One direct channel per peer. A second one means both sides opened an
      // introduction at once; drop the newcomer and keep the live channel.
      transport.close();
      return { accepted: false, freshlyConnected: false };
    }
    const freshlyConnected = !existing?.connected;
    peers.set(peerId, { peerId, displayName: peerDisplayName, transport, connected: true });
    transportPeerId.set(transport, peerId);
    pendingIntros.delete(peerId);
    setState(ROOM_CONNECTED);
    emit(peersListeners, peerList());
    return { accepted: true, freshlyConnected };
  }

  async function requestIntroduction(targetPeerId, viaTransport) {
    const transport = transportFactory();
    pendingIntros.set(targetPeerId, transport);
    attachTransport(transport);
    const sdp = await transport.createOffer();
    send(viaTransport, introOfferMessage({ from: myPeerId, to: targetPeerId, sdp }));
  }

  async function handleMessage(transport, message) {
    if (closed) return;
    if (!isValidRoomMessage(message)) { droppedMessages += 1; return; }
    switch (message.type) {
      case "hello": {
        if (message.peerId === myPeerId) return;
        const { accepted, freshlyConnected } = registerPeer(message.peerId, message.displayName, transport);
        if (!accepted || !freshlyConnected) return;
        const others = connectedPeers()
          .filter((p) => p.peerId !== message.peerId)
          .map((p) => ({ peerId: p.peerId, displayName: p.displayName }));
        send(transport, peerListMessage({ peers: others }));
        return;
      }
      case "peer-list": {
        for (const entry of message.peers) {
          if (entry.peerId === myPeerId) continue;
          if (peers.get(entry.peerId)?.connected) continue;
          if (pendingIntros.has(entry.peerId)) continue;
          await requestIntroduction(entry.peerId, transport);
        }
        return;
      }
      // intro-offer and intro-answer are the only messages this room ever
      // forwards, and only while two peers who have never met are exchanging
      // SDP through the one peer that already reaches both. Once their own
      // channel opens they talk directly; no fact traffic is ever relayed.
      case "intro-offer": {
        if (message.to !== myPeerId) { relayTo(message.to, message); return; }
        if (message.from === myPeerId) return;
        if (peers.get(message.from)?.connected) return;
        const answering = transportFactory();
        attachTransport(answering);
        const sdp = await answering.createAnswerFor(message.sdp);
        send(transport, introAnswerMessage({ from: myPeerId, to: message.from, sdp }));
        return;
      }
      case "intro-answer": {
        if (message.to !== myPeerId) { relayTo(message.to, message); return; }
        const pending = pendingIntros.get(message.from);
        if (!pending) return;
        await pending.completeWithAnswer(message.sdp);
        return;
      }
      case "sync-request": {
        const facts = await withStore(async () => {
          await refreshRows();
          const timestamp = now();
          return syncableFacts([...cachedRows, ...cachedRetractions])
            .flatMap((row) => toWireFacts(row, wireIdentity(), timestamp));
        });
        send(transport, syncResponseMessage({ facts }));
        return;
      }
      // A historical sync response and a live op merge the same way, through
      // the same filter, because merging is idempotent by id — the overlap
      // between them needs no sequencing.
      case "sync-response":
      case "op":
        await withStore(() => mergeIncomingFacts(message.facts));
    }
  }

  function attachTransport(transport) {
    // A peer can send anything, including an intro-offer carrying an SDP that
    // makes the transport reject. That is a dropped message, not a crashed room.
    transport.onMessage((data) => {
      handleMessage(transport, data).catch(() => { droppedMessages += 1; });
    });
    transport.onOpen(() => {
      if (closed) return;
      setState(ROOM_CONNECTED);
      send(transport, helloMessage({ peerId: myPeerId, displayName }));
      // Sync starts the moment the channel opens, before any peer identity is
      // known. Merging is idempotent by id, so overlap between the historical
      // response and live ops needs no sequencing.
      send(transport, syncRequestMessage());
    });
    transport.onClose(() => {
      const peerId = transportPeerId.get(transport);
      transportPeerId.delete(transport);
      if (peerId) {
        const peer = peers.get(peerId);
        // A peer that has gone stays in the list marked away: its facts and its
        // node name are still part of the graph, and rejoining is a fresh invite.
        if (peer?.transport === transport) peers.set(peerId, { ...peer, connected: false });
        emit(peersListeners, peerList());
      }
      if (pendingShare === transport) pendingShare = null;
      for (const [target, pending] of pendingIntros) if (pending === transport) pendingIntros.delete(target);
      if (!connectedPeers().length && state === ROOM_CONNECTING) setState(ROOM_FAILED);
    });
    return transport;
  }

  const peerList = () => [...peers.values()].map((p) => ({
    peerId: p.peerId,
    displayName: p.displayName,
    connected: p.connected,
  }));

  /** Mint a fresh invite blob. One blob completes exactly one connection, so
   *  each call replaces whatever earlier invite was still waiting for a reply. */
  async function startSharing() {
    await withStore(ensureStarted);
    const transport = attachTransport(transportFactory());
    pendingShare = transport;
    lastError = null;
    const sdp = await transport.createOffer();
    setState(ROOM_SHARING);
    return { blob: encodeInviteBlob({ kind: "offer", sdp, world: worldId, worldName, node: nodeId }) };
  }

  /** Decode someone's invite and answer it. Returns the reply blob to send
   *  back, or a named problem the page can show beside the box it came from. */
  async function acceptInvite(blobString) {
    await withStore(ensureStarted);
    const decoded = decodeInviteBlob(blobString);
    if (decoded.error) {
      lastError = problem("invite", decoded.error);
      return lastError;
    }
    if (decoded.value.kind !== "offer") {
      lastError = problem("invite", "wrong-kind");
      return lastError;
    }
    if (worldId && decoded.value.world !== worldId) {
      lastError = problem("invite", "wrong-world");
      return { ...lastError, world: decoded.value.world, worldName: decoded.value.worldName };
    }
    const transport = attachTransport(transportFactory());
    lastError = null;
    const sdp = await transport.createAnswerFor(decoded.value.sdp);
    await recordInviteEdge(decoded.value.node);
    setState(ROOM_ANSWERING);
    return {
      blob: encodeInviteBlob({ kind: "reply", sdp }),
      world: decoded.value.world,
      worldName: decoded.value.worldName,
    };
  }

  /** Write the admission edge for the invite this node just answered. Only the
   *  joiner can: the inviter does not learn the joining node's id until the
   *  channel is already open, and by then the edge would be indistinguishable
   *  from any other fact that arrived over it. An invite from a build that
   *  predates the node field carries no inviter to record, and an invite a node
   *  answers with its own id is no admission at all. */
  async function recordInviteEdge(inviterNodeId) {
    if (typeof inviterNodeId !== "string" || !inviterNodeId) return;
    if (!nodeId || inviterNodeId === nodeId) return;
    await withStore(async () => {
      await appendFacts(memoryDir, [invitedByFact(nodeId, inviterNodeId, now())]);
      await sortFactIndividualsById();
      await refreshRows();
    });
  }

  /** Feed the joiner's reply back into the invite it answers, completing the
   *  connection. */
  async function completeInvite(replyBlob) {
    await withStore(ensureStarted);
    if (!pendingShare) {
      lastError = problem("reply", "no-pending-invite");
      return lastError;
    }
    const decoded = decodeInviteBlob(replyBlob);
    if (decoded.error) {
      lastError = problem("reply", decoded.error);
      return lastError;
    }
    if (decoded.value.kind !== "reply") {
      lastError = problem("reply", "wrong-kind");
      return lastError;
    }
    const transport = pendingShare;
    pendingShare = null;
    lastError = null;
    setState(ROOM_CONNECTING);
    try {
      await transport.completeWithAnswer(decoded.value.sdp);
    } catch {
      setState(ROOM_FAILED);
      lastError = problem("reply", "connect-failed");
      return lastError;
    }
    return { ok: true };
  }

  async function setMyDisplayName(name) {
    return withStore(async () => {
      await ensureStarted();
      displayName = name;
      await appendFacts(memoryDir, [nodeNameFact(myPeerId, name, now())]);
      await sortFactIndividualsById();
      return flushLocalChange();
    });
  }

  /** Wave as `subjectId`, in `roomId` when there is one. chat.html's presence
   *  wave passes null and lands on PRESENCE_SCOPE instead. */
  async function wave(subjectId, roomId = null) {
    return withStore(async () => {
      await ensureStarted();
      await appendFacts(memoryDir, [waveFact(subjectId, roomId || PRESENCE_SCOPE, now())]);
      await sortFactIndividualsById();
      return flushLocalChange();
    });
  }

  /** Whether `subjectId` is waving right now, read from the cached rows so a
   *  renderer can call it every frame. A stored row holds the normalized term,
   *  so a caller's raw id is normalized the same way before it's compared. */
  function isWaving(subjectId, nowMs = Date.now(), windowMs) {
    const subject = normFactTerm(subjectId);
    return cachedRows.some((row) => row.subject === subject
      && row.predicate === WAVED_PREDICATE
      && isRecentWave(row, nowMs, windowMs));
  }

  /** A peer's own chosen node name, from its latest nodeName fact, falling
   *  back to the name it introduced itself with and then to a short peer id.
   *  A label never waits for a name fact to arrive. */
  function displayNameFor(peerId) {
    const fact = latestFact(cachedRows, normFactTerm(`peer:${peerId}`), NODE_NAME_PREDICATE);
    if (fact?.object) return fact.object;
    return peers.get(peerId)?.displayName || String(peerId).slice(0, 8);
  }

  /** Re-bind this room to a fresh store — the recast path. The peer
   *  connections are the point of keeping the room alive, so nothing about
   *  the transports or the peer map is touched. In order: flush whatever the
   *  OLD store still had undiffed (a turn landed just before the recast must
   *  not vanish silently), swap the store reference, rebuild the diff
   *  baseline against the new store, write the identity facts into it, then
   *  push the new store's syncable facts to every open channel as an
   *  ordinary op and ask each peer for its own view with an ordinary
   *  sync-request — the exact machinery a freshly opened channel uses, no
   *  new message type. Runs on the store chain, so a merge in flight when
   *  the recast happens finishes against the store it started on, and
   *  everything behind it lands on the new one. */
  async function rebind({ memoryDir: nextMemoryDir, worldName: nextWorldName, myDisplayName: nextDisplayName } = {}) {
    if (!nextMemoryDir) throw new Error("rebind needs the store to bind to");
    return withStore(async () => {
      if (closed) throw new Error("this room is closed");
      if (started) await flushLocalChange();
      memoryDir = nextMemoryDir;
      if (nextWorldName) worldName = nextWorldName;
      if (nextDisplayName) displayName = nextDisplayName;
      started = true;
      // The store changed, so the node id is re-resolved against the new one.
      // A recast store that has never joined a room adopts the id this node
      // has been broadcasting under all along, which is what keeps a recast
      // from reading to every peer as a brand-new node.
      nodeId = await resolveStoreNodeId(memoryDir, nodeId || myNodeId);
      seenProvenanceById.clear();
      seenRetractionValueById.clear();
      cachedRows = [];
      cachedRetractions = [];
      const timestamp = now();
      const identity = [];
      if (worldId && worldName) identity.push(worldNameFact(worldId, worldName, timestamp));
      if (myPeerId && displayName) identity.push(nodeNameFact(myPeerId, displayName, timestamp));
      if (identity.length) {
        await appendFacts(memoryDir, identity);
        await sortFactIndividualsById();
      }
      await refreshRows();
      for (const row of cachedRows) seenProvenanceById.set(row.id, row.provenance);
      for (const fact of cachedRetractions) seenRetractionValueById.set(fact.id, retractionDiffValue(fact));
      const targets = connectedPeers();
      let pushed = 0;
      if (targets.length) {
        const wireTimestamp = now();
        const facts = syncableFacts([...cachedRows, ...cachedRetractions])
          .flatMap((row) => toWireFacts(row, wireIdentity(), wireTimestamp));
        pushed = facts.length;
        if (facts.length) broadcast(opMessage({ from: myPeerId, facts }));
        broadcast(syncRequestMessage());
      }
      emit(factsListeners, { merged: 0, rows: cachedRows });
      return { pushed, peers: targets.length };
    });
  }

  function close() {
    closed = true;
    for (const peer of peers.values()) peer.transport.close();
    if (pendingShare) pendingShare.close();
    for (const pending of pendingIntros.values()) pending.close();
    pendingIntros.clear();
    pendingShare = null;
  }

  const subscribe = (listeners) => (handler) => {
    listeners.add(handler);
    return () => listeners.delete(handler);
  };

  return {
    peerId: myPeerId,
    worldId,
    get worldName() { return worldName; },
    get displayName() { return displayName; },
    get nodeId() { return nodeId; },
    get state() { return state; },
    get lastError() { return lastError; },
    get droppedMessages() { return droppedMessages; },
    peers: peerList,
    displayNameFor,
    start: () => withStore(ensureStarted),
    startSharing,
    acceptInvite,
    completeInvite,
    afterLocalChange: () => withStore(flushLocalChange),
    setMyDisplayName,
    wave,
    isWaving,
    rebind,
    factRows: () => cachedRows,
    refresh: () => withStore(refreshRows),
    onFactsChanged: subscribe(factsListeners),
    onStateChanged: subscribe(stateListeners),
    onPeersChanged: subscribe(peersListeners),
    close,
  };
}
