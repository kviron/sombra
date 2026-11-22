#!/bin/bash
set -euo pipefail
stage=/root/sombra-stage-0.1.17
backup=/root/sombra-backups/release-0.1.17-$(date -u +%Y%m%dT%H%M%SZ)
# Only the explicitly reviewed deployment targets; no wildcard deletion/pruning.
python3 - <<'PY'
from pathlib import Path
import hashlib,json,ast,tarfile,subprocess
stage=Path('/root/sombra-stage-0.1.17')
assert stage.resolve()==stage and not stage.is_symlink()
manifest=json.loads((stage/'stage-manifest.json').read_text())
assert manifest['release']=='0.1.17'
for name,key in [('mines-server','server_sha256'),('sombra-platform.tar','plugin_sha256')]:
 assert hashlib.sha256((stage/name).read_bytes()).hexdigest()==manifest[key]
for path in ['/home/hermes/.hermes/profiles/sombra','/home/hermes/.hermes/plugins/sombra-platform','/etc/systemd/system/roxy-hermes.service.d/sombra-platform.conf']:
 assert not Path(path).exists(), 'Refuse existing deployment target'
assert Path('/etc/sombra-hermes/bot.env').is_file()
# Read-only installed-source contract check. Full actual-SDK startup/authz is
# separately tested off-host: do not bootstrap a new PM data root on this VPS.
repo=Path('/home/hermes/.hermes/hermes-agent')
assert subprocess.check_output(['git','-c',f'safe.directory={repo}','-C',str(repo),'rev-parse','HEAD'],text=True).strip()=='bf0203a794a07aac3ff764972ab9087baa4e4f4e'
with tarfile.open(stage/'sombra-platform.tar') as archive:
 adapter=ast.parse(archive.extractfile('adapter.py').read())
 shared=ast.parse(archive.extractfile('shared_host.py').read())
register=next(n for n in adapter.body if isinstance(n,ast.FunctionDef) and n.name=='register')
call=next(n for n in ast.walk(register) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='register_platform')
keywords={k.arg:k.value for k in call.keywords}
assert ast.literal_eval(keywords['own_policy_env'])==('SOMBRA_DM_POLICY','SOMBRA_GROUP_POLICY')
assert 'allow_all_env' not in keywords
for tree,name in [(adapter,'SombraAdapter'),(shared,'SharedHostAdapter')]:
 cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name==name)
 connect=next(n for n in cls.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='connect')
 assert any(a.arg=='is_reconnect' for a in connect.args.kwonlyargs)
print('Pinned installed SDK revision and both startup consumer contracts verified without bootstrap/install')
PY
install -d -m 700 "$backup"
worker_enabled=$(systemctl is-enabled sombra-hermes.service 2>/dev/null || true)
cp -p /usr/local/bin/sombra-server "$backup/sombra-server"
cp -p /home/hermes/.hermes/config.yaml "$backup/hermes-config.yaml"
printf '%s\n' "$worker_enabled" > "$backup/old-worker-enabled"
failed=1
rollback() {
 code=$?
 if [ "$failed" = 1 ]; then
  echo 'Rollout failed; restoring binaries/configuration while preserving current message data.' >&2
  systemctl stop roxy-hermes sombra-hermes sombra || true
  install -m 755 "$backup/sombra-server" /usr/local/bin/sombra-server
  cp -p "$backup/hermes-config.yaml" /home/hermes/.hermes/config.yaml
  # Preserve the failed new profile privately instead of deleting possible new user data.
  python3 - "$backup" <<'PY'
from pathlib import Path
import sys
backup=Path(sys.argv[1]);assert backup.resolve()==backup and str(backup).startswith('/root/sombra-backups/release-0.1.17-')
profile=Path('/home/hermes/.hermes/profiles/sombra')
if profile.exists():
 assert profile.resolve()==profile and not profile.is_symlink()
 target=backup/'failed-sombra-profile';assert target.resolve()==target and not target.exists()
 profile.rename(target)
unit=Path('/etc/systemd/system/roxy-hermes.service.d/sombra-platform.conf')
if unit.exists():
 assert unit.resolve()==unit and not unit.is_symlink()
 unit.write_text('[Service]\n# Rolled back; original environment unchanged.\n')
PY
  systemctl daemon-reload
  systemctl start sombra roxy-hermes || true
  if [ "$worker_enabled" = enabled ]; then systemctl enable sombra-hermes >/dev/null 2>&1 || true; fi
  systemctl start sombra-hermes || true
  echo "Private rollback/backup: $backup" >&2
 fi
 exit "$code"
}
trap rollback EXIT
systemctl stop sombra-hermes roxy-hermes sombra
# This is a single-writer JSON database: backup and maintenance only while stopped.
tar -C /var/lib -czf "$backup/sombra-data.tar.gz" sombra
chmod 600 "$backup/sombra-data.tar.gz"
install -m 755 "$stage/mines-server" /usr/local/bin/sombra-server
install -m 600 -o sombra -g sombra "$stage/bot-settings.json" /var/lib/sombra/.release-0.1.17-bot-settings.json
sudo -u sombra env SOMBRA_OFFLINE_MAINTENANCE=1 MINES_DATA_DIR=/var/lib/sombra \
 /usr/local/bin/sombra-server --configure-bot hermes /var/lib/sombra/.release-0.1.17-bot-settings.json
python3 - <<'PY'
from pathlib import Path
p=Path('/var/lib/sombra/.release-0.1.17-bot-settings.json')
assert p.resolve()==p and not p.is_symlink()
p.unlink()
PY
python3 "$stage/install-hermes-platform.py" "$backup"
systemctl daemon-reload
systemctl start sombra
curl --retry 20 --retry-delay 1 --retry-connrefused --retry-all-errors -fsS http://127.0.0.1:3847/health
systemctl disable sombra-hermes >/dev/null
systemctl start roxy-hermes
# A live PID is not readiness: a malformed plugin can restart-loop while 'active'.
python3 - <<'PY'
from pathlib import Path
import json,time
end=time.monotonic()+75
while time.monotonic()<end:
 try:
  record=json.loads(Path('/home/hermes/.hermes/gateway_state.json').read_text())
  platforms=record.get('platforms') or {}
  if record.get('gateway_state')=='running' and all((platforms.get(name) or {}).get('state')=='connected' for name in ('telegram','sombra')):
   print('Both Telegram and Sombra transports connected')
   break
 except (OSError,ValueError,TypeError):
  pass
 time.sleep(1)
else:
 raise SystemExit('Gateway transport readiness failed; rollback required')
PY
systemctl is-active --quiet sombra roxy-hermes
failed=0
trap - EXIT
printf '\nDeployed backend and existing-gateway platform. Private backup: %s\n' "$backup"
sha256sum /usr/local/bin/sombra-server
