"""Text rendering for an inventory list."""

from .inventory import total_value


def render_report(items):
    lines = [item.describe() for item in items]
    lines.append(f"total: {total_value(items):.2f}")
    return "\n".join(lines)
