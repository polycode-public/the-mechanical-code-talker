import test from "node:test";
import assert from "node:assert/strict";
import { generatePeerId, generateWorldId, generateDisplayName } from "../../../src/domain/p2p/peer-id.mjs";

test("generatePeerId and generateWorldId each mint a real, distinct UUID", () => {
  const a = generatePeerId();
  const b = generatePeerId();
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.notEqual(a, b);
  assert.notEqual(generateWorldId(), a);
});

test("generateDisplayName picks two distinct real lexicon words, joined by a dash", () => {
  const name = generateDisplayName();
  const parts = name.split("-");
  assert.equal(parts.length, 2);
  assert.notEqual(parts[0], parts[1]);
  assert.ok(parts[0].length > 0 && parts[1].length > 0);
});

test("generateDisplayName is deterministic under an injected random source", () => {
  const scriptedRandom = () => {
    const scripted = [0, 0.9];
    let calls = 0;
    return () => scripted[calls++] ?? 0.5;
  };
  assert.equal(generateDisplayName(scriptedRandom()), generateDisplayName(scriptedRandom()));
});
