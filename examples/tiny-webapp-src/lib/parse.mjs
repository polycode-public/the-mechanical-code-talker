// Parses a single pipe-delimited line into a task record — the sole conversion
// point between raw text rows and the app's in-memory task shape.
export function parseRow(line) {
  const [id, title, status] = line.split("|").map((part) => part.trim());
  if (!id || !title) return null;
  return { id, title, status: status || "open" };
}

export function isBlank(line) {
  return line.trim().length === 0;
}
