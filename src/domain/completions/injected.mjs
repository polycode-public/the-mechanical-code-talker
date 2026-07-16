// completions/injected.mjs — the construction check every stage in this directory runs on
// the handles its caller passes in. The stages are pure: they read the memory store and the
// prose finisher through an explicit options bag, never by importing either. A missing
// handle is a loud construction error, never a silent no-op stage.

/**
 * @param {object} bag  the caller-supplied handle bag (e.g. opts.store)
 * @param {string[]} needed  the names the caller must supply
 * @param {{caller: string, option: string}} where  the stage's name, and the option the bag
 *   arrives on — both quoted back in the error so a miswired call names itself
 * @returns {object} `bag`, once every name is present
 */
export function requireInjected(bag, needed, { caller, option }) {
  const missing = needed.filter((name) => bag?.[name] === undefined);
  if (missing.length) {
    throw new TypeError(
      `${caller} needs a \`${option}\` option carrying { ${needed.join(", ")} } — missing ${missing.join(", ")}`,
    );
  }
  return bag;
}
