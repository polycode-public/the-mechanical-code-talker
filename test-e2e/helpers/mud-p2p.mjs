// The moves a mud.html P2P scenario is made of: open a burrow, cast one
// animal, stand it somewhere both sides can see, mint an invite, answer one,
// paste a reply back. Every one drives the page's own controls over a real
// WebRTC connection between real browser contexts.
//
// The blobs cross by being read straight out of one context's DOM and typed
// into another's, never through a real clipboard — that is what a person
// pasting into a message stands in for.
//
// The page now defaults to a public STUN server (DEFAULT_ICE_SERVERS,
// webrtc-transport.mjs), but this suite still runs same-engine Chromium
// contexts on host candidates: Chromium hides local IPs behind mDNS hostnames
// by default, which two instances on one machine cannot resolve for each
// other, so `launchP2pBrowser` turns that off — a loopback-test mitigation,
// not something a real user's browser gets to opt into, which is exactly the
// gap the STUN default now covers in production.
//
// Which animals a page casts is a live draw, so nothing here assumes a roster
// order: `recastUntil` uses the page's own reset control to redraw until the
// cast suits the scenario.
import { chromium } from "playwright";

export const READY_TIMEOUT_MS = 30_000;
export const HANDSHAKE_TIMEOUT_MS = 60_000;
export const ANSWER_TIMEOUT_MS = 30_000;
export const TEST_TIMEOUT_MS = 300_000;
// The narrowest draw a scenario here waits on is one named animal out of the
// burrow's four, so one boot in four. Twenty-four trips misses that about once
// in a thousand runs; sixty-four misses it under once in ten million. A boot
// costs about 60ms and a run stops as soon as it draws what it needs, so the
// extra headroom is only ever spent by a run that was going to fail anyway.
const RECAST_TRIES = 64;

export const launchP2pBrowser = () =>
  chromium.launch({ args: ["--disable-features=WebRtcHideLocalIpsWithMdns"] });

/** One mud page in a context of its own, booted and taking commands. */
export async function openMudPage({ browser, origin, url }) {
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
  await page.goto(url ?? `${origin}/mud.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#window-a-chatq") && !document.querySelector("#window-a-chatq").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors };
}

export async function waitForCast(page, count) {
  await page.waitForFunction(
    (n) => {
      const inputs = [...document.querySelectorAll(".mud-window input[type=text]")];
      return document.getElementById("mudStage").getAttribute("data-panes") === String(n)
        && inputs.length === n && inputs.every((i) => !i.disabled)
        && (document.querySelector("#window-a").getAttribute("data-character") || "").length > 0;
    },
    count,
    { timeout: READY_TIMEOUT_MS },
  );
}

export const characterOf = (page) => page.locator("#window-a").getAttribute("data-character");

/** Every animal this page drives, read off its own survey. A page claims all of
 *  them when it shares, so a scenario about one node's animal appearing on
 *  another has to pick an animal the other node was never driving. */
export const animalsIn = (page) => page.locator("#worldMapBoard .occupant title").allTextContents();

/** Cast one player and one npc, so each side holds exactly one animal the
 *  scenario names. */
export async function castOneAnimal(page) {
  await page.locator("#playerCountSlider").fill("0");
  await page.locator("#npcCountSlider").fill("1");
  await page.locator("#npcCountSlider").dispatchEvent("change");
  await waitForCast(page, 1);
  return characterOf(page);
}

/** Recast until this page's whole draw suits the scenario. `wanted` gets the
 *  animal in the pane and every animal the page holds, because a page claims
 *  all of them when it shares, so where the npc landed decides what is left
 *  over for the pages that come after. A scenario that only cares about the
 *  pane can ignore the second argument. The draw is random by design, so the
 *  page's own redraw control is the way to reach a named cast rather than
 *  reaching into the engine.
 *
 *  A run that never finds its cast reports what it drew instead. The failure
 *  worth telling apart is a scenario asking for more distinct animals than the
 *  roster can spare, and the draws are what show it. */
export async function recastUntil(page, wanted) {
  const drawn = [];
  for (let attempt = 0; attempt < RECAST_TRIES; attempt += 1) {
    const character = await characterOf(page);
    const held = await animalsIn(page);
    if (wanted(character, held)) return character;
    drawn.push(`${character} with ${held.join("+")}`);
    await page.locator("#resetBtn").click();
    await waitForCast(page, 1);
  }
  throw new Error(
    `${RECAST_TRIES} resets never drew a cast this scenario could use; drew ${drawn.join(", ")}`,
  );
}

/** Put this page's own animal in the garden through the world editor, so every
 *  side starts in one room without walking a path a random cast might not have.
 *  The editor is the page's own supported way to write a placement. */
export async function standInTheGarden(page, character) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(
    () => document.body.classList.contains("editing")
      && (document.getElementById("editorText")?.value ?? "").length > 0,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  const seeded = await page.locator("#editorText").inputValue();
  await page.locator("#editorText").fill(`${seeded}\n${character} stands in the garden.\n`);
  await page.waitForFunction(
    () => (document.getElementById("editorStatus")?.textContent ?? "").includes("synced"),
    null,
    { timeout: ANSWER_TIMEOUT_MS },
  );
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });
}

/** Click share and hand back the link it put in its own box. Each link
 *  completes one connection, so a page inviting a second person writes a new
 *  blob over the old one — this waits for the box to change rather than to be
 *  non-empty, so a scenario never hands out a link somebody already used. */
export async function mintInvite(page) {
  const previous = await page.inputValue("#shareLink");
  // The share button lives in the header chrome, under the sharing overlay
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

/** The joiner's half through the deck's own JOIN control: paste the invite that
 *  arrived, press one button, take the reply. This is the path for somebody
 *  already digging, so nothing they have opened is thrown away. */
export async function replyToInvite(page, invite) {
  const previous = await page.inputValue("#replyOut");
  if (!(await page.evaluate(() => document.getElementById("netPanel").hidden))) await page.keyboard.press("Escape");
  await page.click("#joinOpenBtn");
  await page.fill("#inviteBox", invite);
  await page.click("#inviteBtn");
  await page.waitForFunction(
    (was) => {
      const reply = document.getElementById("replyOut").value;
      return reply.length > 0 && reply !== was;
    },
    previous,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
  return page.inputValue("#replyOut");
}

/** Paste a reply into the page that minted the invite it answers. */
export async function acceptReply(page, reply) {
  await page.fill("#replyBox", reply);
  await page.click("#replyBtn");
}

export const nodeNameOf = (page) => page.inputValue("#nodeNameInput");

export const myPeerId = (page) => page.evaluate(() => window.tmctP2pRoom?.peerId ?? null);

/** Who this page holds a live channel to right now. The room only records a
 *  peer it has its own transport for, so this is direct connections and nothing
 *  else — a peer reachable only through somebody else never appears. */
export const connectedPeerIds = (page) =>
  page.evaluate(() => (window.tmctP2pRoom ? window.tmctP2pRoom.peers().filter((p) => p.connected).map((p) => p.peerId) : []));

export async function waitForConnectedPeerCount(page, count) {
  await page.waitForFunction(
    (n) => !!window.tmctP2pRoom && window.tmctP2pRoom.peers().filter((p) => p.connected).length === n,
    count,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
}

/** Type and submit one command into the first pane's own chat dock. */
export async function sendMudCommand(page, text) {
  const logSelector = "#window-a-chatlog > div";
  const before = await page.locator(logSelector).count();
  await page.locator("#window-a-chatq").fill(text);
  await page.locator("#window-a-chatq").press("Enter");
  await page.waitForFunction(
    ({ sel, n }) => document.querySelectorAll(sel).length >= n,
    { sel: logSelector, n: before + 2 },
    { timeout: ANSWER_TIMEOUT_MS },
  );
  const lines = await page.locator(logSelector).allTextContents();
  return lines[lines.length - 1];
}
