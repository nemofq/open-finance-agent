"""Tests for the in-sandbox job runner, run in CPython so they need no Pyodide.

`run_job` is exercised without evidence, because preloading a table is the one part that needs
pandas; the conformance suite covers that through the real sandbox.

Run with:  python3 -m unittest discover -s sandbox/tests
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import fin  # noqa: E402
import runner  # noqa: E402

def run(code: str, evidence: dict | None = None) -> dict:
    payload = json.dumps({"evidence": evidence or {}})
    return json.loads(runner.run_job(code, payload))


class PreflightTests(unittest.TestCase):
    def test_flags_a_typed_in_constant(self):
        undeclared, used = runner.preflight("wacc = 0.092\n", [])
        self.assertEqual(undeclared, [{"value": 0.092, "line": 1, "snippet": "wacc = 0.092"}])
        self.assertEqual(used, [])

    def test_accepts_conventional_constants(self):
        code = "x = 252\ny = 100 * 4\nz = prices[0] - prices[-1]\n"
        undeclared, _ = runner.preflight(code, [])
        self.assertEqual(undeclared, [])

    def test_a_constant_inside_assume_is_declared(self):
        code = 'g = assume("terminal_growth", 0.025, "long-run nominal GDP")\n'
        undeclared, _ = runner.preflight(code, [])
        self.assertEqual(undeclared, [])

    def test_reports_each_constant_once_per_line(self):
        code = "a = 0.07\nb = 0.07\nc = 0.07 + 0.07\n"
        undeclared, _ = runner.preflight(code, [])
        self.assertEqual([(item["value"], item["line"]) for item in undeclared], [(0.07, 1), (0.07, 2), (0.07, 3)])

    def test_ignores_booleans_and_strings(self):
        undeclared, _ = runner.preflight('flag = True\nname = "0.5"\n', [])
        self.assertEqual(undeclared, [])

    def test_finds_the_evidence_ids_the_code_names(self):
        _, used = runner.preflight('x = E7.loc["Revenues"]\ny = E12\n', ["E7", "E9", "E12"])
        self.assertEqual(used, ["E7", "E12"])


class EmitTests(unittest.TestCase):
    def test_records_a_fin_result_with_its_unit_and_formula(self):
        out = run('emit("Revenue CAGR", fin.cagr(318.0, 452.3, 4))')
        self.assertTrue(out["ok"])
        self.assertEqual(out["finVersion"], fin.__version__)
        emitted = out["emitted"][0]
        self.assertEqual(emitted["name"], "Revenue CAGR")
        self.assertAlmostEqual(emitted["value"], fin.cagr(318.0, 452.3, 4), places=12)
        self.assertEqual(emitted["unit"], "%")
        self.assertIn("cagr", emitted["formula"])

    def test_an_explicit_unit_overrides_the_one_fin_reports(self):
        out = run('emit("spread", fin.cagr(318.0, 452.3, 4), unit="bps")')
        self.assertEqual(out["emitted"][0]["unit"], "bps")

    def test_records_plain_numbers_lists_and_dicts(self):
        out = run('emit("a", 1.5)\nemit("b", [1.0, 2.0])\nemit("c", {"x": 1.0})')
        self.assertEqual([item["value"] for item in out["emitted"]], [1.5, [1.0, 2.0], {"x": 1.0}])

    def test_a_labeled_fin_vector_keeps_its_labels(self):
        out = run('emit("w", fin.weights({"AAPL": 60, "MSFT": 40}))')
        self.assertEqual(out["emitted"][0]["value"], {"AAPL": 0.6, "MSFT": 0.4})

    def test_a_fin_struct_emits_its_numeric_fields(self):
        out = run('emit("dcf", fin.dcf([10, 11, 12], 0.09, terminal_growth=0.025, shares=100))')
        self.assertIn("per_share", out["emitted"][0]["value"])

    def test_rejects_a_value_that_is_not_a_number(self):
        out = run('emit("bad", "twelve")')
        self.assertFalse(out["ok"])
        self.assertIn("expected a number", out["error"])

    def test_rejects_nan_and_infinity(self):
        out = run('emit("bad", float("nan"))')
        self.assertFalse(out["ok"])
        self.assertIn("cannot be recorded as evidence", out["error"])


class AssumeTests(unittest.TestCase):
    def test_returns_the_value_and_records_it(self):
        out = run('g = assume("terminal_growth", 0.025, "long-run nominal GDP")\nemit("g", g)')
        self.assertEqual(out["assumptions"], [{"name": "terminal_growth", "value": 0.025, "why": "long-run nominal GDP"}])
        self.assertEqual(out["emitted"][0]["value"], 0.025)
        self.assertEqual(out["undeclaredConstants"], [])

    def test_insists_on_a_reason(self):
        out = run('assume("x", 1.5, "   ")')
        self.assertFalse(out["ok"])
        self.assertIn("say why", out["error"])


class JobTests(unittest.TestCase):
    def test_captures_stdout_as_scratch_output(self):
        out = run('print("working")\nemit("x", 1.5)')
        self.assertEqual(out["stdout"].strip(), "working")

    def test_keeps_what_was_emitted_before_a_failure(self):
        out = run('emit("good", 1.0)\nraise ValueError("nope")')
        self.assertFalse(out["ok"])
        self.assertEqual(len(out["emitted"]), 1)
        self.assertIn("ValueError: nope", out["error"])

    def test_the_traceback_names_only_the_models_own_code(self):
        out = run('emit("bad", fin.cagr(100, 200, 0))')
        self.assertIn("<calculation>", out["error"])
        self.assertNotIn("runner.py", out["error"])

    def test_reports_a_syntax_error_without_running_anything(self):
        out = run("emit('x', 1.0")
        self.assertFalse(out["ok"])
        self.assertTrue(out["error"].startswith("SyntaxError"))
        self.assertEqual(out["emitted"], [])

    def test_each_job_gets_a_fresh_namespace(self):
        run("leaked = 42")
        out = run('emit("x", leaked)')
        self.assertFalse(out["ok"])
        self.assertIn("NameError", out["error"])

    def test_truncates_runaway_output(self):
        out = run('for _ in range(20000):\n    print("x" * 100)')
        self.assertLessEqual(len(out["stdout"]), runner.MAX_STDOUT_CHARS + 100)
        self.assertIn("output truncated", out["stdout"])


if __name__ == "__main__":
    unittest.main()
