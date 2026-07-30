// The transport's own contract, driven against a scripted RTCPeerConnection so
// every branch a real handshake reaches only by luck — a frame that isn't
// JSON, a send before the channel opens, a second close, a handler registered
// after the event it wants — is reachable on demand. The real offer/answer
// exchange between two browsers is proven in test-e2e/p2p-webrtc-handshake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTransport, DEFAULT_ICE_SERVERS } from "../../src/adapters/p2p/webrtc-transport.mjs";

class ScriptedDataChannel extends EventTarget {
  constructor(label) {
    super();
    this.label = label;
    this.readyState = "connecting";
    this.sent = [];
  }

  send(payload) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = "closed";
    this.dispatchEvent(new Event("close"));
  }

  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }

  deliver(data) {
    const event = new Event("message");
    event.data = data;
    this.dispatchEvent(event);
  }
}

class ScriptedPeerConnection extends EventTarget {
  constructor(config) {
    super();
    this.config = config;
    this.iceGatheringState = "new";
    this.connectionState = "new";
    this.localDescription = null;
    this.remoteDescription = null;
    this.channel = null;
    this.closeCalls = 0;
  }

  createDataChannel(label) {
    this.channel = new ScriptedDataChannel(label);
    return this.channel;
  }

  async createOffer() {
    return { type: "offer", sdp: "v=0 offer-sdp" };
  }

  async createAnswer() {
    return { type: "answer", sdp: "v=0 answer-sdp" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  close() {
    this.closeCalls += 1;
    this.connectionState = "closed";
  }

  finishGathering() {
    this.iceGatheringState = "complete";
    this.dispatchEvent(new Event("icegatheringstatechange"));
  }

  enterConnectionState(state) {
    this.connectionState = state;
    this.dispatchEvent(new Event("connectionstatechange"));
  }

  receiveDataChannel(channel) {
    const event = new Event("datachannel");
    event.channel = channel;
    this.dispatchEvent(event);
  }
}

/** Build a transport over a scripted connection, and hand back both. */
function scriptedTransport(options) {
  const built = [];
  const previous = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class extends ScriptedPeerConnection {
    constructor(config) {
      super(config);
      built.push(this);
    }
  };
  try {
    const transport = createTransport(options);
    return { transport, connection: built[0] };
  } finally {
    globalThis.RTCPeerConnection = previous;
  }
}

/** Let every already-queued microtask and timer callback run. */
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("the factory returns every method the room layer calls, with connectionState as a live property", () => {
  const { transport, connection } = scriptedTransport();
  for (const method of ["createOffer", "createAnswerFor", "completeWithAnswer", "send", "onMessage", "onOpen", "onClose", "close"]) {
    assert.equal(typeof transport[method], "function", `${method} is on the contract`);
  }
  assert.equal(transport.connectionState, "new", "connectionState reads as a value, not a method");
  connection.enterConnectionState("connecting");
  assert.equal(transport.connectionState, "connecting", "it tracks the connection rather than snapshotting it");
});

test("an absent RTCPeerConnection fails at construction with a message naming the reason", () => {
  const previous = globalThis.RTCPeerConnection;
  delete globalThis.RTCPeerConnection;
  try {
    assert.throws(() => createTransport(), /RTCPeerConnection/);
  } finally {
    if (previous) globalThis.RTCPeerConnection = previous;
  }
});

test("a caller who doesn't choose ICE servers gets the module's default public STUN list, not an empty one", () => {
  assert.deepEqual(scriptedTransport().connection.config, { iceServers: DEFAULT_ICE_SERVERS });
  const chosen = [{ urls: "stun:example.invalid" }];
  assert.deepEqual(scriptedTransport({ iceServers: chosen }).connection.config, { iceServers: chosen });
  assert.deepEqual(scriptedTransport({ iceServers: [] }).connection.config, { iceServers: [] }, "an explicit empty list is still honored, e.g. for a loopback-only test");
});

test("createOffer holds the SDP back until ICE gathering completes", async () => {
  const { transport, connection } = scriptedTransport();
  let resolved = null;
  const pending = transport.createOffer().then((sdp) => {
    resolved = sdp;
  });

  await settle();
  assert.equal(resolved, null, "a half-gathered offer is never handed to the caller");
  assert.equal(connection.channel.label, "tmct", "the offering side creates the channel");

  connection.finishGathering();
  await pending;
  assert.equal(resolved, "v=0 offer-sdp");
});

test("createOffer proceeds with whatever it has if ICE gathering never signals complete", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { transport, connection } = scriptedTransport();
  let resolved = null;
  const pending = transport.createOffer().then((sdp) => {
    resolved = sdp;
  });

  await settle();
  assert.equal(resolved, null, "still waiting before the timeout fires");
  assert.notEqual(connection.iceGatheringState, "complete", "gathering genuinely never completed — a dropped STUN reply, not a fast path");

  t.mock.timers.tick(5000);
  await pending;
  assert.equal(resolved, "v=0 offer-sdp", "a caller waiting on the blob gets one instead of hanging forever");
});

test("createAnswerFor takes the remote offer, waits for gathering, and returns its own SDP", async () => {
  const { transport, connection } = scriptedTransport();
  let resolved = null;
  const pending = transport.createAnswerFor("v=0 their-offer").then((sdp) => {
    resolved = sdp;
  });

  await settle();
  assert.deepEqual(connection.remoteDescription, { type: "offer", sdp: "v=0 their-offer" });
  assert.equal(resolved, null, "the answer waits for gathering too");

  connection.finishGathering();
  await pending;
  assert.equal(resolved, "v=0 answer-sdp");
});

test("completeWithAnswer sets the answer as the remote description", async () => {
  const { transport, connection } = scriptedTransport();
  await transport.completeWithAnswer("v=0 their-answer");
  assert.deepEqual(connection.remoteDescription, { type: "answer", sdp: "v=0 their-answer" });
});

test("the answering side picks up the channel the offering side created", async () => {
  const { transport, connection } = scriptedTransport();
  const opens = [];
  transport.onOpen(() => opens.push("open"));

  const incoming = new ScriptedDataChannel("tmct");
  connection.receiveDataChannel(incoming);
  incoming.open();

  assert.deepEqual(opens, ["open"]);
  transport.send({ hello: "there" });
  assert.deepEqual(incoming.sent, ['{"hello":"there"}']);
});

test("a send before the channel opens throws instead of dropping the message quietly", async () => {
  const { transport, connection } = scriptedTransport();
  assert.throws(() => transport.send({ too: "early" }), /cannot send/i);

  const pending = transport.createOffer();
  connection.finishGathering();
  await pending;
  assert.throws(() => transport.send({ still: "early" }), /connecting/, "a channel that exists but has not opened still refuses");
});

test("every registered message handler sees the parsed value, and a frame that isn't JSON is dropped", async () => {
  const { transport, connection } = scriptedTransport();
  const first = [];
  const second = [];
  transport.onMessage((value) => first.push(value));
  transport.onMessage((value) => second.push(value));

  const pending = transport.createOffer();
  connection.finishGathering();
  await pending;
  connection.channel.open();

  connection.channel.deliver('{"kind":"hello","peerId":"abc"}');
  connection.channel.deliver("not json at all");
  connection.channel.deliver('{"kind":"op"}');

  assert.deepEqual(first, [{ kind: "hello", peerId: "abc" }, { kind: "op" }]);
  assert.deepEqual(second, first, "both handlers see the same messages");
});

test("onOpen and onClose fire once each, and a handler registered afterwards still hears about it", async () => {
  const { transport, connection } = scriptedTransport();
  let opens = 0;
  let closes = 0;
  transport.onOpen(() => (opens += 1));
  transport.onClose(() => (closes += 1));

  const pending = transport.createOffer();
  connection.finishGathering();
  await pending;
  connection.channel.open();
  connection.channel.dispatchEvent(new Event("open"));
  assert.equal(opens, 1, "a repeated open event does not re-announce");

  let lateOpens = 0;
  transport.onOpen(() => (lateOpens += 1));
  assert.equal(lateOpens, 1, "a late onOpen fires immediately on an already-open channel");

  connection.channel.close();
  connection.enterConnectionState("closed");
  assert.equal(closes, 1, "the channel closing and the connection closing announce one close between them");

  let lateCloses = 0;
  transport.onClose(() => (lateCloses += 1));
  assert.equal(lateCloses, 1, "a late onClose fires immediately on an already-closed transport");
});

test("a failed connection announces a close", () => {
  const { transport, connection } = scriptedTransport();
  let closes = 0;
  transport.onClose(() => (closes += 1));
  connection.enterConnectionState("failed");
  assert.equal(closes, 1);
  assert.equal(transport.connectionState, "failed", "the state stays readable after the close handler runs");
});

test("close tears the connection down once and is a no-op the second time", async () => {
  const { transport, connection } = scriptedTransport();
  let closes = 0;
  transport.onClose(() => (closes += 1));

  const pending = transport.createOffer();
  connection.finishGathering();
  await pending;
  connection.channel.open();

  transport.close();
  assert.equal(connection.closeCalls, 1);
  assert.equal(connection.channel.readyState, "closed");
  assert.equal(closes, 1);

  transport.close();
  assert.equal(connection.closeCalls, 1, "the second close does nothing rather than throwing");
  assert.equal(closes, 1);
  assert.equal(transport.connectionState, "closed");
});
