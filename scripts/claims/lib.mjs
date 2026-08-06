// scripts/claims/lib.mjs — the shared writer every `claim:*` rig calls to
// land its result under results/claims/. A rig hands writeClaim() a bare
// measurement; this module stamps provenance, checks the payload against
// schema.json, and enforces the committed regression threshold.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cpus, platform, arch } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const CLAIMS_DIR = join(ROOT, "results", "claims");
export const SCHEMA_PATH = join(HERE, "schema.json");

export function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
}

const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

/** Hand-rolled structural check against schema.json's shape: type,
 *  required, enum, array items, nested object properties, and a oneOf
 *  group. Returns a list of problem strings; empty means valid. */
export function checkClaim(payload, schema = loadSchema(), path = "") {
  const problems = [];
  const label = path || "claim";

  if (schema.type && typeOf(payload) !== schema.type) {
    problems.push(`${label}: expected type "${schema.type}", got "${typeOf(payload)}"`);
    return problems;
  }

  if (schema.type === "object") {
    for (const key of schema.required ?? []) {
      if (payload[key] === undefined) problems.push(`${label}: missing required field "${key}"`);
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (payload[key] !== undefined) {
        problems.push(...checkClaim(payload[key], subSchema, path ? `${path}.${key}` : key));
      }
    }
    if (schema.oneOf) {
      const satisfied = schema.oneOf.filter((branch) =>
        (branch.required ?? []).every((key) => payload[key] !== undefined),
      );
      if (satisfied.length !== 1) {
        problems.push(`${label}: must satisfy exactly one of ${schema.oneOf.map((b) => `[${b.required.join(", ")}]`).join(" or ")}, matched ${satisfied.length}`);
      }
    }
  }

  if (schema.type === "array") {
    payload.forEach((item, i) => problems.push(...checkClaim(item, schema.items, `${path}[${i}]`)));
  }

  if (schema.enum && !schema.enum.includes(payload)) {
    problems.push(`${label}: "${payload}" is not one of ${JSON.stringify(schema.enum)}`);
  }

  return problems;
}

export function validateClaim(payload, schema = loadSchema()) {
  const problems = checkClaim(payload, schema);
  if (problems.length > 0) {
    throw new Error(`claim payload failed schema validation:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

export function resolveCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function defaultHardware() {
  const list = cpus();
  const model = list[0]?.model ?? "unknown";
  return `${model} x${list.length} (${platform()}/${arch()})`;
}

const MARGIN_POLICIES = {
  latency: (value) => ({ direction: "max", value: value * 1.2 }),
  rate: (value) => ({ direction: "min", value: value - 2 }),
};

function seedThreshold(compareValue, marginKind) {
  const policy = MARGIN_POLICIES[marginKind];
  if (!policy) {
    throw new Error(`writeClaim: no threshold given and no recognized marginKind ("${marginKind}"); pass payload.threshold or a marginKind of ${Object.keys(MARGIN_POLICIES).join("/")}`);
  }
  return policy(compareValue);
}

function regressed(compareValue, threshold) {
  if (threshold.direction === "max") return compareValue > threshold.value;
  return compareValue < threshold.value;
}

function readExisting(claimPath) {
  if (!existsSync(claimPath)) return null;
  return JSON.parse(readFileSync(claimPath, "utf8"));
}

/** Writes results/claims/<name>.json, stamping generatedAt/commit and
 *  resolving the regression threshold: an explicit payload.threshold wins
 *  every run, otherwise the previously committed file's threshold carries
 *  forward, and a first run seeds one from its own value via marginKind
 *  ("latency" or "rate"). Always writes the file, then throws if the fresh
 *  value regressed past that threshold — the file itself is left as the
 *  regression evidence. */
export function writeClaim(name, payload) {
  const claimPath = join(CLAIMS_DIR, `${name}.json`);
  const existing = readExisting(claimPath);
  const compareValue = payload.value !== undefined ? payload.value : payload.delta;

  const threshold = payload.threshold
    ?? existing?.threshold
    ?? seedThreshold(compareValue, payload.marginKind);

  const record = {
    name,
    generatedAt: new Date().toISOString(),
    commit: resolveCommit(),
    hardware: payload.hardware ?? defaultHardware(),
    pack: payload.pack ?? "shipped",
    unit: payload.unit,
    threshold,
    sources: payload.sources,
  };
  if (payload.value !== undefined) {
    record.value = payload.value;
  } else {
    record.before = payload.before;
    record.after = payload.after;
    record.delta = payload.delta;
  }
  if (payload.detail !== undefined) record.detail = payload.detail;

  validateClaim(record);

  mkdirSync(CLAIMS_DIR, { recursive: true });
  writeFileSync(claimPath, `${JSON.stringify(record, null, 2)}\n`);

  if (regressed(compareValue, threshold)) {
    throw new Error(`claim "${name}" regressed: ${compareValue}${record.unit} crosses its ${threshold.direction} threshold of ${threshold.value}${record.unit} (wrote ${claimPath} anyway)`);
  }

  return record;
}
