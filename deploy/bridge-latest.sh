#!/bin/sh
# Мост обновлений для клиентов <= 0.1.25: они читают только manifest на VPS.
# Новые версии берут latest.json прямо из GitHub Releases, но старые без моста
# не увидят ни одного обновления.
#
#   ssh root@sombra.mi-nerva.ru 'sh -s v0.1.26' < deploy/bridge-latest.sh
set -eu
tag=${1:?usage: bridge-latest.sh v<версия>}
root=/var/www/sombra-updates
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL "https://github.com/kviron/sombra/releases/download/$tag/latest.json" -o "$tmp"
python3 - "$tmp" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1], encoding='utf-8'))
platform = manifest['platforms']['windows-x86_64']
assert platform['url'].startswith('https://github.com/kviron/sombra/releases/download/'), platform['url']
assert platform['signature'].startswith('untrusted comment:'), 'подпись не minisign'
print('bridge', manifest['version'], platform['url'])
PY
install -m 644 "$tmp" "$root/latest.json.tmp"
mv -f "$root/latest.json.tmp" "$root/latest.json"
curl -fsSL https://sombra.mi-nerva.ru/updates/latest.json | python3 -c "import json,sys; m=json.load(sys.stdin); print('served', m['version'])"
