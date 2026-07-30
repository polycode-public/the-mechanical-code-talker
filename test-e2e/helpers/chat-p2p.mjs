// The moves a chat.html P2P scenario is made of: open a page, mint an invite,
// answer one, paste the reply back, ask a question, read who is connected.
// Every one of them drives real controls on the page and a real WebRTC
// connection between real browser contexts — nothing here mocks a transport.
//
// The blobs cross by being read straight out of one context's DOM and typed
// into another's, never through a real clipboard. That is what a person
// pasting into a message stands in for, and a clipboard would only add a
// permission prompt to the thing under test.
//
// `iceServers` is empty by design (the page's own choice), so contexts have to
// find each other on host candidates alone. Chromium hides local IPs behind
// mDNS hostnames by default, which two instances on one machine cannot resolve
// for each other, so `launchP2pBrowser` turns that off — the standard
// mitigation for a loopback WebRTC test rather than anything the transport
// needs in production.
import { chromium } from "playwright";

export const READY_TIMEOUT_MS = 30_000;
export const HANDSHAKE_TIMEOUT_MS = 60_000;
export const ANSWER_TIMEOUT_MS = 30_000;
export const TEST_TIMEOUT_MS = 300_000;

export const launchP2pBrowser = () =>
  chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });

/** A fresh browser context holding one chat page, booted and ready. A context
 *  of its own is what makes each peer a separate device: separate storage,
 *  separate identity, separate WebRTC stack. */
export async function openChatPage({ browser, origin, url }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const source = msg.location()?.url ?? "";
    if (source && !source.startsWith(origin)) return;
    consoleErrors.push(msg.text());
  });
  await page.goto(url ?? `${origin}/chat.html`, { waitUntil: "networkidle" });
  await waitForChatBoot(page);
  return { context, page, consoleErrors };
}

/** Wait for the engine behind the composer, which is also what a reload has to
 *  wait for again before the same page can be asked anything. */
export async function waitForChatBoot(page) {
  await page.waitForFunction(() => window.tmctChatReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
  await page.evaluate(() => window.tmctChatReady);
}

/** Submit through the live composer and return the settled assistant row. */
export async function askChat(page, question) {
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

export const answerText = (row) => row.locator(".bubble").innerText();

/** Click "invite someone" and hand back the link it copied into its own box.
 *  Each link completes exactly one connection, so a page inviting a second
 *  person writes a new blob over the old one — waiting for the box to *change*
 *  rather than to be non-empty is what stops a scenario handing out a link
 *  somebody has already used. */
export async function mintInvite(page) {
  const previous = await page.inputValue("#shareLink");
  // The invite button lives in the page chrome, under the sharing overlay
  // whenever that is open — close the lights-down first, as a person would.
  if (!(await page.evaluate(() => document.getElementById("netPanel").hidden))) await page.keyboard.press("Escape");
  await page.click("#shareBtn");
  await page.waitForFunction(
    (was) => {
      const link = document.getElementById("shareLink").value;
      return link.length > 0 && link !== was;
    },
    previous,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
  return page.inputValue("#shareLink");
}

/** The join card's own half: press the one button it offers and take the reply
 *  it produces, the way somebody who followed an invite link would. */
export async function replyFromJoinCard(page) {
  await page.click("#joinBtn");
  await page.waitForFunction(
    () => document.getElementById("joinReply").value.length > 0,
    null,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
  return page.inputValue("#joinReply");
}

/** Paste a reply into the page that minted the invite it answers. */
export async function acceptReply(page, reply) {
  await page.fill("#replyBox", reply);
  await page.click("#replyBtn");
}

export const nodeNameOf = (page) => page.inputValue("#nodeNameInput");

export const myPeerId = (page) => page.evaluate(() => window.tmctP2pRoom?.peerId ?? null);

/** Who this page holds a live channel to right now. The room only ever records
 *  a peer it has its own transport for, so this list is direct connections and
 *  nothing else — a peer reachable only through somebody else never appears. */
export const connectedPeerIds = (page) =>
  page.evaluate(() => (window.tmctP2pRoom ? window.tmctP2pRoom.peers().filter((p) => p.connected).map((p) => p.peerId) : []));

export async function waitForConnectedPeerCount(page, count) {
  await page.waitForFunction(
    (n) => !!window.tmctP2pRoom && window.tmctP2pRoom.peers().filter((p) => p.connected).length === n,
    count,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
}

/** Every wire message type this page has sent or received, from the tape it
 *  draws on screen rather than from anything private. */
export const wireTypes = async (page, direction) =>
  page.locator(direction ? `.tape-row[data-dir="${direction}"]` : ".tape-row")
    .evaluateAll((rows) => [...new Set(rows.map((row) => row.dataset.type))]);

/** One whole manual exchange: a page mints an invite, a brand-new context
 *  opens it, presses the one button on the join card, and its reply is pasted
 *  back where the invite came from. */
export async function inviteNewPeer({ browser, origin, inviterPage }) {
  const link = await mintInvite(inviterPage);
  const joiner = await openChatPage({ browser, origin, url: link });
  const reply = await replyFromJoinCard(joiner.page);
  await acceptReply(inviterPage, reply);
  return { joiner, link, reply };
}
