"""The API registry.

Every public `fin` function is decorated with `@api`. `api_reference()` renders the
registry as the compact text embedded in the `financial_calculator` tool
description - it is the only place the model learns the API, so each summary states
the unit and the convention.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

# Groups are rendered in exactly this order.
GROUPS: tuple[str, ...] = (
    "Growth",
    "Profitability and ratios",
    "Valuation",
    "Cash flows",
    "Returns and risk",
    "Earnings",
    "Funds and income",
    "Options",
    "Portfolio",
)

MAX_SUMMARY = 90

F = TypeVar("F", bound=Callable[..., object])


@dataclass(frozen=True)
class ApiEntry:
    """One public function, as the model sees it."""

    name: str
    group: str
    signature: str
    summary: str


_REGISTERED: list[ApiEntry] = []


def _format_default(value: object) -> str:
    """Render a default the way the model should type it."""
    if isinstance(value, str):
        return f'"{value}"'
    return repr(value)


def _signature_of(func: Callable[..., object]) -> str:
    """'cagr(begin, end, periods)' - names and defaults only, no annotations."""
    parts: list[str] = []
    for parameter in inspect.signature(func).parameters.values():
        if parameter.kind is inspect.Parameter.VAR_POSITIONAL:
            parts.append(f"*{parameter.name}")
            continue
        if parameter.kind is inspect.Parameter.VAR_KEYWORD:
            parts.append(f"**{parameter.name}")
            continue
        if parameter.kind is inspect.Parameter.KEYWORD_ONLY and "*" not in parts:
            parts.append("*")
        if parameter.default is inspect.Parameter.empty:
            parts.append(parameter.name)
        else:
            parts.append(f"{parameter.name}={_format_default(parameter.default)}")
    return f"{func.__name__}({', '.join(parts)})"


def api(*, group: str, summary: str) -> Callable[[F], F]:
    """Register a public function. The function itself is returned unchanged."""
    if group not in GROUPS:
        raise ValueError(f"unknown API group {group!r}; expected one of {GROUPS}")
    if len(summary) > MAX_SUMMARY:
        raise ValueError(
            f"API summary is {len(summary)} chars, the limit is {MAX_SUMMARY}: {summary!r}"
        )

    def register(func: F) -> F:
        _REGISTERED.append(
            ApiEntry(
                name=func.__name__,
                group=group,
                signature=_signature_of(func),
                summary=summary,
            )
        )
        return func

    return register


def entries() -> tuple[ApiEntry, ...]:
    """Every registered function, in GROUPS order and registration order within a group."""
    return tuple(sorted(_REGISTERED, key=lambda entry: GROUPS.index(entry.group)))


def api_reference() -> str:
    """The compact API reference embedded in the tool description."""
    lines: list[str] = []
    all_entries = entries()
    for group in GROUPS:
        in_group = [entry for entry in all_entries if entry.group == group]
        if not in_group:
            continue
        if lines:
            lines.append("")
        lines.append(group)
        lines.extend(f"  {entry.signature} - {entry.summary}" for entry in in_group)
    return "\n".join(lines)
