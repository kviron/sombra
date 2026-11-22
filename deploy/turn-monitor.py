#!/usr/bin/env python3
"""One-shot authenticated TURN relay probe; no inbound listeners or dependencies."""
import argparse
import contextlib
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import stat
import struct
import sys
import time
from pathlib import Path

COOKIE = 0x2112A442
HEADER = struct.Struct('!HHI12s')
ALLOCATE, REFRESH, PERMISSION = 0x003, 0x004, 0x008
SEND, INDICATION = 0x016, 0x017
USERNAME, INTEGRITY, ERROR, LIFETIME = 6, 8, 9, 13
PEER, DATA, REALM, NONCE, RELAY, TRANSPORT = 18, 19, 20, 21, 22, 25


class ProbeError(Exception):
    pass


def attr(kind, value):
    return struct.pack('!HH', kind, len(value)) + value + bytes((-len(value)) % 4)


def packet(kind, tx, fields, key=None):
    body = b''.join(attr(k, v) for k, v in fields)
    header = HEADER.pack(kind, len(body) + (24 if key is not None else 0), COOKIE, tx)
    wire = header + body
    return wire if key is None else wire + attr(INTEGRITY, hmac.digest(key, wire, 'sha1'))


def decode(wire, key=None):
    if len(wire) < HEADER.size:
        raise ProbeError('invalid-frame')
    kind, size, cookie, tx = HEADER.unpack_from(wire)
    if cookie != COOKIE or kind & 0xc000 or size % 4 or len(wire) != HEADER.size + size:
        raise ProbeError('invalid-frame')
    fields = {}
    authenticated = False
    pos = HEADER.size
    while pos < len(wire):
        k, n = struct.unpack_from('!HH', wire, pos)
        end = pos + 4 + n
        if end > len(wire):
            raise ProbeError('invalid-attribute')
        v = wire[pos + 4:end]
        if k == INTEGRITY:
            if key is not None:
                signed = HEADER.pack(kind, pos + 24 - HEADER.size, COOKIE, tx) + wire[HEADER.size:pos]
                authenticated = n == 20 and hmac.compare_digest(v, hmac.digest(key, signed, 'sha1'))
            break  # Only attributes covered by MESSAGE-INTEGRITY are used.
        fields.setdefault(k, v)
        pos = end + (-n) % 4
    return kind, tx, fields, authenticated


def xor_address(value, tx, *, encode=False):
    mask = struct.pack('!I', COOKIE) + tx
    if encode:
        host, port = value
        ip = ipaddress.ip_address(host)
        return struct.pack('!BBH', 0, 1 if ip.version == 4 else 2, port ^ (COOKIE >> 16)) + bytes(
            a ^ b for a, b in zip(ip.packed, mask))
    if len(value) < 4:
        raise ProbeError('invalid-address')
    reserved, family, port = struct.unpack_from('!BBH', value)
    if reserved or (family, len(value)) not in ((1, 8), (2, 20)):
        raise ProbeError('invalid-address')
    return str(ipaddress.ip_address(bytes(a ^ b for a, b in zip(value[4:], mask)))), port ^ (COOKIE >> 16)


class Allocation:
    def __init__(self, config, protocol, timeout):
        self.user = config['username'].encode()
        self.password = config['password'].encode()
        self.timeout = timeout
        self.udp = protocol == 'udp'
        self.key = self.realm = self.nonce = self.relay = None
        self.stream = bytearray()
        kind = socket.SOCK_DGRAM if self.udp else socket.SOCK_STREAM
        results = socket.getaddrinfo(config['host'], config['port'], socket.AF_UNSPEC, kind)
        deadline = time.monotonic() + timeout
        for family, socktype, proto, _, address in results:
            sock = socket.socket(family, socktype, proto)
            try:
                sock.settimeout(self.remaining(deadline))
                sock.connect(address)
            except OSError:
                sock.close()
            else:
                self.sock = sock
                break
        else:
            raise ProbeError('connect-failed')

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if self.relay:
            with contextlib.suppress(ProbeError, OSError):
                self.request(REFRESH, [(LIFETIME, bytes(4))], timeout=min(self.timeout, 1))
        self.sock.close()

    @staticmethod
    def remaining(deadline):
        left = deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError
        return left

    def fill(self, size, deadline):
        while len(self.stream) < size:
            self.sock.settimeout(self.remaining(deadline))
            part = self.sock.recv(size - len(self.stream))
            if not part:
                raise ProbeError('connection-closed')
            self.stream.extend(part)

    def receive(self, deadline, key=None):
        if self.udp:
            self.sock.settimeout(self.remaining(deadline))
            wire = self.sock.recv(65535)
        else:
            self.fill(HEADER.size, deadline)
            _, size, _, _ = HEADER.unpack_from(self.stream)
            end = HEADER.size + size
            self.fill(end, deadline)
            wire = bytes(self.stream[:end])
            del self.stream[:end]
        return decode(wire, key)

    def send(self, wire, deadline):
        self.sock.settimeout(self.remaining(deadline))
        self.sock.sendall(wire)

    def exchange(self, method, fields, deadline, key=None):
        tx = secrets.token_bytes(12)
        wire = packet(method, tx, fields(tx), key)
        interval = 0.5
        while True:
            self.send(wire, deadline)
            wait_until = min(deadline, time.monotonic() + interval) if self.udp else deadline
            try:
                while True:
                    kind, received_tx, values, signed = self.receive(wait_until, key)
                    if received_tx == tx and kind in (method | 0x100, method | 0x110):
                        return kind, tx, values, signed
            except TimeoutError:
                self.remaining(deadline)
                if not self.udp:
                    raise
                interval *= 2

    @staticmethod
    def error(fields):
        raw = fields.get(ERROR, b'')
        return (raw[2] & 7) * 100 + raw[3] if len(raw) >= 4 else 0

    def challenge(self, fields):
        realm, nonce = fields.get(REALM), fields.get(NONCE)
        if not realm or not nonce or (self.realm is not None and realm != self.realm):
            raise ProbeError('invalid-challenge')
        self.realm, self.nonce = realm, nonce
        self.key = hashlib.md5(b':'.join((self.user, realm, self.password))).digest()

    def request(self, method, fields=(), *, peer=None, timeout=None):
        deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
        def parameters(tx):
            return list(fields) + ([(PEER, xor_address(peer, tx, encode=True))] if peer else [])
        if self.key is None:
            kind, _, values, _ = self.exchange(method, parameters, deadline)
            if kind != method | 0x110 or self.error(values) != 401:
                raise ProbeError('expected-auth-challenge')
            self.challenge(values)
        for _ in range(2):
            def authenticated_fields(tx):
                return parameters(tx) + [(USERNAME, self.user), (REALM, self.realm), (NONCE, self.nonce)]
            kind, tx, values, signed = self.exchange(method, authenticated_fields, deadline, self.key)
            if kind == method | 0x100:
                if not signed:
                    raise ProbeError('invalid-response-integrity')
                return tx, values
            code = self.error(values)
            if code != 438:
                raise ProbeError(f'turn-error-{code:03d}')
            self.challenge(values)
        raise ProbeError('stale-nonce')

    def allocate(self):
        tx, values = self.request(ALLOCATE, [(TRANSPORT, b'\x11\x00\x00\x00'),
                                             (LIFETIME, struct.pack('!I', 60))])
        self.relay = xor_address(values.get(RELAY, b''), tx)
        if not self.relay[1] or ipaddress.ip_address(self.relay[0]).is_unspecified:
            raise ProbeError('invalid-relay')


def transfer(sender, receiver, timeout):
    payload = secrets.token_bytes(32)
    tx = secrets.token_bytes(12)
    wire = packet(SEND, tx, [(PEER, xor_address(receiver.relay, tx, encode=True)), (DATA, payload)])
    deadline = time.monotonic() + timeout
    while True:
        sender.send(wire, deadline)
        wait_until = min(deadline, time.monotonic() + 0.5)
        try:
            while True:
                kind, rx, fields, _ = receiver.receive(wait_until)
                if kind == INDICATION and fields.get(DATA) == payload and xor_address(fields.get(PEER, b''), rx) == sender.relay:
                    return
        except TimeoutError:
            Allocation.remaining(deadline)


def probe(primary, peer, protocol, timeout):
    stage = 'connect'
    try:
        with contextlib.ExitStack() as stack:
            a = stack.enter_context(Allocation(primary, protocol, timeout))
            stage = 'allocate'
            a.allocate()
            stage = 'peer-connect'
            b = stack.enter_context(Allocation(peer, protocol, timeout))
            stage = 'peer-allocate'
            b.allocate()
            if a.relay == b.relay:
                raise ProbeError('duplicate-relay')
            stage = 'permission'
            a.request(PERMISSION, peer=b.relay)
            b.request(PERMISSION, peer=a.relay)
            stage = 'forward'
            transfer(a, b, timeout)
            stage = 'reverse'
            transfer(b, a, timeout)
            return 'ok', 'bidirectional-relay'
    except TimeoutError:
        return stage, 'timeout'
    except OSError:
        return stage, 'network-error'
    except ProbeError as exc:
        return stage, str(exc)


def configuration(path):
    with Path(path).open('rb') as file:
        mode = os.fstat(file.fileno()).st_mode
        if not stat.S_ISREG(mode) or (os.name == 'posix' and mode & 0o077):
            raise ValueError
        content = file.read(8193)
    if len(content) > 8192:
        raise ValueError
    config = json.loads(content)
    if not isinstance(config, dict) or set(config) - {'target', 'peer'} or 'target' not in config:
        raise ValueError
    for endpoint in config.values():
        if not isinstance(endpoint, dict) or set(endpoint) != {'host', 'port', 'username', 'password'}:
            raise ValueError
        if type(endpoint['port']) is not int or not 1 <= endpoint['port'] <= 65535:
            raise ValueError
        for name, limit in [('host', 253), ('username', 509), ('password', 1024)]:
            value = endpoint[name]
            if not isinstance(value, str) or not 0 < len(value.encode()) <= limit or not all(32 < ord(c) < 127 for c in value):
                raise ValueError
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, help='path to the private JSON credential file')
    parser.add_argument('--transport', choices=('udp', 'tcp', 'both'), default='both')
    parser.add_argument('--timeout', type=int, choices=range(1, 11), default=3, help='stage timeout in seconds')
    args = parser.parse_args()
    try:
        config = configuration(args.config)
    except (OSError, ValueError):
        print('{"status":"error","stage":"config"}', file=sys.stderr)
        return 2
    status = 0
    for protocol in ('udp', 'tcp') if args.transport == 'both' else (args.transport,):
        started = time.monotonic()
        stage, detail = probe(config['target'], config.get('peer', config['target']), protocol, args.timeout)
        print(json.dumps({'status': 'ok' if stage == 'ok' else 'failed', 'transport': protocol,
                          'stage': stage, 'detail': detail, 'elapsed_ms': round((time.monotonic() - started) * 1000)}), flush=True)
        status |= int(stage != 'ok')
    return status


if __name__ == '__main__':
    sys.exit(main())
