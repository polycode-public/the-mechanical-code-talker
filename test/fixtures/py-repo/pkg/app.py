"""The application module that builds on core."""

from .core import Base, core_fn


class App(Base):
    """An app that uses the core helper."""

    def run(self, n):
        return core_fn(n)
