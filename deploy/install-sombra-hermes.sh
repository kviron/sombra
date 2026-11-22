#!/bin/sh
set -eu
stage=/root/sombra-attachments-stage
if test -e /etc/sombra-hermes/bot.env; then
 echo 'Existing bot credentials found; refusing automatic rotation.' >&2
 exit 1
fi
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=/root/sombra-backups/hermes-$stamp
install -d -m 700 "$backup"
systemctl stop sombra
failed=1
trap 'if test "$failed" = 1; then systemctl stop sombra; cp "$backup/sombra-server" /usr/local/bin/sombra-server; tar -C /var/lib -xzf "$backup/sombra-data.tar.gz"; if test -f /etc/sombra-hermes/bot.env; then rm -- /etc/sombra-hermes/bot.env; fi; systemctl start sombra; fi' EXIT
cp -p /usr/local/bin/sombra-server "$backup/sombra-server"
tar -C /var/lib -czf "$backup/sombra-data.tar.gz" sombra
install -m 755 "$stage/mines-server" /usr/local/bin/sombra-server
# Only the real database owner opens it. The maintenance operation creates the
# bot through backend validation, never by hand-editing data or reusing sessions.
sudo -u sombra env SOMBRA_OFFLINE_MAINTENANCE=1 MINES_DATA_DIR=/var/lib/sombra \
 /usr/local/bin/sombra-server --provision-group-bot 'Игровая' 'Hermes' 'hermes' /var/lib/sombra/.hermes-provision.env
install -d -m 750 -o root -g hermes /etc/sombra-hermes
install -m 640 -o root -g hermes /var/lib/sombra/.hermes-provision.env /etc/sombra-hermes/bot.env
# Fixed, verified temporary credential path; never retain a spare token in data.
test -f /var/lib/sombra/.hermes-provision.env
rm -- /var/lib/sombra/.hermes-provision.env
install -d -m 755 -o root -g root /opt/sombra-hermes
install -m 755 "$stage/sombra-hermes-worker.py" /opt/sombra-hermes/sombra-hermes-worker.py
install -m 644 "$stage/hermes-turn.py" /opt/sombra-hermes/hermes-turn.py
install -d -m 700 -o hermes -g hermes /var/lib/sombra-hermes
install -m 644 "$stage/sombra-hermes.service" /etc/systemd/system/sombra-hermes.service
systemctl daemon-reload
systemctl start sombra
curl --retry 20 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:3847/health
failed=0
systemctl enable --now sombra-hermes
sleep 3
systemctl is-active sombra sombra-hermes roxy-hermes
sha256sum /usr/local/bin/sombra-server
printf 'Backup: %s\n' "$backup"
