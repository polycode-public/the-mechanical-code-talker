import test from "node:test";
import assert from "node:assert/strict";
import {
  encodeInviteBlob, decodeInviteBlob,
  helloMessage, peerListMessage, introOfferMessage, introAnswerMessage,
  syncRequestMessage, syncResponseMessage, opMessage,
  isValidRoomMessage,
} from "../../../src/domain/p2p/wire.mjs";

test("an offer blob round-trips through encode/decode with every field intact", () => {
  const blob = encodeInviteBlob({ kind: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 0.0.0.0", world: "world-1", worldName: "amber-fox" });
  assert.doesNotMatch(blob, /[+/=]/, "the blob is URL-safe base64url, not raw base64");
  const decoded = decodeInviteBlob(blob);
  assert.deepEqual(decoded, { value: { v: 1, kind: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 0.0.0.0", world: "world-1", worldName: "amber-fox" } });
});

test("a reply blob carries only the answer sdp, no world fields required", () => {
  const blob = encodeInviteBlob({ kind: "reply", sdp: "v=0\r\no=- 9 9 IN IP4 0.0.0.0" });
  const decoded = decodeInviteBlob(blob);
  assert.equal(decoded.value.kind, "reply");
  assert.equal(decoded.value.sdp, "v=0\r\no=- 9 9 IN IP4 0.0.0.0");
});

test("a truncated blob decodes to a specific, named error rather than throwing", () => {
  const blob = encodeInviteBlob({ kind: "offer", sdp: "real-sdp", world: "w1", worldName: "n1" });
  assert.doesNotThrow(() => decodeInviteBlob(blob.slice(0, 6)));
  const result = decodeInviteBlob(blob.slice(0, 6));
  assert.ok(result.error, "a cut-short blob reports an error, not a value");
});

test("an empty or non-string blob is an 'empty' error, not a crash", () => {
  assert.deepEqual(decodeInviteBlob(""), { error: "empty" });
  assert.deepEqual(decodeInviteBlob(undefined), { error: "empty" });
  assert.deepEqual(decodeInviteBlob(null), { error: "empty" });
});

test("a reply pasted where an offer was expected still decodes — the caller checks kind", () => {
  const replyBlob = encodeInviteBlob({ kind: "reply", sdp: "answer-sdp" });
  const decoded = decodeInviteBlob(replyBlob);
  assert.equal(decoded.value.kind, "reply");
  assert.equal(decoded.value.world, undefined, "a reply never carries a world id to be mistaken for an offer's");
});

test("encodeInviteBlob refuses an unknown kind or a missing sdp", () => {
  assert.throws(() => encodeInviteBlob({ kind: "bogus", sdp: "x" }));
  assert.throws(() => encodeInviteBlob({ kind: "offer", world: "w", worldName: "n" }));
});

test("every message constructor produces a shape isValidRoomMessage accepts", () => {
  const messages = [
    helloMessage({ peerId: "p1", displayName: "amber-fox" }),
    peerListMessage({ peers: [{ peerId: "p2", displayName: "mossy-acorn" }] }),
    introOfferMessage({ from: "p1", to: "p3", sdp: "offer-sdp" }),
    introAnswerMessage({ from: "p3", to: "p1", sdp: "answer-sdp" }),
    syncRequestMessage(),
    syncResponseMessage({ facts: [{ subject: "a", predicate: "b", object: "c" }] }),
    opMessage({ from: "p1", facts: [] }),
  ];
  for (const msg of messages) assert.ok(isValidRoomMessage(msg), `${msg.type} should validate`);
});

test("isValidRoomMessage rejects an unknown type, a missing field, and non-objects", () => {
  assert.equal(isValidRoomMessage(null), false);
  assert.equal(isValidRoomMessage("hello"), false);
  assert.equal(isValidRoomMessage({ type: "not-a-real-type" }), false);
  assert.equal(isValidRoomMessage({ type: "hello", peerId: "p1" }), false, "hello needs a displayName too");
  assert.equal(isValidRoomMessage({ type: "op", facts: [] }), false, "op needs a from");
  assert.equal(isValidRoomMessage({ type: "peer-list", peers: [{ peerId: "p1" }] }), false, "each peer needs a displayName");
});
