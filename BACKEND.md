# User and session backend

Run `npm.cmd run build`, `cargo test --offline`, `cargo build --offline`. Start `target/debug/mines-chat.exe` for desktop, or `npx.cmd vite --host 127.0.0.1` for browser (Vite starts/proxies the Rust service). `node check-login.mjs` verifies development/production HTTP proxies. Use one database process at a time.

## Storage and DTOs

`MINES_DATA_DIR/mines-db.json` (default `app/data`) is a versioned JSON database for this single-process application. Writes replace the file atomically; failed requests roll back memory. Version 2 adds sessions and migrates existing users without deleting groups or messages; old JWTs deliberately require a new login. Back up the private data directory; never serve it as static files. This is not a distributed production database.

UserRecord: UUID id; display name (2–32 characters); normalized unique email; password hash and unique salt; bio (up to 190 characters); created_at (Unix seconds); legacy version. Passwords use PBKDF2-HMAC-SHA256 with 600,000 iterations and constant-time verification. CredentialsDto validates input types; ProfileDto rejects unknown fields so callers cannot change credentials or IDs through profile editing. UserDto exposes only id, name, bio and created_at; email is returned only to its owner. Password hashes and salts never appear in responses.

Session: UUID id, user_id, SHA-256 token_hash, client device description, created_at, last_seen, expires_at. Token is two random UUIDv4 values; only its hash is stored. Each login creates an independent session, lasting at most 30 days and expiring after 7 days idle. Activity is persisted at most once per minute. Expired records are pruned on login. Revocation takes effect on the next request; the open chat polls every two seconds. Device labels are descriptive client metadata, not proof of identity.

Browser sessions use HttpOnly, SameSite=Strict cookies; tokens never reach JavaScript. HTTP ignores tokens in request bodies, rejects cross-site fetches, and marks responses no-store. Set `MINES_SECURE_COOKIE=1` behind HTTPS in deployment; local HTTP development defaults to non-Secure cookies. Desktop Tauri uses the same server session through IPC and keeps its bearer token in the local webview profile. This desktop storage is not an OS credential vault; protect the OS account and profile. No secrets are embedded in the frontend bundle.

All application screens are behind a server session check, except login/registration. Loading and connection errors never reveal chat content. Expired/revoked sessions clear the UI and show login; direct hash navigation cannot bypass the guard.

## API

POST /api JSON `{op,...fields}`; HTTP authentication uses its cookie; Tauri IPC additionally supplies `token`. Responses are `{data}` or `{error}`; HTTP session failures use 401.

- register / login: name (registration), email, password. HTTP returns user and sets cookie; IPC returns user and token.
- me: own UserDto and email. state: own groups/dialogs/messages and public user directory.
- `state.chatPreferences`: private account settings `{revision,notifications:{direct,groups},dialogs:{[dialogId]:{pinned,muted}}}`. Defaults: notification categories enabled, no pinned/muted dialogs. Not included in public UserDto.
- `set_notification_preferences {direct?:boolean,groups?:boolean}` and `set_dialog_preferences {dialog,pinned?:boolean,muted?:boolean}` require a human session and at least one strict boolean field. Dialog updates require membership. Both patch existing values, atomically persist them, increment revision and return the whole normalized settings object. Clients must not replace newer settings with a delayed older state snapshot. Bot tokens cannot change these settings.
- update_profile: profile `{name,bio}`.
- sessions: owned active session DTOs, with current flag; never token hashes.
- revoke_session: session_id, ownership checked.
- logout: current session only. logout_all: all account sessions.
- change_password: current_password, password; verifies old password and revokes all sessions.
- create_group, join_group, create_channel, create_dialog, message: existing membership/ownership checks apply.
- invite_group_member: `group` and the email of an existing Sombra account. The group owner can add the account immediately. Repeating the invitation succeeds without duplicating membership. The new member receives the group's text and voice permissions on the next request.
- update_group: `group` and at least one of `name` or `avatar`. The owner can set a name of 1–60 characters after trimming and set an avatar using a PNG, JPEG or WebP data URL. An empty avatar removes it. Returns the saved group.
- `delete_channel` takes `group` and `channel`. The owner can remove the channel and its messages and bots. Connected users leave that voice room.
- `update_message {message,text}` changes the text of a message sent by the authenticated author. `delete_message {message,for_everyone?}` hides a message for the current account by default. Only the author can remove it for everyone.
- `import_sticker_pack` accepts a `pack` name, a batch of `stickers` with `name`, `image` and optional `keywords`, and an optional `group`. Names and keywords from the archive manifest are matched against the current draft. Reimporting the same image under the same pack and name updates its keywords. With a group, its owner manages the pack and members can send it in that group. Otherwise it belongs to the authenticated user's library.
- `state {sticker_assets:true}` returns pack entries without image data. Use `sticker_image {sticker}` to load an image from your library or accessible messages. `remove_sticker` and `remove_sticker_pack` remove entries from the library and preserve images already sent.

Email verification, password recovery, MFA, encrypted credential vault, multi-process storage and a production abuse-control service remain outside this implementation. Existing login throttling is process-wide.

Discord is a behavior reference, not a claim about its private database: independent device sessions and remote logout, with password changes revoking all sessions. Official reference: https://support.discord.com/hc/en-us/articles/360039213771-QR-Code-Login-FAQ .

Visual lock: picture-1 retains the compact black chat and sidebars; picture-2 retains the voice gradient; picture-3 supplies the account modal, divided profile/security sections and device controls. Authentication intentionally replaces the old public demo screen.

## Temporary calls in direct/group dialogs

`dialog_call_start {dialog,video:boolean}` creates or returns the existing in-memory call for a dialog. It does not create a permanent channel. `dialog_call_decline {call}` dismisses the invitation for the current account only; the call remains available for later joining. `dialog_call_cancel {call}` removes an empty call only for its original caller.

`state.dialogCalls` exposes only calls belonging to dialogs the requester belongs to: `{id,dialog,caller,video,created_at,participants:string[],declined:string[],empty_since?}`. The caller must not show an incoming invitation to themselves. `voice_join`, `voice_poll`, `voice_signal`, `voice_leave` use `room:call.id`, reuse the existing authenticated WebRTC signaling and ICE/TURN credentials, and enforce dialog membership. Dialog calls allow ten peer connections; permanent group voice rooms retain their eight-peer limit.

Presence is leased for 20 seconds. A call is removed 60 seconds after the last live peer leaves (or its lease expires), including never-answered calls after their initial empty timeout. The server runs a one-second cleanup timer independent of requests. Restart discards ephemeral calls and signaling; it does not modify dialogs/messages. Declining never removes other participants. Joining clears the current account's decline and does not require a new invitation.

The client presents audio/video header controls, a central incoming-call dialog, answer-without-camera for video calls and a join-later banner. New-dialog selection uses accepted friends and members of shared groups, with up to nine other people. Multiple selections create a group dialog. Camera and microphone permissions are required before publishing media.

## Message attachments

`message` accepts optional `attachment:{name,data,mime?}`. `data` is raw standard base64; the server ignores the client MIME hint, accepts at most 10 × 1024 × 1024 decoded bytes, and allows attachment-only messages. The HTTP JSON body limit is 15 MiB (including base64 overhead). Access is checked before storing bytes.

Files live privately in `MINES_DATA_DIR/message-attachments/<UUID>` (directory 0700, files 0600 on Linux). Database/history contain only `{id,name,size,mime,expired}` metadata. PNG/JPEG/GIF/WebP signatures permit raster previews; all other files are downloadable binary data, never embedded HTML/SVG. `attachment_file {message}` returns `{data,mime,name}` only for a message visible to the authenticated account, including hidden-message checks. Downloads use no-store responses. Desktop saves through `save_message_attachment` into Downloads with sanitized unique names and no overwrite or automatic execution.

The client supports file selection and file/image paste in every conversation composer. One file per message, with an independent draft for each destination. Failed sends retain the file and text. Request timeout for file transfers is 90 seconds.

Retention: `deploy/cleanup-attachments.py` removes only regular UUID-named message files older than 30 days, leaving messages, stickers, avatars and the database untouched. The monthly cron runs at 03:17 server time on day 1; a file can therefore remain for up to roughly 60 days. `--dry-run` makes no deletion. Missing files are exposed as expired metadata in history. Tests: `node check-attachments-browser.mjs`, `node --test check-attachment-composer.mjs`, Rust attachment tests and Linux `deploy/check_cleanup_attachments.py`.

## Voice and video

Voice rooms now use WebRTC audio/video (up to eight participants), with authenticated `voice_join`, `voice_poll`, `voice_signal`, and `voice_leave` operations in the Rust service. Room membership and session ownership are checked; signaling stays in memory and expires after 30 seconds. Presence expires after 20 seconds without polling. Audio/video travel between peers, never through the JSON database. See https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling .

Open a voice channel and choose Join. Camera starts with its button. Settings → Voice and video offers microphone, speaker and camera selection, volume, echo cancellation, noise suppression and local device tests. Input, output, audio processing and an active camera update during the call. If the camera is off, its selection applies when it next turns on. Closing settings stops test previews. Leaving the call or logging out releases devices. Speaker selection depends on browser support.

`voice_join` and `voice_poll` accept optional `muted` and `deaf` booleans for the caller's connection and return these flags with each peer. Deafen suppresses both incoming audio and the local microphone. The `muted` flag records the separate microphone toggle.

`state` includes `voicePresence`, a map from voice channel IDs to live members of each room. Each entry exposes a user ID and mute/deafen flags. Only rooms in groups the requester belongs to are included. Presence expires after 20 seconds without polling.

For multiple computers all clients must use the SAME backend/database. Deploy only `mines-server` and the HTTPS API gateway as described in DEPLOY.md; installed clients use a native HTTP cookie jar against that shared `/api`. The deployment does not serve a browser build. Separate desktop instances currently keep independent embedded databases; they do not discover each other. Do not run two writers against the same database.

Configure static ICE servers with `MINES_ICE_SERVERS`, a JSON array of RTCIceServer objects. To issue per-user coturn credentials, set `MINES_TURN_URLS` to a JSON array of TURN URLs and `MINES_TURN_SECRET` to the coturn REST shared secret. An authenticated `voice_join` adds a TURN entry valid for 12 hours to the static ICE servers. The default configuration has no ICE servers. The active deployment is documented in [SOMBRA-SERVER.md](SOMBRA-SERVER.md).

Visual lock: reference/picture-2 owns the purple voice-stage gradient, centered join button and right-side text chat; picture-1 owns the black compact sidebars; picture-3 and attachments/picture-11 own the dark settings modal, device rows and purple volume slider. Existing account controls remain intact.


## Room chat, friends, stickers and bots (schema 3)

The same Rust service now persists per-message per-user emoji reactions, image stickers, friend requests/acceptance/removal, and scoped bot connections. State only exposes messages of joined rooms/dialogs; sticker images are visible to their creator and recipients of accessible messages. Reactions can be toggled by the current user, never on inaccessible messages. Existing databases gain empty collections without replacing accounts/history.

Operations: `reaction {message,emoji}`, `create_sticker {name,image}` (PNG/WebP data URL; custom library capped at 100), `message {channel,text?,sticker?}`, `friend_request {user}`, `friend_accept {id}`, `friend_remove {id}`, `create_bot {channel,name}`, `delete_bot {id}`. Only group owners create bots. Bot token is returned once, stored hashed, and delivered without changing the user's session cookie. Bot HTTP authentication uses Authorization Bearer, never the user session. See BOTS.md and bot-worker.mjs for the external AI adapter contract.

Static PNG and WebP files can be imported individually or as a ZIP pack. Clients normalize newly imported images to the Telegram static sticker dimensions. Personal packs follow the account, group packs are available in their group's channels, and received messages retain their images after removal from a library. Backups of the data directory must include the sibling `sticker-assets` folder.

Validation: 5 Rust tests (including membership rejection, reaction toggle, sticker validation, friendship consent, bot scope/revocation and restart persistence); production build browser test in check-social-browser.mjs (two accounts, HTTP bot token, reactions, sticker send, friends, settings/devices, reload); voice browser regression (two peers, audio/video RTP, mute/leave/cleanup). QA data is isolated in social-qa/data-*; screenshots in social-qa and voice-qa.

Visual comparison: fresh chat, settings, sessions, devices and friends screenshots retain the source three-column geometry, dark palette and compact header; settings use the same matte material. Fresh voice screenshot retains reference/picture-2's purple stage and right-side chat. Hash icons and duplicate room introduction are removed per attachments 13–14; no paid/store/quest sections added.

## Group/dialog integration audit

`create_group` and `join_group` return the saved group; `create_channel` returns the saved channel. The UI selects these IDs directly instead of assuming that the last list item belongs to the current request. Responses are sent only after storage succeeds. Dialogs already return their persisted identity and reuse existing two-person conversations.

Validation: `cargo test --offline` covers group membership, inaccessible messages, repeated invitations, dialog reuse and reopening the database with saved messages. `node check-social-browser.mjs` also exercises group/channel creation through the production UI, two-account group and private messages, reload and screenshots. Test accounts use isolated QA data directories.

The storage remains the existing local JSON database, not PostgreSQL or a deployed Internet service. Different computers must connect to one shared backend as described above; independent embedded desktop databases do not synchronize.

