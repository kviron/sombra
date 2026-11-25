import json
import threading
import unittest
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import urlopen

from yandex_stream_helper import CHUNK, Provider, server, track_metadata


class ResolverTests(unittest.TestCase):
    def test_track_metadata_accepts_yandex_artwork_and_optional_artist(self):
        track = SimpleNamespace(
            artists=[SimpleNamespace(name='First'), SimpleNamespace(name='Second')],
            cover_uri='avatars.yandex.net/get-music-content/42/%%',
        )
        self.assertEqual(track_metadata(track), {
            'artist': 'First, Second',
            'coverUrl': 'https://avatars.yandex.net/get-music-content/42/200x200',
        })
        track.cover_uri = 'music-avatars.music.yandex.net/get-music-content/42/%%'
        self.assertEqual(track_metadata(track)['coverUrl'], 'https://music-avatars.music.yandex.net/get-music-content/42/200x200')
        track.cover_uri = 'avatars.yandex.net.example.org/%%'
        self.assertNotIn('coverUrl', track_metadata(track))
        self.assertEqual(track_metadata(SimpleNamespace()), {})

    def test_playlist_order_and_duplicates_survive_metadata_lookup(self):
        provider = Provider.__new__(Provider)
        provider.client = SimpleNamespace(
            playlist=lambda *args, **kwargs: SimpleNamespace(tracks=[SimpleNamespace(id=i) for i in (9, 3, 9, 4)]),
            tracks=lambda ids, **kwargs: [SimpleNamespace(id=i, title=f'Track {i}', duration_ms=1234, available=True) for i in sorted(set(ids))],
        )
        rows = provider.resolve({'playlist': 'fixture'}, 3)
        self.assertEqual([row['id'] for row in rows], ['9', '3', '9'])

    def test_large_playlist_batches_lookups_and_keeps_order(self):
        provider = Provider.__new__(Provider)
        calls = []

        def tracks(ids, *, timeout):
            calls.append(ids)
            self.assertGreater(timeout, 0)
            self.assertLessEqual(timeout, 8)
            return [SimpleNamespace(id=i, title=f'Track {i}', duration_ms=1234, available=i != '5')
                    for i in reversed(ids) if i != '7']

        ids = [*range(1000, 2, -1), 'bad', 1000, 4321]
        provider.client = SimpleNamespace(
            users_playlists=lambda kind, **kwargs: SimpleNamespace(tracks=[SimpleNamespace(id=i) for i in ids]),
            tracks=tracks,
        )
        rows = provider.resolve({'owner': 'example', 'kind': '1'}, 1000)
        self.assertEqual([len(batch) for batch in calls], [100] * 9 + [98])
        self.assertEqual([row['id'] for row in rows], [str(i) for i in ids[:1000] if i not in (5, 7, 'bad')])

    def test_http_shape_and_bounds(self):
        def resolve(query, limit):
            self.assertEqual(query, {'owner': 'example', 'kind': '1'})
            return [{'id': '1', 'title': 'Fixture', 'durationMs': 1000}] * limit

        provider = SimpleNamespace(resolve=resolve, chunk=lambda track, offset: (b'123', 3))
        with server(provider, 0) as app:
            thread = threading.Thread(target=app.serve_forever, daemon=True)
            thread.start()
            base = f'http://127.0.0.1:{app.server_port}'
            try:
                with urlopen(base + '/resolve?owner=example&kind=1&limit=2', timeout=3) as response:
                    self.assertEqual(len(json.load(response)['tracks']), 2)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                with urlopen(base + f'/chunk?id=1&offset=0&limit={CHUNK}', timeout=3) as response:
                    self.assertEqual(response.status, 206)
                    self.assertEqual(response.headers['Content-Range'], 'bytes 0-2/3')
                    self.assertEqual(response.read(), b'123')
                with urlopen(base + '/resolve?owner=example&kind=1&limit=1000', timeout=3) as response:
                    self.assertEqual(len(json.load(response)['tracks']), 1000)
                for suffix in ('limit=1001', 'limit=0', 'limit=010', 'limit=1.5', 'limit=1&limit=2'):
                    with self.assertRaises(HTTPError) as error:
                        urlopen(base + '/resolve?owner=example&kind=1&' + suffix, timeout=3)
                    self.assertEqual(error.exception.code, 400)
                    error.exception.close()
            finally:
                app.shutdown()
                thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
