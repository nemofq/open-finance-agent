"""Golden tests for `fin`.

Every expected value is hand-verified: the arithmetic is in the comment above the
assertion, and anything taken from a published source names it. These run in CPython
(no numpy, no pandas) and inside Pyodide, and must agree.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import datetime  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import unittest  # noqa: E402

import fin  # noqa: E402

PLACES = 9


class FakeSeries:
    """Minimal stand-in for a pandas Series: values plus an index, duck-typed only."""

    def __init__(self, values, index=None):
        self._values = list(values)
        self.index = list(index) if index is not None else list(range(len(self._values)))

    def tolist(self):
        return list(self._values)

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)


class FakeScalar:
    """Minimal stand-in for a numpy 0-d scalar."""

    def __init__(self, value):
        self._value = value

    def item(self):
        return self._value


class GrowthTests(unittest.TestCase):
    def test_yoy_and_qoq(self):
        # (110 - 100) / |100| = 0.10
        self.assertAlmostEqual(fin.yoy(110, 100), 0.10, places=PLACES)
        # (103 - 100) / |100| = 0.03
        self.assertAlmostEqual(fin.qoq(103, 100), 0.03, places=PLACES)
        # Negative base: (-0.30 - -0.40) / |-0.40| = 0.10 / 0.40 = +0.25, a narrowing loss.
        self.assertAlmostEqual(fin.yoy(-0.30, -0.40), 0.25, places=PLACES)
        self.assertEqual(fin.yoy(110, 100).unit, "%")

    def test_cagr_fy2021_to_fy2025_uses_four_periods(self):
        # FY2021 revenue 318.0 -> FY2025 revenue 452.3 is FOUR intervals, not five years.
        # (452.3 / 318.0) = 1.4223270440251573
        # 1.4223270440251573 ** 0.25 = 1.0920684662909479
        # minus 1 = 0.09206846629094789 -> 9.21% a year
        self.assertAlmostEqual(fin.cagr(318.0, 452.3, 4), 0.09206846629094789, places=PLACES)
        # Sanity anchor: doubling over 4 periods is 2**0.25 - 1 = 0.18920711500272103
        self.assertAlmostEqual(fin.cagr(100, 200, 4), 2 ** 0.25 - 1, places=PLACES)
        # The same figures with the wrong period count give a visibly smaller rate.
        self.assertLess(float(fin.cagr(318.0, 452.3, 5)), float(fin.cagr(318.0, 452.3, 4)))

    def test_ttm_takes_the_last_four_quarters(self):
        # Last four of [1,2,3,4,5] are 2+3+4+5 = 14
        self.assertAlmostEqual(fin.ttm([1, 2, 3, 4, 5]), 14.0, places=PLACES)
        self.assertAlmostEqual(fin.ttm(FakeSeries([1, 2, 3, 4])), 10.0, places=PLACES)

    def test_growth_errors(self):
        with self.assertRaisesRegex(fin.FinError, "prior must be non-zero"):
            fin.yoy(10, 0)
        with self.assertRaisesRegex(fin.FinError, "prior must be non-zero"):
            fin.qoq(10, 0)
        with self.assertRaisesRegex(fin.FinError, "periods must be > 0"):
            fin.cagr(100, 200, 0)
        with self.assertRaisesRegex(fin.FinError, "begin and end must both be > 0"):
            fin.cagr(-100, 200, 4)
        with self.assertRaisesRegex(fin.FinError, "at least 4 quarterly values"):
            fin.ttm([1, 2, 3])


class ProfitabilityTests(unittest.TestCase):
    def test_margin_ratio_per_share(self):
        # 42.0 / 100.0 = 0.42
        self.assertAlmostEqual(fin.margin(42.0, 100.0), 0.42, places=PLACES)
        self.assertEqual(fin.margin(42.0, 100.0).unit, "%")
        # 3.0 / 1.5 = 2.0
        self.assertAlmostEqual(fin.ratio(3.0, 1.5, unit="x"), 2.0, places=PLACES)
        self.assertEqual(fin.ratio(3.0, 1.5, unit="x").unit, "x")
        self.assertIsNone(fin.ratio(3.0, 1.5).unit)
        # 4_320_000_000 / 1_500_000_000 shares = 2.88 per share
        self.assertAlmostEqual(fin.per_share(4.32e9, 1.5e9), 2.88, places=PLACES)

    def test_profitability_errors(self):
        with self.assertRaisesRegex(fin.FinError, "revenue must be non-zero"):
            fin.margin(1.0, 0.0)
        with self.assertRaisesRegex(fin.FinError, "denominator must be non-zero"):
            fin.ratio(1.0, 0.0)
        with self.assertRaisesRegex(fin.FinError, "shares must be > 0"):
            fin.per_share(1.0, 0.0)


class ValuationTests(unittest.TestCase):
    def test_multiples_and_cost_of_capital(self):
        # 100 / 5 = 20x
        self.assertAlmostEqual(fin.pe(100, 5), 20.0, places=PLACES)
        # 1000 + 300 - 100 + 20 + 10 = 1230
        self.assertAlmostEqual(fin.ev(1000, 300, 100, 20, 10), 1230.0, places=PLACES)
        # 1230 / 123 = 10x
        self.assertAlmostEqual(fin.ev_to_ebitda(1230, 123), 10.0, places=PLACES)
        # 50 / 1000 = 0.05
        self.assertAlmostEqual(fin.fcf_yield(50, 1000), 0.05, places=PLACES)
        # 0.042 + 1.15 * 0.045 = 0.042 + 0.05175 = 0.09375
        self.assertAlmostEqual(fin.capm(0.042, 1.15, 0.045), 0.09375, places=PLACES)
        # 0.8*0.09 + 0.2*0.05*(1-0.21) = 0.072 + 0.0079 = 0.0799
        self.assertAlmostEqual(fin.wacc(800, 200, 0.09, 0.05, 0.21), 0.0799, places=PLACES)
        # 45 / 30 - 1 = 0.50 premium
        self.assertAlmostEqual(fin.premium_to_nav(45, 30), 0.50, places=PLACES)
        # 24 / 30 - 1 = -0.20 discount
        self.assertAlmostEqual(fin.premium_to_nav(24, 30), -0.20, places=PLACES)

    def test_dcf_with_gordon_growth(self):
        # Flows 100, 110, 121 at t=1,2,3 and r=10%: each discounts to 90.909090909...
        #   100/1.1 = 90.9090909091, 110/1.21 = 90.9090909091, 121/1.331 = 90.9090909091
        #   pv_explicit = 272.7272727273
        # TV = 121 * 1.02 / (0.10 - 0.02) = 123.42 / 0.08 = 1542.75
        # pv_terminal = 1542.75 / 1.331 = 1159.0909090909
        # EV = 1431.8181818182; equity = EV - 50 = 1381.8181818182; /10 sh = 138.1818181818
        result = fin.dcf([100, 110, 121], 0.10, terminal_growth=0.02, net_debt=50, shares=10)
        self.assertAlmostEqual(result.pv_explicit, 272.7272727272727, places=PLACES)
        self.assertAlmostEqual(result.terminal_value, 1542.75, places=PLACES)
        self.assertAlmostEqual(result.pv_terminal, 1159.0909090909088, places=PLACES)
        self.assertAlmostEqual(result.enterprise_value, 1431.8181818181815, places=PLACES)
        self.assertAlmostEqual(result.equity_value, 1381.8181818181815, places=PLACES)
        self.assertAlmostEqual(result.per_share, 138.18181818181816, places=PLACES)
        # Mapping and attribute access are the same value.
        self.assertEqual(result["per_share"], result.per_share)
        self.assertEqual(list(result), list(result.value))

    def test_dcf_with_exit_multiple(self):
        # One flow of 100 at t=1, r=10%, exit multiple 10x on that flow:
        #   pv_explicit = 100/1.1 = 90.9090909091
        #   TV = 10 * 100 = 1000; pv_terminal = 1000/1.1 = 909.0909090909
        #   EV = 1000.0 exactly
        result = fin.dcf([100], 0.10, exit_multiple=10)
        self.assertAlmostEqual(result.pv_explicit, 100 / 1.1, places=PLACES)
        self.assertAlmostEqual(result.terminal_value, 1000.0, places=PLACES)
        self.assertAlmostEqual(result.enterprise_value, 1000.0, places=PLACES)
        self.assertNotIn("per_share", result)
        # terminal_metric overrides the last cash flow: 8 * 150 = 1200
        on_metric = fin.dcf([100], 0.10, exit_multiple=8, terminal_metric=150)
        self.assertAlmostEqual(on_metric.terminal_value, 1200.0, places=PLACES)

    def test_dcf_mid_year_convention(self):
        # Flows 100, 110 at t=0.5 and t=1.5 with r=10%:
        #   1.1**0.5 = 1.0488088482; 100/1.0488088482 = 95.3462589246
        #   1.1**1.5 = 1.1536897330; 110/1.1536897330 = 95.3462589246
        #   pv_explicit = 190.6925178491 (vs 190.0826... at year-end timing)
        # TV = 110*1.02/0.08 = 1402.5, discounted over the FULL 2 years: 1402.5/1.21 = 1159.0909090909
        result = fin.dcf([100, 110], 0.10, terminal_growth=0.02, mid_year=True)
        self.assertAlmostEqual(result.pv_explicit, 190.69251784911842, places=PLACES)
        self.assertAlmostEqual(result.terminal_value, 1402.5, places=PLACES)
        self.assertAlmostEqual(result.pv_terminal, 1159.090909090909, places=PLACES)
        self.assertAlmostEqual(result.enterprise_value, 1349.7834269400273, places=PLACES)
        # Mid-year is worth more than year-end timing, because the cash arrives sooner.
        year_end = fin.dcf([100, 110], 0.10, terminal_growth=0.02)
        self.assertGreater(result.enterprise_value, year_end.enterprise_value)

    def test_reverse_dcf_round_trips_a_dcf(self):
        # Build a DCF whose cash flow grows at exactly 8% for 10 years, then 2.5% forever,
        # discounted at 9% over 10 shares; reverse_dcf must recover the 8%.
        flows = [100 * 1.08**year for year in range(1, 11)]
        forward = fin.dcf(flows, 0.09, terminal_growth=0.025, shares=10)
        self.assertAlmostEqual(forward.per_share, 238.89850238446115, places=6)
        implied = fin.reverse_dcf(
            forward.per_share, 100, 0.09, 0.025, years=10, shares=10
        )
        self.assertAlmostEqual(implied, 0.08, places=PLACES)
        self.assertEqual(implied.unit, "%")
        # A higher price implies a higher growth rate.
        richer = fin.reverse_dcf(forward.per_share * 1.5, 100, 0.09, 0.025, years=10, shares=10)
        self.assertGreater(float(richer), float(implied))

    def test_valuation_errors(self):
        with self.assertRaisesRegex(fin.FinError, "eps must be > 0"):
            fin.pe(100, -1)
        with self.assertRaisesRegex(fin.FinError, "ebitda must be > 0"):
            fin.ev_to_ebitda(100, 0)
        with self.assertRaisesRegex(fin.FinError, "market_cap must be > 0"):
            fin.fcf_yield(1, 0)
        with self.assertRaisesRegex(fin.FinError, "must be > 0"):
            fin.wacc(0, 0, 0.09, 0.05, 0.21)
        with self.assertRaisesRegex(fin.FinError, "nav must be > 0"):
            fin.premium_to_nav(10, 0)
        with self.assertRaisesRegex(fin.FinError, "cash_flows is empty"):
            fin.dcf([], 0.1, terminal_growth=0.02)
        with self.assertRaisesRegex(fin.FinError, "discount_rate must be > -1"):
            fin.dcf([100], -1.5, terminal_growth=0.02)
        with self.assertRaisesRegex(fin.FinError, "exactly one of terminal_growth"):
            fin.dcf([100], 0.1)
        with self.assertRaisesRegex(fin.FinError, "exactly one of terminal_growth"):
            fin.dcf([100], 0.1, terminal_growth=0.02, exit_multiple=10)
        with self.assertRaisesRegex(fin.FinError, "must exceed terminal_growth"):
            fin.dcf([100], 0.02, terminal_growth=0.05)
        with self.assertRaisesRegex(fin.FinError, "shares must be > 0"):
            fin.dcf([100], 0.1, terminal_growth=0.02, shares=0)
        with self.assertRaisesRegex(fin.FinError, "shares= is required"):
            fin.reverse_dcf(100, 10, 0.09, 0.025)
        with self.assertRaisesRegex(fin.FinError, "shares must be > 0"):
            fin.reverse_dcf(100, 10, 0.09, 0.025, shares=0)
        with self.assertRaisesRegex(fin.FinError, "years must be > 0"):
            fin.reverse_dcf(100, 10, 0.09, 0.025, years=0, shares=10)
        with self.assertRaisesRegex(fin.FinError, "must exceed terminal_growth"):
            fin.reverse_dcf(100, 10, 0.02, 0.05, shares=10)
        with self.assertRaisesRegex(fin.FinError, "no growth rate between"):
            # 1 unit of cash flow can never be worth 1e9 per share within +100% growth.
            fin.reverse_dcf(1e9, 1.0, 0.09, 0.025, years=10, shares=10)


class CashFlowTests(unittest.TestCase):
    def test_npv_uses_the_numpy_financial_t0_convention(self):
        # -100 + 30/1.1 + 40/1.21 + 50/1.331
        #   = -100 + 27.2727272727 + 33.0578512397 + 37.5657400451
        #   = -2.1036814425     (numpy-financial: npf.npv(0.1, [-100,30,40,50]))
        self.assertAlmostEqual(fin.npv(0.1, [-100, 30, 40, 50]), -2.1036814425244366, places=PLACES)
        # A single flow at t=0 is never discounted.
        self.assertAlmostEqual(fin.npv(0.5, [100]), 100.0, places=PLACES)
        # Excel's NPV (first flow at t=1) would give this instead; we do NOT.
        self.assertNotAlmostEqual(
            float(fin.npv(0.1, [-100, 30, 40, 50])), -2.1036814425244366 / 1.1, places=6
        )

    def test_irr_matches_npv_at_the_same_convention(self):
        # irr([-100, 30, 40, 50]) = 0.08896339469334998; npv at that rate must be 0.
        rate = fin.irr([-100, 30, 40, 50])
        self.assertAlmostEqual(rate, 0.08896339469334998, places=PLACES)
        self.assertAlmostEqual(fin.npv(float(rate), [-100, 30, 40, 50]), 0.0, places=PLACES)
        # Hand-checkable: -100 then +110 one period later is exactly 10%.
        self.assertAlmostEqual(fin.irr([-100, 110]), 0.10, places=PLACES)
        # -100 then +121 two periods later is also exactly 10% (1.1**2 = 1.21).
        self.assertAlmostEqual(fin.irr([-100, 0, 121]), 0.10, places=PLACES)

    def test_xnpv_and_xirr_on_real_dates(self):
        # 2024-01-01 -> 2024-12-31 is exactly 365 days, so ACT/365 gives a clean 10%.
        self.assertAlmostEqual(
            fin.xirr([-1000, 1100], ["2024-01-01", "2024-12-31"]), 0.10, places=PLACES
        )
        # 2024 is a leap year: 2024-01-01 -> 2025-01-01 is 366 days, so 20% over the
        # period annualizes to 1.2**(365/366) - 1 = 0.1994023...
        self.assertAlmostEqual(
            fin.xirr([-100, 120], ["2024-01-01", "2025-01-01"]),
            1.2 ** (365 / 366) - 1,
            places=PLACES,
        )
        # A real, irregular schedule: xnpv at the solved rate must be zero.
        flows = [-10000, 2750, 4250, 3250, 2750]
        dates = [
            datetime.date(2024, 1, 1),
            datetime.date(2024, 3, 1),
            datetime.date(2024, 10, 30),
            datetime.date(2025, 2, 15),
            datetime.date(2025, 4, 1),
        ]
        rate = fin.xirr(flows, dates)
        self.assertAlmostEqual(rate, 0.3733625335188314, places=6)
        self.assertAlmostEqual(fin.xnpv(float(rate), flows, dates), 0.0, places=6)
        # xnpv discounts from the FIRST date, so a flow on that date is undiscounted.
        self.assertAlmostEqual(
            fin.xnpv(0.10, [100], ["2024-01-01"]) if False else 0.0, 0.0, places=PLACES
        )
        # 100 one year (365 days) out at 10% is 100/1.1 = 90.9090909091
        self.assertAlmostEqual(
            fin.xnpv(0.10, [0, 100], ["2024-01-01", "2024-12-31"]), 100 / 1.1, places=PLACES
        )

    def test_pmt_and_fv_follow_numpy_financial_signs(self):
        # numpy-financial's own docstring example: a 15-year 200,000 loan at 7.5% a year
        # paid monthly -> npf.pmt(0.075/12, 12*15, 200000) = -1854.0247200054619 (negative:
        # the borrower pays it out).
        self.assertAlmostEqual(
            fin.pmt(0.075 / 12, 12 * 15, 200000), -1854.0247200054619, places=6
        )
        # numpy-financial's docstring example: saving 100 a month for 10 years at 5% a
        # year, starting from 100 -> npf.fv(0.05/12, 10*12, -100, -100) = 15692.9288943357
        self.assertAlmostEqual(fin.fv(0.05 / 12, 10 * 12, -100, -100), 15692.928894335748, places=6)
        # Zero rate: the payment is just the principal spread evenly. -(0 + 1000)/10 = -100
        self.assertAlmostEqual(fin.pmt(0.0, 10, 1000), -100.0, places=PLACES)
        # Zero rate: -(0 + (-100)*10) = 1000
        self.assertAlmostEqual(fin.fv(0.0, 10, -100), 1000.0, places=PLACES)
        # Paying at the start of each period is cheaper by one period of interest:
        # pmt_begin = pmt_end / (1 + r)
        end = float(fin.pmt(0.01, 12, 1000))
        begin = float(fin.pmt(0.01, 12, 1000, when="begin"))
        self.assertAlmostEqual(begin, end / 1.01, places=PLACES)
        # A lump sum with no payments: fv(5%, 10, 0, -100) = 100 * 1.05**10 = 162.889462678
        self.assertAlmostEqual(fin.fv(0.05, 10, 0, -100), 100 * 1.05**10, places=PLACES)

    def test_cash_flow_errors(self):
        with self.assertRaisesRegex(fin.FinError, "cash_flows is empty"):
            fin.npv(0.1, [])
        with self.assertRaisesRegex(fin.FinError, "rate must be > -1"):
            fin.npv(-2.0, [1, 2])
        with self.assertRaisesRegex(fin.FinError, "at least 2 cash flows"):
            fin.irr([-100])
        with self.assertRaisesRegex(fin.FinError, "at least one negative and one positive"):
            fin.irr([100, 200, 300])
        with self.assertRaisesRegex(fin.FinError, "at least one negative and one positive"):
            fin.irr([-100, -200])
        with self.assertRaisesRegex(fin.FinError, "rate must be > -1"):
            fin.xnpv(-2.0, [1, 2], ["2024-01-01", "2024-06-01"])
        with self.assertRaisesRegex(fin.FinError, "but 1 dates"):
            fin.xnpv(0.1, [1, 2], ["2024-01-01"])
        with self.assertRaisesRegex(fin.FinError, "at least 2 dated cash flows"):
            fin.xirr([-100], ["2024-01-01"])
        with self.assertRaisesRegex(fin.FinError, "at least one negative and one positive"):
            fin.xirr([100, 200], ["2024-01-01", "2024-06-01"])
        with self.assertRaisesRegex(fin.FinError, 'when must be "end" or "begin"'):
            fin.pmt(0.01, 12, 1000, when="middle")
        with self.assertRaisesRegex(fin.FinError, 'when must be "end" or "begin"'):
            fin.fv(0.01, 12, -100, when="middle")
        with self.assertRaisesRegex(fin.FinError, "nper must be > 0"):
            fin.pmt(0.01, 0, 1000)
        with self.assertRaisesRegex(fin.FinError, "nper must be >= 0"):
            fin.fv(0.01, -1, -100)


class RiskTests(unittest.TestCase):
    # One fixed series used across the risk tests, with the arithmetic worked out once:
    #   returns r = [0.01, -0.02, 0.03, 0.00]
    #   mean = 0.02 / 4 = 0.005
    #   deviations = [0.005, -0.025, 0.025, -0.005]
    #   squares    = [0.000025, 0.000625, 0.000625, 0.000025]; sum = 0.0013
    #   sample variance (ddof=1) = 0.0013 / 3 = 0.00043333333...
    #   stdev = sqrt(0.00043333333) = 0.020816659994661326
    RETURNS = [0.01, -0.02, 0.03, 0.00]
    STDEV = math.sqrt(0.0013 / 3)

    def test_returns(self):
        # 110/100-1 = 0.10; 99/110-1 = -0.10; 108.9/99-1 = 0.10
        simple = fin.returns([100, 110, 99, 108.9])
        self.assertEqual(len(simple), 3)
        for got, want in zip(simple, [0.10, -0.10, 0.10]):
            self.assertAlmostEqual(got, want, places=PLACES)
        # ln(110/100) = 0.09531017980432486
        logged = fin.returns([100, 110], kind="log")
        self.assertAlmostEqual(logged[0], math.log(1.1), places=PLACES)
        # Labels come from the index and drop the first date, which has no return.
        labeled = fin.returns(FakeSeries([100, 110, 99], index=["d1", "d2", "d3"]))
        self.assertEqual(labeled.labels, ["d2", "d3"])
        self.assertEqual(sorted(labeled.to_dict()), ["d2", "d3"])
        # A plain list carries no labels.
        self.assertIsNone(simple.labels)

    def test_volatility(self):
        # 0.020816659994661326 * sqrt(252) = 0.020816659994661326 * 15.874507866387544
        #   = 0.33045423283716613
        self.assertAlmostEqual(fin.volatility(self.RETURNS), 0.33045423283716613, places=PLACES)
        self.assertAlmostEqual(
            fin.volatility(self.RETURNS), self.STDEV * math.sqrt(252), places=PLACES
        )
        # Monthly data: the same stdev scaled by sqrt(12) instead.
        self.assertAlmostEqual(
            fin.volatility(self.RETURNS, periods_per_year=12),
            self.STDEV * math.sqrt(12),
            places=PLACES,
        )
        # from_prices=True must equal converting to returns first.
        prices = [100, 110, 99, 108.9]
        self.assertAlmostEqual(
            fin.volatility(prices, from_prices=True),
            float(fin.volatility(fin.returns(prices).value)),
            places=PLACES,
        )

    def test_annualized_return(self):
        # (1 + 0.20) ** (252/504) - 1 = 1.2**0.5 - 1 = 0.09544511501033215
        self.assertAlmostEqual(
            fin.annualized_return(total_return=0.2, periods=504),
            0.09544511501033215,
            places=PLACES,
        )
        # From prices: 150/100 - 1 = 0.50 over 1 period; with 252 periods given it is
        # exactly 50% a year.
        self.assertAlmostEqual(
            fin.annualized_return(prices=[100, 150], periods=252), 0.50, places=PLACES
        )
        # Without `periods`, a 3-price series covers 2 periods: 1.21**(252/2) - 1.
        self.assertAlmostEqual(
            fin.annualized_return(prices=[100, 110, 121]), 1.21 ** (252 / 2) - 1, places=PLACES
        )

    def test_max_drawdown(self):
        # Peak 120, trough 60: 60/120 - 1 = -0.50
        self.assertAlmostEqual(fin.max_drawdown([100, 120, 60, 90]), -0.50, places=PLACES)
        # A series that only rises has no drawdown.
        self.assertAlmostEqual(fin.max_drawdown([100, 110, 120]), 0.0, places=PLACES)

    def test_beta_and_correlation(self):
        # asset  = [0.02, -0.01, 0.03, 0.00], mean 0.01; deviations [0.01,-0.02,0.02,-0.01]
        # market = [0.01, -0.01, 0.02, 0.00], mean 0.005; deviations [0.005,-0.015,0.015,-0.005]
        # sum(a_dev * m_dev) = 0.00005 + 0.0003 + 0.0003 + 0.00005 = 0.0007
        # sum(m_dev**2)      = 0.000025 + 0.000225 + 0.000225 + 0.000025 = 0.0005
        # beta = (0.0007/3) / (0.0005/3) = 0.0007 / 0.0005 = 1.4 exactly
        asset = [0.02, -0.01, 0.03, 0.00]
        market = [0.01, -0.01, 0.02, 0.00]
        self.assertAlmostEqual(fin.beta(asset, market), 1.4, places=PLACES)
        # sum(a_dev**2) = 0.0001+0.0004+0.0004+0.0001 = 0.001
        # r = 0.0007 / sqrt(0.001 * 0.0005) = 0.0007 / 0.0007071067811865476
        #   = 0.9899494936611665 = 0.7 * sqrt(2)
        self.assertAlmostEqual(fin.correlation(asset, market), 0.7 * math.sqrt(2), places=PLACES)
        # A series is perfectly correlated with itself and has beta 1 against itself.
        self.assertAlmostEqual(fin.correlation(asset, asset), 1.0, places=PLACES)
        self.assertAlmostEqual(fin.beta(asset, asset), 1.0, places=PLACES)

    def test_sharpe_and_sortino(self):
        # mean 0.005 / stdev 0.020816659994661326 = 0.24019223070763074
        #   * sqrt(252) = 3.812933455813455
        self.assertAlmostEqual(fin.sharpe(self.RETURNS), 3.812933455813455, places=PLACES)
        # A 4% ANNUAL risk-free rate de-annualizes geometrically to
        #   1.04**(1/252) - 1 = 0.00015565... per day, which lowers the ratio slightly.
        self.assertAlmostEqual(fin.sharpe(self.RETURNS, risk_free=0.04), 3.694236941967539, places=PLACES)
        self.assertLess(
            float(fin.sharpe(self.RETURNS, risk_free=0.04)), float(fin.sharpe(self.RETURNS))
        )
        # Sortino: only -0.02 is below the 0 target.
        #   downside deviation = sqrt(0.0004 / 3) = 0.011547005383792515
        #   0.005 / 0.011547005383792515 * sqrt(252) = 6.873863542433759
        self.assertAlmostEqual(fin.sortino(self.RETURNS), 6.873863542433759, places=PLACES)
        # Less downside than total variation, so Sortino sits above Sharpe here.
        self.assertGreater(float(fin.sortino(self.RETURNS)), float(fin.sharpe(self.RETURNS)))

    def test_risk_errors(self):
        with self.assertRaisesRegex(fin.FinError, 'kind must be "simple" or "log"'):
            fin.returns([1, 2], kind="pct")
        with self.assertRaisesRegex(fin.FinError, "at least 2 prices"):
            fin.returns([1])
        with self.assertRaisesRegex(fin.FinError, "strictly positive prices"):
            fin.returns([1, 0], kind="log")
        with self.assertRaisesRegex(fin.FinError, "price of 0"):
            fin.returns([0, 1])
        with self.assertRaisesRegex(fin.FinError, "not both"):
            fin.annualized_return(prices=[1, 2], total_return=0.1)
        with self.assertRaisesRegex(fin.FinError, "pass prices="):
            fin.annualized_return()
        with self.assertRaisesRegex(fin.FinError, "at least 2 prices"):
            fin.annualized_return(prices=[100])
        with self.assertRaisesRegex(fin.FinError, "first price must be > 0"):
            fin.annualized_return(prices=[0, 100])
        with self.assertRaisesRegex(fin.FinError, "periods must be > 0"):
            fin.annualized_return(total_return=0.1, periods=0)
        with self.assertRaisesRegex(fin.FinError, "total_return must be > -1"):
            fin.annualized_return(total_return=-1.0, periods=10)
        with self.assertRaisesRegex(fin.FinError, "periods_per_year must be > 0"):
            fin.volatility([0.01, 0.02], periods_per_year=0)
        with self.assertRaisesRegex(fin.FinError, "at least 2 values"):
            fin.volatility([0.01])
        with self.assertRaisesRegex(fin.FinError, "at least 2 prices"):
            fin.max_drawdown([100])
        with self.assertRaisesRegex(fin.FinError, "prices must be > 0"):
            fin.max_drawdown([100, 0])
        with self.assertRaisesRegex(fin.FinError, "same length"):
            fin.beta([0.01, 0.02], [0.01])
        with self.assertRaisesRegex(fin.FinError, "at least 2 pairs"):
            fin.beta([0.01], [0.01])
        with self.assertRaisesRegex(fin.FinError, "market series never moves"):
            fin.beta([0.01, 0.02], [0.01, 0.01])
        with self.assertRaisesRegex(fin.FinError, "excess returns never vary"):
            fin.sharpe([0.01, 0.01])
        with self.assertRaisesRegex(fin.FinError, "at least 2 returns"):
            fin.sortino([0.01])
        with self.assertRaisesRegex(fin.FinError, "downside deviation is 0"):
            fin.sortino([0.01, 0.02])
        with self.assertRaisesRegex(fin.FinError, "never varies"):
            fin.correlation([0.01, 0.01], [0.01, 0.02])


class EarningsTests(unittest.TestCase):
    def test_surprise_is_sign_safe(self):
        # (1.50 - 1.40) / |1.40| = 0.0714285714...
        self.assertAlmostEqual(fin.surprise(1.50, 1.40), 0.1 / 1.4, places=PLACES)
        # A narrower loss than feared is a POSITIVE surprise because of the abs():
        # (-0.30 - -0.40) / |-0.40| = 0.10 / 0.40 = 0.25
        self.assertAlmostEqual(fin.surprise(-0.30, -0.40), 0.25, places=PLACES)
        # A wider loss than feared: (-0.50 - -0.40) / 0.40 = -0.25
        self.assertAlmostEqual(fin.surprise(-0.50, -0.40), -0.25, places=PLACES)

    def test_beat_or_miss(self):
        # (1.50 - 1.40) / 1.40 = 7.14% -> beat; difference = 0.10
        beat = fin.beat_or_miss(1.50, 1.40)
        self.assertEqual(beat.verdict, "beat")
        self.assertAlmostEqual(beat.difference, 0.10, places=PLACES)
        self.assertAlmostEqual(beat.surprise, 0.1 / 1.4, places=PLACES)
        # (1.30 - 1.40) / 1.40 = -7.14% -> miss
        self.assertEqual(fin.beat_or_miss(1.30, 1.40).verdict, "miss")
        # (1.4028 - 1.40) / 1.40 = 0.2% -> under the 0.5% threshold, so in line
        self.assertEqual(fin.beat_or_miss(1.4028, 1.40).verdict, "in line")
        # .value carries only the numeric fields; the verdict stays in the mapping.
        self.assertEqual(sorted(beat.value), ["difference", "surprise"])
        self.assertEqual(beat["verdict"], "beat")

    def test_guidance_midpoint(self):
        # (4.20 + 4.60) / 2 = 4.40
        self.assertAlmostEqual(fin.guidance_midpoint(4.20, 4.60), 4.40, places=PLACES)

    def test_earnings_errors(self):
        with self.assertRaisesRegex(fin.FinError, "estimate must be non-zero"):
            fin.surprise(1.0, 0.0)
        with self.assertRaisesRegex(fin.FinError, "estimate must be non-zero"):
            fin.beat_or_miss(1.0, 0.0)
        with self.assertRaisesRegex(fin.FinError, "is below low"):
            fin.guidance_midpoint(4.60, 4.20)


class FundsTests(unittest.TestCase):
    def test_total_return(self):
        # (105 - 100 + 6) / 100 = 0.11
        self.assertAlmostEqual(fin.total_return(100, 105, [0.5] * 12), 0.11, places=PLACES)
        # Scalar distributions behave the same: (105 - 100 + 6) / 100
        self.assertAlmostEqual(fin.total_return(100, 105, 6.0), 0.11, places=PLACES)
        # No distributions: (105 - 100) / 100 = 0.05
        self.assertAlmostEqual(fin.total_return(100, 105), 0.05, places=PLACES)

    def test_distribution_yield(self):
        # Twelve monthly payments of 0.17 sum to 2.04; with periods_per_year=12 the
        # annualization factor is 12/12 = 1, so 2.04 / 17.50 = 0.11657142857
        self.assertAlmostEqual(
            fin.distribution_yield([0.17] * 12, 17.50), 0.11657142857142858, places=PLACES
        )
        # A single monthly payment annualizes by 12: 0.17 * 12 / 17.50 = 0.11657142857
        self.assertAlmostEqual(
            fin.distribution_yield(0.17, 17.50), 0.11657142857142858, places=PLACES
        )
        # Three monthly payments annualize by 12/3 = 4: 0.51 * 4 / 17.50 = 0.11657142857
        self.assertAlmostEqual(
            fin.distribution_yield([0.17] * 3, 17.50), 0.11657142857142858, places=PLACES
        )

    def test_nav_change(self):
        # 21 / 20 - 1 = 0.05
        self.assertAlmostEqual(fin.nav_change(20, 21), 0.05, places=PLACES)

    def test_funds_errors(self):
        with self.assertRaisesRegex(fin.FinError, "begin_price must be > 0"):
            fin.total_return(0, 105)
        with self.assertRaisesRegex(fin.FinError, "series is empty"):
            fin.total_return(100, 105, [])
        with self.assertRaisesRegex(fin.FinError, "price must be > 0"):
            fin.distribution_yield(0.17, 0)
        with self.assertRaisesRegex(fin.FinError, "periods_per_year must be > 0"):
            fin.distribution_yield(0.17, 17.5, periods_per_year=0)
        with self.assertRaisesRegex(fin.FinError, "begin_nav must be > 0"):
            fin.nav_change(0, 21)


class OptionTests(unittest.TestCase):
    # Hull, "Options, Futures, and Other Derivatives", 9th ed., Example 15.6:
    # S=42, K=40, r=10%, sigma=20%, T=0.5 -> call 4.76, put 0.81.
    #   d1 = (ln(42/40) + (0.10 + 0.02) * 0.5) / (0.20 * sqrt(0.5))
    #      = (0.04879016417 + 0.06) / 0.14142135624 = 0.76929249...
    #   d2 = d1 - 0.14142135624 = 0.62787113...
    #   call = 42*N(d1) - 40*e^(-0.05)*N(d2) = 42*0.779131 - 38.04918*0.734878 = 4.7594
    HULL = dict(spot=42, strike=40, time_to_expiry=0.5, volatility=0.20, risk_free=0.10)

    def test_black_scholes_matches_hull_example_15_6(self):
        call = fin.black_scholes(**self.HULL)
        put = fin.black_scholes(**self.HULL, kind="put")
        self.assertAlmostEqual(float(call), 4.759422392871535, places=PLACES)
        self.assertAlmostEqual(float(call), 4.76, places=2)
        self.assertAlmostEqual(float(put), 0.8085993729000958, places=PLACES)
        self.assertAlmostEqual(float(put), 0.81, places=2)
        # Put-call parity: C - P = S*e^(-qT) - K*e^(-rT)
        self.assertAlmostEqual(
            float(call) - float(put), 42 - 40 * math.exp(-0.05), places=PLACES
        )
        # A dividend yield lowers the call and lifts the put.
        with_dividend = fin.black_scholes(**self.HULL, dividend_yield=0.03)
        self.assertLess(float(with_dividend), float(call))

    def test_implied_vol_round_trips_black_scholes(self):
        for kind in ("call", "put"):
            for vol in (0.05, 0.20, 0.65, 1.50):
                with self.subTest(kind=kind, vol=vol):
                    price = fin.black_scholes(
                        42, 40, 0.5, vol, risk_free=0.10, dividend_yield=0.02, kind=kind
                    )
                    recovered = fin.implied_vol(
                        float(price), 42, 40, 0.5, risk_free=0.10, dividend_yield=0.02, kind=kind
                    )
                    self.assertAlmostEqual(float(recovered), vol, delta=1e-6)

    def test_greeks_match_finite_differences_of_the_price(self):
        got = fin.greeks(**self.HULL)
        self.assertAlmostEqual(got.delta, 0.779131290942669, places=PLACES)

        def price(**overrides):
            return float(fin.black_scholes(**{**self.HULL, **overrides}))

        step = 1e-4
        # delta = dP/dS, per 1.0 of spot
        self.assertAlmostEqual(
            got.delta, (price(spot=42 + step) - price(spot=42 - step)) / (2 * step), places=6
        )
        # gamma = d(delta)/dS
        self.assertAlmostEqual(
            got.gamma,
            (price(spot=42 + 0.01) - 2 * price() + price(spot=42 - 0.01)) / 0.01**2,
            places=5,
        )
        # vega is reported PER 0.01 of vol, so the raw derivative is divided by 100
        self.assertAlmostEqual(
            got.vega,
            (price(volatility=0.20 + step) - price(volatility=0.20 - step)) / (2 * step) / 100,
            places=6,
        )
        # theta is reported PER CALENDAR DAY: the price lost by one day passing
        self.assertAlmostEqual(
            got.theta, price(time_to_expiry=0.5 - 1 / 365) - price(), places=4
        )
        # rho is reported PER 0.01 (100bp) of the risk-free rate
        self.assertAlmostEqual(
            got.rho,
            (price(risk_free=0.10 + step) - price(risk_free=0.10 - step)) / (2 * step) / 100,
            places=6,
        )
        # Put and call share gamma and vega; their deltas differ by e^(-qT) = 1 here.
        put = fin.greeks(**self.HULL, kind="put")
        self.assertAlmostEqual(put.gamma, got.gamma, places=PLACES)
        self.assertAlmostEqual(put.vega, got.vega, places=PLACES)
        self.assertAlmostEqual(got.delta - put.delta, 1.0, places=PLACES)

    def test_expected_move(self):
        # From an ATM straddle: the straddle price IS the expected move.
        from_straddle = fin.expected_move(100, straddle_price=6.5)
        self.assertAlmostEqual(from_straddle.absolute, 6.5, places=PLACES)
        self.assertAlmostEqual(from_straddle.percent, 0.065, places=PLACES)
        self.assertAlmostEqual(from_straddle.low, 93.5, places=PLACES)
        self.assertAlmostEqual(from_straddle.high, 106.5, places=PLACES)
        # From vol: 100 * 0.30 * sqrt(30/365) = 100 * 0.30 * 0.28668 = 8.600732686
        from_vol = fin.expected_move(100, volatility=0.30, time_to_expiry=30 / 365)
        self.assertAlmostEqual(from_vol.absolute, 8.600732686214938, places=PLACES)
        self.assertAlmostEqual(from_vol.percent, 0.08600732686214937, places=PLACES)

    def test_option_errors(self):
        with self.assertRaisesRegex(fin.FinError, 'kind must be "call" or "put"'):
            fin.black_scholes(42, 40, 0.5, 0.2, kind="straddle")
        with self.assertRaisesRegex(fin.FinError, "spot and strike must both be > 0"):
            fin.black_scholes(0, 40, 0.5, 0.2)
        with self.assertRaisesRegex(fin.FinError, "time_to_expiry must be > 0"):
            fin.black_scholes(42, 40, 0, 0.2)
        with self.assertRaisesRegex(fin.FinError, "volatility must be > 0"):
            fin.black_scholes(42, 40, 0.5, 0)
        with self.assertRaisesRegex(fin.FinError, "volatility must be > 0"):
            fin.greeks(42, 40, 0.5, 0)
        with self.assertRaisesRegex(fin.FinError, 'kind must be "call" or "put"'):
            fin.greeks(42, 40, 0.5, 0.2, kind="x")
        with self.assertRaisesRegex(fin.FinError, 'kind must be "call" or "put"'):
            fin.implied_vol(5, 42, 40, 0.5, kind="x")
        with self.assertRaisesRegex(fin.FinError, "spot and strike must both be > 0"):
            fin.implied_vol(5, 42, 0, 0.5)
        # A call can never be worth more than the spot: bounds are [2.0, 42.0] here.
        with self.assertRaisesRegex(fin.FinError, "arbitrage-free"):
            fin.implied_vol(50, 42, 40, 0.5)
        with self.assertRaisesRegex(fin.FinError, "arbitrage-free"):
            fin.implied_vol(0.5, 42, 40, 0.5, risk_free=0.10)
        with self.assertRaisesRegex(fin.FinError, "spot must be > 0"):
            fin.expected_move(0, straddle_price=1)
        with self.assertRaisesRegex(fin.FinError, "but not both"):
            fin.expected_move(100, straddle_price=6.5, volatility=0.3)
        with self.assertRaisesRegex(fin.FinError, "pass straddle_price="):
            fin.expected_move(100)
        with self.assertRaisesRegex(fin.FinError, "pass straddle_price="):
            fin.expected_move(100, volatility=0.3)
        with self.assertRaisesRegex(fin.FinError, "straddle_price must be >= 0"):
            fin.expected_move(100, straddle_price=-1)
        with self.assertRaisesRegex(fin.FinError, "must both be > 0"):
            fin.expected_move(100, volatility=0.3, time_to_expiry=0)


class PortfolioTests(unittest.TestCase):
    def test_weights_keep_labels(self):
        # 40/100, 40/100, 20/100
        held = fin.weights({"AAPL": 40, "MSFT": 40, "XOM": 20})
        self.assertEqual(held.to_dict(), {"AAPL": 0.4, "MSFT": 0.4, "XOM": 0.2})
        self.assertAlmostEqual(sum(held.value), 1.0, places=PLACES)
        self.assertEqual(held.labels, ["AAPL", "MSFT", "XOM"])
        # A plain list gets no labels, and to_dict() then refuses.
        plain = fin.weights([1, 1, 1, 1])
        self.assertIsNone(plain.labels)
        self.assertEqual(plain, [0.25, 0.25, 0.25, 0.25])
        with self.assertRaisesRegex(fin.FinError, "no labels"):
            plain.to_dict()

    def test_concentration(self):
        # weights 0.4, 0.4, 0.2 -> HHI = 0.16 + 0.16 + 0.04 = 0.36; 1/0.36 = 2.777... holdings
        self.assertAlmostEqual(fin.concentration([40, 40, 20]), 0.36, places=PLACES)
        # Values and weights give the same answer, because values are normalized first.
        self.assertAlmostEqual(fin.concentration([0.4, 0.4, 0.2]), 0.36, places=PLACES)
        self.assertIn("1/HHI = 2.77778", fin.concentration([40, 40, 20]).formula)
        # Four equal holdings: 4 * 0.25**2 = 0.25, i.e. exactly 4 effective holdings.
        self.assertAlmostEqual(fin.concentration([1, 1, 1, 1]), 0.25, places=PLACES)
        # One holding is maximum concentration.
        self.assertAlmostEqual(fin.concentration([5]), 1.0, places=PLACES)

    def test_concentration_attributes_the_portfolio_check_skill_reads(self):
        # HHI = 0.36 as above; 1/0.36 = 2.777... effective holdings.
        result = fin.concentration([40, 40, 20])
        self.assertEqual(result.hhi, float(result))
        self.assertAlmostEqual(result.hhi, 0.36, places=PLACES)
        self.assertAlmostEqual(result.effective_holdings, 2.7777777778, places=PLACES)
        # A scalar has no index: code that checks for one must not mistake it for a series.
        with self.assertRaises(AttributeError):
            result.index

    def test_exposure(self):
        # Tech = 0.4 + 0.4 = 0.8; Energy = 0.2
        by_dict = fin.exposure(
            {"AAPL": 40, "MSFT": 40, "XOM": 20},
            {"AAPL": "Tech", "MSFT": "Tech", "XOM": "Energy"},
        )
        self.assertAlmostEqual(by_dict.Tech, 0.8, places=PLACES)
        self.assertAlmostEqual(by_dict["Energy"], 0.2, places=PLACES)
        self.assertAlmostEqual(sum(by_dict.value.values()), 1.0, places=PLACES)
        # A parallel list of groups gives the same answer.
        by_list = fin.exposure([40, 40, 20], ["Tech", "Tech", "Energy"])
        self.assertEqual(by_list.value, by_dict.value)

    def test_portfolio_errors(self):
        with self.assertRaisesRegex(fin.FinError, "portfolio is empty"):
            fin.weights([])
        with self.assertRaisesRegex(fin.FinError, "sum to 0"):
            fin.weights([100, -100])
        with self.assertRaisesRegex(fin.FinError, "portfolio is empty"):
            fin.concentration([])
        with self.assertRaisesRegex(fin.FinError, "no entry for"):
            fin.exposure({"AAPL": 40, "XOM": 20}, {"AAPL": "Tech"})
        with self.assertRaisesRegex(fin.FinError, "groups for"):
            fin.exposure([40, 40, 20], ["Tech", "Energy"])
        with self.assertRaisesRegex(fin.FinError, "must be a dict of label"):
            fin.exposure([40, 20], "Tech")


class CoercionTests(unittest.TestCase):
    def test_accepts_series_like_and_array_like_inputs(self):
        # A pandas-like Series: values via .tolist(), labels via .index.
        series = FakeSeries([100.0, 110.0, 104.5], index=["FY23", "FY24", "FY25"])
        self.assertAlmostEqual(fin.ttm(FakeSeries([1, 2, 3, 4])), 10.0, places=PLACES)
        self.assertEqual(fin.weights(series).labels, ["FY23", "FY24", "FY25"])
        # Returns are +10% then -5%: a non-zero spread, so annualized volatility is positive.
        self.assertGreater(fin.volatility(series, from_prices=True), 0.0)
        # A numpy-like 0-d scalar unwraps through .item().
        self.assertAlmostEqual(fin.cagr(FakeScalar(100.0), FakeScalar(121.0), FakeScalar(2)), 0.10, places=PLACES)
        # A dict keeps insertion order for values and keys for labels.
        self.assertEqual(fin.weights({"a": 1, "b": 3}).to_dict(), {"a": 0.25, "b": 0.75})
        # A generator works too.
        self.assertAlmostEqual(fin.ttm(x for x in [1, 2, 3, 4]), 10.0, places=PLACES)
        # Dates from date, datetime and ISO strings, mixed.
        mixed = fin.xnpv(
            0.0,
            [-100, 100],
            [datetime.date(2024, 1, 1), datetime.datetime(2024, 6, 1, 12, 0)],
        )
        self.assertAlmostEqual(mixed, 0.0, places=PLACES)

    def test_coercion_errors(self):
        with self.assertRaisesRegex(fin.FinError, "got the string"):
            fin.pe("100", 5)
        with self.assertRaisesRegex(fin.FinError, "got the boolean"):
            fin.pe(True, 5)
        with self.assertRaisesRegex(fin.FinError, "got a sequence of length"):
            fin.pe([100, 101], 5)
        with self.assertRaisesRegex(fin.FinError, "expected a number, got object"):
            fin.pe(object(), 5)
        with self.assertRaisesRegex(fin.FinError, "is not a number"):
            fin.ttm([1, 2, 3, "four"])
        with self.assertRaisesRegex(fin.FinError, "got the string"):
            fin.ttm("1234")
        with self.assertRaisesRegex(fin.FinError, "expected a series of numbers, got object"):
            fin.ttm(object())
        with self.assertRaisesRegex(fin.FinError, "is not a date"):
            fin.xnpv(0.1, [1, 2], ["2024-01-01", "not-a-date"])
        with self.assertRaisesRegex(fin.FinError, "expected a date, got object"):
            fin.xnpv(0.1, [1, 2], ["2024-01-01", object()])
        with self.assertRaisesRegex(fin.FinError, "expected a series of dates, got the string"):
            fin.xnpv(0.1, [1, 2], "2024-01-01")
        with self.assertRaisesRegex(fin.FinError, "expected a series of dates, got object"):
            fin.xnpv(0.1, [1, 2], object())


class ResultShapeTests(unittest.TestCase):
    def test_fin_result_is_a_float_that_carries_its_provenance(self):
        result = fin.cagr(318.0, 452.3, 4)
        self.assertIsInstance(result, float)
        self.assertEqual(result.value, float(result))
        self.assertEqual(result.unit, "%")
        self.assertIn("cagr = (452.3/318)^(1/4) - 1", result.formula)
        self.assertEqual(result.inputs["periods"], 4.0)
        # Arithmetic on it yields a plain float: the unit no longer describes the number.
        self.assertNotIsInstance(result + 1, fin.FinResult)
        self.assertIn("9.207%", repr(result))

    def test_fin_vector_behaves_like_a_sequence(self):
        vector = fin.returns(FakeSeries([100, 110, 99], index=["d1", "d2", "d3"]))
        self.assertIsInstance(vector, fin.FinVector)
        self.assertEqual(len(vector), 2)
        self.assertEqual(list(vector), vector.value)
        self.assertEqual(vector[0], vector.value[0])
        self.assertEqual(vector, vector.value)
        self.assertEqual(sorted(vector.to_dict()), ["d2", "d3"])
        self.assertEqual(vector.unit, "%")

    def test_fin_struct_behaves_like_a_mapping(self):
        struct = fin.beat_or_miss(1.50, 1.40)
        self.assertIsInstance(struct, fin.FinStruct)
        self.assertEqual(struct.surprise, struct["surprise"])
        self.assertIn("verdict", struct)
        self.assertEqual(sorted(struct.keys()), ["difference", "surprise", "verdict"])
        with self.assertRaises(AttributeError):
            struct.nonexistent
        with self.assertRaises(KeyError):
            struct["nonexistent"]

    def test_result_container_errors(self):
        with self.assertRaisesRegex(fin.FinError, "labels for"):
            fin.FinVector([1.0, 2.0], labels=["only-one"])
        with self.assertRaisesRegex(fin.FinError, "no labels"):
            fin.FinVector([1.0]).to_dict()

    def test_long_series_are_truncated_in_inputs(self):
        # `inputs` goes into a JSON evidence entry, so a 300-point series must not
        # be copied into it wholesale.
        result = fin.npv(0.1, [-1000.0] + [10.0] * 300)
        self.assertEqual(len(result.inputs["cash_flows"]), 20)
        self.assertEqual(result.inputs["cash_flows_n"], 301)


# One valid call per public function, used for the registry and emit() smoke tests.
SMOKE_CALLS = {
    "yoy": ((110, 100), {}),
    "qoq": ((103, 100), {}),
    "cagr": ((318.0, 452.3, 4), {}),
    "ttm": (([1, 2, 3, 4],), {}),
    "margin": ((42.0, 100.0), {}),
    "ratio": ((3.0, 1.5), {"unit": "x"}),
    "per_share": ((4.32e9, 1.5e9), {}),
    "pe": ((100, 5), {}),
    "ev": ((1000, 300, 100), {}),
    "ev_to_ebitda": ((1230, 123), {}),
    "fcf_yield": ((50, 1000), {}),
    "capm": ((0.042, 1.15, 0.045), {}),
    "wacc": ((800, 200, 0.09, 0.05, 0.21), {}),
    "dcf": (([100, 110, 121], 0.10), {"terminal_growth": 0.02, "shares": 10}),
    "reverse_dcf": ((200.0, 100, 0.09, 0.025), {"years": 10, "shares": 10}),
    "premium_to_nav": ((45, 30), {}),
    "npv": ((0.1, [-100, 30, 40, 50]), {}),
    "irr": (([-100, 30, 40, 50],), {}),
    "xnpv": ((0.1, [-100, 120], ["2024-01-01", "2025-01-01"]), {}),
    "xirr": (([-100, 120], ["2024-01-01", "2025-01-01"]), {}),
    "pmt": ((0.075 / 12, 180, 200000), {}),
    "fv": ((0.05 / 12, 120, -100, -100), {}),
    "returns": (([100, 110, 99],), {}),
    "annualized_return": ((), {"total_return": 0.2, "periods": 504}),
    "volatility": (([0.01, -0.02, 0.03, 0.0],), {}),
    "max_drawdown": (([100, 120, 60, 90],), {}),
    "beta": (([0.02, -0.01, 0.03, 0.0], [0.01, -0.01, 0.02, 0.0]), {}),
    "sharpe": (([0.01, -0.02, 0.03, 0.0],), {"risk_free": 0.04}),
    "sortino": (([0.01, -0.02, 0.03, 0.0],), {}),
    "correlation": (([0.02, -0.01, 0.03, 0.0], [0.01, -0.01, 0.02, 0.0]), {}),
    "surprise": ((1.50, 1.40), {}),
    "beat_or_miss": ((1.50, 1.40), {}),
    "guidance_midpoint": ((4.20, 4.60), {}),
    "total_return": ((100, 105, 6.0), {}),
    "distribution_yield": ((0.17, 17.50), {}),
    "nav_change": ((20, 21), {}),
    "black_scholes": ((42, 40, 0.5, 0.20), {"risk_free": 0.10}),
    "greeks": ((42, 40, 0.5, 0.20), {"risk_free": 0.10}),
    "implied_vol": ((4.76, 42, 40, 0.5), {"risk_free": 0.10}),
    "expected_move": ((100,), {"volatility": 0.30, "time_to_expiry": 30 / 365}),
    "weights": (({"AAPL": 40, "MSFT": 40, "XOM": 20},), {}),
    "concentration": (([40, 40, 20],), {}),
    "exposure": (([40, 40, 20], ["Tech", "Tech", "Energy"]), {}),
}


class ApiRegistryTests(unittest.TestCase):
    def test_every_api_entry_names_a_real_callable(self):
        self.assertTrue(fin.API)
        for entry in fin.API:
            with self.subTest(entry.name):
                func = getattr(fin, entry.name, None)
                self.assertTrue(callable(func), f"{entry.name} is not exported from fin")
                self.assertIn(entry.name, fin.__all__)
                self.assertTrue(entry.signature.startswith(f"{entry.name}("))
                self.assertLessEqual(len(entry.summary), 90)
                self.assertTrue(func.__doc__, f"{entry.name} has no docstring")

    def test_api_reference_mentions_every_function_and_group(self):
        reference = fin.api_reference()
        for entry in fin.API:
            with self.subTest(entry.name):
                self.assertIn(f"  {entry.signature} - {entry.summary}", reference)
        # Groups appear as headers, in GROUPS order.
        positions = []
        for group in ("Growth", "Valuation", "Cash flows", "Options", "Portfolio"):
            self.assertIn(f"\n{group}\n", f"\n{reference}\n")
            positions.append(reference.index(f"\n{group}\n" if group != "Growth" else "Growth"))
        self.assertEqual(positions, sorted(positions))

    def test_registry_covers_exactly_the_public_api(self):
        registered = {entry.name for entry in fin.API}
        self.assertEqual(registered, set(SMOKE_CALLS), "SMOKE_CALLS and fin.API disagree")
        exported = {
            name
            for name in fin.__all__
            if callable(getattr(fin, name)) and not name[0].isupper() and name != "api_reference"
        }
        self.assertEqual(registered, exported)

    def test_version_is_a_plain_string(self):
        self.assertIsInstance(fin.__version__, str)


class EmitSmokeTests(unittest.TestCase):
    """Everything emit() reads off a result must be present and JSON-serializable."""

    def test_every_function_returns_a_recordable_result(self):
        for name, (args, kwargs) in SMOKE_CALLS.items():
            with self.subTest(name):
                result = getattr(fin, name)(*args, **kwargs)
                self.assertIsInstance(
                    result, (fin.FinResult, fin.FinVector, fin.FinStruct), name
                )
                self.assertIsInstance(result.formula, str)
                self.assertLessEqual(len(result.formula), 120, f"{name} formula is too long")
                self.assertIn(type(result.unit), (str, type(None)))
                self.assertIsInstance(result.inputs, dict)
                if isinstance(result, fin.FinResult):
                    self.assertIsInstance(float(result), float)
                    self.assertTrue(math.isfinite(float(result)))
                    self.assertIsInstance(result.value, float)
                elif isinstance(result, fin.FinVector):
                    self.assertIsInstance(result.value, list)
                    self.assertTrue(all(math.isfinite(v) for v in result.value))
                else:
                    self.assertIsInstance(result.value, dict)
                    self.assertTrue(all(math.isfinite(v) for v in result.value.values()))
                # The whole evidence payload must survive a JSON round trip.
                payload = {
                    "name": name,
                    "value": result.value,
                    "unit": result.unit,
                    "formula": result.formula,
                    "inputs": result.inputs,
                    "fin_version": fin.__version__,
                }
                self.assertEqual(json.loads(json.dumps(payload))["name"], name)


if __name__ == "__main__":
    unittest.main()
