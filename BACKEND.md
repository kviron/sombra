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
- update_profile: profile `{name,bio}`.
- sessions: owned active session DTOs, with current flag; never token hashes.
- revoke_session: session_id, ownership checked.
- logout: current session only. logout_all: all account sessions.
- change_password: current_password, password; verifies old password and revokes all sessions.
- create_group, join_group, create_channel, create_dialog, message: existing membership/ownership checks apply.
- invite_group_member: `group` and the email of an existing Sombra account. The group owner can add the account immediately. Repeating the invitation succeeds without duplicating membership. The new member receives the group's text and voice permissions on the next request.

Email verification, password recovery, MFA, encrypted credential vault, multi-process storage and a production abuse-control service remain outside this implementation. Existing login throttling is process-wide.

Discord is a behavior reference, not a claim about its private database: independent device sessions and remote logout, with password changes revoking all sessions. Official reference: https://support.discord.com/hc/en-us/articles/360039213771-QR-Code-Login-FAQ .

Visual lock: picture-1 retains the compact black chat and sidebars; picture-2 retains the voice gradient; picture-3 supplies the account modal, divided profile/security sections and device controls. Authentication intentionally replaces the old public demo screen.

## Voice and video

Voice rooms now use WebRTC audio/video (up to eight participants), with authenticated `voice_join`, `voice_poll`, `voice_signal`, and `voice_leave` operations in the Rust service. Room membership and session ownership are checked; signaling stays in memory and expires after 30 seconds. Presence expires after 20 seconds without polling. Audio/video travel between peers, never through the JSON database. See https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling .

Open a voice channel and choose Join; microphone permission is requested only then. Camera starts only with its button. Settings → Voice and video offers microphone/speaker/camera selection, volume, echo cancellation, noise suppression and local device tests. Preview closes when settings close; leaving the call or logging out releases devices. Microphone/input processing changes take effect on the next join. Camera selection takes effect on the next camera activation. Speaker selection depends on browser support.

For multiple computers all clients must use the SAME backend/database. Deploy only `mines-server` and the HTTPS API gateway as described in DEPLOY.md; installed clients use a native HTTP cookie jar against that shared `/api`. The deployment does not serve a browser build. Separate desktop instances currently keep independent embedded databases; they do not discover each other. Do not run two writers against the same database.

For connections across NAT/firewalls configure `MINES_ICE_SERVERS` as a JSON array of RTCIceServer objects with your STUN/TURN URLs and temporary TURN credentials. Default is an empty list (direct local-network connections). Deploy a TURN service with UDP/TCP/TLS relay support for Internet reliability; this repository does not provision a public TURN server. Opening an arbitrary UDP socket alone is insufficient. Use HTTPS and `MINES_SECURE_COOKIE=1` for deployment. Signaling is a small-room polling implementation, not an SFU. Browser/device hardware permission and Internet relay availability must be verified on deployment.

Visual lock: reference/picture-2 owns the purple voice-stage gradient, centered join button and right-side text chat; picture-1 owns the black compact sidebars; picture-3 and attachments/picture-11 own the dark settings modal, device rows and purple volume slider. Existing account controls remain intact.


## Room chat, friends, stickers and bots (schema 3)

The same Rust service now persists per-message per-user emoji reactions, image stickers, friend requests/acceptance/removal, and scoped bot connections. State only exposes messages of joined rooms/dialogs; sticker images are visible to their creator and recipients of accessible messages. Reactions can be toggled by the current user, never on inaccessible messages. Existing databases gain empty collections without replacing accounts/history.

Operations: `reaction {message,emoji}`, `create_sticker {name,image}` (PNG/WebP data URL; custom library capped at 100), `message {channel,text?,sticker?}`, `friend_request {user}`, `friend_accept {id}`, `friend_remove {id}`, `create_bot {channel,name}`, `delete_bot {id}`. Only group owners create bots. Bot token is returned once, stored hashed, and delivered without changing the user's session cookie. Bot HTTP authentication uses Authorization Bearer, never the user session. See BOTS.md and bot-worker.mjs for the external AI adapter contract.

This is static custom-image sticker support, not Telegram pack import, animated stickers, or a background-removal editor. User library images can be sent/reused in chats. Browser receives updates every two seconds. Existing single-process JSON storage and shared HTTPS deployment requirements still apply; this change does not deploy a public service or configure an AI provider.

Validation: 5 Rust tests (including membership rejection, reaction toggle, sticker validation, friendship consent, bot scope/revocation and restart persistence); production build browser test in check-social-browser.mjs (two accounts, HTTP bot token, reactions, sticker send, friends, settings/devices, reload); voice browser regression (two peers, audio/video RTP, mute/leave/cleanup). QA data is isolated in social-qa/data-*; screenshots in social-qa and voice-qa.

Visual comparison: fresh chat, settings, sessions, devices and friends screenshots retain the source three-column geometry, dark palette and compact header; settings use the same matte material. Fresh voice screenshot retains reference/picture-2's purple stage and right-side chat. Hash icons and duplicate room introduction are removed per attachments 13–14; no paid/store/quest sections added.

## Group/dialog integration audit

`create_group` and `join_group` return the saved group; `create_channel` returns the saved channel. The UI selects these IDs directly instead of assuming that the last list item belongs to the current request. Responses are sent only after storage succeeds. Dialogs already return their persisted identity and reuse existing two-person conversations.

Validation: `cargo test --offline` covers group membership, inaccessible messages, repeated invitations, dialog reuse and reopening the database with saved messages. `node check-social-browser.mjs` also exercises group/channel creation through the production UI, two-account group and private messages, reload and screenshots. Test accounts use isolated QA data directories.

The storage remains the existing local JSON database, not PostgreSQL or a deployed Internet service. Different computers must connect to one shared backend as described above; independent embedded desktop databases do not synchronize.

