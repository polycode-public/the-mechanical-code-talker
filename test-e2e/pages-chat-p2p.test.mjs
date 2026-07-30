// chat.html sharing one graph between two real browsers: the invite link out,
// the reply back, the connection, and a fact taught on one page answering a
// question on the other with the teaching node named in its citation.
//
// The two blobs cross by being read straight out of one page's DOM and typed
// into the other's, never through a real clipboard — that is what a person
// pasting into a message stands in for here, and a clipboard would only add a
// permission prompt to the thing under test.
//
// `iceServers` is empty by design, so both contexts have to find each other on
// host candidates alone. Chromium hides local IPs behind mDNS hostnames by
// default, which two instances on one machine cannot resolve for each other,
// so the launch turns that off — the standard mitigation for a loopback WebRTC
// test rather than anything the transport needs in production.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 60_000;
const ANSWER_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = 240_000;

let siteDir;
let server;
let browser;

before(async () => {
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  browser = await chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

/** A fresh browser context holding one chat page, booted and ready. */
async function openChatPage(url) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const source = msg.location()?.url ?? "";
    if (source && !source.startsWith(server.origin)) return;
    consoleErrors.push(msg.text());
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
  return { context, page, consoleErrors };
}

/** Submit through the live composer and return the settled assistant row. */
async function ask(page, question) {
  const rows = page.locator("#messages .msg-row.assistant");
  const seen = await rows.count();
  await page.fill("#composerInput", question);
  await page.press("#composerInput", "Enter");
  await page.waitForFunction(
    (n) => document.querySelectorAll("#messages .msg-row.assistant").length > n,
    seen,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  const row = rows.last();
  await row.locator(".bubble:not(.pending)").waitFor({ timeout: ANSWER_TIMEOUT_MS });
  return row;
}

const nodeNames = (page) => page.locator(".node-row .node-name").allTextContents();

/** Click "invite someone" and hand back the link it copied into its own box. */
async function mintInvite(page) {
  if (!(await page.evaluate(() => document.getElementById("netPanel").hidden))) await page.keyboard.press("Escape");
  await page.click("#shareBtn");
  await page.waitForFunction(() => document.getElementById("shareLink").value.length > 0, null, { timeout: HANDSHAKE_TIMEOUT_MS });
  return page.inputValue("#shareLink");
}

test(
  "two browsers share one graph: invite, reply, connect, and a fact taught on one answers on the other citing the node that taught it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const inviter = await openChatPage(`${server.origin}/chat.html`);
    let joiner;
    try {
      // The page names itself and its world before anything is shared, from
      // the graph's own vocabulary rather than an id.
      const inviterNode = await inviter.page.inputValue("#nodeNameInput");
      const worldName = await inviter.page.inputValue("#worldNameInput");
      assert.match(inviterNode, /^[a-z]+-[a-z]+$/, "this node gets a two-word name from the lexicon");
      assert.match(worldName, /^[a-z]+-[a-z]+$/, "so does the world");
      assert.equal(await inviter.page.locator("#statePillWord").textContent(), "not shared");
      assert.equal(await inviter.page.locator("#wireState").getAttribute("data-tone"), "idle");

      const link = await mintInvite(inviter.page);
      assert.ok(link.includes("offer="), "the link carries the offer blob");
      assert.ok(link.includes(`name=${encodeURIComponent(worldName)}`), "and the world's name, so the joiner sees what they were invited to");
      assert.equal(
        await inviter.page.locator("#wireState").getAttribute("data-tone"),
        "waiting",
        "waiting for a reply is a calm state, not an error one — nothing is in flight yet",
      );
      assert.equal(await inviter.page.locator(".copyTip").textContent(), "link copied — send it to one person");
      assert.equal(await inviter.page.locator("#shareLink").isVisible(), true, "the whole invite is on screen before anything is sent");
      assert.equal(await inviter.page.locator("#replyBox").isVisible(), true, "and the box their reply lands in stands ready beside it");
      assert.equal(
        await inviter.page.locator("#step-invite").getAttribute("data-status"),
        "done",
        "the ladder marks the minted invite done and moves the live step forward",
      );

      // The joiner lands on a card, not a live world: one button, no paste box.
      joiner = await openChatPage(link);
      assert.equal(await joiner.page.locator("#joinCard").isVisible(), true, "the joiner lands on the join card");
      assert.equal(await joiner.page.locator("#joinWorld").textContent(), worldName, "the card names the world");
      assert.equal(await joiner.page.locator("#joinCard textarea:visible").count(), 0, "the joiner has no paste box at all");
      assert.equal(await joiner.page.locator("#joinBtn").textContent(), "create my reply");
      assert.equal(
        await joiner.page.locator("#statePillWord").textContent(),
        "not shared",
        "nothing runs until the button is pressed",
      );

      await joiner.page.click("#joinBtn");
      await joiner.page.waitForFunction(() => document.getElementById("joinReply").value.length > 0, null, { timeout: HANDSHAKE_TIMEOUT_MS });
      const reply = await joiner.page.inputValue("#joinReply");
      assert.equal(await joiner.page.locator(".copyTip").textContent(), "reply copied — send it back the same way");
      assert.equal(await joiner.page.locator("#statePillWord").textContent(), "reply sent");
      assert.equal(await joiner.page.locator("#wireStateWord").textContent(), "send your reply back");

      // Standing in for the paste: the blob is read out of one DOM and typed
      // into the other, exactly as a person would move it between two chats.
      await inviter.page.fill("#replyBox", reply);
      await inviter.page.click("#replyBtn");

      for (const side of [inviter, joiner]) {
        await side.page.waitForFunction(
          () => document.getElementById("statePill").dataset.tone === "live",
          null,
          { timeout: HANDSHAKE_TIMEOUT_MS },
        );
        assert.equal(await side.page.locator("#statePillWord").textContent(), "connected");
      }
      assert.equal(await inviter.page.inputValue("#replyBox"), "", "a reply that validated clears its box");
      assert.equal(
        await joiner.page.locator("#joinCard").isVisible(),
        false,
        "the join card gets out of the way once the connection it exists to make is open",
      );
      assert.equal(
        await joiner.page.evaluate(() => document.getElementById("replyOut").value),
        reply,
        "the reply the joiner sent is still recorded in the overlay, even though its box has retired",
      );
      assert.equal(
        await inviter.page.evaluate(() => document.getElementById("netPanel").hidden),
        true,
        "the lights come back up on their own the moment the channel opens",
      );
      // Reopening shows the paste box still standing: if two people opened the
      // same link, the second reply still needs somewhere to land.
      await inviter.page.click("#statePill");
      assert.equal(await inviter.page.locator("#replyBox").isVisible(), true);
      await inviter.page.keyboard.press("Escape");

      const joinerNode = await joiner.page.inputValue("#nodeNameInput");
      for (const [label, side] of [["inviter", inviter], ["joiner", joiner]]) {
        await side.page.waitForFunction(() => document.querySelectorAll(".node-row").length >= 2, null, { timeout: HANDSHAKE_TIMEOUT_MS });
        const names = await nodeNames(side.page);
        assert.deepEqual([...names].sort(), [inviterNode, joinerNode].sort(), `the ${label} lists both nodes by name`);
      }

      // The named scenario: an honest miss, a peer teaches it, the same
      // question grounds — and the citation names who taught it.
      const missRow = await ask(joiner.page, "what is a zorbnug");
      assert.match(await missRow.locator(".bubble").innerText(), /I don't know "zorbnug" yet/);
      assert.equal(await missRow.locator(".provchip").count(), 0, "a miss carries no chip — the absence is the signal");

      const teachRow = await ask(inviter.page, "every zorbnug is a dog");
      assert.equal(await teachRow.locator(".provchip").textContent(), "taught");

      await joiner.page.waitForFunction(
        () => document.querySelector('.tape-row[data-type="op"][data-dir="in"]') !== null,
        null,
        { timeout: HANDSHAKE_TIMEOUT_MS },
      );
      const groundedRow = await ask(joiner.page, "what is a zorbnug");
      const grounded = await groundedRow.locator(".bubble").innerText();
      assert.match(grounded, /zorbnug is a kind of dog/, "the peer's fact answers here");
      assert.ok(
        grounded.includes(`(source: teach:peer:${inviterNode}@`),
        `the citation names the node that taught it; got: ${grounded}`,
      );
      assert.equal(
        await groundedRow.locator(".provchip").textContent(),
        "taught",
        "a peer-taught fact reads as taught, through the chip rule that already existed",
      );

      // A wave is a fact, so it reaches the other page the same way any other
      // fact does — carrying the waving node's name.
      await inviter.page.click("#waveBtn");
      for (const [label, side] of [["waver", inviter], ["watcher", joiner]]) {
        await side.page.locator(".wave-pill").waitFor({ timeout: HANDSHAKE_TIMEOUT_MS });
        assert.match(
          await side.page.locator(".wave-pill").innerText(),
          new RegExp(`${inviterNode} waved`),
          `the ${label} sees the wave labelled with the node it came from`,
        );
        assert.equal(
          await side.page.locator(`.node-row[data-waving="true"] .node-name`).textContent(),
          inviterNode,
          `the ${label}'s node list marks the same node as waving`,
        );
      }

      // The typed command reaches the other side too, from the joiner back.
      await joiner.page.fill("#composerInput", "wave");
      await joiner.page.press("#composerInput", "Enter");
      await inviter.page.waitForFunction(
        (name) => [...document.querySelectorAll(".wave-pill")].some((pill) => pill.textContent.includes(name)),
        joinerNode,
        { timeout: HANDSHAKE_TIMEOUT_MS },
      );

      // Traffic is on the page, not behind devtools.
      const inviterTape = await inviter.page.locator(".tape-row").evaluateAll((rows) => rows.map((row) => row.dataset.type));
      for (const type of ["hello", "peer-list", "sync-request", "sync-response", "op"]) {
        assert.ok(inviterTape.includes(type), `the wire tape shows ${type} traffic; got ${JSON.stringify([...new Set(inviterTape)])}`);
      }
      assert.match(await inviter.page.locator("#tapeTotal").innerText(), /^\d+ messages$/);
      assert.ok(
        (await inviter.page.locator("#tapeMeter .meter-item").count()) >= 4,
        "the meter counts each message type it has seen",
      );

      assert.deepEqual(inviter.consoleErrors, [], "the inviting page logged no errors");
      assert.deepEqual(joiner.consoleErrors, [], "the joining page logged no errors");
    } finally {
      await inviter.context.close();
      await joiner?.context.close();
    }
  },
);

test(
  "a reply the inviter can't use says exactly what was wrong and keeps the text so it can be fixed",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const inviter = await openChatPage(`${server.origin}/chat.html`);
    try {
      const problem = inviter.page.locator("#replyProblem");

      // No invite outstanding yet: a reply cannot belong to anything.
      await inviter.page.click("#shareBtn");
      await inviter.page.waitForFunction(() => document.getElementById("shareLink").value.length > 0, null, { timeout: HANDSHAKE_TIMEOUT_MS });
      const link = await inviter.page.inputValue("#shareLink");
      const offerBlob = new URL(link).searchParams.get("offer");

      await inviter.page.click("#replyBtn");
      await problem.waitFor({ state: "visible" });
      assert.match(await problem.textContent(), /paste their reply here/, "an empty box asks for the reply rather than failing silently");

      await inviter.page.fill("#replyBox", "this is not a blob at all");
      await inviter.page.click("#replyBtn");
      await problem.waitFor({ state: "visible" });
      assert.match(await problem.textContent(), /doesn't look like a complete reply/, "a truncated paste says it looks cut short");
      assert.equal(await inviter.page.inputValue("#replyBox"), "this is not a blob at all", "the text stays so the copy can be fixed");

      await inviter.page.fill("#replyBox", offerBlob);
      await inviter.page.click("#replyBtn");
      await problem.waitFor({ state: "visible" });
      assert.match(await problem.textContent(), /that's an invite, not a reply/, "an invite in the reply box is named as such");

      assert.deepEqual(inviter.consoleErrors, []);
    } finally {
      await inviter.context.close();
    }
  },
);

test(
  "a link that lost part of itself on the way says so instead of loading as an ordinary page",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const joiner = await openChatPage(`${server.origin}/chat.html?offer=eyJ2IjoxLCJraW&world=w1&name=half-a-link`);
    try {
      assert.equal(await joiner.page.locator("#joinCard").isVisible(), true, "a mangled invite still lands on the card");
      assert.match(await joiner.page.locator("#joinEyebrow").textContent(), /didn't arrive in one piece/);
      assert.match(await joiner.page.locator("#joinBody").textContent(), /Ask for it to be sent again/);
      assert.equal(await joiner.page.locator("#joinBtn").isVisible(), false, "there is nothing useful to press");
      assert.deepEqual(joiner.consoleErrors, []);
    } finally {
      await joiner.context.close();
    }
  },
);
