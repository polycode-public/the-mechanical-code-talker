// Three chat.html browsers joined in a chain, ending up in a full mesh. The
// third context only ever exchanges blobs with the second: it never sees the
// first one's invite link and the first one never sees its reply. The peer
// introduction the room runs over the channel it already has is what closes the
// third side of the triangle, and a fact taught after that reaches all three.
//
// Real WebRTC between three real browser contexts throughout — the helpers this
// file uses drive the page's own controls and nothing mocks a transport.
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
  connectedPeerIds,
  inviteNewPeer,
  launchP2pBrowser,
  myPeerId,
  nodeNameOf,
  openChatPage,
  waitForConnectedPeerCount,
  wireTypes,
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

test(
  "a third browser that only ever exchanges blobs with the second ends up directly connected to the first, and a fact taught afterwards reaches all three",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const first = await openChatPage({ browser, origin: server.origin });
    let second;
    let third;
    try {
      const firstName = await nodeNameOf(first.page);

      ({ joiner: second } = await inviteNewPeer({ browser, origin: server.origin, inviterPage: first.page }));
      for (const side of [first, second]) await waitForConnectedPeerCount(side.page, 1);
      const secondName = await nodeNameOf(second.page);

      // The second page invites the third from the world it joined, not one of
      // its own: the link carries the world it was let into.
      const firstWorld = await first.page.inputValue("#worldNameInput");
      let thirdLink;
      ({ joiner: third, link: thirdLink } = await inviteNewPeer({ browser, origin: server.origin, inviterPage: second.page }));
      assert.ok(
        thirdLink.includes(`name=${encodeURIComponent(firstWorld)}`),
        "the second page invites people into the world it joined, under that world's own name",
      );
      const thirdName = await nodeNameOf(third.page);

      // The mesh: two peers each, on every page, with nobody left reachable
      // only through somebody else.
      for (const [label, side] of [["first", first], ["second", second], ["third", third]]) {
        await waitForConnectedPeerCount(side.page, 2);
        assert.equal(
          (await connectedPeerIds(side.page)).length,
          2,
          `the ${label} page holds a direct channel to each of the other two`,
        );
      }
      const [firstId, secondId, thirdId] = await Promise.all([first, second, third].map((side) => myPeerId(side.page)));
      assert.equal(new Set([firstId, secondId, thirdId]).size, 3, "three pages, three peer ids");
      assert.deepEqual(
        (await connectedPeerIds(first.page)).sort(),
        [secondId, thirdId].sort(),
        "the first page is connected to the third directly, though it never saw its reply",
      );
      assert.deepEqual(
        (await connectedPeerIds(third.page)).sort(),
        [firstId, secondId].sort(),
        "and the third page is connected to the first, though it only ever pasted a blob to the second",
      );

      // How the third side got made, read off the wire tape each page draws.
      assert.ok(
        (await wireTypes(third.page, "out")).includes("intro-offer"),
        "the third page offered itself to the peer it was told about",
      );
      assert.ok(
        (await wireTypes(third.page, "in")).includes("intro-answer"),
        "and got its answer back through the peer in the middle",
      );
      const relayedIn = await wireTypes(second.page, "in");
      const relayedOut = await wireTypes(second.page, "out");
      for (const type of ["intro-offer", "intro-answer"]) {
        assert.ok(relayedIn.includes(type) && relayedOut.includes(type), `the page in the middle passed ${type} along`);
      }
      assert.ok(
        (await wireTypes(second.page, "out")).includes("peer-list"),
        "the introduction started with the middle page naming who else it could reach",
      );

      // Everyone lists everyone, by the names the nodes chose for themselves.
      const everyName = [firstName, secondName, thirdName].sort();
      for (const [label, side] of [["first", first], ["second", second], ["third", third]]) {
        await side.page.waitForFunction(
          () => document.querySelectorAll(".node-row").length >= 3,
          null,
          { timeout: HANDSHAKE_TIMEOUT_MS },
        );
        const names = await side.page.locator(".node-row .node-name").allTextContents();
        assert.deepEqual([...names].sort(), everyName, `the ${label} page lists all three nodes`);
        assert.equal(
          await side.page.locator('.node-row[data-away="true"]').count(),
          0,
          `the ${label} page has nobody marked away`,
        );
      }

      // A fact taught once, after the chain is complete, answering on both the
      // pages that did not teach it — including the one the teacher never
      // exchanged a blob with.
      const missOnThird = await askChat(third.page, "what is a zorbnug");
      assert.match(await answerText(missOnThird), /I don't know "zorbnug" yet/, "nothing knows the word yet");

      await askChat(first.page, "every zorbnug is a dog");
      for (const [label, side] of [["second", second], ["third", third]]) {
        await side.page.waitForFunction(
          () => document.querySelector('.tape-row[data-type="op"][data-dir="in"]') !== null,
          null,
          { timeout: HANDSHAKE_TIMEOUT_MS },
        );
        const grounded = await answerText(await askChat(side.page, "what is a zorbnug"));
        assert.match(grounded, /zorbnug is a kind of dog/, `the fact answers on the ${label} page`);
        assert.ok(
          grounded.includes(`(source: teach:peer:${firstName}@`),
          `the ${label} page names the node that taught it; got: ${grounded}`,
        );
      }

      for (const [label, side] of [["first", first], ["second", second], ["third", third]]) {
        assert.deepEqual(side.consoleErrors, [], `the ${label} page logged no errors`);
      }
    } finally {
      await first.context.close();
      await second?.context.close();
      await third?.context.close();
    }
  },
);
