"""Sandbox escape probes testing filesystem, network, subprocess, and memory isolation boundaries."""

from __future__ import annotations

import inspect
import json
from typing import Any, Callable

_URL_TEMPLATE = "http://127.0.0.1:{port}/canary"


async def _probe(name: str, thunk: Callable[[], object], token: str) -> dict[str, Any]:
    """Run one probe, awaiting whatever it returns. Raising is a block; a value is an escape."""
    try:
        result = thunk()
        if inspect.isawaitable(result) or hasattr(result, "__await__"):
            result = await result
    except BaseException as err:  # noqa: BLE001 - any failure to reach the resource is a pass
        return {"name": name, "blocked": True, "detail": f"{type(err).__name__}: {err}"[:300]}
    text = "" if result is None else str(result)
    if token and token in text:
        return {"name": name, "blocked": False, "detail": f"read the canary token: {text[:200]}"}
    return {"name": name, "blocked": False, "detail": f"reached the resource, returned {text[:200]!r}"}


def _open_outside(canary_path: str) -> object:
    with open(canary_path, encoding="utf-8") as handle:
        return handle.read()


def _js_file_read(canary_path: str) -> object:
    import js  # the `js` module is whatever jsglobals exposes; with Object.create(null) it is empty

    return js.Deno.readTextFileSync(canary_path)


def _js_fetch(url: str) -> object:
    import js

    return js.fetch(url)


def _escaped_globals() -> Any:
    """`pyodide_js.constructor.constructor` is `Function`, which still closes over the real realm."""
    import pyodide_js

    return pyodide_js.constructor.constructor("return globalThis")()


def _constructor_file_read(canary_path: str) -> object:
    return _escaped_globals().Deno.readTextFileSync(canary_path)


def _constructor_env_read(env_name: str) -> object:
    return _escaped_globals().Deno.env.get(env_name)


def _constructor_fetch(url: str) -> object:
    return _escaped_globals().fetch(url)


def _nodefs_mount(canary_path: str) -> object:
    import pyodide_js

    pyodide_js.FS.mkdirTree("/host")
    pyodide_js.FS.mount(pyodide_js.FS.filesystems.NODEFS, {"root": "/"}, "/host")
    with open(f"/host{canary_path}", encoding="utf-8") as handle:
        return handle.read()


def _load_package_url(url: str) -> object:
    import pyodide_js

    return pyodide_js.loadPackage(url)


def _urllib_loopback(url: str) -> object:
    import urllib.request

    with urllib.request.urlopen(url, timeout=5) as response:  # noqa: S310 - the point of the probe
        return response.read()


def _subprocess_shell(marker_path: str) -> object:
    import subprocess

    # Its own marker, so the caller can tell a subprocess escape from an `os.system` one.
    return subprocess.run(  # noqa: S603 - the point of the probe
        ["/bin/sh", "-c", f"echo escaped > {marker_path}.subprocess"],
        capture_output=True,
        timeout=5,
    ).returncode


def _remote_import(url: str) -> object:
    """Fetching a module over the network is how a real payload would get in."""
    import pyodide.http

    return pyodide.http.pyfetch(url)


def _huge_allocation() -> object:
    # 4 GiB against a 1 GiB WebAssembly cap: MemoryError is the block, and the interpreter must
    # survive it, which every probe and job after this one proves.
    return len(bytearray(4 * 1024 * 1024 * 1024))


async def run_probes(args_json: str) -> str:
    """Run every probe except `os.system` and return the results as JSON.

    `os.system` is left to `run_os_system`, because it can take the interpreter down with it and
    the caller needs these results on the wire first.
    """
    args = json.loads(args_json)
    canary_path: str = args["canaryPath"]
    canary_token: str = args["canaryToken"]
    env_name: str = args["canaryEnv"]
    marker_path: str = args["markerPath"]
    url = _URL_TEMPLATE.format(port=args["canaryPort"])

    probes = [
        await _probe("file_open_outside", lambda: _open_outside(canary_path), canary_token),
        await _probe("js_module_file_read", lambda: _js_file_read(canary_path), canary_token),
        await _probe("js_module_fetch", lambda: _js_fetch(url), ""),
        await _probe("constructor_file_read", lambda: _constructor_file_read(canary_path), canary_token),
        await _probe("constructor_env_read", lambda: _constructor_env_read(env_name), canary_token),
        await _probe("constructor_fetch", lambda: _constructor_fetch(url), ""),
        await _probe("nodefs_mount", lambda: _nodefs_mount(canary_path), canary_token),
        await _probe("load_package_url", lambda: _load_package_url(url), ""),
        await _probe("urllib_loopback", lambda: _urllib_loopback(url), canary_token),
        await _probe("subprocess", lambda: _subprocess_shell(marker_path), ""),
        await _probe("remote_import", lambda: _remote_import(url), ""),
        await _probe("huge_allocation", _huge_allocation, ""),
    ]
    return json.dumps(probes)


def run_os_system(marker_path: str) -> str:
    """`os.system` alone: on some builds it reaches the host shell, on ours it kills the interpreter.

    Either way the caller decides the verdict from whether `marker_path` appeared, so a crash here
    is a pass rather than a lost result.
    """
    import os

    code = os.system(f"echo escaped > {marker_path}")  # noqa: S605 - the point of the probe
    return json.dumps({"name": "os_system", "returned": code})
