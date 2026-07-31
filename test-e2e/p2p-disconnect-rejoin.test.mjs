// A peer leaving, the rest carrying on without it, and a new device catching
// up on everything it missed. Three chat.html browsers connect; one closes its
// browser context outright, the way a person closing a laptop lid would; the
// two that stayed keep teaching each other facts the one that left never sees.
// Then a fourth context — its own storage, nothing taught into it — misses the
// question honestly, joins on a fresh invite from one of the two, and answers
// the same question from the shared graph, still naming the node that taught
// the fact rather than the node that passed it on.
//
// Real WebRTC between real browser contexts throughout: every blob crosses by
// being read out of one page's DOM and typed into another's.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import {
  HANDSHAKE_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  acceptReply,
  answerText,
  askChat,
  connectedPeerIds,
  inviteNewPeer,
  launchP2pBrowser,
  mintInvite,
  myPeerId,
  nodeNameOf,
  openChatPage,
  replyFromJoinCard,
  waitForChatBoot,
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

const waitForIncoming = (page, type) => page.waitForFunction(
  (wanted) => document.querySelector(`.tape-row[data-type="${wanted}"][data-dir="in"]`) !== null,
  type,
  { timeout: HANDSHAKE_TIMEOUT_MS },
);

test(
  "a peer that closes its browser goes away without taking its facts with it, the peers left keep converging, and a fresh device joins later and recovers everything it missed with the teaching node still named",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const teacher = await openChatPage({ browser, origin: server.origin });
    let relay;
    let leaver;
    let newDevice;
    try {
      const teacherName = await nodeNameOf(teacher.page);

      ({ joiner: relay } = await inviteNewPeer({ browser, origin: server.origin, inviterPage: teacher.page }));
      for (const side of [teacher, relay]) await waitForConnectedPeerCount(side.page, 1);
      const relayName = await nodeNameOf(relay.page);

      let leaverLink;
      ({ joiner: leaver, link: leaverLink } = await inviteNewPeer({ browser, origin: server.origin, inviterPage: relay.page }));
      for (const side of [teacher, relay, leaver]) await waitForConnectedPeerCount(side.page, 2);
      const leaverName = await nodeNameOf(leaver.page);
      const leaverId = await myPeerId(leaver.page);

      // Something everybody has before anyone leaves, so the leaving is about
      // what comes after it rather than about starting from nothing.
      await askChat(teacher.page, "every zorbnug is a dog");
      for (const side of [relay, leaver]) {
        await waitForIncoming(side.page, "op");
        assert.match(await answerText(await askChat(side.page, "what is a zorbnug")), /zorbnug is a kind of dog/);
      }

      // The peer closes its whole browser context, taking its WebRTC stack
      // with it. Nothing is announced in the page — the channel dying is the
      // announcement.
      await leaver.context.close();
      leaver = null;

      for (const [label, side] of [["teacher", teacher], ["relay", relay]]) {
        await waitForConnectedPeerCount(side.page, 1);
        assert.equal(
          (await connectedPeerIds(side.page)).length,
          1,
          `the ${label} page holds one live channel once the third one goes`,
        );
        await side.page.waitForFunction(
          (peerId) => document.querySelector(`.node-row[data-peer="${peerId}"][data-away="true"]`) !== null,
          leaverId,
          { timeout: HANDSHAKE_TIMEOUT_MS },
        );
        const names = await side.page.locator(".node-row .node-name").allTextContents();
        assert.deepEqual(
          [...names].sort(),
          [teacherName, relayName, leaverName].sort(),
          `the ${label} page still lists the node that left — what it contributed stays in the graph`,
        );
      }

      // The two that stayed keep converging on facts the one that left will
      // never see.
      await askChat(teacher.page, "every glomp is a dog");
      await waitForIncoming(relay.page, "op");
      const relayAnswer = await answerText(await askChat(relay.page, "what is a glomp"));
      assert.match(relayAnswer, /glomp is a kind of dog/, "the pair kept converging with one peer gone");
      assert.ok(relayAnswer.includes(`(source: teach:peer:${teacherName}@`), `got: ${relayAnswer}`);

      // A new device: its own context, its own storage, nothing taught into
      // it. The question it cannot answer is the same one the room can.
      newDevice = await openChatPage({ browser, origin: server.origin });
      const missRow = await askChat(newDevice.page, "what is a glomp");
      assert.match(await answerText(missRow), /I don't know "glomp" yet/, "a device with none of this misses honestly");
      assert.equal(await missRow.locator(".provchip").count(), 0, "a miss carries no chip");

      // It rejoins on a fresh link from the peer that stayed, not from the one
      // that taught the fact.
      const rejoinLink = await mintInvite(relay.page);
      assert.notEqual(rejoinLink, leaverLink, "a second invite is a fresh blob, not the one already spent");
      await newDevice.page.goto(rejoinLink, { waitUntil: "networkidle" });
      await waitForChatBoot(newDevice.page);
      const rejoinReply = await replyFromJoinCard(newDevice.page);
      await acceptReply(relay.page, rejoinReply);
      await waitForConnectedPeerCount(newDevice.page, 1);
      await waitForIncoming(newDevice.page, "sync-response");

      const recovered = await askChat(newDevice.page, "what is a glomp");
      const recoveredText = await answerText(recovered);
      assert.match(recoveredText, /glomp is a kind of dog/, "the new device recovers the fact it never saw taught");
      assert.ok(
        recoveredText.includes(`(source: teach:peer:${teacherName}@`),
        `the provenance still names who taught it, not who passed it on; got: ${recoveredText}`,
      );
      assert.equal(await recovered.locator(".provchip").textContent(), "taught", "and it reads as taught");

      // The catch-up is the whole graph, not just the last thing said.
      assert.match(
        await answerText(await askChat(newDevice.page, "what is a zorbnug")),
        /zorbnug is a kind of dog/,
        "the fact taught before anyone left arrives too",
      );

      for (const [label, side] of [["teacher", teacher], ["relay", relay], ["new device", newDevice]]) {
        assert.deepEqual(side.consoleErrors, [], `the ${label} page logged no errors`);
      }
    } finally {
      await teacher.context.close();
      await relay?.context.close();
      await leaver?.context.close();
      await newDevice?.context.close();
    }
  },
);
