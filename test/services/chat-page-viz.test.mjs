// chat-page-viz: the pure render-glue the page splices into its own inline
// script. renderChatHtml is a pure string builder, so its structure is pinned
// here the same way mud-viz.test.mjs pins mud.html's.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderChatHtml,
  wireStateLabel,
  tapeRowFor,
  tapeClock,
  nodeRowsFor,
  inviteLinkFor,
  inviteParamsFrom,
  nodeInitials,
  relativeWhen,
  provenanceChipFor,
} from "../../src/services/chat-page-viz.mjs";
import { provBucketFor } from "../../src/services/ledger-viz.mjs";
import { latestProvenanceTimestamp } from "../../src/domain/p2p/facts.mjs";

test("waiting for a reply is a calm state; only a failed connection reads as a fault", () => {
  for (const state of ["sharing", "answering"]) {
    assert.equal(wireStateLabel(state).tone, "waiting", `${state} is open-ended by design, not an error`);
  }
  assert.equal(wireStateLabel("connecting").tone, "working");
  assert.equal(wireStateLabel("connected").tone, "live");
  assert.equal(wireStateLabel("failed").tone, "failed");
  assert.equal(wireStateLabel("idle").tone, "idle");
  assert.equal(wireStateLabel(undefined).tone, "idle", "an unknown state falls back to idle rather than blank");
  assert.match(wireStateLabel("failed").note, /STUN server/, "the failure names what actually happened, not a fixed reachability boundary");
});

test("every state carries a distinct pill, headline and sentence of its own", () => {
  const states = ["idle", "sharing", "answering", "connecting", "connected", "failed"];
  for (const field of ["pill", "word", "note"]) {
    const values = states.map((s) => wireStateLabel(s)[field]);
    assert.equal(new Set(values).size, states.length, `no two states share a ${field}`);
    assert.ok(values.every(Boolean), `every state has a ${field}`);
  }
  assert.ok(
    states.every((s) => wireStateLabel(s).pill.length <= wireStateLabel(s).word.length),
    "the chrome's pill is never longer than the rail's headline — it has a row of controls to share",
  );
});

test("a fact batch on the wire reports its size; an introduction reports who it is for", () => {
  assert.deepEqual(
    tapeRowFor("out", { type: "op", from: "a", facts: [1, 2, 3] }),
    { type: "op", direction: "out", detail: "3 facts", family: "facts" },
  );
  assert.equal(tapeRowFor("in", { type: "op", facts: [1] }).detail, "1 fact", "one fact is singular");
  assert.equal(tapeRowFor("in", { type: "sync-response", facts: [] }).detail, "0 facts");
  assert.equal(tapeRowFor("in", { type: "peer-list", peers: [{}, {}] }).detail, "2 nodes");
  assert.equal(tapeRowFor("in", { type: "hello", displayName: "mossy-acorn" }).detail, "mossy-acorn");
  assert.equal(tapeRowFor("in", { type: "intro-offer", to: "0123456789abcdef" }).detail, "01234567");
});

test("message families reuse the page's own provenance colours, and anything unknown stays neutral", () => {
  assert.equal(tapeRowFor("in", { type: "op" }).family, "facts");
  assert.equal(tapeRowFor("in", { type: "sync-response" }).family, "facts");
  assert.equal(tapeRowFor("in", { type: "sync-request" }).family, "state");
  assert.equal(tapeRowFor("in", { type: "hello" }).family, "greeting");
  assert.equal(tapeRowFor("in", { type: "peer-list" }).family, "greeting");
  assert.equal(tapeRowFor("in", { type: "intro-answer" }).family, "signal");
  assert.equal(tapeRowFor("in", { type: "something-new" }).family, "link");
  assert.equal(tapeRowFor("in", null).type, "unknown", "a message with no type at all still makes a row");
});

test("tapeClock stamps HH:MM:SS.mmm, zero-padded, off the current local time", () => {
  const real = Date;
  class FixedDate extends real {
    constructor() { super("2026-07-20T03:04:05.006"); }
  }
  globalThis.Date = FixedDate;
  try {
    assert.equal(tapeClock(), "03:04:05.006");
  } finally {
    globalThis.Date = real;
  }
});

test("relativeWhen coarsens to the largest unit that still reads as one number", () => {
  const now = Date.parse("2026-07-20T12:00:00.000Z");
  assert.equal(relativeWhen(null, now), "—", "no activity yet reads as a dash, never a bogus duration");
  assert.equal(relativeWhen(undefined, now), "—");
  assert.equal(relativeWhen(now - 2000, now), "now", "under 5s reads as now");
  assert.equal(relativeWhen(now - 30_000, now), "30s");
  assert.equal(relativeWhen(now - 5 * 60_000, now), "5m");
  assert.equal(relativeWhen(now - 3 * 3600_000, now), "3h");
  assert.equal(relativeWhen(now - 2 * 86400_000, now), "2d");
});

const nameFor = (peerId) => ({ p2: "mossy-acorn", p3: "vet-departure" }[peerId] || peerId);

test("the node list sorts by the most recent fact each node contributed", () => {
  const rows = nodeRowsFor({
    peers: [{ peerId: "p2", connected: true }, { peerId: "p3", connected: false }],
    factRows: [
      { provenance: "teach:chat:local@2026-07-20T10:00:00.000Z" },
      { provenance: "teach:peer:mossy-acorn@2026-07-20T09:00:00.000Z" },
      { provenance: "teach:peer:mossy-acorn@2026-07-20T12:00:00.000Z" },
      { provenance: "teach:peer:vet-departure@2026-07-20T08:00:00.000Z" },
    ],
    myPeerId: "p1",
    myDisplayName: "striker-ballpark",
    nameFor,
    latestTimestampOf: latestProvenanceTimestamp,
  });
  assert.deepEqual(rows.map((r) => r.name), ["mossy-acorn", "striker-ballpark", "vet-departure"]);
  assert.equal(rows[0].lastActiveAt, Date.parse("2026-07-20T12:00:00.000Z"), "the newest tag wins for a node, not the first seen");
  assert.equal(rows[1].isSelf, true);
  assert.equal(rows[2].connected, false, "a node that dropped stays listed, marked away");
});

test("a tag's node segment is stripped before display, so activity still lands on the name a peer chose", () => {
  const rows = nodeRowsFor({
    peers: [{ peerId: "p2", connected: true }],
    factRows: [
      { provenance: "teach:peer:mossy-acorn#node:7f3a9c2e5b1d4a60@2026-07-20T09:00:00.000Z" },
      { provenance: "teach:peer:mossy-acorn#node:7f3a9c2e5b1d4a60@2026-07-20T12:00:00.000Z" },
    ],
    myPeerId: "p1",
    myDisplayName: "striker-ballpark",
    nameFor,
    latestTimestampOf: latestProvenanceTimestamp,
  });
  assert.deepEqual(rows.map((r) => r.name), ["mossy-acorn", "striker-ballpark"], "no id ever reaches the roster");
  assert.equal(rows[0].lastActiveAt, Date.parse("2026-07-20T12:00:00.000Z"));
});

test("a peer's node-segment tags and its older segment-free ones fold onto the one roster row", () => {
  const rows = nodeRowsFor({
    peers: [{ peerId: "p2", connected: true }],
    factRows: [
      { provenance: "teach:peer:mossy-acorn@2026-07-20T09:00:00.000Z" },
      { provenance: "teach:peer:mossy-acorn#node:7f3a9c2e5b1d4a60@2026-07-20T12:00:00.000Z" },
    ],
    myPeerId: "p1",
    myDisplayName: "striker-ballpark",
    nameFor,
    latestTimestampOf: latestProvenanceTimestamp,
  });
  assert.equal(rows.filter((r) => r.name === "mossy-acorn").length, 1);
  assert.equal(rows[0].lastActiveAt, Date.parse("2026-07-20T12:00:00.000Z"));
});

test("a node that has contributed nothing yet is listed with no timestamp rather than a guessed one", () => {
  const rows = nodeRowsFor({
    peers: [{ peerId: "p2", connected: true }],
    factRows: [{ provenance: "corpus:conceptnet /r/IsA" }],
    myPeerId: "p1",
    myDisplayName: "striker-ballpark",
    nameFor,
    latestTimestampOf: latestProvenanceTimestamp,
  });
  assert.deepEqual(rows.map((r) => r.lastActiveAt), [null, null]);
  assert.deepEqual(rows.map((r) => r.name), ["striker-ballpark", "mossy-acorn"]);
});

test("this node's own row reads its local teach tags, never the relabelled copies peers hold", () => {
  const rows = nodeRowsFor({
    peers: [],
    factRows: [
      { provenance: "ace:p2p:p1@2026-07-20T07:00:00.000Z" },
      { provenance: "teach:chat:local@2026-07-20T11:00:00.000Z" },
    ],
    myPeerId: "p1",
    myDisplayName: "striker-ballpark",
    nameFor,
    latestTimestampOf: latestProvenanceTimestamp,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lastActiveAt, Date.parse("2026-07-20T11:00:00.000Z"));
});

test("a row's last shared fact is the newest real fact — bookkeeping rows count as activity but never show", () => {
  const rows = nodeRowsFor({
    peers: [{ peerId: "p2", connected: true }],
    factRows: [
      { subject: "zorbnug", predicate: "rdf:type", object: "dog", provenance: "teach:peer:mossy-acorn@2026-07-20T10:00:00.000Z" },
      { subject: "b2a15260-2d01", predicate: "mgx:waved", object: "presence", provenance: "teach:peer:mossy-acorn@2026-07-20T12:00:00.000Z" },
    ],
    myPeerId: "p1",
    myDisplayName: "striker-ballpark",
    nameFor,
    latestTimestampOf: latestProvenanceTimestamp,
  });
  const peer = rows.find((r) => r.name === "mossy-acorn");
  assert.deepEqual(peer.lastFact, { subject: "zorbnug", predicate: "rdf:type", object: "dog" },
    "the fresher wave counts as activity but the fact shown is the real one");
  assert.equal(peer.lastActiveAt, Date.parse("2026-07-20T12:00:00.000Z"), "activity still reads the newest tag of all");
  assert.equal(rows.find((r) => r.isSelf).lastFact, null, "a node with no real fact yet shows none rather than an id-keyed row");
});

test("a node's monogram takes one letter from each word of its name, and never comes back empty", () => {
  assert.equal(nodeInitials("mossy-acorn"), "ma");
  assert.equal(nodeInitials("striker-ballpark"), "sb");
  assert.equal(nodeInitials("Solo"), "so", "a one-word name still fills the circle");
  assert.equal(nodeInitials("a"), "a");
  assert.equal(nodeInitials(""), "??", "an unnamed node draws a placeholder rather than a blank circle");
  assert.equal(nodeInitials(undefined), "??");
  assert.equal(nodeInitials("0123abcd-4567"), "04", "a shortened peer id still monograms");
});

test("a fact taught by a peer reads as taught, with the peer named in its citation", () => {
  const answer = 'zorbnug is a kind of dog (source: teach:peer:mossy-acorn@2026-07-20T12:00:00.000Z)';
  assert.equal(provenanceChipFor(answer, { miss: false, via: "ask" }, provBucketFor), "taught");
});

test("an invite link carries the offer, the world and its name, and never stacks two offers", () => {
  const link = inviteLinkFor("https://tmct.example/chat.html?offer=old&world=w0#frag", {
    blob: "BLOB",
    world: "w1",
    worldName: "mossy-acorn",
  });
  const parsed = new URL(link);
  assert.equal(parsed.pathname, "/chat.html");
  assert.equal(parsed.hash, "", "a fragment from the current address is dropped");
  assert.equal(parsed.searchParams.get("offer"), "BLOB", "the fresh offer replaces whatever this page was opened with");
  assert.equal(parsed.searchParams.get("world"), "w1");
  assert.equal(parsed.searchParams.get("name"), "mossy-acorn");
  assert.equal([...parsed.searchParams.keys()].length, 3);
});

test("an address with no offer carries no invite", () => {
  assert.equal(inviteParamsFrom(""), null);
  assert.equal(inviteParamsFrom("?world=w1&name=mossy-acorn"), null, "a world without an offer cannot be joined");
  assert.deepEqual(
    inviteParamsFrom("?offer=BLOB&world=w1&name=mossy-acorn"),
    { offer: "BLOB", world: "w1", worldName: "mossy-acorn" },
  );
  assert.deepEqual(
    inviteParamsFrom("?offer=BLOB"),
    { offer: "BLOB", world: "", worldName: "" },
    "an offer alone still opens the join card; the blob's own envelope decides",
  );
});

test("the page carries the sharing overlay, the join hero, the wave, and links to the help page", () => {
  const html = renderChatHtml();
  for (const id of [
    "netPanel", "nodeNameInput", "worldNameInput", "wireState", "statePill",
    "shareBtn", "shareLink", "copyLinkBtn", "copyCodeBtn", "webShareBtn", "waShareBtn",
    "inviteBox", "inviteBtn", "replyBox", "replyBtn", "replyProblem",
    "nodeList", "waveAllBtn", "tape", "tapeMeter", "waveBtn", "waveBurst",
    "joinCard", "joinWorld", "joinBtn", "joinReply",
    "step-invite", "step-send", "step-reply", "step-return", "step-connect",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `the page carries #${id}`);
  }
  assert.ok(html.includes('href="./help.html#chat"'), "the chrome's ? deep-links to the chat section of the help page");
  assert.ok(html.includes('href="./help.html#sharing"'), "the overlay deep-links to the sharing section");
});

test("the page offers exactly two paste boxes: one for an invite, one for a reply", () => {
  const html = renderChatHtml();
  const pasteTargets = [...html.matchAll(/<textarea[^>]*id="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((id) => !/^(shareLink|replyOut|joinReply)$/.test(id));
  assert.deepEqual(pasteTargets.sort(), ["inviteBox", "replyBox"], "every other box on the page is read-only output");
});

test("the page loads the shared P2P asset rather than bundling networking into itself", () => {
  const html = renderChatHtml();
  assert.ok(html.includes('"./vendor/p2p.js"'), "networking comes from the one shared same-origin asset");
  assert.ok(!html.includes("createP2pRoom = function"), "the room itself is never spliced into the page");
});

test("a hidden overlay cannot swallow clicks meant for the page under it", () => {
  assert.match(
    renderChatHtml(),
    /\[hidden\] \{ display: none !important; \}/,
    "the display rules below would otherwise beat the hidden attribute",
  );
});
