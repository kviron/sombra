"""Invoke GitHub CLI using the existing Git credential helper, without storing tokens."""
import os
import subprocess
import sys

environment=os.environ.copy()
if not environment.get('GH_TOKEN'):
    result=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=False)
    if result.returncode:
        raise SystemExit('GitHub credentials unavailable; configure Git Credential Manager first.')
    fields=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    token=fields.get('password')
    if not token: raise SystemExit('Git credential helper returned no GitHub token.')
    environment['GH_TOKEN']=token
    result=None
    fields.clear()
    token=None
try:
    raise SystemExit(subprocess.run(['gh',*sys.argv[1:]],env=environment,check=False).returncode)
finally:
    environment.pop('GH_TOKEN',None)
