// domain/p2p/wire.mjs — pure message shapes and blob encoding for the P2P
// layer. Two kinds of payload: an "invite blob" carried in a URL or pasted
// by hand (a base64url-encoded JSON envelope holding one SDP string), and
// plain JSON messages sent over an already-open DataChannel. Nothing here
// touches the network or WebRTC itself — src/adapters/p2p/webrtc-transport.mjs
// owns the connection, src/services/p2p-room.mjs owns what these messages mean.

const INVITE_KINDS = new Set(["offer", "reply"]);

function toBase64Url(str) {
  const b64 = typeof btoa === "function" ? btoa(str) : Buffer.from(str, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
}

/** Encode one invite envelope — an offer (from the sharer) or a reply (from
 *  the joiner) — into a URL-safe string. An offer carries the world id and
 *  name so a fresh joiner can be shown them before connecting; a reply only
 *  needs to carry the answer SDP back to the inviter. */
export function encodeInviteBlob({ kind, sdp, world, worldName }) {
  if (!INVITE_KINDS.has(kind)) throw new Error(`encodeInviteBlob: unknown kind "${kind}"`);
  if (typeof sdp !== "string" || !sdp) throw new Error("encodeInviteBlob: sdp is required");
  const envelope = kind === "offer" ? { v: 1, kind, sdp, world, worldName } : { v: 1, kind, sdp };
  return toBase64Url(JSON.stringify(envelope));
}

/** Decode a blob produced by encodeInviteBlob. Never throws — a malformed,
 *  truncated, or foreign-shaped blob returns { error } instead, so the UI can
 *  show a specific message ("this invite looks cut short") rather than an
 *  uncaught exception or a silent no-op. */
export function decodeInviteBlob(blobString) {
  if (typeof blobString !== "string" || !blobString.trim()) return { error: "empty" };
  let json;
  try {
    json = fromBase64Url(blobString.trim());
  } catch {
    return { error: "truncated" };
  }
  let envelope;
  try {
    envelope = JSON.parse(json);
  } catch {
    return { error: "truncated" };
  }
  if (!envelope || typeof envelope !== "object") return { error: "malformed" };
  if (envelope.v !== 1) return { error: "unsupported-version" };
  if (!INVITE_KINDS.has(envelope.kind)) return { error: "malformed" };
  if (typeof envelope.sdp !== "string" || !envelope.sdp) return { error: "malformed" };
  if (envelope.kind === "offer" && (typeof envelope.world !== "string" || !envelope.world)) {
    return { error: "malformed" };
  }
  return { value: envelope };
}

const ROOM_MESSAGE_TYPES = new Set([
  "hello",
  "peer-list",
  "intro-offer",
  "intro-answer",
  "sync-request",
  "sync-response",
  "op",
]);

export function helloMessage({ peerId, displayName }) {
  return { type: "hello", peerId, displayName };
}

export function peerListMessage({ peers }) {
  return { type: "peer-list", peers };
}

export function introOfferMessage({ from, to, sdp }) {
  return { type: "intro-offer", from, to, sdp };
}

export function introAnswerMessage({ from, to, sdp }) {
  return { type: "intro-answer", from, to, sdp };
}

export function syncRequestMessage() {
  return { type: "sync-request" };
}

export function syncResponseMessage({ facts }) {
  return { type: "sync-response", facts };
}

export function opMessage({ from, facts }) {
  return { type: "op", from, facts };
}

/** Structural validation only — the front door for anything a peer sends
 *  over an open channel. Returns true/false rather than throwing, so a room
 *  can drop a malformed message from a misbehaving or out-of-date peer
 *  instead of crashing on it. */
export function isValidRoomMessage(msg) {
  if (!msg || typeof msg !== "object" || !ROOM_MESSAGE_TYPES.has(msg.type)) return false;
  switch (msg.type) {
    case "hello":
      return typeof msg.peerId === "string" && msg.peerId.length > 0 && typeof msg.displayName === "string";
    case "peer-list":
      return Array.isArray(msg.peers)
        && msg.peers.every((p) => p && typeof p.peerId === "string" && typeof p.displayName === "string");
    case "intro-offer":
    case "intro-answer":
      return typeof msg.from === "string" && typeof msg.to === "string"
        && typeof msg.sdp === "string" && msg.sdp.length > 0;
    case "sync-request":
      return true;
    case "sync-response":
      return Array.isArray(msg.facts);
    case "op":
      return typeof msg.from === "string" && Array.isArray(msg.facts);
    default:
      return false;
  }
}
