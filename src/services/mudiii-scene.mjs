// mudiii-scene.mjs — the town square's own three.js scene, reached from
// mudiii-viz.mjs (the page shell) through exactly one frozen function:
// `mudiiiSceneScript(opts) -> string`, a standalone inline <script> the page
// embeds next to its own (see mudiii-viz.mjs's own header on the split: two
// separate IIFEs, no shared lexical scope). This module owns the 3D scene
// only — the deck, the HUD, the chat lane and the map panel are the page
// shell's.
//
// Built from exactly two kinds of input, holding no world state of its own:
// the prop facts once at boot, and the tick payload every tick. Everything
// this file renders is a read of one of those two — never a second, locally
// invented notion of where an agent stands.
//
// PLAN_MUD_MUDIII.md's own render-layer section is corrected in two places
// this file follows rather than the doc's original text: GLTFLoader ships in
// the vendor bundle (handles KHR_mesh_quantization and EXT_texture_webp
// natively; only EXT_meshopt_compression needs a decoder line), and there is
// no globalThis.tmctMudiii — pages publish one globalThis.tmct.
//
// The page-shell <-> scene handshake, since the two scripts share no scope:
//   - the page shell already defines `window.mudiiiHandleSceneClick(cellId)`
//     (mudiii-viz.mjs) — this file calls it on a raycast hit and owns no
//     other write path into the world; "one code path, one provenance stamp"
//     means the click is never resolved here.
//   - this file defines `window.mudiiiScene`, the reverse direction:
//       .boot({ propPlacements, assetManifest, gridSize?, cellSize? })
//         once per world (fresh load, reset, scenario switch) — assetManifest
//         is data/mudiii-assets.json's own `assets` rows; propPlacements is
//         mudiii-viz.mjs's own propPlacementsFrom(...) output (each entry
//         already carries its resolved `.asset` row). gridSize/cellSize
//         override the values baked into this script at build time, for a
//         scenario whose own board differs from the opening one.
//       .applyTick({ agents, items, ecology }) every tick, the exact shape
//         test/fixtures/mudiii-ticks.json's own _readme.tickPayload
//         documents (agents/items keyed by id, ecology a tagged-union
//         array).
//       .setCamera({ mode, selectedId }) whenever the page's own camera
//         state changes — a mode button, the agent-select dropdown, or a
//         nextCameraSelection fallback the page shell already computes and
//         writes into #sceneStatus.
//       .cellOf(id) — read-only, the AUTHORITATIVE stored cell for a live
//         agent or item, never the mid-lerp position. This is what an e2e
//         assertion reads, and what a later screenshot ready-check reads too
//         (see test-e2e/pages-mudiii.test.mjs's own header).
//       .ready() — whether boot() has finished at least once.
//   These three calls are not yet wired into mudiii-viz.mjs's own
//   boot()/applyTickResult()/camera handlers — that file is owned by the viz
//   track, not this one; the coordinator's own report names the exact call
//   sites needed, mirroring how window.mudiiiHandleSceneClick was already
//   added for the reverse direction.
//
// Reused from mudiii-viz.mjs rather than re-derived, off its own frozen
// exports: `roleOfAgentId`, `cellToWorld`, `cellFromGroundPoint`,
// `cameraRigFor`, `clipForAction`. The two files import each other by design,
// which a static cycle handles: every binding crossing it is a hoisted
// `export function` declaration, a live binding available at link time, and
// nothing calls one while either module's top-level body is still running.
//
// It must stay a static import. A top-level `await import()` on both sides
// turns the same cycle into a deadlock — each module waits for the other to
// finish evaluating, neither ever does, and the symptom is a silent hang with
// no error rather than a resolution failure.
import {
  roleOfAgentId, cellToWorld, cellFromGroundPoint, cameraRigFor, clipForAction, modelUrlFor,
} from "./mudiii-viz.mjs";
import { prefersReducedMotion } from "./viz-ticker.mjs";

/** The movement/camera tween's duration under normal motion — three.js has
 *  no CSS transition, so this is the explicit lerp duration spider-fly-viz.mjs's
 *  own `transition: left .25s ease` becomes in a requestAnimationFrame loop. */
export const TWEEN_DURATION_MS = 250;

// ---------------------------------------------------------------------------
// Pure geometry/tween helpers — unit-tested directly in Node, then spliced
// via `.toString()` into the standalone browser IIFE below, the same
// splice-safe convention viz-boot.mjs/viz-ticker.mjs already establish.
// ---------------------------------------------------------------------------

/** Linear interpolation between `a` and `b` at `t` (0..1), no clamping — a
 *  caller past the tween's own duration already clamps `t` to 1 upstream. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** One tween's position at `now`: `{ from: {..fields}, to: {..fields},
 *  startedAt, durationMs }`, every field in `to` interpolated the same way
 *  (works for `{x,z}` ground positions and `{x,y,z}` camera points alike).
 *  Returns `{ ...point, t, done }` — `t` is the eased-nothing linear
 *  fraction, `done` is whether `now` has reached the tween's own end.
 *  `durationMs <= 0` (the reduced-motion collapse) jumps straight to `to`
 *  regardless of `now` — invariant 3 of the movement contract. Pure. */
export function tweenStep(tween, now) {
  if (!tween) return null;
  const { from, to, startedAt, durationMs } = tween;
  if (!durationMs || durationMs <= 0) return { ...to, t: 1, done: true };
  const elapsed = now - startedAt;
  if (elapsed <= 0) return { ...from, t: 0, done: false };
  if (elapsed >= durationMs) return { ...to, t: 1, done: true };
  const t = elapsed / durationMs;
  const point = {};
  for (const key of Object.keys(to)) point[key] = lerp(from[key] ?? to[key], to[key], t);
  return { ...point, t, done: false };
}

/** A fresh tween from `from` to `to`, starting at `now`. Pure. */
export function startTween(from, to, now, durationMs = TWEEN_DURATION_MS) {
  return { from, to, startedAt: now, durationMs };
}

/** Invariant 2 of the movement contract: a tick arriving mid-lerp re-seeds
 *  the start from wherever the mesh CURRENTLY is, not from the old tween's
 *  own start or end. `existingTween` may be null (the agent was not
 *  tweening); `to` is the new destination point. Pure — `tweenStep` is
 *  called on the OLD tween at `now` to read the current position before
 *  building the new one. */
export function reseedTween(existingTween, to, now, durationMs = TWEEN_DURATION_MS) {
  const current = existingTween ? tweenStep(existingTween, now) : null;
  const from = current ? Object.fromEntries(Object.keys(to).map((k) => [k, current[k]])) : to;
  return startTween(from, to, now, durationMs);
}

/** Chebyshev distance between two `cell-<x>-<y>` ids, or `Infinity` for a
 *  malformed id — used only to tell a one-cell hop (tweened) apart from a
 *  multi-cell move or teleport (snapped, spawn flourish, no path animation —
 *  the movement contract's third invariant). Pure. */
export function chebyshevDistanceBetweenCells(a, b) {
  const ma = /^cell-(\d+)-(\d+)$/.exec(String(a == null ? "" : a));
  const mb = /^cell-(\d+)-(\d+)$/.exec(String(b == null ? "" : b));
  if (!ma || !mb) return Infinity;
  return Math.max(Math.abs(Number(ma[1]) - Number(mb[1])), Math.abs(Number(ma[2]) - Number(mb[2])));
}

/** A facing word to a Y rotation in radians. Assumes a model's own local
 *  forward is +Z (true for fox and goblin, the two rigs in the current
 *  manifest, checked by walking each GLB's own bind-pose bone chain) so a
 *  rotated mesh matches `cameraRigFor`'s own FACING_VECTOR table exactly for
 *  all four cardinals — a model with a -Z neutral pose would need its own
 *  offset. Pure. */
export function yawForFacing(facing) {
  const YAW = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 };
  return YAW[facing] ?? YAW.south;
}

/** Whether `agentId` (predator or prey) currently believes an agent of the
 *  opposing role — the one belief-derived bit that separates a predator's
 *  "chase" rung from "wander", and a prey's "evade" rung from "forage"/
 *  "wander" (PLAN_MUD_MUDIII.md's own priority chains). Read entirely off
 *  the tick payload's own `role`/`belief` fields — no rung name travels on
 *  the wire, so this reconstructs which rung applied rather than trusting a
 *  label. Pure. */
export function threatEngagedFor(agentId, agentsById) {
  const agent = agentsById[agentId];
  if (!agent || !agent.belief) return false;
  const opposingRole = agent.role === "predator" ? "prey" : agent.role === "prey" ? "predator" : null;
  if (!opposingRole) return false;
  return Object.keys(agentsById).some(
    (id) => id !== agentId && agentsById[id] && agentsById[id].role === opposingRole && agent.belief[id],
  );
}

/** The movement rung driving clip selection while `agentId` is actually
 *  moving: "chase" for a predator that believes prey, "evade" for a prey
 *  that believes a predator, "wander" otherwise (forage and wander both
 *  resolve to the same walk clip in `clipForAction`'s own table, so this
 *  never needs to tell them apart). Pure. */
export function movementRungFor(agentId, agentsById) {
  const agent = agentsById[agentId];
  if (!agent) return "wander";
  if (threatEngagedFor(agentId, agentsById)) return agent.role === "predator" ? "chase" : "evade";
  return "wander";
}

/** The clip-selection ACTION word for one agent this tick: "idle" whenever
 *  it is not tweening (invariant 1 of the animation rule — "walk while the
 *  tween runs, idle otherwise"), `movementRungFor`'s own result while it is.
 *  Pure, and independent of `clipForAction` itself — this only decides which
 *  action word to ask for, not which literal clip name answers it. */
export function currentActionFor(agentId, agentsById, moving) {
  return moving ? movementRungFor(agentId, agentsById) : "idle";
}

/** One ecology event to the flourish it drives, or null for an event this
 *  scene has nothing visual to do for on its own (`spawn-food`/`spawn-prey`/
 *  `place-food` need no separate action here — the agent/item already gets
 *  its spawn flourish the moment it is new to a tick's own agents/items map,
 *  so acting on the ecology row too would double it). `kind` is one of
 *  "death" (the rig's own Death clip, then scale to zero) or "consume" (an
 *  eaten item scales to zero, no clip — items are primitive geometry).
 *  Pure. */
export function flourishForEcologyEvent(event) {
  if (!event || !event.type) return null;
  switch (event.type) {
    case "eat-agent":
      return { kind: "death", targetId: event.prey, cell: event.cell };
    case "starve":
      return { kind: "death", targetId: event.agent, cell: event.cell };
    case "eat-item":
      return { kind: "consume", targetId: event.item, cell: event.cell };
    default:
      return null;
  }
}

/** A bounded-concurrency job queue — three.js's own recommendation for a
 *  GLTFLoader shared across many models is to not open every request at
 *  once. `run(fn)` queues `fn` (returning a promise) and resolves/rejects
 *  with its own settlement once a slot frees up; at most `limit` run at a
 *  time. Pure enough to unit-test with fake async jobs, no three.js needed. */
export function createConcurrencyQueue(limit) {
  let active = 0;
  const waiting = [];
  function pump() {
    if (active >= limit || waiting.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = waiting.shift();
    fn().then(
      (value) => { active -= 1; resolve(value); pump(); },
      (err) => { active -= 1; reject(err); pump(); },
    );
  }
  function run(fn) {
    return new Promise((resolve, reject) => {
      waiting.push({ fn, resolve, reject });
      pump();
    });
  }
  return { run };
}

/** A promise cache keyed by whatever key `loadFn` is called with, WITH
 *  rejected-promise eviction: a failed load is removed from the cache the
 *  moment it rejects, so the next call for the same key retries instead of
 *  replaying the same failure forever (world-of-claudecraft's own "black
 *  void" bug this discipline exists to avoid — a cached rejection reads as a
 *  model that will never load, when the real fix might be one dropped
 *  request away). A resolved entry stays cached for the life of the page.
 *  Pure enough to unit-test with a fake `loadFn`. */
export function createCachedLoader(loadFn) {
  const cache = new Map();
  function load(key) {
    if (cache.has(key)) return cache.get(key);
    const promise = Promise.resolve().then(() => loadFn(key));
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
    return promise;
  }
  return { load };
}

/** The memoized, timeout-raced, never-throwing lazy-vendor-loader pattern
 *  viz-boot.mjs's `loadWinkVendor` establishes, followed here for
 *  `./vendor/three.js` rather than `./vendor/wink.js` — a different vendor
 *  shape (`{ THREE, GLTFLoader, OrbitControls, MeshoptDecoder }`, not
 *  `{ winkNLP, model }`), so this is a sibling implementation of the same
 *  shape rather than a call into that one. Resolves `{ ok: true, THREE,
 *  GLTFLoader, OrbitControls, MeshoptDecoder }` on success or `{ ok: false,
 *  error }` on a timeout or load failure — never throws, never blocks the
 *  rest of the page on a stalled 3D asset. `importVendor` is injectable so a
 *  test can supply a resolved/rejected/never-settling promise with no real
 *  vendor asset on disk. */
export function createThreeVendorLoader({
  timeoutMs = 15000,
  importVendor = () => import("./vendor/three.js"),
} = {}) {
  let ready = null;
  return function loadThreeVendorOnce() {
    if (ready) return ready;
    ready = (async () => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("three vendor asset load timed out")), timeoutMs);
      });
      try {
        const mod = await Promise.race([importVendor(), timeout]);
        return {
          ok: true, THREE: mod.THREE, GLTFLoader: mod.GLTFLoader,
          OrbitControls: mod.OrbitControls, MeshoptDecoder: mod.MeshoptDecoder,
        };
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("tmct: the three.js vendor asset failed to load, the town square cannot render", error);
        return { ok: false, error };
      } finally {
        clearTimeout(timer);
      }
    })();
    return ready;
  };
}

// ---------------------------------------------------------------------------
// The frozen contract.
// ---------------------------------------------------------------------------

/** The town square's own standalone <script> source, a self-contained IIFE
 *  with no lexical scope shared with the page shell (see this module's own
 *  header on the handshake). `opts`:
 *    - `canvasId`/`statusId`: the page shell's own element ids
 *      (`#sceneCanvas`, `#sceneStatus` in mudiii-viz.mjs's markup) this
 *      script mounts the renderer into and writes a load failure to.
 *    - `gridSize`/`cellSize`: the OPENING scenario's own board size, baked
 *      in at page-build time; `window.mudiiiScene.boot()` accepts its own
 *      `gridSize`/`cellSize` to override this for a later scenario whose
 *      board differs, since `opts` itself is fixed once the page is built.
 *  Pure — identical output for identical input; nothing here reads the DOM
 *  or three.js until the returned string actually runs in a browser. */
export function mudiiiSceneScript({ canvasId, statusId, gridSize, cellSize } = {}) {
  return `(function () {
  "use strict";
  var CANVAS_ID = ${JSON.stringify(canvasId)};
  var STATUS_ID = ${JSON.stringify(statusId)};
  var GRID_SIZE = ${JSON.stringify(Number(gridSize) || 12)};
  var CELL_SIZE = ${JSON.stringify(Number(cellSize) || 1)};

  var lerp = ${lerp.toString()};
  var tweenStep = ${tweenStep.toString()};
  var startTween = ${startTween.toString()};
  var reseedTween = ${reseedTween.toString()};
  var chebyshevDistanceBetweenCells = ${chebyshevDistanceBetweenCells.toString()};
  var yawForFacing = ${yawForFacing.toString()};
  var threatEngagedFor = ${threatEngagedFor.toString()};
  var movementRungFor = ${movementRungFor.toString()};
  var currentActionFor = ${currentActionFor.toString()};
  var flourishForEcologyEvent = ${flourishForEcologyEvent.toString()};
  var createConcurrencyQueue = ${createConcurrencyQueue.toString()};
  var createCachedLoader = ${createCachedLoader.toString()};
  var createThreeVendorLoader = ${createThreeVendorLoader.toString()};
  var prefersReducedMotion = ${prefersReducedMotion.toString()};
  var roleOfAgentId = ${roleOfAgentId.toString()};
  var cellToWorld = ${cellToWorld.toString()};
  var cellFromGroundPoint = ${cellFromGroundPoint.toString()};
  var cameraRigFor = ${cameraRigFor.toString()};
  var clipForAction = ${clipForAction.toString()};
  var modelUrlFor = ${modelUrlFor.toString()};

  var canvas = document.getElementById(CANVAS_ID);
  var statusEl = document.getElementById(STATUS_ID);
  if (!canvas) return;

  function setStatus(text) { if (statusEl) statusEl.textContent = text || ""; }

  var reduced = prefersReducedMotion();
  var tweenDurationMs = reduced ? 0 : ${TWEEN_DURATION_MS};
  if (typeof window.matchMedia === "function") {
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function (e) {
      reduced = e.matches;
      tweenDurationMs = reduced ? 0 : ${TWEEN_DURATION_MS};
    });
  }

  var loadThreeVendor = createThreeVendorLoader();
  var THREE = null, GLTFLoaderCtor = null, OrbitControlsCtor = null, MeshoptDecoderRef = null;
  var gltfLoader = null, loadQueue = createConcurrencyQueue(4);
  var scene = null, camera3 = null, renderer = null, orbitControls = null, groundMesh = null, raycaster = null;
  var agentGroups = {};
  var itemMeshes = {};
  var propTemplates = {};
  var propInstances = [];
  var manifestByKind = {};
  var lastAgentsById = {};
  var lastItemsById = {};
  var cameraState = { mode: "overhead", selectedId: null };
  var cameraTween = null, lookAtTween = null;
  var lastFrameTs = null;
  var booted = false;

  // Cache the fetched BYTES, not the parsed scene: one network request per
  // model URL, however many agents share that kind, then a GLTFLoader.parse
  // per caller off the shared ArrayBuffer. Each caller still ends up owning
  // its own object graph, so normalizeToHeight's own guards still hold.
  function fetchGlbBytes(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("model fetch failed with status " + res.status + ": " + url);
      return res.arrayBuffer();
    });
  }
  var glbBytesCache = createCachedLoader(fetchGlbBytes);

  function loadGlbRaw(url) {
    return glbBytesCache.load(url).then(function (buffer) {
      return loadQueue.run(function () {
        return new Promise(function (resolve, reject) {
          gltfLoader.parse(buffer, THREE.LoaderUtils.extractUrlBase(url), resolve, reject);
        });
      });
    });
  }
  async function ensureThree() {
    if (THREE) return true;
    var result = await loadThreeVendor();
    if (!result.ok) { setStatus("the town square could not load its 3D scene"); return false; }
    THREE = result.THREE; GLTFLoaderCtor = result.GLTFLoader;
    OrbitControlsCtor = result.OrbitControls; MeshoptDecoderRef = result.MeshoptDecoder;
    gltfLoader = new GLTFLoaderCtor();
    gltfLoader.setMeshoptDecoder(MeshoptDecoderRef);
    setUpScene();
    return true;
  }

  function setUpScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x10161b);
    camera3 = new THREE.PerspectiveCamera(55, (canvas.clientWidth || 640) / Math.max(1, canvas.clientHeight || 360), 0.1, 500);
    camera3.position.set(0, 8, 8);
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
    var sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 10, 3);
    scene.add(sun);

    rebuildGround();

    raycaster = new THREE.Raycaster();
    orbitControls = new OrbitControlsCtor(camera3, renderer.domElement);
    orbitControls.enabled = false;
    orbitControls.target.set(0, 0, 0);

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    watchFoodPill();
    onResize();
    requestAnimationFrame(renderLoop);
  }

  function rebuildGround() {
    if (groundMesh) { scene.remove(groundMesh); groundMesh.geometry.dispose(); groundMesh.material.dispose(); }
    var groundSize = GRID_SIZE * CELL_SIZE;
    var groundMat = new THREE.MeshStandardMaterial({ color: 0x7c9a5b });
    groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMat);
    groundMesh.name = "ground";
    groundMesh.rotation.x = -Math.PI / 2;
    scene.add(groundMesh);
    var existingGrid = scene.getObjectByName("townSquareGrid");
    if (existingGrid) scene.remove(existingGrid);
    var grid = new THREE.GridHelper(groundSize, GRID_SIZE);
    grid.name = "townSquareGrid";
    grid.position.y = 0.01;
    scene.add(grid);
  }

  function onResize() {
    if (!renderer || !camera3) return;
    var w = canvas.clientWidth || 640, h = canvas.clientHeight || 360;
    renderer.setSize(w, h, false);
    camera3.aspect = w / Math.max(1, h);
    camera3.updateProjectionMatrix();
  }

  function pointFromEvent(evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((evt.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  // The raycast target is the ground mesh ALONE — never scene.children — so
  // a click a hair off a prop or an agent still resolves to the cell under
  // the cursor rather than hitting whatever mesh happens to sit in front.
  function onPointerDown(evt) {
    if (!scene || !camera3 || !groundMesh) return;
    var ndc = pointFromEvent(evt);
    raycaster.setFromCamera(ndc, camera3);
    var hits = raycaster.intersectObject(groundMesh, false);
    if (!hits.length) return;
    var cellId = cellFromGroundPoint({ x: hits[0].point.x, z: hits[0].point.z }, GRID_SIZE, CELL_SIZE);
    if (!cellId) return;
    if (typeof window.mudiiiHandleSceneClick === "function") window.mudiiiHandleSceneClick(cellId);
  }

  // Cursor feedback while the food pill is armed reads the pill's own
  // aria-pressed attribute directly (a read-only coupling to a stable markup
  // id the page shell already exposes) rather than needing a page-script
  // edit just to mirror one boolean.
  function watchFoodPill() {
    var foodPill = document.getElementById("foodPill");
    if (!foodPill || typeof MutationObserver === "undefined") return;
    function sync() { canvas.style.cursor = foodPill.getAttribute("aria-pressed") === "true" ? "crosshair" : ""; }
    sync();
    new MutationObserver(sync).observe(foodPill, { attributes: true, attributeFilter: ["aria-pressed"] });
  }

  // ---- props ---------------------------------------------------------------
  // Box3.setFromObject reads through a parent's world matrix, so measuring a
  // parented object reads whatever that parent's spawn flourish is doing in
  // that frame and applies a scale that depends on the frame. The guards make
  // both misuses fail loudly rather than render a wrong size silently. Keep
  // no backtick in this block: the function's source sits inside the module's
  // own template literal.
  function normalizeToHeight(object3D, targetHeight) {
    if (object3D.parent) {
      throw new Error("normalizeToHeight refused an object that already has a parent: " + (object3D.name || object3D.uuid));
    }
    if (object3D.userData.tmctNormalized) {
      throw new Error("normalizeToHeight refused a second call on the same object: " + (object3D.name || object3D.uuid));
    }
    var box = new THREE.Box3().setFromObject(object3D);
    var size = new THREE.Vector3();
    box.getSize(size);
    if (!size.y) {
      // Substituting 1 here invented a scale from an unmeasurable height, and
      // that is what produced the house-height mesh.
      throw new Error("normalizeToHeight found no measurable height on: " + (object3D.name || object3D.uuid));
    }
    var scale = targetHeight ? targetHeight / size.y : 1;
    object3D.scale.setScalar(scale);
    var seated = new THREE.Box3().setFromObject(object3D);
    object3D.position.y -= seated.min.y;
    object3D.userData.tmctNormalized = true;
  }

  // Keyed on the manifest row's own key field, not its destPath: food-crumb
  // and food-morsel share one GLB at two different targetHeights, and
  // normalizeToHeight refuses a second call on the same object, so a
  // destPath-keyed cache would hand the second row the first row's
  // already-normalized graph and throw.
  function loadPropTemplate(asset) {
    var key = asset.key;
    if (!propTemplates[key]) {
      var url = modelUrlFor(asset.destPath);
      var promise = loadGlbRaw(url).then(function (gltf) {
        normalizeToHeight(gltf.scene, asset.targetHeight);
        return gltf.scene;
      });
      promise.catch(function () { delete propTemplates[key]; });
      propTemplates[key] = promise;
    }
    return propTemplates[key];
  }

  async function placeProps(propPlacements) {
    for (var i = 0; i < propInstances.length; i += 1) scene.remove(propInstances[i]);
    propInstances = [];
    for (var j = 0; j < (propPlacements || []).length; j += 1) {
      var placement = propPlacements[j];
      if (!placement.asset || !placement.asset.destPath) continue;
      var world = cellToWorld(placement.cell, GRID_SIZE, CELL_SIZE);
      if (!world) continue;
      try {
        var template = await loadPropTemplate(placement.asset);
        var instance = template.clone();
        instance.position.set(world.x, template.position.y, world.z);
        instance.rotation.y = ((Number(placement.rotation) || 0) * Math.PI) / 180;
        scene.add(instance);
        propInstances.push(instance);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("tmct: a prop model failed to load", placement.model, err);
      }
    }
  }

  // ---- items: crumbs and morsels, the committed hay bale at two target
  // heights (food-crumb 0.16, food-morsel 0.36 in data/mudiii-assets.json),
  // matching the on-ground footprint the primitive spheres they replace were
  // already tuned to. ---------------------------------------------------------
  function itemAssetKeyFor(kind) { return kind === "morsel" ? "food-morsel" : "food-crumb"; }

  function animateScaleTo(object3D, target, now) {
    var duration = tweenDurationMs;
    var start = object3D.scale.x;
    function step(ts) {
      var elapsed = duration <= 0 ? duration : ts - now;
      var t = duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / duration));
      var v = lerp(start, target, t);
      object3D.scale.setScalar(v);
      if (t < 1) requestAnimationFrame(step);
      else if (target === 0 && object3D.parent) object3D.parent.remove(object3D);
    }
    requestAnimationFrame(step);
  }

  // A Group per live item, the same shape ensureAgent uses for agents: the
  // group is in the scene (and in itemMeshes) synchronously so a second tick
  // arriving before the GLB resolves finds an existing entry rather than
  // starting a second load, but stays invisible until the model is in it.
  function applyItemTick(id, item, now) {
    var world = cellToWorld(item.cell, GRID_SIZE, CELL_SIZE);
    if (!world) return;
    var entry = itemMeshes[id];
    if (entry) {
      entry.cell = item.cell;
      entry.mesh.position.set(world.x, 0, world.z);
      return;
    }
    var group = new THREE.Group();
    group.name = "item-" + id;
    group.position.set(world.x, 0, world.z);
    group.visible = false;
    scene.add(group);
    entry = { mesh: group, cell: item.cell, kind: item.kind };
    itemMeshes[id] = entry;
    var asset = manifestByKind[itemAssetKeyFor(item.kind)];
    if (!asset) return;
    loadPropTemplate(asset).then(function (template) {
      if (itemMeshes[id] !== entry) return; // removed while the model was still loading
      var instance = template.clone();
      instance.position.y = template.position.y;
      group.add(instance);
      group.visible = true;
      group.scale.setScalar(0);
      animateScaleTo(group, 1, performance.now());
    }).catch(function (err) {
      // eslint-disable-next-line no-console
      console.warn("tmct: an item model failed to load", id, err);
    });
  }

  function removeItem(id, withFlourish) {
    var entry = itemMeshes[id];
    if (!entry) return;
    delete itemMeshes[id];
    if (withFlourish) animateScaleTo(entry.mesh, 0, performance.now());
    else if (entry.mesh.parent) entry.mesh.parent.remove(entry.mesh);
  }

  // ---- agents: one persistent Group per live id, one GLTF INSTANCE per
  // live agent (never a cloned template — Object3D.clone() does not
  // correctly clone a SkinnedMesh, and at this roster size — a handful of
  // foxes and goblins — the extra memory of a separate load per agent is
  // trivial next to that whole class of bug). ---------------------------------
  function ensureAgent(id, agent) {
    if (agentGroups[id]) return agentGroups[id];
    var kind = roleOfAgentId(id);
    var entry = {
      group: new THREE.Group(), tween: null, cell: null, facing: agent.facing, role: agent.role,
      kind: kind, mixer: null, actions: {}, currentClip: null, clipMap: null,
    };
    entry.group.visible = false;
    scene.add(entry.group);
    agentGroups[id] = entry;
    var asset = manifestByKind[kind];
    if (asset) {
      loadGlbRaw(modelUrlFor(asset.destPath)).then(function (gltf) {
        normalizeToHeight(gltf.scene, asset.targetHeight);
        entry.group.add(gltf.scene);
        entry.group.visible = true;
        entry.clipMap = asset.clips || {};
        entry.mixer = new THREE.AnimationMixer(gltf.scene);
        for (var i = 0; i < (gltf.animations || []).length; i += 1) {
          entry.actions[gltf.animations[i].name] = entry.mixer.clipAction(gltf.animations[i]);
        }
      }).catch(function (err) {
        // eslint-disable-next-line no-console
        console.warn("tmct: an agent model failed to load", id, err);
      });
    }
    return entry;
  }

  function playClip(entry, clipName) {
    if (!entry.mixer || !clipName || entry.currentClip === clipName) return;
    var next = entry.actions[clipName];
    if (!next) return;
    var prev = entry.currentClip ? entry.actions[entry.currentClip] : null;
    next.reset().fadeIn(0.15).play();
    if (prev && prev !== next) prev.fadeOut(0.15);
    entry.currentClip = clipName;
  }

  function playSpawnFlourish(group, now) {
    group.scale.setScalar(0);
    animateScaleTo(group, 1, now);
  }

  function applyAgentTick(id, agent, now) {
    var entry = ensureAgent(id, agent);
    var world = cellToWorld(agent.cell, GRID_SIZE, CELL_SIZE);
    if (!world) return;
    var previousCell = entry.cell;
    var isFirstSighting = previousCell == null;
    var singleHop = !isFirstSighting && previousCell !== agent.cell
      && chebyshevDistanceBetweenCells(previousCell, agent.cell) === 1;
    var held = !isFirstSighting && previousCell === agent.cell;
    entry.cell = agent.cell;
    entry.facing = agent.facing;
    entry.group.rotation.y = yawForFacing(agent.facing);
    if (singleHop) {
      entry.tween = reseedTween(entry.tween, { x: world.x, z: world.z }, now, tweenDurationMs);
    } else {
      entry.tween = null;
      entry.group.position.set(world.x, entry.group.position.y, world.z);
      if (!held) playSpawnFlourish(entry.group, now);
    }
    if (entry.clipMap) {
      var moving = singleHop;
      playClip(entry, clipForAction(agent.role, currentActionFor(id, lastAgentsById, moving), entry.clipMap));
    }
  }

  function removeAgent(id) {
    var entry = agentGroups[id];
    if (!entry) return;
    delete agentGroups[id];
    var deathClip = entry.clipMap && entry.clipMap.death;
    var deathClipName = Array.isArray(deathClip) ? deathClip[0] : deathClip;
    if (deathClipName) {
      playClip(entry, deathClipName);
      animateScaleTo(entry.group, 0, performance.now());
    } else if (entry.group.parent) {
      entry.group.parent.remove(entry.group);
    }
  }

  function applyEcology(ecology) {
    for (var i = 0; i < (ecology || []).length; i += 1) {
      var flourish = flourishForEcologyEvent(ecology[i]);
      if (!flourish) continue;
      if (flourish.kind === "death") removeAgent(flourish.targetId);
      else if (flourish.kind === "consume") removeItem(flourish.targetId, true);
    }
  }

  // ---- camera ---------------------------------------------------------------
  function agentSnapshotFor(id) {
    var entry = agentGroups[id];
    return entry ? { cell: entry.cell, facing: entry.facing } : null;
  }

  function setCamera(state) {
    cameraState = { mode: (state && state.mode) || "overhead", selectedId: (state && state.selectedId) || null };
    var agent = cameraState.selectedId ? agentSnapshotFor(cameraState.selectedId) : null;
    var rig = cameraRigFor(cameraState.mode, agent, GRID_SIZE) || cameraRigFor("overhead", null, GRID_SIZE);
    if (!rig) return;
    var now = performance.now();
    cameraTween = reseedTween(cameraTween, rig.position, now, tweenDurationMs);
    lookAtTween = reseedTween(lookAtTween, rig.lookAt, now, tweenDurationMs);
    if (orbitControls) orbitControls.enabled = cameraState.mode === "overhead";
  }

  // Re-tween the camera toward its own rig after a tick lands, in case the
  // followed agent moved — follow/pov track the agent, so their own rig
  // target changes every tick even with no explicit setCamera() call.
  function refreshCameraTween(now) {
    if (cameraState.mode === "overhead") return;
    if (!cameraState.selectedId) return;
    var agent = agentSnapshotFor(cameraState.selectedId);
    var rig = cameraRigFor(cameraState.mode, agent, GRID_SIZE);
    if (!rig) return;
    cameraTween = reseedTween(cameraTween, rig.position, now, tweenDurationMs);
    lookAtTween = reseedTween(lookAtTween, rig.lookAt, now, tweenDurationMs);
  }

  // ---- boot / tick / render loop --------------------------------------------
  function buildManifestByKind(assetManifest) {
    var byKind = {};
    for (var i = 0; i < (assetManifest || []).length; i += 1) {
      if (assetManifest[i] && assetManifest[i].key) byKind[assetManifest[i].key] = assetManifest[i];
    }
    return byKind;
  }

  async function boot(input) {
    var ok = await ensureThree();
    if (!ok) return;
    if (input && input.gridSize) { GRID_SIZE = Number(input.gridSize) || GRID_SIZE; }
    if (input && input.cellSize) { CELL_SIZE = Number(input.cellSize) || CELL_SIZE; }
    rebuildGround();
    for (var id in agentGroups) if (agentGroups[id].group.parent) agentGroups[id].group.parent.remove(agentGroups[id].group);
    agentGroups = {};
    for (var itemId in itemMeshes) if (itemMeshes[itemId].mesh.parent) itemMeshes[itemId].mesh.parent.remove(itemMeshes[itemId].mesh);
    itemMeshes = {};
    lastAgentsById = {};
    lastItemsById = {};
    manifestByKind = buildManifestByKind(input && input.assetManifest);
    await placeProps((input && input.propPlacements) || []);
    setCamera({ mode: "overhead", selectedId: null });
    booted = true;
  }

  function applyTick(tick) {
    if (!scene) return;
    var now = performance.now();
    var agents = (tick && tick.agents) || {};
    var items = (tick && tick.items) || {};
    for (var id in agents) if (Object.prototype.hasOwnProperty.call(agents, id)) applyAgentTick(id, agents[id], now);
    for (var itemId in items) if (Object.prototype.hasOwnProperty.call(items, itemId)) applyItemTick(itemId, items[itemId], now);
    for (var goneAgent in lastAgentsById) if (!(goneAgent in agents)) removeAgent(goneAgent);
    for (var goneItem in lastItemsById) if (!(goneItem in items)) removeItem(goneItem, false);
    applyEcology(tick && tick.ecology);
    lastAgentsById = agents;
    lastItemsById = items;
    refreshCameraTween(now);
  }

  function renderLoop(ts) {
    requestAnimationFrame(renderLoop);
    if (!scene || !renderer || !camera3) return;
    var deltaSec = lastFrameTs == null ? 0 : (ts - lastFrameTs) / 1000;
    lastFrameTs = ts;
    for (var id in agentGroups) {
      var entry = agentGroups[id];
      if (entry.tween) {
        var p = tweenStep(entry.tween, ts);
        entry.group.position.set(p.x, entry.group.position.y, p.z);
        if (p.done) entry.tween = null;
      }
      if (entry.mixer) entry.mixer.update(deltaSec);
    }
    if (cameraTween) { var cp = tweenStep(cameraTween, ts); camera3.position.set(cp.x, cp.y, cp.z); }
    if (lookAtTween) { var lp = tweenStep(lookAtTween, ts); camera3.lookAt(lp.x, lp.y, lp.z); }
    if (orbitControls && orbitControls.enabled) orbitControls.update();
    renderer.render(scene, camera3);
  }

  window.mudiiiScene = {
    boot: boot,
    applyTick: applyTick,
    setCamera: setCamera,
    cellOf: function (id) {
      if (agentGroups[id]) return agentGroups[id].cell;
      if (itemMeshes[id]) return itemMeshes[id].cell;
      return null;
    },
    // The live agent group's own applied Y rotation, in radians -- an e2e
    // assertion's read, so it can compare the yaw actually applied against
    // the direction an agent travelled between two cells rather than trusting
    // yawForFacing's own output in isolation.
    yawOf: function (id) {
      var entry = agentGroups[id];
      return entry ? entry.group.rotation.y : null;
    },
    // The live agent mesh's world-space height and lowest point, plus the
    // manifest's own targetHeight to compare it against — an e2e assertion's
    // read, so it goes through the group actually in the scene rather than a
    // second, locally invented measurement.
    meshHeightOf: function (id) {
      var entry = agentGroups[id];
      if (!entry || !entry.group || entry.group.children.length === 0) return null;
      var box = new THREE.Box3().setFromObject(entry.group);
      var size = new THREE.Vector3();
      box.getSize(size);
      var asset = manifestByKind[entry.kind];
      return { height: size.y, minY: box.min.y, targetHeight: asset ? asset.targetHeight : null };
    },
    ready: function () { return booted; },
  };
})();`;
}
