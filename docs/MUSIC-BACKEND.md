# Local room music

Run only against a disposable local data directory. Music state is memory-only and independent per voice channel or live dialog call. It resets on server restart or when the last voice lease leaves/expires. It is not mixed into WebRTC: each client plays the same approved audio against the server's shared timeline.

## Test catalog

The operator sets `MINES_MUSIC_TEST_CATALOG` to a JSON array of `{ "url": "…", "title": "…", "durationMs": 30000 }`. An absent variable means an empty catalog; malformed configuration prevents startup. Only catalog entries can be queued; media URLs are matched exactly. An entry may also include an optional `inputUrl` string for a local test alias. The entry’s `url` must then be an approved HTTP(S) URL on `localhost` or a loopback IP. The alias must be HTTPS on `music.yandex.ru`, `music.yandex.com`, or `music.ya.ru`, with `/track/<digits>` or `/album/<digits>/track/<digits>` and no credentials, explicit port, or fragment. Scheme and host case, a single trailing slash, and share query parameters are ignored. The host and full path must otherwise match; duplicate normalized aliases are rejected. Responses include only the approved media URL, never `inputUrl`. The server never fetches audio. Serve only public, seekable audio you control (no credentials, secret tokens, or redirects), and supply its actual duration. URLs must be HTTPS or loopback HTTP. Loopback is suitable for two clients on one machine; for tests on separate devices, use an approved HTTPS source reachable by both clients.

From ``, run the Python 3 loopback-only fixture. It serves a 30-second WAV with byte-range support:

```powershell
python scripts/music_test_audio.py
```

In a second PowerShell terminal, from ``:

```powershell
$env:MINES_DATA_DIR = Join-Path $env:TEMP ('sombra-music-db-' + [guid]::NewGuid())
$env:MINES_BIND = '127.0.0.1:3847'
$env:MINES_MUSIC_TEST_CATALOG = '[{"inputUrl":"https://music.yandex.ru/track/12345","url":"http://127.0.0.1:8765/test.wav","title":"Test tone","durationMs":30000}]'
cargo run --no-default-features --bin mines-server
```

Use local login credentials from `FIRST-USER.txt` in that data directory, join a voice room, and add `http://127.0.0.1:8765/test.wav` or the example alias `https://music.yandex.ru/track/12345`. The alias plays the same synthetic tone. Yandex Music itself is not implemented: unconfigured Yandex links return `MUSIC_PROVIDER_NOT_CONFIGURED`; there is no scraping, credential forwarding, or unofficial provider fallback.

## Client and verification

The group voice-room widget sits below the call controls. `/play <url>`, `/pause`, `/resume`, `/skip` and `/stop` in the room chat operate the same queue and are not posted as chat messages. Volume is client-local. With the lockstep test running, switching to a text channel does not interrupt audio while the client stays connected to voice.

On Windows with Chrome installed, build the local `mines-server` binary and run `node check-room-music-browser.mjs`. Set `SOMBRA_QA_SERVER_EXE` to override the executable path. This starts a disposable server and two Chrome sessions with a generated WAV, without using production or external music credentials.

## Local Yandex room probe

On Windows, with Chrome and FFmpeg installed and a locally authorized test token, run `uv run --no-project --with yandex-music python scripts/yandex_room_probe.py --sample`. This decodes one fixed track sample, keeps the audio in memory, and serves it at a random loopback-only URL. Pass the printed JSON object as `SOMBRA_QA_MUSIC_SOURCE` to `node check-room-music-browser.mjs` with a freshly built server. The same Yandex URL is tested through the widget and `/play`. Stop the probe when finished. This is not a general Yandex resolver or a multi-device streaming service.

## Closed-room streaming

When `MINES_MUSIC_STREAM_HELPER` is configured, the closed test room accepts Yandex HTTPS track links (`/track/<id>` or `/album/<id>/track/<id>`) and playlist links (`/playlists/<uuid>` or `/users/<owner>/playlists/<id>`). Share-query parameters are ignored. The widget and `/play` use the same server queue. Playlist order and duplicates are preserved, unavailable entries are skipped, and only available queue slots are filled (32 waiting tracks maximum).

The helper binds only to loopback. It resolves metadata and fetches MP3 byte ranges without writing audio files. The browser requests `music_stream_chunk` with room ID, opaque current asset ID and byte offset. Every request requires an active voice lease from the same authenticated session; no source URL or provider token is returned.

## Yandex authorization

A personal subscription is not authorization for third-party room streaming (see [Yandex Music Terms, §2.7](https://yandex.ru/legal/music_termsofuse/ru)). Before enabling a provider, obtain a documented authorization flow and permission for the target playback scenario. Store any authorized tokens only in the provider service's protected secret store, never in chat, the desktop client, the test catalog, or API responses. The current build deliberately has no login flow or account token field and has not tested a real Yandex account.

## API

Send `POST /api` with the human session cookie. Both operations require the caller to be a room member and have an active voice lease **from the same session**. Music requests do not renew that lease; keep issuing regular `voice_poll`.

- `{"op":"music_state","room":"…"}`
- `{"op":"music_command","room":"…","action":"add|pause|resume|skip|stop","url":"…"}` (`url` required for `add` only).

Success: `{ "data": { "room": "…", "revision": 1, "serverTimeMs": 1700000000000, "positionMs": 0, "status": "playing", "track": { "id": "…", "title": "Test tone", "url": "http://127.0.0.1:8765/test.wav", "durationMs": 30000 }, "queue": [] } }`. `track` is null when `status` is `idle`; paused state reports `paused`. `positionMs` is sampled at UNIX `serverTimeMs` and only progresses while playing. Poll for track changes and correct drift against the server timeline. `revision` orders changes within one room lifecycle, not across a restart or empty-room reset. Each queue entry gets a unique track ID, even for repeated URLs.

`add` starts an idle room, otherwise appends (32 waiting tracks maximum). `pause` freezes the current position; `resume` continues there. `skip` starts the next track immediately (or goes idle); `stop` clears playback and its queue. The next queued track is selected automatically when a track ends, preserving elapsed time even when no request arrived at the transition.

Errors use `{ "error": "CODE" }`: HTTP 401 `AUTH_REQUIRED`; HTTP 403 `MUSIC_ROOM_FORBIDDEN`, `MUSIC_VOICE_REQUIRED`; HTTP 400 `MUSIC_INVALID_ACTION`, `MUSIC_INVALID_URL`, `MUSIC_SOURCE_NOT_APPROVED`, `MUSIC_PROVIDER_NOT_CONFIGURED`, `MUSIC_QUEUE_FULL`.
