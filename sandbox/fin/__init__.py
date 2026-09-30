"""`fin` - the reviewed financial formulas the calculator sandbox exposes.

Stdlib-only pure Python on purpose: the golden tests run in CPython (where numpy and
pandas are not installed) and the sandbox runs Pyodide, and both must produce
identical numbers. Inputs may still be pandas Series/DataFrames or numpy arrays -
they are duck-typed in `_coerce`, never imported.

Every public function returns a FinResult, FinVector or FinStruct, each carrying
`.value`, `.unit`, `.formula` and `.inputs` for the evidence entry and the report
footnote. See CONVENTIONS.md for the pinned conventions.
"""

from __future__ import annotations

from .cashflow import fv, irr, npv, pmt, xirr, xnpv
from .earnings import beat_or_miss, guidance_midpoint, surprise
from .errors import FinError
from .funds import distribution_yield, nav_change, total_return
from .growth import cagr, qoq, ttm, yoy
from .options import black_scholes, expected_move, greeks, implied_vol
from .portfolio import concentration, exposure, weights
from .profitability import margin, per_share, ratio
from .registry import ApiEntry, api_reference, entries
from .result import FinResult, FinStruct, FinVector
from .risk import (
    annualized_return,
    beta,
    correlation,
    max_drawdown,
    returns,
    sharpe,
    sortino,
    volatility,
)
from .valuation import (
    capm,
    dcf,
    ev,
    ev_to_ebitda,
    fcf_yield,
    pe,
    premium_to_nav,
    reverse_dcf,
    wacc,
)

# Stored on every computed evidence entry, so results stay reproducible.
__version__ = "1.0.0"

# Built after every function module has imported and registered itself.
API: tuple[ApiEntry, ...] = entries()

# Read from the registry, so a new fin function needs no edit here.
__all__ = [
    "API",
    "ApiEntry",
    "FinError",
    "FinResult",
    "FinStruct",
    "FinVector",
    "__version__",
    "api_reference",
    *(entry.name for entry in API),
]
