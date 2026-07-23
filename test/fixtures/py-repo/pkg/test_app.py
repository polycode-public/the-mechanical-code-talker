"""A test module so the producer emits a tests-coverage edge into pkg/app.py."""

from .app import App


def test_run():
    assert App().run(3) == 3
