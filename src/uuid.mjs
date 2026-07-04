// uuid.mjs — RFC 9562 UUIDv7 (node:crypto ships v4 only). Lifted verbatim from
// chat.mjs so the chat session id, the telemetry invocation id, and the bench
// per-run stamp all share ONE time-sortable implementation (no second copy, no dep).

import { randomBytes } from "node:crypto";

/** UUID v7 (RFC 9562): 48-bit big-endian unix-ms timestamp, then version/variant
 *  bits over crypto-random tail — time-sortable, unlike crypto.randomUUID()'s v4. */
export function uuidv7(now = Date.now()) {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6); // 48-bit unix-ms timestamp, big-endian
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
