"""Opt-in loopback-only MP3 range bridge for one approved Yandex track.

No audio is written to disk. The caller must enforce room membership. Do not
publish this listener through nginx or any other public route.
"""
import argparse
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

TRACK = '39312848'
MAX_BYTES = 10 * 1024 * 1024
CHUNK = 262144


def https(url):
    return bool(re.fullmatch(r'https://[^\s"\\]+', url)) and urlsplit(url).hostname is not None


class Provider:
    def __init__(self, token):
        from yandex_music import Client
        self.client = Client(token)
        self.lock = threading.Lock()
        self.link = None
        self.expires = 0

    def url(self, refresh=False):
        with self.lock:
            if refresh or not self.link or time.monotonic() >= self.expires:
                options = [x for x in self.client.tracks_download_info(TRACK, timeout=8) if x.codec == 'mp3' and not x.preview]
                link = min(options, key=lambda x: x.bitrate_in_kbps).get_direct_link(timeout=8)
                if not https(link):
                    raise ValueError('Unexpected source URL')
                self.link = link
                self.expires = time.monotonic() + 180
            return self.link

    def chunk(self, offset):
        for refresh in (False, True):
            url = self.url(refresh)
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
            query = parse_qs(parsed.query, strict_parsing=False, max_num_fields=8) if len(self.path) <= 256 else {}
            if parsed.path != '/chunk' or set(query) != {'id', 'offset', 'limit'} or query['id'] != [TRACK] or query['limit'] != [str(CHUNK)] or len(query['offset']) != 1 or not re.fullmatch(r'0|[1-9][0-9]{0,7}', query['offset'][0]):
                self.send_error(404)
                return
            offset = int(query['offset'][0]);
            if offset >= MAX_BYTES or offset % CHUNK:
                self.send_error(416)
                return
            if not slots.acquire(blocking=False):
                self.send_error(503)
                return
            try:
                audio, total = provider.chunk(offset)
            except Exception:
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
            app.serve_forever()
    except KeyboardInterrupt:
        pass
    except Exception:
        raise SystemExit('Music helper could not start') from None
