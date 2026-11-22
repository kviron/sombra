"""One-track local Sombra integration probe. No credentials, CDN URLs or media written to disk."""
import json
import os
import re
import subprocess
import sys
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from yandex_music import Client

TRACK = 'https://music.yandex.ru/album/13886032/track/71663565'
MAX_BYTES = 12 * 1024 * 1024


def fetch_audio():
    p = Path(os.environ['LOCALAPPDATA']) / 'Sombra/lavasrc-test/.env'
    prefix = 'PLUGINS_LAVASRC_YANDEXMUSIC_ACCESSTOKEN='
    token = next(x[len(prefix):].strip() for x in p.read_text().splitlines() if x.startswith(prefix))
    entries = [x for x in Client(token).tracks_download_info('71663565', timeout=15)
               if x.codec == 'mp3' and not x.preview]
    entry = min(entries, key=lambda x: x.bitrate_in_kbps)
    entry_bitrate = entry.bitrate_in_kbps
    url = entry.get_direct_link(timeout=15)
    if urlsplit(url).scheme != 'https':
        raise ValueError('Expected HTTPS media')
    audio = bytearray()
    total = None
    sample_bytes = min(MAX_BYTES, entry_bitrate * 1000 // 8 * 65) if '--sample' in sys.argv else MAX_BYTES
    while total is None or len(audio) < min(total, sample_bytes):
        start = len(audio)
        end = sample_bytes - 1 if sample_bytes != MAX_BYTES else start + 262143
        for attempt in range(3):
            try:
                req = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'})
                with urllib.request.urlopen(req, timeout=12) as r:
                    match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', r.headers.get('Content-Range', ''))
                    if r.status != 206 or not match or urlsplit(r.geturl()).scheme != 'https':
                        raise ValueError('Unexpected range response')
                    first, last, length = map(int, match.groups())
                    if first != start or not first <= last <= end or last >= length or length > MAX_BYTES or (total and total != length):
                        raise ValueError('Invalid range')
                    chunk = r.read(last - first + 1)
                    if len(chunk) != last - first + 1:
                        raise EOFError('Incomplete range')
                break
            except (OSError, EOFError):
                if attempt == 2:
                    raise
        total = length
        audio.extend(chunk)
    pcm = subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-xerror', '-f', 'mp3', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], input=audio, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=30).stdout
    duration = round(len(pcm) / 16)
    if (sample_bytes == MAX_BYTES and abs(duration - 247050) > 3000) or not any(pcm[60 * 16000:]):
        raise ValueError('Audio is incomplete')
    return bytes(audio), duration


def main():
    print('Fetching one fixed test track...', flush=True)
    audio, duration = fetch_audio()
    path = '/' + uuid4().hex + '.mp3'

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_HEAD(self):
            self.serve(False)

        def do_GET(self):
            self.serve(True)

        def serve(self, body):
            if self.path != path:
                self.send_error(404)
                return
            start, end = 0, len(audio) - 1
            header = self.headers.get('Range')
            if header is not None:
                match = re.fullmatch(r'bytes=(\d{1,12})-(\d{0,12})', header)
                if match:
                    start = int(match[1]); end = min(end, int(match[2])) if match[2] else end
                if not match or start > end:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{len(audio)}')
                    self.end_headers()
                    return
            self.send_response(206 if header else 200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', str(end - start + 1))
            self.send_header('Accept-Ranges', 'bytes')
            self.send_header('Cache-Control', 'no-store')
            if header:
                self.send_header('Content-Range', f'bytes {start}-{end}/{len(audio)}')
            self.end_headers()
            if body:
                try:
                    self.wfile.write(audio[start:end + 1])
                except (BrokenPipeError, ConnectionResetError):
                    pass

    with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
        print(json.dumps({'inputUrl': TRACK, 'url': f'http://127.0.0.1:{server.server_port}{path}', 'title': 'Architects — Animals', 'durationMs': duration}, ensure_ascii=True), flush=True)
        server.serve_forever()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Some library and HTTP exceptions include signed media URLs; never print them.
        print('Probe failed: ' + type(exc).__name__, flush=True)
        raise SystemExit(1)
