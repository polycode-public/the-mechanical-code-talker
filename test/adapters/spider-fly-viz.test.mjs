// spider-fly-viz: renderSpiderFlyHtml is a pure string builder — no engine
// state is embedded (it all arrives live via the sibling browser bundle), so
// these tests pin the page's STRUCTURE: the grid, the play/pause/step/reset
// controls, the chat dock markup, the preview-mode hook, and the
// self-contained-page invariants plan-viz.test.mjs itself already checks for
// its own render function (no external resource loads, both theme schemes,
// reduced-motion respected).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSpiderFlyHtml, classOfAgentId, threadCellsForSpiderPlan } from "../../src/services/spider-fly-viz.mjs";
import { GRID_SIZE, cellId, parseCellId, DIRECTION_DELTA } from "../../src/domain/spider-fly-world.mjs";

const GEOMETRY = { parseCellId, cellId, directionDelta: DIRECTION_DELTA };

function embeddedJson(html, name) {
  const m = new RegExp(`const ${name} = (.*);`).exec(html);
  assert.ok(m, `const ${name} = ...; not found in the rendered page`);
  return JSON.parse(m[1]);
}

// ---- classOfAgentId / threadCellsForSpiderPlan: the two pure render-glue
// pieces extracted as real exports (not raw inline-script text) so they can
// be pinned directly, the same discipline ledger-viz.mjs holds its own
// spliced helpers (facetCounts, resolveAnsweredTerm) to.

test("classOfAgentId strips the trailing individual number, whatever it is", () => {
  assert.equal(classOfAgentId("spider-1"), "spider");
  assert.equal(classOfAgentId("spider-12"), "spider");
  assert.equal(classOfAgentId("fly-3"), "fly");
  assert.equal(classOfAgentId("egg-1"), "egg");
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
  assert.match(html, /mass-track/, "the mass bar's track element is drawn");
  assert.match(html, /mass-fill/);
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
