"""Explicitly opted-in shared-host transport inside the existing Hermes gateway.

Logical Sombra contexts are separate; this is NOT filesystem/process isolation.
Raw bot authorization is read only from an operator-protected credential file.
"""
from __future__ import annotations

import asyncio
import base64
import contextvars
from contextlib import asynccontextmanager, closing
import importlib
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import secrets
import shlex
import sqlite3
import stat
import threading
import sys
import types
from urllib.parse import urlsplit

from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter
from .adapter import (Broker, Journal, HINT, MAX_FILE, SafetyError, SombraAdapter, SendResult, digest,
                      ident, packed, safe_file, sniff)

log = logging.getLogger(__name__)
# Hermes can load one plugin package per logical profile. Those packages must share
# a ContextVar object, NOT a process-global active user. SDK executor/hook workers
# copy_context (reviewed run.py, run_agent_cache.py, plugins_dispatch.py).
_context_module = sys.modules.setdefault("_sombra_platform_invocation_context_v1", types.ModuleType("_sombra_platform_invocation_context_v1"))
if not hasattr(_context_module, "invocation"):
    _context_module.invocation = contextvars.ContextVar("sombra_platform_invocation", default=None)
INVOCATION = _context_module.invocation
if not hasattr(_context_module, "sessions"):
    _context_module.sessions = {}
SESSION_BINDINGS = _context_module.sessions
HOST_ACK = "I_ACCEPT_SHARED_HOST_FULL_TOOLS"


def protected_token(path):
    path = Path(path)
    if not path.is_absolute() or any(p.is_symlink() for p in (path, *path.parents)):
        raise SafetyError("Bot credential requires absolute non-symlink protected path")
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
        raise SafetyError("Invalid protected bot credential file")
    if os.name == "posix" and (info.st_mode & 0o027 or path.parent.stat().st_mode & 0o022):
        raise SafetyError("Bot credential must not be world-readable or group/world writable")
    found = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:]
        key, separator, value = line.partition("=")
        if separator and key.strip() == "SOMBRA_BOT_TOKEN":
            parsed = shlex.split(value, comments=True, posix=True)
            if len(parsed) != 1 or not parsed[0]:
                raise SafetyError("Invalid protected bot token assignment")
            found.append(parsed[0])
    if len(found) != 1:
        raise SafetyError("Exactly one SOMBRA_BOT_TOKEN assignment required")
    return found[0]


def protected_persona(path, profile):
    if not path:
        return ""  # Never silently read Telegram/default SOUL or cwd context.
    value = Path(path)
    if (not value.is_absolute() or value.name != "SOUL.md" or value.parent.name != profile
            or any(item.is_symlink() for item in (value, *value.parents))):
        raise SafetyError("Persona must be explicit clean Sombra profile SOUL.md")
    info = value.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 32768 or (os.name == "posix" and info.st_mode & 0o022):
        raise SafetyError("Protected Sombra persona must be regular, bounded and not group/world writable")
    return value.read_text(encoding="utf-8")


class DirectAPI(Broker):
    """Existing backend API in explicitly acknowledged shared-host mode only."""
    def __init__(self, url, token_file, test=False):
        u = urlsplit(url)
        if (u.scheme != "https" and not (test and u.scheme == "http" and u.hostname in ("127.0.0.1", "::1"))
                or u.username or u.password or u.query or u.fragment or not u.path.endswith("/api")):
            raise SafetyError("Shared-host transport requires HTTPS /api")
        from urllib.request import build_opener
        from .adapter import NoRedirect
        self.url, self.token = url, protected_token(token_file)
        self.opener = build_opener(NoRedirect())

    def call(self, op, **args):
        if op in ("runtime_begin_invocation", "runtime_end_invocation"):
            return {"ok": True}  # No broker/model proxy and no second provider engine.
        result = super().call(op, **args)
        result = result.get("data", result)
        if not isinstance(result, dict):
            raise SafetyError("Invalid backend API response envelope")
        return result


def observe_generated_artifact(**kwargs):
    """Observe actual native producer results, never model prose or arbitrary file URLs."""
    if kwargs.get("tool_name") not in ("image_generate", "video_generate") or INVOCATION.get() is None:
        return None
    try:
        adapter = get_current_adapter()
        if not adapter._scope()["trusted"]:
            return None
        adapter.capture_generated_artifact(**kwargs)
    except Exception:
        binding = INVOCATION.get()
        if binding and binding[0]._scope() is binding[1] and binding[1].get("current"):
            binding[1]["current"].setdefault("generated_errors", []).append("artifact_provenance_unavailable")
    return None


def get_current_adapter():
    """Trusted extension-code accessor; never exposed as a generic model RPC tool."""
    binding = INVOCATION.get()
    if binding is None:
        raise SafetyError("No Sombra-origin invocation for native extension")
    adapter, scope, update_id = binding
    if adapter._scope() is not scope or not scope.get("current") or str(scope["current"]["id"]) != str(update_id):
        raise SafetyError("Expired Sombra native-extension invocation")
    return adapter


def bind_shared_agent_session(**kwargs):
    """Observer records SDK's actual session IDs, including delegated child lineage."""
    binding = INVOCATION.get()
    session_id, parent_id = str(kwargs.get("session_id") or ""), str(kwargs.get("parent_session_id") or "")
    if session_id and (binding is not None or str(kwargs.get("platform") or "") == "sombra" or parent_id in SESSION_BINDINGS):
        update = binding[1].get("current") if binding else None
        SESSION_BINDINGS[session_id] = (binding[0], binding[1], str(binding[2])) if binding and update and str(update["id"]) == str(binding[2]) else None
    return None


def shared_pre_tool_call(**kwargs):
    binding = INVOCATION.get()
    session_id = str(kwargs.get("session_id") or "")
    if binding is None:
        origin = ""
        try:
            from gateway.session_context import get_session_env
            origin = get_session_env("HERMES_SESSION_PLATFORM", "")
        except ImportError:
            pass
        if session_id in SESSION_BINDINGS or origin == "sombra":
            return {"action": "block", "message": "Sombra invocation context lost at SDK thread boundary; tool blocked"}
        return None  # Unrelated Telegram/CLI sessions are never globally gated.
    adapter, scope, invocation_id = binding
    try:
        current = scope.get("current")
        expected = (adapter, scope, str(invocation_id)) if current else None
        if (not current or str(current["id"]) != str(invocation_id)
                or (session_id in SESSION_BINDINGS and SESSION_BINDINGS[session_id] != expected)):
            raise SafetyError("SDK session does not belong to this exact Sombra invocation")
        if session_id:
            SESSION_BINDINGS[session_id] = expected
        canonical = adapter.authorize()
        if not scope["trusted"]:
            # Public runner owns its stricter typed capability/SSRF/tool guard. It must
            # explicitly install a guard callback; no default permissive public tools.
            guard = scope.get("public_tool_guard")
            if not callable(guard):
                raise SafetyError("Public capability guard not installed")
            return guard(**kwargs)
        if canonical.get("access", {}).get("trusted") is not True:
            raise SafetyError("Full-tools grant revoked")
    except Exception:
        return {"action": "block", "message": "Sombra fresh invocation authorization unavailable; tool blocked"}
    return None


class SharedHostAdapter(SombraAdapter):
    """Many actor/channel scopes; every async turn has its own ContextVar binding."""
    supports_async_delivery = False
    def __init__(self, config, public_runner=None):
        if os.environ.get("SOMBRA_SHARED_HOST_ACK") != HOST_ACK:
            raise SafetyError("Shared-host full tools require explicit operator host-access risk acknowledgement")
        BasePlatformAdapter.__init__(self, config, Platform("sombra"))
        if isinstance(getattr(config, "extra", None), dict):
            config.extra["notice_delivery"] = "private"
        self._artifact_lock = threading.RLock()
        self.env = dict(os.environ)
        self.root = Path(self.env.get("SOMBRA_STATE_DIR", "/var/lib/sombra-hermes-platform"))
        if not self.root.is_absolute() or self.root.is_symlink():
            raise SafetyError("Absolute private Sombra state directory required")
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.profile = self.env.get("SOMBRA_PROFILE", "sombra")
        if self.profile in ("", "default") or not self.profile.replace("-", "").replace("_", "").isalnum():
            raise SafetyError("New logical Sombra profile required; never default Telegram profile")
        self.broker = DirectAPI(self.env["SOMBRA_API_URL"], self.env.get("SOMBRA_TOKEN_FILE", "/etc/sombra-hermes/bot.env"), self.env.get("SOMBRA_TEST_LOOPBACK") == "1")
        self.server_id = self.env.get("SOMBRA_SERVER_ID", self.broker.url)
        self._scopes, self._tasks = {}, {}
        self._connected = False
        self._poll_task = None
        self._locks = []
        self._semaphore = asyncio.Semaphore(1)  # Bound Sombra work only; never alter Telegram's global concurrency.
        self.public_runner = public_runner
        self._public_profile_home = None
        self._public_prepared_secrets = None
        self._public_provider_snapshot = {"image": None, "video": None}
        self.persona_path = Path(self.env["SOMBRA_SOUL_FILE"]) if self.env.get("SOMBRA_SOUL_FILE") else None
        self.bot_handle = "hermes"
        self._dm_policy = self._group_policy = "allowlist"

    def _scope(self):
        binding = INVOCATION.get()
        if binding is None or binding[0] is not self:
            return None
        scope = binding[1]
        current = scope.get("current")
        if current and str(current["id"]) != str(binding[2]):
            return None
        return scope

    @property
    def current(self):
        scope = self._scope()
        return scope.get("current") if scope else None

    @current.setter
    def current(self, value):
        scope = self._scope()
        if scope is None:
            raise SafetyError("No invocation-bound Sombra scope")
        scope["current"] = value

    @property
    def actor(self):
        scope = self._scope()
        return scope["actor"] if scope else ""

    @property
    def channel(self):
        scope = self._scope()
        return scope["channel"] if scope else ""

    @property
    def journal(self):
        scope = self._scope()
        if scope is None:
            raise SafetyError("No invocation-bound journal")
        return scope["journal"]

    @property
    def state_dir(self):
        scope = self._scope()
        return scope["directory"] if scope else self.root

    @property
    def native_avatar_inputs(self):
        return self.current.get("native_avatar_inputs", []) if self.current else []

    @property
    def artifact_roots(self):
        scope = self._scope()
        if scope is None:
            return []
        return scope["artifact_roots"]

    @property
    def manifest(self):
        return {"server_id": self.server_id, "bot_id": self.bot_id}

    @property
    def _halted(self):
        scope = self._scope()
        return scope.get("halted", False) if scope else False

    @_halted.setter
    def _halted(self, value):
        scope = self._scope()
        if scope is not None:
            scope["halted"] = value

    @property
    def _prompts(self):
        scope = self._scope()
        return scope["prompts"] if scope else {}

    @_prompts.setter
    def _prompts(self, value):
        scope = self._scope()
        if scope is not None:
            scope["prompts"] = value

    def resolved_allowlist_user_ids(self):
        scope = self._scope()
        return {scope["actor"]} if scope and scope["trusted"] else set()

    def _is_dm_allowed(self, sender_id):
        return sender_id == self.actor and bool(self._scope() and self._scope()["trusted"])

    def _is_group_allowed(self, chat_id, sender_id=""):
        return chat_id == self.channel and self._is_dm_allowed(sender_id)

    def toolsets_for_source(self, source):
        scope = self._scope()
        if scope is None or not scope["trusted"]:
            return []
        return None  # Normal dynamic hermes-sombra core; never hardcoded tool names.

    def classify_text(self, update):
        return SombraAdapter.classify_text(update, self.bot_handle)

    def _is_control_text(self, update):
        return self.classify_text(update)[0] == "control"

    def build_source(self, *args, **kwargs):
        if kwargs.get("chat_type") == "group":
            # Synthetic transport-internal lane, not a claimed native Sombra thread. This
            # prevents operator group-session sharing settings merging two human contexts.
            kwargs["thread_id"] = digest({"server": self.server_id, "bot": self.bot_id, "actor": self.actor, "channel": self.channel})
        source = super().build_source(*args, **kwargs)
        if source.profile_route_rejected or source.profile != self.profile:
            raise SafetyError("Sombra must route to its served clean logical profile; refusing Telegram/default fallback")
        return source

    def authorize(self):
        scope = self._scope()
        if scope is None or not self.current or self._halted:
            raise SafetyError("No live invocation-bound Sombra authority")
        canonical = self.broker.call("bot_authorize_update", update_id=self.current["id"])
        if (str(canonical.get("update_id")) != str(self.current["id"])
                or ident(canonical.get("sender")) != self.actor or ident(canonical.get("channel")) != self.channel
                or ident(canonical.get("bot_id")) != self.bot_id
                or (scope["trusted"] and canonical.get("access", {}).get("trusted") is not True)):
            raise SafetyError("Fresh Sombra source/scope/grant check rejected")
        if self.current.get("canonical") and self.current["canonical"] != digest(canonical):
            raise SafetyError("Sombra source or policy changed during invocation")
        return canonical

    def _new_scope(self, canonical):
        actor, channel = ident(canonical.get("sender")), ident(canonical.get("channel"))
        if not actor or not channel or ident(canonical.get("bot_id")) != self.bot_id:
            raise SafetyError("Canonical Sombra scope unavailable")
        key = digest({"server": self.server_id, "bot": self.bot_id, "actor": actor, "channel": channel})
        if key in self._scopes:
            return key, self._scopes[key]
        directory = self.root / "scopes" / key
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        artifacts = directory / "artifacts"
        artifacts.mkdir(mode=0o700, exist_ok=True)
        roots = [artifacts.resolve()]
        # Explicit generated-output roots only. No Telegram cache, whole home or cwd export.
        configured = json.loads(self.env.get("SOMBRA_ARTIFACT_ROOTS", "[]"))
        for item in configured:
            path = Path(item)
            if not path.is_absolute() or path.is_symlink() or path.name in (".hermes", "home", "workspace", "cache"):
                raise SafetyError("Only explicit generated artifact subdirectories may be exported")
            roots.append(path.resolve())
        journal = Journal(directory / "journal.sqlite", {"server_id": self.server_id, "endpoint": self.broker.url, "bot": self.bot_id, "actor": actor, "channel": channel})
        journal.db.execute("CREATE TABLE IF NOT EXISTS public_history(seq INTEGER PRIMARY KEY AUTOINCREMENT,update_id TEXT,role TEXT,text TEXT)")
        journal.db.commit()
        scope = {"actor": actor, "channel": channel, "directory": directory, "journal": journal,
                 "current": None, "halted": False, "prompts": {}, "trusted": False,
                 "artifact_roots": roots,
                 "public_tool_guard": lambda **kwargs: {"action": "block", "message": "Public Sombra tools may execute only through the restricted typed public runner"}}
        self._scopes[key] = scope
        return key, scope

    def capture_generated_artifact(self, *, tool_name, result, tool_call_id="", **kwargs):
        canonical = self.authorize()
        if canonical.get("access", {}).get("trusted") is not True or not tool_call_id:
            raise SafetyError("Native generated artifact needs exact trusted producer call")
        if isinstance(result, str) and len(result) > 65536:
            raise SafetyError("Native producer manifest exceeds bounded result size")
        value = json.loads(result) if isinstance(result, str) else result
        if not isinstance(value, dict) or value.get("success") is not True:
            return
        field = "image" if tool_name == "image_generate" else "video"
        source = value.get("host_" + field) or value.get(field)
        if not isinstance(source, str) or not Path(source).is_absolute():
            raise SafetyError("Native producer did not return a supported local artifact")
        home = self._public_profile_home or self._public_home()
        resolved = Path(source).resolve()
        workspace_roots = [root for root in self.artifact_roots if root.name == "artifacts"]
        if not (resolved.is_relative_to(home / "cache") or any(resolved.is_relative_to(root) for root in workspace_roots)):
            raise SafetyError("Producer path is not Sombra generated media")
        data, _ = safe_file(source, self.artifact_roots)
        mime, extension, _ = sniff(data)
        expected = "image/" if field == "image" else "video/"
        if not mime.startswith(expected):
            raise SafetyError("Native producer artifact MIME is not the declared media kind")
        sha = hashlib.sha256(data).hexdigest()
        record_id = digest({"update": self.current["id"], "call": str(tool_call_id), "source": str(resolved)})
        with self._artifact_lock:
            records = self.current.setdefault("generated_artifacts", {})
            if record_id in records:
                if records[record_id]["sha256"] != sha:
                    raise SafetyError("Native producer replay changed artifact bytes")
                return
            if len(records) >= 32 or sum(item["size"] for item in records.values()) + len(data) > 20 * 1024 * 1024:
                raise SafetyError("Native generated output exceeds Sombra attachment budget")
            folder = self.state_dir / "artifacts"
            folder.mkdir(mode=0o700, exist_ok=True)
            if folder.is_symlink():
                raise SafetyError("Generated artifact staging symlink forbidden")
            staged = folder / (record_id[:16] + "_" + sha[:16] + extension)
            if not staged.exists():
                with staged.open("xb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                if os.name == "posix":
                    directory_fd = os.open(folder, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
            staged_bytes, _ = safe_file(staged, [folder.resolve()])
            if hashlib.sha256(staged_bytes).hexdigest() != sha:
                raise SafetyError("Generated staged bytes differ from producer result")
            record = {"id": record_id, "update_id": self.current["id"], "tool_call_id": str(tool_call_id),
                      "source": str(resolved), "staged": str(staged), "sha256": sha, "mime": mime,
                      "size": len(data), "tool_result_hash": digest(value), "delivered": False}
            # Observer hooks run in SDK worker threads: use a distinct FULL-synchronous
            # connection, never the event-loop-owned SQLite handle.
            with closing(sqlite3.connect(self.state_dir / "journal.sqlite")) as database:
                database.execute("PRAGMA synchronous=FULL")
                database.execute("CREATE TABLE IF NOT EXISTS generated_artifacts(id TEXT PRIMARY KEY,update_id TEXT NOT NULL,tool_call_id TEXT NOT NULL,source_path TEXT NOT NULL,sha256 TEXT NOT NULL,staged_path TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,tool_result_hash TEXT NOT NULL,response_ref TEXT)")
                previous = database.execute("SELECT sha256,tool_result_hash FROM generated_artifacts WHERE id=?", (record_id,)).fetchone()
                if previous and previous != (sha, record["tool_result_hash"]):
                    raise SafetyError("Durable native producer manifest conflict")
                database.execute("INSERT OR IGNORE INTO generated_artifacts(id,update_id,tool_call_id,source_path,sha256,staged_path,mime,size,tool_result_hash) VALUES(?,?,?,?,?,?,?,?,?)",
                                 (record_id, str(record["update_id"]), record["tool_call_id"], record["source"], sha, record["staged"], mime, len(data), record["tool_result_hash"]))
                database.commit()
            records[record_id] = record

    def _scrub_local_references(self, content):
        text = str(content)
        # File URLs are NEVER download authority. Remove them even when unproven; only
        # producer manifests below can cause a byte read/send.
        known = set()
        if self.current:
            for record in list(self.current.get("generated_artifacts", {}).values()):
                known.update((Path(record["source"]).as_uri(), Path(record["staged"]).as_uri()))
        def replace_link(match):
            label, uri = match.group(1) or "изображение", match.group(2)
            canonical_uri = "file://" + uri[7:]
            return label if canonical_uri in known else label + " (локальная ссылка недоступна; файл не отправлен)"
        text = re.sub(r"!?\[([^\]]*)\]\(<?(file://[^\s)>]+)>?\)", replace_link, text, flags=re.IGNORECASE)
        text = re.sub(r"file://[^\s<>)]*", "[локальная ссылка недоступна]", text, flags=re.IGNORECASE)
        if self.current:
            for record in list(self.current.get("generated_artifacts", {}).values()):
                text = text.replace(record["source"], "[сгенерированный файл]").replace(record["staged"], "[сгенерированный файл]")
        if self._public_profile_home is not None:
            text = re.sub(re.escape(str(self._public_profile_home / "cache")) + r"[/\\][^\s<>)]*", "[локальный файл]", text)
        return text

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        return await super().send(chat_id, self._scrub_local_references(content), reply_to=reply_to, metadata=metadata)

    async def edit_message(self, chat_id, message_id, content, *, finalize=False):
        return await super().edit_message(chat_id, message_id, self._scrub_local_references(content), finalize=finalize)

    async def _media(self, chat_id, path, caption=None):
        record = None
        if self.current:
            record = next((item for item in list(self.current.get("generated_artifacts", {}).values())
                           if str(path) in (item["source"], item["staged"])), None)
        if self.current and self.current.get("generated_errors"):
            return SendResult(success=False, error="Native producer provenance failed; fallback media export denied")
        if record is None and self.current and Path(str(path)).is_absolute():
            home = self._public_profile_home or self._public_home()
            resolved = Path(path).resolve()
            workspace_roots = [root for root in self.artifact_roots if root.name == "artifacts"]
            if not (resolved.is_relative_to(home / "cache") or any(resolved.is_relative_to(root) for root in workspace_roots)):
                self.current.setdefault("generated_errors", []).append("outside_sombra_media")
                return SendResult(success=False, error="Media origin is outside Sombra artifacts; fallback export denied")
            if resolved.is_relative_to(home / "cache") and Path(path).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm"):
                self.current.setdefault("generated_errors", []).append("unproven_cached_media")
                return SendResult(success=False, error="Cached image/video lacks this invocation's producer manifest")
        if record is not None:
            if record["delivered"]:
                return SendResult(success=True, message_id=record.get("response_ref"))
            path = record["staged"]
            data, _ = safe_file(path, [(self.state_dir / "artifacts").resolve()])
            if hashlib.sha256(data).hexdigest() != record["sha256"]:
                self.current["failed"] = True
                return SendResult(success=False, error="Generated artifact changed after producer manifest")
        result = await super()._media(chat_id, path, self._scrub_local_references(caption) if caption else caption)
        if record is not None and result.success:
            record["delivered"], record["response_ref"] = True, result.message_id
            self.journal.db.execute("UPDATE generated_artifacts SET response_ref=? WHERE id=?", (result.message_id, record["id"]))
            self.journal.db.commit()
        return result

    async def _deliver_generated_outputs(self, event):
        if not self.current or getattr(event, "platform_update_id", None) != self.current["id"]:
            return
        for record in list(self.current.get("generated_artifacts", {}).values()):
            if not record["delivered"]:
                result = await self._media(self.channel, record["staged"])
                if not result.success:
                    self.current.setdefault("generated_errors", []).append("artifact_delivery_failed")
        if self.current.get("generated_errors"):
            # Explicit failure disposition, not a silent missing file or a fake Sent.
            if not self.current["failed"]:
                await self.send(self.channel, "Не удалось безопасно отправить сгенерированное вложение. Нужна проверка оператором; повторная генерация автоматически не запускается.")
            self.current["failed"] = True
        elif self.current.get("generated_artifacts"):
            self.current["attachments_complete"] = True

    async def send_slash_confirm(self, chat_id, title, message, session_key, confirm_id, metadata=None):
        from gateway.run import _async_profile_runtime_scope
        # The receiving transport's handler may still be scoped to its DEFAULT home.
        # Bind the actual clean Sombra runtime (home+full secrets+terminal policy) before
        # the base transport captures the process-local original callback context.
        async with _async_profile_runtime_scope(self._public_home()):
            return await super().send_slash_confirm(chat_id, title, message, session_key, confirm_id, metadata=metadata)

    async def send_private_notice(self, chat_id, user_id, content, reply_to=None, metadata=None):
        # Supported notice_delivery=private route: no private-destination backend API
        # exists here, and proactive/setup notices are not user replies. Consume without
        # a public fallback, without assigning a home/cron target, and without Sent text.
        return SendResult(success=True, raw_response={"suppressed": True, "reason": "sombra_operational_notices_disabled"})

    def _public_home(self):
        from hermes_cli.profiles import get_profile_dir
        from hermes_constants import get_routing_process_hermes_home
        home = Path(get_profile_dir(self.profile))
        if (not home.is_absolute() or home.name != self.profile or not home.is_dir()
                or any(item.is_symlink() for item in (home, *home.parents))
                or home.resolve() == Path(get_routing_process_hermes_home()).resolve()
                or not (home / "config.yaml").is_file() or (home / "config.yaml").is_symlink()):
            raise SafetyError("Public AI requires the existing clean served named Sombra profile")
        configured = self.env.get("SOMBRA_PROFILE_ROOT")
        if configured and Path(configured).resolve() != home.resolve():
            raise SafetyError("Configured Sombra profile root differs from SDK profile identity")
        return home

    @staticmethod
    def _approved_provider_snapshot(config):
        snapshot = {"image": None, "video": None}
        definitions = (("image", "image_gen", "agent.image_gen_registry", "OpenAICodexImageGenProvider"),
                       ("video", "video_gen", "agent.video_gen_registry", "XAIVideoGenProvider"))
        for kind, section, module_name, approved_class in definitions:
            try:
                registry = importlib.import_module(module_name)
            except ImportError:
                continue
            settings = config.get(section) or {}
            name = settings.get("provider") if isinstance(settings, dict) else None
            # Never call get_active_provider/is_available here: metadata preparation must
            # not refresh auth or probe remote services. No implicit backend replacement.
            if name:
                candidate = registry.get_provider(str(name))
            else:
                # A single installed vetted provider is a candidate, not proof of credentials;
                # its typed handler reports unavailable instead of inventing success.
                candidates = [item for item in registry.list_providers() if type(item).__name__ == approved_class]
                candidate = candidates[0] if len(candidates) == 1 else None
            if candidate is not None and type(candidate).__name__ == approved_class:
                snapshot[kind] = candidate
        return snapshot

    async def _prepare_public_runtime(self):
        from gateway.run import _load_profile_secret_scope, _profile_runtime_scope
        from hermes_cli.config import load_config
        from hermes_cli.profiles import get_profile_dir
        from hermes_constants import get_routing_process_hermes_home
        from tui_gateway.launch_profile_policy import owner_secret_scope
        from agent.secret_scope import get_secret_str
        from .public_runner import public_provider_env_names

        home = self._public_home()
        named = await asyncio.to_thread(_load_profile_secret_scope, home)
        with _profile_runtime_scope(home, named):
            model = load_config().get("model") or {}
            provider = model.get("provider") if isinstance(model, dict) else None
        owner = getattr(self, "_owner_profile", None)
        owner_home = Path(get_profile_dir(owner)) if owner and owner != "default" else Path(get_routing_process_hermes_home())
        # Reuse SDK's receiving-owner snapshot (including service-env-only keys); do not
        # copy .env/auth files or install the owner's whole mapping in a public turn.
        owner_secrets = await asyncio.to_thread(owner_secret_scope, owner_home)
        with _profile_runtime_scope(owner_home, owner_secrets):
            snapshot = self._approved_provider_snapshot(load_config())
            names = public_provider_env_names(model_provider=provider, provider_snapshot=snapshot)
            selected = {name: value for name in names if (value := get_secret_str(name, ""))}
        # Only names admitted by actual registered public network/provider metadata enter
        # public scope. Explicit named-profile values win. Transport/admin keys are excluded
        # by public_provider_env_names even if accidentally present in either source.
        selected.update({name: named[name] for name in names if named.get(name)})
        self._public_profile_home = home
        self._public_prepared_secrets = selected
        self._public_provider_snapshot = snapshot

    @asynccontextmanager
    async def _public_runtime_scope(self):
        from gateway.run import _profile_runtime_scope
        if self._public_prepared_secrets is None:
            await self._prepare_public_runtime()
        # This is the SAME official home+secret+terminal scope the gateway uses for a
        # routed turn. asyncio.to_thread/copy_context carries it into public SDK workers.
        # INVOCATION stays bound independently; all SDK tokens reset after this callback.
        with _profile_runtime_scope(self._public_profile_home, self._public_prepared_secrets):
            yield

    async def _public_authorize(self, payload):
        if not self.current or str(payload["update"]["update_id"]) != str(self.current["id"]):
            raise SafetyError("Public runner invocation mismatch")
        return await self._authorize()

    def _take_lock(self, path):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        stream = path.open("a+b")
        if os.name == "posix":
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            import msvcrt
            stream.write(b"0")
            stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        self._locks.append(stream)

    async def connect(self, *, is_reconnect=False):
        # Same lock as the previous worker: parent must stop it before enabling this
        # platform. There is one poll owner, not a second worker racing the old token.
        legacy = Path(self.env.get("SOMBRA_LEGACY_STATE_DIR", "/var/lib/sombra-hermes"))
        self._take_lock(legacy / "worker.lock")
        self._take_lock(self.root / "gateway.lock")
        me = await self.broker.acall("bot_get_me")
        self.bot_id = ident(me.get("bot")) or ident(me.get("user"))
        handle = str(me.get("user", {}).get("username") or me.get("bot", {}).get("username") or "hermes").lstrip("@")
        if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", handle):
            raise SafetyError("Canonical bot command handle invalid")
        self.bot_handle = handle
        if not self.bot_id or me.get("bot", {}).get("legacy"):
            raise SafetyError("Current privacy-mode Sombra bot identity required")
        if self.public_runner is None:
            try:
                from .public_runner import create_public_callback
                await self._prepare_public_runtime()
                persona = protected_persona(self.env.get("SOMBRA_SOUL_FILE"), self.profile)
                self.public_runner = create_public_callback(authorize=self._public_authorize, artifact_base=self.root / "scopes", persona=persona,
                                                           get_persona=lambda: protected_persona(self.env.get("SOMBRA_SOUL_FILE"), self.profile),
                                                           provider_snapshot=self._public_provider_snapshot, platform_context=HINT)
            except ImportError:
                log.warning("Sombra public AI runner unavailable; local help/reset only")
        self._connected = True
        log.warning("Sombra SHARED HOST enabled by explicit operator acknowledgement: trusted tools can access host/Telegram-readable files; logical profile separation is NOT a sandbox")
        self._poll_task = asyncio.create_task(self._poll())
        return True

    async def disconnect(self):
        self._connected = False
        if self._poll_task:
            self._poll_task.cancel()
        tasks = [*self._tasks.values(), *getattr(self, "_session_tasks", {}).values()]
        if self._poll_task:
            tasks.append(self._poll_task)
        for task in tasks:
            task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=10)
            except asyncio.TimeoutError:
                pass
        for scope in self._scopes.values():
            if scope["current"]:
                scope["journal"].state(scope["current"]["id"], "UNCERTAIN")
            scope["journal"].db.close()
        for stream in self._locks:
            stream.close()
        self._locks = []

    def _is_settings_update(self, update):
        handles = "(?:hermes|" + re.escape(self.bot_handle) + ")"
        text = str(update.get("message", {}).get("text", ""))
        return bool(re.fullmatch(r"(?:@" + handles + r"[ \t]+)?/settings(?:@" + handles + r")?[ \t]*", text))

    async def _run_scope(self, scope, update, canonical):
        token = INVOCATION.set((self, scope, str(update["update_id"])))
        try:
            async with self._semaphore:
                scope["trusted"] = canonical.get("access", {}).get("trusted") is True
                if self._is_settings_update(update):
                    from .native_tools import settings_response
                    await self._public_ingest(update, canonical, local_response=settings_response)
                elif scope["trusted"]:
                    await super().ingest(update)
                else:
                    await self._public_ingest(update, canonical)
        finally:
            INVOCATION.reset(token)

    async def _poll(self):
        cursor, delay = 0, 1
        while self._connected:
            try:
                for key, task in list(self._tasks.items()):
                    if task.done():
                        try:
                            task.result()
                        except Exception:
                            log.error("Sombra scope halted/failed; manual check may be required")
                        del self._tasks[key]
                args = {"limit": 50}
                if cursor:
                    args["after"] = cursor
                response = await self.broker.acall("bot_get_updates", **args)
                updates = response.get("updates", [])
                for update in updates:
                    cursor = update["update_id"]
                    canonical = await self.broker.acall("bot_authorize_update", update_id=update["update_id"])
                    if (str(canonical.get("update_id")) != str(update["update_id"])
                            or ident(canonical.get("sender")) != ident(update.get("sender"))
                            or ident(canonical.get("channel")) != ident(update.get("channel"))):
                        raise SafetyError("Queue payload differs from canonical Sombra source")
                    key, scope = self._new_scope(canonical)
                    if scope["halted"]:
                        continue
                    if key in self._tasks:
                        if scope["current"] and update["update_id"] != scope["current"]["id"]:
                            token = INVOCATION.set((self, scope, str(scope["current"]["id"])))
                            try:
                                handled = await self.handle_control(update) if scope["trusted"] else False
                                if not handled and self._is_control_text(update):
                                    await self.reject_control(update)
                            finally:
                                INVOCATION.reset(token)
                        continue
                    self._tasks[key] = asyncio.create_task(self._run_scope(scope, update, canonical))
                if len(updates) < 50:
                    cursor = 0
                delay = 1
            except asyncio.CancelledError:
                raise
            except Exception:
                delay = min(30, delay * 2)
                log.warning("Sombra poll failed; retrying without model dispatch")
            await asyncio.sleep(delay + secrets.randbelow(100) / 100)

    async def _public_ingest(self, update, canonical, local_response=None):
        update_id = update["update_id"]
        self.current = {"id": update_id, "parts": 0, "bytes": 0, "failed": False, "final": False,
                        "canonical": digest(canonical), "done": asyncio.Event()}
        try:
            await self._authorize()
            prior = self.journal.begin(update_id, digest(update))
            if prior in ("ACKED", "DELIVERED"):
                await self.broker.acall("bot_ack", update_id=update_id)
                self.journal.state(update_id, "ACKED")
                return
            if prior != "NEW":
                raise SafetyError("UNCERTAIN public invocation; no generation/tool replay")
            kind, text = self.classify_text(update)
            command = text.split(" ", 1)[0] if kind == "native" else ""
            if local_response is not None:
                result = await local_response(self, {"update": update, "authority": canonical})
            elif command in ("/help", "/start"):
                result = {"text": "Я Сомбра, ИИ-помощник мессенджера Sombra. /ask вопрос, /help — помощь, /reset — очистить ваш контекст. Доступны только безопасные публичные инструменты, реально настроенные оператором; серверные команды и чужая память недоступны.", "media": []}
            elif command in ("/reset", "/new", "/clear"):
                self.journal.db.execute("DELETE FROM public_history")
                self.journal.db.commit()
                result = {"text": "Ваш контекст в этом чате очищен.", "media": []}
            elif kind in ("native", "control"):
                result = {"text": "Эта команда недоступна в публичном режиме. /help — доступные команды.", "media": []}
            elif self.public_runner is None:
                result = {"text": "Безопасный публичный AI-обработчик ещё не настроен. /help — команды.", "media": []}
            else:
                history = [{"role": row[0], "content": row[1]} for row in self.journal.db.execute("SELECT role,text FROM public_history ORDER BY seq DESC LIMIT 12").fetchall()[::-1]]
                payload = {"update": {**update, "message": {**update.get("message", {}), "text": text}}, "authority": canonical,
                           "artifact_dir": str(self.state_dir / "artifacts"), "media_urls": [], "media_types": []}
                # Public input download is still original-invocation-only and source-authorized.
                if update.get("message", {}).get("attachment"):
                    await self._authorize()
                    attachment = await self.broker.acall("bot_attachment_file", update_id=update_id)
                    encoded = attachment.get("data", "")
                    if not isinstance(encoded, str) or len(encoded) > ((MAX_FILE + 2) // 3) * 4:
                        raise SafetyError("Public attachment exceeds 10 MiB")
                    data = base64.b64decode(encoded, validate=True)
                    if len(data) > MAX_FILE:
                        raise SafetyError("Public attachment exceeds 10 MiB")
                    mime, extension, _ = sniff(data, attachment.get("mime", ""))
                    inbound = self.state_dir / "inbound"
                    inbound.mkdir(mode=0o700, exist_ok=True)
                    path = inbound / (secrets.token_hex(16) + extension)
                    with path.open("xb") as stream:
                        stream.write(data)
                        stream.flush()
                        os.fsync(stream.fileno())
                    payload["media_urls"], payload["media_types"] = [str(path)], [mime]
                async with self._public_runtime_scope():
                    result = await self.public_runner(payload, history)
                if not isinstance(result, dict) or not isinstance(result.get("text", ""), str):
                    raise SafetyError("Invalid restricted public runner output")
                await self._authorize()
            output = result.get("text", "")
            if output:
                sent = await self.send(self.channel, output)
                if not sent.success:
                    raise SafetyError("Public text delivery failed")
            media = result.get("media", [])
            if not isinstance(media, list):
                raise SafetyError("Invalid public media manifest")
            for item in media:
                if not isinstance(item, dict) or not item.get("path"):
                    raise SafetyError("Invalid public media output")
                # Public generation may only export this actor/channel's temporary artifacts.
                scope = self._scope()
                old_roots = scope["artifact_roots"]
                scope["artifact_roots"] = [(self.state_dir / "artifacts").resolve()]
                try:
                    sent = await self._media(self.channel, item["path"], item.get("caption"))
                finally:
                    scope["artifact_roots"] = old_roots
                if not sent.success:
                    raise SafetyError("Public media delivery failed")
            count, delivered = self.journal.all_delivered(update_id)
            if not count or count != delivered or self.current["failed"]:
                raise SafetyError("Public invocation lacks complete durable output")
            if kind == "text" and self.public_runner is not None:
                self.journal.db.executemany("INSERT INTO public_history(update_id,role,text) VALUES(?,?,?)",
                                           [(str(update_id), "user", text), (str(update_id), "assistant", output)])
                self.journal.db.execute("DELETE FROM public_history WHERE seq NOT IN (SELECT seq FROM public_history ORDER BY seq DESC LIMIT 12)")
                self.journal.db.commit()
            self.journal.state(update_id, "DELIVERED")
            await self._authorize()
            await self.broker.acall("bot_ack", update_id=update_id)
            self.journal.state(update_id, "ACKED")
        except BaseException:
            self._halted = True
            self.journal.state(update_id, "UNCERTAIN")
            log.error("Sombra public invocation %s UNCERTAIN; manual check and explicit reenqueue required", update_id)
            raise
        finally:
            self.current = None
