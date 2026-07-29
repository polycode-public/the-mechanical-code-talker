// Three mud.html browsers dug into one burrow through a chain, ending up in a
// full mesh. The third context only ever exchanges blobs with the second: it
// never sees the first one's invite and the first never sees its reply. The
// peer introduction the room runs over the channel it already has is what
// closes the third side of the triangle, and after that the first and third
// pages draw each other's animals, name the node playing them, talk to them,
// and see each other wave.
//
// The two-browser lab — one person per tab, each driving their own animal in a
// shared burrow — is covered by pages-mud-p2p.test.mjs. This file is the same
// world with the introduction protocol carrying the third page.
//
// Real WebRTC between three real browser contexts throughout; nothing here
// mocks a transport.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";
import {
  ANSWER_TIMEOUT_MS,
  HANDSHAKE_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  acceptReply,
  animalsIn,
  castOneAnimal,
  connectedPeerIds,
  launchP2pBrowser,
  mintInvite,
  myPeerId,
  nodeNameOf,
  openMudPage,
  recastUntil,
  replyToInvite,
  sendMudCommand,
  standInTheGarden,
  waitForConnectedPeerCount,
} from "./helpers/mud-p2p.mjs";

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

const worldOf = (link) => new URL(link).searchParams.get("world");

const remoteCard = (page, subject) => page.locator(`#window-a-others .sprite-card[data-subject="${subject}"]`);

const waitForRemoteCard = (page, subject) => page.waitForFunction(
  (wanted) => document.querySelector(`#window-a-others .sprite-card[data-subject="${wanted}"] .sprite-node`) !== null,
  subject,
  { timeout: HANDSHAKE_TIMEOUT_MS },
);

test(
  "a third burrow joined through the second ends up connected straight to the first, and the two that never swapped a blob play in the same room",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const first = await openMudPage({ browser, origin: server.origin });
    let second;
    let third;
    try {
      const firstAnimal = await castOneAnimal(first.page);
      const firstDrives = await animalsIn(first.page);
      await standInTheGarden(first.page, firstAnimal);
      const firstName = await nodeNameOf(first.page);

      const firstLink = await mintInvite(first.page);

      second = await openMudPage({ browser, origin: server.origin });
      await castOneAnimal(second.page);
      const secondAnimal = await recastUntil(second.page, (drawn) => drawn && !firstDrives.includes(drawn));
      const secondDrives = await animalsIn(second.page);
      await standInTheGarden(second.page, secondAnimal);

      await acceptReply(first.page, await replyToInvite(second.page, firstLink));
      for (const side of [first, second]) await waitForConnectedPeerCount(side.page, 1);
      const secondName = await nodeNameOf(second.page);

      third = await openMudPage({ browser, origin: server.origin });
      await castOneAnimal(third.page);
      const thirdAnimal = await recastUntil(
        third.page,
        (drawn) => drawn && !firstDrives.includes(drawn) && !secondDrives.includes(drawn),
      );
      await standInTheGarden(third.page, thirdAnimal);

      // The second page invites into the burrow it joined, not one of its own.
      const secondLink = await mintInvite(second.page);
      assert.equal(worldOf(secondLink), worldOf(firstLink), "the chain grows one burrow, not two");
      await acceptReply(second.page, await replyToInvite(third.page, secondLink));
      const thirdName = await nodeNameOf(third.page);

      // The mesh: two live channels on every page, with nobody left reachable
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

      const everyName = [firstName, secondName, thirdName].sort();
      for (const [label, side] of [["first", first], ["second", second], ["third", third]]) {
        await side.page.waitForFunction(
          () => document.querySelectorAll(".node-row").length >= 3,
          null,
          { timeout: HANDSHAKE_TIMEOUT_MS },
        );
        const names = await side.page.locator(".node-row .node-name").allTextContents();
        assert.deepEqual([...names].sort(), everyName, `the ${label} page lists all three nodes`);
      }

      // Each animal is played from exactly one node, and the two pages that
      // never swapped a blob each say which node the other's animal comes from.
      await waitForRemoteCard(third.page, firstAnimal);
      assert.equal(
        await remoteCard(third.page, firstAnimal).locator(".sprite-node").textContent(),
        `via ${firstName}`,
        "the third page names the node playing the first page's animal",
      );
      await waitForRemoteCard(first.page, thirdAnimal);
      assert.equal(
        await remoteCard(first.page, thirdAnimal).locator(".sprite-node").textContent(),
        `via ${thirdName}`,
        "and the same reading holds back the other way",
      );

      // Talking across the introduced link needs nothing new: the ordinary
      // talk verb reads whoever the shared facts place in the room.
      const said = await sendMudCommand(third.page, `talk to ${firstAnimal}`);
      assert.doesNotMatch(said, /don't know the word|unrecognized/i, "the far animal is an ordinary thing to talk to");
      assert.match(said, new RegExp(firstAnimal), "and the reply is that animal's own answer");

      // A wave is a fact, so it crosses the introduced channel the way every
      // other fact does.
      await first.page.click("#window-a-wave");
      for (const [label, side] of [["second", second], ["third", third]]) {
        await side.page.waitForFunction(
          (subject) => document.querySelector(`#window-a-others .sprite-card[data-subject="${subject}"].waving .wave-hand`) !== null,
          firstAnimal,
          { timeout: HANDSHAKE_TIMEOUT_MS },
        );
        assert.ok(await remoteCard(side.page, firstAnimal).isVisible(), `the ${label} page saw the wave`);
      }

      // And back from the far end, through the same mesh.
      const typed = await sendMudCommand(third.page, "wave");
      assert.match(typed, /you wave/, "the typed command is the same gesture");
      await first.page.waitForFunction(
        (subject) => document.querySelector(`#window-a-others .sprite-card[data-subject="${subject}"].waving .wave-hand`) !== null,
        thirdAnimal,
        { timeout: ANSWER_TIMEOUT_MS + HANDSHAKE_TIMEOUT_MS },
      );

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
