"""Turn whatever the model passed in into plain Python numbers and dates.

`fin` is stdlib-only (see CONVENTIONS.md), but the calculator sandbox preloads
evidence as pandas objects, so every entry point accepts pandas Series/DataFrame
columns and numpy arrays. That is done by duck typing here - `fin` never imports
pandas or numpy, so it behaves identically in CPython and in Pyodide.
"""

from __future__ import annotations

import datetime as _dt
from collections.abc import Iterable, Mapping
from decimal import Decimal

from .errors import FinError

# Iterable, but never a series of numbers.
_NOT_A_SERIES = (str, bytes, bytearray)


def as_float(x: object) -> float:
    """One number from a scalar, a 0-d numpy value, a FinResult or a Decimal.

    Strings are rejected on purpose: a number that arrived as text almost always
    means a value was pasted in instead of referenced.
    """
    if isinstance(x, bool):
        # bool is an int in Python; accepting it silently hides a wrong argument.
        raise FinError(f"expected a number, got the boolean {x!r}")
    if isinstance(x, (int, float, Decimal)):
        return float(x)
    if isinstance(x, _NOT_A_SERIES):
        raise FinError(
            f"expected a number, got the string {x!r}; pass the number itself "
            "(e.g. 4.32e9), not text"
        )
    item = getattr(x, "item", None)
    if callable(item):
        # numpy scalars and one-element arrays; .item() gives a Python number. It
        # raises for anything longer, which falls through to the messages below.
        try:
            unwrapped = item()
        except (TypeError, ValueError):
            unwrapped = None
        if isinstance(unwrapped, (int, float, Decimal)) and not isinstance(unwrapped, bool):
            return float(unwrapped)
    size = getattr(x, "__len__", None)
    if callable(size):
        raise FinError(
            f"expected a single number, got a sequence of length {size()}; pass one "
            "element (e.g. series.iloc[-1]) or use a function that takes a series"
        )
    raise FinError(f"expected a number, got {type(x).__name__}")


def as_floats(x: object) -> list[float]:
    """A list of floats from a list, tuple, generator, numpy array, pandas Series or dict.

    A dict contributes its values in insertion order; a pandas Series contributes its
    values (its labels are read separately by `labels_of`).
    """
    if isinstance(x, _NOT_A_SERIES):
        raise FinError(
            f"expected a series of numbers, got the string {x!r}; pass a list or a "
            "pandas Series"
        )
    tolist = getattr(x, "tolist", None)
    values_attr = getattr(x, "values", None)
    if isinstance(x, Mapping):
        raw: list[object] = list(x.values())
    elif callable(tolist):
        # numpy array / pandas Series - .tolist() gives plain Python numbers.
        raw = list(tolist())
    elif values_attr is not None and not callable(values_attr):
        # Array-shaped objects whose .values is an attribute rather than a method.
        return as_floats(values_attr)
    elif isinstance(x, Iterable):
        raw = list(x)
    else:
        raise FinError(
            f"expected a series of numbers, got {type(x).__name__}; pass a list, a "
            "pandas Series or a numpy array"
        )
    out: list[float] = []
    for position, entry in enumerate(raw):
        try:
            out.append(as_float(entry))
        except FinError as exc:
            raise FinError(f"entry {position} of the series is not a number: {exc}") from None
    return out


def labels_of(x: object) -> list[str] | None:
    """The keys of a dict or the index labels of a pandas Series; None for a plain list."""
    if isinstance(x, Mapping):
        return [str(key) for key in x]
    if isinstance(x, _NOT_A_SERIES):
        return None
    index = getattr(x, "index", None)
    if index is None or callable(index):
        # list.index is a method, not an axis of labels.
        return None
    try:
        return [str(label) for label in index]
    except TypeError:
        return None


def as_labeled(x: object) -> tuple[list[str], list[float]]:
    """(labels, values). A plain list gets positional labels "0", "1", ..."""
    values = as_floats(x)
    labels = labels_of(x)
    if labels is None:
        return [str(i) for i in range(len(values))], values
    if len(labels) != len(values):
        raise FinError(
            f"the series has {len(labels)} labels but {len(values)} values; it may "
            "contain a nested structure"
        )
    return labels, values


def as_date(x: object) -> _dt.date:
    """One date from a date, datetime, pandas Timestamp or ISO 'YYYY-MM-DD' string."""
    if isinstance(x, _dt.datetime):
        return x.date()
    if isinstance(x, _dt.date):
        return x
    if isinstance(x, str):
        try:
            return _dt.date.fromisoformat(x[:10])
        except ValueError:
            raise FinError(f"{x!r} is not a date; use ISO format, e.g. '2025-03-31'") from None
    year, month, day = (getattr(x, part, None) for part in ("year", "month", "day"))
    if year is not None and month is not None and day is not None:
        # pandas Timestamp, and anything else date-shaped.
        return _dt.date(int(year), int(month), int(day))
    raise FinError(
        f"expected a date, got {type(x).__name__}; pass a datetime.date, a pandas "
        "Timestamp or an ISO string like '2025-03-31'"
    )


def as_dates(x: object) -> list[_dt.date]:
    """A list of dates from a list, a pandas DatetimeIndex or a Series of timestamps."""
    if isinstance(x, _NOT_A_SERIES):
        raise FinError(f"expected a series of dates, got the string {x!r}")
    tolist = getattr(x, "tolist", None)
    if isinstance(x, Mapping):
        raw: list[object] = list(x.keys())
    elif callable(tolist):
        raw = list(tolist())
    elif isinstance(x, Iterable):
        raw = list(x)
    else:
        raise FinError(f"expected a series of dates, got {type(x).__name__}")
    out: list[_dt.date] = []
    for position, entry in enumerate(raw):
        try:
            out.append(as_date(entry))
        except FinError as exc:
            raise FinError(f"entry {position} of the dates is not a date: {exc}") from None
    return out
