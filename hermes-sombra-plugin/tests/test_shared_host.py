"""Shared gateway offline/loopback contracts, no provider/model/service calls."""
import asyncio
import base64
import hashlib
import logging
import contextvars
from contextlib import asynccontextmanager, contextmanager
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import types
import typing
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import test_plugin as fixtures

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "sombra_shared_fixture"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package
sys.modules[PACKAGE + ".adapter"] = fixtures.plugin
spec = importlib.util.spec_from_file_location(PACKAGE + ".shared_host", ROOT / "shared_host.py")
shared = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = shared
spec.loader.exec_module(shared)


class SharedHostContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        fixture = fixtures.Fixture
        fixture.calls, fixture.outputs, fixture.events, fixture.acked = [], {}, [], set()
        fixture.canonicals, fixture.envelope = {}, True
        fixture.original_acked = threading.Event()
        fixture.trusted, fixture.changed, fixture.fail_delivery = True, False, False
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), fixture)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        credentials = self.root / "bot.env"
        credentials.write_text("SOMBRA_BOT_TOKEN='sombra_scope_test'\n", encoding="utf-8")
        credentials.chmod(0o600)
        self.env = {"SOMBRA_MODE": "shared_host", "SOMBRA_SHARED_HOST_ACK": shared.HOST_ACK,
                    "SOMBRA_STATE_DIR": str(self.root / "state"), "SOMBRA_PROFILE": "sombra",
                    "SOMBRA_TOKEN_FILE": str(credentials), "SOMBRA_LEGACY_STATE_DIR": str(self.root / "legacy"),
                    "SOMBRA_API_URL": f"http://127.0.0.1:{self.server.server_port}/api", "SOMBRA_TEST_LOOPBACK": "1"}
        self.environment = patch.dict(os.environ, self.env)
        self.environment.start()
        self.adapter = shared.SharedHostAdapter(None)
        self.public_scope_marker = contextvars.ContextVar("unit_public_profile_scope", default=False)
        @asynccontextmanager
        async def stub_public_scope():
            # Deliberate unit SDK stub only; exact installed-SDK scope tests run separately.
            marker = self.public_scope_marker.set(True)
            try:
                yield
            finally:
                self.public_scope_marker.reset(marker)
        self.adapter._public_runtime_scope = stub_public_scope
        self.adapter.bot_id = "bot"
        shared.SESSION_BINDINGS.clear()
        self.context_token = shared.INVOCATION.set(None)
        def routed_source(_adapter, **kwargs):
            return types.SimpleNamespace(**kwargs, profile="sombra", profile_route_rejected=False)
        self.source_patch = patch.object(fixtures.Base, "build_source", routed_source)
        self.source_patch.start()

    async def asyncTearDown(self):
        shared.INVOCATION.reset(self.context_token)
        shared.SESSION_BINDINGS.clear()
        for scope in self.adapter._scopes.values():
            scope["journal"].db.close()
        self.source_patch.stop()
        self.environment.stop()
        await asyncio.to_thread(self.server.shutdown)
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def event(self, number, actor="actor-a", channel="chan-a", trusted=True, text="question"):
        canonical = {"update_id": number, "bot_id": "bot", "channel": channel,
                     "sender": {"id": actor}, "chat": {"id": "group"},
                     "access": {"trusted": trusted, "policy_revision": 1}}
        fixtures.Fixture.canonicals[number] = canonical
        event = {"update_id": number, "channel": channel, "sender": {"id": actor}, "chat": {"id": "group", "kind": "group"},
                 "message": {"id": "message-" + str(number), "text": text}}
        return event, canonical

    def bind(self, number=1, actor="actor-a", channel="chan-a", trusted=True):
        event, canonical = self.event(number, actor, channel, trusted)
        _, scope = self.adapter._new_scope(canonical)
        scope["trusted"] = trusted
        token = shared.INVOCATION.set((self.adapter, scope, str(number)))
        self.adapter.current = {"id": number, "parts": 0, "bytes": 0, "failed": False, "final": False,
                                "canonical": fixtures.plugin.digest(canonical), "done": asyncio.Event()}
        self.adapter.journal.begin(number, fixtures.plugin.digest(event))
        return token, scope

    async def test_explicit_risk_optin_required_no_isolation_claim(self):
        with patch.dict(os.environ, {"SOMBRA_SHARED_HOST_ACK": ""}):
            with self.assertRaises(fixtures.plugin.SafetyError):
                shared.SharedHostAdapter(None)
        self.assertNotIn("SOMBRA_BOT_TOKEN", self.adapter.env)
        self.assertFalse((self.root / "state" / "isolated-runtime.json").exists())

    async def test_persona_only_explicit_clean_sombra_profile_never_default(self):
        profile = self.root / "profiles" / "sombra"
        profile.mkdir(parents=True)
        soul = profile / "SOUL.md"
        soul.write_text("Sombra safe persona", encoding="utf-8")
        self.assertEqual(shared.protected_persona(str(soul), "sombra"), "Sombra safe persona")
        self.assertEqual(shared.protected_persona(None, "sombra"), "")
        with self.assertRaises(fixtures.plugin.SafetyError):
            shared.protected_persona(str(soul), "default")

    async def test_actual_sdk_connect_consumer_forwards_initial_and_reconnect_keywords(self):
        from test_startup_contract import function
        consumer = function("gateway/run_adapters.py", "_connect_adapter_bounded", {"asyncio": asyncio}, "GatewayAdapterLifecycleMixin")
        async def idle_poll():
            await asyncio.Event().wait()
        self.adapter._poll = idle_poll
        self.adapter.public_runner = lambda *args: None  # Never called; no provider discovery.
        runner = types.SimpleNamespace(_platform_connect_timeout_secs=lambda platform, initial=False: 0)
        self.assertTrue(await consumer(runner, self.adapter, None, is_reconnect=False, initial=True))
        await self.adapter.disconnect()
        self.assertTrue(await consumer(runner, self.adapter, None, is_reconnect=True, initial=False))
        await self.adapter.disconnect()
        self.assertFalse(any(call["op"] in ("bot_get_updates", "bot_reply", "bot_ack") for call in fixtures.Fixture.calls))

    async def test_backend_envelope_and_local_lifecycle_no_model_proxy(self):
        response = await self.adapter.broker.acall("bot_get_me")
        self.assertEqual(response["bot"]["id"], "bot")
        await self.adapter.broker.acall("runtime_begin_invocation", update_id=99)
        self.assertFalse(any(call["op"] == "runtime_begin_invocation" for call in fixtures.Fixture.calls))

    async def test_two_concurrent_trusted_sources_keep_invocation_outputs_distinct(self):
        first, authority_a = self.event(1, "actor-a", "chan-a")
        second, authority_b = self.event(2, "actor-b", "chan-b")
        _, scope_a = self.adapter._new_scope(authority_a)
        _, scope_b = self.adapter._new_scope(authority_b)
        await asyncio.gather(self.adapter._run_scope(scope_a, first, authority_a), self.adapter._run_scope(scope_b, second, authority_b))
        self.assertEqual(fixtures.Fixture.acked, {1, 2})
        self.assertEqual({payload["update_id"] for payload in fixtures.Fixture.outputs.values()}, {1, 2})
        self.assertNotEqual(scope_a["directory"], scope_b["directory"])
        self.assertEqual(scope_a["journal"].begin(1, fixtures.plugin.digest(first)), "ACKED")
        self.assertEqual(scope_b["journal"].begin(2, fixtures.plugin.digest(second)), "ACKED")
        self.assertIsNone(self.adapter.current)
        self.assertIsNone(shared.INVOCATION.get())

    async def test_fresh_auth_survives_thread_hop_revoke_and_telegram_untouched(self):
        token, scope = self.bind()
        try:
            shared.bind_shared_agent_session(session_id="sombra-session", platform="sombra")
            allowed = await asyncio.to_thread(shared.shared_pre_tool_call, tool_name="terminal", args={}, session_id="sombra-session")
            self.assertIsNone(allowed)
            fixtures.Fixture.canonicals[1]["access"]["trusted"] = False
            denied = await asyncio.to_thread(shared.shared_pre_tool_call, tool_name="read_file", args={}, session_id="sombra-session")
            self.assertEqual(denied["action"], "block")
            # Simulate a context-dropping SDK boundary with the REAL registered session ID.
            empty = contextvars.Context()
            self.assertEqual(empty.run(shared.shared_pre_tool_call, session_id="sombra-session")["action"], "block")
            self.assertIsNone(empty.run(shared.shared_pre_tool_call, session_id="telegram-unrelated"))
        finally:
            shared.INVOCATION.reset(token)

    async def test_missing_pre_llm_binding_fails_closed_for_sombra_and_child(self):
        shared.bind_shared_agent_session(session_id="lost-sombra", platform="sombra")
        shared.bind_shared_agent_session(session_id="lost-child", platform="delegate", parent_session_id="lost-sombra")
        self.assertEqual(shared.shared_pre_tool_call(session_id="lost-sombra")["action"], "block")
        self.assertEqual(shared.shared_pre_tool_call(session_id="lost-child")["action"], "block")
        self.assertIsNone(shared.shared_pre_tool_call(session_id="telegram"))

    async def test_detached_old_task_cannot_piggyback_new_same_scope_invocation(self):
        token, scope = self.bind()
        try:
            shared.bind_shared_agent_session(session_id="session", platform="sombra")
            # Old ContextVar retains update1 immutably while same actor/channel starts update2.
            scope["current"] = {"id": 2, "failed": False}
            self.assertEqual(shared.shared_pre_tool_call(session_id="session")["action"], "block")
            self.assertIsNone(self.adapter.current)
        finally:
            shared.INVOCATION.reset(token)

    async def test_public_two_scopes_use_restricted_callback_not_gateway_or_private_history(self):
        seen = []
        async def public(payload, history):
            self.assertTrue(self.public_scope_marker.get(), "Public callback ran before profile/secret scope entry")
            seen.append((payload["update"]["sender"]["id"], list(history)))
            await self.adapter._public_authorize(payload)
            await asyncio.sleep(0.03)
            return {"text": "public " + payload["update"]["sender"]["id"], "media": []}
        self.adapter.public_runner = public
        first, authority_a = self.event(1, "public-a", "chan-a", False)
        second, authority_b = self.event(2, "public-b", "chan-b", False)
        _, scope_a = self.adapter._new_scope(authority_a)
        _, scope_b = self.adapter._new_scope(authority_b)
        await asyncio.gather(self.adapter._run_scope(scope_a, first, authority_a), self.adapter._run_scope(scope_b, second, authority_b))
        self.assertEqual(seen, [("public-a", []), ("public-b", [])])
        self.assertEqual(fixtures.Fixture.outputs[(1, "part_00")]["text"], "public public-a")
        self.assertEqual(fixtures.Fixture.outputs[(2, "part_00")]["text"], "public public-b")
        self.assertFalse(hasattr(self.adapter, "last_event"))
        a_history = scope_a["journal"].db.execute("SELECT text FROM public_history").fetchall()
        self.assertNotIn("public public-b", repr(a_history))

    async def test_offturn_public_scope_real_secret_guard_thread_copy_and_telegram_restore(self):
        from test_startup_contract import function, SDK
        # Actual pinned secret-scope implementation + actual official runtime-scope function;
        # only home/path and terminal-policy IO are harmless fixture context managers.
        spec = importlib.util.spec_from_file_location("sombra_real_secret_scope_fixture", SDK / "agent/secret_scope.py")
        secret = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(secret)
        owner_home = self.root / "owner"
        named_home = self.root / "profiles" / "sombra"
        home = contextvars.ContextVar("unit_sdk_home", default=owner_home)
        constants = types.ModuleType("hermes_constants")
        constants.set_hermes_home_override = lambda value: home.set(Path(value))
        constants.reset_hermes_home_override = home.reset
        constants.get_hermes_home = home.get
        constants.get_routing_process_hermes_home = lambda: owner_home
        constants.process_hermes_home_is_pinned = lambda: True
        constants.pin_process_hermes_home = lambda value: None
        terminal = types.ModuleType("tools.terminal_scope")
        @contextmanager
        def terminal_policy(path):
            self.assertEqual(home.get(), path)
            yield
        terminal.install_and_reset_profile_terminal_scope = terminal_policy
        tools = types.ModuleType("tools")
        tools.__path__ = []
        runtime = types.ModuleType("gateway.run")
        runtime._profile_runtime_scope = contextmanager(function("gateway/run.py", "_profile_runtime_scope",
                                                  {"_contextmanager": contextmanager, "Optional": typing.Optional, "Path": Path}))
        modules = {"hermes_constants": constants, "agent.secret_scope": secret,
                   "tools": tools, "tools.terminal_scope": terminal, "gateway.run": runtime}
        self.adapter._public_profile_home = named_home
        self.adapter._public_prepared_secrets = {"HERMES_CODEX_BASE_URL": "https://dummy-provider.invalid"}
        token, _ = self.bind(trusted=False)
        try:
            with patch.dict(sys.modules, modules):
                secret.set_multiplex_active(True)
                secret.set_secret_scope(None)
                with self.assertRaises(secret.UnscopedSecretError):
                    await asyncio.to_thread(secret.get_secret_str, "HERMES_CODEX_BASE_URL", "")
                environment = dict(os.environ)
                async def public():
                    # Invoke the PRODUCT method, not the setUp unit stub/outer fixture scope.
                    async with shared.SharedHostAdapter._public_runtime_scope(self.adapter):
                        def resolve_like_pool():
                            return (secret.get_secret_str("HERMES_CODEX_BASE_URL", ""), home.get(),
                                    secret.current_secret_scope_home(), secret.get_secret_str("TELEGRAM_BOT_TOKEN", ""),
                                    shared.get_current_adapter() is self.adapter)
                        value = await asyncio.to_thread(resolve_like_pool)
                        self.assertEqual(value, ("https://dummy-provider.invalid", named_home, str(named_home), "", True))
                        await asyncio.sleep(0)
                async def telegram():
                    with runtime._profile_runtime_scope(owner_home, {"TELEGRAM_BOT_TOKEN": "dummy-telegram"}):
                        await asyncio.sleep(0)
                        self.assertEqual(secret.get_secret_str("TELEGRAM_BOT_TOKEN", ""), "dummy-telegram")
                        self.assertEqual(home.get(), owner_home)
                await asyncio.gather(public(), telegram())
                self.assertIsNone(secret.current_secret_scope())
                self.assertEqual(home.get(), owner_home)
                self.assertEqual(dict(os.environ), environment)
                with self.assertRaises(secret.UnscopedSecretError):
                    await asyncio.to_thread(secret.get_secret_str, "HERMES_CODEX_BASE_URL", "")
        finally:
            shared.INVOCATION.reset(token)

    async def test_public_reset_handle_is_local_no_model_and_only_current_actor_history(self):
        calls = []
        async def public(payload, history):
            calls.append((payload["update"]["update_id"], list(history)))
            return {"text": "ok", "media": []}
        self.adapter.public_runner = public
        scopes = {}
        for number, actor, text in ((1, "actor-a", "first"), (2, "actor-b", "other"), (3, "actor-a", "/reset@hermes")):
            event, canonical = self.event(number, actor=actor, trusted=False, text=text)
            _, scope = self.adapter._new_scope(canonical)
            scopes[actor] = scope
            await self.adapter._run_scope(scope, event, canonical)
        self.assertEqual([item[0] for item in calls], [1, 2])
        self.assertEqual(scopes["actor-a"]["journal"].db.execute("SELECT COUNT(*) FROM public_history").fetchone()[0], 0)
        self.assertEqual(scopes["actor-b"]["journal"].db.execute("SELECT COUNT(*) FROM public_history").fetchone()[0], 2)
        event, canonical = self.event(4, trusted=False, text="next")
        await self.adapter._run_scope(scopes["actor-a"], event, canonical)
        self.assertEqual(calls[-1], (4, []))
        self.assertEqual(fixtures.Fixture.acked, {1, 2, 3, 4})

    async def test_native_producer_worker_manifest_stages_and_delivers_once_without_media_tag(self):
        token, scope = self.bind()
        try:
            home = self.root / "profiles" / "sombra"
            cache = home / "cache" / "images"
            cache.mkdir(parents=True)
            source = cache / "native.png"
            raw = b"\x89PNG\r\n\x1a\nfixture-produced"
            source.write_bytes(raw)
            scope["artifact_roots"].append(cache.resolve())
            self.adapter._public_profile_home = home
            payload = {"success": True, "image": str(source), "provider": "fixture"}
            for _ in range(2):
                await asyncio.to_thread(shared.observe_generated_artifact, tool_name="image_generate", result=json.dumps(payload), tool_call_id="native-call-1")
            records = self.adapter.current.get("generated_artifacts", {})
            self.assertEqual(len(records), 1)
            row = self.adapter.journal.db.execute("SELECT update_id,tool_call_id,sha256,staged_path,tool_result_hash,response_ref FROM generated_artifacts").fetchone()
            self.assertEqual(row[:3], ("1", "native-call-1", hashlib.sha256(raw).hexdigest()))
            self.assertEqual(Path(row[3]).read_bytes(), raw)
            self.assertEqual(row[4], fixtures.plugin.digest(payload))
            self.assertIsNone(row[5])
            await self.adapter.send(self.adapter.channel, "Готово: [скачать](" + source.as_uri() + ")")
            event = types.SimpleNamespace(platform_update_id=1)
            await self.adapter._deliver_generated_outputs(event)
            await self.adapter._deliver_generated_outputs(event)
            replies = [call for call in fixtures.Fixture.calls if call["op"] == "bot_reply"]
            self.assertEqual(len(replies), 2)
            self.assertNotIn("file://", replies[0]["text"])
            self.assertNotIn(str(home), replies[0]["text"])
            self.assertEqual(base64.b64decode(replies[1]["attachment"]["data"]), raw)
            self.assertEqual(replies[1]["attachment"]["mime"], "image/png")
            self.assertTrue(self.adapter.current["attachments_complete"])
            self.assertIsNotNone(self.adapter.journal.db.execute("SELECT response_ref FROM generated_artifacts").fetchone()[0])
        finally:
            shared.INVOCATION.reset(token)

    async def test_unproven_file_uri_never_reads_or_exports_other_actor_cache(self):
        token, scope = self.bind()
        try:
            self.adapter._public_profile_home = self.root / "profiles" / "sombra"
            other = self.root / "telegram" / "cache" / "images"
            other.mkdir(parents=True)
            source = other / "private.png"
            source.write_bytes(b"\x89PNG\r\n\x1a\nprivate")
            scope["artifact_roots"].append(other.resolve())  # even an erroneous operator root is insufficient
            with patch.object(shared, "safe_file", side_effect=AssertionError("unproven source must not be read")) as read:
                await self.adapter.send(self.adapter.channel, "[скачать](" + source.as_uri() + ")")
                await self.adapter._deliver_generated_outputs(types.SimpleNamespace(platform_update_id=1))
                read.assert_not_called()
                # Exercise the SAME egress SDK automatic local-media delivery uses, not just
                # the post-tool observer: a bad configured root cannot bypass provenance.
                result = await self.adapter._media(self.adapter.channel, str(source))
                self.assertFalse(result.success)
                read.assert_not_called()
                await asyncio.to_thread(shared.observe_generated_artifact, tool_name="image_generate", tool_call_id="bad-call", result=json.dumps({"success": True, "image": str(source)}))
                read.assert_not_called()
                ordinary = self.adapter.state_dir / "artifacts" / "report.txt"
                ordinary.parent.mkdir(exist_ok=True)
                ordinary.write_text("own generated report", encoding="utf-8")
                self.assertFalse((await self.adapter._media(self.adapter.channel, str(ordinary))).success)
                read.assert_not_called()
            self.assertFalse(self.adapter.current.get("generated_artifacts"))
            self.assertTrue(self.adapter.current.get("generated_errors"))
            replies = [call for call in fixtures.Fixture.calls if call["op"] == "bot_reply"]
            self.assertTrue(all(not call.get("attachment") for call in replies))
            self.assertIn("файл не отправлен", replies[0]["text"])
            self.assertNotIn(str(source), replies[0]["text"])
        finally:
            shared.INVOCATION.reset(token)

    async def test_slash_callback_body_runs_in_captured_full_sdk_scope_and_restores_poll(self):
        from test_startup_contract import function
        token, scope = self.bind()
        home = self.root / "profiles" / "sombra"
        sdk_home = contextvars.ContextVar("stub_sdk_control_home", default=self.root)
        sdk_secrets = contextvars.ContextVar("stub_sdk_control_secrets", default=None)
        observed = []
        @asynccontextmanager
        async def official_scope(path):
            h = sdk_home.set(path)
            s = sdk_secrets.set({"MODEL_KEY": "runtime-only-dummy"})
            try:
                yield
            finally:
                sdk_secrets.reset(s)
                sdk_home.reset(h)
        async def callback(choice):
            await asyncio.sleep(0)  # prove BODY after a suspension, not coroutine creation
            observed.append((choice, sdk_home.get(), sdk_secrets.get() is not None,
                             shared.get_current_adapter() is self.adapter, self.adapter.current["id"]))
            return "reset complete"
        pending = {"sdk-session": {"confirm_id": "sdk-reset-1", "command": "reset", "handler": callback, "created_at": 0}}
        slash = types.ModuleType("tools.slash_confirm")
        slash.get_pending = lambda session: pending.get(session)
        slash.clear_if_stale = lambda session: False
        slash.resolve = function("tools/slash_confirm.py", "resolve", {"DEFAULT_TIMEOUT_SECONDS": 300, "Optional": typing.Optional,
                                   "_lock": fixtures.threading.RLock(), "_pending": pending, "_is_stale": lambda entry, timeout: False,
                                   "logger": logging.getLogger("strict_scope_fixture")})
        tools = types.ModuleType("tools")
        tools.slash_confirm = slash
        runtime = types.ModuleType("gateway.run")
        runtime._async_profile_runtime_scope = official_scope
        try:
            with patch.dict(sys.modules, {"tools": tools, "tools.slash_confirm": slash, "gateway.run": runtime}), patch.object(self.adapter, "_public_home", lambda: home):
                result = await self.adapter.send_slash_confirm(self.adapter.channel, "Reset", "Confirm", "sdk-session", "sdk-reset-1")
                self.assertTrue(result.success)
                nonce = next(iter(self.adapter._prompts))
                serialized = self.adapter.journal.db.execute("SELECT payload FROM prompts WHERE nonce=?", (nonce,)).fetchone()[0]
                self.assertNotIn("runtime_context", serialized)
                self.assertNotIn("runtime-only-dummy", serialized)
                self.assertEqual(sdk_home.get(), self.root)
                self.assertIsNone(sdk_secrets.get())
                control, _ = self.event(2, text="/sombra-confirm@hermes " + nonce + " once")
                self.assertTrue(await self.adapter.handle_control(control))
                self.assertEqual(observed, [("once", home, True, True, 1)])
                self.assertEqual(sdk_home.get(), self.root)
                self.assertIsNone(sdk_secrets.get())
                self.assertEqual(self.adapter.current["id"], 1)
                self.assertEqual(fixtures.Fixture.acked, {2})
                self.assertTrue(self.adapter.current["slash_waiters"][0].is_set())
        finally:
            shared.INVOCATION.reset(token)

    async def test_supported_private_notice_route_suppresses_home_setup_without_public_fallback(self):
        from test_startup_contract import function
        config = types.SimpleNamespace(extra={"notice_delivery": "public"})
        adapter = shared.SharedHostAdapter(config)
        self.assertEqual(config.extra["notice_delivery"], "private")
        self.assertFalse(adapter.supports_async_delivery)
        runner = types.SimpleNamespace(config=None, _delivery_adapter_for=lambda source: adapter,
                                       _thread_metadata_for_source=lambda source: {})
        source = types.SimpleNamespace(platform="sombra", chat_id="chan-a", user_id="actor-a")
        runtime = types.ModuleType("gateway.run")
        runtime._is_slack_ignored_channel = lambda *args: False
        @contextmanager
        def suppressed(*args, **kwargs):
            yield
        deliver = function("gateway/run_notifications.py", "_deliver_platform_notice",
                           {"Platform": types.SimpleNamespace(SLACK="slack"), "logging": logging,
                            "logger": logging.getLogger("notice_fixture"), "_log_suppressed": suppressed}, "GatewayNotificationsMixin")
        previous = len(fixtures.Fixture.calls)
        with patch.dict(sys.modules, {"gateway.run": runtime}), patch.object(sys.modules["gateway.config"], "_normalize_choice", lambda value, choices, default: value if value in choices else default, create=True):
            await deliver(runner, source, "No home channel is set. Type /sethome")
        self.assertEqual(len(fixtures.Fixture.calls), previous)
        result = await adapter.send_private_notice("chan-a", "actor-a", "No home channel")
        self.assertTrue(result.raw_response["suppressed"])
        self.assertIsNone(result.message_id)

    async def test_public_normal_sdk_fallback_tool_executor_always_blocked(self):
        token, scope = self.bind(trusted=False)
        try:
            self.assertEqual(shared.shared_pre_tool_call(tool_name="terminal", args={})["action"], "block")
            self.assertEqual(self.adapter.toolsets_for_source(None), [])
        finally:
            shared.INVOCATION.reset(token)

    async def test_settings_is_intercepted_before_gateway_or_public_model(self):
        event, canonical = self.event(1, trusted=False, text="/settings@hermes")
        _, scope = self.adapter._new_scope(canonical)
        called = []
        async def forbidden_public(*args):
            called.append(True)
            raise AssertionError("Settings must not call a model")
        self.adapter.public_runner = forbidden_public
        await self.adapter._run_scope(scope, event, canonical)
        self.assertFalse(called)
        self.assertFalse(hasattr(self.adapter, "last_event"))
        self.assertIn(1, fixtures.Fixture.acked)
        self.assertTrue(any(call["op"] == "bot_get_settings" and call["update_id"] == 1 for call in fixtures.Fixture.calls))
        self.assertIn("Настройки доступны владельцу в личке", fixtures.Fixture.outputs[(1, "part_00")]["text"])

    async def test_canonical_sombra_handle_preserves_native_help_and_settings(self):
        self.adapter.bot_handle = "sombra"
        event, _ = self.event(1, text="/help@sombra")
        self.assertEqual(self.adapter.classify_text(event), ("native", "/help"))
        event["message"]["text"] = "@sombra /settings"
        self.assertTrue(self.adapter._is_settings_update(event))
        event["message"]["text"] = "/sombra-confirm@sombra " + "0" * 32 + " once"
        self.assertTrue(self.adapter._is_control_text(event))

    async def test_trusted_profile_fallback_to_telegram_is_refused(self):
        token, scope = self.bind()
        try:
            with patch.object(fixtures.Base, "build_source", lambda *args, **kwargs: types.SimpleNamespace(profile=None, profile_route_rejected=False)):
                with self.assertRaises(fixtures.plugin.SafetyError):
                    self.adapter.build_source(chat_id="chan-a", user_id="actor-a")
        finally:
            shared.INVOCATION.reset(token)


if __name__ == "__main__":
    unittest.main()
