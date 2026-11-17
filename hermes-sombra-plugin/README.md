# Sombra platform for external Hermes — 0.1.0

This is an **external Hermes platform plugin**, not a DSH plugin, a Python-worker edit, a direct completion engine, or a Telegram adapter subclass. Application version 0.1.16 is unchanged. No deployment is performed by these files.

## Reviewed SDK / execution path

Target: Hermes **v0.22.5**, commit **bf0203a794a07aac3ff764972ab9087baa4e4f4e**. Reviewed source mirror: `../deploy-qa/hermes-plugin-inspect/source/`. The inventory and isolation audit in that directory are prerequisites. The runtime image must pin this exact immutable source; the marker is an operator attestation, not cryptographic proof that imported Python matches a git revision.

`register(ctx)` uses the public platform registry and `pre_tool_call` veto hook. `SombraAdapter` subclasses `BasePlatformAdapter`, creates source identities with **`self.build_source`**, and passes **`MessageEvent` to `self.handle_message`**. Inbound `metadata` stays **empty**: pinned durable native ingress has a closed metadata contract (nonempty adapter metadata is only supported for specific WhatsApp keys). Sombra update identity uses the standard **`platform_update_id`** field, which the native envelope explicitly persists/restores; all transport lifecycle checks use that standard field. A private `sombra_update_id` metadata key was refused before admission and must never be reintroduced or whitelisted by patching core. Normal Hermes gateway routing/provider resolution, core tools, media extraction, STT/TTS, memories, sessions and agent execution are reused. Hermes dynamically builds `hermes-sombra` from its available core + platform-independent plugin tools; there is no copied/hardcoded tools list. Existence in a toolset is not proof that a browser, provider, media codec or other dependency is installed and working.

Full normal core tools require owner + explicitly selected immutable Sombra IDs. **The current user-selected deployment is explicit `shared_host` mode in the existing running Hermes gateway**, described below. The earlier isolated actor/channel mode remains optional and is not a requirement to reuse existing installed tools. Plugin discovery does not prove a Telegram extension is enabled or portable.

## Current selected mode: existing shared host / gateway

No second Hermes installation, daemon, Docker/OpenShell setup or provider proxy is needed. `SharedHostAdapter` is registered in the **existing gateway process**. Trusted turns use that gateway's normal full core/tools/provider runtime. Ordinary users use an **in-process restricted public callback** (not another poller/process): no automatic private memories/context files, per-actor/channel history, and only its explicitly verified safe public capability executor. Web/extract/image/video availability is determined by the real configured handlers; missing generation is reported, not invented.

### Explicit acknowledgement / configuration

The operator must set **both**:

```
SOMBRA_MODE=shared_host
SOMBRA_SHARED_HOST_ACK=I_ACCEPT_SHARED_HOST_FULL_TOOLS
SOMBRA_API_URL=https://<existing-approved-backend>/api
SOMBRA_TOKEN_FILE=/etc/sombra-hermes/bot.env
SOMBRA_STATE_DIR=/var/lib/sombra-hermes-platform
SOMBRA_PROFILE=sombra
SOMBRA_LEGACY_STATE_DIR=/var/lib/sombra-hermes
```

The raw bot token is read from the existing protected credential file, never copied to a new provider config or exported to public runner environment. The file must have one `SOMBRA_BOT_TOKEN` assignment, no symlink components, and no world-readable/group-writable permissions (0640 with protected parent is supported). The source API is the existing backend; standard `{data:...}` envelopes are unwrapped. Broker lifecycle operations become **local no-ops**, not extra HTTP APIs. The earlier isolated mode still rejects raw-token configuration.

**Shared-host acknowledgement explicitly accepts that full trusted tools run as the existing service UID and can access host files, including Telegram-readable files.** Logical source/profile/session separation is NOT a filesystem/process sandbox. Ordinary public users still do not get file/terminal/code/delegate/admin tools, secret reads, arbitrary private URLs or automatic Telegram memory. Do not present this mode as actor/channel OS isolation.

Only **one Sombra model/core turn** runs at a time (adapter semaphore=1), with bounded per-scope histories. Telegram's global concurrency/settings are not modified. Per-actor/channel tasks, journals, controls and immutable `(adapter,scope,originalUpdateID)` ContextVars prevent replies, edits, callbacks or detached old tasks crossing an invocation even when multiple sources are pending. The pre-tool policy performs a fresh backend source/grant check. An SDK `pre_llm_call` observer binds actual `session_id` plus delegated child lineage; known Sombra sessions with a lost ContextVar are blocked, not silently exempted. Unrelated Telegram/CLI sessions are untouched. ContextVars share a stable process singleton across separately loaded profile-plugin modules; reviewed SDK executors, agent worker threads and hook-timeout threads propagate `copy_context`.

**Public off-turn SDK scope is mandatory even in shared-host mode.** The poll task is not a normal Gateway activity. Before public provider resolution or its worker thread, the adapter enters the pinned official `_profile_runtime_scope` for the validated clean named Sombra home, including SDK secret and terminal-policy ContextVars; all tokens reset afterward. A copied Sombra invocation ContextVar alone is not enough. Tests reproduce the actual SDK `UnscopedSecretError` with multiplexing active, then verify scoped thread inheritance and concurrent Telegram scope/environment restoration; the exact-SDK integration also exercises the real `existing_provider → runtime_provider → PooledCredential.runtime_base_url` path rather than substituting a fake provider resolver.

For existing approved network services, the adapter prepares an **in-memory projection** from SDK's receiving-owner secret snapshot: only environment names declared by the selected model provider, verified registered public web tool, and vetted image/video provider metadata. Telegram/Sombra/bot/admin/gateway/relay credentials are excluded, and explicit named-profile provider values take precedence. The owner's complete mapping is never installed in a public turn; no `.env`/auth files are copied and no global environment fallback or multiplex-guard disabling is used. Registered vetted generation-provider objects are snapshotted so a clean named profile does not silently select a different provider. Metadata preparation never calls `get_active_provider`/availability probes or refreshes auth; actual generation still requires valid existing credentials and reports unavailable/errors rather than claiming a fake sent artifact.

The plugin acquires **the previous worker's `worker.lock`**, in addition to its own state lock. Parent rollout must stop the old restricted polling service before enabling Sombra in the existing gateway. Do not run two consumers with the same bot token. The public callback replaces only that polling path; no restricted worker source changes are required.

### Minimal additive existing gateway configuration

Use the SDK's preserving config writer; **append/merge**, never replace existing Telegram platforms, enabled plugins or profile routes:

```yaml
plugins:
  enabled:
    # retain all existing entries
    - sombra-platform
platforms:
  sombra:
    enabled: true
gateway:
  multiplex_profiles: true
  profile_routes:
    # retain all existing routes
    - name: sombra-platform
      platform: sombra
      profile: sombra
```

Create a **new clean logical named profile `sombra`**, served by this same gateway, using supported profile creation (not cloning Telegram). Enable this plugin in that profile too so its source/tool policy hooks are loaded, but do **not** enable another Sombra transport there. Its config contains only reviewed scalar provider/model selections, `terminal.cwd` pointing to a new clean Sombra workspace, and the Sombra plugin. Root creates the separate Sombra `SOUL.md`; never overwrite Telegram/default persona. Do not copy root `.env`, `auth.json`, `MEMORY`, sessions, SOUL, skills catalogs or Telegram caches.

Hermes v0.22.5 explicitly supports per-provider **global-root auth fallback** for named profiles (`hermes_cli/auth.py` `_load_provider_state_with_source` / `_load_provider_state`, reviewed lines830–844). Refresh writes back to the original provider store; **no auth-file copy/symlink or duplicate OAuth grant** is needed. This is shared existing provider authorization, not a second login. Automatic configuration/context loading is from the clean Sombra profile/workspace, not the Telegram root. Full trusted tools can still deliberately access host data under the acknowledged host-access policy.

`build_source` refuses any trusted source that did not resolve to the configured served Sombra profile; it never silently runs in the Telegram/default context. Group sources have an actor+channel-specific **synthetic internal thread lane** (not a claimed Sombra native thread), so operator globally shared group-session settings cannot merge two humans' histories. Source identities include server, bot, actor and channel. Public history is separately stored per actor+channel and contains only that source's own text/output (12 bounded turns/rows); public `/reset` clears only this scope.

Optional `SOMBRA_ARTIFACT_ROOTS` is an operator JSON list of explicit **generated-output subdirectories**, e.g. the clean Sombra profile's image/audio/video caches and workspace/artifacts. Never export the whole Telegram cache, home or workspace. Public outputs are always restricted to their exact per-scope temporary `artifacts` directory, irrespective of trusted export-root settings. Public input media is authorized original attachment only, staged UUID paths under that scope's `inbound` directory.

**Trusted native generation delivery:** a normal SDK `post_tool_call` observer accepts successful `image_generate`/`video_generate` structured results only, with an exact producer `tool_call_id`, current invocation binding and fresh backend trusted authorization. Before reading, the source must belong to the clean Sombra profile cache or explicit workspace/artifacts export roots; the operator export allowlist is still mandatory. MIME/size checks, SHA-256, a private per-actor/channel staged copy and FULL-synchronous `generated_artifacts` SQLite manifest are recorded before attachment delivery. SDK observer threads use their own explicitly closed SQLite connection, not the event-loop journal handle; thread-affinity checks are never disabled. Manifest rows record update/call/source/staged/hash/MIME/size/result hash and eventual response reference, not prompt plaintext.

After the complete SDK turn, before final completion/ACK, any unsent current producer artifacts are uploaded using the real backend attachment contract—even if the model wrote a Markdown `file://` link instead of `MEDIA:`. Native attachment delivery and this flush deduplicate against the same manifest. File URLs are scrubbed from messages/edits and are **never** file-read authority: no current producer manifest means no inferred attachment, no exporting another actor's cached image, and no automatic paid regeneration. Prior-turn links alone do not replay old manifests. Invalid producer paths/provenance or attachment failure produce an explicit safe error and preserve the existing UNCERTAIN/manual-review behavior. The same Sombra-origin fence runs at the actual media egress method **before** any superclass/SDK automatic-media fallback: an erroneous export allowlist cannot make a default/Telegram cache readable or sendable. Once a native producer violation taints the invocation, all fallback media is denied; there is no final ACK. Valid explicit workspace/artifacts documents and the existing named Sombra audio/TTS route remain supported.

**Sombra identity and prompt caching:** the supported immutable `platform_hint` string identifies the assistant as being inside the independent Sombra desktop messenger—not a Telegram/Discord/WhatsApp bot. It distinguishes app concepts (groups/channels/DMs, voice/video/WebRTC) from actually available bot tools, and does not promise call joining, music playback, muting participants, automatic group-avatar changes or unreleased app features. Explicit requests to discuss building a Telegram bot remain valid separate topics. Event chat type/guild identity prefer backend-authorized canonical chat metadata, never platform claims in a human message. The public runner receives the same operator-only immutable context independently of the persona size limit.

Existing trusted Hermes conversations can retain their exact persisted system prompt across a daemon restart (`conversation_loop._restore_or_build_system_prompt` restores it verbatim). **Do not silently rewrite that prompt/history or reset users.** An actual user must request a supported reset to adopt the new platform hint: on the current bot, `/reset@hermes` (or unambiguous `/reset`). This starts a new model conversation, not deletion of the Sombra app chat. Do not recommend `/new` unless that bot declares it to the backend; adapter support alone does not make backend slash routing enqueue it. `/ask /reset` is ordinary question text, not a substitute control. Public `/reset` clears only the current actor/channel's local public history without a model call or touching another scope.

**No proactive/setup notices:** Sombra explicitly declares the SDK `supports_async_delivery=False` capability. Pinned SDK first-contact code unfortunately does not consult that capability or an empty cron descriptor when emitting the missing-home notice. The plugin therefore uses the supported per-platform `notice_delivery: private` policy and consumes operational notices in `send_private_notice` without a public fallback (`suppressed` response metadata, no sent message ID). It never invents a home channel, runs `/sethome`, assigns cron delivery, or suppresses normal model replies/exec approval/clarify messages.

Settings/reactions/persona extensions are separate typed backend operations; they must bind to the current canonical invocation, not arbitrary caller-supplied chat/message IDs, and owner-private-DM management authority must not be inferred from `bots.manage` or merely being tool-trusted.

## Optional isolated mode: external isolation (fail closed)

Do **not** install or run against the existing Hermes UID/profile, Telegram home, provider credential files or service. Containerizing terminal alone is insufficient: memory, session search, caches and browser are gateway/profile-side surfaces.

The **entire gateway** must run nonroot inside the separately provisioned actor/channel compartment, with private home, workspace, cache, browser profile, immutable reviewed SDK/plugin/config, bounded resources, and no Telegram/backend/worker files, host home, Docker socket or sibling profiles mounted. A protected broker outside it retains the raw bot key; a separate provider proxy retains real provider authorization. The runtime only receives scoped proxy credentials. Network policy must prevent bypassing these brokers. The plugin itself is **not an OS sandbox** and a JSON marker cannot prove network/mount isolation.

Environment:

- `SOMBRA_API_URL`: approved HTTPS scoped broker endpoint ending `/api`, optionally `/hermes-runtime/api`; never production raw-token mode.
- `SOMBRA_API_TOKEN`: broker-only token prefixed **`sombra_scope_`**. Never raw backend bot/provider token.
- `SOMBRA_ACTOR_ID`, `SOMBRA_CHANNEL_ID`: exact immutable single actor/channel.
- `SOMBRA_STATE_DIR`: private absolute writable durable state directory.
- `HERMES_HOME`: the attested clean isolated home; working directory must equal attested workspace.
- Optional `SOMBRA_RUNTIME_ATTESTATION`: immutable absolute marker override; default **`/run/sombra-runtime/compartment.json`**. Never place the marker in runtime-writable state.
- Test only: `SOMBRA_TEST_LOOPBACK=1` permits literal `127.0.0.1`/`::1` HTTP `/api` fixture. Not an arbitrary private-HTTP escape.

Required marker shape (operator-produced readonly bind, root-owned file **and parent**, non-writable by runtime):

```json
{
  "schema": 1,
  "mode": "actor-channel",
  "server_id": "operator-stable-server-id",
  "bot_id": "canonical-bot-id",
  "actor_id": "selected-stable-human-id",
  "channel_id": "selected-channel-id",
  "hermes_commit": "bf0203a794a07aac3ff764972ab9087baa4e4f4e",
  "hermes_home": "/scope/home",
  "workspace": "/scope/workspace",
  "artifact_roots": [
    "/scope/workspace/artifacts",
    "/scope/home/cache/images",
    "/scope/home/cache/audio",
    "/scope/home/cache/video",
    "/scope/home/cache/generated",
    "/scope/home/cache/screenshots"
  ],
  "broker_url": "https://approved.example/hermes-runtime/api",
  "isolated": true,
  "no_telegram_mounts": true,
  "scoped_broker": true,
  "provider_proxy": true
}
```

Missing/mismatched attestation, wrong cwd/home, raw-key configuration or untrusted actor fail closed. On POSIX root gateway is refused and a runtime-writable marker parent is refused. Permissions checks supplement, not replace, immutable mount verification by the runtime launcher. No host installation is attempted. Registration sets only the exact `SOMBRA_ALLOWED_USERS` actor and own-policy descriptor; pairing/global allow-all does not replace plugin canonical authorization.

## Broker API and authority

HTTPS JSON `/api`, `Authorization: Bearer <scope-token>`. Standard operations and shape are documented in `../BOTS.md`: `bot_get_me`, `bot_get_updates`, `bot_authorize_update`, `bot_attachment_file`, `bot_reply`, `bot_edit`, `bot_delete`, `bot_typing`, `bot_ack`.

Required broker-only lifecycle operations:

- `runtime_begin_invocation {update_id}`: canonical fresh trusted source; bind exclusive provider lease to original invocation. Reject a second/running/uncertain invocation rather than reexecute it.
- `runtime_end_invocation {update_id,outcome:"complete"|"uncertain"}`: end only matching lease. Broker persists running before granting; startup marks interrupted running uncertain.

`bot_authorize_update` is a **read-only fresh check**, including for controls; it must not change the provider lease. Acking a control must not end the original invocation. Model proxy independently rechecks the active source, trust, scope and revocation on every provider request. Destination always comes from the stored invocation, never caller-selected chat. Plugin checks canonical sender == configured actor, channel == configured channel, trusted == true, bot == attested bot before input/download/send/edit/delete/typing and **every privileged tool** via pinned synchronous `pre_tool_call`; errors/timeouts block. Mid-turn canonical/policy revision changes taint/stop rather than inheriting a stale grant.

## Durable delivery and completion

SQLite FULL-synchronous/WAL journal is scope-bound (broker/server endpoint, bot, actor, channel). It writes `RUNNING` before gateway dispatch and complete payload/hash manifests (including base64 media bytes) **before network delivery**, exact bounded `part_00` … `part_31` keys, and edit/delete mutation intents. OS lock disallows two gateway consumers using one state dir. Plugin also allows only one Sombra adapter per process.

`handle_message` **queues background work**, so returning from it is not completion. This plugin uses **version-pinned subclass overrides**, with no core patch:

- `send_final_ledgered` records actual success of final-text ledger send.
- `_deliver_attachments` records the native final attachment lifecycle boundary, after TTS/final text. A media-only turn needs an actual successful attachment plus this completed boundary.
- `_notify_turn_error` and failed media/text/mutations taint delivery.
- `_process_message_background` signals completion only after `super` returns through full media/TTS/cleanup lifecycle.
- `_dispatch_inline_reply` awaits the exact pinned inline handler + reply-send lifecycle; successful persisted reply parts after that boundary establish inline native-command completion. A first send alone never does.

Only after that boundary, known final output and **all persisted parts delivered**, the plugin records `DELIVERED`, fresh-checks authority, ACKs and records `ACKED`, then ends the provider lease. First send, typing, interim commentary, a callback in SDK `finally`, or handler return alone is **not** final proof. Final-text success followed by failed media does **not** ACK. Voice-only success is covered by fixture tests, not claimed as full-model runtime proof.

On restart `RUNNING` becomes **UNCERTAIN**. It is never silently regenerated, nor are external tool effects replayed. The compartment halts admission after ambiguous delivery/turn failure. Operator must manually check effects and explicitly reenqueue a new invocation after remediation; do not directly reset a running row to NEW. Delivery errors do not retry under a fresh part key. A completed `DELIVERED`/`ACKED` row may finish/repeat ACK without model execution. This is **not exactly-once tools/model execution**; crashes can leave known cached output or unknown external effects requiring review. Empty/silent command paths without a proven delivery boundary do not get guessed ACKs.

## Text, media and controls

- Plain text, no adapter HTML/Markdown rendering; Sombra UI must render message text as text, not executable markup. Unicode code-point chunks ≤2000, ≤32 total parts, no silent truncation. Excess budget is an explicit failure.
- Input authorization precedes the single original-attachment download. Base64/raw size bounded to 10 MiB; generated UUID filenames and conservative magic-byte MIME/extension sniffing, no caller paths or unrelated history. Unrecognized active formats become `.bin` documents, never HTML/SVG renderer files.
- Output images, GIF, video, audio/voice and documents use the backend attachment contract: ≤10 MiB each, ≤20 MiB total. Local generated artifacts only within explicitly attested roots. Absolute traversal, symlink components, outside-root files, secret/state suffixes and special files are denied. POSIX reads walk directory fds with `O_NOFOLLOW` against parent-symlink races. Whole workspace/home is not an export root.
- Remote media URLs are **explicitly unsupported**, with a clear failure; no SSRF fetch and no fake Sent. Produce a local approved artifact first. Unsupported/oversize artifacts taint final delivery instead of disappearing silently.
- Send/edit/delete/typing implemented; edit revisions are CAS 0→1…; typing is backend TTL8s. Proactive/cron/background destinations without an active stored invocation are denied, not arbitrary-chat sends. This is intentional scope restriction, not complete Telegram cron parity.

### Native commands and safe human text controls

Native destructive commands such as `/reset` may require confirmation under the SDK's default policy. The original request remains unACKed until the exact issued single-use nonce control finishes; a confirmation prompt alone is not completion. The slash prompt is rendered under the official full Sombra runtime scope, then its `copy_context()` snapshot is retained **process-locally only, after durable prompt JSON is committed**. Following fresh authorization of both original and control messages plus atomic nonce consumption, the actual resolver coroutine runs in an owning-loop Task with that captured context (home, bound secrets, terminal policy and original invocation)—not merely a coroutine created inside a context. The poll task's ambient scope is restored afterward. No context/secret mapping is serialized, no global environment fallback is used, and `/reset` confirmation is not disabled in production. Follow the exact emitted nonce command with `once` or `cancel`; generic `yes` is not approval.

Explicit native command whitelist: `help`, `start` (normalized to `help`), `reset`, `new`, `status`, `model`, `models`, `tools`, `stop`, `compact`, `clear`, `usage`, `context`, `skills`. These alone set `MessageEvent.allow_gateway_control=True`; normal prose and `/ask`/`/ai` text do not. `/ask@hermes` and `/ai@hermes` strip their transport prefix. Generic `/approve`, `/always`, `/deny`, `/cancel`, host `/restart`/`/update`/`/yolo` and all unknown slash commands are rejected before Gateway/model dispatch. No arbitrary next-message approval capture is enabled. Other normal native commands received while an invocation is active stay serialized in the queue; this initial adapter does not promise immediate active-turn `/stop` interruption.

Polling continues during an active SDK turn. Ordinary new AI inputs stay queued; only exact actor/channel-bound commands are intercepted:

```
/sombra-confirm@hermes <32-hex-single-use-nonce> once|session|deny
/sombra-answer@hermes <32-hex-single-use-nonce> <answer text>
```

Alternative addressed form: `@hermes /sombra-confirm ...` / `@hermes /sombra-answer ...`. Commands are anchored, not searched inside prose; arbitrary LLM output, plain “yes”, role fields or pasted nonces from another compartment are not approval. Pending nonce records persist original invocation, SDK request/session, actor/channel, actions and 5-minute expiry. Original **and** control source each get fresh canonical authorization before resolution. Consume durably before resolver; replay/unknown/expired/wrong actor/session/choice is denied, never dispatched as a model task.

Pinned SDK exec prompt does **not forward request_id** and redacts command text. The safe no-core seam is exactly **one** live `list_gateway_approvals(session)` entry, then mandatory `resolve_gateway_approval(..., request_id=that_exact_id)`. Multiple pending requests without an explicit metadata ID are refused rather than approving FIFO or matching redacted command strings. To prevent a delayed old render from approving a newer different request, the displayed command/description and allowed actions are rebuilt from the exact selected pending snapshot, with public `agent.redact.redact_sensitive_text(..., force=True)`; stale `ExecApprovalPrompt.text/actions` are not trusted. Permanent `always` is intentionally not offered. Clarify binds `get_pending(id).session_key` and uses `resolve_gateway_clarify`; numeric choices map to exact option text. No arbitrary next-message capture. “Approved/Answer accepted” is emitted only for a positive resolver count/boolean. Unsupported prompt types remain fail closed. Native slash-confirm uses the same nonce-confirm command but only `once|cancel`; it checks public `get_pending(session)` exact `confirm_id` and `clear_if_stale` before calling the pinned async resolver. Permanent `always` is excluded. The SDK resolver may validly return None, so this path says **“Ответ передан; результат не подтверждён”**, never “Approved”; a returned handler text is delivered in bounded durable chunks. Nonces are consumed before the resolver and never retried after ambiguous completion.

## Parity / extension boundaries

Available normal Hermes core tools retain native agent execution; no new orchestration engine. Media support is subject to backend format/size budgets and configured STT/TTS/provider dependencies. Native Telegram callback widgets, Google/calendar grants, sticker private catalogs, reactions, Telegram GIF service/auth, avatars, rich cards, live-call joining and remote-media download are **not enabled by discovery** and are not copied. Sombra equivalents should use separate explicit backend operations + extension adapters and the same scoped authority; do not import Telegram internals or copy private state. Future structured control UI may call the same bound nonce resolver contract. No claim of complete Telegram UI/native-extension parity.

## Offline validation

```sh
python -m unittest discover -s app/hermes-sombra-plugin/tests -v
```

Tests use a deliberate minimal SDK stub plus real loopback HTTP fixture (not production), static AST signature comparison with the pinned source mirror, registration/registry fields, fresh pre-tool revocation, canonical forgery rejection, attachment sniffing/path/size rules, Unicode multipart delivery, mutation APIs, crash uncertainty/no reexecution, final text/media/voice-only ACK order, strict approval request IDs, ambiguous-queue refusal, clarify nonce scopes/expiry/replay and unsupported-prompt denial. **These are not full Hermes model, external-tool side-effect, container isolation or production tests**. A separate exact-SDK shared-host integration must pass before authorized deployment. Trusted-path proof must drive the real `BasePlatformAdapter.handle_message → Gateway ingress → native envelope validation → durable SessionAuthority admission/worker → final delivery/ACK`, including owner DM, repeated DM and group sources; direct `AIAgent` or authorization-only fixtures do not exercise this boundary. No production API, provider/model request, installed Hermes import, service restart or Telegram mutation is performed by this unittest command.

### Mandatory actual startup preflight / corrected registry contract

An earlier constructor/registration-only fixture missed a startup consumer contract: `PlatformEntry.own_policy_env` is **a tuple of TWO names**, `(dm_policy_env, group_policy_env)`, not a boolean flag name and not a triple. The pinned `gateway.run_startup._own_policy_envs` expands it to `(*own_policy_env, allow_all_env)`; `gateway.run._own_policy_open_startup_violation` then unpacks THREE values. A string became individual characters and aborted real startup. The plugin now declares `("SOMBRA_DM_POLICY", "SOMBRA_GROUP_POLICY")`, both allowlist policies; it declares **no allow-all switch**. The actual expansion's absent third value may be `None` or `""`; preflight accepts both and rejects any truthy allow-all descriptor. Both adapter modes also implement the exact SDK `connect(self, *, is_reconnect=False)` contract; the SDK forwards this keyword on initial startup as well as reconnect. Registry `required_env` is correctly a **list of environment NAME strings** (distinct from manifest UI field dictionaries), verified against actual registry scrubber/setup consumers.

`tests/test_startup_contract.py` executes the pinned startup-consumer functions, reproduces the old string failure, accepts allowlist, refuses open-without-opt-in, and checks actual required-name consumption. This source-extracted regression is not a substitute for loaded SDK startup/config/authz tests.

Before touching the running gateway, prepare a **disposable candidate Hermes home** containing only the intended scalar config and this plugin (no copied private root state), then run `preflight.py` with the **existing installed Hermes interpreter** and reviewed SDK import path:

```text
<existing-Hermes-runtime-python> preflight.py --sdk-root <reviewed-existing-SDK> --candidate-home <prepared-disposable-candidate-home>
```

**PM-managed installation caution:** bootstrapping with a new `HERMES_HOME` can request a new dependency environment for that data root. Do not install one or relax network/write/memory restrictions. Instead activate the existing installed runtime under its current root first, then use the supported `hermes_constants.set_hermes_home_override(candidate)` and assert `get_hermes_home() == candidate` before any config/plugin imports. Run this helper through `runpy` with `--sdk-root` only (omit `--candidate-home` in this variant). This is how a named profile shares existing dependencies; no private config/context/auth files are copied. A resource/write-blocked probe is inconclusive, never a pass.

The helper uses the **actual SDK plugin discovery, `load_gateway_config`, `_own_policy_envs`, `_own_policy_open_startup_violation`, and `_start_check_access_policy`**, not constructor-only mocks. It does not construct/connect an adapter, poll, start the gateway, execute tools or call providers/models. Runtime-status writers are suppressed for the dry-run only; no policy function or SDK file is changed. `ok:true` is required, and source-bound actual authorization-ladder integration must additionally prove trusted canonical admission, foreign-ID denial, revocation blocking and unaffected Telegram before rollout. Missing Sombra configuration or wrong registry metadata fails preflight rather than guessing.
