"""Typed Sombra-only capabilities. No generic API, host path, or Telegram access."""
from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import stat
import tempfile

MAX_SOUL = 32768
OWNER_ONLY = "Настройки доступны владельцу в личке"
EMOJI = ("👍", "❤️", "😂", "🔥", "🎉", "👀")


class AvatarInputError(ValueError):
    """A safe fixed UI hint, never a filesystem or broker error."""



def _adapter():
    from .shared_host import get_current_adapter
    return get_current_adapter()


async def _live(expected=None):
    adapter = _adapter()
    if expected is not None and adapter is not expected:
        raise ValueError("Invocation changed")
    uid = adapter.current["id"]
    canonical = await adapter._authorize()
    if (not isinstance(canonical, dict) or _adapter() is not adapter or not adapter.current
            or adapter.current["id"] != uid):
        raise ValueError("No live canonical invocation")
    return adapter, uid


async def _owner(expected=None):
    adapter, uid = await _live(expected)
    # The backend checks actual owner identity AND actual two-member private DM.
    result = await adapter.broker.acall("bot_get_settings", update_id=uid)
    if (_adapter() is not adapter or not adapter.current or adapter.current["id"] != uid
            or not isinstance(result, dict)
            or not all(k in result for k in ("profile", "conversation", "revision"))):
        raise ValueError("Owner authorization unavailable")
    return adapter, uid, result


def _clean_settings(value):
    # Explicit projection: never echo transport credentials, API errors, or raw bot data.
    return {"profile": {k: value["profile"][k] for k in ("name", "bio", "avatar") if k in value["profile"]},
            "revision": value["revision"],
            "conversation": {k: value["conversation"][k] for k in
                             ("mode", "aliases", "followupSeconds", "followupMessages", "reactions")
                             if k in value["conversation"]}}


def _keys(value, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError("Unsupported fields")


def _text(value, maximum, minimum=0):
    if not isinstance(value, str) or not minimum <= len(value) <= maximum or "\0" in value:
        raise ValueError("Invalid text")
    return value


def _safe_path(path):
    path = Path(path)
    if not path.is_absolute():
        raise ValueError("Absolute protected path required")
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError("Links forbidden")
        if item.exists():
            info = item.lstat()
            if getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
                raise ValueError("Reparse point forbidden")
    return path


def _soul_path(adapter):
    profile = adapter.profile
    if profile in ("", "default") or not profile.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Dedicated profile required")
    env = adapter.env  # Operator configuration snapshot, never model arguments.
    root = _safe_path(env.get("SOMBRA_PROFILE_ROOT", f"/home/hermes/.hermes/profiles/{profile}"))
    path = _safe_path(env.get("SOMBRA_SOUL_FILE", str(root / "SOUL.md")))
    if root.name != profile or path != root / "SOUL.md" or not root.is_dir():
        raise ValueError("SOUL must belong to exact configured profile root")
    if os.name == "posix" and root.stat().st_mode & 0o022:
        raise ValueError("Profile root is writable by others")
    if path.exists():
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or (os.name == "posix" and info.st_mode & 0o077):
            raise ValueError("Private regular SOUL required")
    return path


def _soul_text(text):
    if not isinstance(text, str) or "\0" in text:
        raise ValueError("Invalid persona text")
    data = text.encode("utf-8", errors="strict")
    if len(data) > MAX_SOUL:
        raise ValueError("Persona exceeds 32 KiB")
    return data


def _read_soul(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_SOUL + 1)
    if len(data) > MAX_SOUL:
        raise ValueError("Persona exceeds 32 KiB")
    text = data.decode("utf-8", errors="strict")
    _soul_text(text)
    return text


async def personality(args):
    _keys(args, ("action", "text"))
    adapter, uid, _ = await _owner()
    path = _soul_path(adapter)
    if args.get("action") == "get" and "text" not in args:
        return {"text": _read_soul(path)}
    if args.get("action") != "set":
        raise ValueError("Invalid action")
    data = _soul_text(args.get("text"))
    fd, temporary = tempfile.mkstemp(prefix=".soul-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.chmod(temporary, 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        _, fresh_uid, _ = await _owner(adapter)
        if fresh_uid != uid or _soul_path(adapter) != path:
            raise ValueError("Invocation changed")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"saved": True, "requires_new_session": True,
            "instruction": "Начните новую сессию Сомбры командой /reset. Текущий контекст не перезагружен."}


def _avatar(adapter, index):
    if type(index) is not int or index < 0:
        raise ValueError("Trusted image index required")
    # Populated exclusively by trusted input/generation code for this current invocation.
    scope = adapter._scope()
    inputs = adapter.current.get("native_avatar_inputs", ())
    if index >= len(inputs):
        raise ValueError("Staged image unavailable")
    record = inputs[index]
    if not isinstance(record, dict) or str(record.get("update_id")) != str(adapter.current["id"]):
        raise ValueError("Stale staged image")
    path = _safe_path(record["path"])
    generated = _safe_path(adapter.state_dir / "artifacts").resolve()
    inbound = _safe_path(adapter.state_dir / "inbound").resolve()
    if not any(path.resolve().is_relative_to(root) for root in (generated, inbound)):
        raise ValueError("Image outside authorized scope")
    if not path.is_file() or path.stat().st_size > 262144:
        raise AvatarInputError("Avatar exceeds 256 KiB")
    with path.open("rb") as stream:
        data = stream.read(262145)
    if len(data) > 262144:
        raise AvatarInputError("Avatar exceeds 256 KiB")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        raise ValueError("PNG/JPEG/WebP required")
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


async def settings(args):
    _keys(args, ("action", "profile", "conversation", "revision"))
    adapter, uid, current = await _owner()
    if args.get("action") == "get" and set(args) == {"action"}:
        return _clean_settings(current)
    if args.get("action") != "update" or type(args.get("revision")) is not int or args["revision"] < 0:
        raise ValueError("Explicit current revision required")
    params = {"revision": args["revision"]}
    if "profile" in args:
        profile = args["profile"]
        _keys(profile, ("name", "bio", "avatar_index", "clear_avatar"))
        out = {}
        for key, limit, minimum in (("name", 32, 1), ("bio", 512, 0)):
            if key in profile:
                out[key] = _text(profile[key], limit, minimum)
        if "avatar_index" in profile and "clear_avatar" in profile:
            raise ValueError("Choose one avatar operation")
        if "avatar_index" in profile:
            out["avatar"] = _avatar(adapter, profile["avatar_index"])
        if "clear_avatar" in profile:
            if profile["clear_avatar"] is not True:
                raise ValueError("Invalid clear flag")
            out["avatar"] = ""
        params["profile"] = out
    if "conversation" in args:
        conversation = args["conversation"]
        _keys(conversation, ("mode", "aliases", "followupSeconds", "followupMessages", "reactions"))
        if "mode" in conversation and conversation["mode"] not in ("addressed", "name_dialog"):
            raise ValueError("Invalid mode")
        for key, limit in (("followupSeconds", 600), ("followupMessages", 20)):
            if key in conversation and (type(conversation[key]) is not int or not 0 <= conversation[key] <= limit):
                raise ValueError("Invalid followup bound")
        if "reactions" in conversation and type(conversation["reactions"]) is not bool:
            raise ValueError("Boolean required")
        if "aliases" in conversation:
            aliases = conversation["aliases"]
            if not isinstance(aliases, list) or len(aliases) > 20:
                raise ValueError("Invalid aliases")
            for alias in aliases:
                _text(alias, 64, 1)
                if alias != alias.strip() or any(ord(c) < 32 for c in alias):
                    raise ValueError("Invalid alias")
        params["conversation"] = dict(conversation)
    if not ("profile" in params or "conversation" in params):
        raise ValueError("No chosen settings")
    _, fresh_uid = await _live(adapter)
    if uid != fresh_uid:
        raise ValueError("Invocation changed")
    result = await adapter.broker.acall("bot_update_self", update_id=uid, **params)
    return _clean_settings(result)


async def react(args):
    _keys(args, ("emoji", "enabled"))
    if args.get("emoji") not in EMOJI or type(args.get("enabled", True)) is not bool:
        raise ValueError("Invalid reaction")
    adapter, uid = await _live()
    await adapter.broker.acall("bot_react", update_id=uid, emoji=args["emoji"], enabled=args.get("enabled", True))
    return {"ok": True, "emoji": args["emoji"], "enabled": args.get("enabled", True)}


async def settings_response(adapter, payload=None):
    try:
        actual, _, result = await _owner(adapter)
        return {"text": "Настройки Сомбры: " + json.dumps(_clean_settings(result), ensure_ascii=False) +
                "\nПопросите изменить конкретные поля; личность — отдельный SOUL Сомбры. Изменение личности действует в новой сессии /reset.", "media": []}
    except Exception:
        return {"text": OWNER_ONLY, "media": []}


def _schema(name, description, properties, required):
    return {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": required, "additionalProperties": False}}


def register(ctx):
    definitions = [
        ("sombra_react", react, {"emoji": {"type": "string", "enum": list(EMOJI)}, "enabled": {"type": "boolean"}}, ["emoji"], "React only to the current original Sombra message."),
        ("sombra_bot_settings", settings, {"action": {"type": "string", "enum": ["get", "update"]}, "revision": {"type": "integer", "minimum": 0},
         "profile": {"type": "object", "additionalProperties": False, "properties": {"name": {"type": "string", "maxLength": 32, "minLength": 1}, "bio": {"type": "string", "maxLength": 512}, "avatar_index": {"type": "integer", "minimum": 0}, "clear_avatar": {"type": "boolean"}}},
         "conversation": {"type": "object", "additionalProperties": False, "properties": {"mode": {"type": "string", "enum": ["addressed", "name_dialog"]}, "aliases": {"type": "array", "maxItems": 20, "items": {"type": "string", "minLength": 1, "maxLength": 64}}, "followupSeconds": {"type": "integer", "minimum": 0, "maximum": 600}, "followupMessages": {"type": "integer", "minimum": 0, "maximum": 20}, "reactions": {"type": "boolean"}}}}, ["action"], "Owner-only actual private DM settings; get then update chosen fields with CAS revision; no conflict retry."),
        ("sombra_personality", personality, {"action": {"type": "string", "enum": ["get", "set"]}, "text": {"type": "string", "maxLength": MAX_SOUL}}, ["action"], "Owner private-DM only: own Sombra SOUL text; never Telegram memory. Changes require a new session.")]
    for name, function, properties, required, description in definitions:
        async def handler(args, _function=function, **kwargs):
            try:
                result = await _function(args)
                return json.dumps(result, ensure_ascii=False)
            except AvatarInputError:
                return json.dumps({"error": "Аватар должен быть PNG, JPEG или WebP до 256 КиБ. Обрежьте и уменьшите изображение в редакторе аватара и отправьте снова."}, ensure_ascii=False)
            except Exception:
                # Broker errors may embed transport secrets. Never serialize exceptions.
                return json.dumps({"error": OWNER_ONLY if _function in (settings, personality) else "Sombra tool unavailable"}, ensure_ascii=False)
        ctx.register_tool(name=name, toolset="sombra", schema=_schema(name, description, properties, required), handler=handler, is_async=True, description=description)
