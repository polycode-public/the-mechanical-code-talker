import unittest

from .inventory import load_items, total_value


class LoadItemsTests(unittest.TestCase):
    def test_skips_rows_with_an_unparseable_price(self):
        items = load_items([("apple", "1.00"), ("bad", "free")])
        self.assertEqual(len(items), 1)

    def test_total_value_sums_item_prices(self):
        items = load_items([("apple", "1.00"), ("pear", "2.50")])
        self.assertEqual(total_value(items), 3.5)


if __name__ == "__main__":
    unittest.main()
