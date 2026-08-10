// backends-exports.mjs — the `./memory-backends` package export: every
// shipped memory row backend plus the contract's shared failure classes and
// its duck-type test, in one place for a consumer who wants storage without
// reaching into src/adapters directly. Follows the ./envelope, ./news, and
// ./memory-backend-conformance subpath precedents.
export { createRowMemoryBackend } from "./row-backend-memory.mjs";
export { createDynamoRowBackend } from "./row-backend-dynamo.mjs";
export { isRowBackend, BackendRejected, BackendUnavailable } from "./row-backend.mjs";
