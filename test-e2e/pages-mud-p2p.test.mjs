// mud.html sharing one burrow between two real browsers: the invite link out,
// the reply back, the connection, and then the three things a shared world has
// that a single one does not — a character claimed by exactly one node, that
// node's name on the character's own label wherever it is drawn, and a wave
// that reaches every page watching the room.
//
// The two blobs cross by being read straight out of one page's DOM and typed
// into the other's, never through a real clipboard — that is what a person
// pasting into a message stands in for here.
//
// `iceServers` is empty by design, so both contexts have to find each other on
// host candidates alone. Chromium hides local IPs behind mDNS hostnames by
// default, which two instances on one machine cannot resolve for each other,
// so the launch turns that off — the standard mitigation for a loopback WebRTC
// test rather than anything the transport needs in production.
//
// Which animals a page casts is a live draw, so nothing here assumes a roster
// order: each side reads its own pane's data-character, and recasts until the
// two sides hold the pair the scenario under test needs.
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
// The narrowest draw here is the claim-conflict test's, which waits for one
// named animal out of the burrow's four, so one boot in four. Twenty-four trips
// misses that about once in a thousand runs; sixty-four misses it under once in
// ten million. A boot costs about 60ms and a run stops as soon as it draws what
// it needs, so the extra headroom is only ever spent by a run heading for a
// failure anyway.
const RECAST_TRIES = 64;

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

/** One mud page, booted, cast down to a single animal so the scenario has one
 *  character per node to talk about. */
async function openMudPage(url) {
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
  await page.waitForFunction(
    () => document.querySelector("#window-a-chatq") && !document.querySelector("#window-a-chatq").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors };
}

/** Cast one player and one npc, so each side holds exactly one animal the test
 *  names and one it does not have to reason about. */
async function castOneAnimal(page) {
  await page.locator("#playerCountSlider").fill("0");
  await page.locator("#npcCountSlider").fill("1");
  await page.locator("#npcCountSlider").dispatchEvent("change");
  await waitForCast(page, 1);
  return characterOf(page);
}

async function waitForCast(page, count) {
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

const characterOf = (page) => page.locator("#window-a").getAttribute("data-character");

/** Every animal this page drives, read off its own survey — the pane's own
 *  character AND the npc beside it. A page claims all of them when it shares,
 *  so a scenario about one node's animal showing up on another has to pick an
 *  animal the other node was never driving in the first place. */
const animalsIn = (page) => page.locator("#worldMapBoard .occupant title").allTextContents();

/** Recast until this page's own animal satisfies `wanted`. The draw is random
 *  by design, so the control the page already has for redrawing it is the
 *  honest way to reach a named pair rather than reaching into the engine. */
async function recastUntil(page, wanted) {
  for (let attempt = 0; attempt < RECAST_TRIES; attempt += 1) {
    if (wanted(await characterOf(page))) return characterOf(page);
    await page.locator("#resetBtn").click();
    await waitForCast(page, 1);
  }
  throw new Error("the cast never drew an animal this scenario could use");
}

/** Put this page's own animal in the garden through the world editor, so both
 *  sides start in one room without walking a path a random cast might not
 *  have. The editor is the page's own supported way to write a placement. */
async function standInTheGarden(page, character) {
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

/** Click share and hand back the link it put in its own box. The button
 *  lives in the header chrome, under the sharing overlay whenever that is
 *  open — close the lights-down first, as a person would. */
async function mintInvite(page) {
  if (!(await page.evaluate(() => document.getElementById("netPanel").hidden))) await page.keyboard.press("Escape");
  await page.click("#shareBtn");
  await page.waitForFunction(
    () => document.getElementById("shareLink").value.length > 0,
    null,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
  return page.inputValue("#shareLink");
}

/** The joiner's half through the deck's own JOIN control: paste the invite
 *  that arrived, press one button, take the reply. This is the path for
 *  somebody already digging, so nothing they have opened is thrown away. */
async function replyToInvite(page, invite) {
  if (!(await page.evaluate(() => document.getElementById("netPanel").hidden))) await page.keyboard.press("Escape");
  await page.click("#joinOpenBtn");
  await page.fill("#inviteBox", invite);
  await page.click("#inviteBtn");
  await page.waitForFunction(
    () => document.getElementById("replyOut").value.length > 0,
    null,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
  return page.inputValue("#replyOut");
}

async function waitConnected(side) {
  await side.page.waitForFunction(
    () => document.getElementById("statePill").dataset.tone === "live",
    null,
    { timeout: HANDSHAKE_TIMEOUT_MS },
  );
}

/** Type and submit one command into the first pane's own chat dock. */
async function sendMudCommand(page, text) {
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

test(
  "two browsers share one burrow: each node claims its own animal, they meet in the garden, and each side draws the other's animal labelled with the node playing it",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const inviter = await openMudPage(`${server.origin}/mud.html`);
    let joiner;
    try {
      const inviterAnimal = await castOneAnimal(inviter.page);
      const inviterAnimals = await animalsIn(inviter.page);
      await standInTheGarden(inviter.page, inviterAnimal);

      // The page names itself and its burrow from the graph's own lexicon
      // before anything is shared.
      await inviter.page.click("#statePill");
      const inviterNode = await inviter.page.inputValue("#nodeNameInput");
      const worldName = await inviter.page.inputValue("#worldNameInput");
      assert.match(inviterNode, /^[a-z]+-[a-z]+$/, "this node gets a two-word name from the lexicon");
      assert.match(worldName, /^[a-z]+-[a-z]+$/, "so does the burrow");
      assert.equal(await inviter.page.locator("#statePillWord").textContent(), "not shared");

      const link = await mintInvite(inviter.page);
      assert.ok(link.includes("offer="), "the link carries the offer blob");
      assert.ok(link.includes("mud.html"), "and it comes back to this page, not another one");

      joiner = await openMudPage(`${server.origin}/mud.html`);
      await castOneAnimal(joiner.page);
      const joinerAnimal = await recastUntil(joiner.page, (drawn) => drawn && !inviterAnimals.includes(drawn));
      await standInTheGarden(joiner.page, joinerAnimal);

      const reply = await replyToInvite(joiner.page, link);
      await inviter.page.fill("#replyBox", reply);
      await inviter.page.click("#replyBtn");

      for (const side of [inviter, joiner]) {
        await waitConnected(side);
        assert.equal(await side.page.locator("#statePillWord").textContent(), "connected");
      }
      assert.equal(await inviter.page.inputValue("#replyBox"), "", "a reply that validated clears its box");
      assert.equal(await joiner.page.inputValue("#inviteBox"), "", "and so does the invite the joiner took");

      const joinerNode = await joiner.page.inputValue("#nodeNameInput");
      for (const [label, side] of [["inviter", inviter], ["joiner", joiner]]) {
        await side.page.waitForFunction(
          () => document.querySelectorAll(".node-row").length >= 2,
          null,
          { timeout: HANDSHAKE_TIMEOUT_MS },
        );
        const names = await side.page.locator(".node-row .node-name").allTextContents();
        assert.deepEqual([...names].sort(), [inviterNode, joinerNode].sort(), `the ${label} lists both nodes by name`);
      }

      // The claim: each animal is played from exactly one node, and the other
      // side's room view says which.
      const remoteCard = (page, subject) => page.locator(`#window-a-others .sprite-card[data-subject="${subject}"]`);
      await inviter.page.waitForFunction(
        (subject) => document.querySelector(`#window-a-others .sprite-card[data-subject="${subject}"] .sprite-node`) !== null,
        joinerAnimal,
        { timeout: HANDSHAKE_TIMEOUT_MS },
      );
      assert.equal(
        await remoteCard(inviter.page, joinerAnimal).locator(".sprite-node").textContent(),
        `via ${joinerNode}`,
        "the joiner's animal carries the joiner's node name under its own name",
      );
      assert.equal(
        await inviter.page.locator(`#window-a-self .sprite-card .sprite-node`).count(),
        0,
        "an animal this node plays itself carries no second line at all",
      );

      await joiner.page.waitForFunction(
        (subject) => document.querySelector(`#window-a-others .sprite-card[data-subject="${subject}"] .sprite-node`) !== null,
        inviterAnimal,
        { timeout: HANDSHAKE_TIMEOUT_MS },
      );
      assert.equal(
        await remoteCard(joiner.page, inviterAnimal).locator(".sprite-node").textContent(),
        `via ${inviterNode}`,
        "and the same reading holds from the other side",
      );

      // Talking to another player's character needs nothing new: the ordinary
      // talk verb reads whoever is placed in the room from the shared facts.
      const said = await sendMudCommand(inviter.page, `talk to ${joinerAnimal}`);
      assert.doesNotMatch(said, /don't know the word|unrecognized/i, "the remote animal is an ordinary thing to talk to");
      assert.match(said, new RegExp(joinerAnimal), "and the reply is that animal's own answer");

      assert.deepEqual(inviter.consoleErrors, [], "the inviting page logged no errors");
      assert.deepEqual(joiner.consoleErrors, [], "the joining page logged no errors");
    } finally {
      await inviter.context.close();
      await joiner?.context.close();
    }
  },
);

test(
  "a wave is a fact, so it reaches every page watching the room and puts a hand over the same animal on both",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const inviter = await openMudPage(`${server.origin}/mud.html`);
    let joiner;
    try {
      const inviterAnimal = await castOneAnimal(inviter.page);
      const inviterAnimals = await animalsIn(inviter.page);
      await standInTheGarden(inviter.page, inviterAnimal);
      const link = await mintInvite(inviter.page);

      joiner = await openMudPage(`${server.origin}/mud.html`);
      await castOneAnimal(joiner.page);
      const joinerAnimal = await recastUntil(joiner.page, (drawn) => drawn && !inviterAnimals.includes(drawn));
      await standInTheGarden(joiner.page, joinerAnimal);

      const reply = await replyToInvite(joiner.page, link);
      await inviter.page.fill("#replyBox", reply);
      await inviter.page.click("#replyBtn");
      for (const side of [inviter, joiner]) await waitConnected(side);

      // The waver's own page and every other page watching that room play the
      // same moment — the waver's included.
      await inviter.page.click("#window-a-wave");
      await inviter.page.waitForFunction(
        () => document.querySelector("#window-a-self .sprite-card.waving .wave-hand") !== null,
        null,
        { timeout: ANSWER_TIMEOUT_MS },
      );
      await joiner.page.waitForFunction(
        (subject) => document.querySelector(`#window-a-others .sprite-card[data-subject="${subject}"].waving .wave-hand`) !== null,
        inviterAnimal,
        { timeout: HANDSHAKE_TIMEOUT_MS },
      );

      const waveLine = (await inviter.page.locator("#window-a-chatlog > div").allTextContents()).pop();
      assert.match(waveLine, /you wave\. Everyone in the garden sees it\./, "the log says who saw it, in the room's own name");

      // The typed command is the same action as the button, and it travels the
      // same way back.
      const typed = await sendMudCommand(joiner.page, "wave");
      assert.match(typed, /you wave/, "the typed command is the same gesture");
      await inviter.page.waitForFunction(
        (subject) => document.querySelector(`#window-a-others .sprite-card[data-subject="${subject}"].waving .wave-hand`) !== null,
        joinerAnimal,
        { timeout: HANDSHAKE_TIMEOUT_MS },
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
  "two nodes claiming one animal settle on the first claim, and the node that lost it stops taking its turns",
  { timeout: TEST_TIMEOUT_MS },
  async () => {
    const inviter = await openMudPage(`${server.origin}/mud.html`);
    let joiner;
    try {
      const animal = await castOneAnimal(inviter.page);
      await inviter.page.click("#statePill");
      const inviterNode = await inviter.page.inputValue("#nodeNameInput");
      const link = await mintInvite(inviter.page);

      joiner = await openMudPage(`${server.origin}/mud.html`);
      await castOneAnimal(joiner.page);
      // Both sides holding the SAME animal is the conflict under test, so this
      // one recasts until it matches rather than until it differs.
      await recastUntil(joiner.page, (drawn) => drawn === animal);

      const reply = await replyToInvite(joiner.page, link);
      await inviter.page.fill("#replyBox", reply);
      await inviter.page.click("#replyBtn");
      for (const side of [inviter, joiner]) await waitConnected(side);

      // The inviter claimed first, when it pressed share, so the inviter keeps
      // the animal and the joiner's pane says where it is played from.
      await joiner.page.waitForFunction(
        () => !document.getElementById("window-a-node").hidden,
        null,
        { timeout: HANDSHAKE_TIMEOUT_MS },
      );
      assert.equal(
        await joiner.page.locator("#window-a-node").textContent(),
        `played from ${inviterNode}`,
        "the pane names the node the animal is actually played from",
      );
      assert.equal(
        await joiner.page.locator("#window-a").getAttribute("class"),
        "mud-window pane-a remote",
        "and the pane itself reads as somebody else's",
      );

      const turnsBefore = await joiner.page.locator("#window-a-turn").textContent();
      const refusal = await sendMudCommand(joiner.page, "look");
      assert.match(refusal, new RegExp(`${animal} is played from ${inviterNode}`), "a command here is refused, and says why");
      assert.match(refusal, /watch it and wave at it/, "and says what is still possible");
      assert.equal(await joiner.page.locator("#window-a-turn").textContent(), turnsBefore, "a refused command costs no turn");

      assert.equal(
        await inviter.page.locator("#window-a-node").isVisible(),
        false,
        "the node that won the claim shows no such line",
      );

      assert.deepEqual(inviter.consoleErrors, [], "the inviting page logged no errors");
      assert.deepEqual(joiner.consoleErrors, [], "the joining page logged no errors");
    } finally {
      await inviter.context.close();
      await joiner?.context.close();
    }
  },
);
