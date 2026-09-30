"""Job runner inside the sandbox: fresh namespace, preflight, capture, emit/assume.

The JavaScript host keeps only strings on the boundary — it hands `run_job` the code and a
JSON payload and gets JSON back — so no proxy object outlives a job and nothing the model
writes can reach a JavaScript value the host still holds.

Every job gets its own module namespace, so a name bound by one calculation is invisible to
the next. `fin` is imported once at boot and shared read-only.
"""

from __future__ import annotations

import ast
import io
import json
import math
import time
import traceback
import types
from collections.abc import Sequence
from contextlib import redirect_stdout
from numbers import Real
from typing import Any

import fin
import precheck

#: stdout is scratch space, not a result channel; a runaway loop must not fill the transcript.
MAX_STDOUT_CHARS = 20_000

#: A vector longer than this is summarized rather than returned in full.
MAX_EMIT_ITEMS = 500

#: Literals the preflight treats as conventional rather than as undeclared assumptions.
COMMON_CONSTANTS = frozenset({0, 1, 2, 3, 4, 10, 12, 52, 100, 252, 360, 365, 1000, 1e6, 1e9, 0.5})


class EmitError(ValueError):
    """Raised when `emit()` is handed something that is not a number or a vector of numbers."""


# --------------------------------------------------------------------------- values


def _is_number(value: object) -> bool:
    return isinstance(value, Real) and not isinstance(value, bool)


def _finite(name: str, value: float) -> float:
    """Reject NaN and infinity: an evidence entry must hold a real number."""
    number = float(value)
    if not math.isfinite(number):
        raise EmitError(f"emit({name!r}): value is {number}, which cannot be recorded as evidence")
    return number


def _as_number_list(name: str, values: object) -> list[float]:
    out: list[float] = []
    for item in values:
        if not _is_number(item):
            raise EmitError(f"emit({name!r}): vectors must hold numbers, got {type(item).__name__}")
        out.append(_finite(name, item))
    return out


def _labeled(name: str, keys: object, values: object) -> dict[str, float]:
    return {str(key): _finite(name, value) for key, value in zip(keys, values)}


def _coerce_emitted(name: str, value: object) -> tuple[object, str | None, str | None]:
    """Turn what the model emitted into a JSON value, plus the unit and formula it carries.

    Accepts `fin` results, plain numbers, sequences, mappings and pandas Series, in that order of
    preference, so a `fin` result keeps its formula while a hand-rolled number still records.
    """
    unit = getattr(value, "unit", None)
    formula = getattr(value, "formula", None)

    if isinstance(value, fin.FinResult):
        return _finite(name, float(value)), unit, formula
    if isinstance(value, fin.FinVector):
        labels = value.labels
        numbers = _as_number_list(name, value.value)
        payload = _labeled(name, labels, numbers) if labels else numbers
        return payload, unit, formula
    if isinstance(value, fin.FinStruct):
        return {key: _finite(name, number) for key, number in value.value.items()}, unit, formula
    if _is_number(value):
        return _finite(name, value), unit, formula

    # pandas Series and anything else that carries an index alongside its values.
    index = getattr(value, "index", None)
    to_list = getattr(value, "tolist", None)
    if index is not None and callable(to_list):
        numbers = _as_number_list(name, to_list())
        if len(numbers) > MAX_EMIT_ITEMS:
            raise EmitError(f"emit({name!r}): {len(numbers)} values is too many; emit a summary instead")
        return _labeled(name, list(index), numbers), unit, formula
    if isinstance(value, dict):
        return _labeled(name, value.keys(), value.values()), unit, formula
    if isinstance(value, (list, tuple)):
        numbers = _as_number_list(name, value)
        if len(numbers) > MAX_EMIT_ITEMS:
            raise EmitError(f"emit({name!r}): {len(numbers)} values is too many; emit a summary instead")
        return numbers, unit, formula

    raise EmitError(
        f"emit({name!r}): expected a number, a fin result or a sequence of numbers, "
        f"got {type(value).__name__}"
    )


# ------------------------------------------------------------------------ preflight


def _numeric_constant(node: ast.AST) -> float | None:
    """The value of a numeric literal node, or None when the node is not one."""
    if isinstance(node, ast.Constant) and _is_number(node.value):
        return float(node.value)
    return None


def _called_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


def preflight(code: str, evidence_ids: list[str]) -> tuple[list[dict[str, Any]], list[str]]:
    """Identify undeclared numeric literals and referenced evidence IDs in calculation AST."""
    tree = ast.parse(code, filename=precheck.CODE_FILENAME)
    lines = code.splitlines()

    declared: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _called_name(node) == "assume":
            for argument in [*node.args, *(keyword.value for keyword in node.keywords)]:
                declared.update(id(child) for child in ast.walk(argument))

    undeclared: list[dict[str, Any]] = []
    seen: set[tuple[float, int]] = set()
    for node in ast.walk(tree):
        value = _numeric_constant(node)
        if value is None or value in COMMON_CONSTANTS or id(node) in declared:
            continue
        line = getattr(node, "lineno", 0)
        if (value, line) in seen:
            continue
        seen.add((value, line))
        snippet = lines[line - 1].strip() if 0 < line <= len(lines) else ""
        undeclared.append({"value": value, "line": line, "snippet": snippet[:120]})

    referenced = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    used = [entry_id for entry_id in evidence_ids if entry_id in referenced]
    return undeclared, used


# ------------------------------------------------------------------------- evidence


def _build_frame(entry: dict[str, Any]) -> Any:
    """One evidence table as a pandas DataFrame, with its metadata on `.attrs`."""
    import pandas

    frame = pandas.DataFrame(entry.get("rows") or [], columns=entry.get("columns") or [])
    index = entry.get("index")
    if index and index in frame.columns:
        frame = frame.set_index(index)
    # Numbers arrive as JSON numbers, but a column holding "1,234" or "" stays object; leave it
    # alone rather than guessing, and let the model coerce what it needs.
    frame.attrs.update(entry.get("meta") or {})
    return frame


# ------------------------------------------------------------------------------ job


def _outcome(
    started: float,
    error: str | None,
    emitted: Sequence[dict[str, Any]] = (),
    assumptions: Sequence[dict[str, Any]] = (),
    undeclared: Sequence[dict[str, Any]] = (),
    used: Sequence[str] = (),
    stdout: str = "",
) -> str:
    """The job's SandboxResult as JSON; a job refused before it ran has no results to record."""
    return json.dumps(
        {
            "ok": error is None,
            "emitted": emitted,
            "assumptions": assumptions,
            "undeclaredConstants": undeclared,
            "usedEvidence": used,
            "stdout": stdout,
            "error": error,
            "durationMs": int((time.monotonic() - started) * 1000),
            "finVersion": fin.__version__,
        }
    )


def precheck_message(code: str, import_names_json: str) -> str:
    """The pre-check's verdict for the host, empty when the code is worth running.

    The host asks before it loads packages, so code that is about to be rejected does not first
    pull scipy off disk. `run_job` runs the same check again, and that is where the rejection
    becomes the job's result; parsing a second time costs microseconds.
    """
    try:
        return precheck.check(code, json.loads(import_names_json)) or ""
    except SyntaxError:
        # Not this function's to report: `run_job` answers a syntax error as the job's error.
        return ""


def run_job(code: str, payload_json: str) -> str:
    """Run one calculation and return the SandboxResult as a JSON string.

    Never raises: a failure inside the model's code becomes `ok: false` with the traceback,
    so the host's job loop stays alive and the process keeps its warm interpreter.
    """
    started = time.monotonic()
    payload = json.loads(payload_json)
    evidence: dict[str, Any] = payload.get("evidence") or {}
    # Every top-level module this runtime can import, as the bundler derived it.
    import_names: list[str] = [str(name) for name in payload.get("importNames") or []]

    emitted: list[dict[str, Any]] = []
    assumptions: list[dict[str, Any]] = []
    undeclared: list[dict[str, Any]] = []
    used: list[str] = []
    error: str | None = None

    def emit(name: str, value: object, unit: str | None = None, formula: str | None = None) -> object:
        """Record a result. Returns the value, so `emit()` can wrap an expression in place."""
        payload_value, own_unit, own_formula = _coerce_emitted(name, value)
        record: dict[str, Any] = {"name": str(name), "value": payload_value}
        resolved_unit = unit if unit is not None else own_unit
        resolved_formula = formula if formula is not None else own_formula
        if resolved_unit:
            record["unit"] = str(resolved_unit)
        if resolved_formula:
            record["formula"] = str(resolved_formula)
        emitted.append(record)
        return value

    def assume(name: str, value: float, why: str) -> float:
        """Declare a constant the calculation needs. Returns the value; records an A entry."""
        if not _is_number(value):
            raise EmitError(f"assume({name!r}): value must be a number, got {type(value).__name__}")
        if not str(why).strip():
            raise EmitError(f"assume({name!r}): say why in the third argument, e.g. the source of the figure")
        number = _finite(name, value)
        assumptions.append({"name": str(name), "value": number, "why": str(why)})
        return number

    namespace = types.ModuleType("calculation")
    namespace.__dict__.update({"fin": fin, "emit": emit, "assume": assume})

    try:
        rejected = precheck.check(code, import_names)
    except SyntaxError as err:
        return _outcome(started, f"SyntaxError: {err.msg} (line {err.lineno})")
    if rejected:
        # A quality rejection, not a failure: nothing ran, so there is no traceback to wrap it in
        # and nothing to retry. The one line goes to the model as the tool error.
        return _outcome(started, rejected)

    # Requested order, not sorted: `E12` must not come before `E7` in the recorded inputs.
    # The pre-check already parsed the code, so this parse can no longer raise SyntaxError.
    undeclared, used = preflight(code, list(evidence))

    for entry_id, entry in evidence.items():
        namespace.__dict__[entry_id] = _build_frame(entry)

    buffer = io.StringIO()
    try:
        with redirect_stdout(buffer):
            exec(compile(code, precheck.CODE_FILENAME, "exec"), namespace.__dict__)  # noqa: S102 - the point of the sandbox
    except BaseException as err:  # noqa: BLE001 - anything the model raises is a tool error
        error = _format_error(err)

    stdout = buffer.getvalue()
    if len(stdout) > MAX_STDOUT_CHARS:
        stdout = f"{stdout[:MAX_STDOUT_CHARS]}\n… output truncated at {MAX_STDOUT_CHARS} characters"

    return _outcome(started, error, emitted, assumptions, undeclared, used, stdout)


def _format_error(err: BaseException) -> str:
    """The traceback trimmed to the model's own frames, so the tool error is about its code."""
    frames = [frame for frame in traceback.extract_tb(err.__traceback__) if frame.filename == precheck.CODE_FILENAME]
    lines = ["".join(traceback.format_list(frames)).rstrip()] if frames else []
    lines.append("".join(traceback.format_exception_only(type(err), err)).strip())
    return "\n".join(line for line in lines if line)
