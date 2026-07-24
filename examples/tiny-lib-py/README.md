# Example: tiny-lib-py

A small, stdlib-only Python package — a demo target for `tmct index`'s Python
backend, the sibling of `examples/tiny-webapp-src` on the JS/TS side.

```bash
node bin/tmct.mjs index --repo examples/tiny-lib-py
```

## What's in it

Four modules, a tiny inventory library:

- `pkg/__init__.py` — the package marker, names the public surface.
- `pkg/core.py` — `Item` and `parse_price`, the domain types.
- `pkg/inventory.py` — `load_items`/`total_value`, built on `core`.
- `pkg/report.py` — `render_report`, a text view built on `inventory`.

Its own tests (`pkg/test_core.py`, `pkg/test_inventory.py`) use only
`unittest` from the standard library:

```bash
python3 -m unittest discover
```
