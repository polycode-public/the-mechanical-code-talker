// Shared child-process runner for the producer's out-of-process backends (git
// history, the Python AST extractor). Collects stdout, never rejects, and arms an
// optional SIGKILL wall-clock so a wedged subprocess can never hang an index.

import { spawn } from "node:child_process";

/** spawn, collect stdout; resolve {code, stdout, stderr, timedOut, truncated}
 *  (never reject). `timeout` (ms, >0) arms a SIGKILL wall-clock; `truncated` is set
 *  when stdout exceeded maxBuffer (dropped bytes → an incomplete result the caller
 *  must NOT treat as authoritative). */
export function exec(cmd, args, { cwd, maxBuffer = 512 * 1024 * 1024, timeout = 0 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd });
    let stdout = "";
    let stderr = "";
    let size = 0;
    let truncated = false;
    let timedOut = false;
    const timer = timeout > 0 ? setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeout) : null;
    child.stdout?.on("data", (d) => { size += d.length; if (size <= maxBuffer) stdout += d; else truncated = true; });
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        resolve({ code: -1, stdout, stderr: stderr + `timed out after ${Math.round(timeout / 1000)}s`, timedOut: true, truncated });
      } else {
        resolve({ code: code ?? -1, stdout, stderr, timedOut: false, truncated });
      }
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut, truncated });
    });
  });
}
