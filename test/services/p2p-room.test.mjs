import test from "node:test";
import assert from "node:assert/strict";
import { createP2pRoom, PRESENCE_SCOPE } from "../../src/services/p2p-room.mjs";
import { chatSyncableFacts } from "../../src/domain/p2p/sync-filter.mjs";
import { decodeInviteBlob } from "../../src/domain/p2p/wire.mjs";
import { WAVED_PREDICATE } from "../../src/domain/p2p/facts.mjs";
import { createInMemoryStore, appendFacts, loadMemory, readFactRows, normFactTerm, FACT_CLASS } from "../../src/adapters/memory/core.mjs";

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

function makeRoom(network, { peerId, displayName, capture }) {
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
  assert.match(merged.provenance, /^teach:peer:amber-fox@/);

  const aliceRows = await rowsOf(alice.memoryDir);
  assert.equal(findRow(aliceRows, "rover", "mgx:isA").provenance, "teach:chat:sess-a@2026-05-01T10:00:00.000Z");
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
    assert.match(row.provenance, /^teach:peer:pale-thistle@/);
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
  assert.match(row.provenance, /^teach:peer:amber-fox@/);
});
