// spider-fly-viz: renderSpiderFlyHtml is a pure string builder — no engine
// state is embedded (it all arrives live via the sibling browser bundle), so
// these tests pin the page's STRUCTURE: the grid, the play/pause/step/reset
// controls, the chat dock markup, the preview-mode hook, and the
// self-contained-page invariants plan-viz.test.mjs itself already checks for
// its own render function (no external resource loads, both theme schemes,
// reduced-motion respected).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSpiderFlyHtml, threadCellsForSpiderPlan, facingDegreesFor, nextCorpses } from "../../src/services/spider-fly-viz.mjs";
import { GRID_SIZE, cellId, parseCellId, DIRECTION_DELTA, agentKindOf } from "../../src/domain/spider-fly-world.mjs";

const GEOMETRY = { parseCellId, cellId, directionDelta: DIRECTION_DELTA };

function embeddedJson(html, name) {
  const m = new RegExp(`const ${name} = (.*);`).exec(html);
  assert.ok(m, `const ${name} = ...; not found in the rendered page`);
  return JSON.parse(m[1]);
}

// ---- agentKindOf (spider-fly-world.mjs) / threadCellsForSpiderPlan
// (spider-fly-viz.mjs): pure render-glue pieces extracted as real exports
// (not raw inline-script text) so they can be pinned directly, the same
// discipline ledger-viz.mjs holds its own spliced helpers (facetCounts,
// resolveAnsweredTerm) to.

test("agentKindOf strips the trailing individual number, whatever it is", () => {
  assert.equal(agentKindOf("spider-1"), "spider");
  assert.equal(agentKindOf("spider-12"), "spider");
  assert.equal(agentKindOf("fly-3"), "fly");
  assert.equal(agentKindOf("egg-1"), "egg");
});

test("threadCellsForSpiderPlan returns null for a spider with no plan (the common greedy-approach tick)", () => {
  const agents = {
    "spider-1": { cell: "cell-2-3", plan: null },
    "fly-1": { cell: "cell-8-8" },
  };
  assert.equal(threadCellsForSpiderPlan(agents, GEOMETRY), null);
});

test("threadCellsForSpiderPlan reconstructs the REMAINING path from the spider's post-move cell — plan[0] was already consumed this tick", () => {
  // findActionPath found ["west", "west"] from cell-5-2 toward the web; the
  // spider has already taken the first step this tick, landing at cell-4-2 —
  // the thread must start there and apply only the REMAINING direction.
  const agents = {
    "spider-1": { cell: "cell-4-2", plan: ["west", "west"] },
  };
  assert.deepEqual(threadCellsForSpiderPlan(agents, GEOMETRY), ["cell-4-2", "cell-3-2"]);
});

test("threadCellsForSpiderPlan returns null for a single-step plan — nothing left to draw once the spider arrives", () => {
  const agents = { "spider-1": { cell: "cell-3-2", plan: ["west"] } };
  assert.equal(threadCellsForSpiderPlan(agents, GEOMETRY), null);
});

test("threadCellsForSpiderPlan skips a fly's plan field entirely (flies never carry one) and finds the first spider with a real plan", () => {
  const agents = {
    "fly-1": { cell: "cell-9-9", plan: ["north"] }, // never real, but even if present, ignored
    "spider-1": { cell: "cell-2-2", plan: null },
    "spider-2": { cell: "cell-6-6", plan: ["east", "north"] },
  };
  // plan[0] ("east") was already consumed reaching cell-6-6 this tick; the
  // remaining ["north"] decreases y (DIRECTION_DELTA's own convention).
  assert.deepEqual(threadCellsForSpiderPlan(agents, GEOMETRY), ["cell-6-6", "cell-6-5"]);
});

test("renderSpiderFlyHtml: the 10x10 grid canvas and its geometry are embedded", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /<canvas id="board"/);
  const data = embeddedJson(html, "SPIDERFLY");
  assert.equal(data.gridSize, GRID_SIZE);
  assert.equal(data.webCells.length, 9, "a Chebyshev-radius-1 web block around one home cell is a 3x3 = 9 cells");
  assert.ok(data.webCells.every((c) => /^cell-\d+-\d+$/.test(c)));
});

test("renderSpiderFlyHtml: the play/pause/step/reset controls are all present", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /id="playBtn"/);
  assert.match(html, /id="stepBtn"/);
  assert.match(html, /id="resetBtn"/);
  assert.match(html, /id="turnLabel"/);
  assert.match(html, />play<\/button>|play<\/button>/);
});

test("renderSpiderFlyHtml: the chat dock markup is present, wired to session.turn", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /id="chatform"/);
  assert.match(html, /id="chatq"/);
  assert.match(html, /id="chatlog"/);
  assert.match(html, /session\.turn\(/, "the dock submits through the live chat turn engine");
});

test("renderSpiderFlyHtml: the chat dock offers addressee and direction pills with canned, grammar-accepted text", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /id="chatpills"/);
  assert.match(html, /data-role="addr" data-addressee="spider"[^>]*>@spider</);
  assert.match(html, /data-role="addr" data-addressee="fly"[^>]*>@fly</);
  for (const direction of ["north", "south", "east", "west"]) {
    const re = new RegExp(`data-role="dir" data-direction="${direction}"[^>]*>the fly is ${direction}<`);
    assert.match(html, re, `a ${direction} completion pill is present, defaulting to the fly as the subject`);
  }
});

test("renderSpiderFlyHtml: every chat pill starts disabled, the same posture as #chatq before the session boots", () => {
  const html = renderSpiderFlyHtml();
  const pillsBlock = html.match(/<div class="chatpills"[\s\S]*?<\/div>/)[0];
  const buttons = [...pillsBlock.matchAll(/<button[^>]*>/g)].map(([b]) => b);
  assert.equal(buttons.length, 6, "two addressee pills plus four direction pills");
  assert.ok(buttons.every((b) => /\bdisabled\b/.test(b)), "every pill is disabled until the session boots, mirroring #chatq");
});

test("renderSpiderFlyHtml: clicking a pill never wires a form submit — only fill/focus behaviour on #chatq", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /addressPillEls/);
  assert.match(html, /directionPillEls/);
  assert.match(html, /chatqEl\.focus\(\)/);
  // The pill-click handlers set/append chatqEl.value directly; none of them
  // call chatformEl.requestSubmit or dispatch a submit event.
  assert.ok(!/directionPillEls[\s\S]{0,400}requestSubmit/.test(html));
});

test("renderSpiderFlyHtml: the chat pills sit inside .side, so they are hidden by the same body.preview rule as the rest of the chat dock", () => {
  const html = renderSpiderFlyHtml();
  const sideBlock = html.match(/<aside class="side"[\s\S]*?<\/aside>/)[0];
  assert.match(sideBlock, /id="chatpills"/, "the pills render inside the .side aside, not as a preview-mode exception");
  assert.match(html, /body\.preview \.side,[^{]*\{ display: none; \}/, "the existing hiding rule still targets .side as a whole");
});

test("renderSpiderFlyHtml: the left column stacks the controls strip, the board and the tuning console in that order, the chat/agents column beside them", () => {
  const html = renderSpiderFlyHtml();
  const stageBlock = html.match(/<div class="stage">[\s\S]*?<\/aside>\s*<\/div>/)[0];
  const leftBlock = stageBlock.match(/<div class="stage-left">[\s\S]*?<aside/)[0];
  assert.match(leftBlock, /class="controls-panel"/, "the controls strip renders in the left column");
  assert.match(leftBlock, /class="board-frame"/, "the board renders in the left column");
  assert.match(leftBlock, /class="tuning"/, "the tuning console renders in the left column");
  assert.ok(
    leftBlock.indexOf('class="controls-panel"') < leftBlock.indexOf('class="board-frame"'),
    "the controls strip sits above the board, in the tuning console's former place",
  );
  assert.ok(
    leftBlock.indexOf('class="board-frame"') < leftBlock.indexOf('class="tuning"'),
    "the tuning console now sits below the board",
  );
  assert.ok(
    stageBlock.indexOf('class="stage-left"') < stageBlock.indexOf('<aside class="side"'),
    "the left column comes first, the side column second",
  );
  assert.match(html, /\.stage \{[^}]*grid-template-columns: minmax\(0, 8fr\) minmax\(280px, 3fr\)/, "the row splits roughly two-thirds to a quarter");
});

test("renderSpiderFlyHtml: the controls strip and the tuning console both match the board's own fixed width", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /\.tuning, \.controls-panel, \.head-inner \{ width: \d+px/, "one shared rule sizes both strips, and the header column, to the board");
});

test("renderSpiderFlyHtml: within the side column the chat dock comes first, the agents HUD below it", () => {
  const html = renderSpiderFlyHtml();
  const sideBlock = html.match(/<aside class="side"[\s\S]*?<\/aside>/)[0];
  assert.ok(
    sideBlock.indexOf('class="chat"') < sideBlock.indexOf('class="hud"'),
    "chat renders above the agents HUD",
  );
});

test("renderSpiderFlyHtml: the HUD panel and the POV overlay canvas are both present", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /id="hud"/);
  assert.match(html, /id="pov"/);
  assert.match(html, /visibleCells/, "the POV overlay reads the engine's own visibility primitive");
});

test("renderSpiderFlyHtml: the sprite layer resolves each agent's class through the property-aware resolver, falling back to the shared registry", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /resolveSpriteAsset/);
  assert.match(html, /SPRITE_REGISTRY/);
  assert.match(html, /id="spriteLayer"/);
});

test("renderSpiderFlyHtml: the sprite template set is embedded as page data, defaulting to an empty array", () => {
  const data = embeddedJson(renderSpiderFlyHtml(), "SPIDERFLY");
  assert.deepEqual(data.spriteTemplates, []);
});

test("renderSpiderFlyHtml: a passed-in spriteTemplates array is embedded verbatim", () => {
  const templates = [{ classes: ["spider"], svg: "<svg>spider</svg>" }];
  const data = embeddedJson(renderSpiderFlyHtml({ spriteTemplates: templates }), "SPIDERFLY");
  assert.deepEqual(data.spriteTemplates, templates);
});

test("renderSpiderFlyHtml: the silk-thread signature element is drawn from the spider's own plan", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /threadCellsFor/);
  assert.match(html, /DIRECTION_DELTA/);
});

test("renderSpiderFlyHtml: the shared ticker is spliced in, not re-implemented", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /const createTicker = /);
  assert.match(html, /createTicker\(\{/);
});

test("renderSpiderFlyHtml: the sprite's expression comes from the engine's own mood word, never from re-reading its goal sentence", () => {
  const html = renderSpiderFlyHtml();
  // The mgx:feels row itself is built inside the shared sprite resolver now, so
  // what the page supplies is the mood WORD — still the engine's own, never derived.
  assert.match(html, /return \(agent && agent\.mood\) \|\| moodByAgent\[id\] \|\| "calm";/, "the expression the sprite resolver is asked for is the engine's structured mood");
  assert.doesNotMatch(html, /goal\.startsWith\(/, "no page code parses the engine's rendered goal prose back apart");
  assert.doesNotMatch(html, /const emotionFor = /, "the prose-matching emotion derivation is gone, not merely unused");
});

test("renderSpiderFlyHtml: the page references its sibling bundle by a same-origin relative path only", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /<script src="\.\/spider-fly-browser\.bundle\.js"><\/script>/);
  assert.ok(!/(?:src|href)=["']https?:/.test(html), "no external resource loads");
});

test("renderSpiderFlyHtml: preview mode is a runtime query-param switch, not a second build path", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /previewMaxTurns/);
  assert.match(html, /get\("preview"\)/);
  assert.match(html, /classList\.toggle\("preview"/);
});

// ---- the header column, aligned to the board's own left edge ------------

test("renderSpiderFlyHtml: the eyebrow and h1 sit inside .head-inner, itself inside a .page-head row above the real board stage", () => {
  const html = renderSpiderFlyHtml();
  const headBlock = html.match(/<div class="stage page-head">[\s\S]*?<\/div>\s*<\/div>/)[0];
  assert.match(headBlock, /<div class="head-inner">[\s\S]*<div class="eyebrow">/);
  assert.match(headBlock, /<h1>Multiple competing planning agents<\/h1>/);
});

test("renderSpiderFlyHtml: the literal <div class=\"stage\"> selector still uniquely finds the real board stage, not the header row", () => {
  const html = renderSpiderFlyHtml();
  const occurrences = html.split('<div class="stage">').length - 1;
  assert.equal(occurrences, 1, "the header row carries the extra page-head class, so the bare selector never doubles up");
});

test("renderSpiderFlyHtml: the header row is hidden in preview mode alongside the rest of the chrome", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /body\.preview \.page-head \{ display: none; \}/);
});

test("renderSpiderFlyHtml: self-contained, reduced-motion respected, both theme schemes present", () => {
  const html = renderSpiderFlyHtml();
  assert.ok(html.includes("prefers-reduced-motion"));
  assert.ok(html.includes("prefers-color-scheme: dark"));
  assert.ok(html.includes('data-theme="dark"') && html.includes('data-theme="light"'));
  assert.ok(!html.includes("color-mix("));
});

test("renderSpiderFlyHtml: escapes a custom title", () => {
  const html = renderSpiderFlyHtml({ title: 'a <script>alert(1)</script> title' });
  assert.ok(!html.includes("<script>alert(1)</script> title"));
  assert.match(html, /&lt;script&gt;/);
});

test("renderSpiderFlyHtml: deterministic — byte-identical output for identical input", () => {
  assert.equal(renderSpiderFlyHtml(), renderSpiderFlyHtml());
});

test("renderSpiderFlyHtml: each agent's HUD row can carry a mass bar, scaled against the real fly/spider mass constants", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /meter-track/, "the mass bar's track element is drawn, via the shared meterBarHtml");
  assert.match(html, /meter-fill/);
  assert.match(html, /maxFlyMass/);
  assert.match(html, /maxSpiderMass/);
  const data = embeddedJson(html, "SPIDERFLY");
  assert.equal(typeof data.maxFlyMass, "number");
  assert.equal(typeof data.maxSpiderMass, "number");
});

test("renderSpiderFlyHtml: an active dynamic web is drawn distinctly from the static home zone (a different fill/stroke, threaded through every redraw call)", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /activeWebs/, "activeWebs threads through tick()/snapshot()/boot into drawBoard");
  assert.match(html, /--alert-soft/, "the dynamic web fill is a different token than the static zone's --taught-soft");
  assert.match(html, /setLineDash/, "a dashed outline further distinguishes a live dynamic web from the plain-filled static zone");
});

test("renderSpiderFlyHtml: the spider's mass bar scales against the egg-lay threshold, not its own flat starting mass — progress toward the new mass-gated lay mechanic is the meaningful cap now", () => {
  const data = embeddedJson(renderSpiderFlyHtml(), "SPIDERFLY");
  assert.equal(data.maxSpiderMass, 25, "DEFAULT_GAME_CONFIG.spiderFly.eggLayMassThreshold");
});

// ---- facingDegreesFor: plan-driven sprite orientation -------------------

test("facingDegreesFor maps every compass direction to its rotation, and defaults to north/0 with no plan and no prior facing", () => {
  assert.equal(facingDegreesFor(["north"], undefined), 0);
  assert.equal(facingDegreesFor(["east"], undefined), 90);
  assert.equal(facingDegreesFor(["south"], undefined), 180);
  assert.equal(facingDegreesFor(["west"], undefined), 270);
  assert.equal(facingDegreesFor(null, undefined), 0, "no plan and no prior facing at all — the art's own default north/up pose");
  assert.equal(facingDegreesFor([], undefined), 0);
});

test("facingDegreesFor keeps the previous facing when the agent holds still this tick, never snapping back to a default", () => {
  assert.equal(facingDegreesFor([], 270), 270, "an empty plan (holding) keeps whatever it was last facing");
  assert.equal(facingDegreesFor(null, 90), 90);
  assert.equal(facingDegreesFor(["east"], 270), 90, "a real plan step always overrides the previous facing");
});

// ---- nextCorpses: visual-only dying-agent bookkeeping --------------------

test("nextCorpses adds a corpse for an agent present last tick but absent this tick, at its last-known cell and class", () => {
  const prevAgents = { "fly-1": { cell: "cell-4-4" }, "spider-1": { cell: "cell-2-2" } };
  const agents = { "spider-1": { cell: "cell-2-2" } }; // fly-1 died this tick
  const corpses = nextCorpses({}, prevAgents, agents, 7);
  assert.deepEqual(corpses, { "fly-1": { cls: "fly", cell: "cell-4-4", diedAtTurn: 7 } });
});

test("nextCorpses never adds an entry for an agent still present, and prunes a corpse once it's older than lingerTurns past its own death turn", () => {
  const stillAlive = nextCorpses({}, { "fly-1": { cell: "cell-4-4" } }, { "fly-1": { cell: "cell-4-5" } }, 3);
  assert.deepEqual(stillAlive, {}, "fly-1 is still in agents — not a corpse");

  const priorCorpses = { "fly-1": { cls: "fly", cell: "cell-4-4", diedAtTurn: 5 } };
  const stillLingering = nextCorpses(priorCorpses, {}, {}, 5 + 4, 4);
  assert.deepEqual(stillLingering, priorCorpses, "exactly at the linger boundary — still drawn");

  const rotted = nextCorpses(priorCorpses, {}, {}, 5 + 5, 4);
  assert.deepEqual(rotted, {}, "one turn past the linger boundary — the carcass has rotted, no longer drawn");
});

test("nextCorpses carries an existing corpse forward unchanged (same death cell/turn) while a different agent freshly dies alongside it", () => {
  const priorCorpses = { "fly-1": { cls: "fly", cell: "cell-4-4", diedAtTurn: 2 } };
  const prevAgents = { "fly-1": { cell: "cell-4-4" }, "spider-2": { cell: "cell-9-9" } };
  const corpses = nextCorpses(priorCorpses, prevAgents, {}, 3, 4);
  assert.deepEqual(corpses, {
    "fly-1": { cls: "fly", cell: "cell-4-4", diedAtTurn: 2 },
    "spider-2": { cls: "spider", cell: "cell-9-9", diedAtTurn: 3 },
  });
});

// ---- corpses, facing and the sprite-face wrapper, in the rendered page --

test("renderSpiderFlyHtml: sprite facing rotates an inner .sprite-face wrapper, never the outer positioned .sprite node", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /face\.className = "sprite-face"/, "the sprite SVG is wrapped in its own rotatable node, built at runtime (sprites are created dynamically, never present in the static markup)");
  assert.match(html, /facingDegreesFor/);
  assert.match(html, /facingByAgent/);
});

test("renderSpiderFlyHtml: corpses are spliced in as a real, independently-tested helper and rendered into the same sprite layer, grayscaled", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /const nextCorpses = /);
  assert.match(html, /renderCorpses/);
  assert.match(html, /sprite corpse/);
  assert.match(html, /\.sprite\.corpse\s*\{[^}]*grayscale/, "the corpse CSS rule grayscales the sprite");
});

// ---- the dynamic deception-pill rail ---------------------------------

test("renderSpiderFlyHtml: a dynamic pill container sits alongside the existing static 6-button rail, driven by pillsForSpiderFly", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /id="dynamicPills"/);
  assert.match(html, /pillsForSpiderFly/);
  assert.match(html, /id="chatpills"/, "the original static rail is still present, not replaced");
});

test("renderSpiderFlyHtml: a dynamic claim pill fills #chatq from its own data-sentence on click, the same click-to-fill discipline as every other pill", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /data-sentence/);
  assert.match(html, /dynamicPillsEl\.addEventListener\("click"/);
  assert.ok(!/dynamicPillsEl[\s\S]{0,400}requestSubmit/.test(html), "a claim pill click never auto-submits the form");
});

// ---- live per-class tuning controls ------------------------------------

test("renderSpiderFlyHtml: six live tuning sliders exist, one each for mass-loss-rate/spawn-rate/vision-radius per class, all starting disabled", () => {
  const html = renderSpiderFlyHtml();
  for (const id of ["ctlSpiderMass", "ctlSpiderSpawn", "ctlSpiderVision", "ctlFlyMass", "ctlFlySpawn", "ctlFlyVision"]) {
    const re = new RegExp(`<input type="range" id="${id}"[^>]*disabled>`);
    assert.match(html, re, `${id} is present and starts disabled, like every other live control before the session boots`);
  }
});

test("renderSpiderFlyHtml: the tuning sliders write straight through session.setConfig, and persist across a reset instead of reverting to defaults", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /session\.setConfig/);
  assert.match(html, /tuningInitialized/);
});

test("renderSpiderFlyHtml: the tuning panel is hidden in preview mode, alongside the side column and the play/pause/step controls", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /body\.preview \.side,[^{]*\.tuning \{ display: none; \}/);
});

// ---- the fixed-height, internally-scrolling agents panel ----------------

test("renderSpiderFlyHtml: the agents panel has a fixed max-height with internal scroll, never growing the page as the roster spikes (a hatch can mint several spiders at once)", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /\.hud-list\s*\{[^}]*max-height[^}]*overflow-y:\s*auto/);
  assert.match(html, /class="hud-list" id="hud"/);
});

// ---- per-agent plan and belief lines (§A.2.7) ----------------------------

test("renderSpiderFlyHtml: each agent's HUD row renders its own last-created plan and current believed world state", () => {
  const html = renderSpiderFlyHtml();
  assert.match(html, /hud-plan/);
  assert.match(html, /hud-belief/);
  assert.match(html, /planLineHtml/);
  assert.match(html, /beliefLineHtml/);
});
