// claims-browser-entry.mjs — the esbuild entry for the claims page's
// "run it on this device" button (public/claims-browser.bundle.js, built by
// scripts/build-claims-bundle.mjs).
//
// solvePlannerInstance is planner-instances.mjs's own function (this same
// directory), the same per-instance solve entry point
// scripts/claims/claim-planner.mjs drives (via scripts/claims/planner-
// domains.mjs's re-export) to produce results/claims/planner.json. A
// visitor's click and the committed number come from the identical code
// path — teach one domain's rule sentences plus one instance's starting
// state through the real chat turn engine, then time the solve — so the
// page never carries a second, lighter "browser demo" implementation that
// could quietly diverge from what was actually measured.
//
// registerWinkModel is re-exported for the same reason plan-browser-entry.mjs
// re-exports it as tmct.page.registerWinkModel: the hanoi lesson's "moving a
// disk onto a target makes the disk rest on the target" sentence needs a
// real lemmatiser to reduce "moving" to "move", and the browser bundle keeps
// wink-nlp's ~1 MB model out of THIS bundle rather than duplicating it — the
// page's own script loads the site's one shared ./vendor/wink.js and
// registers it before the first solve, the identical bounded-race pattern
// plan-viz.mjs's tryLoadWink already uses.
import { solvePlannerInstance } from "./planner-instances.mjs";
import { registerWinkModel } from "../../adapters/wink-model.mjs";

globalThis.tmctClaims = { solvePlannerInstance, registerWinkModel };
