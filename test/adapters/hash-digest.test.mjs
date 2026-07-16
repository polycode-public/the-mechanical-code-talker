// hash.mjs carries its own SHA-256 (browser-safe, dependency-free) because
// answer-variant selection keys on digest bytes, making the digest part of
// the answer-text contract. This suite pins it byte-identical to
// node:crypto's implementation, including every padding boundary.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

import { sha256Bytes } from "../../src/hash.mjs";

const refHex = (s) => createHash("sha256").update(s).digest("hex");
const hex = (bytes) => Buffer.from(bytes).toString("hex");

test("sha256Bytes matches node:crypto on the classic vectors and every block/padding boundary", () => {
  const cases = [
    "", "abc", "poolId:key",
    "a".repeat(54), "a".repeat(55), "a".repeat(56), "a".repeat(57),
    "b".repeat(63), "b".repeat(64), "b".repeat(65),
    "c".repeat(119), "c".repeat(120), "c".repeat(128),
    "long ".repeat(400),
    "unicode 🦊 tökens Ünïcode",
  ];
  for (const c of cases) assert.equal(hex(sha256Bytes(c)), refHex(c), JSON.stringify(c.slice(0, 24)));
});

test("sha256Bytes matches node:crypto over random inputs of every small length", () => {
  for (let i = 0; i < 200; i += 1) {
    const s = randomBytes(1 + (i % 97)).toString("base64");
    assert.equal(hex(sha256Bytes(s)), refHex(s), s);
  }
});
