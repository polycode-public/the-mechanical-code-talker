// mudiii-scene: the pure parts of the town square's own three.js layer,
// tested headless — no browser, no three.js needed, since every function
// here is either plain geometry/tween arithmetic or a generic async
// primitive (a bounded queue, a promise cache, a memoized vendor loader)
// that takes its real dependency as an injected parameter.
//
// `clipForAction` itself is mudiii-viz.mjs's own export, reused rather than
// re-derived (see mudiii-scene.mjs's own header on the guarded circular
// import between the two files). This worktree does not carry
// src/services/mudiii-viz.mjs yet, so the one test below that needs its
// real behavior (clipForAction's own idle fallback) copies that function's
// body verbatim as a local fixture rather than importing a file that is not
// here — once both files land on the same tree the real import resolves and
// mudiii-scene.mjs's own wiring is exercised end to end by the e2e smoke
// instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TWEEN_DURATION_MS, lerp, tweenStep, startTween, reseedTween,
  chebyshevDistanceBetweenCells, yawForFacing, threatEngagedFor, movementRungFor,
  currentActionFor, flourishForEcologyEvent, createConcurrencyQueue, createCachedLoader,
  createThreeVendorLoader,
} from "../../src/services/mudiii-scene.mjs";

// A verbatim local copy of mudiii-viz.mjs's own clipForAction, for the one
// test that needs its real fallback behavior today — see this file's own
// header on why a copy stands in rather than an import.
function clipForActionFixture(role, action, clipMap) {
  const clips = clipMap || {};
  const kindFor = {
    wander: "walk", forage: "walk", chase: "run", evade: "run",
    "eat-agent": role === "predator" ? "attack" : "death",
    "eat-item": "eat", starve: "death", death: "death", idle: "idle",
  };
  const wanted = kindFor[action] || "idle";
  const clip = clips[wanted];
  const resolved = Array.isArray(clip) ? clip[0] : clip;
  return resolved || clips.idle || null;
}

test("lerp is a plain linear interpolation with no clamping", () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(2, 2, 0.7), 2);
});

test("tweenStep hits the start, the end and the midpoint of a 250ms tween", () => {
  const tween = startTween({ x: 0, z: 0 }, { x: 4, z: -2 }, 1000, TWEEN_DURATION_MS);
  assert.deepEqual(
    { x: tweenStep(tween, 1000).x, z: tweenStep(tween, 1000).z },
    { x: 0, z: 0 },
    "at the start, the tween reports the from point",
  );
  const mid = tweenStep(tween, 1125);
  assert.equal(mid.x, 2, "at the midpoint, x is halfway between from and to");
  assert.equal(mid.z, -1, "at the midpoint, z is halfway between from and to");
  assert.equal(mid.done, false, "the midpoint is not done");
  const end = tweenStep(tween, 1250);
  assert.deepEqual({ x: end.x, z: end.z }, { x: 4, z: -2 }, "at the full duration, the tween reports the to point");
  assert.equal(end.done, true, "the tween reports done once it reaches its own duration");
  assert.equal(tweenStep(tween, 5000).done, true, "well past the duration still reads as done, at the destination");
});

test("a tick arriving mid-tween re-seeds the new tween from the current interpolated position", () => {
  const first = startTween({ x: 0, z: 0 }, { x: 10, z: 0 }, 0, 250);
  // 40% through the first hop (x = 4), a second tick lands with a new target.
  const reseeded = reseedTween(first, { x: 10, z: 6 }, 100, 250);
  assert.equal(reseeded.from.x, 4, "the new tween starts from where the mesh actually is, not the old tween's own start");
  assert.equal(reseeded.from.z, 0, "every tweened field re-seeds, not just the one that changed");
  assert.deepEqual(reseeded.to, { x: 10, z: 6 }, "the new tween's own destination is the new target");
  assert.equal(reseeded.startedAt, 100, "the re-seeded tween starts counting from the moment it was re-seeded");
});

test("reseedTween with no existing tween starts a fresh one from the target itself", () => {
  const seeded = reseedTween(null, { x: 3, z: 3 }, 50, 250);
  assert.deepEqual({ x: seeded.from.x, z: seeded.from.z }, { x: 3, z: 3 });
});

test("reduced motion (durationMs 0) collapses the tween to its destination immediately", () => {
  const tween = startTween({ x: 0, z: 0 }, { x: 8, z: 8 }, 1000, 0);
  const atStart = tweenStep(tween, 1000);
  assert.deepEqual({ x: atStart.x, z: atStart.z }, { x: 8, z: 8 }, "even read at the tween's own start instant, it is already at the destination");
  assert.equal(atStart.done, true);
});

test("chebyshevDistanceBetweenCells tells a one-cell hop apart from a multi-cell move", () => {
  assert.equal(chebyshevDistanceBetweenCells("cell-3-3", "cell-4-3"), 1, "an orthogonal step is distance 1");
  assert.equal(chebyshevDistanceBetweenCells("cell-3-3", "cell-4-4"), 1, "a diagonal step is also distance 1, Chebyshev");
  assert.equal(chebyshevDistanceBetweenCells("cell-3-3", "cell-6-3"), 3, "a multi-cell jump reads as more than one");
  assert.equal(chebyshevDistanceBetweenCells("cell-3-3", "cell-3-3"), 0, "holding still is distance 0");
  assert.equal(chebyshevDistanceBetweenCells("cell-3-3", "nonsense"), Infinity, "a malformed cell id never claims a real distance");
});

test("yawForFacing covers all four cardinal facings with south (defaultFacing) at zero", () => {
  assert.equal(yawForFacing("south"), 0);
  assert.equal(yawForFacing("north"), Math.PI);
  assert.equal(yawForFacing("east"), -Math.PI / 2);
  assert.equal(yawForFacing("west"), Math.PI / 2);
  assert.equal(yawForFacing(undefined), 0, "an agent that has never moved falls back to the world's own default facing");
});

test("threatEngagedFor is true only when the opposing role's cell is actually believed", () => {
  const agentsById = {
    "fox-1": { role: "predator", belief: { "goblin-1": "cell-2-2", "goblin-2": null } },
    "goblin-1": { role: "prey", belief: { "fox-1": null } },
    "goblin-2": { role: "prey", belief: { "fox-1": "cell-5-5" } },
  };
  assert.equal(threatEngagedFor("fox-1", agentsById), true, "the predator believes a live prey cell");
  assert.equal(threatEngagedFor("goblin-1", agentsById), false, "this prey believes nothing about the predator");
  assert.equal(threatEngagedFor("goblin-2", agentsById), true, "this prey believes the predator's cell");
});

test("movementRungFor: chase for a predator that believes prey, evade for prey that believes a predator, wander otherwise", () => {
  const agentsById = {
    "fox-1": { role: "predator", belief: { "goblin-1": "cell-2-2" } },
    "fox-2": { role: "predator", belief: { "goblin-1": null } },
    "goblin-1": { role: "prey", belief: { "fox-1": "cell-1-1" } },
    "goblin-2": { role: "prey", belief: { "fox-1": null } },
  };
  assert.equal(movementRungFor("fox-1", agentsById), "chase");
  assert.equal(movementRungFor("fox-2", agentsById), "wander");
  assert.equal(movementRungFor("goblin-1", agentsById), "evade");
  assert.equal(movementRungFor("goblin-2", agentsById), "wander");
  assert.equal(movementRungFor("nobody", agentsById), "wander", "an id the map does not carry falls back to wander rather than throwing");
});

test("currentActionFor is idle whenever the tween is not running, regardless of belief", () => {
  const agentsById = {
    "fox-1": { role: "predator", belief: { "goblin-1": "cell-2-2" } },
    "goblin-1": { role: "prey", belief: { "fox-1": null } },
  };
  assert.equal(currentActionFor("fox-1", agentsById, false), "idle", "not moving is always idle, even mid-chase belief-wise");
  assert.equal(currentActionFor("fox-1", agentsById, true), "chase", "moving with a believed prey resolves to chase");
});

test("the ecology array maps to the right flourish per event type", () => {
  assert.deepEqual(
    flourishForEcologyEvent({ type: "eat-agent", predator: "fox-1", prey: "goblin-1", cell: "cell-4-3", massGained: 8 }),
    { kind: "death", targetId: "goblin-1", cell: "cell-4-3" },
    "eat-agent plays the prey's own death, never the predator's",
  );
  assert.deepEqual(
    flourishForEcologyEvent({ type: "starve", agent: "goblin-3", cell: "cell-11-12" }),
    { kind: "death", targetId: "goblin-3", cell: "cell-11-12" },
  );
  assert.deepEqual(
    flourishForEcologyEvent({ type: "eat-item", agent: "goblin-2", item: "morsel-1", cell: "cell-3-9", massGained: 2 }),
    { kind: "consume", targetId: "morsel-1", cell: "cell-3-9" },
    "an eaten item scales to zero, no clip — items are primitive geometry",
  );
  for (const type of ["spawn-food", "spawn-prey", "place-food"]) {
    assert.equal(
      flourishForEcologyEvent({ type, item: "crumb-1", agent: "goblin-4", cell: "cell-1-1" }),
      null,
      `${type} needs no separate flourish here — the agent/item already gets its spawn flourish for being new to the tick's own map`,
    );
  }
  assert.equal(flourishForEcologyEvent(null), null);
  assert.equal(flourishForEcologyEvent({ type: "unknown-future-event" }), null);
});

test("clipForAction falls back to idle rather than returning undefined for a rig with no matching clip", () => {
  // goblin.glb ships no "eat" clip (data/mudiii-assets.json's own goblin
  // row): eat-item on a prey resolves to the "eat" kind, which this clip
  // map does not carry.
  const goblinClips = { idle: "Idle", walk: "Walk", run: "Run", attack: "Attack", hit: ["HitRecieve"], death: "Death" };
  assert.equal(clipForActionFixture("prey", "eat-item", goblinClips), "Idle");
  // fox.glb does ship one (data/mudiii-assets.json's own fox row).
  const foxClips = { idle: "Idle", walk: "Walk", run: "Gallop", attack: "Attack", hit: ["Idle_HitReact_Left"], death: "Death", eat: "Eating" };
  assert.equal(clipForActionFixture("predator", "eat-item", foxClips), "Eating");
  // An array-valued clip (both rigs' own "hit") returns its first entry.
  assert.equal(clipForActionFixture("prey", "eat-agent", goblinClips), "Death", "eat-agent on the prey side plays its own death");
  assert.equal(clipForActionFixture("predator", "eat-agent", foxClips), "Attack", "eat-agent on the predator side plays its own attack");
});

test("createConcurrencyQueue never runs more than `limit` jobs at once", async () => {
  const queue = createConcurrencyQueue(2);
  let active = 0;
  let maxActive = 0;
  const job = () => new Promise((resolve) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    setTimeout(() => { active -= 1; resolve("done"); }, 5);
  });
  const results = await Promise.all(Array.from({ length: 8 }, () => queue.run(job)));
  assert.equal(results.length, 8);
  assert.ok(results.every((r) => r === "done"));
  assert.ok(maxActive <= 2, `never more than 2 concurrent, saw ${maxActive}`);
});

test("createConcurrencyQueue propagates one job's own rejection without blocking the rest", async () => {
  const queue = createConcurrencyQueue(1);
  const failing = queue.run(() => Promise.reject(new Error("boom")));
  const following = queue.run(() => Promise.resolve("ok"));
  await assert.rejects(failing, /boom/);
  assert.equal(await following, "ok");
});

test("createCachedLoader shares one in-flight promise for concurrent calls to the same key", async () => {
  let calls = 0;
  const cache = createCachedLoader((key) => {
    calls += 1;
    return Promise.resolve(`loaded:${key}`);
  });
  const [a, b] = await Promise.all([cache.load("x"), cache.load("x")]);
  assert.equal(a, "loaded:x");
  assert.equal(b, "loaded:x");
  assert.equal(calls, 1, "the second call reused the first call's own promise rather than loading again");
});

test("createCachedLoader evicts a rejected promise so the next call for the same key retries", async () => {
  let calls = 0;
  const cache = createCachedLoader((key) => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("network blip")) : Promise.resolve(`loaded:${key}`);
  });
  await assert.rejects(cache.load("y"), /network blip/);
  const second = await cache.load("y");
  assert.equal(second, "loaded:y", "a failed load is never a permanent cached failure");
  assert.equal(calls, 2, "the retry actually re-invoked the loader");
});

test("createThreeVendorLoader memoizes a successful load across repeat calls", async () => {
  let calls = 0;
  const loadVendor = createThreeVendorLoader({
    importVendor: () => { calls += 1; return Promise.resolve({ THREE: {}, GLTFLoader: {}, OrbitControls: {}, MeshoptDecoder: {} }); },
  });
  const first = await loadVendor();
  const second = await loadVendor();
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls, 1, "a second call reuses the first call's own settled promise");
});

test("createThreeVendorLoader never throws on a load failure, resolving ok:false instead", async () => {
  const loadVendor = createThreeVendorLoader({ importVendor: () => Promise.reject(new Error("404")) });
  const result = await loadVendor();
  assert.equal(result.ok, false);
  assert.match(String(result.error), /404/);
});

test("createThreeVendorLoader never throws on a timeout, resolving ok:false instead", async () => {
  const loadVendor = createThreeVendorLoader({ timeoutMs: 20, importVendor: () => new Promise(() => {}) });
  const result = await loadVendor();
  assert.equal(result.ok, false);
  assert.match(String(result.error), /timed out/);
});

test("mudiiiSceneScript returns a self-contained IIFE string that embeds every splice-safe helper", async () => {
  const { mudiiiSceneScript } = await import("../../src/services/mudiii-scene.mjs");
  const script = mudiiiSceneScript({ canvasId: "sceneCanvas", statusId: "sceneStatus", gridSize: 12, cellSize: 1 });
  assert.match(script, /^\(function \(\) \{/, "the returned source is a standalone IIFE, not an ES module");
  assert.match(script, /"sceneCanvas"/);
  assert.match(script, /"sceneStatus"/);
  assert.match(script, /GRID_SIZE = 12/);
  assert.match(script, /setMeshoptDecoder/, "the meshopt decoder line the manifest's own header names is present");
  assert.match(script, /window\.mudiiiHandleSceneClick/, "the click handshake calls the page shell's own documented hook");
  assert.match(script, /window\.mudiiiScene = \{/, "the reverse handshake object is published for the page shell to drive");
  assert.equal(typeof script, "string");
  // Identical input produces identical output — pure, no timestamp/random baked in.
  assert.equal(script, mudiiiSceneScript({ canvasId: "sceneCanvas", statusId: "sceneStatus", gridSize: 12, cellSize: 1 }));
});

test("mudiiiSceneScript falls back to a default grid size and cell size for missing/invalid opts", async () => {
  const { mudiiiSceneScript } = await import("../../src/services/mudiii-scene.mjs");
  const script = mudiiiSceneScript({ canvasId: "sceneCanvas", statusId: "sceneStatus" });
  assert.match(script, /GRID_SIZE = 12/, "gridSize defaults rather than baking in a nonsense value");
  assert.match(script, /CELL_SIZE = 1/);
});
