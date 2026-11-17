#!/bin/sh
set -eu
systemctl stop sombra-hermes sombra
trap 'systemctl start sombra; systemctl start sombra-hermes' EXIT
python3 /root/sombra-attachments-stage/cleanup-live-hermes.py
systemctl start sombra
curl --retry 20 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:3847/health
systemctl start sombra-hermes
systemctl is-active sombra sombra-hermes roxy-hermes
