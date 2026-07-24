"""Core helpers for the python fixture repo."""

LIMIT = 10


def core_fn(n):
    """Return n bounded by LIMIT."""
    return min(n, LIMIT)


class Base:
    """The inheritance root of this fixture."""

    def describe(self):
        return "base"
