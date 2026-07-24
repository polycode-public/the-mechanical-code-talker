"""In-memory inventory built from parsed item rows."""

from .core import Item, parse_price


def load_items(rows):
    """rows: an iterable of (name, price_text) pairs."""
    items = []
    for name, price_text in rows:
        price = parse_price(price_text)
        if price is None:
            continue
        items.append(Item(name, price))
    return items


def total_value(items):
    return sum(item.price for item in items)
