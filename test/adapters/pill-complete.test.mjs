// pill-complete: the pure matching half of the pill typeahead
// (src/services/pill-complete.mjs). Every test here checks the hard
// constraint mechanically — a match is always one of the caller's own
// candidate objects, never a string built from what was typed — because
// that is what stands between this feature and manufacturing a guess the
// page would then decline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pillCandidates, matchPills } from "../../src/services/pill-complete.mjs";

const FIXTURE = ["unlock cabinet", "examine desk", "take lamp"];

test("pillCandidates normalizes a bare command string to command === label", () => {
  assert.deepEqual(pillCandidates(["look"]), [{ command: "look", label: "look" }]);
});

test("pillCandidates normalizes an object pill, defaulting label to command when absent", () => {
  const out = pillCandidates([{ command: "go north" }, { command: "take carrot-1", label: "take carrot" }]);
  assert.deepEqual(out, [
    { command: "go north", label: "go north" },
    { command: "take carrot-1", label: "take carrot" },
  ]);
});

test("tier-1 single-char prefix ghosts the remainder of the command", () => {
  const result = matchPills(pillCandidates(FIXTURE), "u");
  assert.equal(result.tier, 1);
  assert.equal(result.top.command, "unlock cabinet");
  assert.equal(result.ghost, "nlock cabinet");
});

test("tier-1 multi-word prefix matches across the space", () => {
  const result = matchPills(pillCandidates(FIXTURE), "take la");
  assert.equal(result.tier, 1);
  assert.equal(result.top.command, "take lamp");
  assert.equal(result.ghost, "mp");
});

test("tier-2 word-boundary prefix matches mid-command with no ghost", () => {
  const result = matchPills(pillCandidates(FIXTURE), "cab");
  assert.equal(result.tier, 2);
  assert.equal(result.top.command, "unlock cabinet");
  assert.equal(result.ghost, "");
});

test("a tier-1 candidate always outranks a tier-2 candidate for the same typed text", () => {
  const candidates = pillCandidates(["look", "take lamp"]);
  const result = matchPills(candidates, "l");
  assert.equal(result.matches.length, 2);
  assert.equal(result.matches[0].command, "look");
  assert.equal(result.matches[1].command, "take lamp");
  assert.equal(result.tier, 1);
});

test("matching is case-insensitive and returns the pill's own lowercase command", () => {
  const result = matchPills(pillCandidates(FIXTURE), "UNLOCK CAB");
  assert.equal(result.top.command, "unlock cabinet");
});

test("empty input returns no matches, not the whole candidate list", () => {
  const result = matchPills(pillCandidates(FIXTURE), "");
  assert.deepEqual(result, { matches: [], top: null, ghost: "", tier: null });
});

test("whitespace-only input returns no matches", () => {
  const result = matchPills(pillCandidates(FIXTURE), "   ");
  assert.deepEqual(result, { matches: [], top: null, ghost: "", tier: null });
});

test("an unmatched prefix returns an empty list, never a fallback suggestion", () => {
  const result = matchPills(pillCandidates(FIXTURE), "zzz");
  assert.deepEqual(result.matches, []);
  assert.equal(result.top, null);
});

test("every returned match is the caller's own candidate object, not a copy", () => {
  const candidates = pillCandidates(FIXTURE);
  const result = matchPills(candidates, "e");
  assert.ok(result.matches.length > 0);
  for (const match of result.matches) {
    assert.ok(candidates.includes(match), "match must be === one of the input candidates");
  }
  assert.ok(candidates.includes(result.top));
});

test("label !== command: the accepted match is still the pill's exact command string", () => {
  const candidates = pillCandidates([{ command: "take carrot-1", label: "take carrot" }]);
  const result = matchPills(candidates, "car");
  assert.equal(result.tier, 2);
  assert.equal(result.top.command, "take carrot-1");
  assert.equal(result.matches[0], candidates[0]);
});

test("matches cap at 8 even when more candidates qualify", () => {
  const raw = [];
  for (let i = 0; i < 12; i++) raw.push("aim" + i);
  const candidates = pillCandidates(raw);
  const result = matchPills(candidates, "aim");
  assert.equal(result.matches.length, 8);
  assert.equal(result.matches[0].command, "aim0");
  assert.equal(result.matches[7].command, "aim7");
});

test("matching is deterministic across two identical calls", () => {
  const candidates = pillCandidates(FIXTURE);
  const first = matchPills(candidates, "e");
  const second = matchPills(candidates, "e");
  assert.deepEqual(first, second);
});

test("within a tier, a shorter command ranks above a longer one at the same position", () => {
  const candidates = pillCandidates(["open door", "open"]);
  const result = matchPills(candidates, "op");
  assert.equal(result.matches[0].command, "open");
  assert.equal(result.matches[1].command, "open door");
});

test("within a tier at equal position and length, original array order breaks the tie", () => {
  // Both commands are 14 characters with "to" starting at offset 5 — position
  // and length ties exactly, so only array order can decide the winner.
  const candidates = pillCandidates(["talk to butler", "wave to friend"]);
  const result = matchPills(candidates, "to");
  assert.equal(result.tier, 2);
  assert.deepEqual(result.matches.map((m) => m.command), ["talk to butler", "wave to friend"]);
});

test("a typed trailing space is kept and still prefix-matches", () => {
  const result = matchPills(pillCandidates(FIXTURE), "take ");
  assert.equal(result.tier, 1);
  assert.equal(result.top.command, "take lamp");
  assert.equal(result.ghost, "lamp");
});
