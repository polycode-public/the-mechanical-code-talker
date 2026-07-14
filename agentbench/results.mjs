// agentbench/results.mjs — thin re-export shim. The RESULT-EXECUTION layer this
// file used to implement (resultSetOf + the composition operators) now lives in
// the product router, src/router/results.mjs, so bin/tmct.mjs's `plan` subcommand
// and chat's `/plan` command can use it without depending on agentbench/ (a
// dev-only directory, not shipped in package.json's `files`) — the same move
// set-algebra.mjs made earlier (see that module's own header). Every existing
// bench import keeps working unchanged.
export * from "../src/router/results.mjs";
