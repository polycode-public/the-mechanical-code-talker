// Module specs for the committed corpus-lane fixture repos
// (test/fixtures/repos/<name>/graph.json). Each value is the `modules`
// input buildEntities() turns into that repo's graph — the estate test
// test/estate/fixture-repos.test.mjs regenerates every graph from this
// spec and asserts the committed JSON still matches, so the fixtures can
// never silently drift from the real graph builder's output.
export const FIXTURE_REPO_MODULES = {
  // was ask-cascade: three classes, a walk.mjs import pair, a call edge
  cascade: [
    { path: "src/walk.mjs", dotted: "src.walk", imports: [], calls: [], defines: [{ name: "walk", kind: "function", lineno: 1, decorators: [] }] },
    { path: "src/a.mjs", dotted: "src.a", imports: ["src.walk"], calls: [], defines: [{ name: "Apple", kind: "class", lineno: 1, decorators: [] }] },
    { path: "src/b.mjs", dotted: "src.b", imports: ["src.walk"], calls: [], defines: [{ name: "Banana", kind: "class", lineno: 1, decorators: [] }] },
    { path: "src/c.mjs", dotted: "src.c", imports: [], calls: [], defines: [{ name: "Cherry", kind: "class", lineno: 1, decorators: [] }] },
    { path: "src/ctx.mjs", dotted: "src.ctx", imports: [], calls: [], defines: [{ name: "buildContextBundle", kind: "function", lineno: 1, decorators: [] }] },
    { path: "src/caller.mjs", dotted: "src.caller", imports: ["src.ctx"], calls: [], defines: [{ name: "caller", kind: "function", lineno: 1, decorators: [], calls: ["buildContextBundle"] }] },
  ],
  // was ask-cascade: membership inheritance walk
  inherit: [
    { path: "src/controllers.mjs", dotted: "src.controllers", imports: [], calls: [], defines: [
      { name: "Controller", kind: "class", lineno: 1, decorators: [] },
      { name: "Controller.render", kind: "method", lineno: 2, decorators: [], visibility: "public" },
      { name: "Controller._log", kind: "method", lineno: 3, decorators: [], visibility: "private" },
      { name: "TaskController", kind: "class", lineno: 10, decorators: [], bases: ["Controller"] },
      { name: "TaskControllerWithOwn", kind: "class", lineno: 20, decorators: [], bases: ["Controller"] },
      { name: "TaskControllerWithOwn.assign", kind: "method", lineno: 21, decorators: [], visibility: "public" },
    ] },
  ],
  // was ask-compositional: the compositional-capability fixture
  compositional: [
    { path: "core.mjs", dotted: "core", imports: [], calls: [], defines: [{ name: "coreFn", kind: "function", lineno: 1, decorators: [] }] },
    { path: "mid.mjs", dotted: "mid", imports: ["core"], calls: [], defines: [] },
    { path: "mid2.mjs", dotted: "mid2", imports: ["core"], calls: [], defines: [] },
    { path: "entry.mjs", dotted: "entry", imports: ["mid"], calls: [], defines: [] },
    { path: "targets.mjs", dotted: "targets", imports: [], calls: [], defines: [
      { name: "alpha", kind: "function", lineno: 1, decorators: [] },
      { name: "beta", kind: "function", lineno: 2, decorators: [] }] },
    { path: "caller.mjs", dotted: "caller", imports: ["targets", "core"], calls: [], defines: [
      { name: "callsBoth", kind: "function", lineno: 1, decorators: [], calls: ["alpha", "beta"] },
      { name: "callsOne", kind: "function", lineno: 5, decorators: [], calls: ["alpha"] }] },
    { path: "base.mjs", dotted: "base", imports: [], calls: [], defines: [{ name: "Base", kind: "class", lineno: 1, decorators: [] }] },
    { path: "widget.mjs", dotted: "widget", imports: ["base"], calls: [], exports: ["pubMethod"], defines: [
      { name: "Widget", kind: "class", lineno: 1, decorators: [], bases: ["Base"] },
      { name: "pubMethod", kind: "method", lineno: 2, decorators: [] },
      { name: "privMethod", kind: "method", lineno: 3, decorators: [], visibility: "private" },
      { name: "statMethod", kind: "method", lineno: 4, decorators: [], is_static: true }] },
    { path: "gadget.mjs", dotted: "gadget", imports: ["base"], calls: [], defines: [{ name: "Gadget", kind: "class", lineno: 1, decorators: [], bases: ["Base"] }] },
    { path: "test/widget.test.mjs", dotted: "test.widget", imports: ["widget"], calls: [], defines: [] },
  ],
  // was ask-compositional: directory-scoped listing
  dirscope: [
    { path: "lib/alpha.mjs", dotted: "lib.alpha", imports: [], calls: [], defines: [{ name: "alphaFn", kind: "function", lineno: 1, decorators: [] }] },
    { path: "lib/beta.mjs", dotted: "lib.beta", imports: [], calls: [], defines: [{ name: "betaFn", kind: "function", lineno: 1, decorators: [] }] },
    { path: "outside.mjs", dotted: "outside", imports: [], calls: [], defines: [{ name: "outsideFn", kind: "function", lineno: 1, decorators: [] }] },
  ],
  // was ask-compositional: the list overflow cap
  overflow: [{
    path: "big.mjs", dotted: "big", imports: [], calls: [],
    defines: Array.from({ length: 20 }, (_, k) => ({ name: `fn${k}`, kind: "function", lineno: k + 1, decorators: [] })),
  }],
  // was ask-resolve-ranking: entry-point ranking order
  ranked: [
    { path: "index.mjs", dotted: "index", imports: [], calls: [], defines: [] },
    { path: "src/main.mjs", dotted: "src.main", imports: [], calls: [], defines: [] },
    { path: "src/deep/nested/app.mjs", dotted: "src.deep.nested.app", imports: [], calls: [], defines: [] },
    { path: "test/fixtures/main.mjs", dotted: "test.fixtures.main", imports: [], calls: [], defines: [] },
    { path: "src/handlers/tasks.mjs", dotted: "src.handlers.tasks", imports: [], calls: [],
      defines: [{ name: "TaskController", kind: "class", lineno: 1, decorators: [] }] },
  ],
  // was ask-resolve-ranking: no entry-point basenames at all
  "ranked-none": [
    { path: "src/handlers/tasks.mjs", dotted: "src.handlers.tasks", imports: [], calls: [],
      defines: [{ name: "TaskController", kind: "class", lineno: 1, decorators: [] }] },
  ],
  // was interpret/ask-nlp: one import pair
  "imports-pair": [
    { path: "src/logging.mjs", dotted: "src.logging", imports: [], calls: [],
      defines: [{ name: "Logger", kind: "class", lineno: 1, decorators: [] }] },
    { path: "myFile.mjs", dotted: "myFile", imports: ["src.logging"], calls: [],
      defines: [{ name: "startup", kind: "function", lineno: 3, decorators: [] }] },
  ],
  // was ask-compound-resolve: compound-name resolution shapes
  compound: [
    { path: "src/domain/models.mjs", dotted: "src.domain.models", imports: [], calls: [],
      defines: [{ name: "PaymentSystem", kind: "class", lineno: 1, decorators: [] }] },
    { path: "payment-system/index.js", dotted: "paymentSystemIndex", imports: [], calls: [], defines: [] },
    { path: "westfield-payment-system/src/MyCode.cs", dotted: "westfieldPaymentSystemMyCode", imports: [], calls: [], defines: [] },
    { path: "IPaymentSystemImpl.cs", dotted: "iPaymentSystemImpl", imports: [], calls: [], defines: [] },
    { path: "src/util/logger.mjs", dotted: "src.util.logger", imports: [], calls: [],
      defines: [{ name: "Logger", kind: "class", lineno: 1, decorators: [] }] },
  ],
};
