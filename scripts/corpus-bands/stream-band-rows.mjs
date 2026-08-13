// stream-band-rows.mjs — writes a corpus-band pipeline's rows to disk one
// line at a time, instead of building the whole file as one string first.
// At the full ConceptNet dump's scale (millions of rows) `rows.map(...).join`
// builds a single string that first exhausts the default heap, then throws
// RangeError: Invalid string length once the string itself is too long for
// V8 to represent — streaming avoids ever holding that string. Byte-for-byte
// this produces the same file the old `rows.map(r => JSON.stringify(r))
// .join("\n") + "\n"` did, including the lone "\n" it wrote for zero rows.

import { createWriteStream } from "node:fs";
import { createHash } from "node:crypto";

/** Writes `rows` to `outPath`, one JSON line per row, hashing the same bytes
 *  as they're written rather than re-reading the file afterwards. Returns
 *  `{ bytes, digest }`: `bytes` is the written string's length (the same
 *  measure the old `text.length` summary reported) and `digest` is the
 *  sha256 of the file's full contents, hex-encoded. */
export async function writeRowsStreaming(outPath, rows) {
  const stream = createWriteStream(outPath);
  const hash = createHash("sha256");
  let bytes = 0;
  let failure = null;
  // Every wait below races this. A stream that errors (an unwritable path, a
  // full disk) emits neither the `drain` nor the `finish` the waits are
  // otherwise sitting on, so without the race the pipeline hangs silently
  // instead of reporting what went wrong.
  let rejectOnFailure = () => {};
  const failed = new Promise((_resolve, reject) => { rejectOnFailure = reject; });
  failed.catch(() => {});
  stream.on("error", (err) => {
    failure = failure || err;
    rejectOnFailure(failure);
  });

  const write = async (chunk) => {
    hash.update(chunk);
    bytes += chunk.length;
    const flushed = stream.write(chunk);
    if (failure) throw failure;
    if (!flushed) {
      await Promise.race([new Promise((resolve) => stream.once("drain", resolve)), failed]);
    }
  };

  if (rows.length === 0) {
    await write("\n");
  } else {
    for (const row of rows) await write(`${JSON.stringify(row)}\n`);
  }

  await Promise.race([new Promise((resolve) => { stream.end(() => resolve()); }), failed]);
  if (failure) throw failure;

  return { bytes, digest: hash.digest("hex") };
}
