"""AST pre-check validating imports and calls against sandbox capabilities before execution."""

from __future__ import annotations

import ast
import sys
from typing import Iterable

#: The model's code is parsed here and compiled in `runner` under this name, so a SyntaxError or a
#: traceback names only the model's own code.
CODE_FILENAME = "<calculation>"

_NO_NETWORK = "the runtime has no network access; fetch the data with the data tools first and pass it in as `evidence`"
_NO_PROCESS = "the runtime cannot start processes"
_NO_THREAD = "the runtime is single-threaded, so a thread can never start"
_NO_HOST = "the runtime is sealed off from its host, so the JavaScript bridge is empty"
_NO_NATIVE = "the runtime cannot load native libraries"
_NO_DISPLAY = "the runtime has no display and no browser"
_NO_FILES = (
    "the runtime's filesystem is empty and holds none of your data; pass data in through `evidence` ids instead"
)

#: Modules that import cleanly and then cannot do the one thing they exist for. Every entry was
#: checked against the real runtime: `threading` imports and `Thread.start()` raises, `socket`
#: imports and connects to nothing, `js` imports and sees an empty object.
_BLOCKED_MODULES: dict[str, str] = {
    "ftplib": _NO_NETWORK,
    "http": _NO_NETWORK,
    "imaplib": _NO_NETWORK,
    "poplib": _NO_NETWORK,
    "smtplib": _NO_NETWORK,
    "socket": _NO_NETWORK,
    "socketserver": _NO_NETWORK,
    "ssl": _NO_NETWORK,
    "urllib3": _NO_NETWORK,
    "wsgiref": _NO_NETWORK,
    "xmlrpc": _NO_NETWORK,
    "multiprocessing": _NO_PROCESS,
    "pty": _NO_PROCESS,
    "subprocess": _NO_PROCESS,
    "_thread": _NO_THREAD,
    "concurrent": _NO_THREAD,
    "threading": _NO_THREAD,
    "js": _NO_HOST,
    "pyodide": _NO_HOST,
    "pyodide_js": _NO_HOST,
    "ctypes": _NO_NATIVE,
    "curses": _NO_DISPLAY,
    "tkinter": _NO_DISPLAY,
    "turtle": _NO_DISPLAY,
    "webbrowser": _NO_DISPLAY,
}

#: Dotted names blocked inside a package whose other halves are useful. `urllib.parse` and
#: `http.HTTPStatus` are ordinary string work; only the parts that open a connection are refused.
_BLOCKED_SUBMODULES: dict[str, str] = {
    "urllib.error": _NO_NETWORK,
    "urllib.request": _NO_NETWORK,
    "urllib.response": _NO_NETWORK,
}

#: `http` is in `_BLOCKED_MODULES` for its client and server halves, but the bare package and its
#: status codes are harmless, so they are let back through.
_ALLOWED_SUBMODULES = frozenset({"http"})

#: Builtins that end the job, ask a question nobody will answer, or reach a file that is not there.
_BLOCKED_BUILTINS: dict[str, str] = {
    "breakpoint": "there is no console or debugger attached",
    "exit": "it ends the calculation without recording anything; return normally and record results with `emit()` instead",
    "input": "the calculation runs unattended, so nothing can answer it",
    "open": _NO_FILES,
    "quit": "it ends the calculation without recording anything; return normally and record results with `emit()` instead",
}

#: `pathlib.Path(...)` methods that touch a file. Anything else on a Path is pure string work.
_BLOCKED_PATH_METHODS = frozenset(
    {"open", "read_bytes", "read_text", "write_bytes", "write_text", "unlink", "mkdir", "touch", "rmdir"}
)


def _os_reason(attribute: str) -> str | None:
    """Why an `os` attribute cannot work here, or None when it is fine to use."""
    if attribute in {"system", "popen", "fork", "forkpty", "kill", "killpg", "abort", "_exit"}:
        return _NO_PROCESS
    if attribute.startswith(("exec", "spawn", "posix_spawn")):
        return _NO_PROCESS
    return None


class _Problem:
    """One rejected construct: where it is, what it says, and which one comes first in the file."""

    def __init__(self, node: ast.AST, construct: str, reason: str) -> None:
        self.line = int(getattr(node, "lineno", 0))
        self.column = int(getattr(node, "col_offset", 0))
        self.message = f"`{construct}` (line {self.line}) cannot work here: {reason}."

    @property
    def position(self) -> tuple[int, int]:
        return (self.line, self.column)


def _literal(node: ast.AST) -> str | None:
    """The value of a string literal argument, or None when the argument is computed."""
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _module_problem(node: ast.AST, dotted: str, construct: str, allowed: frozenset[str]) -> _Problem | None:
    """Decide whether a module name can be imported here, most specific rule first."""
    if dotted in _BLOCKED_SUBMODULES:
        return _Problem(node, construct, _BLOCKED_SUBMODULES[dotted])
    head = dotted.split(".")[0]
    if head in _BLOCKED_MODULES and dotted not in _ALLOWED_SUBMODULES:
        return _Problem(node, construct, _BLOCKED_MODULES[head])
    if head in allowed or head in sys.stdlib_module_names:
        return None
    # No inventory, no opinion: without the manifest's list this rule cannot tell an installed
    # package from a missing one, and a quality gate that guesses is worse than one that waits.
    if not allowed:
        return None
    installed = ", ".join(sorted(allowed))
    return _Problem(
        node,
        construct,
        f"this runtime has no network and no pip, so nothing else can be installed; "
        f"importable here: {installed}, plus the Python standard library",
    )


def _import_problems(node: ast.AST, allowed: frozenset[str]) -> Iterable[_Problem]:
    """Every rejection an import statement carries: `import a.b`, `from a import b`, both forms."""
    if isinstance(node, ast.Import):
        for alias in node.names:
            problem = _module_problem(node, alias.name, f"import {alias.name}", allowed)
            if problem:
                yield problem
        return
    if not isinstance(node, ast.ImportFrom) or node.level != 0 or not node.module:
        return
    names = ", ".join(alias.name for alias in node.names)
    problem = _module_problem(node, node.module, f"from {node.module} import {names}", allowed)
    if problem:
        yield problem
        return
    # `from os import system` hides the call behind a bare name, so it is refused at the import.
    if node.module == "os":
        for alias in node.names:
            reason = _os_reason(alias.name)
            if reason:
                yield _Problem(node, f"from os import {alias.name}", reason)
    if node.module == "sys":
        for alias in node.names:
            if alias.name == "exit":
                yield _Problem(node, "from sys import exit", _BLOCKED_BUILTINS["exit"])


def _call_problems(node: ast.Call, allowed: frozenset[str]) -> Iterable[_Problem]:
    """Every rejection a call carries: a blocked builtin, a dynamic import, or an `os` escape."""
    func = node.func
    if isinstance(func, ast.Name):
        reason = _BLOCKED_BUILTINS.get(func.id)
        if reason:
            yield _Problem(node, f"{func.id}()", reason)
        # `__import__("requests")` and a bare `import_module("requests")` are imports in disguise;
        # a computed name is left alone, because nothing here can say what it will hold.
        if func.id in {"__import__", "import_module"} and node.args:
            name = _literal(node.args[0])
            if name:
                problem = _module_problem(node, name, f"{func.id}({name!r})", allowed)
                if problem:
                    yield problem
        return
    if not isinstance(func, ast.Attribute):
        return
    if isinstance(func.value, ast.Name) and func.value.id == "os":
        reason = _os_reason(func.attr)
        if reason:
            yield _Problem(node, f"os.{func.attr}()", reason)
        return
    if isinstance(func.value, ast.Name) and func.value.id == "sys" and func.attr == "exit":
        yield _Problem(node, "sys.exit()", _BLOCKED_BUILTINS["exit"])
        return
    if func.attr == "import_module" and node.args:
        name = _literal(node.args[0])
        if name:
            problem = _module_problem(node, name, f"import_module({name!r})", allowed)
            if problem:
                yield problem
        return
    # `Path("data.csv").read_text()`. Only a fresh `Path(...)` counts: a variable might be
    # anything, and a false rejection is worse here than a missed one.
    if func.attr in _BLOCKED_PATH_METHODS and isinstance(func.value, ast.Call):
        inner = func.value.func
        name = inner.id if isinstance(inner, ast.Name) else inner.attr if isinstance(inner, ast.Attribute) else ""
        if name == "Path":
            yield _Problem(node, f"Path(...).{func.attr}()", _NO_FILES)


def check(code: str, import_names: Iterable[str]) -> str | None:
    """The one line to send back, or None when the code is worth running.

    Raises SyntaxError, and only SyntaxError: the caller already reports that for the parse it
    would have done anyway.
    """
    tree = ast.parse(code, filename=CODE_FILENAME)
    allowed = frozenset(import_names)

    problems: list[_Problem] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            problems.extend(_import_problems(node, allowed))
        elif isinstance(node, ast.Call):
            problems.extend(_call_problems(node, allowed))

    if not problems:
        return None
    # `ast.walk` is breadth-first, so the earliest construct in the file is picked by position.
    return min(problems, key=lambda problem: problem.position).message
