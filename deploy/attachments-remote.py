"""Run a supplied administrator command using workspace SSH settings (never log secrets)."""
import os, sys
from pathlib import Path
import paramiko

root = Path(__file__).resolve().parents[2]
settings = {}
for line in (root / '.env').read_text(encoding='utf-8-sig').splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        settings[key.strip()] = value.strip().strip('"').strip("'")
client = paramiko.SSHClient()
client.load_system_host_keys()
# Persist first-use host key in an administrator-only local QA directory.
known = root / 'app' / 'deploy-qa' / 'ssh-known-hosts'
known.parent.mkdir(exist_ok=True)
if known.exists(): client.load_host_keys(str(known))
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    client.connect(settings['SSH_HOST'], port=int(settings.get('SSH_PORT', '22')), username=settings['SSH_USERNAME'], password=settings['SSH_PASSWORD'], timeout=20, look_for_keys=False, allow_agent=False)
    client.save_host_keys(str(known))
    if sys.argv[1] == 'put':
        with client.open_sftp() as sftp: sftp.put(sys.argv[2], sys.argv[3])
    else:
        command = Path(sys.argv[2]).read_text(encoding='utf-8-sig') if sys.argv[1] == 'script' else sys.argv[2]
        _, stdout, stderr = client.exec_command(command, timeout=900)
        for line in stdout: print(line, end='')
        errors = stderr.read().decode('utf-8', 'replace')
        if errors: print(errors, file=sys.stderr, end='')
        sys.exit(stdout.channel.recv_exit_status())
finally:
    client.close()
