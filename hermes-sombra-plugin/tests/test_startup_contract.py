"""Execute pinned startup consumers with registered metadata, no installed SDK/model.

This source-extracted regression complements (does NOT replace) preflight.py and
exact-SDK load_gateway_config/authz integration. It catches the string-unpacking
startup failure which constructor-only mocks did not exercise.
"""
import ast
from contextlib import suppress
import enum
import importlib.util
import logging
import os
from pathlib import Path
import sys
import threading
import types
import typing
import unittest
from unittest.mock import patch

import test_plugin as fixtures

SDK = Path(__file__).resolve().parents[2] / "deploy-qa/hermes-runtime-integration/source"


def function(path, name, namespace, class_name=None):
    tree = ast.parse((SDK / path).read_text(encoding="utf-8"))
    body = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == class_name).body if class_name else tree.body
    node = next(node for node in body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name)
    node.decorator_list = []
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(SDK / path), "exec"), namespace)
    return namespace[name]


class Platform(enum.Enum):
    SOMBRA = "sombra"
    LOCAL = "local"
    API_SERVER = "api_server"
    WEBHOOK = "webhook"


class StartupContract(unittest.TestCase):
    def setUp(self):
        class Context:
            def register_hook(self, *args):
                pass
            def register_platform(self, **kwargs):
                self.fields = kwargs
        context = Context()
        with patch.dict(os.environ, {"SOMBRA_MODE": "isolated", "SOMBRA_ACTOR_ID": "actor"}):
            fixtures.plugin.register(context)
        self.entry = types.SimpleNamespace(**context.fields, source="plugin", allow_all_env="")
        self.platform = Platform.SOMBRA
        self.config = types.SimpleNamespace(platforms={self.platform: types.SimpleNamespace(enabled=True, extra={})})
        self.registry = types.SimpleNamespace(get=lambda name: self.entry, loaded_entries=lambda: [self.entry])
        platform_env = types.ModuleType("gateway.platform_env")
        platform_env.authz_field = lambda name, field, entry: getattr(entry, field, None)
        registry_module = types.ModuleType("gateway.platform_registry")
        registry_module.platform_registry = self.registry
        plugins = types.ModuleType("hermes_cli.plugins")
        plugins.discover_plugins = lambda: None
        self.modules = {"gateway.platform_env": platform_env, "gateway.platform_registry": registry_module, "hermes_cli.plugins": plugins}
        namespace = {"Optional": typing.Optional}
        self.expand = function("gateway/run_startup.py", "_own_policy_envs", namespace)
        namespace = {"Optional": typing.Optional, "suppress": suppress, "_own_policy_envs": self.expand,
                     "_getenv": lambda name, default="": os.getenv(name, default)}
        self.violation = function("gateway/run.py", "_own_policy_open_startup_violation", namespace)

    def test_registered_pair_expands_to_exact_startup_triple(self):
        self.assertEqual(self.entry.own_policy_env, ("SOMBRA_DM_POLICY", "SOMBRA_GROUP_POLICY"))
        with patch.dict(sys.modules, self.modules), patch.dict(os.environ, {"SOMBRA_DM_POLICY": "allowlist", "SOMBRA_GROUP_POLICY": "allowlist", "GATEWAY_ALLOW_ALL_USERS": ""}):
            for absent in (None, ""):
                self.entry.allow_all_env = absent
                self.assertEqual(self.expand(self.platform), ("SOMBRA_DM_POLICY", "SOMBRA_GROUP_POLICY", absent))
                self.assertIsNone(self.violation(self.config))

    def test_preflight_accepts_none_or_empty_absence_but_no_truthy_allowall(self):
        path = Path(__file__).resolve().parents[1] / "preflight.py"
        spec = importlib.util.spec_from_file_location("sombra_preflight_contract", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.validate_adapter_connect(fixtures.plugin.SombraAdapter)
        class BadConnect:
            async def connect(self):
                return True
        with self.assertRaises(module.PreflightError):
            module.validate_adapter_connect(BadConnect)
        pair = ("SOMBRA_DM_POLICY", "SOMBRA_GROUP_POLICY")
        for absent in (None, ""):
            module.validate_startup_expansion((*pair, absent))
        for invalid in ((*pair, "SOMBRA_ALLOW_ALL_USERS"), pair, "SOMBRA_OWN_POLICY", ("wrong", pair[1], None)):
            with self.assertRaises(module.PreflightError):
                module.validate_startup_expansion(invalid)

    def test_old_string_descriptor_reproduces_actual_unpack_failure(self):
        self.entry.own_policy_env = "SOMBRA_OWN_POLICY"
        with patch.dict(sys.modules, self.modules):
            with self.assertRaises(ValueError):
                self.violation(self.config)

    def test_actual_start_check_accepts_allowlist_refuses_open_without_allowall(self):
        status, exits = [], []
        runtime = types.ModuleType("gateway.run")
        runtime._own_policy_open_startup_violation = self.violation
        runtime._write_runtime_status_quiet = lambda **kwargs: status.append(kwargs)
        modules = {**self.modules, "gateway.run": runtime}
        namespace = {"suppress": suppress, "os": os, "logger": logging.getLogger(__name__), "Platform": Platform,
                     "_own_policy_envs": self.expand}
        checker = function("gateway/run_startup.py", "_start_check_access_policy", namespace, "GatewayStartupMixin")
        runner = types.SimpleNamespace(config=self.config, _BUILTIN_ALLOWED_USERS_VARS=(), _BUILTIN_ALLOW_ALL_VARS=(),
                                       _request_clean_exit=lambda reason: exits.append(reason))
        environment = {"SOMBRA_DM_POLICY": "allowlist", "SOMBRA_GROUP_POLICY": "allowlist",
                       "SOMBRA_ALLOWED_USERS": "actor", "GATEWAY_ALLOW_ALL_USERS": ""}
        with patch.dict(sys.modules, modules), patch.dict(os.environ, environment):
            self.assertFalse(checker(runner))
            self.assertFalse(status)
            self.assertFalse(exits)
            self.config.platforms[self.platform].extra["dm_policy"] = "open"
            self.assertTrue(checker(runner))
            self.assertEqual(len(exits), 1)
            self.assertEqual(status[0]["gateway_state"], "startup_failed")

    def test_required_env_are_names_consumed_by_actual_registry_scrubber(self):
        self.assertIsInstance(self.entry.required_env, list)
        self.assertTrue(all(isinstance(item, str) for item in self.entry.required_env))
        namespace = {}
        required_names = function("gateway/platform_registry.py", "required_env_names", namespace, "PlatformRegistry")
        registry = types.SimpleNamespace(_lock=threading.RLock(), _entries={"sombra": self.entry},
                                         _scope_maps=lambda key: ({}, {}), current_scope_key=lambda: "candidate")
        self.assertEqual(required_names(registry), set(self.entry.required_env))


if __name__ == "__main__":
    unittest.main()
