"""Sombra external platform for Hermes bf0203a794a07aac3ff764972ab9087baa4e4f4e.

The entire gateway must run in an externally enforced actor/channel compartment.
This module does not create that security boundary and never accepts a raw bot key.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
from pathlib import Path
import secrets
import sqlite3
import stat
import time
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from gateway.config import Platform
from gateway.platforms.base import BasePlatformAdapter, SendResult
from gateway.platforms.event import MessageEvent, MessageType

PIN = "bf0203a794a07aac3ff764972ab9087baa4e4f4e"
MAX_FILE = 10 * 1024 * 1024
MAX_OUTPUT = 20 * 1024 * 1024
logger = logging.getLogger(__name__)
NATIVE_COMMANDS = frozenset({"help", "start", "reset", "new", "status", "model", "models", "tools", "stop", "compact", "clear", "usage", "context", "skills"})
HINT = ("Sombra plain text transport: 2000 Unicode code points per part, 32 parts per invocation; "
        "image/GIF/audio/voice/video/file attachments up to 10 MiB each, 20 MiB total. "
        "Only local generated artifacts within approved roots can be delivered. Remote media URLs "
        "are unsupported. Never claim a file was sent on an error. Native buttons, stickers, reactions, "
        "calendar/account links and live calls are not provided. Tool/browser availability depends on "
        "this isolated runtime's installed dependencies. Interactive prompts fail closed if unsupported.")


class SafetyError(RuntimeError):
    pass


def packed(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(packed(value).encode()).hexdigest()


def ident(value):
    """Canonical API identities may be objects with an id, never display names."""
    return str(value.get("id", "")) if isinstance(value, dict) else str(value or "")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise SafetyError("Broker redirects are forbidden")


class Broker:
    def __init__(self, url, token, test=False):
        u = urlsplit(url)
        loopback = test and u.hostname in ("127.0.0.1", "::1")
        if (u.scheme != "https" and not (loopback and u.scheme == "http")) or u.username or u.password or u.fragment or u.query or not u.path.endswith("/api"):
            raise SafetyError("Require scoped HTTPS broker /api (explicit loopback test only)")
        if not token or not token.startswith("sombra_scope_"):
            raise SafetyError("Only sombra_scope_ broker tokens accepted; raw bot mode disabled")
        self.url, self.token = url, token
        self.opener = build_opener(NoRedirect())

    def call(self, op, **args):
        request = Request(self.url, data=packed({"op": op, **args}).encode(),
                          headers={"Content-Type": "application/json", "Authorization": "Bearer " + self.token})
        with self.opener.open(request, timeout=30) as response:
            raw = response.read(30 * 1024 * 1024 + 1)
        if len(raw) > 30 * 1024 * 1024:
            raise SafetyError("Broker response exceeds limit")
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get("error"):
            raise SafetyError("Scoped broker rejected operation")
        return result

    async def acall(self, op, **args):
        return await asyncio.to_thread(self.call, op, **args)


class Journal:
    """Full payload manifests commit BEFORE delivery; never re-run crashed running turns."""
    def __init__(self, path, scope):
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS scope (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS updates (id TEXT PRIMARY KEY, input_hash TEXT NOT NULL, state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS parts (update_id TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL,
              payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY(update_id,key));
            CREATE TABLE IF NOT EXISTS mutations(update_id TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,
              hash TEXT NOT NULL,payload TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(update_id,key,revision));
        """)
        row = self.db.execute("SELECT value FROM scope WHERE id=1").fetchone()
        if row and row[0] != packed(scope):
            self.db.close()
            raise SafetyError("State journal belongs to a different actor/channel/server/bot")
        self.db.execute("INSERT OR IGNORE INTO scope VALUES (1,?)", (packed(scope),))
        recovered = self.db.execute("UPDATE updates SET state='UNCERTAIN' WHERE state='RUNNING'").rowcount
        self.db.commit()
        if recovered:
            logger.error("Sombra recovered %d UNCERTAIN invocation(s): manual effect check and explicit reenqueue required; no tool reexecution", recovered)

    def begin(self, update, input_hash):
        row = self.db.execute("SELECT input_hash,state FROM updates WHERE id=?", (str(update),)).fetchone()
        if row:
            if row[0] != input_hash:
                raise SafetyError("Update payload changed")
            return row[1]
        self.db.execute("INSERT INTO updates VALUES (?,?,'RUNNING')", (str(update), input_hash))
        self.db.commit()
        return "NEW"

    def state(self, update, state):
        self.db.execute("UPDATE updates SET state=? WHERE id=?", (state, str(update)))
        self.db.commit()

    def part(self, update, key, payload):
        encoded, hashed = packed(payload), digest(payload)
        row = self.db.execute("SELECT hash FROM parts WHERE update_id=? AND key=?", (str(update), key)).fetchone()
        if row and row[0] != hashed:
            raise SafetyError("Durable response key payload conflict")
        self.db.execute("INSERT OR IGNORE INTO parts(update_id,key,hash,payload) VALUES(?,?,?,?)", (str(update), key, hashed, encoded))
        self.db.commit()

    def delivered(self, update, key):
        self.db.execute("UPDATE parts SET delivered=1 WHERE update_id=? AND key=?", (str(update), key))
        self.db.commit()

    def all_delivered(self, update):
        return self.db.execute("SELECT count(*),sum(delivered) FROM parts WHERE update_id=?", (str(update),)).fetchone()


def safe_file(path, roots, limit=MAX_FILE):
    """Reject symlinks at every path component, escapes and special files before open."""
    value = Path(path)
    if not value.is_absolute() or ".." in value.parts:
        raise SafetyError("Artifact requires absolute non-traversing local path")
    for parent in (value, *value.parents):
        if parent.is_symlink():
            raise SafetyError("Artifact symlink forbidden")
    resolved = value.resolve(strict=True)
    if not any(resolved.is_relative_to(root) for root in roots):
        raise SafetyError("Artifact outside approved generated-media roots")
    if resolved.name.startswith(".") or resolved.suffix.lower() in (".env", ".key", ".pem", ".sqlite", ".db"):
        raise SafetyError("Secret/state artifact forbidden")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    if os.name == "posix":
        # Walk using dirfds+O_NOFOLLOW: a tool racing a parent directory into a symlink
        # cannot redirect the final read after the containment check.
        directory = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
        try:
            for component in value.parts[1:-1]:
                child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                os.close(directory)
                directory = child
            fd = os.open(value.name, flags, dir_fd=directory)
        finally:
            os.close(directory)
    else:
        fd = os.open(resolved, flags)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise SafetyError("Artifact unsupported or larger than 10 MiB")
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise SafetyError("Artifact larger than 10 MiB")
    return data, resolved.name


def sniff(data, claimed="application/octet-stream"):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", ".png", MessageType.PHOTO
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", ".jpg", MessageType.PHOTO
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif", ".gif", MessageType.PHOTO
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", ".webp", MessageType.PHOTO
    if data.startswith(b"OggS"):
        return "audio/ogg", ".ogg", MessageType.VOICE
    if data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        return "audio/wav", ".wav", MessageType.AUDIO
    if data.startswith(b"ID3") or data[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"):
        return "audio/mpeg", ".mp3", MessageType.AUDIO
    if data[4:8] == b"ftyp":
        return "video/mp4", ".mp4", MessageType.VIDEO
    if data.startswith(b"%PDF-"):
        return "application/pdf", ".pdf", MessageType.DOCUMENT
    # Never give unrecognized data a renderer-active extension (HTML/SVG/JS).
    return "application/octet-stream", ".bin", MessageType.DOCUMENT


def validate_runtime(env):
    state = Path(env["SOMBRA_STATE_DIR"])
    if not state.is_absolute() or state.is_symlink():
        raise SafetyError("Absolute private state dir required")
    marker = Path(env.get("SOMBRA_RUNTIME_ATTESTATION", "/run/sombra-runtime/compartment.json"))
    if not marker.is_absolute():
        raise SafetyError("Absolute immutable runtime attestation required")
    if marker.is_symlink():
        raise SafetyError("Runtime attestation symlink forbidden")
    manifest = json.loads(marker.read_text(encoding="utf-8"))
    expected = {"schema": 1, "mode": "actor-channel", "hermes_commit": PIN,
                "actor_id": env["SOMBRA_ACTOR_ID"], "channel_id": env["SOMBRA_CHANNEL_ID"],
                "broker_url": env["SOMBRA_API_URL"], "isolated": True,
                "no_telegram_mounts": True, "scoped_broker": True, "provider_proxy": True}
    if any(manifest.get(k) != v for k, v in expected.items()):
        raise SafetyError("Missing or mismatched isolated runtime contract")
    home, workspace = Path(manifest["hermes_home"]), Path(manifest["workspace"])
    if not home.is_absolute() or not workspace.is_absolute() or home.is_symlink() or workspace.is_symlink():
        raise SafetyError("Clean absolute isolated home/workspace required")
    if Path(env.get("HERMES_HOME", "")).resolve() != home.resolve() or Path.cwd().resolve() != workspace.resolve():
        raise SafetyError("Process must run inside attested clean home/workspace")
    if any(name.startswith("TELEGRAM_") or name in ("SOMBRA_BOT_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY") for name in env):
        raise SafetyError("Raw provider/bot/Telegram credentials forbidden in compartment")
    roots = [Path(p).resolve() for p in manifest["artifact_roots"]]
    if not roots or any(not (p == (workspace / "artifacts").resolve() or p.is_relative_to((home / "cache").resolve())) for p in roots):
        raise SafetyError("Artifact roots must be isolated workspace/artifacts or explicit profile cache subdirectories")
    if os.name == "posix":
        info = marker.stat()
        if info.st_uid != 0 or info.st_mode & 0o022 or marker.parent.stat().st_uid != 0 or marker.parent.stat().st_mode & 0o022:
            raise SafetyError("Attestation and immutable parent must be root-owned, not group/world writable")
        if os.geteuid() == 0 or os.access(marker.parent, os.W_OK):
            raise SafetyError("Gateway must be nonroot and unable to replace attestation")
    return manifest, state, roots


_ACTIVE = None  # One process = one compartment and one outstanding invocation.


class SombraAdapter(BasePlatformAdapter):
    CAPABILITIES = frozenset({"send", "edit", "delete", "typing", "image", "file", "video", "audio", "voice", "gif", "text_exec_approval", "text_clarify"})
    enforces_own_access_policy = True
    supports_message_editing = True

    def __init__(self, config):
        super().__init__(config, Platform("sombra"))
        self.env = dict(os.environ)
        os.umask(0o077)
        self.manifest, self.state_dir, self.artifact_roots = validate_runtime(self.env)
        self.actor, self.channel = self.env["SOMBRA_ACTOR_ID"], self.env["SOMBRA_CHANNEL_ID"]
        self.broker = Broker(self.env["SOMBRA_API_URL"], self.env["SOMBRA_API_TOKEN"], self.env.get("SOMBRA_TEST_LOOPBACK") == "1")
        self.current = None
        self.journal = None
        self._poll_task = None
        self._invocation_task = None
        self._prompts = {}
        self._connected = False
        self._halted = False
        self._lock_stream = None

    def _is_dm_allowed(self, sender_id):
        return sender_id == self.actor

    def _is_group_allowed(self, chat_id, sender_id=""):
        return chat_id == self.channel and sender_id == self.actor

    def authorize(self):
        if not self.current or self._halted:
            raise SafetyError("No active healthy source invocation; proactive destinations disabled")
        canonical = self.broker.call("bot_authorize_update", update_id=self.current["id"])
        if (str(canonical.get("update_id")) != str(self.current["id"])
                or ident(canonical.get("sender")) != self.actor or ident(canonical.get("channel")) != self.channel
                or canonical.get("access", {}).get("trusted") is not True
                or ident(canonical.get("bot_id")) != self.bot_id):
            raise SafetyError("Fresh canonical actor/channel/trust check rejected")
        if self.current.get("canonical") and digest(canonical) != self.current["canonical"]:
            raise SafetyError("Canonical invocation or policy revision changed during turn")
        return canonical

    async def _authorize(self):
        return await asyncio.to_thread(self.authorize)

    async def connect(self, *, is_reconnect=False):
        global _ACTIVE
        if _ACTIVE is not None:
            raise SafetyError("Only one Sombra compartment adapter per process")
        # OS advisory lock prevents a second gateway against the same durable state.
        self._lock_stream = open(self.state_dir / "gateway.lock", "a+b")
        if os.name == "posix":
            import fcntl
            fcntl.flock(self._lock_stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            import msvcrt
            self._lock_stream.write(b"0")
            self._lock_stream.flush()
            self._lock_stream.seek(0)
            msvcrt.locking(self._lock_stream.fileno(), msvcrt.LK_NBLCK, 1)
        me = await self.broker.acall("bot_get_me")
        self.bot_id = ident(me.get("bot"))
        policy = me.get("toolPolicy", {})
        if (not self.bot_id or self.bot_id != ident(self.manifest.get("bot_id")) or not self.manifest.get("server_id")
                or self.actor not in [ident(policy.get("owner")), *[ident(v) for v in policy.get("users", [])]]):
            raise SafetyError("Actor is not owner or explicitly selected stable ID")
        self.journal = Journal(self.state_dir / "journal.sqlite", {"actor": self.actor, "channel": self.channel, "bot": self.bot_id, "server": self.broker.url, "server_id": self.manifest["server_id"]})
        _ACTIVE, self._connected = self, True
        self._poll_task = asyncio.create_task(self._poll())
        return True

    async def disconnect(self):
        global _ACTIVE
        self._connected = False
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass
        if self._invocation_task:
            self._invocation_task.cancel()
            try:
                await self._invocation_task
            except (asyncio.CancelledError, Exception):
                pass
        if self.current:
            self.journal.state(self.current["id"], "UNCERTAIN")
        if self.journal:
            self.journal.db.close()
        if self._lock_stream:
            self._lock_stream.close()
        _ACTIVE = None

    async def _poll(self):
        delay = 1
        while self._connected and not self._halted:
            try:
                if self._invocation_task and self._invocation_task.done():
                    # Retrieve exception exactly once; failed invocations halt the compartment.
                    self._invocation_task.result()
                    self._invocation_task = None
                poll_args = {"limit": 50}
                if self.current:
                    poll_args["after"] = self.current.get("control_after", self.current["id"])
                result = await self.broker.acall("bot_get_updates", **poll_args)
                for event in result.get("updates", []):
                    if self.current:
                        if event["update_id"] != self.current["id"]:
                            self.current["control_after"] = event["update_id"]
                            handled = await self.handle_control(event)
                            if not handled and self._is_control_text(event):
                                await self.reject_control(event)
                    elif self._invocation_task is None:
                        self._invocation_task = asyncio.create_task(self.ingest(event))
                        # Let ingest claim its one active source before scanning more updates.
                        await asyncio.sleep(0)
                delay = 1
            except asyncio.CancelledError:
                raise
            except Exception:
                # No payload, text, credentials or URLs enter logs.
                delay = min(delay * 2, 30)
            await asyncio.sleep(delay + secrets.randbelow(100) / 100)

    @staticmethod
    def classify_text(update, bot_handle="hermes"):
        text = str(update.get("message", {}).get("text", ""))
        handles = "(?:hermes|" + re.escape(bot_handle) + ")"
        match = re.fullmatch(r"(?:@" + handles + r"[ \t]+)?/([a-zA-Z][a-zA-Z0-9_-]*)(?:@" + handles + r")?(?:[ \t]+([\s\S]*))?", text)
        if not match:
            return ("control", text) if re.match(r"^(?:@" + handles + r"[ \t]+)?/[a-zA-Z]", text) else ("text", text)
        command, arguments = match.group(1).lower(), match.group(2) or ""
        if command in NATIVE_COMMANDS:
            command = "help" if command == "start" else command
            return "native", "/" + command + (" " + arguments if arguments else "")
        if command in ("ask", "ai"):
            return "text", arguments
        return "control", text  # Unknown/admin/generic approvals never become model tasks.

    @staticmethod
    def _is_control_text(update):
        return SombraAdapter.classify_text(update)[0] == "control"

    async def reject_control(self, update):
        canonical = await self.broker.acall("bot_authorize_update", update_id=update["update_id"])
        if (str(canonical.get("update_id")) != str(update["update_id"])
                or ident(canonical.get("sender")) != self.actor or ident(canonical.get("channel")) != self.channel
                or ident(canonical.get("bot_id")) != self.bot_id or canonical.get("access", {}).get("trusted") is not True):
            return False
        control_id = update["update_id"]
        prior = self.journal.begin(control_id, digest(update))
        if prior == "ACKED":
            await self.broker.acall("bot_ack", update_id=control_id)
            return True
        payload = {"update_id": control_id, "response_key": "control_rejected", "text": "Control rejected: unknown, expired, already used or unsupported prompt. No approval was granted."}
        self.journal.part(control_id, "control_rejected", payload)
        await self.broker.acall("bot_reply", **payload)
        self.journal.delivered(control_id, "control_rejected")
        await self.broker.acall("bot_ack", update_id=control_id)
        self.journal.state(control_id, "ACKED")
        return True

    async def ingest(self, update):
        if self._is_control_text(update):
            return await self.reject_control(update)
        if self.current or self._halted:
            raise SafetyError("Compartment busy or UNCERTAIN; manual check required")
        update_id = update["update_id"]
        self.current = {"id": update_id, "parts": 0, "bytes": 0, "failed": False, "final": False,
                        "done": asyncio.Event()}
        try:
            canonical = await self._authorize()
            if ident(update.get("sender")) != self.actor or ident(update.get("channel")) != self.channel:
                raise SafetyError("Queue event differs from canonical scope")
            self.current["canonical"] = digest(canonical)
            status = self.journal.begin(update_id, digest(update))
            if status == "ACKED":
                await self.broker.acall("bot_ack", update_id=update_id)
                return
            if status == "DELIVERED":
                await self._authorize()
                await self.broker.acall("bot_ack", update_id=update_id)
                self.journal.state(update_id, "ACKED")
                return
            if status != "NEW":
                raise SafetyError("UNCERTAIN: manual check and explicit reenqueue required; no tool reexecution")
            await self.broker.acall("runtime_begin_invocation", update_id=update_id)
            self.current["lease"] = True
            message = update.get("message", {})
            media, types, kind = [], [], MessageType.TEXT
            if message.get("attachment"):
                await self._authorize()
                attachment = await self.broker.acall("bot_attachment_file", update_id=update_id)
                encoded = attachment.get("data", "")
                if not isinstance(encoded, str) or len(encoded) > ((MAX_FILE + 2) // 3) * 4:
                    raise SafetyError("Inbound attachment larger than 10 MiB")
                data = base64.b64decode(encoded, validate=True)
                if len(data) > MAX_FILE:
                    raise SafetyError("Inbound attachment larger than 10 MiB")
                mime, ext, kind = sniff(data, attachment.get("mime", ""))
                folder = self.state_dir / "inbound"
                folder.mkdir(mode=0o700, exist_ok=True)
                if folder.is_symlink():
                    raise SafetyError("Inbound directory symlink forbidden")
                path = folder / (secrets.token_hex(16) + ext)
                with path.open("xb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                media, types = [str(path)], [mime]
            self.current["native_avatar_inputs"] = [{"update_id": update_id, "path": path} for path in media]
            # Scope encoded into chat identity, not display names, profile selection or history.
            route = digest({"server": self.manifest["server_id"], "endpoint": self.broker.url, "bot": self.bot_id, "actor": self.actor, "channel": self.channel})
            source = self.build_source(chat_id=self.channel, chat_type="dm" if update.get("chat", {}).get("kind") == "direct" else "group",
                                       user_id=self.actor, scope_id=route, guild_id=ident(update.get("chat")), message_id=ident(message))
            text_class, event_text = self.classify_text(update)
            event = MessageEvent(text=event_text, source=source, user_id=self.actor,
                                 message_id=ident(message), media_urls=media, media_types=types, message_type=kind,
                                 platform_update_id=update_id, metadata={}, allow_gateway_control=text_class == "native")
            await self._authorize()
            await self.handle_message(event)
            # handle_message enqueues; it does NOT await final generation or media delivery.
            await asyncio.wait_for(self.current["done"].wait(), timeout=1800)
            if not self.current["final"] or self.current["failed"]:
                raise SafetyError("No proven complete final delivery; update remains UNCERTAIN")
            count, sent = self.journal.all_delivered(update_id)
            if count < 1 or count != sent:
                raise SafetyError("Not all durable output parts delivered")
            self.journal.state(update_id, "DELIVERED")
            await self._authorize()
            await self.broker.acall("bot_ack", update_id=update_id)
            self.journal.state(update_id, "ACKED")
            await self.broker.acall("runtime_end_invocation", update_id=update_id, outcome="complete")
            self.current["lease"] = False
        except BaseException:
            # Do not admit another source while old SDK background work could still be alive.
            self._halted = True
            logger.error("Sombra invocation %s UNCERTAIN: admission halted; manual effect check and explicit reenqueue required", update_id)
            if self.journal:
                self.journal.state(update_id, "UNCERTAIN")
            if self.current.get("lease"):
                try:
                    await self.broker.acall("runtime_end_invocation", update_id=update_id, outcome="uncertain")
                except Exception:
                    pass  # Broker persistence independently treats running leases as uncertain.
            raise
        finally:
            for prompt in self._prompts.values():
                if prompt["kind"] == "slash":
                    try:
                        from tools import slash_confirm
                        pending = slash_confirm.get_pending(prompt["session"])
                        if pending and pending.get("confirm_id") == prompt["sdk_id"]:
                            slash_confirm.clear(prompt["session"])
                    except Exception:
                        pass
            self._prompts = {}
            self.current = None

    async def _await_slash_dispositions(self, event):
        if self.current and getattr(event, "platform_update_id", None) == self.current["id"]:
            waiters = self.current.get("slash_waiters", [])
            if waiters and not self.current["failed"]:
                deadline = time.monotonic() + 300
                while True:
                    pending = [waiter for waiter in waiters if not waiter.is_set()]
                    if not pending:
                        break
                    await asyncio.wait_for(asyncio.gather(*(waiter.wait() for waiter in pending)),
                                           timeout=max(0.01, deadline - time.monotonic()))
                self.current["final"] = True

    async def _dispatch_inline_reply(self, event, *, log_cmd=None):
        """Pinned inline command boundary awaits handler + all reply sends (not first send)."""
        before = self.current["parts"] if self.current else 0
        try:
            await super()._dispatch_inline_reply(event, log_cmd=log_cmd)
            await self._await_slash_dispositions(event)
            if self.current and getattr(event, "platform_update_id", None) == self.current["id"]:
                if self.current["parts"] > before and not self.current["failed"]:
                    self.current["final"] = True
                self.current["done"].set()
        except BaseException:
            if self.current:
                self.current["failed"] = True
                self.current["done"].set()
            raise

    async def _notify_turn_error(self, event, e):
        if self.current:
            self.current["failed"] = True
        return await super()._notify_turn_error(event, e)

    async def _deliver_attachments(self, event, extracted, metadata, *, anything_sent, record_delivery):
        result = await super()._deliver_attachments(event, extracted, metadata, anything_sent=anything_sent, record_delivery=record_delivery)
        if self.current and getattr(event, "platform_update_id", None) == self.current["id"]:
            # This native lifecycle method runs AFTER final TTS/text and before final cleanup.
            # A successful media-only turn still needs this boundary, not merely first send.
            self.current["attachments_complete"] = True
        return result

    async def _process_message_background(self, event, session_key):
        """Pinned SDK lifecycle wrapper: completion AFTER text, media, TTS and finally cleanup."""
        try:
            await super()._process_message_background(event, session_key)
            await self._await_slash_dispositions(event)
        except BaseException:
            if self.current:
                self.current["failed"] = True
            raise
        finally:
            if self.current and getattr(event, "platform_update_id", None) == self.current["id"]:
                if self.current.get("attachments_complete") and self.current.get("media_sent") and not self.current["failed"]:
                    self.current["final"] = True
                self.current["done"].set()

    async def send_final_ledgered(self, event, session_key, text_content, metadata, *, reply_to, is_ephemeral_response=False):
        result = await super().send_final_ledgered(event, session_key, text_content, metadata, reply_to=reply_to, is_ephemeral_response=is_ephemeral_response)
        if self.current and getattr(event, "platform_update_id", None) == self.current["id"]:
            self.current["final"] = bool(result[0].success)
        return result

    def _destination(self, chat_id):
        if str(chat_id) != self.channel or not self.current or self.current["failed"] or self._halted:
            raise SafetyError("Destination is not a healthy stored invocation channel")

    def _message_ref(self, key):
        return str(self.current["id"]) + ":" + key

    def _response_key(self, message_id):
        prefix, separator, key = str(message_id).partition(":")
        if not separator or not self.current or prefix != str(self.current["id"]) or not re.fullmatch(r"part_[0-9]{2}", key):
            raise SafetyError("Response reference belongs to another source invocation")
        return key

    def _prepare_part(self, text, attachment=None):
        current = self.current
        if current["parts"] >= 32:
            raise SafetyError("Sombra 32-part output limit exceeded")
        size = len(base64.b64decode(attachment["data"])) if attachment else 0
        if current["bytes"] + size > MAX_OUTPUT:
            raise SafetyError("Sombra 20 MiB total attachment limit exceeded")
        key = "part_" + str(current["parts"]).zfill(2)
        payload = {"update_id": current["id"], "response_key": key, "text": text}
        if attachment:
            payload["attachment"] = attachment
        # Full attachment bytes cached in durable manifest before first network send.
        self.journal.part(current["id"], key, payload)
        current["parts"] += 1
        current["bytes"] += size
        return payload

    async def _deliver_part(self, payload):
        await self._authorize()
        if str(payload["update_id"]) != str(self.current["id"]):
            raise SafetyError("Prepared response belongs to another invocation")
        result = await self.broker.acall("bot_reply", **payload)
        self.journal.delivered(payload["update_id"], payload["response_key"])
        return payload["response_key"], result

    async def _part(self, text, attachment=None):
        await self._authorize()
        return await self._deliver_part(self._prepare_part(text, attachment))

    async def send(self, chat_id, content, reply_to=None, metadata=None):
        try:
            self._destination(chat_id)
            text = str(content)
            chunks = [text[i:i + 2000] for i in range(0, len(text), 2000)]
            if not chunks:
                raise SafetyError("Empty text response")
            if self.current["parts"] + len(chunks) > 32:
                raise SafetyError("Text exceeds remaining 32-part budget; not truncated")
            await self._authorize()
            # Cache the entire known text bundle before delivering its first part.
            prepared = [self._prepare_part(chunk) for chunk in chunks]
            keys = []
            for payload in prepared:
                key, _ = await self._deliver_part(payload)
                keys.append(key)
            return SendResult(success=True, message_id=self._message_ref(keys[0]))
        except Exception as exc:
            if self.current:
                self.current["failed"] = True
            return SendResult(success=False, error=str(exc))

    async def _media(self, chat_id, path, caption=None):
        try:
            self._destination(chat_id)
            await self._authorize()
            if str(path).startswith(("https://", "http://")):
                raise SafetyError("Remote media URLs unsupported; produce a local artifact")
            data, name = safe_file(path, self.artifact_roots)
            mime, _, _ = sniff(data)
            text = caption or ""
            if len(text) > 2000:
                raise SafetyError("Media caption exceeds 2000 code points")
            key, _ = await self._part(text, {"data": base64.b64encode(data).decode(), "name": name, "mime": mime})
            self.current["media_sent"] = True
            return SendResult(success=True, message_id=self._message_ref(key))
        except Exception as exc:
            if self.current:
                self.current["failed"] = True
            return SendResult(success=False, error=str(exc))

    async def send_image(self, chat_id, image_url, caption=None, reply_to=None, metadata=None):
        return await self._media(chat_id, image_url, caption)

    async def send_image_file(self, chat_id, image_path, caption=None, reply_to=None, metadata=None, **kwargs):
        return await self._media(chat_id, image_path, caption)

    async def send_document(self, chat_id, file_path, caption=None, file_name=None, reply_to=None, metadata=None, **kwargs):
        return await self._media(chat_id, file_path, caption)

    async def send_video(self, chat_id, video_path, caption=None, reply_to=None, metadata=None, **kwargs):
        return await self._media(chat_id, video_path, caption)

    async def send_voice(self, chat_id, audio_path, caption=None, reply_to=None, metadata=None, **kwargs):
        return await self._media(chat_id, audio_path, caption)

    async def send_animation(self, chat_id, animation_url, caption=None, reply_to=None, metadata=None):
        return await self._media(chat_id, animation_url, caption)

    async def edit_message(self, chat_id, message_id, content, *, finalize=False):
        try:
            self._destination(chat_id)
            await self._authorize()
            reference = message_id
            message_id = self._response_key(message_id)
            if len(content) > 2000:
                raise SafetyError("Edit exceeds 2000 code points")
            row = self.journal.db.execute("SELECT revision FROM parts WHERE update_id=? AND key=?", (str(self.current["id"]), message_id)).fetchone()
            if row is None:
                raise SafetyError("Unknown invocation response key")
            revision = row[0] + 1
            # Persist edit intent before call; pending edit failures taint turn and are not guessed/replayed.
            payload = {"update_id": self.current["id"], "response_key": message_id, "revision": revision, "text": content}
            self.journal.db.execute("INSERT INTO mutations(update_id,key,revision,hash,payload) VALUES(?,?,?,?,?)",
                                    (str(self.current["id"]), message_id, revision, digest(payload), packed(payload)))
            self.journal.db.execute("UPDATE parts SET revision=? WHERE update_id=? AND key=?", (revision, str(self.current["id"]), message_id))
            self.journal.db.commit()
            await self.broker.acall("bot_edit", **payload)
            self.journal.db.execute("UPDATE mutations SET delivered=1 WHERE update_id=? AND key=? AND revision=?",
                                    (str(self.current["id"]), message_id, revision))
            self.journal.db.commit()
            return SendResult(success=True, message_id=reference)
        except Exception as exc:
            if self.current:
                self.current["failed"] = True
            return SendResult(success=False, error=str(exc))

    async def delete_message(self, chat_id, message_id):
        try:
            self._destination(chat_id)
            await self._authorize()
            message_id = self._response_key(message_id)
            row = self.journal.db.execute("SELECT 1 FROM parts WHERE update_id=? AND key=?", (str(self.current["id"]), message_id)).fetchone()
            if row is None:
                raise SafetyError("Unknown invocation response key")
            payload = {"update_id": self.current["id"], "response_key": message_id}
            self.journal.db.execute("INSERT OR IGNORE INTO mutations(update_id,key,revision,hash,payload) VALUES(?,?,-1,?,?)",
                                    (str(self.current["id"]), message_id, digest(payload), packed(payload)))
            self.journal.db.commit()
            await self.broker.acall("bot_delete", **payload)
            self.journal.db.execute("UPDATE mutations SET delivered=1 WHERE update_id=? AND key=? AND revision=-1", (str(self.current["id"]), message_id))
            self.journal.db.commit()
            return True
        except Exception:
            if self.current:
                self.current["failed"] = True
            return False

    async def send_typing(self, chat_id, metadata=None):
        self._destination(chat_id)
        await self._authorize()
        await self.broker.acall("bot_typing", update_id=self.current["id"], typing=True)

    async def stop_typing(self, chat_id, metadata=None):
        if self.current:
            self._destination(chat_id)
            await self._authorize()
            await self.broker.acall("bot_typing", update_id=self.current["id"], typing=False)

    async def get_chat_info(self, chat_id):
        self._destination(chat_id)
        canonical = await self._authorize()
        return canonical.get("chat", {})

    async def _prompt(self, chat_id, session_key, kind, sdk_id, text, actions, completion=None):
        self._destination(chat_id)
        await self._authorize()
        nonce = secrets.token_hex(16)
        record = {"kind": kind, "sdk_id": sdk_id, "session": session_key, "update": self.current["id"],
                  "actor": self.actor, "channel": self.channel, "expires": time.time() + 300, "actions": actions}
        self.journal.db.execute("CREATE TABLE IF NOT EXISTS prompts(nonce TEXT PRIMARY KEY,payload TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)")
        self.journal.db.execute("INSERT INTO prompts(nonce,payload) VALUES (?,?)", (nonce, packed(record)))
        self.journal.db.commit()
        if completion is not None:
            record["completion"] = completion  # Process-local waiter, never serialized.
        self._prompts[nonce] = record
        suffix = "|".join(actions) if kind in ("approve", "slash") else "<answer text>"
        command = "sombra-confirm" if kind in ("approve", "slash") else "sombra-answer"
        result = await self.send(chat_id, text + "\n\nExplicit reply within 5 minutes: /" + command + "@" + getattr(self, "bot_handle", "hermes") + " " + nonce + " " + suffix)
        if not result.success:
            self._prompts.pop(nonce, None)
        return result

    async def _send_exec_approval_prompt(self, prompt):
        try:
            # Permanent approvals intentionally not offered across compartment policy revisions.
            actions = [choice for _, choice, _ in prompt.actions if choice in ("once", "session", "deny")]
            if not actions or not prompt.session_key:
                raise SafetyError("Unsupported SDK exec prompt")
            from tools.approval import list_gateway_approvals
            # Pinned runner redacts command and does NOT forward request_id; never match raw
            # command strings or resolve FIFO. Exactly one live SDK request is the safe seam.
            candidates = [entry for entry in list_gateway_approvals(prompt.session_key) if entry.get("request_id")]
            requested = (prompt.metadata or {}).get("request_id")
            if requested:
                candidates = [entry for entry in candidates if entry["request_id"] == requested]
            if len(candidates) != 1:
                raise SafetyError("Exec prompt cannot bind unambiguously to exact SDK request_id")
            from agent.redact import redact_sensitive_text
            candidate = candidates[0]
            # A scheduled older render may arrive after queue turnover. Render the exact
            # selected request snapshot, not stale prompt.text/actions; always redact secrets.
            actions = ["once", "deny"]
            if candidate.get("allow_session", True) is True and not candidate.get("smart_denied", False):
                actions.insert(1, "session")
            command = redact_sensitive_text(str(candidate.get("command", "")), force=True)
            description = redact_sensitive_text(str(candidate.get("description", "Requires explicit approval")), force=True)
            displayed = "Hermes requests approval for this exact pending operation:\n" + command + "\nReason: " + description
            return await self._prompt(prompt.chat_id, prompt.session_key, "approve", candidate["request_id"],
                                      displayed, actions)
        except Exception as exc:
            return SendResult(success=False, error=str(exc))

    async def send_clarify(self, chat_id, question, choices, clarify_id, session_key, metadata=None):
        try:
            if not clarify_id or not session_key:
                raise SafetyError("Unbound clarify prompt")
            from tools.clarify_gateway import get_pending
            pending = get_pending(clarify_id)
            if pending is None or pending.session_key != session_key or pending.question != question:
                raise SafetyError("Clarify SDK pending identity mismatch")
            text = str(question)
            if choices:
                text += "\n" + "\n".join(str(i + 1) + ". " + str(choice) for i, choice in enumerate(choices))
            # No mark_awaiting_text: only exact nonce command can resolve this prompt.
            return await self._prompt(chat_id, session_key, "answer", clarify_id, text, [])
        except Exception as exc:
            return SendResult(success=False, error=str(exc))

    async def send_slash_confirm(self, chat_id, title, message, session_key, confirm_id, metadata=None):
        try:
            from tools import slash_confirm
            if slash_confirm.clear_if_stale(session_key):
                raise SafetyError("Slash confirmation expired")
            pending = slash_confirm.get_pending(session_key)
            if not pending or pending.get("confirm_id") != confirm_id or not pending.get("handler"):
                raise SafetyError("Slash confirmation SDK session/id mismatch")
            completion = asyncio.Event()
            self.current.setdefault("slash_waiters", []).append(completion)
            # Presentation hook returns immediately as SDK expects. Our outer lifecycle
            # wrapper retains the original invocation until the control disposition is delivered.
            return await self._prompt(chat_id, session_key, "slash", confirm_id,
                                      str(title) + "\n" + str(message), ["once", "cancel"], completion=completion)
        except Exception as exc:
            return SendResult(success=False, error=str(exc))

    async def handle_control(self, update):
        """Only human-origin, exact anchored nonce commands; NEVER assistant/model text."""
        text = str(update.get("message", {}).get("text", ""))
        handles = "(?:hermes|" + re.escape(getattr(self, "bot_handle", "hermes")) + ")"
        match = re.fullmatch(r"(?:@" + handles + r"[ \t]+)?/sombra-(confirm|answer)(?:@" + handles + r")?[ \t]+([a-f0-9]{32})[ \t]+([^\r\n]+)", text)
        if not match or not self.current or update["update_id"] == self.current["id"]:
            return False  # Ordinary input stays queued, never merged into the active turn.
        command, nonce, response = match.groups()
        kind = "approve" if command == "confirm" else "answer"
        record = self._prompts.get(nonce)
        if record and record["kind"] == "slash" and command == "confirm":
            kind = "slash"
        if not record or record["kind"] != kind or record["expires"] < time.time():
            return False
        if record["update"] != self.current["id"] or record["actor"] != self.actor or record["channel"] != self.channel:
            return False
        if ident(update.get("sender")) != self.actor or ident(update.get("channel")) != self.channel:
            return False
        if kind in ("approve", "slash") and response not in record["actions"]:
            return False
        await self._authorize()  # Original source must still be unchanged and authorized.
        canonical = await self.broker.acall("bot_authorize_update", update_id=update["update_id"])
        if (str(canonical.get("update_id")) != str(update["update_id"])
                or ident(canonical.get("sender")) != self.actor or ident(canonical.get("channel")) != self.channel
                or ident(canonical.get("bot_id")) != self.bot_id or canonical.get("access", {}).get("trusted") is not True):
            return False
        # Consume durably BEFORE the resolver; no repeated approval after timeout/crash/replay.
        cursor = self.journal.db.execute("UPDATE prompts SET consumed=1 WHERE nonce=? AND consumed=0", (nonce,))
        self.journal.db.commit()
        self._prompts.pop(nonce, None)
        if cursor.rowcount != 1:
            return False
        if kind == "approve":
            from tools.approval import resolve_gateway_approval
            resolved = resolve_gateway_approval(record["session"], response, request_id=record["sdk_id"])
        elif kind == "slash":
            from tools import slash_confirm
            if slash_confirm.clear_if_stale(record["session"]):
                return False
            pending = slash_confirm.get_pending(record["session"])
            if not pending or pending.get("confirm_id") != record["sdk_id"]:
                return False
            # This resolver atomically consumes exact session/id before executing; None is
            # ambiguous (valid handler may return None), so NEVER report it as Approved.
            result_text = await slash_confirm.resolve(record["session"], record["sdk_id"], response)
            resolved = True
        else:
            from tools.clarify_gateway import resolve_gateway_clarify, get_pending
            pending = get_pending(record["sdk_id"])
            if pending is None or pending.session_key != record["session"]:
                return False
            if pending.choices and response.isdigit():
                index = int(response) - 1
                if not 0 <= index < len(pending.choices):
                    return False
                response = str(pending.choices[index])
            resolved = resolve_gateway_clarify(record["sdk_id"], response)
        # SDK evidence: approval returns waiter count; clarify returns boolean. No fake Approved.
        if not resolved:
            return False
        if kind == "slash":
            status = "Ответ передан; результат не подтверждён." if result_text is None else "Ответ передан обработчику подтверждения.\n" + result_text
        else:
            status = "Approval denied." if kind == "approve" and response == "deny" else ("Approved." if kind == "approve" else "Answer accepted.")
        control_id = update["update_id"]
        self.journal.begin(control_id, digest(update))
        chunks = [status[i:i + 2000] for i in range(0, len(status), 2000)]
        if len(chunks) > 32:
            chunks = ["Control was consumed, but handler output exceeds the 32-part delivery budget; manual result check required."]
        # Persist every exact response part before starting network delivery.
        payloads = [{"update_id": control_id, "response_key": "control_status_" + str(i).zfill(2), "text": chunk}
                    for i, chunk in enumerate(chunks)]
        for payload in payloads:
            self.journal.part(control_id, payload["response_key"], payload)
        for payload in payloads:
            await self.broker.acall("bot_reply", **payload)
            self.journal.delivered(control_id, payload["response_key"])
        await self.broker.acall("bot_ack", update_id=control_id)
        self.journal.state(control_id, "ACKED")
        if record.get("completion") is not None:
            record["completion"].set()
        return True


def pre_tool_call(**kwargs):
    """Pinned SDK policy hook; other platforms remain untouched in shared-host mode."""
    if os.environ.get("SOMBRA_MODE") == "shared_host":
        from .shared_host import shared_pre_tool_call
        return shared_pre_tool_call(**kwargs)
    try:
        if _ACTIVE is None:
            raise SafetyError("No active isolated Sombra transport")
        _ACTIVE.authorize()
    except Exception:
        return {"action": "block", "message": "Sombra fresh actor/channel authorization unavailable; tool blocked"}
    return None


def register(ctx):
    shared = os.environ.get("SOMBRA_MODE") == "shared_host"
    if shared:
        from .shared_host import HOST_ACK, SharedHostAdapter
        if os.environ.get("SOMBRA_SHARED_HOST_ACK") != HOST_ACK:
            raise SafetyError("Explicit shared-host risk acknowledgement required")
        factory = SharedHostAdapter
        # Non-principal sentinel suppresses pairing, never grants all users. The adapter's
        # public resolved_allowlist_user_ids returns ONLY current fresh canonical trusted ID.
        allowed = "__sombra_canonical_backend_policy__"
        required = ["SOMBRA_API_URL", "SOMBRA_STATE_DIR"]
    else:
        actor = os.environ.get("SOMBRA_ACTOR_ID", "")
        if not actor or any(c in actor for c in ",* \t\r\n"):
            raise SafetyError("Exact stable Sombra actor ID required")
        factory, allowed = SombraAdapter, actor
        required = ["SOMBRA_API_URL", "SOMBRA_API_TOKEN", "SOMBRA_ACTOR_ID", "SOMBRA_CHANNEL_ID", "SOMBRA_STATE_DIR"]
    os.environ["SOMBRA_ALLOWED_USERS"] = allowed
    os.environ["SOMBRA_DM_POLICY"] = "allowlist"
    os.environ["SOMBRA_GROUP_POLICY"] = "allowlist"
    ctx.register_hook("pre_tool_call", pre_tool_call)
    if shared:
        from .shared_host import bind_shared_agent_session
        ctx.register_hook("pre_llm_call", bind_shared_agent_session)
        from .native_tools import register as register_native_tools
        register_native_tools(ctx)
    ctx.register_platform(name="sombra", label="Sombra", adapter_factory=factory,
                          check_fn=lambda: True, required_env=required,
                          allowed_users_env="SOMBRA_ALLOWED_USERS", own_policy_env=("SOMBRA_DM_POLICY", "SOMBRA_GROUP_POLICY"),
                          allowlist_suppresses_pairing=True, max_message_length=2000, platform_hint=HINT,
                          display_overrides={"tool_progress": "off", "busy_ack_detail": False})
