// synthbench/code/locate.mjs — deterministic AST location over a fixture module,
// via the TypeScript compiler API (the same parser src/index/extract-jsts.mjs
// uses, imported downward from the product — never the reverse). Finds a
// named top-level function's block body so an operator can insert into it by
// real source position, not a regex over spelling. No fixture identifier lives
// here; the name to find arrives as an argument.
import ts from "typescript";

function scriptKind(path) {
  if (/\.tsx$/i.test(path)) return ts.ScriptKind.TSX;
  if (/\.ts$/i.test(path)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(path)) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** Parse `text` into a SourceFile, or return null when it does not parse.
 *  createSourceFile records syntax problems on the (internal) parseDiagnostics
 *  array; a non-empty array means the text is not well-formed. */
export function parse(path, text) {
  let sf;
  try {
    sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
  } catch {
    return null;
  }
  if ((sf.parseDiagnostics || []).length) return null;
  return sf;
}

/** The block body of a top-level function named `name`, as
 *  { hasBlockBody, insertAt } where insertAt is the source offset just after the
 *  body's opening brace. Covers `function name(){…}` and `const name = () => {…}`
 *  / `const name = function(){…}` — the define kinds extract-jsts.mjs records as
 *  functions. Returns { found:false } when no such function is defined, and
 *  { found:true, hasBlockBody:false } when it is defined but has no block body
 *  (an expression-bodied arrow), so a caller can tell "absent" from "unfit". */
export function locateFunctionBody(sf, name) {
  let hit = null;
  const consider = (bodyNode) => {
    if (hit) return;
    if (bodyNode && ts.isBlock(bodyNode)) hit = { found: true, hasBlockBody: true, insertAt: bodyNode.getStart(sf) + 1 };
    else hit = { found: true, hasBlockBody: false };
  };
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.name.text === name) {
      consider(stmt.body);
    } else if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== name) continue;
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) consider(init.body);
      }
    }
  }
  return hit ?? { found: false };
}
