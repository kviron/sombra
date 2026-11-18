"""Deterministic Sombra frame/cover skill: intent, document whitelists, one-shot confirmation.

Nothing here calls a model, reads a profile or touches the network. The module turns a chat
sentence (or ``/frame``) into a v1 decoration document, mirrors the backend whitelists so an
unsupported document is refused locally instead of being sent and rejected, and keeps the
pending confirmation in the scope's own SQLite journal. The backend applies the document to
the profile of the sender of the confirming update, exactly once per update.

Whitelists mirror ``src/backend/profile_decorations.rs`` and
``ui/shared/ui/avatar-fx/{presets,normalize,palettes,types}.ts``; presets mirror
``DECORATION_PRESETS``. The document is plain JSON: no URLs, no images, no executable data.
"""
from __future__ import annotations

import json
import math
import re
import secrets
import time

VERSION = 1
TTL = 300
MAX_LAYERS = 3
MAX_BYTES = 4096
SEED_MAX = 0xFFFFFFFF
TARGETS = ("avatar", "cover")
MODES = ("frame", "scene")
TOP_KEYS = frozenset({"v", "target", "mode", "loop", "seed", "layers"})
LAYER_KEYS = frozenset({"effect", "palette", "anchor", "intensity", "scale", "flip"})
ANCHORS = ("ring", "bottom-right", "bottom-left", "top-right", "top-left", "fill", "runner")
# Same list as ``NAMED_PALETTES`` (palettes.ts) and the server's ``PALETTES``.
PALETTES = ("aurora", "ember", "fire", "lava", "gold", "holy", "arcane", "ice", "poison",
            "heal", "candy", "neon", "cyber", "shadow", "leaf")
# Server ``effect_anchors``: an effect exists only for one target and a short anchor list there.
EFFECTS = {
    "holy/divine-shield": {"avatar": ("ring",)},
    "critters/slime": {"avatar": ("bottom-right", "bottom-left", "top-right", "top-left")},
    "weather/aurora": {"cover": ("fill",)},
    "sombra/runner": {"cover": ("runner",)},
}
SCENE_EFFECT = "sombra/runner"
HEX = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\Z")
NONCE = re.compile(r"[0-9a-f]{32}\Z")

# Ready-made documents, byte-for-byte the client's ``DECORATION_PRESETS``.
PRESETS = {
    "ember-crown": {
        "title": "Пламенный обод", "target": "avatar", "seed": 19,
        "description": "огненное кольцо по краю аватара",
        "layers": [{"effect": "holy/divine-shield", "palette": "ember", "anchor": "ring", "intensity": 0.9}],
    },
    "slime-pet": {
        "title": "Слайм-питомец", "target": "avatar", "seed": 7,
        "description": "прыгающий слайм в углу аватара",
        "layers": [{"effect": "critters/slime", "palette": "poison", "anchor": "bottom-right", "intensity": 0.85}],
    },
    "aurora-cover": {
        "title": "Сияние на обложке", "target": "cover", "seed": 11,
        "description": "северное сияние поверх обложки профиля",
        "layers": [{"effect": "weather/aurora", "palette": "aurora", "anchor": "fill", "intensity": 0.8}],
    },
    "runner-cover": {
        "title": "Бегущий по обложке", "target": "cover", "seed": 11, "mode": "scene", "loop": True,
        "description": "пиксельная сцена с бегущим силуэтом на обложке",
        "layers": [{"effect": "weather/aurora", "palette": "aurora", "anchor": "fill", "intensity": 0.75},
                   {"effect": "sombra/runner", "palette": "ice", "anchor": "runner", "intensity": 0.9}],
    },
}
PRESET_ORDER = ("ember-crown", "slime-pet", "aurora-cover", "runner-cover")
PRESET_ALIASES = {
    "ember-crown": ("ember", "ember-crown", "огон", "огненн", "пламя", "пламен", "fire", "жар"),
    "slime-pet": ("slime", "slime-pet", "critters", "слайм", "слиз", "питомец"),
    "aurora-cover": ("aurora", "aurora-cover", "аврора", "сияни", "звезд", "северн", "полярн"),
    "runner-cover": ("runner", "runner-cover", "sombra/runner", "бегущ", "бегун", "сцен", "геро", "scene"),
}
COVER_NOUNS = (r"\bобложк\w*", r"\bcover\b", r"\bшапк\w*", r"\bбаннер\w*",
               r"\bсцен(?:а|у|е|ой|ы|ам|ах|ами)?\b")
AVATAR_NOUNS = (r"\bаватар\w*", r"\bavatar\b", r"\bрамк\w*", r"\bрамоч\w*", r"\bпрофил\w*")
ANCHOR_PATTERNS = (("bottom-left", (r"\bслев\w*", r"\bлев\w*", r"\bleft\b")),
                   ("bottom-right", (r"\bсправ\w*", r"\bправ\w*", r"\bright\b")))

# Explicit imperatives/infinitives only: a participle or a question never mutates a profile.
MAKE_VERBS = (r"\bсделай(?:те)?\b", r"\bсделать\b", r"\bсделаю\b", r"\bсоздай(?:те)?\b", r"\bсоздать\b",
              r"\bпоставь(?:те)?\b", r"\bпоставить\b", r"\bустанови(?:те)?\b", r"\bустановить\b",
              r"\bдобавь(?:те)?\b", r"\bдобавить\b", r"\bпримени(?:те)?\b", r"\bприменить\b",
              r"\bвключи(?:те)?\b", r"\bвключить\b", r"\bповесь(?:те)?\b", r"\bповесить\b",
              r"\bхочу\b", r"\bхотел[аи]?\b", r"\bдай(?:те)?\b", r"\bсмени(?:те)?\b", r"\bсменить\b",
              r"\bзамени(?:те)?\b", r"\bзаменить\b", r"\bпоменяй(?:те)?\b", r"\bпоменять\b",
              r"\bобнови(?:те)?\b", r"\bобновить\b", r"\bукрась(?:те)?\b", r"\bукрасить\b",
              r"\bнаряди(?:те)?\b", r"\bпоставьте\b")
REMOVE_VERBS = (r"\bубери(?:те)?\b", r"\bубрать\b", r"\bуберу\b", r"\bсними(?:те)?\b", r"\bснять\b",
                r"\bснимать\b", r"\bудали(?:те)?\b", r"\bудалить\b", r"\bочисти(?:те)?\b", r"\bочистить\b",
                r"\bотключи(?:те)?\b", r"\bотключить\b", r"\bсбрось(?:те)?\b", r"\bсбросить\b")
EFFECT_NOUNS = {
    "ember-crown": (r"\bогон\w*", r"\bогненн\w*", r"\bпламя\b", r"\bпламен\w*", r"\bember\b",
                    r"\bfire\b", r"\bжар\w*"),
    "slime-pet": (r"\bслайм\w*", r"\bслиз\w*", r"\bslime\b", r"\bкриттер\w*", r"\bпитомец\b",
                  r"\bпитомц\w*"),
    "aurora-cover": (r"\bсияни\w*", r"\bзвезд\w*", r"\bаврор\w*", r"\baurora\b", r"\bсеверн\w*",
                     r"\bполярн\w*"),
    "runner-cover": (r"\bбегущ\w*", r"\bбегун\w*", r"\brunner\b", r"\bгеро\w*", r"\bперсонаж\w*",
                     r"\bсцен(?:а|у|е|ой|ы|ам|ах|ами)?\b", r"\bscene\b"),
}
DECORATION_NOUNS = (r"\bрамк\w*", r"\bрамоч\w*", r"\bукрашени\w*", r"\bэффект\w*", r"\bпресет\w*",
                    r"\bдекораци\w*", r"\bоформлени\w*", r"\bframe\b", r"\bavatar\b", r"\bcover\b",
                    r"\bаватар\w*", r"\bпрофил\w*", r"\bобложк\w*", r"\bшапк\w*", r"\bбаннер\w*")

PROBLEMS = {
    "TARGET": "Непонятно, что менять: аватар (рамка) или обложка.",
    "SCHEMA": "Документ украшения не соответствует формату v1.",
    "VERSION": "Поддерживается только версия документа v=1.",
    "MODE": "Режим mode — только frame или scene, а scene допустим только для обложки.",
    "SCENE": "Бегущий персонаж sombra/runner работает только в режиме scene на обложке.",
    "LOOP": "loop должен быть true или false.",
    "SEED": "seed — целое число от 0 до 4294967295.",
    "LAYERS": "Разрешено от 1 до 3 слоёв.",
    "LAYER": "Слой должен быть объектом только с полями effect, palette, anchor, intensity, scale, flip.",
    "EFFECT": "Такого эффекта нет. Доступны: holy/divine-shield, critters/slime, weather/aurora, sombra/runner.",
    "TARGET_MISMATCH": "Этот эффект не работает для выбранной цели.",
    "PALETTE": "Палитра — название из списка или 3–12 цветов вида #rgb/#rrggbb.",
    "ANCHOR": "Якорь не подходит этому эффекту.",
    "RANGE": "intensity — от 0 до 1, scale — от 0.5 до 2.",
    "FLIP": "flip должен быть true или false.",
    "TOO_LARGE": "Документ больше 4096 байт.",
    "CONFIRM": "Нужна точная команда /frame confirm <32 hex-символа>.",
    "NO_EFFECT": "Не понял, какое украшение нужно.",
    "UNKNOWN": "Непонятная команда рамки.",
}
NO_CHANGE = "Профиль не изменён."
SHORT_HELP = ("Пресеты: ember (огненная рамка), slime (слайм на аватаре), aurora (сияние на обложке), "
              "runner (бегущая сцена на обложке). Команды: /frame <пресет>, /frame remove [avatar|cover], "
              "/frame json <документ>, /frame confirm <nonce>.")
REFUSALS = {
    "BOT_DECORATION_CONFLICT": "Украшение уже применено или подтверждение истекло — попросите заново.",
    "BOT_DECORATION_FORBIDDEN": "Сервер отклонил изменение: нет прав на это украшение.",
    "BOT_DECORATION_INVALID": "Сервер отклонил документ украшения.",
    "BOT_SOURCE_UNAVAILABLE": "Исходное сообщение больше не активно — повторите команду.",
    "AUTH_REQUIRED": "Сервер не принял бот-токен для изменения профиля.",
}
NONCE_REFUSAL = ("Подтверждение недействительно: истекло, уже использовано или выдано другому "
                 "аккаунту или чату. " + NO_CHANGE + " — попросите украшение заново.")


def packed(value):
    """Compact JSON, the same measurement the backend applies to the stored document."""
    return json.dumps(value, sort_keys=False, ensure_ascii=False, separators=(",", ":"))


def _document(target, layers, seed, mode=None, loop=None):
    document = {"v": VERSION, "target": target, "seed": seed, "layers": layers}
    if mode:
        document["mode"] = mode
    if loop is not None:
        document["loop"] = loop
    return document


def preset_document(name, anchor=None):
    """One preset as a plain v1 document; ``anchor`` only repositions the slime."""
    preset = PRESETS[name]
    layers = [dict(layer) for layer in preset["layers"]]
    if anchor and name == "slime-pet":
        if anchor in EFFECTS["critters/slime"]["avatar"]:
            layers[0]["anchor"] = anchor
    return _document(preset["target"], layers, preset["seed"], preset.get("mode"), preset.get("loop"))


def _number(value, minimum, maximum):
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and math.isfinite(value) and minimum <= value <= maximum)


def _seed(value):
    return type(value) is int and 0 <= value <= SEED_MAX


def _palette(value):
    if isinstance(value, str):
        return value in PALETTES
    if isinstance(value, list) and 3 <= len(value) <= 12:
        return all(isinstance(entry, str) and HEX.match(entry) for entry in value)
    return False


def _size(value):
    try:
        return len(packed(value).encode("utf-8"))
    except (TypeError, ValueError):
        return MAX_BYTES + 1


def validate(target, value):
    """Strict v1 validation -> ``(canonical_document, "")`` or ``(None, problem_code)``.

    The accepted input is never forwarded as-is: the canonical document is rebuilt from the
    whitelisted fields, in the fixed server shape, and re-measured at 4096 bytes.
    """
    if target not in TARGETS:
        return None, "TARGET"
    if not isinstance(value, dict):
        return None, "SCHEMA"
    if _size(value) > MAX_BYTES:
        return None, "TOO_LARGE"
    if set(value) - TOP_KEYS:
        return None, "SCHEMA"
    if type(value.get("v")) is not int or value.get("v") != VERSION:
        return None, "VERSION"
    if value.get("target") != target:
        return None, "TARGET"
    scene = False
    if "mode" in value:
        mode = value.get("mode")
        if mode not in MODES or (mode == "scene" and target != "cover"):
            return None, "MODE"
        scene = mode == "scene"
    if "loop" in value and type(value.get("loop")) is not bool:
        return None, "LOOP"
    if "seed" in value and not _seed(value.get("seed")):
        return None, "SEED"
    layers = value.get("layers")
    if not isinstance(layers, list) or not 1 <= len(layers) <= MAX_LAYERS:
        return None, "LAYERS"
    canonical_layers = []
    for layer in layers:
        if not isinstance(layer, dict) or set(layer) - LAYER_KEYS:
            return None, "LAYER"
        effect = layer.get("effect")
        if not isinstance(effect, str) or effect not in EFFECTS:
            return None, "EFFECT"
        anchors = EFFECTS[effect].get(target)
        if not anchors:
            return None, "TARGET_MISMATCH"
        if effect == SCENE_EFFECT and not scene:
            return None, "SCENE"
        layer_out = {"effect": effect}
        if "palette" in layer:
            if not _palette(layer["palette"]):
                return None, "PALETTE"
            layer_out["palette"] = layer["palette"]
        if "anchor" in layer:
            anchor = layer["anchor"]
            if not isinstance(anchor, str) or anchor not in ANCHORS or anchor not in anchors:
                return None, "ANCHOR"
            layer_out["anchor"] = anchor
        if "intensity" in layer:
            if not _number(layer["intensity"], 0, 1):
                return None, "RANGE"
            layer_out["intensity"] = layer["intensity"]
        if "scale" in layer:
            if not _number(layer["scale"], 0.5, 2):
                return None, "RANGE"
            layer_out["scale"] = layer["scale"]
        if "flip" in layer:
            if type(layer["flip"]) is not bool:
                return None, "FLIP"
            layer_out["flip"] = layer["flip"]
        canonical_layers.append(layer_out)
    canonical = {"v": VERSION, "target": target}
    for key in ("mode", "loop", "seed"):
        if key in value:
            canonical[key] = value[key]
    canonical["layers"] = canonical_layers
    if _size(canonical) > MAX_BYTES:
        return None, "TOO_LARGE"
    return canonical, ""


def _clean(text):
    value = str(text or "").strip().lower().replace("ё", "е")
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"^(?:@[A-Za-z0-9_]{1,64}\s+)+", "", value)
    value = re.sub(r"^/(?:ask|ai)(?:@[A-Za-z0-9_]{1,64})?\s+", "", value)
    return value


def _any(patterns, text):
    return any(re.search(pattern, text) for pattern in patterns)


def _effect(text):
    for name in PRESET_ORDER:
        if _any(EFFECT_NOUNS[name], text):
            return name
    return None


def _target(text):
    cover = _any(COVER_NOUNS, text)
    avatar = _any(AVATAR_NOUNS, text)
    if cover and not avatar:
        return "cover"
    if avatar and not cover:
        return "avatar"
    return None


def _anchor(text):
    for anchor, patterns in ANCHOR_PATTERNS:
        if _any(patterns, text):
            return anchor
    return None


def _preset_word(words):
    for word in words[:1]:
        clean = word.strip("«»\"'.,!?;:")
        for name in PRESET_ORDER:
            for alias in PRESET_ALIASES[name]:
                if clean == alias or (clean.startswith(alias) and len(clean) - len(alias) <= 3):
                    return name
    return None


def describe(target, document, label=""):
    """(title, detail) for a document or a removal; never echoes the raw JSON."""
    if document is None:
        return ("", "")
    for name in PRESET_ORDER:
        if label == PRESETS[name]["title"]:
            return PRESETS[name]["title"], PRESETS[name]["description"]
    effects = [str(layer.get("effect", "")) for layer in document.get("layers", []) if isinstance(layer, dict)]
    detail = "слои: " + ", ".join(effects[:MAX_LAYERS]) if effects else "свой документ"
    return (label or "Свой вариант"), detail


def help_text():
    lines = ["Рамки и обложки Сомбры — меняется только ваш профиль, и только после подтверждения.",
             "Пресеты (/frame <пресет>):"]
    for name in PRESET_ORDER:
        preset = PRESETS[name]
        lines.append("- " + name.split("-")[0] + " — «" + preset["title"] + "»: " + preset["description"] + ".")
    lines.append("Команды: /frame <пресет>, /frame remove [avatar|cover], /frame json <документ>, "
                 "/frame confirm <nonce>.")
    return "\n".join(lines)


def hint_text(code="", extra=""):
    reason = PROBLEMS.get(code, PROBLEMS["UNKNOWN"])
    if code == "TARGET_MISMATCH" and extra:
        reason = extra
    return reason + "\n" + NO_CHANGE + "\n" + SHORT_HELP


def target_mismatch_text(preset):
    if PRESETS[preset]["target"] == "avatar":
        return ("«" + PRESETS[preset]["title"] + "» ставится только на аватар. Для обложки доступны "
                "сияние (aurora) и бегущая сцена (runner).")
    return ("«" + PRESETS[preset]["title"] + "» ставится только на обложку. Для аватара доступны "
            "огненная рамка (ember) и слайм (slime).")


def proposal_text(handle, target, document, label, nonce, ttl=TTL):
    title, detail = describe(target, document, label)
    if document is None:
        what = "удаление " + ("рамки с аватара" if target == "avatar" else "обложки")
    else:
        what = ("рамку на аватар" if target == "avatar" else "обложку") + " «" + title + "»"
        if detail:
            what += " (" + detail + ")"
    minutes = max(1, int(round(ttl / 60)))
    return ("Применю " + what + ".\n"
            "Профиль пока не изменён. Подтвердите в течение " + str(minutes) + " минут точной командой:\n"
            "/frame@" + str(handle) + " confirm " + nonce)


def success_text(target, document, label):
    if document is None:
        head = "Рамка убрана с вашего аватара." if target == "avatar" else "Обложка убрана."
        return head + " Профиль обновлён."
    title, detail = describe(target, document, label)
    head = "Рамка применена: «" + title + "»" if target == "avatar" else "Обложка применена: «" + title + "»"
    if detail:
        head += " — " + detail
    return head + ". Профиль обновлён: изменение увидят другие пользователи."


def refusal_text(code):
    message = REFUSALS.get(code or "")
    if message is None:
        if code == "nonce":
            return NONCE_REFUSAL
        return "Сервер не подтвердил изменение. " + NO_CHANGE
    return message + " " + NO_CHANGE


def uncertain_text():
    """A reply we cannot verify: never claim success and never claim nothing happened."""
    return ("Сервер ответил неожиданным результатом — проверьте аватар и обложку в профиле. "
            "Повторная запись не выполняется.")


def parse_command(text, handle="hermes"):
    """``/frame ...`` forms only. Returns the same request dicts as :func:`parse_intent`."""
    handles = "(?:hermes|" + re.escape(str(handle)) + ")"
    pattern = r"(?:@" + handles + r"[ \t]+)?/frame(?:@" + handles + r")?(?:[ \t]+([\s\S]*))?"
    match = re.fullmatch(pattern, str(text or ""), re.IGNORECASE)
    if not match:
        return None
    args = (match.group(1) or "").strip()
    if not args:
        return {"kind": "list"}
    lowered = args.lower().replace("ё", "е")
    words = lowered.split()
    if words[0] == "confirm":
        if len(words) == 2 and NONCE.match(words[1]):
            return {"kind": "confirm", "nonce": words[1]}
        return {"kind": "hint", "text": hint_text("CONFIRM")}
    if words[0] in ("remove", "off", "clear", "delete", "убрать", "убери", "снять", "сними", "удалить", "удали"):
        target = "avatar"
        if len(words) > 1:
            if len(words) != 2:
                return {"kind": "hint", "text": hint_text("TARGET")}
            target = _target(words[1])
            if target is None:
                return {"kind": "hint", "text": hint_text("TARGET")}
        return {"kind": "remove", "target": target, "doc": None, "label": ""}
    if words[0] in ("json", "документ"):
        body = args.split(None, 1)[1].strip() if len(words) > 1 else ""
        if not body:
            return {"kind": "hint", "text": hint_text("SCHEMA")}
        if len(body) > MAX_BYTES * 2:
            return {"kind": "hint", "text": hint_text("TOO_LARGE")}
        try:
            value = json.loads(body)
        except (TypeError, ValueError):
            return {"kind": "hint", "text": hint_text("SCHEMA")}
        if not isinstance(value, dict) or value.get("target") not in TARGETS:
            return {"kind": "hint", "text": hint_text("TARGET")}
        document, error = validate(value["target"], value)
        if error:
            return {"kind": "hint", "text": hint_text(error)}
        return {"kind": "propose", "target": document["target"], "doc": document,
                "label": "Свой вариант", "preset": ""}
    preset = _preset_word(words)
    if preset is None or len(words) > 2:
        return {"kind": "hint", "text": hint_text("UNKNOWN")}
    anchor = _anchor(lowered) if preset == "slime-pet" else None
    return {"kind": "propose", "target": PRESETS[preset]["target"], "preset": preset,
            "doc": preset_document(preset, anchor), "label": PRESETS[preset]["title"]}


def parse_intent(text):
    """A natural chat sentence -> a request dict, or ``None`` when it is not a frame request.

    Deterministic keyword matching only: no model, no network, no profile read.
    """
    raw = _clean(text)
    if not raw or len(raw) > 240:
        return None
    effect = _effect(raw)
    removal = _any(REMOVE_VERBS, raw)
    if removal:
        if not (_any(DECORATION_NOUNS, raw) or effect):
            return None
        target = _target(raw) or (PRESETS[effect]["target"] if effect else "avatar")
        return {"kind": "remove", "target": target, "doc": None, "label": ""}
    if not _any(MAKE_VERBS, raw):
        return None
    if not (_any(DECORATION_NOUNS, raw) or effect):
        return None
    if effect is None:
        return {"kind": "hint", "text": hint_text("NO_EFFECT")}
    target = _target(raw)
    if target is not None and target != PRESETS[effect]["target"]:
        return {"kind": "hint", "text": hint_text("TARGET_MISMATCH", target_mismatch_text(effect))}
    anchor = _anchor(raw) if effect == "slime-pet" else None
    return {"kind": "propose", "target": PRESETS[effect]["target"], "preset": effect,
            "doc": preset_document(effect, anchor), "label": PRESETS[effect]["title"]}


def request_document(request):
    """(target, canonical_document_or_None, label, error) for a propose/remove request."""
    target = request.get("target")
    if target not in TARGETS:
        return None, None, "", "TARGET"
    if request.get("kind") == "remove":
        return target, None, "", ""
    document, error = validate(target, request.get("doc"))
    if error:
        return None, None, "", error
    return target, document, str(request.get("label") or ""), ""


class DecorationRequests:
    """Pending confirmations in this scope's own journal (table ``decorations``)."""

    def __init__(self, database, ttl=TTL):
        self.db = database
        self.ttl = ttl

    def _schema(self):
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS decorations(nonce TEXT PRIMARY KEY,actor TEXT NOT NULL,"
            "channel TEXT NOT NULL,target TEXT NOT NULL,doc TEXT NOT NULL,label TEXT NOT NULL,"
            "created REAL NOT NULL,expires REAL NOT NULL,consumed INTEGER NOT NULL DEFAULT 0)")
        self.db.execute("CREATE INDEX IF NOT EXISTS decorations_actor ON decorations(actor,channel)")

    def propose(self, actor, channel, target, document, label, now=None, ttl=None):
        """Issue one single-use nonce for exactly this actor/channel/target/document."""
        now = time.time() if now is None else float(now)
        ttl = self.ttl if ttl is None else float(ttl)
        self._schema()
        nonce = secrets.token_hex(16)
        # Bounded storage: only live proposals plus a short grace period for recent ones.
        self.db.execute("DELETE FROM decorations WHERE consumed=1 OR expires<?", (now - 3600,))
        rows = self.db.execute("SELECT nonce FROM decorations WHERE actor=? AND channel=? ORDER BY created",
                               (str(actor), str(channel))).fetchall()
        for (old,) in rows[:max(0, len(rows) - 8)]:
            self.db.execute("DELETE FROM decorations WHERE nonce=?", (old,))
        self.db.execute("INSERT INTO decorations(nonce,actor,channel,target,doc,label,created,expires,consumed)"
                        " VALUES(?,?,?,?,?,?,?,?,0)",
                        (nonce, str(actor), str(channel), str(target), packed(document), str(label or ""),
                         now, now + ttl))
        self.db.commit()
        return nonce, now + ttl

    def take(self, nonce, actor, channel, now=None):
        """Atomically consume one live nonce bound to this actor/channel."""
        now = time.time() if now is None else float(now)
        self._schema()
        row = self.db.execute("SELECT actor,channel,target,doc,label,expires,consumed FROM decorations "
                              "WHERE nonce=?", (str(nonce),)).fetchone()
        if row is None or row[0] != str(actor) or row[1] != str(channel):
            return None
        cursor = self.db.execute(
            "UPDATE decorations SET consumed=1 WHERE nonce=? AND actor=? AND channel=? "
            "AND consumed=0 AND expires>=?", (str(nonce), str(actor), str(channel), now))
        self.db.commit()
        if cursor.rowcount != 1:
            return None  # expired, already used or lost the race: the guarded UPDATE is the check
        return {"target": row[2], "doc": json.loads(row[3]), "label": row[4], "expires": row[5]}

    def row(self, nonce):
        self._schema()
        row = self.db.execute("SELECT actor,channel,target,doc,label,expires,consumed FROM decorations "
                              "WHERE nonce=?", (str(nonce),)).fetchone()
        if row is None:
            return None
        return {"actor": row[0], "channel": row[1], "target": row[2], "doc": json.loads(row[3]),
                "label": row[4], "expires": row[5], "consumed": row[6]}
