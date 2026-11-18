"""Offline contracts for the Sombra frame/cover skill.

Deterministic intent, the mirrored server whitelists, the durable one-shot confirmation and
the honest refusal paths. The HTTP fixture is the same offline server double the shared-host
contracts use; no provider, model, backend or installed Hermes is called.
"""
import asyncio
import importlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import time
import types
import unittest
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import test_shared_host as base
import test_plugin as fixtures

ROOT = base.ROOT
shared = base.shared
decorations = importlib.import_module(base.PACKAGE + ".decorations")


class FrameSkill(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        fixture = fixtures.Fixture
        fixture.calls, fixture.outputs, fixture.events, fixture.acked = [], {}, [], set()
        fixture.canonicals, fixture.envelope = {}, True
        fixture.trusted, fixture.changed, fixture.fail_delivery = True, False, False
        fixture.original_acked = threading.Event()
        fixture.model_settings = {"model": "", "reasoning": "", "revision": 0,
                                  "modelDefault": True, "reasoningDefault": True}
        fixture.registration_supported, fixture.fail_get_me = False, False
        fixture.owner_settings_error, fixture.owner_consumed = "", set()
        fixture.typing_calls, fixture.typing_reject = [], False
        fixture.decoration_error, fixture.decoration_consumed = "", set()
        fixture.decorations, fixture.user_decorations = [], {}
        fixture.decoration_response_user = None
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
        fixtures.Fixture.decoration_error, fixtures.Fixture.decoration_consumed = "", set()
        fixtures.Fixture.decorations, fixtures.Fixture.user_decorations = [], {}
        fixtures.Fixture.decoration_response_user = None
        self.source_patch.stop()
        self.environment.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    # -- helpers -----------------------------------------------------------
    def event(self, number, actor="actor-a", channel="chan-a", trusted=True, text="question"):
        canonical = {"update_id": number, "bot_id": "bot", "channel": channel,
                     "sender": {"id": actor}, "chat": {"id": "group"},
                     "access": {"trusted": trusted, "policy_revision": 1}}
        fixtures.Fixture.canonicals[number] = canonical
        return {"update_id": number, "channel": channel, "sender": {"id": actor},
                "chat": {"id": "group", "kind": "group"},
                "message": {"id": "message-" + str(number), "text": text}}, canonical

    def open_scope(self, actor="actor-a", channel="chan-a", trusted=True):
        _, canonical = self.event(0, actor, channel, trusted)
        _, scope = self.adapter._new_scope(canonical)
        scope["trusted"] = trusted
        return scope

    async def run_turn(self, number, text, actor="actor-a", channel="chan-a", trusted=True):
        event, canonical = self.event(number, actor, channel, trusted, text)
        _, scope = self.adapter._new_scope(canonical)
        await self.adapter._run_scope(scope, event, canonical)
        return self.reply(number)

    def reply(self, number):
        payload = fixtures.Fixture.outputs.get((number, "part_00"))
        self.assertIsNotNone(payload, "no durable reply part for update " + str(number))
        return payload["text"]

    def nonce(self, number):
        match = re.search(r"confirm ([0-9a-f]{32})", self.reply(number))
        self.assertIsNotNone(match, "proposal did not carry an exact nonce command")
        return match.group(1)

    def decoration_calls(self):
        return [call for call in fixtures.Fixture.calls if call["op"] == "bot_set_user_decoration"]

    # -- proposal + confirmation ------------------------------------------
    async def test_proposal_changes_nothing_and_issues_an_exact_nonce_command(self):
        scope = self.open_scope()
        text = await self.run_turn(1, "сделай мне огненную рамку")
        self.assertEqual(self.decoration_calls(), [])
        self.assertEqual(fixtures.Fixture.user_decorations, {})
        self.assertIn("«Пламенный обод»", text)
        self.assertIn("Профиль пока не изменён", text)
        self.assertIn("5 минут", text)
        nonce = self.nonce(1)
        self.assertRegex(nonce, r"^[0-9a-f]{32}$")
        self.assertNotIn("sombra_scope_test", text)
        self.assertNotIn("http", text)
        row = scope["journal"].db.execute(
            "SELECT actor,channel,target,doc,expires,consumed FROM decorations WHERE nonce=?", (nonce,)).fetchone()
        self.assertEqual(row[0], "actor-a")
        self.assertEqual(row[1], "chan-a")
        self.assertEqual(row[2], "avatar")
        self.assertEqual(row[5], 0)  # proposed, not consumed
        self.assertGreater(row[4], time.time())
        self.assertEqual(json.loads(row[3])["layers"][0]["effect"], "holy/divine-shield")
        self.assertIn(1, fixtures.Fixture.acked)

    async def test_poll_path_answers_locally_without_an_sdk_or_model_turn(self):
        self.adapter._connected = True
        event, canonical = self.event(1, text="/frame ember")
        fixtures.Fixture.events = [event]
        task = asyncio.create_task(self.adapter._poll())
        try:
            for _ in range(250):
                if 1 in fixtures.Fixture.acked:
                    break
                await asyncio.sleep(0.02)
        finally:
            self.adapter._connected = False
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            fixtures.Fixture.events = []
        self.assertIn(1, fixtures.Fixture.acked)
        self.assertIn("confirm", self.reply(1))
        self.assertFalse(hasattr(self.adapter, "last_event"))  # never dispatched to the SDK
        self.assertEqual(self.decoration_calls(), [])

    async def test_confirm_applies_once_with_the_confirming_update_id_and_burns_the_nonce(self):
        scope = self.open_scope()
        await self.run_turn(1, "поставь слайм на аватар")
        nonce = self.nonce(1)
        text = await self.run_turn(2, "/frame confirm " + nonce)
        calls = self.decoration_calls()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], {"op": "bot_set_user_decoration", "update_id": 2, "target": "avatar",
                                    "decoration": {"v": 1, "target": "avatar", "seed": 7, "layers": [
                                        {"effect": "critters/slime", "palette": "poison",
                                         "anchor": "bottom-right", "intensity": 0.85}]}})
        self.assertIn("Рамка применена", text)
        self.assertIn("«Слайм-питомец»", text)
        self.assertNotIn("Профиль не изменён", text)
        self.assertNotIn("Пламенный обод", text)
        self.assertEqual(fixtures.Fixture.user_decorations["avatar"]["layers"][0]["effect"], "critters/slime")
        row = scope["journal"].db.execute("SELECT consumed FROM decorations WHERE nonce=?", (nonce,)).fetchone()
        self.assertEqual(row[0], 1)
        # The same nonce is dead: no second write, honest refusal.
        replay = await self.run_turn(3, "/frame confirm " + nonce)
        self.assertEqual(len(self.decoration_calls()), 1)
        self.assertIn("недействительно", replay)
        self.assertIn("Профиль не изменён", replay)
        self.assertEqual(len(fixtures.Fixture.decorations), 1)
        self.assertEqual(sorted(fixtures.Fixture.acked), [1, 2, 3])

    async def test_foreign_actor_or_channel_expired_and_replayed_nonces_never_call_the_server(self):
        scope = self.open_scope()
        await self.run_turn(1, "/frame ember")
        nonce = self.nonce(1)
        # Same nonce presented from another actor/channel scope: nothing exists there to consume.
        foreign = await self.run_turn(2, "/frame confirm " + nonce, actor="actor-b", channel="chan-b", trusted=False)
        self.assertEqual(self.decoration_calls(), [])
        self.assertIn("недействительно", foreign)
        # Expired proposal in the owning scope.
        await self.run_turn(3, "/frame ember")
        expired = self.nonce(3)
        scope["journal"].db.execute("UPDATE decorations SET expires=? WHERE nonce=?", (time.time() - 1, expired))
        scope["journal"].db.commit()
        stale = await self.run_turn(4, "/frame confirm " + expired)
        self.assertEqual(self.decoration_calls(), [])
        self.assertIn("недействительно", stale)
        # Store-level atomic checks: wrong actor/channel never consumes, expiry is enforced.
        store = decorations.DecorationRequests(scope["journal"].db)
        document = decorations.preset_document("ember-crown")
        fresh, _ = store.propose("actor-a", "chan-a", "avatar", document, "Пламенный обод")
        self.assertIsNone(store.take(fresh, "actor-b", "chan-a"))
        self.assertIsNone(store.take(fresh, "actor-a", "chan-b"))
        self.assertIsNone(store.take(fresh, "actor-a", "chan-a", now=time.time() + 10_000))
        self.assertEqual(store.row(fresh)["consumed"], 0)
        self.assertIsNotNone(store.take(fresh, "actor-a", "chan-a"))
        self.assertIsNone(store.take(fresh, "actor-a", "chan-a"))
        self.assertEqual(store.row(fresh)["consumed"], 1)
        self.assertEqual(self.decoration_calls(), [])

    async def test_removal_commands_send_a_null_decoration_for_that_target(self):
        self.open_scope()
        first = await self.run_turn(1, "убери рамку")
        self.assertIn("удаление рамки", first)
        await self.run_turn(2, "/frame confirm " + self.nonce(1))
        second = await self.run_turn(3, "/frame remove cover")
        self.assertIn("удаление обложки", second)
        await self.run_turn(4, "/frame confirm " + self.nonce(3))
        calls = self.decoration_calls()
        self.assertEqual([(call["target"], call["decoration"]) for call in calls],
                         [("avatar", None), ("cover", None)])
        self.assertIn("убрана", self.reply(2).lower())
        self.assertIn("Профиль обновлён", self.reply(2))
        self.assertIn("убрана", self.reply(4).lower())
        self.assertEqual(fixtures.Fixture.user_decorations, {})

    # -- validation / hints ------------------------------------------------
    async def test_unsupported_effects_and_invalid_documents_are_hints_without_a_call(self):
        scope = self.open_scope()
        cases = {
            1: "сделай радужную рамку",
            2: "сделай огненную обложку",
            3: "/frame json " + json.dumps({"v": 1, "target": "avatar",
                                            "layers": [{"effect": "weather/aurora"}]}),
            4: "/frame json " + json.dumps({"v": 1, "target": "avatar",
                                            "layers": [{"effect": "critters/slime"}] * 4}),
            5: "/frame json " + json.dumps({"v": 1, "target": "avatar", "seed": -1,
                                            "layers": [{"effect": "critters/slime"}]}),
            6: "/frame json " + json.dumps({"v": 1, "target": "avatar",
                                            "layers": [{"effect": "critters/slime", "palette": "#fff"}]}),
            7: "/frame nonsense",
            8: "/frame confirm not-a-nonce",
        }
        for number, text in cases.items():
            with self.subTest(text=text):
                reply = await self.run_turn(number, text)
                self.assertIn("Профиль не изменён", reply)
                self.assertNotIn("Рамка применена", reply)
                self.assertIn("ember", reply)  # the hint lists what is available
        self.assertEqual(self.decoration_calls(), [])
        table = scope["journal"].db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='decorations'").fetchone()
        if table:
            count = scope["journal"].db.execute("SELECT count(*) FROM decorations").fetchone()[0]
            self.assertEqual(count, 0)
        help_text = await self.run_turn(9, "/frame")
        self.assertIn("Пресеты", help_text)
        self.assertIn("runner", help_text)
        self.assertEqual(self.decoration_calls(), [])

    async def test_an_answer_for_another_profile_is_never_claimed_as_success(self):
        self.open_scope()
        await self.run_turn(1, "/frame ember")
        fixtures.Fixture.decoration_response_user = "someone-else"
        reply = await self.run_turn(2, "/frame confirm " + self.nonce(1))
        self.assertIn("проверьте", reply)
        self.assertNotIn("Рамка применена", reply)
        self.assertNotIn("Профиль не изменён", reply)
        # Exactly one write happened: the one-shot marker may already be consumed, so no retry.
        self.assertEqual(len(self.decoration_calls()), 1)

    async def test_server_refusals_are_honest_and_never_escape_the_turn(self):
        expected = {"BOT_DECORATION_CONFLICT": ("уже применено", "заново"),
                    "BOT_DECORATION_FORBIDDEN": ("отклонил",),
                    "BOT_DECORATION_INVALID": ("отклонил документ",),
                    "BOT_SOURCE_UNAVAILABLE": ("не активно",)}
        for number, (code, phrases) in enumerate(expected.items(), 1):
            with self.subTest(code=code):
                await self.run_turn(number * 2 - 1, "/frame ember")
                fixtures.Fixture.decoration_error = code
                reply = await self.run_turn(number * 2, "/frame confirm " + self.nonce(number * 2 - 1))
                for phrase in (*phrases, "Профиль не изменён"):
                    self.assertIn(phrase, reply)
                self.assertNotIn("Рамка применена", reply)
                self.assertNotIn("sombra_scope_test", reply)
                self.assertIn(number * 2, fixtures.Fixture.acked)
        self.assertEqual(fixtures.Fixture.decorations, [])

    async def test_a_broken_broker_is_reported_without_raising(self):
        self.open_scope()
        await self.run_turn(1, "/frame ember")
        nonce = self.nonce(1)
        original = self.adapter.broker.call

        def flaky(op, **args):
            if op == "bot_set_user_decoration":
                raise RuntimeError("transport down")
            return original(op, **args)

        with patch.object(self.adapter.broker, "call", side_effect=flaky):
            reply = await self.run_turn(2, "/frame confirm " + nonce)
        self.assertIn("Профиль не изменён", reply)
        self.assertNotIn("Рамка применена", reply)
        self.assertNotIn("transport down", reply)
        self.assertEqual(self.decoration_calls(), [])

    # -- deterministic parsing and whitelists -------------------------------
    def test_required_phrases_map_to_the_expected_presets_and_ignore_plain_chat(self):
        expected = {
            "сделай мне огненную рамку": ("ember-crown", "avatar"),
            "поставь слайм на аватар": ("slime-pet", "avatar"),
            "сделай обложку с бегущим героем": ("runner-cover", "cover"),
            "сделай сияние на обложку": ("aurora-cover", "cover"),
            "сделай мне огненную рамку на профиль": ("ember-crown", "avatar"),
        }
        for phrase, (preset, target) in expected.items():
            with self.subTest(phrase=phrase):
                request = decorations.parse_intent(phrase)
                self.assertEqual(request["kind"], "propose")
                self.assertEqual(request["preset"], preset)
                self.assertEqual(request["target"], target)
                canon, error = decorations.validate(target, request["doc"])
                self.assertEqual(error, "")
                self.assertEqual(canon["target"], target)
        for phrase in ("убери рамку", "сними рамку с аватара", "удали украшение"):
            with self.subTest(phrase=phrase):
                self.assertEqual(decorations.parse_intent(phrase)["kind"], "remove")
                self.assertEqual(decorations.parse_intent(phrase)["target"], "avatar")
        self.assertEqual(decorations.parse_intent("сними обложку")["target"], "cover")
        self.assertEqual(decorations.parse_intent("убери слайм")["target"], "avatar")
        # Unsupported target/effect combination is an honest hint, never a silent switch.
        fire_on_cover = decorations.parse_intent("сделай огненную обложку")
        self.assertEqual(fire_on_cover["kind"], "hint")
        self.assertIn("только на аватар", fire_on_cover["text"])
        aurora_on_avatar = decorations.parse_intent("сделай сияние на аватар")
        self.assertEqual(aurora_on_avatar["kind"], "hint")
        self.assertIn("только на обложку", aurora_on_avatar["text"])
        # Plain chat is not a decoration command: it must still reach the normal path.
        for phrase in ("как дела", "расскажи про рамки", "обложка красивая", "сделай мне сценарий",
                       "убери всё лишнее", "/help", ""):
            with self.subTest(phrase=phrase):
                self.assertIsNone(decorations.parse_intent(phrase))

    def test_presets_validate_against_the_server_whitelists(self):
        for name in decorations.PRESET_ORDER:
            with self.subTest(preset=name):
                document = decorations.preset_document(name)
                canon, error = decorations.validate(document["target"], document)
                self.assertEqual(error, "")
                self.assertLessEqual(len(decorations.packed(canon).encode("utf-8")), 4096)
                self.assertLessEqual(len(canon["layers"]), 3)
                self.assertGreaterEqual(canon["layers"][0]["effect"] in decorations.EFFECTS, True)
                self.assertIn(canon["target"], ("avatar", "cover"))
                self.assertIs(type(canon.get("seed", 0)), int)
                self.assertLessEqual(canon.get("seed", 0), 0xFFFFFFFF)
        self.assertEqual(decorations.preset_document("slime-pet")["layers"][0]["anchor"], "bottom-right")
        self.assertEqual(decorations.preset_document("slime-pet", "bottom-left")["layers"][0]["anchor"],
                         "bottom-left")
        self.assertEqual(decorations.preset_document("slime-pet", "fill")["layers"][0]["anchor"],
                         "bottom-right")  # an unsupported anchor is ignored, never sent
        self.assertEqual(decorations.preset_document("runner-cover")["mode"], "scene")

    def test_the_whitelist_rejects_every_unsupported_document(self):
        def avatar_layer(**extra):
            return {"effect": "critters/slime", **extra}
        invalid = {
            "unknown effect": {"v": 1, "target": "avatar", "layers": [{"effect": "rainbow/unicorn"}]},
            "effect on the wrong target": {"v": 1, "target": "avatar",
                                           "layers": [{"effect": "weather/aurora"}]},
            "runner outside a scene": {"v": 1, "target": "cover", "mode": "frame",
                                       "layers": [{"effect": "sombra/runner"}]},
            "four layers": {"v": 1, "target": "avatar", "layers": [avatar_layer()] * 4},
            "no layers": {"v": 1, "target": "avatar", "layers": []},
            "version": {"v": 2, "target": "avatar", "layers": [avatar_layer()]},
            "boolean version": {"v": True, "target": "avatar", "layers": [avatar_layer()]},
            "seed float": {"v": 1, "target": "avatar", "seed": 1.5, "layers": [avatar_layer()]},
            "seed negative": {"v": 1, "target": "avatar", "seed": -1, "layers": [avatar_layer()]},
            "seed beyond uint32": {"v": 1, "target": "avatar", "seed": 4294967296,
                                   "layers": [avatar_layer()]},
            "unknown top key": {"v": 1, "target": "avatar", "url": "https://evil.invalid",
                                "layers": [avatar_layer()]},
            "unknown layer key": {"v": 1, "target": "avatar", "layers": [avatar_layer(href="x")]},
            "palette url": {"v": 1, "target": "avatar", "layers": [avatar_layer(palette="https://x")]},
            "palette ramp too short": {"v": 1, "target": "avatar", "layers": [avatar_layer(palette=["#fff"])]},
            "unsupported anchor": {"v": 1, "target": "avatar", "layers": [avatar_layer(anchor="fill")]},
            "intensity out of range": {"v": 1, "target": "avatar", "layers": [avatar_layer(intensity=2)]},
            "scale out of range": {"v": 1, "target": "avatar", "layers": [avatar_layer(scale=4)]},
            "flip not boolean": {"v": 1, "target": "avatar", "layers": [avatar_layer(flip="yes")]},
            "scene on the avatar": {"v": 1, "target": "avatar", "mode": "scene",
                                    "layers": [avatar_layer()]},
            "oversize": {"v": 1, "target": "avatar", "note": "x" * 5000, "layers": [avatar_layer()]},
        }
        for name, document in invalid.items():
            with self.subTest(case=name):
                canon, error = decorations.validate(document.get("target", "avatar"), document)
                self.assertIsNone(canon)
                self.assertNotEqual(error, "")
        valid, error = decorations.validate("avatar", {"v": 1, "target": "avatar", "seed": 0,
                                                       "layers": [avatar_layer(palette=["#102030", "#405060", "#708090"])]})
        self.assertEqual(error, "")
        self.assertEqual(valid["layers"][0]["palette"], ["#102030", "#405060", "#708090"])
        self.assertEqual(valid["seed"], 0)

    # -- runtime broker boundary -------------------------------------------
    def test_runtime_broker_whitelist_forwards_the_new_decoration_fields(self):
        path = ROOT.parent / "hermes-sombra-runtime" / "broker.py"
        spec = importlib.util.spec_from_file_location("sombra_runtime_broker_decoration", path)
        runtime_broker = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = runtime_broker
        try:
            spec.loader.exec_module(runtime_broker)
            self._assert_decoration_whitelist(runtime_broker)
        finally:
            sys.modules.pop(spec.name, None)

    def _assert_decoration_whitelist(self, runtime_broker):
        class Backend:
            def __init__(self):
                self.calls = []

            def call(self, payload):
                self.calls.append(payload)
                if payload["op"] == "bot_authorize_update":
                    return {"update_id": payload["update_id"], "bot_id": "bot",
                            "sender": {"id": "alice"}, "channel": "room", "access": {"trusted": True}}
                return {"ok": True, "data": {"user": {"id": "alice", "decorations": {}}}}

        backend = Backend()
        broker = runtime_broker.Broker(backend)
        scope = runtime_broker.Scope("server", "bot", "room", "alice")
        token, _ = broker.issue(scope)
        for update_id in (7, 8, 9):
            broker.db.execute("INSERT OR IGNORE INTO receipts VALUES (?,?,?)", (scope.key, update_id, "pending"))
        broker.db.commit()
        document = {"v": 1, "target": "avatar", "seed": 19,
                    "layers": [{"effect": "holy/divine-shield", "palette": "ember",
                                "anchor": "ring", "intensity": 0.9}]}
        broker.call(token, {"op": "bot_set_user_decoration", "update_id": 7, "target": "avatar",
                            "decoration": document, "bot_token": "RAW", "token": "SESSION",
                            "user": "attacker"})
        self.assertEqual(backend.calls[-1], {"op": "bot_set_user_decoration", "update_id": 7,
                                             "target": "avatar", "decoration": document})
        # A removal keeps its explicit JSON null and is forwarded as such.
        broker.call(token, {"op": "bot_set_user_decoration", "update_id": 8, "target": "cover",
                            "decoration": None, "extra": "dropped"})
        self.assertEqual(backend.calls[-1], {"op": "bot_set_user_decoration", "update_id": 8,
                                             "target": "cover", "decoration": None})
        # Only a known pending update can be decorated.
        with self.assertRaises(runtime_broker.Denied):
            broker.call(token, {"op": "bot_set_user_decoration", "update_id": 99,
                                "target": "avatar", "decoration": None})
        broker.db.close()


if __name__ == "__main__":
    unittest.main()
