import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createP2pRoom, PRESENCE_SCOPE, resolveStoreNodeId } from "../../src/services/p2p-room.mjs";
import { chatSyncableFacts } from "../../src/domain/p2p/sync-filter.mjs";
import { decodeInviteBlob, encodeInviteBlob } from "../../src/domain/p2p/wire.mjs";
import { WAVED_PREDICATE, INVITED_BY_PREDICATE, nodeTerm, invitedByFact } from "../../src/domain/p2p/facts.mjs";
import { RETRACTION_PREDICATE } from "../../src/domain/memory/retraction.mjs";
import {
  createInMemoryStore, appendFacts, removeFacts, loadMemory, readFactRows,
  readRetractions, normFactTerm, FACT_CLASS,
  admittedNodes, retirableRetractions, retireRetractions,
} from "../../src/adapters/memory/core.mjs";

// A pair of in-memory transports wired straight to each other, matching the
// shape src/adapters/p2p/webrtc-transport.mjs supplies. SDP is a bare label:
// what these tests exercise is message routing and merge logic, and real
// negotiation would only add timing noise to that.
function createFakeNetwork() {
  const internals = new Map();
  const offers = new Map();
  const answers = new Map();
  const log = [];
  let counter = 0;

  function createTransport() {
    const handlers = { message: () => {}, open: () => {}, close: () => {} };
    let peer = null;
    let state = "new";

    const transport = {
      async createOffer() {
        const sdp = `offer-${++counter}`;
        offers.set(sdp, transport);
        state = "connecting";
        return sdp;
      },
      async createAnswerFor(offerSdp) {
        if (!offers.has(offerSdp)) throw new Error(`fake network: no such offer ${offerSdp}`);
        const sdp = `answer-${++counter}`;
        answers.set(sdp, transport);
        state = "connecting";
        return sdp;
      },
      async completeWithAnswer(answerSdp) {
        const answerer = answers.get(answerSdp);
        if (!answerer) throw new Error(`fake network: no such answer ${answerSdp}`);
        internals.get(transport).link(answerer);
        internals.get(answerer).link(transport);
        queueMicrotask(() => {
          internals.get(transport).open();
          internals.get(answerer).open();
        });
      },
      send(data) {
        if (state !== "connected" || !peer) return;
        log.push(data);
        const target = peer;
        queueMicrotask(() => internals.get(target)?.deliver(data));
      },
      onMessage(fn) { handlers.message = fn; },
      onOpen(fn) { handlers.open = fn; },
      onClose(fn) { handlers.close = fn; },
      close() {
        if (state === "closed") return;
        state = "closed";
        const target = peer;
        peer = null;
        handlers.close();
        if (target) queueMicrotask(() => internals.get(target)?.remoteClosed());
      },
      get connectionState() { return state; },
    };

    internals.set(transport, {
      link: (other) => { peer = other; },
      open: () => { if (state === "connected" || state === "closed") return; state = "connected"; handlers.open(); },
      deliver: (data) => { if (state === "connected") handlers.message(JSON.parse(JSON.stringify(data))); },
      remoteClosed: () => { if (state === "closed") return; state = "closed"; peer = null; handlers.close(); },
    });
    return transport;
  }

  return {
    createTransport,
    log,
    injectTo: (transport, data) => internals.get(transport)?.deliver(data),
  };
}

const settle = async (rounds = 60) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => { setTimeout(resolve, 0); });
};

const WORLD_ID = "world-mossy-hollow";
const WORLD_NAME = "mossy hollow";

function makeRoom(network, { peerId, displayName, capture, nodeId }) {
  const memoryDir = createInMemoryStore();
  const transportFactory = () => {
    const transport = network.createTransport();
    capture?.push(transport);
    return transport;
  };
  const room = createP2pRoom({
    memoryDir,
    myPeerId: peerId,
    myDisplayName: displayName,
    myNodeId: nodeId,
    worldId: WORLD_ID,
    worldName: WORLD_NAME,
    transportFactory,
    syncableFacts: chatSyncableFacts,
  });
  return { room, memoryDir };
}

async function connect(inviter, joiner) {
  const invite = await inviter.startSharing();
  const reply = await joiner.acceptInvite(invite.blob);
  assert.equal(reply.error, undefined, `acceptInvite failed: ${reply.message || ""}`);
  const done = await inviter.completeInvite(reply.blob);
  assert.equal(done.error, undefined, `completeInvite failed: ${done.message || ""}`);
  await settle();
}

const teachFact = (subject, predicate, object, sessionId, at) => ({
  subject, predicate, object,
  provenance: `teach:chat:${sessionId}@${at}`,
});

const rowsOf = async (memoryDir) => readFactRows(await loadMemory(memoryDir));
const findRow = (rows, subject, predicate) => rows.find((r) => r.subject === subject && r.predicate === predicate);

test("two peers connect through the invite-and-reply exchange and each sees the other in its peer list", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });

  await connect(alice.room, bob.room);

  assert.equal(alice.room.state, "connected");
  assert.equal(bob.room.state, "connected");
  assert.deepEqual(alice.room.peers(), [{ peerId: "peer-b", displayName: "mossy-acorn", connected: true }]);
  assert.deepEqual(bob.room.peers(), [{ peerId: "peer-a", displayName: "amber-fox", connected: true }]);
});

test("the invite blob carries this room's world id and name, and the reply answers it", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });

  const invite = await alice.room.startSharing();
  assert.equal(alice.room.state, "sharing");
  const decodedInvite = decodeInviteBlob(invite.blob);
  assert.equal(decodedInvite.value.kind, "offer");
  assert.equal(decodedInvite.value.world, WORLD_ID);
  assert.equal(decodedInvite.value.worldName, WORLD_NAME);

  const reply = await bob.room.acceptInvite(invite.blob);
  assert.equal(bob.room.state, "answering");
  assert.equal(decodeInviteBlob(reply.blob).value.kind, "reply");
  assert.equal(reply.worldName, WORLD_NAME);
});

test("a locally taught fact is diffed, relabeled onto this node's name, and merged by the peer", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
  const sent = await alice.room.afterLocalChange();
  assert.ok(sent.broadcast >= 1);
  await settle();

  const bobRows = await rowsOf(bob.memoryDir);
  const merged = findRow(bobRows, "rover", "mgx:isA");
  assert.ok(merged, "the taught fact reached the peer");
  assert.equal(merged.object, "dog");
  assert.match(merged.provenance, /^teach:peer:amber-fox#node:[0-9a-f]{16}@/);

  const aliceRows = await rowsOf(alice.memoryDir);
  assert.equal(findRow(aliceRows, "rover", "mgx:isA").provenance, "teach:chat:sess-a@2026-05-01T10:00:00.000Z");
});

test("a dated taught fact's mgx:observedAt is record content — it rides the wire fact and the peer stores the same instant", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await appendFacts(alice.memoryDir, [{
    ...teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z"),
    observedAt: "2019-03-01T00:00:00.000Z",
  }]);
  await alice.room.afterLocalChange();
  await settle();

  const merged = findRow(await rowsOf(bob.memoryDir), "rover", "mgx:isA");
  assert.ok(merged, "the taught fact reached the peer");
  assert.equal(merged.assertions[0].observedAt, "2019-03-01T00:00:00.000Z");
});

test("a finding-bearing taught fact's mgx:extractionFinding is record content — it rides the wire fact and the peer reads back the same caveat", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await appendFacts(alice.memoryDir, [{
    ...teachFact("normalizefeeditems", "tmct:has", "guid", "sess-a", "2026-05-01T10:00:00.000Z"),
    extraction: ["identifier-token"],
  }]);
  await alice.room.afterLocalChange();
  await settle();

  const merged = findRow(await rowsOf(bob.memoryDir), "normalizefeeditems", "tmct:has");
  assert.ok(merged, "the taught fact reached the peer");
  assert.deepEqual(merged.extraction, ["identifier-token"]);
  assert.deepEqual(merged.assertions[0].extraction, ["identifier-token"]);

  const aliceRows = await rowsOf(alice.memoryDir);
  assert.deepEqual(findRow(aliceRows, "normalizefeeditems", "tmct:has").extraction, ["identifier-token"],
    "the origin's own copy still carries the finding it recorded");
});

test("two peers that merge the same finding-bearing assertions in opposite orders read back the same row, findings included", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob1Transports = [];
  const bob2Transports = [];
  const bob1 = makeRoom(network, { peerId: "peer-b1", displayName: "mossy-acorn", capture: bob1Transports });
  const bob2 = makeRoom(network, { peerId: "peer-b2", displayName: "quiet-bracken", capture: bob2Transports });
  await connect(alice.room, bob1.room);
  await connect(alice.room, bob2.room);

  // Two independent sources' own readings of the same triple, each recording
  // a different finding — exactly the shape a row.extraction union folds
  // over. Delivered as two separate "op" batches, in opposite orders, to two
  // otherwise-identical peers.
  const clauseFallback = {
    subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
    provenance: "teach:peer:amber-fox#node:0123456789abcdef@2026-05-01T10:00:00.000Z",
    extraction: ["clause-fallback"],
  };
  const pronounCarry = {
    subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
    provenance: "teach:peer:quiet-bracken#node:fedcba9876543210@2026-05-01T10:00:01.000Z",
    extraction: ["pronoun-carry"],
  };

  network.injectTo(bob1Transports[0], { type: "op", from: "peer-a", facts: [clauseFallback] });
  await settle();
  network.injectTo(bob1Transports[0], { type: "op", from: "peer-a", facts: [pronounCarry] });
  await settle();

  network.injectTo(bob2Transports[0], { type: "op", from: "peer-a", facts: [pronounCarry] });
  await settle();
  network.injectTo(bob2Transports[0], { type: "op", from: "peer-a", facts: [clauseFallback] });
  await settle();

  const row1 = findRow(await rowsOf(bob1.memoryDir), "cell", "rdfs:subClassOf");
  const row2 = findRow(await rowsOf(bob2.memoryDir), "cell", "rdfs:subClassOf");
  assert.deepEqual(row1.extraction, ["clause-fallback", "pronoun-carry"]);
  assert.deepEqual(row1.extraction, row2.extraction, "the row union does not depend on arrival order");
  assert.deepEqual(
    row1.assertions.map((a) => ({ id: a.id, extraction: a.extraction })),
    row2.assertions.map((a) => ({ id: a.id, extraction: a.extraction })),
    "each source's own finding lands on the same assertion record whichever order the two arrived in",
  );
});

test("presence-wins: on an id collision at an equal assertion timestamp, a record carrying mgx:observedAt supersedes the same record without one", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bobTransports = [];
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", capture: bobTransports });
  await connect(alice.room, bob.room);

  // The SAME tag arriving twice — the mixed-version-mesh scenario: an old
  // relay drops the field first, then a re-sync (or the origin resending)
  // carries it. Equal assertedAt both times (embedded in the identical tag),
  // so this is exactly the tie supersedesPriorAssertion breaks on presence.
  const tag = "teach:peer:amber-fox#node:0123456789abcdef@2026-05-01T10:00:00.000Z";
  network.injectTo(bobTransports[0], {
    type: "op", from: "peer-a",
    facts: [{ subject: "otter", predicate: "mgx:isA", object: "mammal", provenance: tag }],
  });
  await settle();
  const undated = findRow(await rowsOf(bob.memoryDir), "otter", "mgx:isA");
  assert.equal(undated.assertions.length, 1);
  assert.equal(undated.assertions[0].observedAt, undefined);

  network.injectTo(bobTransports[0], {
    type: "op", from: "peer-a",
    facts: [{ subject: "otter", predicate: "mgx:isA", object: "mammal", provenance: tag, observedAt: "2019-01-01T00:00:00.000Z" }],
  });
  await settle();
  const dated = findRow(await rowsOf(bob.memoryDir), "otter", "mgx:isA");
  assert.equal(dated.assertions.length, 1, "still one live head for this source — a supersession, never a second vote");
  assert.equal(dated.assertions[0].observedAt, "2019-01-01T00:00:00.000Z");
});

test("a fact received from a peer is never broadcast back out", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await alice.room.afterLocalChange();
  await settle();

  const opsAfterFirstBroadcast = network.log.filter((m) => m?.type === "op").length;
  const echo = await bob.room.afterLocalChange();
  await settle();

  assert.equal(echo.broadcast, 0);
  assert.equal(network.log.filter((m) => m?.type === "op").length, opsAfterFirstBroadcast);
});

test("a repeat wave re-asserting the same triple still broadcasts, because the diff keys on provenance too", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  const first = await alice.room.wave("badger-1", "sett-1");
  assert.equal(first.broadcast, 1);
  const second = await alice.room.wave("badger-1", "sett-1");
  assert.equal(second.broadcast, 1);
  await settle();

  const bobRows = await rowsOf(bob.memoryDir);
  const waves = bobRows.filter((r) => r.predicate === WAVED_PREDICATE && r.subject === "badger-1");
  assert.equal(waves.length, 1, "the same triple merges onto one fact id");
});

test("a malformed incoming message is dropped without merging and without throwing", async () => {
  const network = createFakeNetwork();
  const aliceTransports = [];
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", capture: aliceTransports });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  const before = (await rowsOf(alice.memoryDir)).length;
  for (const junk of [
    { garbage: true },
    { type: "op", from: "peer-b", facts: "not-an-array" },
    { type: "not-a-real-type", facts: [] },
    "a bare string",
    null,
    { type: "op", from: "peer-b", facts: [{ subject: "", predicate: "", object: "" }] },
  ]) {
    network.injectTo(aliceTransports[0], junk);
  }
  await settle();

  assert.equal((await rowsOf(alice.memoryDir)).length, before);
  assert.equal(alice.room.state, "connected");
  assert.ok(alice.room.droppedMessages >= 5, "each unusable message is counted as dropped");
});

test("an introduction offer carrying an unusable sdp is dropped rather than crashing the room", async () => {
  const network = createFakeNetwork();
  const aliceTransports = [];
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", capture: aliceTransports });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  const before = alice.room.droppedMessages;
  network.injectTo(aliceTransports[0], {
    type: "intro-offer",
    from: "peer-ghost",
    to: "peer-a",
    sdp: "an-sdp-no-transport-will-ever-recognise",
  });
  await settle();

  assert.equal(alice.room.droppedMessages, before + 1);
  assert.equal(alice.room.state, "connected");
});

test("an incoming fact the sync filter rejects is not merged", async () => {
  const network = createFakeNetwork();
  const aliceTransports = [];
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", capture: aliceTransports });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  network.injectTo(aliceTransports[0], {
    type: "op",
    from: "peer-b",
    facts: [{ subject: "sneaky", predicate: "mgx:isA", object: "corpus-row", provenance: "corpus:conceptnet /r/IsA" }],
  });
  await settle();

  assert.equal(findRow(await rowsOf(alice.memoryDir), "sneaky", "mgx:isA"), undefined);
});

test("a garbage invite blob surfaces a named problem instead of throwing", async () => {
  const network = createFakeNetwork();
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });

  const result = await bob.room.acceptInvite("this-is-not-a-blob!!!");
  assert.ok(result.error, "a decode failure returns a named problem");
  assert.ok(result.message.length > 0);
  assert.equal(bob.room.lastError.error, result.error);
  assert.equal(bob.room.state, "idle");
});

test("an invite pasted into the reply box, and a reply with no invite waiting, each name their own problem", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });

  const orphan = await alice.room.completeInvite("anything at all");
  assert.equal(orphan.error, "no-pending-invite");

  const invite = await alice.room.startSharing();
  const wrongWay = await alice.room.completeInvite(invite.blob);
  assert.equal(wrongWay.error, "wrong-kind");
  assert.match(wrongWay.message, /invite, not a reply/);
});

test("an invite for a different world is refused by name rather than answered", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const outsider = createP2pRoom({
    memoryDir: createInMemoryStore(),
    myPeerId: "peer-x",
    myDisplayName: "distant-heather",
    worldId: "world-somewhere-else",
    worldName: "somewhere else",
    transportFactory: network.createTransport,
    syncableFacts: chatSyncableFacts,
  });

  const invite = await alice.room.startSharing();
  const refused = await outsider.acceptInvite(invite.blob);
  assert.equal(refused.error, "wrong-world");
  assert.equal(refused.worldName, WORLD_NAME);
});

test("a third peer joining through the second ends up directly connected to the first", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  const carol = makeRoom(network, { peerId: "peer-c", displayName: "pale-thistle" });

  await connect(alice.room, bob.room);
  await connect(bob.room, carol.room);
  await settle();

  const connectedIds = (room) => room.peers().filter((p) => p.connected).map((p) => p.peerId).sort();
  assert.deepEqual(connectedIds(alice.room), ["peer-b", "peer-c"]);
  assert.deepEqual(connectedIds(bob.room), ["peer-a", "peer-c"]);
  assert.deepEqual(connectedIds(carol.room), ["peer-a", "peer-b"]);
});

test("a fact taught after the mesh completes reaches all three peers", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  const carol = makeRoom(network, { peerId: "peer-c", displayName: "pale-thistle" });

  await connect(alice.room, bob.room);
  await connect(bob.room, carol.room);
  await settle();

  await appendFacts(carol.memoryDir, [teachFact("heron", "mgx:isA", "bird", "sess-c", "2026-05-02T09:00:00.000Z")]);
  await carol.room.afterLocalChange();
  await settle();

  for (const peer of [alice, bob]) {
    const row = findRow(await rowsOf(peer.memoryDir), "heron", "mgx:isA");
    assert.ok(row, "the fact reached every peer in the mesh");
    assert.equal(row.object, "bird");
    assert.match(row.provenance, /^teach:peer:pale-thistle#node:[0-9a-f]{16}@/);
  }
});

test("a wave merged from a peer reads as recent, and stops reading as recent once its window passes", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await alice.room.wave("badger-1", "sett-1");
  await settle();
  await bob.room.refresh();

  assert.equal(bob.room.isWaving("badger-1"), true);
  assert.equal(bob.room.isWaving("badger-1", Date.now() + 60_000), false);
  assert.equal(bob.room.isWaving("otter-2"), false);
});

test("a room-less wave lands on the presence scope so it still replicates", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await alice.room.wave("peer:peer-a", null);
  await settle();

  const row = findRow(await rowsOf(bob.memoryDir), normFactTerm("peer:peer-a"), WAVED_PREDICATE);
  assert.ok(row);
  assert.equal(row.object, PRESENCE_SCOPE);
  await bob.room.refresh();
  assert.equal(bob.room.isWaving("peer:peer-a"), true);
});

test("claiming a node name writes a fact the peer reads back as that peer's display name", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await alice.room.setMyDisplayName("quiet-bracken");
  await settle();
  await bob.room.refresh();

  assert.equal(alice.room.displayName, "quiet-bracken");
  assert.equal(bob.room.displayNameFor("peer-a"), "quiet-bracken");
  assert.equal(bob.room.displayNameFor("peer-nobody"), "peer-nob");
});

test("merging leaves both peers' Fact individuals in the same deterministic id order", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await appendFacts(alice.memoryDir, [
    teachFact("zebra", "mgx:isA", "animal", "sess-a", "2026-05-01T10:00:00.000Z"),
    teachFact("apple", "mgx:isA", "fruit", "sess-a", "2026-05-01T10:00:01.000Z"),
    teachFact("moth", "mgx:isA", "insect", "sess-a", "2026-05-01T10:00:02.000Z"),
  ]);
  await alice.room.afterLocalChange();
  await settle();

  const factIds = async (memoryDir) => (await loadMemory(memoryDir)).individuals
    .filter((i) => i?.class === FACT_CLASS)
    .map((i) => i.id);

  const bobIds = await factIds(bob.memoryDir);
  assert.ok(bobIds.length >= 3);
  assert.deepEqual(bobIds, [...bobIds].sort());
});

test("a peer whose channel closes stays in the list marked away", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  bob.room.close();
  await settle();

  assert.deepEqual(alice.room.peers(), [{ peerId: "peer-b", displayName: "mossy-acorn", connected: false }]);
});

test("rebind swaps the store under a live room: peers stay connected, the baseline is rebuilt, and both sides converge on the new store", async () => {
  const network = createFakeNetwork();
  const aliceTransports = [];
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", capture: aliceTransports });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await alice.room.afterLocalChange();
  await settle();

  const freshDir = createInMemoryStore();
  const outcome = await alice.room.rebind({ memoryDir: freshDir, worldName: "mossy hollow ii", myDisplayName: "amber-fox" });
  await settle();

  assert.equal(outcome.peers, 1, "the rebind found its connected peer");
  assert.equal(alice.room.worldName, "mossy hollow ii", "the room now reports the name it was re-bound with");
  assert.deepEqual(alice.room.peers(), [{ peerId: "peer-b", displayName: "mossy-acorn", connected: true }],
    "the peer map survives the rebind untouched");
  assert.deepEqual(bob.room.peers(), [{ peerId: "peer-a", displayName: "amber-fox", connected: true }]);
  for (const transport of aliceTransports) {
    assert.equal(transport.connectionState, "connected", "no transport is closed by a rebind — that is the whole point versus close()");
  }

  const renamed = (await rowsOf(bob.memoryDir))
    .filter((r) => r.predicate === "mgx:worldName")
    .some((r) => r.object === "mossy hollow ii");
  assert.ok(renamed, "the rebind pushed the new store's identity facts to the peer as an ordinary op");

  const pulledBack = findRow(await rowsOf(freshDir), "rover", "mgx:isA");
  assert.ok(pulledBack, "the rebind's sync-request pulled the peer's view into the fresh store, so the two converge again");

  const idle = await alice.room.afterLocalChange();
  assert.equal(idle.broadcast, 0, "nothing from the OLD store's baseline leaks into a diff against the new one");

  await appendFacts(freshDir, [teachFact("wren", "mgx:isA", "bird", "sess-a2", "2026-05-01T11:00:00.000Z")]);
  const sent = await alice.room.afterLocalChange();
  assert.ok(sent.broadcast >= 1, "a change to the NEW store diffs and broadcasts");
  await settle();
  assert.ok(findRow(await rowsOf(bob.memoryDir), "wren", "mgx:isA"), "and the peer merges it");
});

test("a write racing a rebind lands in the store the rebind installed, never half in each", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  const freshDir = createInMemoryStore();
  const rebinding = alice.room.rebind({ memoryDir: freshDir });
  const waving = alice.room.wave("badger-1", "sett-1");
  await rebinding;
  await waving;
  await settle();

  assert.ok(findRow(await rowsOf(freshDir), "badger-1", WAVED_PREDICATE),
    "the wave queued behind the in-flight rebind and wrote to the new store");
  assert.equal(findRow(await rowsOf(alice.memoryDir), "badger-1", WAVED_PREDICATE), undefined,
    "nothing of it leaked into the store the room just left");
  assert.ok(findRow(await rowsOf(bob.memoryDir), "badger-1", WAVED_PREDICATE),
    "and it still broadcast to the peer");
});

test("a closed room refuses to rebind, and a rebind without a store refuses by name", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  await assert.rejects(() => alice.room.rebind({}), /needs the store/);
  alice.room.close();
  await assert.rejects(() => alice.room.rebind({ memoryDir: createInMemoryStore() }), /closed/);
});

test("a joiner picks up the facts already in the room through sync, not only live ops", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });

  await alice.room.start();
  await appendFacts(alice.memoryDir, [teachFact("wren", "mgx:isA", "bird", "sess-a", "2026-04-01T08:00:00.000Z")]);
  await alice.room.afterLocalChange();

  await connect(alice.room, bob.room);
  await settle();

  const row = findRow(await rowsOf(bob.memoryDir), "wren", "mgx:isA");
  assert.ok(row, "a fact taught before anyone connected still reaches a joiner");
  assert.match(row.provenance, /^teach:peer:amber-fox#node:[0-9a-f]{16}@/);
});

// ---- the stable node id ----------------------------------------------------

test("a store mints its node id once and reads back the same one on every later open", async () => {
  const store = createInMemoryStore();
  const first = await resolveStoreNodeId(store);
  assert.match(first, /^[0-9a-f]{16}$/, "16 hex, safe to carry between a tag's own separators");
  assert.equal(await resolveStoreNodeId(store), first, "a second open re-reads rather than re-mints");
});

test("an id a store already holds beats one a caller offers, because re-keying would split one node's history in two", async () => {
  const store = createInMemoryStore();
  const minted = await resolveStoreNodeId(store);
  assert.equal(await resolveStoreNodeId(store, "aaaaaaaaaaaaaaaa"), minted);
});

test("a node id a page carried across a reload seeds a store that has never joined a room", async () => {
  const store = createInMemoryStore();
  assert.equal(await resolveStoreNodeId(store, "6589e595d1fa9a90"), "6589e595d1fa9a90");
});

test("two separate stores never mint the same node id", async () => {
  const ids = new Set();
  for (let i = 0; i < 8; i += 1) ids.add(await resolveStoreNodeId(createInMemoryStore()));
  assert.equal(ids.size, 8);
});

test("a file-backed store keeps its node id across separate opens of the same directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-node-id-"));
  try {
    const first = await resolveStoreNodeId(dir);
    assert.match(first, /^[0-9a-f]{16}$/);
    assert.equal(await resolveStoreNodeId(dir), first, "the id survives on disk, not just in memory");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a room broadcasts under the node id its store already holds rather than minting a second one", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  await resolveStoreNodeId(alice.memoryDir, "7f3a9c2e5b1d4a60");
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await alice.room.afterLocalChange();
  await settle();

  assert.equal(alice.room.nodeId, "7f3a9c2e5b1d4a60");
  const merged = findRow(await rowsOf(bob.memoryDir), "rover", "mgx:isA");
  assert.equal(merged.provenance, "teach:peer:amber-fox#node:7f3a9c2e5b1d4a60@2026-05-01T10:00:00.000Z");
});

test("a relayed fact keeps the originating node's id through a second hop, never the relayer's", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: "7f3a9c2e5b1d4a60" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: "6589e595d1fa9a90" });
  const carol = makeRoom(network, { peerId: "peer-c", displayName: "pale-thistle", nodeId: "defbc7690571a8b6" });

  await connect(alice.room, bob.room);
  await appendFacts(alice.memoryDir, [teachFact("wren", "mgx:isA", "bird", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await alice.room.afterLocalChange();
  await settle();

  // Carol joins through Bob, so the only copy she can get has already been
  // relayed once. An already-labeled tag is left exactly as its author wrote
  // it, node segment and all, or attribution would follow the last hop.
  await connect(bob.room, carol.room);
  await settle();

  const relayed = findRow(await rowsOf(carol.memoryDir), "wren", "mgx:isA");
  assert.ok(relayed, "the fact reached the peer two hops from where it was taught");
  assert.equal(relayed.provenance, "teach:peer:amber-fox#node:7f3a9c2e5b1d4a60@2026-05-01T10:00:00.000Z");
  assert.deepEqual(relayed.sourceIds, ["src:teach-node:7f3a9c2e5b1d4a60"]);
});

test("two peers who chose the same display name stay separate Sources, because the node id is what keys them", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: "7f3a9c2e5b1d4a60" });
  const twin = makeRoom(network, { peerId: "peer-b", displayName: "amber-fox", nodeId: "6589e595d1fa9a90" });
  const bob = makeRoom(network, { peerId: "peer-c", displayName: "mossy-acorn" });

  await connect(alice.room, bob.room);
  await connect(twin.room, bob.room);

  await appendFacts(alice.memoryDir, [teachFact("wren", "mgx:isA", "bird", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await alice.room.afterLocalChange();
  await appendFacts(twin.memoryDir, [teachFact("wren", "mgx:isA", "bird", "sess-b", "2026-05-01T11:00:00.000Z")]);
  await twin.room.afterLocalChange();
  await settle();

  const row = findRow(await rowsOf(bob.memoryDir), "wren", "mgx:isA");
  assert.deepEqual(
    [...row.sourceIds].sort(),
    ["src:teach-node:6589e595d1fa9a90", "src:teach-node:7f3a9c2e5b1d4a60"],
    "one shared name, two nodes, two Sources",
  );
});

const ALICE_NODE = "7f3a9c2e5b1d4a60";
const BOB_NODE = "6589e595d1fa9a90";
const CAROL_NODE = "b21c4d0e77a35f18";

const inviteEdges = (rows) => rows.filter((r) => r.predicate === INVITED_BY_PREDICATE);
const nodeSubject = (nodeId) => normFactTerm(nodeTerm(nodeId));

test("joining through an invite records who admitted whom, once, on the joiner's own store", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });

  await connect(alice.room, bob.room);

  const edges = inviteEdges(await rowsOf(bob.memoryDir));
  assert.equal(edges.length, 1, "exactly one admission edge per join");
  assert.equal(edges[0].subject, nodeSubject(BOB_NODE), "the joiner is the subject");
  assert.equal(edges[0].object, nodeSubject(ALICE_NODE), "the node that sent the invite is the object");
});

test("the invite edge reaches the inviter, so an admission is visible from both sides of the mesh", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });

  await connect(alice.room, bob.room);
  await bob.room.afterLocalChange();
  await settle();

  const edges = inviteEdges(await rowsOf(alice.memoryDir));
  assert.equal(edges.length, 1);
  assert.equal(edges[0].subject, nodeSubject(BOB_NODE));
  assert.equal(edges[0].object, nodeSubject(ALICE_NODE));
});

test("a second invite from the same inviter adds no second edge — the admission already happened", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });

  await connect(alice.room, bob.room);
  await connect(alice.room, bob.room);

  assert.equal(inviteEdges(await rowsOf(bob.memoryDir)).length, 1);
});

test("each joiner records its own inviter, so a chain of invites reads as a chain of edges", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });
  const carol = makeRoom(network, { peerId: "peer-c", displayName: "slate-heron", nodeId: CAROL_NODE });

  await connect(alice.room, bob.room);
  await connect(bob.room, carol.room);

  const own = inviteEdges(await rowsOf(carol.memoryDir)).find((r) => r.subject === nodeSubject(CAROL_NODE));
  assert.ok(own, "carol recorded her own admission");
  assert.equal(own.object, nodeSubject(BOB_NODE), "bob let carol in, not alice");
});

test("an invite carrying no node id still joins, and records no edge it cannot name", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });

  const invite = await alice.room.startSharing();
  const nodelessBlob = encodeInviteBlob({
    kind: "offer",
    sdp: decodeInviteBlob(invite.blob).value.sdp,
    world: WORLD_ID,
    worldName: WORLD_NAME,
  });
  const reply = await bob.room.acceptInvite(nodelessBlob);
  assert.equal(reply.error, undefined, "the join itself still works");
  assert.deepEqual(inviteEdges(await rowsOf(bob.memoryDir)), []);
});

// ---- retraction over the mesh ----------------------------------------------

const retractionsOf = async (memoryDir) => readRetractions(await loadMemory(memoryDir));

test("a retraction reaches the peer holding the copy, and the fact stops reading on both sides", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  const { ids } = await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await alice.room.afterLocalChange();
  await settle();
  assert.ok(findRow(await rowsOf(bob.memoryDir), "rover", "mgx:isA"), "the peer took the fact first");

  await removeFacts(alice.memoryDir, [ids[0]], { retractedAt: "2026-05-02T10:00:00.000Z" });
  await alice.room.afterLocalChange();
  await settle();

  assert.equal(findRow(await rowsOf(alice.memoryDir), "rover", "mgx:isA"), undefined);
  assert.equal(findRow(await rowsOf(bob.memoryDir), "rover", "mgx:isA"), undefined, "the retraction crossed the wire");
  assert.equal((await retractionsOf(bob.memoryDir)).length, 1, "and it is on record there, not just applied");
});

test("a retraction and the copy it suppresses converge whichever one arrives first", async () => {
  const fact = teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z");

  // The two messages one peer actually broadcasts, captured once, so the orders
  // below replay the same pair rather than two look-alikes.
  const sent = createFakeNetwork();
  const origin = makeRoom(sent, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
  const witness = makeRoom(sent, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });
  await connect(origin.room, witness.room);
  const { ids } = await appendFacts(origin.memoryDir, [fact]);
  await origin.room.afterLocalChange();
  await settle();
  await removeFacts(origin.memoryDir, [ids[0]], { retractedAt: "2026-05-02T10:00:00.000Z" });
  await origin.room.afterLocalChange();
  await settle();
  const broadcastFacts = sent.log
    .filter((m) => m.type === "op" && m.from === "peer-a")
    .flatMap((m) => m.facts);
  const assertion = broadcastFacts.filter((f) => f.predicate === "mgx:isA");
  const retraction = broadcastFacts.filter((f) => f.predicate === RETRACTION_PREDICATE);
  assert.equal(assertion.length, 1);
  assert.equal(retraction.length, 1);

  const bobAfter = async (order) => {
    const network = createFakeNetwork();
    const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
    const bobTransports = [];
    const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", capture: bobTransports });
    await connect(alice.room, bob.room);
    for (const facts of order) {
      network.injectTo(bobTransports[0], { type: "op", from: "peer-a", facts });
      await settle();
    }
    return bob.memoryDir;
  };

  const factFirst = await bobAfter([assertion, retraction]);
  const retractionFirst = await bobAfter([retraction, assertion]);

  assert.equal(findRow(await rowsOf(factFirst), "rover", "mgx:isA"), undefined,
    "a retraction landing after the copy still takes it out of the read");
  assert.equal(findRow(await rowsOf(retractionFirst), "rover", "mgx:isA"), undefined,
    "and one landing first refuses to let the copy in");
  assert.deepEqual(
    (await retractionsOf(factFirst)).map((r) => r.object),
    (await retractionsOf(retractionFirst)).map((r) => r.object),
    "both orders leave the same record behind",
  );
});

test("a peer that never saw the retraction re-sends the fact, and it does not come back", async () => {
  const network = createFakeNetwork();
  const aliceTransports = [];
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", capture: aliceTransports });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });
  await connect(alice.room, bob.room);

  const fact = teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z");
  const { ids } = await appendFacts(alice.memoryDir, [fact]);
  await removeFacts(alice.memoryDir, [ids[0]], { retractedAt: "2026-05-02T10:00:00.000Z" });
  await alice.room.refresh();

  network.injectTo(aliceTransports[0], { type: "op", from: "peer-b", facts: [fact] });
  await settle();

  assert.equal(findRow(await rowsOf(alice.memoryDir), "rover", "mgx:isA"), undefined);
});

test("a joiner still holding the copy learns the retraction through sync, and its own sync does not put the fact back", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });
  await alice.room.start();

  const { ids } = await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await removeFacts(alice.memoryDir, [ids[0]], { retractedAt: "2026-05-02T10:00:00.000Z" });
  // What bob would be left holding from an earlier session: alice's assertion
  // under the tag her broadcast relabels it to, which is a different Source key
  // from the one her own store files it under.
  await appendFacts(bob.memoryDir, [{
    subject: "rover", predicate: "mgx:isA", object: "dog",
    provenance: `teach:peer:amber-fox#node:${ALICE_NODE}@2026-05-01T10:00:00.000Z`,
  }]);
  assert.ok(findRow(await rowsOf(bob.memoryDir), "rover", "mgx:isA"), "bob starts out still holding it");

  await connect(alice.room, bob.room);
  await settle();

  assert.equal((await retractionsOf(bob.memoryDir)).length, 1, "the sync response carried the retraction");
  assert.equal(findRow(await rowsOf(bob.memoryDir), "rover", "mgx:isA"), undefined);
  assert.equal(findRow(await rowsOf(alice.memoryDir), "rover", "mgx:isA"), undefined,
    "and the copy did not ride back in on the joiner's own sync");
});

test("one peer's retraction leaves a fact another peer taught for itself standing, cited to that peer", async () => {
  const network = createFakeNetwork();
  const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox" });
  const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn" });

  const { ids } = await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
  await removeFacts(alice.memoryDir, [ids[0]], { retractedAt: "2026-05-02T10:00:00.000Z" });
  await appendFacts(bob.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-b", "2026-05-01T10:00:00.000Z")]);

  await connect(alice.room, bob.room);
  await settle();

  const onAlice = findRow(await rowsOf(alice.memoryDir), "rover", "mgx:isA");
  assert.ok(onAlice, "one source retracting is not the group agreeing");
  assert.ok(findRow(await rowsOf(bob.memoryDir), "rover", "mgx:isA"));
  assert.match(onAlice.provenance, /mossy-acorn/, "it stands on the peer that still asserts it");
  assert.equal(onAlice.provenance.includes("sess-a"), false, "and the retracted assertion did not come back");
});

// ---- retiring a tombstone ---------------------------------------------------

const tombstoneIdsOf = async (memoryDir) => (await retractionsOf(memoryDir)).map((r) => r.id);

test("two peers that retracted together agree on the roster and on retiring nothing, whichever of them invited", async () => {
  const meshAfterRetraction = async (inviterFirst) => {
    const network = createFakeNetwork();
    const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE });
    const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });
    if (inviterFirst) await connect(alice.room, bob.room);
    else await connect(bob.room, alice.room);
    await alice.room.afterLocalChange();
    await bob.room.afterLocalChange();
    await settle();

    const { ids } = await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
    await alice.room.afterLocalChange();
    await settle();
    await removeFacts(alice.memoryDir, [ids[0]], { retractedAt: "2026-05-02T10:00:00.000Z" });
    await alice.room.afterLocalChange();
    await settle();
    return { alice, bob };
  };

  for (const inviterFirst of [true, false]) {
    const { alice, bob } = await meshAfterRetraction(inviterFirst);
    const bothNodes = [ALICE_NODE, BOB_NODE].sort();
    assert.deepEqual(admittedNodes(await rowsOf(alice.memoryDir)), bothNodes, "the admission graph crossed the wire");
    assert.deepEqual(admittedNodes(await rowsOf(bob.memoryDir)), bothNodes, "and both peers read the same roster");

    assert.equal((await tombstoneIdsOf(alice.memoryDir)).length, 1);
    assert.deepEqual(await tombstoneIdsOf(alice.memoryDir), await tombstoneIdsOf(bob.memoryDir),
      "the tombstone converged");
    for (const [store, self] of [[alice.memoryDir, ALICE_NODE], [bob.memoryDir, BOB_NODE]]) {
      assert.deepEqual(retirableRetractions(await loadMemory(store), { self }).retirable, [],
        "and nothing tells either of them a peer has it, so neither retires anything");
    }
  }
});

test("a peer admitted long ago and away since keeps a tombstone standing, and retiring it anyway lets its copy back in", async () => {
  // Alice's own broadcast tag for the fact — what a peer who took it from her
  // still holds, and what it re-sends when it comes back.
  const aliceTag = `teach:peer:amber-fox#node:${ALICE_NODE}@2026-05-01T10:00:00.000Z`;
  const staleCopy = { subject: "rover", predicate: "mgx:isA", object: "dog", provenance: aliceTag };

  const afterCarolRejoins = async ({ retireFirst }) => {
    const network = createFakeNetwork();
    const aliceTransports = [];
    const alice = makeRoom(network, { peerId: "peer-a", displayName: "amber-fox", nodeId: ALICE_NODE, capture: aliceTransports });
    const bob = makeRoom(network, { peerId: "peer-b", displayName: "mossy-acorn", nodeId: BOB_NODE });
    await connect(alice.room, bob.room);
    await bob.room.afterLocalChange();
    await settle();
    // Carol joined once, took a copy, and has not been seen since. Her
    // admission is on record; her acknowledgement of anything later is not.
    await appendFacts(alice.memoryDir, [invitedByFact(CAROL_NODE, ALICE_NODE, "2026-04-01T10:00:00.000Z")]);

    const { ids } = await appendFacts(alice.memoryDir, [teachFact("rover", "mgx:isA", "dog", "sess-a", "2026-05-01T10:00:00.000Z")]);
    await alice.room.afterLocalChange();
    await settle();
    await removeFacts(alice.memoryDir, [ids[0]], { retractedAt: "2026-05-02T10:00:00.000Z" });
    await alice.room.afterLocalChange();
    await settle();

    const tombstones = await tombstoneIdsOf(alice.memoryDir);
    assert.equal(tombstones.length, 1);
    const report = retirableRetractions(await loadMemory(alice.memoryDir), {
      self: ALICE_NODE,
      acknowledgedBy: (node) => (node === BOB_NODE ? tombstones : []),
    });
    assert.deepEqual(report.roster, [ALICE_NODE, BOB_NODE, CAROL_NODE].sort(), "carol is still a member");
    assert.deepEqual(report.retirable, [],
      "and a peer who has acknowledged nothing blocks the retirement, however long it has been away");

    if (retireFirst) await retireRetractions(alice.memoryDir, tombstones);
    network.injectTo(aliceTransports[0], { type: "op", from: "peer-c", facts: [staleCopy] });
    await settle();
    return findRow(await rowsOf(alice.memoryDir), "rover", "mgx:isA");
  };

  assert.equal(await afterCarolRejoins({ retireFirst: false }), undefined,
    "the tombstone that stayed put refuses the copy carol never stopped holding");
  assert.ok(await afterCarolRejoins({ retireFirst: true }),
    "and the same rejoin resurrects the retracted fact once the tombstone is gone");
});
