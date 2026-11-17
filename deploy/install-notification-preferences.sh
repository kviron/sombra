#!/bin/sh
set -eu
umask 077
stage=/root/sombra-attachments-stage
backup=/root/sombra-backups/notifications-$(date -u +%Y%m%dT%H%M%SZ)
test -s "$stage/mines-server"
install -d -m 700 "$backup"
cp -p /usr/local/bin/sombra-server "$backup/sombra-server"
rollback(){
 result=$?
 if test "$result" -ne 0; then
  echo 'Notification deployment failed; restoring previous backend binary' >&2
  systemctl stop sombra
  install -m 755 "$backup/sombra-server" /usr/local/bin/sombra-server
  systemctl start sombra
 fi
 exit "$result"
}
systemctl stop sombra
trap rollback EXIT
tar -C /var/lib -czf "$backup/data.tar.gz" sombra
install -m 755 "$stage/mines-server" /usr/local/bin/sombra-server
systemctl start sombra
curl --retry 20 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:3847/health
curl -fsS https://sombra.mi-nerva.ru/health
python3 - <<'PY'
import json, urllib.request, urllib.error
for operation in ['set_notification_preferences','set_dialog_preferences']:
    request=urllib.request.Request('https://sombra.mi-nerva.ru/api',data=json.dumps({'op':operation,'direct':False,'dialog':'outside','muted':True}).encode(),headers={'Content-Type':'application/json'})
    try: urllib.request.urlopen(request,timeout=20)
    except urllib.error.HTTPError as error: assert error.code==401
    else: raise AssertionError('Preference mutation must require a human session')
    print('PASS unauthorized preference mutation denied: '+operation)
PY
systemctl is-active sombra sombra-hermes roxy-hermes
sha256sum /usr/local/bin/sombra-server
printf '\nBackup: %s\n' "$backup"
