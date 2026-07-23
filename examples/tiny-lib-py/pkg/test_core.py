import unittest

from .core import Item, parse_price


class ParsePriceTests(unittest.TestCase):
    def test_parses_a_valid_price(self):
        self.assertEqual(parse_price("3.5"), 3.5)

    def test_returns_none_for_an_invalid_price(self):
        self.assertIsNone(parse_price("free"))


class ItemTests(unittest.TestCase):
    def test_describe_formats_name_and_price(self):
        item = Item("apple", 1.2)
        self.assertEqual(item.describe(), "apple: 1.20")


if __name__ == "__main__":
    unittest.main()
