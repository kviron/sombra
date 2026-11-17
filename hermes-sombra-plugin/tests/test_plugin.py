"""Offline SDK-stub/HTTP fixture contracts; NOT full Hermes/model/container proof."""
import ast
import asyncio
import base64
from dataclasses import dataclass
import enum
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import types
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT.parent / "deploy-qa/hermes-plugin-inspect/source"


@dataclass
class SendResult:
    success: bool
    message_id: str = None
    error: str = None


class MessageType(enum.Enum):
    TEXT = "text"
    PHOTO = "photo"
    VIDEO = "video"
    AUDIO = "audio"
    VOICE = "voice"
    DOCUMENT = "document"


class MessageEvent:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class Base:
    def __init__(self, config, platform):
        self.config, self.platform = config, platform

    def build_source(self, **kwargs):
        return types.SimpleNamespace(**kwargs)

    async def handle_message(self, event):
        self.last_event = event
        if getattr(self, "fixture_inline", False):
            await self._dispatch_inline_reply(event, log_cmd=event.text)
        else:
            self.background = asyncio.create_task(self._process_message_background(event, "fixture-session"))

    async def _dispatch_inline_reply(self, event, *, log_cmd=None):
        await self.send(event.source.chat_id, "Native command reply: " + event.text)

    async def _process_message_background(self, event, session_key):
        # Deliberately enqueued, not awaited by handle_message (matches reviewed lifecycle).
        await asyncio.sleep(0)
        if getattr(self, "fixture_prompt", False):
            prompt = types.SimpleNamespace(chat_id="chan", session_key="fixture-session", text="Needs approval", actions=[("Once", "once", "primary")], command="REDACTED", metadata={})
            result = await self._send_exec_approval_prompt(prompt)
            if not result.success:
                raise RuntimeError(result.error)
            nonce = next(iter(self._prompts))
            Fixture.events.append({"update_id": 2, "channel": "chan", "sender": {"id": "actor"}, "chat": {"id": "group", "kind": "group"},
                                   "message": {"id": "control-source", "text": "/sombra-confirm@hermes " + nonce + " once"}})
            await self.fixture_approval_event.wait()
        if getattr(self, "fixture_slash", False):
            result = await self.send_slash_confirm("chan", "Confirm", "Scoped action", "fixture-session", "confirm-poll")
            if not result.success:
                raise RuntimeError(result.error)
            nonce = next(iter(self._prompts))
            Fixture.events.append({"update_id": 2, "channel": "chan", "sender": {"id": "actor"}, "chat": {"id": "group", "kind": "group"},
                                   "message": {"id": "control-source", "text": "/sombra-confirm@hermes " + nonce + " once"}})
        if getattr(self, "fixture_error", False):
            await self._notify_turn_error(event, RuntimeError("fixture"))
            return
        if not getattr(self, "fixture_voice_only", False):
            await self.send_final_ledgered(event, session_key, "answer", {}, reply_to=event.message_id)
        else:
            await self.send_voice(event.source.chat_id, str(self.fixture_media))
        await self._deliver_attachments(event, None, {}, anything_sent=True, record_delivery=lambda x: None)
        if getattr(self, "fixture_trailing_media", None):
            await self.send_document(event.source.chat_id, str(self.fixture_trailing_media))

    async def send_final_ledgered(self, event, session_key, text_content, metadata, *, reply_to, is_ephemeral_response=False):
        return await self.send(event.source.chat_id, text_content), self

    async def _deliver_attachments(self, event, extracted, metadata, *, anything_sent, record_delivery):
        return None

    async def _notify_turn_error(self, event, e):
        return None


# Import only plugin with deliberate SDK stub: no installed Hermes, providers or runtime boot.
for name in ("gateway", "gateway.config", "gateway.platforms", "gateway.platforms.base", "gateway.platforms.event"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["agent"] = types.ModuleType("agent")
sys.modules["agent.redact"] = types.ModuleType("agent.redact")
sys.modules["agent.redact"].redact_sensitive_text = lambda text, force=False: text
sys.modules["gateway.config"].Platform = str
sys.modules["gateway.platforms.base"].BasePlatformAdapter = Base
sys.modules["gateway.platforms.base"].SendResult = SendResult
sys.modules["gateway.platforms.event"].MessageType = MessageType
sys.modules["gateway.platforms.event"].MessageEvent = MessageEvent
spec = importlib.util.spec_from_file_location("sombra_test_adapter", ROOT / "adapter.py")
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class Fixture(BaseHTTPRequestHandler):
    events = []
    calls = []
    outputs = {}
    trusted = True
    fail_delivery = False
    changed = False

    def log_message(self, *args):
        pass

    def do_POST(self):
        cls = type(self)
        payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        cls.calls.append(payload)
        op = payload["op"]
        result = {}
        if self.headers.get("Authorization") != "Bearer sombra_scope_test":
            result = {"error": "unauthorized"}
        elif op == "bot_get_me":
            result = {"bot": {"id": "bot"}, "toolPolicy": {"owner": "actor", "users": [], "revision": 1}}
        elif op == "bot_authorize_update":
            result = getattr(cls, "canonicals", {}).get(payload["update_id"], {"update_id": payload["update_id"], "bot_id": "bot", "channel": "chan", "sender": {"id": "actor"},
                      "chat": {"id": "group"}, "access": {"trusted": cls.trusted, "policy_revision": 2 if cls.changed else 1}})
        elif op == "bot_get_updates":
            result = {"updates": [v for v in cls.events if v["update_id"] > payload.get("after", 0) and v["update_id"] not in cls.acked][:payload.get("limit", 50)]}
        elif op == "bot_attachment_file":
            result = {"name": "../../evil.png", "mime": "image/png", "data": base64.b64encode(b"\x89PNG\r\n\x1a\nfixture").decode()}
        elif op == "bot_reply":
            if cls.fail_delivery:
                result = {"error": "delivery failure"}
            else:
                key = (payload["update_id"], payload["response_key"])
                if key in cls.outputs and cls.outputs[key] != payload:
                    result = {"error": "BOT_RESPONSE_CONFLICT"}
                else:
                    cls.outputs[key] = payload
                    result = {"id": "message-" + payload["response_key"]}
        elif op in ("bot_ack", "bot_edit", "bot_delete", "bot_typing"):
            if op == "bot_ack":
                cls.acked.add(payload["update_id"])
                if payload["update_id"] == 1:
                    cls.original_acked.set()
            result = {"ok": True}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"data": result} if getattr(cls, "envelope", False) else result).encode())


class Contracts(unittest.TestCase):
    def test_manifest_and_no_direct_engine(self):
        source = (ROOT / "adapter.py").read_text()
        self.assertNotIn("AIAgent(", source)
        self.assertNotIn("trusted_inbound", source)
        self.assertNotIn("TelegramAdapter", source)
        self.assertIn("version: 0.1.0", (ROOT / "plugin.yaml").read_text())
        class Context:
            def register_hook(self, name, hook):
                self.hook = (name, hook)
            def register_platform(self, **kwargs):
                self.platform = kwargs
        context = Context()
        with patch.dict(plugin.os.environ, {"SOMBRA_ACTOR_ID": "actor"}):
            plugin.register(context)
        self.assertEqual(context.platform["allowed_users_env"], "SOMBRA_ALLOWED_USERS")
        self.assertNotIn("allow_all_env", context.platform)
        self.assertEqual(context.hook[0], "pre_tool_call")

    def test_pinned_sdk_public_signatures(self):
        if not SDK.exists():
            self.fail("Reviewed source mirror required for pinned static SDK contract")
        sdk = ast.parse((SDK / "gateway/platforms/base.py").read_text())
        local = ast.parse((ROOT / "adapter.py").read_text())
        base = next(n for n in sdk.body if isinstance(n, ast.ClassDef) and n.name == "BasePlatformAdapter")
        own = next(n for n in local.body if isinstance(n, ast.ClassDef) and n.name == "SombraAdapter")
        methods = {n.name: n for n in base.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        check = ("connect", "disconnect", "send", "send_image", "send_image_file", "send_document", "send_video", "send_voice", "send_animation", "edit_message", "delete_message", "get_chat_info", "send_typing", "send_final_ledgered", "_deliver_attachments", "_process_message_background", "_dispatch_inline_reply", "send_clarify", "send_slash_confirm")
        for item in own.body:
            if isinstance(item, ast.AsyncFunctionDef) and item.name in check:
                expected = methods[item.name].args
                actual = item.args
                self.assertEqual([a.arg for a in expected.args], [a.arg for a in actual.args], item.name)
                self.assertEqual([a.arg for a in expected.kwonlyargs], [a.arg for a in actual.kwonlyargs], item.name)
                self.assertEqual(bool(expected.kwarg), bool(actual.kwarg), item.name)
        # Public registry keyword contract must exist in pinned PlatformEntry.
        registry = ast.parse((SDK / "gateway/platform_registry.py").read_text())
        entry = next(n for n in registry.body if isinstance(n, ast.ClassDef) and n.name == "PlatformEntry")
        fields = {n.target.id for n in entry.body if isinstance(n, ast.AnnAssign) and isinstance(n.target, ast.Name)}
        for key in ("allowed_users_env", "own_policy_env", "allowlist_suppresses_pairing", "platform_hint", "display_overrides"):
            self.assertIn(key, fields)
        plugins = (SDK / "hermes_cli/plugins.py").read_text()
        self.assertIn('"pre_tool_call"', plugins)
        self.assertIn('action = result.get("action")', plugins)

    def test_broker_raw_mode_and_ssrf_urls_denied(self):
        for url in ("http://example.com/api", "https://u:p@broker/api", "file:///api", "https://broker/api?q=secret"):
            with self.assertRaises(plugin.SafetyError):
                plugin.Broker(url, "sombra_scope_test")
        with self.assertRaises(plugin.SafetyError):
            plugin.Broker("https://broker/api", "raw-bot-token")
        with self.assertRaises(plugin.SafetyError):
            plugin.Broker("http://127.0.0.1/api", "sombra_scope_test")

    def test_journal_crash_never_reexecutes_and_binds_scope(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "j.sqlite"
            journal = plugin.Journal(path, {"actor": "a"})
            self.assertEqual(journal.begin(1, "hash"), "NEW")
            journal.part(1, "part_00", {"text": "cached", "attachment": "bytes"})
            with self.assertRaises(plugin.SafetyError):
                journal.part(1, "part_00", {"text": "different"})
            journal.db.close()
            recovered = plugin.Journal(path, {"actor": "a"})
            self.assertEqual(recovered.begin(1, "hash"), "UNCERTAIN")
            recovered.db.close()
            with self.assertRaises(plugin.SafetyError):
                plugin.Journal(path, {"actor": "b"})

    def test_artifact_security(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "artifacts"
            root.mkdir()
            item = root / "ok.png"
            item.write_bytes(b"png")
            self.assertEqual(plugin.safe_file(item, [root])[0], b"png")
            secret = Path(directory) / "token.env"
            secret.write_bytes(b"secret")
            for path in (secret, root / ".." / "token.env", Path("relative.png")):
                with self.assertRaises(plugin.SafetyError):
                    plugin.safe_file(path, [root])
            try:
                (root / "symlink.png").symlink_to(secret)
            except OSError:
                pass
            else:
                with self.assertRaises(plugin.SafetyError):
                    plugin.safe_file(root / "symlink.png", [root])
            with self.assertRaises(plugin.SafetyError):
                plugin.safe_file(item, [root], limit=1)
            self.assertEqual(plugin.sniff(b"<svg onload=evil>", "image/png")[:2], ("application/octet-stream", ".bin"))

    def test_missing_attestation_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {"SOMBRA_STATE_DIR": directory, "SOMBRA_RUNTIME_ATTESTATION": str(Path(directory) / "missing")}
            with self.assertRaises(FileNotFoundError):
                plugin.validate_runtime(env)


class HTTPIntegration(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        Fixture.calls, Fixture.outputs, Fixture.events, Fixture.acked = [], {}, [], set()
        Fixture.canonicals, Fixture.envelope = {}, False
        Fixture.original_acked = threading.Event()
        Fixture.trusted, Fixture.changed, Fixture.fail_delivery = True, False, False
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir()
        # Unit fixture intentionally bypasses real runtime attestation; not containment proof.
        self.adapter = object.__new__(plugin.SombraAdapter)
        Base.__init__(self.adapter, None, "sombra")
        self.adapter.actor, self.adapter.channel, self.adapter.bot_id = "actor", "chan", "bot"
        self.adapter.manifest = {"server_id": "fixture-server", "bot_id": "bot"}
        self.adapter.state_dir, self.adapter.artifact_roots = self.root, [self.artifacts]
        self.adapter.current, self.adapter._halted = None, False
        self.adapter._prompts = {}
        self.adapter.broker = plugin.Broker(f"http://127.0.0.1:{self.server.server_port}/api", "sombra_scope_test", test=True)
        self.adapter.journal = plugin.Journal(self.root / "journal.sqlite", {"actor": "actor", "channel": "chan", "bot": "bot"})
        plugin._ACTIVE = self.adapter

    async def asyncTearDown(self):
        self.adapter.journal.db.close()
        plugin._ACTIVE = None
        await asyncio.to_thread(self.server.shutdown)
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def event(self, number=1, attachment=False):
        return {"update_id": number, "channel": "chan", "sender": {"id": "actor"}, "chat": {"id": "group", "kind": "group"},
                "message": {"id": "source", "text": "hello", **({"attachment": {"id": "file"}} if attachment else {})}}

    def active(self):
        self.adapter.current = {"id": 1, "parts": 0, "bytes": 0, "failed": False, "final": False, "done": asyncio.Event()}
        self.adapter.journal.begin(1, "fixture")

    async def test_dispatch_gateway_then_persist_deliver_ack_in_order(self):
        await self.adapter.ingest(self.event())
        ops = [call["op"] for call in Fixture.calls]
        self.assertLess(ops.index("bot_reply"), ops.index("bot_ack"))
        self.assertEqual(self.adapter.journal.begin(1, plugin.digest(self.event())), "ACKED")
        outputs = self.adapter.journal.db.execute("SELECT payload,delivered FROM parts").fetchall()
        self.assertEqual(len(outputs), 1)
        self.assertEqual(outputs[0][1], 1)
        await self.adapter.ingest(self.event())
        self.assertEqual(len(Fixture.outputs), 1)

    async def test_native_voice_only_final_boundary_ack(self):
        self.adapter.fixture_voice_only = True
        self.adapter.fixture_media = self.artifacts / "voice.ogg"
        self.adapter.fixture_media.write_bytes(b"OggSfixture")
        await self.adapter.ingest(self.event())
        self.assertTrue(any(call["op"] == "bot_ack" for call in Fixture.calls))
        self.assertEqual(next(iter(Fixture.outputs.values()))["attachment"]["mime"], "audio/ogg")

    async def test_trailing_media_failure_does_not_ack_even_after_final_text(self):
        self.adapter.fixture_trailing_media = self.root / "secret.env"
        self.adapter.fixture_trailing_media.write_bytes(b"token")
        with self.assertRaises(plugin.SafetyError):
            await self.adapter.ingest(self.event())
        self.assertFalse(any(call["op"] == "bot_ack" for call in Fixture.calls))
        self.assertEqual(self.adapter.journal.begin(1, plugin.digest(self.event())), "UNCERTAIN")
        self.assertTrue(self.adapter._halted)

    async def test_turn_failure_not_acknowledged(self):
        self.adapter.fixture_error = True
        with self.assertRaises(plugin.SafetyError):
            await self.adapter.ingest(self.event())
        self.assertFalse(any(call["op"] == "bot_ack" for call in Fixture.calls))

    async def test_auth_before_download_and_path_is_uuid_sniffed(self):
        await self.adapter.ingest(self.event(attachment=True))
        ops = [call["op"] for call in Fixture.calls]
        self.assertLess(ops.index("bot_authorize_update"), ops.index("bot_attachment_file"))
        files = list((self.root / "inbound").iterdir())
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].suffix, ".png")
        self.assertEqual(len(files[0].stem), 32)

    async def test_untrusted_input_no_download_no_gateway(self):
        Fixture.trusted = False
        with self.assertRaises(plugin.SafetyError):
            await self.adapter.ingest(self.event(attachment=True))
        self.assertFalse(any(call["op"] in ("bot_attachment_file", "bot_reply", "bot_ack") for call in Fixture.calls))
        self.assertFalse(hasattr(self.adapter, "background"))

    async def test_forged_scope_rejected(self):
        event = self.event()
        event["sender"] = {"id": "other"}
        with self.assertRaises(plugin.SafetyError):
            await self.adapter.ingest(event)
        self.assertFalse(any(call["op"] == "bot_reply" for call in Fixture.calls))

    async def test_each_tool_fresh_auth_revoke_blocks(self):
        self.active()
        self.assertIsNone(plugin.pre_tool_call(tool_name="terminal", args={}))
        Fixture.trusted = False
        self.assertEqual(plugin.pre_tool_call(tool_name="read_file", args={})["action"], "block")
        plugin._ACTIVE = None
        self.assertEqual(plugin.pre_tool_call(tool_name="memory", args={})["action"], "block")

    async def test_unicode_parts_and_budget_no_truncation(self):
        self.active()
        result = await self.adapter.send("chan", "🙂" * 4001)
        self.assertTrue(result.success)
        parts = list(Fixture.outputs.values())
        self.assertEqual([len(v["text"]) for v in parts], [2000, 2000, 1])
        self.assertEqual("".join(v["text"] for v in parts), "🙂" * 4001)
        failed = await self.adapter.send("chan", "x" * 64000)
        self.assertFalse(failed.success)
        self.assertEqual(len(Fixture.outputs), 3)

    async def test_media_modalities_outbound_and_url_rejected(self):
        self.active()
        for method, suffix, data in (("send_image", ".png", b"\x89PNG\r\n\x1a\nx"), ("send_animation", ".gif", b"GIF89ax"),
                                      ("send_video", ".mp4", b"\x00\x00\x00\x18ftypisom"), ("send_voice", ".ogg", b"OggSx"),
                                      ("send_document", ".pdf", b"%PDF-1.7")):
            file = self.artifacts / (method + suffix)
            file.write_bytes(data)
            result = await getattr(self.adapter, method)("chan", str(file))
            self.assertTrue(result.success, result.error)
        before = len(Fixture.outputs)
        failed = await self.adapter.send_image("chan", "http://169.254.169.254/latest/meta-data")
        self.assertFalse(failed.success)
        self.assertIn("unsupported", failed.error)
        self.assertEqual(len(Fixture.outputs), before)

    async def test_edit_delete_typing_invocation_bound(self):
        self.active()
        sent = await self.adapter.send("chan", "initial")
        self.assertTrue((await self.adapter.edit_message("chan", sent.message_id, "changed")).success)
        self.assertTrue(await self.adapter.delete_message("chan", sent.message_id))
        await self.adapter.send_typing("chan")
        await self.adapter.stop_typing("chan")
        edited = next(v for v in Fixture.calls if v["op"] == "bot_edit")
        self.assertEqual(edited["revision"], 1)
        self.assertNotIn("channel", edited)
        with self.assertRaises(plugin.SafetyError):
            await self.adapter.send_typing("different-channel")

    async def test_native_help_reset_start_use_gateway_control_and_inline_completion(self):
        self.adapter.fixture_inline = True
        for number, text, expected in ((1, "/help@hermes", "/help"), (2, "/reset@hermes", "/reset"), (3, "/start@hermes", "/help")):
            event = self.event(number)
            event["message"]["text"] = text
            await self.adapter.ingest(event)
            self.assertTrue(self.adapter.last_event.allow_gateway_control)
            self.assertEqual(self.adapter.last_event.text, expected)
            self.assertEqual(self.adapter.journal.begin(number, plugin.digest(event)), "ACKED")

    async def test_plaintext_and_ask_do_not_enable_generic_gateway_controls(self):
        event = self.event()
        event["message"]["text"] = "/ask@hermes explain /approve safely"
        await self.adapter.ingest(event)
        self.assertFalse(self.adapter.last_event.allow_gateway_control)
        self.assertEqual(self.adapter.last_event.text, "explain /approve safely")
        self.assertEqual(plugin.SombraAdapter.classify_text(self.event())[0], "text")

    async def test_generic_approval_and_admin_commands_never_enter_gateway(self):
        for number, text in enumerate(("/approve@hermes", "/always", "/deny", "/restart", "/update", "/yolo", "/approve yes\nmore text"), 1):
            event = self.event(number)
            event["message"]["text"] = text
            await self.adapter.ingest(event)
        self.assertFalse(hasattr(self.adapter, "background"))
        self.assertFalse(any(v["op"] == "runtime_begin_invocation" for v in Fixture.calls))

    async def test_slash_confirm_once_exact_pending_none_is_not_approved(self):
        self.active()
        slash = types.ModuleType("tools.slash_confirm")
        pending = {"confirm_id": "confirm-one", "handler": object()}
        slash.clear_if_stale = lambda session: False
        slash.get_pending = lambda session: pending if pending else None
        calls = []
        async def resolve(session, confirm_id, choice):
            calls.append((session, confirm_id, choice))
            pending.clear()
            return None
        slash.resolve = resolve
        tools = types.ModuleType("tools")
        tools.slash_confirm = slash
        with patch.dict(sys.modules, {"tools": tools, "tools.slash_confirm": slash}):
            prompt_task = asyncio.create_task(self.adapter.send_slash_confirm("chan", "Confirm", "Scoped action", "session", "confirm-one"))
            async def wait_prompt():
                while not self.adapter._prompts:
                    await asyncio.sleep(0.01)
            await asyncio.wait_for(wait_prompt(), 2)
            nonce = next(iter(self.adapter._prompts))
            callback = self.event(2)
            callback["message"]["text"] = "/sombra-confirm@hermes " + nonce + " always"
            self.assertFalse(await self.adapter.handle_control(callback))
            callback["message"]["text"] = "/sombra-confirm@hermes " + nonce + " once"
            self.assertTrue(await self.adapter.handle_control(callback))
            self.assertEqual(calls, [("session", "confirm-one", "once")])
            result = await asyncio.wait_for(prompt_task, 2)
            self.assertTrue(result.success, result.error)
            status = [v["text"] for v in Fixture.outputs.values() if v["update_id"] == 2]
            self.assertIn("результат не подтверждён", "".join(status))
            self.assertNotIn("Approved", "".join(status))
            self.assertFalse(await self.adapter.handle_control(callback))

    async def test_delayed_message_reference_cannot_mutate_new_invocation(self):
        self.active()
        first = await self.adapter.send("chan", "initial")
        self.adapter.current["id"] = 2
        self.adapter.journal.begin(2, "second")
        self.assertFalse(await self.adapter.delete_message("chan", first.message_id))
        self.assertFalse(any(v["op"] == "bot_delete" for v in Fixture.calls))

    async def test_changed_policy_revision_rejects_midturn_send(self):
        self.active()
        canonical = await self.adapter._authorize()
        self.adapter.current["canonical"] = plugin.digest(canonical)
        Fixture.changed = True
        result = await self.adapter.send("chan", "should not leave compartment")
        self.assertFalse(result.success)
        self.assertFalse(any(v["op"] == "bot_reply" for v in Fixture.calls))

    async def test_delivery_failure_no_retry_new_key(self):
        self.active()
        Fixture.fail_delivery = True
        self.assertFalse((await self.adapter.send("chan", "answer")).success)
        self.assertFalse((await self.adapter.send("chan", "answer")).success)
        self.assertEqual(sum(v["op"] == "bot_reply" for v in Fixture.calls), 1)
        row = self.adapter.journal.db.execute("SELECT payload,delivered FROM parts").fetchone()
        self.assertEqual(json.loads(row[0])["text"], "answer")
        self.assertEqual(row[1], 0)

    async def test_poll_continues_for_control_while_native_turn_waits(self):
        approvals = types.ModuleType("tools.approval")
        approvals.list_gateway_approvals = lambda session: [{"request_id": "poll-request"}]
        self.adapter.fixture_prompt = True
        self.adapter.fixture_approval_event = asyncio.Event()
        approvals.resolve_gateway_approval = lambda session, choice, **kwargs: self.adapter.fixture_approval_event.set() or 1
        self.adapter._connected = True
        self.adapter._invocation_task = None
        Fixture.events = [self.event()]
        with patch.dict(sys.modules, {"tools.approval": approvals}):
            poll = asyncio.create_task(self.adapter._poll())
            try:
                acked = await asyncio.wait_for(asyncio.to_thread(Fixture.original_acked.wait, 8), 9)
                self.assertTrue(acked, "Polling deadlocked while SDK prompt was waiting")
                if self.adapter._invocation_task:
                    await self.adapter._invocation_task
                self.assertIn(2, Fixture.acked)
                self.assertEqual(sum(v["op"] == "runtime_begin_invocation" for v in Fixture.calls), 1)
                self.assertEqual(sum(v["op"] == "runtime_end_invocation" for v in Fixture.calls), 1)
                if self.adapter._invocation_task:
                    await self.adapter._invocation_task
            finally:
                self.adapter._connected = False
                poll.cancel()
                try:
                    await poll
                except asyncio.CancelledError:
                    pass

    async def test_native_slash_render_returns_but_original_ack_waits_disposition(self):
        slash = types.ModuleType("tools.slash_confirm")
        pending = {"confirm_id": "confirm-poll", "handler": object()}
        slash.clear_if_stale = lambda session: False
        slash.get_pending = lambda session: pending if pending else None
        async def resolve(session, confirm_id, choice):
            await asyncio.sleep(0.01)
            pending.clear()
            return None
        slash.resolve = resolve
        slash.clear = lambda session: pending.clear()
        tools = types.ModuleType("tools")
        tools.slash_confirm = slash
        self.adapter.fixture_slash = True
        self.adapter._connected = True
        self.adapter._invocation_task = None
        Fixture.events = [self.event()]
        with patch.dict(sys.modules, {"tools": tools, "tools.slash_confirm": slash}):
            poll = asyncio.create_task(self.adapter._poll())
            try:
                acked = await asyncio.wait_for(asyncio.to_thread(Fixture.original_acked.wait, 8), 9)
                self.assertTrue(acked, "Slash control deadlocked after immediate SDK render")
                if self.adapter._invocation_task:
                    await self.adapter._invocation_task
                ack_order = [call["update_id"] for call in Fixture.calls if call["op"] == "bot_ack"]
                self.assertEqual(ack_order, [2, 1])
                self.assertFalse(pending)
            finally:
                self.adapter._connected = False
                poll.cancel()
                try:
                    await poll
                except asyncio.CancelledError:
                    pass

    async def test_strict_exec_nonce_exact_sdk_request_no_replay(self):
        self.active()
        approvals = types.ModuleType("tools.approval")
        approvals.list_gateway_approvals = lambda session: [{"request_id": "request-one", "command": "unredacted"}]
        resolved = []
        approvals.resolve_gateway_approval = lambda session, choice, **kwargs: resolved.append((session, choice, kwargs)) or 1
        prompt = types.SimpleNamespace(chat_id="chan", session_key="session-one", text="Execute redacted command?", actions=[("Once", "once", "primary"), ("Deny", "deny", "danger")], command="REDACTED", metadata={})
        with patch.dict(sys.modules, {"tools.approval": approvals}):
            result = await self.adapter._send_exec_approval_prompt(prompt)
            self.assertTrue(result.success, result.error)
            nonce = next(iter(self.adapter._prompts))
            callback = self.event(2)
            callback["message"]["text"] = "/sombra-confirm@hermes " + nonce + " once"
            self.assertTrue(await self.adapter.handle_control(callback))
            self.assertEqual(resolved, [("session-one", "once", {"request_id": "request-one"})])
            self.assertFalse(await self.adapter.handle_control(callback))
            self.assertEqual(len(resolved), 1)
            self.assertEqual(self.adapter.journal.db.execute("SELECT consumed FROM prompts").fetchone()[0], 1)

    async def test_approval_ambiguous_sdk_queue_fails_closed(self):
        self.active()
        approvals = types.ModuleType("tools.approval")
        approvals.list_gateway_approvals = lambda session: [{"request_id": "one"}, {"request_id": "two"}]
        prompt = types.SimpleNamespace(chat_id="chan", session_key="session", text="cmd", actions=[("Once", "once", "primary")], command="REDACTED", metadata={})
        with patch.dict(sys.modules, {"tools.approval": approvals}):
            self.assertFalse((await self.adapter._send_exec_approval_prompt(prompt)).success)
        self.assertFalse(self.adapter._prompts)

    async def test_clarify_nonce_actor_expiry_and_resolver_false(self):
        self.active()
        clarify = types.ModuleType("tools.clarify_gateway")
        entry = types.SimpleNamespace(session_key="session", question="Pick", choices=["A", "B"])
        clarify.get_pending = lambda clarify_id: entry
        responses = []
        clarify.resolve_gateway_clarify = lambda clarify_id, response: responses.append((clarify_id, response)) or True
        with patch.dict(sys.modules, {"tools.clarify_gateway": clarify}):
            self.assertTrue((await self.adapter.send_clarify("chan", "Pick", ["A", "B"], "clarify-one", "session")).success)
            nonce = next(iter(self.adapter._prompts))
            callback = self.event(2)
            callback["message"]["text"] = "@hermes /sombra-answer " + nonce + " 2"
            callback["sender"] = {"id": "other"}
            self.assertFalse(await self.adapter.handle_control(callback))
            callback["sender"] = {"id": "actor"}
            self.assertTrue(await self.adapter.handle_control(callback))
            self.assertEqual(responses, [("clarify-one", "B")])
            self.assertTrue((await self.adapter.send_clarify("chan", "Pick", ["A", "B"], "clarify-two", "session")).success)
            nonce = next(iter(self.adapter._prompts))
            self.adapter._prompts[nonce]["expires"] = 0
            callback["message"]["text"] = "/sombra-answer@hermes " + nonce + " A"
            self.assertFalse(await self.adapter.handle_control(callback))
            self.assertEqual(len(responses), 1)

    async def test_unknown_control_never_dispatched_as_ai(self):
        callback = self.event(3)
        callback["message"]["text"] = "/sombra-confirm@hermes " + "0" * 32 + " once"
        await self.adapter.ingest(callback)
        self.assertFalse(hasattr(self.adapter, "background"))
        self.assertTrue(any(v["op"] == "bot_ack" for v in Fixture.calls))
        self.assertFalse(any(v["op"] == "runtime_begin_invocation" for v in Fixture.calls))

    async def test_prompt_hooks_deny_without_autoapproval(self):
        self.assertFalse((await self.adapter._send_exec_approval_prompt(object())).success)
        self.assertFalse((await self.adapter.send_clarify("chan", "question", None, "", "")).success)


if __name__ == "__main__":
    unittest.main()
