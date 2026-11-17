#!/bin/sh
set -eu
stage=/root/sombra-attachments-stage
root=/var/www/sombra-updates
version=0.1.13
artifact=Sombra_0.1.13_x64-setup.exe
expected=9591e0fc76e187a053a9eed0e043fef4df9116c7978332569d74256cf2acf865
test "$(sha256sum "$stage/$artifact" | cut -d ' ' -f 1)" = "$expected"
python3 - <<'PY'
import json
from pathlib import Path
stage=Path('/root/sombra-attachments-stage')
manifest=json.loads((stage/'latest-0.1.13.json').read_text())
assert manifest['version']=='0.1.13'
platform=manifest['platforms']['windows-x86_64']
assert platform['url']=='https://sombra.mi-nerva.ru/updates/0.1.13/Sombra_0.1.13_x64-setup.exe'
assert platform['signature']==(stage/'Sombra_0.1.13_x64-setup.exe.sig').read_text().strip()
PY
install -d -m 755 "$root/$version"
if test -e "$root/$version/$artifact"; then
 test "$(sha256sum "$root/$version/$artifact" | cut -d ' ' -f 1)" = "$expected"
fi
install -m 644 "$stage/$artifact" "$root/$version/$artifact"
install -m 644 "$stage/$artifact.sig" "$root/$version/$artifact.sig"
# Validate immutable HTTPS assets before changing stable channel.
python3 - <<'PY'
import hashlib, urllib.request
url='https://sombra.mi-nerva.ru/updates/0.1.13/Sombra_0.1.13_x64-setup.exe'
digest=hashlib.sha256()
with urllib.request.urlopen(url,timeout=90) as response:
    while chunk:=response.read(1024*1024): digest.update(chunk)
assert digest.hexdigest()=='9591e0fc76e187a053a9eed0e043fef4df9116c7978332569d74256cf2acf865'
print('PASS immutable HTTPS installer SHA-256')
PY
umask 077
backup=/root/sombra-backups/release-0.1.13-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
if test -f "$root/latest.json"; then cp -p "$root/latest.json" "$backup/latest.json"; fi
install -m 644 "$stage/latest-0.1.13.json" "$root/latest.json.tmp"
mv "$root/latest.json.tmp" "$root/latest.json"
python3 - <<'PY'
import json, urllib.request
from pathlib import Path
with urllib.request.urlopen('https://sombra.mi-nerva.ru/updates/latest.json',timeout=30) as response:
    remote=json.load(response)
assert remote==json.loads(Path('/root/sombra-attachments-stage/latest-0.1.13.json').read_text())
print('PASS stable HTTPS manifest version 0.1.13 matches signed local release')
PY
printf 'Previous manifest backup: %s\n' "$backup"
