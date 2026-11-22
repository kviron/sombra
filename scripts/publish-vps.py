"""Публикация выпуска в зеркало на VPS.

    python scripts/publish-vps.py <версия>

Зеркалирует установщик и подпись из release/<версия>/ в /var/www/sombra-updates/<версия>/,
перепроверяет SHA-256 по HTTPS и атомарно заменяет latest.json (с резервной копией).
Доступ берётся из .env в корне проекта: SSH_HOST, SSH_USERNAME, SSH_PASSWORD.
"""

import hashlib
import json
import shlex
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_ROOT = 'https://sombra.mi-nerva.ru/updates'
REMOTE_ROOT = '/var/www/sombra-updates'


def credentials():
    values = {}
    for line in (ROOT / '.env').read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values['SSH_HOST'], values.get('SSH_USERNAME') or 'root', values['SSH_PASSWORD'], int(values.get('SSH_PORT') or 22)


def run(client, command, check=True):
    _, stdout, stderr = client.exec_command(command)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    status = stdout.channel.recv_exit_status()
    if check and status != 0:
        print(out)
        print(err, file=sys.stderr)
        raise SystemExit(f'команда на сервере не удалась ({status}): {command}')
    return out, err


def main():
    if len(sys.argv) < 2:
        raise SystemExit('usage: python scripts/publish-vps.py <версия>')
    version = sys.argv[1]
    artifact = f'Sombra_{version}_x64-setup.exe'
    folder = ROOT / 'release' / version
    installer = folder / artifact
    signature = folder / f'{artifact}.sig'
    manifest = folder / 'latest-vps.json'
    for path in (installer, signature, manifest):
        if not path.is_file() or path.stat().st_size == 0:
            raise SystemExit(f'нет файла: {path}')

    digest = hashlib.sha256(installer.read_bytes()).hexdigest()
    data = json.loads(manifest.read_text(encoding='utf-8'))
    assert data['version'] == version, data['version']
    url = data['platforms']['windows-x86_64']['url']
    assert url == f'{PUBLIC_ROOT}/{version}/{artifact}', url

    host, user, password, port = credentials()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=25, banner_timeout=25, auth_timeout=25)
    try:
        stage = f'/root/sombra-stage-{version}'
        run(client, f'install -d -m 700 {shlex.quote(stage)}')
        sftp = client.open_sftp()
        try:
            sftp.put(str(installer), f'{stage}/{artifact}')
            sftp.put(str(signature), f'{stage}/{artifact}.sig')
        finally:
            sftp.close()

        staged = repr(f'{stage}/{artifact}')
        out, _ = run(
            client,
            'python3 -c "import hashlib,pathlib; '
            f'print(hashlib.sha256(pathlib.Path({staged}).read_bytes()).hexdigest())"',
        )
        if out.strip() != digest:
            raise SystemExit(f'SHA-256 на сервере не совпал: {out.strip()} != {digest}')
        print('PASS копия на сервере, SHA-256', digest[:16] + '…')

        run(client, f'install -d -m 755 {REMOTE_ROOT}/{version}')
        run(client, f'install -m 644 {shlex.quote(stage)}/{artifact} {REMOTE_ROOT}/{version}/{artifact}')
        run(client, f'install -m 644 {shlex.quote(stage)}/{artifact}.sig {REMOTE_ROOT}/{version}/{artifact}.sig')

        check = (
            'import hashlib,urllib.request\n'
            f'url="{PUBLIC_ROOT}/{version}/{artifact}"\n'
            'h=hashlib.sha256()\n'
            'with urllib.request.urlopen(url,timeout=180) as r:\n'
            '    while chunk:=r.read(1024*1024): h.update(chunk)\n'
            f'assert h.hexdigest()=="{digest}", h.hexdigest()\n'
            'print("PASS HTTPS-копия установщика")\n'
        )
        out, _ = run(client, "python3 - <<'PY'\n" + check + 'PY')
        print(out.strip())

        backup, _ = run(
            client,
            'umask 077; b=/root/sombra-backups/release-manifest-$(date -u +%Y%m%dT%H%M%SZ); '
            f'mkdir -p "$b"; if test -f {REMOTE_ROOT}/latest.json; then cp -p {REMOTE_ROOT}/latest.json "$b/latest.json"; fi; echo "$b"',
        )
        sftp = client.open_sftp()
        try:
            sftp.put(str(manifest), f'{REMOTE_ROOT}/latest.json.tmp')
        finally:
            sftp.close()
        run(
            client,
            "python3 -c \"import os; os.replace('"
            f'{REMOTE_ROOT}/latest.json.tmp'
            "','"
            f'{REMOTE_ROOT}/latest.json'
            "')\"",
        )

        verify = (
            'import json,urllib.request\n'
            f'with urllib.request.urlopen("{PUBLIC_ROOT}/latest.json",timeout=30) as r: remote=json.load(r)\n'
            f'assert remote["version"]=="{version}", remote["version"]\n'
            f'assert remote["platforms"]["windows-x86_64"]["url"]=="{url}", remote["platforms"]["windows-x86_64"]["url"]\n'
            'print("PASS публичный манифест", remote["version"])\n'
        )
        out, _ = run(client, "python3 - <<'PY'\n" + verify + 'PY')
        print(out.strip())
        print('предыдущий манифест:', backup.strip())
    finally:
        client.close()


if __name__ == '__main__':
    main()
