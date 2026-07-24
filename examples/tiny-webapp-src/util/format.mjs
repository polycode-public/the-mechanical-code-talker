// Shared text-formatting helpers with no dependency on the task shape.
export function formatStatus(status) {
  return status.toUpperCase();
}

export function pad(str, width) {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}
