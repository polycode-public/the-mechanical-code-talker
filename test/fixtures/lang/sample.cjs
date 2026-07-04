// Hand-written CommonJS fixture (NOT wh code). Public-domain, synthetic.
// Exercises the CJS pass: require chains (incl. destructuring + member access),
// module.exports / exports.name forms, and a non-literal require that MUST be skipped.
"use strict";

var fs = require("node:fs"); // bare external
const helpers = require("./helpers"); // relative → helpers (+ /index fallback)
const { one, two } = require("./util/pair"); // destructuring binding
const Emitter = require("./deep").EventEmitter; // member access on the require
require("./side-effect"); // bare side-effect require

const which = "./dynamic";
const dyn = require(which); // NON-LITERAL specifier — skipped, never guessed

/** Combine the pair with a prefix. */
function combinePair(prefix) {
  return prefix + one + two + String(fs.sep) + helpers.tag + String(Emitter) + String(dyn);
}

exports = module.exports = combinePair; // assignment chain — one default export
module.exports.pairOne = one; // module.exports.name form
exports.pairTwo = two; // exports.name form
