#!/bin/sh
set -eu
stage=/root/sombra-stage-0.1.17
root=/var/www/sombra-updates
version=0.1.17
artifact=Sombra_0.1.17_x64-setup.exe
expected=a2dfce6c70ab0b6b02de15ce50a799bf8b4fac9c4d73b2f6860ab89b64e038f4
python3 - <<'PY'
from pathlib import Path
import hashlib,json
stage=Path('/root/sombra-stage-0.1.17');root=Path('/var/www/sombra-updates')
assert root.resolve()==root and not root.is_symlink()
artifact=stage/'Sombra_0.1.17_x64-setup.exe'
assert hashlib.sha256(artifact.read_bytes()).hexdigest()=='a2dfce6c70ab0b6b02de15ce50a799bf8b4fac9c4d73b2f6860ab89b64e038f4'
manifest=json.loads((stage/'latest.json').read_text());assert manifest['version']=='0.1.17'
p=manifest['platforms']['windows-x86_64'];assert p['url']=='https://sombra.mi-nerva.ru/updates/0.1.17/Sombra_0.1.17_x64-setup.exe'
assert p['signature']==(stage/'Sombra_0.1.17_x64-setup.exe.sig').read_text().strip()
folder=root/'0.1.17';assert folder.resolve()==folder and not folder.is_symlink()
if (folder/artifact.name).exists():assert hashlib.sha256((folder/artifact.name).read_bytes()).hexdigest()==hashlib.sha256(artifact.read_bytes()).hexdigest()
PY
install -d -m 755 "$root/$version"
install -m 644 "$stage/$artifact" "$root/$version/$artifact"
install -m 644 "$stage/$artifact.sig" "$root/$version/$artifact.sig"
python3 - <<'PY'
import hashlib,urllib.request
h=hashlib.sha256()
with urllib.request.urlopen('https://sombra.mi-nerva.ru/updates/0.1.17/Sombra_0.1.17_x64-setup.exe',timeout=90) as response:
 while chunk:=response.read(1024*1024):h.update(chunk)
assert h.hexdigest()=='a2dfce6c70ab0b6b02de15ce50a799bf8b4fac9c4d73b2f6860ab89b64e038f4'
print('PASS immutable HTTPS installer SHA-256')
PY
umask 077
backup=/root/sombra-backups/release-0.1.17-manifest-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
if test -f "$root/latest.json"; then cp -p "$root/latest.json" "$backup/latest.json"; fi
install -m 644 "$stage/latest.json" "$root/latest.json.tmp"
python3 - <<'PY'
from pathlib import Path
import os
source=Path('/var/www/sombra-updates/latest.json.tmp');target=Path('/var/www/sombra-updates/latest.json')
assert source.resolve()==source and not source.is_symlink()
assert target.resolve()==target and not target.is_symlink()
os.replace(source,target)
PY
python3 - <<'PY'
from pathlib import Path
import json,urllib.request
with urllib.request.urlopen('https://sombra.mi-nerva.ru/updates/latest.json',timeout=30) as response:remote=json.load(response)
assert remote==json.loads(Path('/root/sombra-stage-0.1.17/latest.json').read_text())
print('PASS stable HTTPS manifest exactly matches signed 0.1.17')
PY
printf 'Previous manifest backup: %s\n' "$backup"
python3 /usr/local/lib/sombra-release-retention.py --apply
