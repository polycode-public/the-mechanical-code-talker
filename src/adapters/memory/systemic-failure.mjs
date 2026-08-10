// systemic-failure.mjs — one rule, shared by everything that guards a remote
// call against a struggling store: which failures count against a circuit
// breaker. Only a throttle, a 5xx, or a timeout does. An empty result is an
// answer, and a rejected input is a bug in the caller, so neither is
// systemic.

import { BACKEND_UNAVAILABLE_CODE } from "./row-backend.mjs";

const THROTTLE_ERROR_NAMES = new Set([
  "ProvisionedThroughputExceededException",
  "RequestLimitExceeded",
  "ThrottlingException",
  "TooManyRequestsException",
  "InternalServerError",
  "ServiceUnavailable",
  "TimeoutError",
  "AbortError",
]);

/** Does this failure mean the store itself is in trouble? */
export function isSystemicFailure(error) {
  if (!error) return false;
  if (error.code === BACKEND_UNAVAILABLE_CODE) return true;
  if (error.retryable === true || error.$retryable?.throttling === true) return true;
  if (THROTTLE_ERROR_NAMES.has(error.name)) return true;
  const status = error.status ?? error.$metadata?.httpStatusCode;
  return status === 429 || (typeof status === "number" && status >= 500);
}
