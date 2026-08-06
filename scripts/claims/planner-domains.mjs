// planner-domains.mjs — re-exports src/surfaces/web/planner-instances.mjs so
// this rig's own import path, and test/adapters/planner-domains.test.mjs's,
// keep working unchanged. The real implementation lives under src/ now,
// because src/'s own layer-boundary check (test/estate/import-layers.test.mjs)
// forbids a src/ module from resolving outside src/, and the claims page's
// benchmark-this-device button needs to import solvePlannerInstance from a
// src/ browser entry — see planner-instances.mjs's own header for why that
// puts it under surfaces/web specifically.
export * from "../../src/surfaces/web/planner-instances.mjs";
