"""Offline startup-policy preflight against the ACTUAL installed Hermes SDK.

Run with the existing runtime interpreter and a disposable candidate HERMES_HOME
containing the reviewed candidate config/plugin. Does not connect adapters, poll,
start a GatewayRunner, execute tools, resolve providers or call a model. No SDK edits.
"""
from __future__ import annotations

import argparse
import json
import inspect
import os
from pathlib import Path
import sys
from unittest.mock import patch


class PreflightError(RuntimeError):
    pass


def validate_startup_expansion(actual):
    expected = ("SOMBRA_DM_POLICY", "SOMBRA_GROUP_POLICY")
    if not isinstance(actual, tuple) or len(actual) != 3 or actual[:2] != expected or actual[2]:
        raise PreflightError("Actual SDK startup policy expansion must be the policy pair plus no allow-all descriptor")


def validate_adapter_connect(factory):
    connect = getattr(factory, "connect", None)
    if not inspect.iscoroutinefunction(connect):
        raise PreflightError("Registered Sombra class must expose async connect")
    try:
        inspect.signature(connect).bind(None, is_reconnect=False)
        inspect.signature(connect).bind(None, is_reconnect=True)
    except TypeError:
        raise PreflightError("Registered Sombra connect must accept SDK is_reconnect keyword") from None


def check_registered_config():
    from hermes_cli.plugins import discover_plugins
    from gateway.config import load_gateway_config
    from gateway.platform_registry import platform_registry
    from gateway.run import GatewayRunner
    from gateway.run_startup import _own_policy_envs
    import gateway.run as runtime

    discover_plugins()
    config = load_gateway_config()  # Actual gateway loader, not a handmade PlatformConfig.
    entry = platform_registry.get("sombra")
    if entry is None:
        raise PreflightError("Sombra plugin not registered in candidate profile")
    validate_adapter_connect(entry.adapter_factory)
    expected = ("SOMBRA_DM_POLICY", "SOMBRA_GROUP_POLICY")
    if entry.own_policy_env != expected:
        raise PreflightError("own_policy_env must be the two policy-env descriptors, not a flag or triple")
    if entry.allow_all_env:
        raise PreflightError("Sombra must not declare an allow-all authorization switch")
    if entry.allowed_users_env != "SOMBRA_ALLOWED_USERS" or not entry.allowlist_suppresses_pairing:
        raise PreflightError("Sombra allowlist/pairing descriptor mismatch")
    if not isinstance(entry.required_env, list) or not all(isinstance(name, str) and name for name in entry.required_env):
        raise PreflightError("required_env must be a list of nonempty environment NAME strings")
    platform = next((key for key, value in config.platforms.items() if key.value == "sombra" and value.enabled), None)
    if platform is None:
        raise PreflightError("Candidate config must explicitly enable Sombra")
    actual = _own_policy_envs(platform)
    validate_startup_expansion(actual)
    reason = runtime._own_policy_open_startup_violation(config)
    if reason:
        raise PreflightError("Candidate policy refuses startup: " + reason)
    runner = GatewayRunner.__new__(GatewayRunner)  # No constructor, DB, provider or background work.
    runner.config = config
    exits = []
    runner._request_clean_exit = lambda reason: exits.append(reason)
    # Exercise the ACTUAL startup branch, suppressing status-file writes only. No
    # authorization/policy function is stubbed and no core source is changed.
    with patch.object(runtime, "_write_runtime_status_quiet", lambda **kwargs: None):
        refused = runner._start_check_access_policy()
    if refused or exits:
        raise PreflightError("Actual _start_check_access_policy refused candidate config")
    return {"ok": True, "platform": "sombra", "own_policy_env": list(entry.own_policy_env),
            "startup_expansion": list(actual), "required_env": list(entry.required_env),
            "actual_gateway_config_loader": True, "actual_start_check_access_policy": True,
            "connect_initial_reconnect_keyword": True,
            "adapters_connected": False, "providers_or_models_called": False,
            "authorization_ladder": "must additionally pass exact-SDK source-bound integration fixture"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-home", help="Disposable candidate Hermes home, never copy private root state")
    parser.add_argument("--sdk-root", help="Reviewed existing SDK source directory if interpreter needs an explicit import path")
    args = parser.parse_args()
    if args.candidate_home:
        home = Path(args.candidate_home)
        if not home.is_absolute() or not (home / "config.yaml").is_file():
            parser.error("candidate-home must be absolute with a prepared config.yaml")
        os.environ["HERMES_HOME"] = str(home)
    if args.sdk_root:
        root = Path(args.sdk_root)
        if not root.is_absolute() or not (root / "gateway" / "run.py").is_file():
            parser.error("sdk-root must be the existing reviewed Hermes SDK tree")
        sys.path.insert(0, str(root))
    try:
        print(json.dumps(check_registered_config(), ensure_ascii=False, sort_keys=True))
    except Exception as exc:
        # Unknown SDK exception details can contain operator configuration; do not echo them.
        detail = str(exc) if isinstance(exc, PreflightError) else "Actual SDK startup preflight failed; details withheld to avoid configuration disclosure"
        print(json.dumps({"ok": False, "error_type": type(exc).__name__, "error": detail}, ensure_ascii=False))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
