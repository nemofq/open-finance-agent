"""The single error type `fin` raises."""

from __future__ import annotations


class FinError(ValueError):
    """Raised when a `fin` call cannot produce a meaningful number.

    Messages are written for the model that wrote the failing call: they name the
    function, say what was wrong with the argument, and say what to pass instead.
    """
