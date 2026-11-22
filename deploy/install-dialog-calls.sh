#!/bin/sh
set -eu
umask 077
stage=/root/sombra-attachments-stage
backup=/root/sombra-backups/dialog-calls-$(date -u +%Y%m%dT%H%M%SZ)
test -s "$stage/mines-server"
mkdir -p "$backup"
chmod 700 "$backup"
cp -p /usr/local/bin/sombra-server "$backup/sombra-server"
rollback(){
 result=$?
 if test "$result" -ne 0; then
  echo 'Call deployment failed; restoring previous binary' >&2
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
for attempt in 1 2 3 4 5; do
 if curl -fsS http://127.0.0.1:3847/health; then break; fi
 sleep 1
done
curl -fsS https://sombra.mi-nerva.ru/health
systemctl is-active sombra
sha256sum /usr/local/bin/sombra-server
printf '\nBackup: %s\n' "$backup"
