"""Bounded pre-publication check of Git index; never prints matching secret values."""
import re
import subprocess
from pathlib import PurePosixPath

paths=subprocess.check_output(['git','diff','--cached','--name-only','--diff-filter=ACMR','-z']).decode().split('\0')
patterns=[re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),re.compile(rb'gh[pousr]_[A-Za-z0-9_]{30,}'),re.compile(rb'github_pat_[A-Za-z0-9_]{50,}')]
blocked=[]
for path in filter(None,paths):
    parts=PurePosixPath(path).parts
    if any(part in {'release-secrets','data','node_modules','target','dist','deploy-qa','auth-qa','voice-qa','social-qa','user-qa','ui-qa','attachments-qa','dialog-calls-qa'} for part in parts) or PurePosixPath(path).name in {'.env','FIRST-USER.txt','sombra.key'}:
        blocked.append(path+' (private path)'); continue
    content=subprocess.check_output(['git','show',':'+path])
    if any(pattern.search(content) for pattern in patterns): blocked.append(path+' (secret pattern)')
if blocked:
    print('\n'.join(blocked)); raise SystemExit(1)
print(f'PASS staged secret/path scan: {len(list(filter(None,paths)))} files; no matching private material')
