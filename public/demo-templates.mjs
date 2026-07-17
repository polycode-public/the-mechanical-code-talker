// demo-templates.mjs — the 10 question templates the live chat demo picks from.
//
// The demo fires a template with a random substitution, so every pair the sets can
// produce is an answer a reader might see. Substitution sets are PRUNED to the
// entries that resolve (e.g. "which modules import X" excludes the 3 modules nothing
// imports; "what calls X" excludes functions with no tracked caller), and
// e2e/pages-demo-templates.test.mjs asks every pair against public/demo-graph.json
// through the same ask() the page calls, so a pair that starts missing fails the
// suite instead of showing a reader a miss the demo picked for them.
export const TEMPLATES = [
  {
    id: "which-imports",
    text: (s) => `which modules import ${s}?`,
    slot: [
      "src/core/model.mjs", "src/core/store.mjs", "src/core/validate.mjs", "src/lib/logger.mjs",
      "src/lib/http.mjs", "src/handlers/base.mjs", "src/server/router.mjs", "src/handlers/tasks.mjs",
      "src/handlers/users.mjs",
    ],
  },
  {
    id: "what-calls",
    text: (s) => `what calls ${s}?`,
    slot: ["loadStore", "saveStore", "validateTask", "validateUser", "createLogger", "addRoute"],
  },
  { id: "count-classes", text: () => `how many classes are there?`, slot: null },
  {
    id: "inherits-from",
    text: (s) => `which classes inherit from ${s}?`,
    slot: ["Record", "Controller"],
  },
  {
    id: "what-imports",
    text: (s) => `what does ${s} import?`,
    slot: [
      "src/core/store.mjs", "src/core/validate.mjs", "src/handlers/base.mjs", "src/server/router.mjs",
      "src/handlers/tasks.mjs", "src/handlers/users.mjs", "src/server/app.mjs",
    ],
  },
  {
    id: "what-tests",
    text: (s) => `what tests ${s}?`,
    slot: ["src/core/store.mjs", "src/handlers/tasks.mjs"],
  },
  {
    id: "where-defined",
    text: (s) => `where is ${s} defined?`,
    slot: ["Record", "Task", "User", "Project", "Store", "Logger", "Controller", "Router", "TaskController", "UserController"],
  },
  {
    id: "what-is-a",
    text: (s) => `what is a ${s}?`,
    slot: ["module", "class", "function", "method", "attribute", "commit"],
  },
  {
    id: "defines-functions",
    text: (s) => `which functions does ${s} define?`,
    slot: [
      "src/core/model.mjs", "src/core/store.mjs", "src/core/validate.mjs", "src/lib/logger.mjs",
      "src/lib/http.mjs", "src/handlers/base.mjs", "src/server/router.mjs", "src/handlers/tasks.mjs",
      "src/handlers/users.mjs", "src/server/app.mjs", "test/tasks.test.mjs", "test/store.test.mjs",
    ],
  },
  { id: "most-imports", text: () => `which module has the most imports?`, slot: null },
];

/** Pick one random (template, substitution) pair -> its question text. */
export function randomQuestion() {
  const t = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const sub = t.slot ? t.slot[Math.floor(Math.random() * t.slot.length)] : null;
  return t.text(sub);
}
