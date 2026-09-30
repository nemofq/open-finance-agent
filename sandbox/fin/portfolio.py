"""Portfolio weights, concentration and group exposure."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ._coerce import as_floats, as_labeled, labels_of
from ._fmt import num, pct
from .errors import FinError
from .registry import api
from .result import FinResult, FinStruct, FinVector


def _to_weights(func: str, values: list[float]) -> list[float]:
    """Normalize position values to weights summing to 1 (a no-op on real weights)."""
    if not values:
        raise FinError(f"fin.{func}: the portfolio is empty")
    total = sum(values)
    if total == 0.0:
        raise FinError(
            f"fin.{func}: the position values sum to 0, so weights are undefined; long "
            "and short legs may be cancelling out"
        )
    return [value / total for value in values]


@api(group="Portfolio", summary="portfolio weights as a vector of decimals summing to 1; keeps labels")
def weights(values: object) -> FinVector:
    """Position values as weights (decimals summing to 1).

    Labels are kept when a pandas Series or a dict is passed, so `.to_dict()` gives
    ticker -> weight.
    """
    series = as_floats(values)
    computed = _to_weights("weights", series)
    return FinVector(
        computed,
        labels=labels_of(values),
        unit="%",
        formula=f"weights = value / {num(sum(series))} total, {len(series)} positions",
        inputs={"n": len(series), "total": sum(series)},
    )


@api(group="Portfolio", summary="Herfindahl-Hirschman index of the weights, 0 to 1; 1/HHI = effective n")
def concentration(values_or_weights: object) -> FinResult:
    """Herfindahl-Hirschman index of the portfolio, between 0 and 1.

    Accepts either position values or weights - they are normalized to sum to 1
    first, so both give the same answer. 1 is a single holding; the formula string
    also reports 1/HHI, the effective number of holdings.
    """
    series = as_floats(values_or_weights)
    computed = _to_weights("concentration", series)
    index = sum(weight * weight for weight in computed)
    effective = 1.0 / index if index else float("inf")
    return FinResult(
        index,
        formula=f"concentration = sum(w^2) over {len(computed)} holdings; 1/HHI = {num(effective)}",
        inputs={"n": len(computed), "effective_holdings": effective},
    )


def _group_for(labels: list[str], groups: object) -> list[str]:
    """One group name per position, from a label->group mapping or a parallel list."""
    if isinstance(groups, Mapping):
        missing = [label for label in labels if label not in groups]
        if missing:
            raise FinError(
                "fin.exposure: groups has no entry for "
                + ", ".join(repr(label) for label in missing[:5])
                + (f" and {len(missing) - 5} more" if len(missing) > 5 else "")
                + "; every position needs a group"
            )
        return [str(groups[label]) for label in labels]
    if isinstance(groups, Sequence) and not isinstance(groups, (str, bytes)):
        if len(groups) != len(labels):
            raise FinError(
                f"fin.exposure: got {len(groups)} groups for {len(labels)} positions; pass "
                "a parallel list or a dict keyed by the position labels"
            )
        return [str(group) for group in groups]
    raise FinError(
        f"fin.exposure: groups must be a dict of label -> group or a parallel list, got "
        f"{type(groups).__name__}"
    )


@api(group="Portfolio", summary="struct of group -> weight as decimals summing to 1")
def exposure(values: object, groups: object) -> FinStruct:
    """Portfolio weight per group, as decimals summing to 1.

    `groups` is a dict of position label -> group (needs a labeled input such as a
    pandas Series or a dict), or a list of group names parallel to `values`.
    Groups appear in the order they are first seen.
    """
    labels, series = as_labeled(values)
    computed = _to_weights("exposure", series)
    per_position = _group_for(labels, groups)
    totals: dict[str, float] = {}
    for group, weight in zip(per_position, computed, strict=True):
        totals[group] = totals.get(group, 0.0) + weight
    largest = max(totals.items(), key=lambda item: item[1])
    return FinStruct(
        totals,
        unit="%",
        formula=(
            f"exposure: {len(computed)} positions in {len(totals)} groups; "
            f"largest {largest[0]} {pct(largest[1])}"
        ),
        inputs={"n": len(computed), "groups": sorted(totals)},
    )
