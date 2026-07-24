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

import { parse, locateFunctionBody } from "./locate.mjs";

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
