"""Offline native capability contracts. No SDK install, host config or model calls."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "sombra_native_fixture"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package
shared = types.ModuleType(PACKAGE + ".shared_host")
sys.modules[shared.__name__] = shared
spec = importlib.util.spec_from_file_location(PACKAGE + ".native_tools", ROOT / "native_tools.py")
native = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = native
spec.loader.exec_module(native)


class Broker:
    def __init__(self):
        self.calls = []
        self.owner = True
        self.revision = 1
        self.profile = {"name": "Сомбра", "bio": "original", "avatar": ""}
        self.conversation = {"mode": "addressed", "reactions": True}
        self.reactions = set()

    async def acall(self, op, **args):
        self.calls.append((op, args))
        if args["update_id"] != 42:
            raise ValueError("wrong original source")
        if op == "bot_react":
            if args["enabled"]:
                self.reactions.add(args["emoji"])
            else:
                self.reactions.discard(args["emoji"])
            return {"reactions": list(self.reactions)}
        if not self.owner:
            raise ValueError("BOT_SETTINGS_FORBIDDEN secret-token-never-return")
        if op == "bot_update_self":
            if args["revision"] != self.revision:
                raise ValueError("BOT_SETTINGS_CONFLICT")
            self.profile.update(args.get("profile", {}))
            self.conversation.update(args.get("conversation", {}))
            self.revision += 1
        return {"profile": dict(self.profile), "conversation": dict(self.conversation),
                "revision": self.revision, "token": "private-secret", "bot": {"token": "private-secret"}}


class NativeContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        profile = self.root / "sombra"
        profile.mkdir(mode=0o700)
        self.soul = profile / "SOUL.md"
        self.soul.write_text("Original persona", encoding="utf-8")
        self.soul.chmod(0o600)
        self.broker = Broker()
        self.authorizations = 0
        self.revoked_at = None
        async def authorize():
            self.authorizations += 1
            if self.revoked_at and self.authorizations >= self.revoked_at:
                raise ValueError("revoked")
            return {"update_id": 42, "sender": {"id": "owner"}}
        artifacts = self.root / "artifacts"
        artifacts.mkdir()
        self.scope = {"artifact_roots": [artifacts]}
        self.adapter = types.SimpleNamespace(profile="sombra", env={"SOMBRA_PROFILE_ROOT": str(profile)},
            current={"id": 42}, broker=self.broker, _authorize=authorize,
            _scope=lambda: self.scope, state_dir=self.root)
        shared.get_current_adapter = lambda: self.adapter

    async def asyncTearDown(self):
        self.temp.cleanup()

    async def test_registration_contract_and_non_sombra_fail_closed(self):
        captured = {}
        class Context:
            def register_tool(self, name, toolset, schema, handler, check_fn=None, requires_env=None,
                              is_async=False, description="", emoji="", override=False):
                self_outer.assertEqual(toolset, "sombra")
                self_outer.assertTrue(is_async)
                self_outer.assertFalse(schema["parameters"]["additionalProperties"])
                captured[name] = handler
        self_outer = self
        native.register(Context())
        self.assertEqual(set(captured), {"sombra_react", "sombra_bot_settings", "sombra_personality"})
        def absent():
            raise ValueError("Not Sombra secret")
        shared.get_current_adapter = absent
        for name, args in (("sombra_react", {"emoji": "👍"}), ("sombra_bot_settings", {"action": "get"}),
                           ("sombra_personality", {"action": "get"})):
            result = json.loads(await captured[name](args))
            self.assertIn("error", result)
            self.assertNotIn("secret", str(result))
        self.assertEqual(self.broker.calls, [])

    async def test_reaction_original_id_idempotence_and_arbitrary_target(self):
        for _ in range(2):
            await native.react({"emoji": "👍"})
        self.assertEqual(self.broker.reactions, {"👍"})
        self.assertEqual(self.broker.calls[-1], ("bot_react", {"update_id": 42, "emoji": "👍", "enabled": True}))
        await native.react({"emoji": "👍", "enabled": False})
        self.assertEqual(self.broker.reactions, set())
        for args in ({"emoji": "👍", "message_id": "other"}, {"emoji": "🤡"}, {"emoji": "👍", "enabled": 1}):
            with self.assertRaises(ValueError):
                await native.react(args)

    async def test_server_owner_dm_gate_not_local_trust_or_same_name(self):
        for identity in ("sameName", "trusted", "admin", "ownerGroup", "threeMemberDM"):
            self.broker.owner = False
            self.adapter.actor = identity
            self.adapter.trusted = True
            for operation in (lambda: native.settings({"action": "get"}),
                              lambda: native.personality({"action": "get"}),
                              lambda: native.personality({"action": "set", "text": "changed"})):
                with self.assertRaises(ValueError):
                    await operation()
            response = await native.settings_response(self.adapter)
            self.assertEqual(response["text"], native.OWNER_ONLY)
        self.assertEqual(self.soul.read_text(encoding="utf-8"), "Original persona")

    async def test_cas_partial_preserves_fields_no_retry_no_secret(self):
        result = await native.settings({"action": "update", "revision": 1, "profile": {"name": "New"}})
        self.assertEqual(result["profile"]["bio"], "original")
        self.assertNotIn("private-secret", str(result))
        with self.assertRaises(ValueError):
            await native.settings({"action": "update", "revision": 1, "profile": {"bio": "lost"}})
        self.assertEqual(self.broker.profile["bio"], "original")
        self.assertEqual(sum(op == "bot_update_self" for op, _ in self.broker.calls), 2)

    async def test_soul_only_exact_path_bounded_utf8_nul_and_no_root_changes(self):
        other = self.root / "SOUL.md"
        other.write_text("Private Telegram", encoding="utf-8")
        for text in ("\0", "я" * 16385, "\ud800"):
            with self.assertRaises((ValueError, UnicodeError)):
                await native.personality({"action": "set", "text": text})
        for data in (b"\xff", b"a\x00b", b"x" * 32769):
            self.soul.write_bytes(data)
            with self.assertRaises((ValueError, UnicodeError)):
                await native.personality({"action": "get"})
        self.adapter.env["SOMBRA_SOUL_FILE"] = str(other)
        with self.assertRaises(ValueError):
            await native.personality({"action": "get"})
        self.assertEqual(other.read_text(encoding="utf-8"), "Private Telegram")

    async def test_soul_atomic_failure_and_revoke_preserve_baseline(self):
        with patch.object(native.os, "replace", side_effect=OSError("atomic failure")):
            with self.assertRaises(OSError):
                await native.personality({"action": "set", "text": "new"})
        self.assertEqual(self.soul.read_text(encoding="utf-8"), "Original persona")
        self.assertEqual(list(self.soul.parent.glob(".soul-*")), [])
        self.authorizations = 0
        self.revoked_at = 2
        with self.assertRaises(ValueError):
            await native.personality({"action": "set", "text": "revoked"})
        self.assertEqual(self.soul.read_text(encoding="utf-8"), "Original persona")
        self.revoked_at = None
        result = await native.personality({"action": "set", "text": "Новая личность"})
        self.assertTrue(result["requires_new_session"])
        self.assertEqual(self.soul.read_text(encoding="utf-8"), "Новая личность")

    async def test_staged_avatar_only_scope_and_bounds(self):
        image = self.root / "artifacts" / "image.png"
        image.write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        self.adapter.current["native_avatar_inputs"] = [{"update_id": 42, "path": str(image)}]
        await native.settings({"action": "update", "revision": 1, "profile": {"avatar_index": 0}})
        self.assertTrue(self.broker.profile["avatar"].startswith("data:image/png;base64,"))
        for profile in ({"avatar": "data:image/png;base64,xxx"}, {"avatar_index": "0"}, {"avatar_index": 1}, {"path": str(image)}):
            with self.assertRaises(ValueError):
                await native.settings({"action": "update", "revision": 2, "profile": profile})
        image.write_bytes(b"x" * 262145)
        with self.assertRaises(native.AvatarInputError):
            native._avatar(self.adapter, 0)
        self.adapter.current["native_avatar_inputs"][0]["path"] = str(self.soul)
        with self.assertRaises(ValueError):
            native._avatar(self.adapter, 0)

    async def test_symlinks_rejected(self):
        target = self.root / "target"
        target.write_text("secret", encoding="utf-8")
        link = self.root / "link"
        try:
            link.symlink_to(target)
        except OSError:
            self.skipTest("Host denies symlink creation")
        with self.assertRaises(ValueError):
            native._safe_path(link)


if __name__ == "__main__":
    unittest.main()
