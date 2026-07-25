// synthbench/code/synth.mjs — the DETERMINISTIC synthesizer for the planned-edit
// family (SYN-0 today). No LLM, no sampling: it binds a taught operator from the
// case goal, checks the operator's preconditions against the REAL parsed fixture
// source, and either produces the edit or REFUSES with the failed precondition
// named. Two runs over the same fixture + goal produce byte-identical edits.
//
// Grep-clean of every fixture identifier by construction: the module name, the
// function name, and the emitted token all arrive in the case goal — operator
// selection reads the catalogue and the goal predicates, never the fixture's own
// spelling (the skill's "never memorize the fixture" guard).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse, locateFunctionBody, locateDeclarationIdentifier, locateReferenceIdentifiers } from "./locate.mjs";
import { noNameCollisionInScope, moduleDefining, callersOf } from "../../src/domain/codeplan/graph-predicates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const CATALOGUE = JSON.parse(readFileSync(join(HERE, "catalogue", "operators.json"), "utf8"));

const operatorById = (id) => CATALOGUE.operators.find((o) => o.id === id) ?? null;

/** A JS string literal for `token`, via JSON so quotes/backslashes escape
 *  deterministically. The emitted statement is `console.log(<literal>);`. */
const printStatement = (token) => `console.log(${JSON.stringify(token)});`;

/** Insert `statement` as the first line of a block body, given the offset just
 *  after the opening brace, with two-space indentation. Deterministic bytes. */
function insertAtBodyStart(text, insertAt, statement) {
  return `${text.slice(0, insertAt)}\n  ${statement}${text.slice(insertAt)}`;
}

/** Synthesize the artifact for a planned-edit case, or refuse.
 *  `readModule(relPath)` returns the fixture module's source or null when
 *  absent — injected so synthesis stays deterministic and unit-testable.
 *  Returns one of:
 *    { abstained:false, operator, plan:[{operator,params,preconditions,declaredDelta}], edits:[{module,text}] }
 *    { abstained:true,  operator, refusalReason }
 *  A refusal is the CORRECT output when a precondition fails (an honest miss). */
export function synthesizePlannedEdit(caseDef, readModule) {
  const goal = caseDef.goal ?? {};
  const op = operatorById(goal.operator);
  if (!op) return { abstained: true, operator: goal.operator ?? null, refusalReason: `no taught operator '${goal.operator}' in the catalogue` };
  if (!(caseDef.catalogue || []).includes(op.id)) {
    return { abstained: true, operator: op.id, refusalReason: `operator '${op.id}' is not in this case's available catalogue` };
  }

  const { targetModule, targetFunction, token } = goal;

  // precondition: target-module-parses (also covers "module present")
  const source = readModule(targetModule);
  if (source == null) return { abstained: true, operator: op.id, refusalReason: `precondition target-module-parses failed: module '${targetModule}' is absent` };
  const sf = parse(targetModule, source);
  if (!sf) return { abstained: true, operator: op.id, refusalReason: `precondition target-module-parses failed: '${targetModule}' does not parse` };

  // precondition: target-function-defined
  const loc = locateFunctionBody(sf, targetFunction);
  if (!loc.found) return { abstained: true, operator: op.id, refusalReason: `precondition target-function-defined failed: no function '${targetFunction}' in '${targetModule}'` };

  // precondition: target-function-has-block-body
  if (!loc.hasBlockBody) return { abstained: true, operator: op.id, refusalReason: `precondition target-function-has-block-body failed: '${targetFunction}' has no block body to insert into` };

  const statement = printStatement(token);
  const edited = insertAtBodyStart(source, loc.insertAt, statement);
  return {
    abstained: false,
    operator: op.id,
    plan: [{
      operator: op.id,
      params: { targetModule, targetFunction, token },
      preconditions: op.preconditions,
      declaredDelta: { module: targetModule, function: targetFunction, addedStatement: statement, stdoutEmits: token },
    }],
    edits: [{ module: targetModule, text: edited }],
  };
}

// ---- rename-entity (SYN-3) ---------------------------------------------------

/** A module entity id ("mod:lib/parse.mjs") to the fixture-relative path
 *  readModule/openSandbox expect ("lib/parse.mjs"). */
const relPathOfModuleId = (moduleId) => moduleId.slice(moduleId.indexOf(":") + 1);

/** Replace each of `spans` (non-overlapping, any order) in `text` with
 *  `replacement`, left to right. Deterministic: the same spans always produce
 *  the same bytes. */
function replaceSpans(text, spans, replacement) {
  let out = "";
  let cursor = 0;
  for (const { start, end } of [...spans].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, start) + replacement;
    cursor = end;
  }
  return out + text.slice(cursor);
}

/** Synthesize a rename-entity artifact, or refuse. `graphState` is the
 *  pre-edit code graph (graph-delta.mjs shape) — the caller loads it once from
 *  the fixture's committed `.tmct/graph.json`. Checks, in order: the entity
 *  exists (`entity-defined`), the rename introduces no sibling-scope collision
 *  (`no-name-collision`, via the REAL `noNameCollisionInScope` precondition —
 *  this is the poisoned-case path), and the defining module parses
 *  (`target-module-parses`). On success, rewrites the declaration in its
 *  defining module and every call-site/import reference in every module that
 *  calls the entity (found via the REAL `callersOf`/`moduleDefining`
 *  predicates, never a fixture-specific list), and declares the effect as a
 *  single `retitle-entity` graph-delta token — the shape
 *  `applyGraphEffect`/`effectsEqual` (graph-delta.mjs) already expect. Same
 *  shape as `synthesizePlannedEdit`:
 *    { abstained:false, operator, plan:[{operator,params,preconditions,declaredDelta}], edits:[{module,text}] }
 *    { abstained:true,  operator, refusalReason } */
export function synthesizeRename(caseDef, readModule, graphState) {
  const goal = caseDef.goal ?? {};
  const op = operatorById(goal.operator);
  if (!op) return { abstained: true, operator: goal.operator ?? null, refusalReason: `no taught operator '${goal.operator}' in the catalogue` };
  if (!(caseDef.catalogue || []).includes(op.id)) {
    return { abstained: true, operator: op.id, refusalReason: `operator '${op.id}' is not in this case's available catalogue` };
  }

  const { entityId, newTitle } = goal;

  // precondition: entity-defined
  const entity = graphState.entities.find((e) => e.id === entityId);
  if (!entity) return { abstained: true, operator: op.id, refusalReason: `precondition entity-defined failed: no entity '${entityId}' in the graph` };

  // precondition: no-name-collision (the REAL predicate — the poisoned-case path)
  if (!noNameCollisionInScope(graphState, { entityId, newTitle })) {
    return { abstained: true, operator: op.id, refusalReason: `precondition no-name-collision failed: a sibling in '${entityId}'s defining module already carries the title '${newTitle}'` };
  }

  // precondition: target-module-parses
  const moduleId = moduleDefining(graphState, entityId);
  if (!moduleId) return { abstained: true, operator: op.id, refusalReason: `precondition target-module-parses failed: no module defines '${entityId}'` };
  const targetModule = relPathOfModuleId(moduleId);
  const source = readModule(targetModule);
  if (source == null) return { abstained: true, operator: op.id, refusalReason: `precondition target-module-parses failed: module '${targetModule}' is absent` };
  const sf = parse(targetModule, source);
  if (!sf) return { abstained: true, operator: op.id, refusalReason: `precondition target-module-parses failed: '${targetModule}' does not parse` };

  const oldName = entity.title;
  const declSpan = locateDeclarationIdentifier(sf, oldName);
  if (!declSpan.found) return { abstained: true, operator: op.id, refusalReason: `precondition target-module-parses failed: no top-level declaration named '${oldName}' in '${targetModule}'` };

  const definingSpans = [declSpan, ...locateReferenceIdentifiers(sf, oldName)];
  const edits = [{ module: targetModule, text: replaceSpans(source, definingSpans, newTitle) }];

  // Every module that calls the entity (a REAL graph predicate, never a
  // fixture-specific list) gets its call-site/import references rewritten too.
  const callerModules = new Set();
  for (const callerId of callersOf(graphState, entityId)) {
    const callerModuleId = moduleDefining(graphState, callerId);
    if (callerModuleId && callerModuleId !== moduleId) callerModules.add(callerModuleId);
  }
  for (const callerModuleId of callerModules) {
    const relPath = relPathOfModuleId(callerModuleId);
    const callerSource = readModule(relPath);
    if (callerSource == null) continue;
    const callerSf = parse(relPath, callerSource);
    if (!callerSf) continue;
    const spans = locateReferenceIdentifiers(callerSf, oldName);
    if (!spans.length) continue;
    edits.push({ module: relPath, text: replaceSpans(callerSource, spans, newTitle) });
  }

  return {
    abstained: false,
    operator: op.id,
    plan: [{
      operator: op.id,
      params: { entityId, newTitle },
      preconditions: op.preconditions,
      declaredDelta: [{ op: "retitle-entity", id: entityId, title: newTitle }],
    }],
    edits,
  };
}
