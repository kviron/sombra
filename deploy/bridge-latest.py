"""Мост обновлений для клиентов Sombra <= 0.1.25.

Старые версии читают манифест только с VPS. Скрипт берёт latest.json из GitHub
Release и атомарно кладёт его в /var/www/sombra-updates/, чтобы те клиенты тоже
увидели новую версию. Новые версии ходят в GitHub напрямую и мост не используют.

    python deploy/bridge-latest.py v0.1.26
"""
import json
import sys
import urllib.request
from pathlib import Path

import paramiko

REPO = 'kviron/sombra'
PUBLIC = 'https://sombra.mi-nerva.ru/updates/latest.json'
REMOTE = '/var/www/sombra-updates/latest.json'


def settings():
    values = {}
    for line in (Path(__file__).resolve().parents[1] / '.env').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: python deploy/bridge-latest.py v<версия>')
    tag = sys.argv[1]
    raw = urllib.request.urlopen(f'https://github.com/{REPO}/releases/download/{tag}/latest.json', timeout=60).read()
    manifest = json.loads(raw)
    version = manifest['version']
    platform = manifest['platforms']['windows-x86_64']
    assert version == tag.lstrip('v'), f'манифест {version} не совпадает с тегом {tag}'
    assert platform['url'].startswith(f'https://github.com/{REPO}/releases/download/{tag}/'), platform['url']
    # Tauri пишет .sig как base64 от minisign-подписи; в манифесте должна лежать ровно эта строка.
    import base64
    signature = platform['signature']
    decoded = signature if signature.startswith('untrusted comment:') else base64.b64decode(signature).decode('utf-8')
    assert decoded.startswith('untrusted comment:'), 'подпись не minisign'

    config = settings()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(config['SSH_HOST'], port=int(config.get('SSH_PORT', '22')),
                   username=config['SSH_USERNAME'], password=config['SSH_PASSWORD'],
                   timeout=20, look_for_keys=False, allow_agent=False)
    try:
        with client.open_sftp() as sftp:
            with sftp.open(REMOTE + '.tmp', 'wb') as handle:
                handle.write(raw)
        _, stdout, _ = client.exec_command(f'chmod 644 {REMOTE}.tmp && mv -f {REMOTE}.tmp {REMOTE} && ls -l {REMOTE}')
        print(stdout.read().decode().strip())
    finally:
        client.close()

    served = json.loads(urllib.request.urlopen(PUBLIC, timeout=30).read())
    assert served == manifest, 'VPS отдаёт не тот манифест'
    print(f'PASS {version} -> {PUBLIC}')
    print(f'     установщик: {platform["url"]}')


if __name__ == '__main__':
    main()
