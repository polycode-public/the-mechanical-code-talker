// A read-only static file server for the browser tests: enough of one to serve
// the built Pages site to Chromium, and nothing more. It binds an ephemeral
// port, so any number of test files can run their own at once.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const CONTENT_TYPES = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
  }),
);

/** The file a request maps to, or null when it escapes the served root. */
function resolveRequestPath(root, url) {
  const { pathname } = new URL(url, "http://localhost");
  const decoded = decodeURIComponent(pathname);
  const target = path.join(root, decoded.endsWith("/") ? `${decoded}index.html` : decoded);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

/**
 * Serve `root` on an ephemeral port.
 * Resolves to `{ origin, close }` once the port is listening.
 */
export async function serveDirectory(root) {
  const servedRoot = path.resolve(root);

  const server = createServer((req, res) => {
    const file = resolveRequestPath(servedRoot, req.url);
    if (!file) {
      res.writeHead(403).end("forbidden");
      return;
    }
    stat(file)
      .then((info) => {
        if (info.isDirectory()) return stat(path.join(file, "index.html")).then(() => path.join(file, "index.html"));
        return file;
      })
      .then((found) => {
        res.writeHead(200, {
          "content-type": CONTENT_TYPES.get(path.extname(found)) ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        createReadStream(found).pipe(res);
      })
      .catch(() => {
        res.writeHead(404).end("not found");
      });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
