// Two chat.html browsers reasoning over a chain of facts, once with both links
// taught on the same page and once with one link taught on each. The second is
// the point: facts that arrived from two different nodes are one fact set to
// the graph, so a question neither page could answer on its own is answered on
// both, with each step of the proof citing wherever that step came from.
//
// The pair connects over real WebRTC between real browser contexts, and every
// fact crosses that channel. Nothing here mocks a transport.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import {
  HANDSHAKE_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  answerText,
  askChat,
  inviteNewPeer,
  launchP2pBrowser,
  nodeNameOf,
  openChatPage,
  waitForConnectedPeerCount,
} from "./helpers/chat-p2p.mjs";

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  browser = await launchP2pBrowser();
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

const waitForIncomingOp = (page) => page.waitForFunction(
  () => document.querySelectorAll('.tape-row[data-type="op"][data-dir="in"]').length > 0,
  null,
  { timeout: HANDSHAKE_TIMEOUT_MS },
);

/** Connect one pair and hand back both sides, each with the node name it chose. */
async function connectedPair() {
  const host = await openChatPage({ browser, origin: server.origin });
  const { joiner: guest } = await inviteNewPeer({ browser, origin: server.origin, inviterPage: host.page });
  for (const side of [host, guest]) await waitForConnectedPeerCount(side.page, 1);
  return {
    host,
    guest,
    hostName: await nodeNameOf(host.page),
    guestName: await nodeNameOf(guest.page),
  };
}

test(
  "a page in a shared room still chains two facts it taught itself, and cites both as its own",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { host, guest } = await connectedPair();
    try {
      await askChat(host.page, "every florn is a dog");
      await askChat(host.page, "every quiblet is a florn");

      const proved = await answerText(await askChat(host.page, "is a quiblet a dog"));
      assert.match(proved, /^yes/, "the two taught facts answer the question between them");
      assert.match(proved, /quiblet is a kind of florn/, "the proof shows the first step");
      assert.match(proved, /florn is a kind of dog/, "and the second");
      assert.match(proved, /so quiblet is a dog/, "and states what they add up to");
      assert.doesNotMatch(
        proved,
        /teach:peer:/,
        "a room being open changes nothing about facts this page taught itself",
      );

      assert.deepEqual(host.consoleErrors, []);
      assert.deepEqual(guest.consoleErrors, []);
    } finally {
      await host.context.close();
      await guest.context.close();
    }
  },
);

test(
  "one link of a chain taught on each page: the fact that arrived over the wire grounds the other page's teaching, and either page proves the whole chain with each step citing where it came from",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const { host, guest, hostName, guestName } = await connectedPair();
    try {
      // Neither page can be taught a fact whose two terms are both new to it,
      // which is what makes the order below the scenario rather than a detail:
      // the second page can only teach its half once the first page's half has
      // arrived and grounded one of the terms.
      const ungrounded = await answerText(await askChat(guest.page, "every quiblet is a florn"));
      assert.match(ungrounded, /I couldn't store that/, "two brand-new terms at once is not a fact this graph can take");

      const taught = await answerText(await askChat(host.page, "every florn is a dog"));
      assert.match(taught, /remembered: florn is a kind of dog/);

      await waitForIncomingOp(guest.page);
      const nowGrounded = await answerText(await askChat(guest.page, "every quiblet is a florn"));
      assert.match(
        nowGrounded,
        /remembered: quiblet is a kind of florn/,
        "the peer's fact grounded a term this page had never heard of, so the teaching lands",
      );

      // The question needs both halves. Each page proves it, and each step of
      // the proof carries its own source — one local, one from the other node.
      await waitForIncomingOp(host.page);
      const onHost = await answerText(await askChat(host.page, "is a quiblet a dog"));
      assert.match(onHost, /^yes/);
      assert.match(onHost, /so quiblet is a dog/, "the page that taught the second half proves the whole chain");
      assert.ok(
        onHost.includes(`teach:peer:${guestName}@`),
        `the step this page did not teach names the node that did; got: ${onHost}`,
      );
      assert.match(onHost, /florn is a kind of dog \(source: teach:chat:/, "and its own step still reads as its own");

      const onGuest = await answerText(await askChat(guest.page, "is a quiblet a dog"));
      assert.match(onGuest, /^yes/);
      assert.match(onGuest, /so quiblet is a dog/, "and so does the page that taught the first half");
      assert.ok(
        onGuest.includes(`teach:peer:${hostName}@`),
        `with the sources the other way round; got: ${onGuest}`,
      );
      assert.match(onGuest, /quiblet is a kind of florn \(source: teach:chat:/);

      // Two sources, one graph: the chip a merged chain earns is the ordinary
      // taught chip, not a second kind for facts that came in over a wire.
      const chipRow = await askChat(guest.page, "what is a quiblet");
      assert.equal(await chipRow.locator(".provchip").textContent(), "taught");
      assert.match(await answerText(chipRow), /quiblet is a kind of florn/);

      assert.deepEqual(host.consoleErrors, []);
      assert.deepEqual(guest.consoleErrors, []);
    } finally {
      await host.context.close();
      await guest.context.close();
    }
  },
);
