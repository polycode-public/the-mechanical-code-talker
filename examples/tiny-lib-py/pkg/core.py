"""Core domain types for the tiny inventory library."""


class Item:
    """A single inventory item with a name and a unit price."""

    def __init__(self, name, price):
        self.name = name
        self.price = price

    def describe(self):
        return f"{self.name}: {self.price:.2f}"


def parse_price(text):
    """Parse a price string like '3.50' into a float, or None if invalid."""
    try:
        return round(float(text), 2)
    except (TypeError, ValueError):
        return None
