"""Loopback-only, seekable WAV fixture for the local Sombra room-music MVP."""
import io
import math
import re
import struct
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


with io.BytesIO() as output:
    with wave.open(output, "wb") as wav:
        wav.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        wav.writeframes(b"".join(
            struct.pack("<h", int(1400 * math.sin(2 * math.pi * 440 * i / 8000)))
            for i in range(8000 * 30)
        ))
    AUDIO = output.getvalue()


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        self._audio(body=True)

    def do_HEAD(self):
        self._audio(body=False)

    def _audio(self, *, body):
        if self.path != "/test.wav":
            self.send_error(404)
            return
        size = len(AUDIO)
        start, end = 0, size - 1
        requested = self.headers.get("Range")
        if requested is not None:
            parsed = re.fullmatch(r"bytes=([0-9]{0,20})-([0-9]{0,20})", requested)
            if parsed and parsed[1]:
                start = int(parsed[1])
                if parsed[2]:
                    end = min(end, int(parsed[2]))
            elif parsed and parsed[2] and int(parsed[2]) > 0:
                start = max(0, size - int(parsed[2]))
            else:
                start = size
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        self.send_response(206 if requested is not None else 200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if requested is not None:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if body:
            self.wfile.write(AUDIO[start:end + 1])


if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", 8765), Fixture) as httpd:
        print("Local 30-second WAV: http://127.0.0.1:8765/test.wav", flush=True)
        httpd.serve_forever()
