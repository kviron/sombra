#!/bin/sh
set -eu
umask 077
stage=/root/sombra-attachments-stage
backup=/root/sombra-backups/attachments-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
chmod 700 "$backup"
test -s "$stage/mines-server"
test -s "$stage/cleanup-attachments.py"
test -s "$stage/sombra-attachments.cron"
cp -p /usr/local/bin/sombra-server "$backup/sombra-server"
cp -p /etc/nginx/sites-available/sombra.mi-nerva.ru "$backup/nginx.conf"
if test -e /etc/cron.d/sombra-attachments; then cp -p /etc/cron.d/sombra-attachments "$backup/cron"; fi
# Private complete backup while the single database writer is stopped.
systemctl stop sombra
rollback() {
    result=$?
    if test "$result" -ne 0; then
        echo 'Deployment failed; restoring previous binary and proxy configuration' >&2
        install -m 755 "$backup/sombra-server" /usr/local/bin/sombra-server
        cp -p "$backup/nginx.conf" /etc/nginx/sites-available/sombra.mi-nerva.ru
        if test -e "$backup/cron"; then cp -p "$backup/cron" /etc/cron.d/sombra-attachments; else rm -f /etc/cron.d/sombra-attachments; fi
        systemctl start sombra
        nginx -t && systemctl reload nginx
    fi
    exit "$result"
}
trap rollback EXIT
tar -C /var/lib -czf "$backup/data.tar.gz" sombra
install -m 755 "$stage/mines-server" /usr/local/bin/sombra-server
install -d -m 700 -o sombra -g sombra /var/lib/sombra/message-attachments
install -d -m 755 /usr/local/lib/sombra
install -m 644 "$stage/cleanup-attachments.py" /usr/local/lib/sombra/cleanup-attachments.py
python3 - <<'PY'
from pathlib import Path
path=Path('/etc/nginx/sites-available/sombra.mi-nerva.ru')
text=path.read_text()
if 'client_max_body_size 2m;' not in text and 'client_max_body_size 15m;' not in text:
    raise RuntimeError('Unexpected proxy configuration; refusing broad replacement')
path.write_text(text.replace('client_max_body_size 2m;', 'client_max_body_size 15m;'))
PY
nginx -t
systemctl start sombra
for attempt in 1 2 3 4 5; do
    if curl -fsS http://127.0.0.1:3847/health; then break; fi
    sleep 1
done
curl -fsS http://127.0.0.1:3847/health
systemctl reload nginx
# A dry-run verifies permissions and syntax; no existing attachment is removed now.
runuser -u sombra -- /usr/bin/python3 /usr/local/lib/sombra/cleanup-attachments.py --dry-run
install -m 644 "$stage/sombra-attachments.cron" /etc/cron.d/sombra-attachments
systemctl is-active cron
systemctl is-active sombra
printf '\nBackup: %s\n' "$backup"
sha256sum /usr/local/bin/sombra-server
cat /etc/cron.d/sombra-attachments
