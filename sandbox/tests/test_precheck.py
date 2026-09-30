"""Tests for the pre-check, run in CPython so they need no Pyodide.

The inventory is passed in here rather than read from the manifest, so these cases keep saying
what they mean when a package is added to or dropped from the runtime.

Run with:  python3 -m unittest discover -s sandbox/tests
"""

from __future__ import annotations

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import precheck  # noqa: E402
import runner  # noqa: E402

INSTALLED = ["dateutil", "fin", "numpy", "pandas", "scipy", "statsmodels"]


def check(code: str) -> str | None:
    return precheck.check(code, INSTALLED)


class ImportTests(unittest.TestCase):
    def test_accepts_the_installed_packages_and_the_standard_library(self):
        code = "import numpy as np\nimport dateutil\nfrom scipy import optimize\nimport math, json\n"
        self.assertIsNone(check(code))

    def test_accepts_a_submodule_of_an_installed_package(self):
        self.assertIsNone(check("import statsmodels.api as sm\nfrom scipy.stats import norm\n"))

    def test_names_the_inventory_when_a_package_is_not_installed(self):
        message = check("import pandas\nimport requests\n")
        self.assertIsNotNone(message)
        self.assertIn("`import requests` (line 2)", message)
        self.assertIn("no network and no pip", message)
        self.assertIn("numpy, pandas", message)
        self.assertEqual(message.count("\n"), 0)

    def test_rejects_a_from_import_of_a_package_that_is_not_installed(self):
        message = check("from ta.momentum import rsi\n")
        self.assertIn("`from ta.momentum import rsi` (line 1)", message)

    def test_rejects_the_network_modules_the_standard_library_still_ships(self):
        self.assertIn("no network access", check("import socket\n"))
        self.assertIn("no network access", check("import urllib.request\n"))
        self.assertIn("no network access", check("from http.client import HTTPConnection\n"))

    def test_leaves_the_useful_halves_of_urllib_and_http_alone(self):
        self.assertIsNone(check("from urllib.parse import urlencode\nfrom http import HTTPStatus\n"))

    def test_rejects_what_needs_a_process_a_thread_or_the_host(self):
        self.assertIn("cannot start processes", check("import subprocess\n"))
        self.assertIn("cannot start processes", check("import multiprocessing as mp\n"))
        self.assertIn("single-threaded", check("import threading\n"))
        self.assertIn("single-threaded", check("from concurrent.futures import ThreadPoolExecutor\n"))
        self.assertIn("sealed off from its host", check("import js\n"))
        self.assertIn("sealed off from its host", check("import pyodide_js\n"))
        self.assertIn("native libraries", check("import ctypes\n"))

    def test_rejects_a_dynamic_import_of_a_literal_name(self):
        self.assertIn("`__import__('requests')` (line 1)", check('__import__("requests")\n'))
        self.assertIn(
            "`import_module('requests')` (line 2)",
            check('import importlib\nimportlib.import_module("requests")\n'),
        )

    def test_leaves_a_computed_import_name_alone(self):
        self.assertIsNone(check('import importlib\nname = "num" + "py"\nimportlib.import_module(name)\n'))

    def test_says_nothing_about_unknown_packages_when_it_has_no_inventory(self):
        self.assertIsNone(precheck.check("import requests\n", []))
        self.assertIn("cannot start processes", precheck.check("import subprocess\n", []))


class CallTests(unittest.TestCase):
    def test_rejects_opening_a_file(self):
        message = check('rows = open("data.csv").read()\n')
        self.assertIn("`open()` (line 1)", message)
        self.assertIn("`evidence` ids", message)

    def test_leaves_an_open_method_on_an_object_alone(self):
        self.assertIsNone(check("prices = E7.open\nfirst = E7.open.iloc[0]\n"))

    def test_rejects_the_os_calls_that_take_the_interpreter_down(self):
        self.assertIn("`os.system()` (line 2)", check('import os\nos.system("ls")\n'))
        self.assertIn("cannot start processes", check('import os\nos.popen("ls")\n'))
        self.assertIn("cannot start processes", check('import os\nos.execv("/bin/sh", [])\n'))
        self.assertIn("cannot start processes", check("import os\nos._exit(0)\n"))
        self.assertIn("`from os import system`", check("from os import system\nsystem('ls')\n"))

    def test_leaves_the_harmless_os_attributes_alone(self):
        self.assertIsNone(check('import os\npath = os.path.join("a", "b")\n'))

    def test_rejects_ending_the_job_early(self):
        self.assertIn("`sys.exit()` (line 2)", check("import sys\nsys.exit(1)\n"))
        self.assertIn("without recording anything", check("exit()\n"))
        self.assertIn("without recording anything", check("quit()\n"))

    def test_rejects_asking_a_question_nobody_can_answer(self):
        self.assertIn("runs unattended", check('x = input("rate? ")\n'))
        self.assertIn("no console or debugger", check("breakpoint()\n"))

    def test_rejects_reading_a_file_through_pathlib(self):
        self.assertIn("`Path(...).read_text()` (line 2)", check('from pathlib import Path\nPath("x.csv").read_text()\n'))
        self.assertIn("`Path(...).open()`", check('import pathlib\npathlib.Path("x").open()\n'))

    def test_leaves_a_path_held_in_a_variable_alone(self):
        # A name could hold anything, and a wrong rejection costs more than a missed one.
        self.assertIsNone(check('from pathlib import Path\np = Path("x")\np.read_text()\n'))


class OrderTests(unittest.TestCase):
    def test_reports_only_the_first_problem_in_the_file(self):
        message = check('import requests\nimport socket\nopen("x")\n')
        self.assertIn("`import requests` (line 1)", message)

    def test_leaves_ordinary_calculations_alone(self):
        code = (
            'rev = E7.loc["Revenues"]\n'
            'emit("CAGR", fin.cagr(rev["FY2021"], rev["FY2025"], periods=4), unit="%")\n'
            'wacc = assume("wacc", 0.092, "CAPM")\n'
            'print("done")\n'
        )
        self.assertIsNone(check(code))

    def test_a_syntax_error_is_the_callers_to_report(self):
        with self.assertRaises(SyntaxError):
            check("emit('x', \n")


class RunJobTests(unittest.TestCase):
    """The rejection as the model receives it: one line, no traceback, nothing recorded."""

    def run_job(self, code: str) -> dict:
        payload = json.dumps({"evidence": {}, "importNames": INSTALLED})
        return json.loads(runner.run_job(code, payload))

    def test_a_rejected_job_returns_the_one_line_and_runs_nothing(self):
        outcome = self.run_job('import requests\nemit("x", 1.5)\n')
        self.assertFalse(outcome["ok"])
        self.assertIn("`import requests` (line 1)", outcome["error"])
        self.assertNotIn("Traceback", outcome["error"])
        self.assertEqual(outcome["emitted"], [])
        self.assertEqual(outcome["stdout"], "")
        self.assertIsInstance(outcome["durationMs"], int)
        self.assertEqual(outcome["finVersion"], runner.fin.__version__)

    def test_an_accepted_job_still_runs(self):
        outcome = self.run_job('emit("x", 1.5)\n')
        self.assertTrue(outcome["ok"])
        self.assertEqual(outcome["emitted"], [{"name": "x", "value": 1.5}])

    def test_the_host_is_told_to_skip_loading_packages_for_a_rejected_job(self):
        self.assertIn("`import socket`", runner.precheck_message("import socket\n", json.dumps(INSTALLED)))
        self.assertEqual(runner.precheck_message('emit("x", 1)\n', json.dumps(INSTALLED)), "")
        # A syntax error is `run_job`'s to report, so the host is left to load what it can.
        self.assertEqual(runner.precheck_message("emit('x',\n", json.dumps(INSTALLED)), "")


if __name__ == "__main__":
    unittest.main()
