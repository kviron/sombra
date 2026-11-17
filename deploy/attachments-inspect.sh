set -eu
uname -m
for tool in cargo rustc docker gcc cc curl cron crontab; do command -v "$tool" || true; done
systemctl show sombra -p User -p Group -p ExecStart -p WorkingDirectory -p ReadWritePaths
nginx -T 2>/dev/null | grep -E 'client_max_body_size|location /api|proxy_pass' || true
ls -ld /opt/sombra* /root/.cargo/bin/cargo 2>/dev/null || true
free -m
