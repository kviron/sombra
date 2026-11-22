#!/usr/bin/env python3
"""Loopback wire and CLI regression tests; no production credentials or network."""
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import socket
import contextlib
import io
import sys
import threading
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('turn-monitor.py')
spec = importlib.util.spec_from_file_location('monitor', SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
USER = 'test-user'
PASSWORD = 'test-password-not-for-production'
KEY = hashlib.md5(f'{USER}:fake-realm:{PASSWORD}'.encode()).digest()


class Fixture:
    def __init__(self, protocol, fault=None):
        self.protocol, self.fault = protocol, fault
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM if protocol == 'udp' else socket.SOCK_STREAM)
        self.sock.bind(('127.0.0.1', 0))
        self.sock.settimeout(0.05)
        self.address = self.sock.getsockname()
        self.stop = threading.Event()
        self.clients = []
        self.threads = []
        self.lock = threading.Lock()
        self.relays = {}
        self.permissions = set()
        self.cleaned = 0
        self.payloads = 0
        if protocol == 'tcp':
            self.sock.listen()

    def start(self, fn, *args):
        thread = threading.Thread(target=fn, args=args, daemon=True)
        self.threads.append(thread)
        thread.start()

    def __enter__(self):
        self.start(self.listen)
        return self

    def __exit__(self, *_):
        self.stop.set()
        for thread in self.threads:
            thread.join(1)
        for sock in [self.sock, *self.clients]:
            sock.close()

    def listen(self):
        while not self.stop.is_set():
            try:
                if self.protocol == 'udp':
                    wire, address = self.sock.recvfrom(65535)
                    self.handle(wire, address, lambda data, dest=address: self.sock.sendto(data, dest))
                else:
                    conn, _ = self.sock.accept()
                    self.clients.append(conn)
                    conn.settimeout(0.05)
                    self.start(self.stream, conn)
            except TimeoutError:
                continue

    def stream(self, conn):
        data = bytearray()
        while not self.stop.is_set():
            try:
                part = conn.recv(4096)
            except TimeoutError:
                continue
            if not part:
                return
            data.extend(part)
            while len(data) >= 20:
                size = 20 + int.from_bytes(data[2:4], 'big')
                if len(data) < size:
                    break
                self.handle(bytes(data[:size]), conn, conn.sendall)
                del data[:size]

    def handle(self, wire, source, reply):
        with self.lock:
            kind, tx, attrs, signed = m.decode(wire, KEY)
            if kind == m.ALLOCATE and not attrs.get(m.USERNAME):
                reply(m.packet(kind | 0x110, tx, [(m.ERROR, b'\0\0\x04\x01'), (m.REALM, b'fake-realm'), (m.NONCE, b'nonce-1')]))
            elif kind != m.SEND and (not signed or attrs.get(m.USERNAME) != USER.encode()):
                reply(m.packet(kind | 0x110, tx, [(m.ERROR, b'\0\0\x04\x01')]))
            elif kind == m.ALLOCATE:
                if self.fault == 'stale' and attrs[m.NONCE] != b'nonce-2':
                    reply(m.packet(kind | 0x110, tx, [(m.ERROR, b'\0\0\x04\x26'), (m.REALM, b'fake-realm'), (m.NONCE, b'nonce-2')]))
                    return
                address = ('127.0.0.1', 55000 + len(self.relays))
                self.relays[source] = (address, reply)
                reply(m.packet(kind | 0x100, tx, [(m.RELAY, m.xor_address(address, tx, encode=True))], b'incorrect' if self.fault == 'integrity' else KEY))
            elif kind == m.PERMISSION:
                self.permissions.add((source, m.xor_address(attrs[m.PEER], tx)))
                reply(m.packet(kind | 0x100, tx, [], KEY))
            elif kind == m.REFRESH and attrs[m.LIFETIME] == bytes(4):
                self.cleaned += int(source in self.relays)
                self.relays.pop(source, None)
                reply(m.packet(kind | 0x100, tx, [], KEY))
            elif kind == m.SEND and source in self.relays:
                target = m.xor_address(attrs[m.PEER], tx)
                sender = self.relays[source][0]
                for pid, (address, forward) in self.relays.items():
                    if (address == target and (source, target) in self.permissions and (pid, sender) in self.permissions
                            and not (self.fault == 'reverse' and sender[1] == 55001)):
                        self.payloads += 1
                        payload = attrs[m.DATA] if self.fault != 'payload' else b'wrong'
                        forward(m.packet(m.INDICATION, tx, [(m.PEER, m.xor_address(sender, tx, encode=True)), (m.DATA, payload)]))

    def config(self):
        return {'host': self.address[0], 'port': self.address[1], 'username': USER, 'password': PASSWORD}


class MonitorTest(unittest.TestCase):
    def test_success_and_cleanup(self):
        for protocol in ('udp', 'tcp'):
            with self.subTest(protocol=protocol), Fixture(protocol) as turn:
                self.assertEqual(m.probe(turn.config(), turn.config(), protocol, 1), ('ok', 'bidirectional-relay'))
                self.assertEqual(turn.cleaned, 2)
                self.assertEqual(turn.payloads, 2)

    def test_stale_nonce(self):
        with Fixture('udp', 'stale') as turn:
            self.assertEqual(m.probe(turn.config(), turn.config(), 'udp', 1)[0], 'ok')

    def test_bad_integrity(self):
        with Fixture('tcp', 'integrity') as turn:
            self.assertEqual(m.probe(turn.config(), turn.config(), 'tcp', 1), ('allocate', 'invalid-response-integrity'))

    def test_bad_credentials(self):
        with Fixture('udp') as turn:
            config = {**turn.config(), 'password': 'incorrect'}
            self.assertEqual(m.probe(config, config, 'udp', 1), ('allocate', 'turn-error-401'))

    def test_reverse_blocked(self):
        with Fixture('tcp', 'reverse') as turn:
            self.assertEqual(m.probe(turn.config(), turn.config(), 'tcp', 1), ('reverse', 'timeout'))
            self.assertEqual(turn.cleaned, 2)

    def test_payload_mismatch(self):
        with Fixture('udp', 'payload') as turn:
            self.assertEqual(m.probe(turn.config(), turn.config(), 'udp', 1), ('forward', 'timeout'))

    def test_rfc5769_integrity(self):
        wire = bytes.fromhex('000100582112a442b7e7a701bc34d686fa87dfae802200105354554e207465737420636c69656e74002400046e0001ff80290008932ff9b151263b36000600096576746a3a68367659202020000800149aeaa70cbfd8cb56781ef2b5b2d3f249c1b571a280280004e57a3bcf')
        self.assertTrue(m.decode(wire, b'VOkJxbRl1RmTxUk/WvJxBt')[3])

    def test_ipv6_address(self):
        addr, tx = ('2001:db8::2', 49160), b'0123456789ab'
        self.assertEqual(m.xor_address(m.xor_address(addr, tx, encode=True), tx), addr)

    def test_cli_no_secret_in_logs(self):
        with Fixture('udp') as turn, patch.object(sys, 'argv', ['monitor', '--config', 'private', '--transport', 'udp']):
            out, err = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                with patch.object(m, 'configuration', return_value={'target': turn.config()}):
                    self.assertEqual(m.main(), 0)
                with patch.object(m, 'configuration', side_effect=ValueError(PASSWORD)):
                    self.assertEqual(m.main(), 2)
            self.assertEqual(json.loads(out.getvalue())['status'], 'ok')
            self.assertNotIn(PASSWORD, out.getvalue() + err.getvalue())
            self.assertNotIn(USER, out.getvalue() + err.getvalue())


if __name__ == '__main__':
    unittest.main()
