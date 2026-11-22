set -eu
umask 077
mkdir -p /root/sombra-attachments-stage
chmod 700 /root/sombra-attachments-stage
du -sh /var/lib/sombra
if test -e /etc/cron.d/sombra-attachments; then cat /etc/cron.d/sombra-attachments; fi
