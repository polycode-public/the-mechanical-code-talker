// The P2P transport doing a real WebRTC handshake between two independent
// browser contexts: offer out of one, answer back from the other, a live
// DataChannel carrying messages both ways, and a close on one side landing on
// the other. The SDP strings cross by being read out of one page and passed
// into the other, which is the whole point — it stands in for a person pasting
// a link and pasting a reply back, with no signalling server anywhere.
//
// The page now defaults to a public STUN server (DEFAULT_ICE_SERVERS,
// webrtc-transport.mjs), but this suite still runs same-engine Chromium
// contexts on host candidates: Chromium hides local IPs behind mDNS hostnames
// by default, which two instances on one machine cannot resolve for each
// other, so the launch turns that off — a loopback-test mitigation, not
// something a real user's browser gets to opt into.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serveDirectory } from "./helpers/static-server.mjs";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const HANDSHAKE_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 180_000;

// The fixture is built here rather than published to the site, so a run
// pointed at the deployed site has nothing to open.
const skip = process.env.TMCT_E2E_BASE_URL ? "the transport fixture page is local-only" : false;

// Everything the test reads lives under one `peer` object: `window.closed` is
// a read-only DOM property, and assigning to it from a module throws.
const FIXTURE_PAGE = `<!doctype html>
<meta charset="utf-8">
<title>tmct p2p transport fixture</title>
<script type="module">
  import { createTransport } from "./webrtc-transport.mjs";
  const transport = createTransport();
  const peer = { transport, received: [], opened: false, closed: false };
  transport.onMessage((value) => peer.received.push(value));
  transport.onOpen(() => { peer.opened = true; });
  transport.onClose(() => { peer.closed = true; });
  window.peer = peer;
</script>
`;

let fixtureDir;
let server;
let browser;

before(async () => {
  if (skip) return;
  fixtureDir = mkdtempSync(path.join(tmpdir(), "tmct-p2p-"));
  cpSync(path.join(repoRoot, "src/adapters/p2p/webrtc-transport.mjs"), path.join(fixtureDir, "webrtc-transport.mjs"));
  writeFileSync(path.join(fixtureDir, "transport.html"), FIXTURE_PAGE);
  server = await serveDirectory(fixtureDir);
  browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

/** A fresh context holding one transport, isolated from every other one. */
async function openPeer() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  await page.goto(`${server.origin}/transport.html`);
  await page.waitForFunction(() => window.peer !== undefined, null, { timeout: HANDSHAKE_TIMEOUT_MS });
  return { context, page, pageErrors };
}

test(
  "two browser contexts complete an offer/answer handshake and talk over the data channel both ways",
  { skip, timeout: TEST_TIMEOUT_MS },
  async () => {
    const sharer = await openPeer();
    const joiner = await openPeer();

    try {
      assert.equal(await sharer.page.evaluate(() => window.peer.transport.connectionState), "new");

      const offerSdp = await sharer.page.evaluate(() => window.peer.transport.createOffer());
      assert.match(offerSdp, /^v=0/, "the offer is a real SDP blob");
      assert.match(offerSdp, /m=application .* webrtc-datachannel/, "the offer carries the data channel");
      assert.match(offerSdp, /a=candidate:/, "gathering completed before the offer was handed back");

      const answerSdp = await joiner.page.evaluate((sdp) => window.peer.transport.createAnswerFor(sdp), offerSdp);
      assert.match(answerSdp, /^v=0/, "the answer is a real SDP blob");
      assert.match(answerSdp, /a=candidate:/, "the answering side gathered before handing its blob back too");

      await sharer.page.evaluate((sdp) => window.peer.transport.completeWithAnswer(sdp), answerSdp);

      for (const side of [sharer, joiner]) {
        await side.page.waitForFunction(() => window.peer.opened === true, null, { timeout: HANDSHAKE_TIMEOUT_MS });
        assert.equal(await side.page.evaluate(() => window.peer.transport.connectionState), "connected");
      }

      await sharer.page.evaluate(() => window.peer.transport.send({ from: "sharer", facts: [1, 2, 3] }));
      await joiner.page.waitForFunction(() => window.peer.received.length === 1, null, { timeout: HANDSHAKE_TIMEOUT_MS });
      assert.deepEqual(await joiner.page.evaluate(() => window.peer.received[0]), { from: "sharer", facts: [1, 2, 3] });

      await joiner.page.evaluate(() => window.peer.transport.send({ from: "joiner", nested: { ok: true } }));
      await sharer.page.waitForFunction(() => window.peer.received.length === 1, null, { timeout: HANDSHAKE_TIMEOUT_MS });
      assert.deepEqual(await sharer.page.evaluate(() => window.peer.received[0]), { from: "joiner", nested: { ok: true } });

      assert.equal(await sharer.page.evaluate(() => window.peer.closed), false, "a live connection has not announced a close");

      await sharer.page.evaluate(() => window.peer.transport.close());
      assert.equal(await sharer.page.evaluate(() => window.peer.closed), true, "closing announces the close locally too");
      assert.equal(await sharer.page.evaluate(() => window.peer.transport.connectionState), "closed");

      await joiner.page.waitForFunction(() => window.peer.closed === true, null, { timeout: HANDSHAKE_TIMEOUT_MS });

      assert.deepEqual(sharer.pageErrors, [], "the sharing page logged no errors");
      assert.deepEqual(joiner.pageErrors, [], "the joining page logged no errors");
    } finally {
      await sharer.context.close();
      await joiner.context.close();
    }
  },
);

test(
  "sending before the channel opens throws instead of dropping the message",
  { skip, timeout: TEST_TIMEOUT_MS },
  async () => {
    const peer = await openPeer();
    try {
      const failure = await peer.page.evaluate(() => {
        try {
          window.peer.transport.send({ too: "early" });
          return null;
        } catch (error) {
          return String(error.message);
        }
      });
      assert.match(failure ?? "", /cannot send/i, "the caller sees the failed send");
    } finally {
      await peer.context.close();
    }
  },
);
