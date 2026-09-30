"""The three shapes every public `fin` function returns.

All three expose the same four attributes so a caller (or `emit()`) can record a
result without knowing which function produced it:

    .value      the number(s): float, list[float] or dict[str, float]
    .unit       "%", "x", a currency code, or None when the unit follows the input
    .formula    a short human-readable formula with the numbers substituted
    .inputs     the named scalar arguments actually used, JSON-serializable
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator, Mapping, Sequence

from ._fmt import mult, num, pct
from .errors import FinError

# `inputs` goes into evidence entries as JSON, so a recorded series is truncated.
MAX_INPUT_ITEMS = 20


def _clean_inputs(inputs: Mapping[str, object] | None) -> dict[str, object]:
    """Copy `inputs`, truncating long sequences so the dict stays small and JSON-safe."""
    if not inputs:
        return {}
    out: dict[str, object] = {}
    for key, value in inputs.items():
        if isinstance(value, (list, tuple)) and len(value) > MAX_INPUT_ITEMS:
            out[key] = list(value[:MAX_INPUT_ITEMS])
            out[f"{key}_n"] = len(value)
        elif isinstance(value, tuple):
            out[key] = list(value)
        else:
            out[key] = value
    return out


def format_value(value: float, unit: str | None) -> str:
    """Render one number the way its unit is normally read."""
    if unit == "%":
        return pct(value)
    if unit == "x":
        return mult(value)
    if unit:
        return f"{num(value)} {unit}"
    return num(value)


class FinResult(float):
    """A float carrying its unit, formula and inputs.

    It *is* a float, so `float(r)`, comparisons and `json.dumps` all work, and any
    arithmetic on it yields a plain float (the unit and formula no longer hold once
    the number has been combined with something else).
    """

    __slots__ = ("_unit", "_formula", "_inputs")

    def __new__(
        cls,
        value: float,
        *,
        unit: str | None = None,
        formula: str | None = None,
        inputs: Mapping[str, object] | None = None,
    ) -> FinResult:
        self = super().__new__(cls, value)
        self._unit = unit
        self._formula = formula
        self._inputs = _clean_inputs(inputs)
        return self

    @property
    def value(self) -> float:
        """The number as a plain float."""
        return float(self)

    @property
    def unit(self) -> str | None:
        return self._unit

    @property
    def formula(self) -> str | None:
        return self._formula

    @property
    def inputs(self) -> dict[str, object]:
        return dict(self._inputs)

    def __getattr__(self, name: str) -> object:
        # `.hhi` and every `inputs` key read as attributes: models write `concentration(...).hhi`,
        # and the portfolio-check skill reads `.effective_holdings`.
        if name == "hhi":
            return float(self)
        if hasattr(self, "_inputs") and self._inputs and name in self._inputs:
            return self._inputs[name]
        raise AttributeError(f"'FinResult' object has no attribute '{name}'")

    def __repr__(self) -> str:
        shown = format_value(float(self), self._unit)
        return f"{shown} ({self._formula})" if self._formula else shown


class FinVector(Sequence):
    """An ordered sequence of floats, with the labels of the input series when it had any.

    Supports `len()`, indexing, slicing, iteration and `==` against any sequence of
    numbers. `.to_dict()` is available only when the vector carries labels.
    """

    __slots__ = ("_values", "_labels", "_unit", "_formula", "_inputs")

    def __init__(
        self,
        values: Iterable[float],
        *,
        labels: Sequence[str] | None = None,
        unit: str | None = None,
        formula: str | None = None,
        inputs: Mapping[str, object] | None = None,
    ) -> None:
        self._values = [float(v) for v in values]
        if labels is not None and len(labels) != len(self._values):
            raise FinError(
                f"FinVector: got {len(labels)} labels for {len(self._values)} values; "
                "they must line up one-to-one"
            )
        self._labels = None if labels is None else [str(label) for label in labels]
        self._unit = unit
        self._formula = formula
        self._inputs = _clean_inputs(inputs)

    @property
    def value(self) -> list[float]:
        """The numbers as a plain list of floats."""
        return list(self._values)

    @property
    def labels(self) -> list[str] | None:
        return None if self._labels is None else list(self._labels)

    @property
    def unit(self) -> str | None:
        return self._unit

    @property
    def formula(self) -> str | None:
        return self._formula

    @property
    def inputs(self) -> dict[str, object]:
        return dict(self._inputs)

    def to_dict(self) -> dict[str, float]:
        """Label -> value. Raises when the vector has no labels."""
        if self._labels is None:
            raise FinError(
                "FinVector.to_dict: this vector has no labels; pass a pandas Series or a "
                "dict instead of a plain list to keep them"
            )
        return dict(zip(self._labels, self._values, strict=True))

    def __len__(self) -> int:
        return len(self._values)

    def __getitem__(self, index: int | slice | str) -> float | list[float]:
        if isinstance(index, str):
            if self._labels is None:
                raise KeyError(f"FinVector has no labels; cannot index with string {index!r}")
            try:
                pos = self._labels.index(index)
            except ValueError:
                raise KeyError(f"{index!r} not in FinVector labels") from None
            return self._values[pos]
        return self._values[index]

    def __contains__(self, key: object) -> bool:
        if isinstance(key, str) and self._labels is not None:
            return key in self._labels
        return key in self._values

    def items(self) -> Iterator[tuple[str, float]]:
        """(label, value) pairs. Raises when the vector has no labels."""
        if self._labels is None:
            raise FinError("FinVector.items: this vector has no labels")
        return iter(zip(self._labels, self._values))

    def keys(self) -> list[str]:
        """Labels. Raises when the vector has no labels."""
        if self._labels is None:
            raise FinError("FinVector.keys: this vector has no labels")
        return list(self._labels)

    def values(self) -> list[float]:
        """The numbers as a list of floats."""
        return list(self._values)

    def get(self, key: str, default: float | None = None) -> float | None:
        if self._labels is not None and key in self._labels:
            return self._values[self._labels.index(key)]
        return default

    def __iter__(self) -> Iterator[float]:
        return iter(self._values)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, FinVector):
            return self._values == other._values
        if isinstance(other, (list, tuple)):
            return self._values == [float(v) for v in other]
        return NotImplemented

    def __ne__(self, other: object) -> bool:
        result = self.__eq__(other)
        return result if result is NotImplemented else not result

    def __hash__(self) -> int:
        return hash(tuple(self._values))

    def __repr__(self) -> str:
        shown = ", ".join(format_value(v, self._unit) for v in self._values[:6])
        if len(self._values) > 6:
            shown += f", ... ({len(self._values)} values)"
        return f"[{shown}]" + (f" ({self._formula})" if self._formula else "")


class FinStruct(Mapping):
    """Several named results from one calculation (dcf, greeks, beat_or_miss...).

    Fields are reachable both ways: `r.per_share` and `r["per_share"]`. A struct may
    carry non-numeric fields (`beat_or_miss.verdict`); `.value` returns only the
    numeric ones, which is what goes into an evidence entry.
    """

    __slots__ = ("_fields", "_unit", "_formula", "_inputs")

    def __init__(
        self,
        fields: Mapping[str, object],
        *,
        unit: str | None = None,
        formula: str | None = None,
        inputs: Mapping[str, object] | None = None,
    ) -> None:
        self._fields = dict(fields)
        self._unit = unit
        self._formula = formula
        self._inputs = _clean_inputs(inputs)

    @property
    def value(self) -> dict[str, float]:
        """The numeric fields only, in order."""
        return {k: float(v) for k, v in self._fields.items() if isinstance(v, (int, float))}

    @property
    def unit(self) -> str | None:
        return self._unit

    @property
    def formula(self) -> str | None:
        return self._formula

    @property
    def inputs(self) -> dict[str, object]:
        return dict(self._inputs)

    def __getitem__(self, key: str) -> object:
        try:
            return self._fields[key]
        except KeyError:
            raise KeyError(
                f"{key!r} is not a field of this result; it has: {', '.join(self._fields)}"
            ) from None

    def __iter__(self) -> Iterator[str]:
        return iter(self._fields)

    def __len__(self) -> int:
        return len(self._fields)

    def __getattr__(self, name: str) -> object:
        # Only reached when normal attribute lookup failed. The leading-underscore
        # guard keeps __slots__ lookups during __init__ from recursing.
        if name.startswith("_"):
            raise AttributeError(name)
        fields = object.__getattribute__(self, "_fields")
        try:
            return fields[name]
        except KeyError:
            raise AttributeError(
                f"this result has no field {name!r}; it has: {', '.join(fields)}"
            ) from None

    def __repr__(self) -> str:
        parts = []
        for key, value in self._fields.items():
            shown_value = (
                format_value(value, self._unit) if isinstance(value, (int, float)) else repr(value)
            )
            parts.append(f"{key}={shown_value}")
        shown = ", ".join(parts)
        return f"{{{shown}}}" + (f" ({self._formula})" if self._formula else "")
