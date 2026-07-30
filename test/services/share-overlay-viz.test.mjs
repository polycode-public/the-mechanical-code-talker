// share-overlay-viz: the one sharing overlay chat.html and mud.html both
// embed — the pure step ladder, the wave reader, the share-message builders,
// and the markup's stable ids.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_STEP_KEYS,
  shareStepStates,
  activeWaves,
  offerBlobIn,
  shareMessageFor,
  replyMessageFor,
  whatsAppShareUrl,
  shareOverlayHtml,
  SHARE_OVERLAY_CSS,
} from "../../src/services/share-overlay-viz.mjs";

const statuses = (args) => shareStepStates(args).map((s) => s.status);

test("the ladder reads the seat: a fresh page stands at step 1, a sponsor at step 2, a joiner at step 3 then 4", () => {
  assert.deepEqual(statuses({ role: "idle", state: "idle" }), ["now", "todo", "todo", "todo", "todo"]);
  assert.deepEqual(statuses({ role: "sponsor", state: "sharing" }), ["done", "now", "todo", "todo", "todo"]);
  assert.deepEqual(statuses({ role: "joiner", state: "idle", hasReply: false }), ["done", "done", "now", "todo", "todo"]);
  assert.deepEqual(statuses({ role: "joiner", state: "answering", hasReply: true }), ["done", "done", "done", "now", "todo"]);
});

test("once both halves are exchanged the ladder reads the wire, whatever the seat", () => {
  for (const role of ["idle", "sponsor", "joiner"]) {
    assert.deepEqual(statuses({ role, state: "connecting" }), ["done", "done", "done", "done", "now"]);
    assert.deepEqual(statuses({ role, state: "connected" }), ["done", "done", "done", "done", "done"]);
    assert.deepEqual(statuses({ role, state: "failed" }), ["done", "done", "done", "done", "fail"]);
  }
});

test("every ladder row names its step key, in wire order", () => {
  assert.deepEqual(
    shareStepStates({ role: "idle", state: "idle" }).map((s) => s.key),
    [...SHARE_STEP_KEYS],
  );
});

test("activeWaves reads recency off the newest stamp and tells a broadcast from a targeted wave", () => {
  const now = Date.parse("2026-07-20T12:00:10.000Z");
  const rows = [
    { subject: "aaa1", predicate: "mgx:waved", object: "presence", provenance: "ace:p2p:aaa1-presence@2026-07-20T11:00:00.000Z | ace:p2p:aaa1-presence@2026-07-20T12:00:08.000Z" },
    { subject: "bbb2", predicate: "mgx:waved", object: "ccc3", provenance: "ace:p2p:bbb2-ccc3@2026-07-20T12:00:09.000Z" },
    { subject: "ddd4", predicate: "mgx:waved", object: "presence", provenance: "ace:p2p:ddd4-presence@2026-07-20T11:59:00.000Z" },
    { subject: "aaa1", predicate: "mgx:nodeName", object: "mossy-acorn", provenance: "ace:p2p:aaa1@2026-07-20T12:00:09.500Z" },
  ];
  const waves = activeWaves(rows, now);
  assert.deepEqual(waves.map((w) => [w.waver, w.target]), [["bbb2", "ccc3"], ["aaa1", ""]],
    "newest first; a stale wave and a non-wave fact never read as waving");
});

test("a wave from the future or with no parsable stamp never renders", () => {
  const now = Date.parse("2026-07-20T12:00:00.000Z");
  assert.deepEqual(activeWaves([
    { subject: "a", predicate: "mgx:waved", object: "presence", provenance: "ace:p2p:a-presence@2026-07-20T12:00:05.000Z" },
    { subject: "b", predicate: "mgx:waved", object: "presence", provenance: "not a tag at all" },
  ], now), []);
});

test("offerBlobIn takes a whole link or a bare code, and nothing else in between", () => {
  assert.equal(offerBlobIn("https://x.test/chat.html?offer=AbC123&world=w1"), "AbC123");
  assert.equal(offerBlobIn("  AbC123  "), "AbC123");
  assert.equal(offerBlobIn("https://x.test/chat.html?offer=AbC%2B123#frag"), "AbC+123", "the code is URL-decoded on the way out");
});

test("the share messages carry the world's name, the instruction, and the payload last", () => {
  const invite = shareMessageFor({ worldName: "mossy-acorn", link: "https://x.test/chat.html?offer=B" });
  assert.ok(invite.includes('"mossy-acorn"'));
  assert.ok(invite.endsWith("https://x.test/chat.html?offer=B"), "the link rides last so a preview never hides the instructions");
  const reply = replyMessageFor({ worldName: "mossy-acorn", blob: "BLOB" });
  assert.ok(reply.includes("paste it into"));
  assert.ok(reply.endsWith("BLOB"));
});

test("the WhatsApp share URL is wa.me with the whole message encoded once", () => {
  assert.equal(whatsAppShareUrl("join here: https://x.test/?offer=a+b"),
    "https://wa.me/?text=" + encodeURIComponent("join here: https://x.test/?offer=a+b"));
});

test("the overlay carries every stable id both page scripts and the drivers address", () => {
  const html = shareOverlayHtml({ withTape: true });
  for (const id of [
    "netPanel", "netPanelClose", "wireState", "wireStateWord", "wireStateNote",
    "joinCard", "joinEyebrow", "joinWorld", "joinBody", "joinBtn", "joinProblem",
    "joinReplyWrap", "joinReply", "joinCopyBtn", "joinShareBtn", "joinWaBtn", "joinDismiss",
    "mintInviteBtn", "inviteSummary", "shareLink", "copyLinkBtn", "copyCodeBtn", "webShareBtn", "waShareBtn",
    "inviteBox", "inviteBtn", "inviteProblem",
    "replyOut", "copyReplyBtn", "replyShareBtn", "replyWaBtn",
    "replyBox", "replyBtn", "replyProblem",
    "nodeList", "nodeCount", "nodeEmpty", "waveAllBtn",
    "worldNameInput", "nodeNameInput",
    "sceneYouName", "sceneThemName",
    "tape", "tapeMeter", "tapeTotal", "tapeEmpty",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `the overlay carries #${id}`);
  }
  for (const key of SHARE_STEP_KEYS) {
    assert.ok(html.includes(`id="step-${key}"`), `the ladder carries step-${key}`);
  }
});

test("the tape is an option: a page with no wire instrument gets no empty shell", () => {
  const html = shareOverlayHtml({ withTape: false });
  for (const id of ["tape", "tapeMeter", "tapeTotal", "tapeEmpty"]) {
    assert.ok(!html.includes(`id="${id}"`), `no #${id} without the instrument behind it`);
  }
});

test("the learn-more links point at real references: MDN's WebRTC page, webrtc.org, and the site's own help", () => {
  const html = shareOverlayHtml();
  assert.ok(html.includes("https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API"));
  assert.ok(html.includes("https://webrtc.org/"));
  assert.ok(html.includes('href="./help.html#sharing"'));
});

test("the joiner's primary button says exactly what it does", () => {
  assert.match(shareOverlayHtml(), />create my reply</);
});

test("a hidden overlay is really hidden, whatever display rules a page adds", () => {
  assert.match(SHARE_OVERLAY_CSS, /\.shareOverlay\[hidden\] \{ display: none !important; \}/);
});

test("page wording is an override, not a fork: mud's words land without new markup", () => {
  const html = shareOverlayHtml({ copy: { thing: "burrow", dismiss: "dig on your own instead", invitedEyebrow: "you have been invited to dig in" } });
  assert.ok(html.includes("dig on your own instead"));
  assert.ok(html.includes("you have been invited to dig in"));
  assert.ok(html.includes("no server ever holds this burrow"));
});
