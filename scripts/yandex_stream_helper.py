"""Opt-in loopback-only MP3 range bridge for Yandex tracks and playlists.

No audio is written to disk. The caller must enforce room membership. Do not
publish this listener through nginx or any other public route.
"""
import argparse
import json
from collections import OrderedDict
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

TRACK_ID = re.compile(r'[1-9][0-9]{0,18}')
PLAYLIST_ID = re.compile(r'(?:lk\.)?[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}')
OWNER = re.compile(r'[A-Za-z0-9_.-]{1,64}')
MAX_BYTES = 10 * 1024 * 1024
CHUNK = 262144
MAX_RESOLVE_TRACKS = 1000
METADATA_BATCH_SIZE = 100
RESOLVE_TIMEOUT = 16
URL_IN_TEXT = re.compile(r'https?://[^\s"\']+')


def diagnostic(reason, error):
    """One bounded line per failure: the operator needs the cause, never a URL or token."""
    text = URL_IN_TEXT.sub('<url>', str(error))[:160].replace('\n', ' ')
    print(f'music {reason}: {type(error).__name__}: {text}', file=sys.stderr, flush=True)


def https(url):
    return bool(re.fullmatch(r'https://[^\s"\\]+', url)) and urlsplit(url).hostname is not None


class Provider:
    def __init__(self, token):
        from yandex_music import Client
        self.client = Client(token)
        self.lock = threading.Lock()
        self.links = OrderedDict()

    def resolve(self, query, limit):
        if 'id' in query:
            tracks = self.client.tracks([query['id']], timeout=8)
        else:
            deadline = time.monotonic() + RESOLVE_TIMEOUT
            playlist = (self.client.playlist(query['playlist'], timeout=8) if 'playlist' in query else
                        self.client.users_playlists(query['kind'], user_id=query['owner'], timeout=8))
            if not playlist:
                return []
            candidates = [str(item.id) for item in (playlist.tracks or [])[:limit]]
            unique = list(dict.fromkeys(i for i in candidates if TRACK_ID.fullmatch(i)))
            by_id = {}
            for start in range(0, len(unique), METADATA_BATCH_SIZE):
                batch = unique[start:start + METADATA_BATCH_SIZE]
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                requested = set(batch)
                for track in self.client.tracks(batch, timeout=min(8, remaining)):
                    tid = str(track.id)
                    if tid in requested:
                        by_id[tid] = track
            if time.monotonic() >= deadline:
                raise TimeoutError()
            # The provider need not return metadata in playlist order.
            tracks = [by_id[i] for i in candidates if i in by_id]
        result = []
        for t in tracks[:limit]:
            tid, duration = str(t.id), t.duration_ms
            if not TRACK_ID.fullmatch(tid) or not isinstance(duration, int) or not 0 < duration <= 86400000 or not t.available:
                continue
            title = ' '.join((t.title or '').split())[:120] or 'Яндекс Музыка'
            result.append(dict(id=tid,title=title,durationMs=duration))
        return result

    def url(self, track, refresh=False):
        with self.lock:
            cached = self.links.get(track)
            if cached and not refresh and time.monotonic() < cached[1]:
                self.links.move_to_end(track)
                return cached[0]
        options = [x for x in self.client.tracks_download_info(track, timeout=8) if x.codec == 'mp3' and not x.preview]
        link = min(options, key=lambda x: x.bitrate_in_kbps).get_direct_link(timeout=8)
        if not https(link):
            raise ValueError('Unexpected source URL')
        with self.lock:
            self.links[track] = (link, time.monotonic() + 180)
            self.links.move_to_end(track)
            if len(self.links) > 64:
                self.links.popitem(last=False)
        return link

    def chunk(self, track, offset):
        for refresh in (False, True):
            url = self.url(track, refresh)
            # URL is supplied via stdin rather than argv or logs. Bound response
            # bytes before considering headers so a range-ignoring CDN fails closed.
            proc = subprocess.run(['curl', '-q', '--config', '-', '--proto', '=https', '--proto-redir', '=https',
                                   '--location', '--max-redirs', '3', '--fail', '--silent', '--max-time', '8',
                                   '--max-filesize', str(CHUNK), '--include', '--range', f'{offset}-{offset + CHUNK - 1}',
                                   '-H', 'Accept-Encoding: identity'], input=f'url = "{url}"\n'.encode(),
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10)
            if proc.returncode:
                continue
            data = proc.stdout
            for _ in range(6):
                head, sep, body = data.partition(b'\r\n\r\n')
                if not sep or len(head) > 16384:
                    break
                status = re.match(rb'HTTP/\S+ (\d+)', head)
                match = re.search(rb'(?im)^content-range:\s*bytes (\d+)-(\d+)/(\d+)\s*$', head)
                if status and status[1] == b'206' and match:
                    start, end, total = map(int, match.groups())
                    if start == offset and start <= end < total <= MAX_BYTES and len(body) == end - start + 1 <= CHUNK:
                        return body, total
                    break
                if not body.startswith(b'HTTP/'):
                    break
                data = body
        raise ValueError('Provider unavailable')


def server(provider, port):
    slots = threading.BoundedSemaphore(4)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            parsed = urlsplit(self.path)
            try:
                fields = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=8) if len(self.path) <= 256 else {}
                query = {key: values[0] for key, values in fields.items() if len(values) == 1}
                if len(query) != len(fields):
                    raise ValueError()
            except ValueError:
                self.send_error(400)
                return
            if parsed.path == '/resolve':
                self.resolve(query)
                return
            if parsed.path != '/chunk' or set(query) != {'id', 'offset', 'limit'} or not TRACK_ID.fullmatch(query['id']) or query['limit'] != str(CHUNK) or not re.fullmatch(r'0|[1-9][0-9]{0,7}', query['offset']):
                self.send_error(404)
                return
            offset = int(query['offset'])
            if offset >= MAX_BYTES or offset % CHUNK:
                self.send_error(416)
                return
            if not slots.acquire(blocking=False):
                diagnostic('chunk busy', ValueError('no free slot'))
                self.send_error(503)
                return
            try:
                audio, total = provider.chunk(query['id'], offset)
            except Exception as error:
                diagnostic('chunk failed', error)
                self.send_error(502)
                return
            finally:
                slots.release()
            self.send_response(206)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Range', f'bytes {offset}-{offset + len(audio) - 1}/{total}')
            self.send_header('Content-Length', str(len(audio)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(audio)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def resolve(self, query):
            limit = query.pop('limit', '')
            if not re.fullmatch(r'[1-9][0-9]{0,3}', limit) or int(limit) > MAX_RESOLVE_TRACKS:
                self.send_error(400)
                return
            valid = ((set(query) == {'id'} and TRACK_ID.fullmatch(query['id'])) or
                     (set(query) == {'playlist'} and PLAYLIST_ID.fullmatch(query['playlist'])) or
                     (set(query) == {'owner', 'kind'} and OWNER.fullmatch(query['owner']) and TRACK_ID.fullmatch(query['kind'])))
            if not valid:
                self.send_error(400)
                return
            if not slots.acquire(blocking=False):
                diagnostic('resolve busy', ValueError('no free slot'))
                self.send_error(503)
                return
            try:
                body = json.dumps({'tracks': provider.resolve(query, int(limit))}, ensure_ascii=False).encode()
            except Exception as error:
                diagnostic('resolve failed', error)
                self.send_error(502)
                return
            finally:
                slots.release()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

    return ThreadingHTTPServer(('127.0.0.1', port), Handler)


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--port', type=int, default=18761)
    ns = args.parse_args()
    try:
        credentials = os.environ.get('CREDENTIALS_DIRECTORY')
        token = (Path(credentials) / 'yandex-token').read_text().strip() if credentials else os.environ['PLUGINS_LAVASRC_YANDEXMUSIC_ACCESSTOKEN']
        if not token:
            raise ValueError('Missing secret')
        with server(Provider(token), ns.port) as app:
            print(f'music helper listening on 127.0.0.1:{ns.port}', file=sys.stderr, flush=True)
            app.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:
        raise SystemExit('Music helper could not start') from None
