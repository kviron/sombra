set -eu
cat /etc/nginx/sites-available/sombra.mi-nerva.ru
systemctl cat sombra
ls -lh /usr/local/bin/sombra-server
/usr/bin/python3 --version
systemctl is-active cron
