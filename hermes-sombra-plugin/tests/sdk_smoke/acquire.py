"""Read-only exact tracked source acquisition; credentials never printed."""
import hashlib,json,tarfile,urllib.request,subprocess
from pathlib import Path
PIN='bf0203a794a07aac3ff764972ab9087baa4e4f4e'
OUT=Path(__file__).resolve().parent
ROOT=OUT.parents[2]
archive=OUT/'hermes-pinned.tar'
try:
    url=f'https://codeload.github.com/NousResearch/hermes-agent/tar.gz/{PIN}'
    with urllib.request.urlopen(url,timeout=60) as r: data=r.read()
    (OUT/'hermes-public.tar.gz').write_bytes(data)
    with tarfile.open(OUT/'hermes-public.tar.gz','r:gz') as src, tarfile.open(archive,'w') as dst:
        for member in src.getmembers():
            member.name='/'.join(member.name.split('/')[1:])
            if member.name: dst.addfile(member,src.extractfile(member) if member.isfile() else None)
    with urllib.request.urlopen('https://api.github.com/repos/NousResearch/hermes-agent/git/ref/tags/v0.22.5',timeout=60) as r:
        tagref=json.load(r)
    (OUT/'tag.json').write_text(json.dumps(tagref,indent=2))
    target=tagref['object']
    if target['type']=='tag':
        with urllib.request.urlopen(target['url'],timeout=60) as r: tagobject=json.load(r)
        (OUT/'tag-target.json').write_text(json.dumps(tagobject,indent=2))
        target=tagobject['object']
    else:
        (OUT/'tag-target.json').write_text(json.dumps({'tag':'v0.22.5','object':target},indent=2))
    assert target['type']=='commit' and target['sha']==PIN,'public tag mismatch'
    (OUT/'public-tag-verification.json').write_text(json.dumps({'ref':tagref,'peeled_commit':target},indent=2))
    origin=url
except Exception as exc:
    import paramiko
    settings={}
    for line in (ROOT/'.env').read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key,value=line.split('=',1);settings[key.strip()]=value.strip().strip('"').strip("'")
    client=paramiko.SSHClient();client.load_system_host_keys()
    client.load_host_keys(str(ROOT/'app/deploy-qa/ssh-known-hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(settings['SSH_HOST'],port=int(settings.get('SSH_PORT','22')),username=settings['SSH_USERNAME'],password=settings['SSH_PASSWORD'],timeout=20,look_for_keys=False,allow_agent=False)
        base='/home/hermes/.hermes/hermes-agent'
        prefix=f'git -c safe.directory={base} -C {base}'
        _,o,e=client.exec_command(f'{prefix} rev-parse v0.22.5^{{commit}}',timeout=60)
        tag=o.read().decode().strip();assert o.channel.recv_exit_status()==0 and tag==PIN,'tag mismatch'
        (OUT/'tag-target.json').write_text(json.dumps({'tag':'v0.22.5','object':{'type':'commit','sha':tag},'verification':'read-only remote git rev-parse'},indent=2))
        _,o,e=client.exec_command(f'{prefix} archive --format=tar {PIN}',timeout=180)
        with archive.open('wb') as f:
            while True:
                chunk=o.read(1024*1024)
                if not chunk:break
                f.write(chunk)
        assert o.channel.recv_exit_status()==0,'remote archive failed'
        origin='read-only remote git archive exact commit; v0.22.5 verified'
    finally:client.close()
with tarfile.open(archive) as t:
    names=t.getnames()
    assert 'pyproject.toml' in names
    assert not any(n.startswith(('.git/','.venv/','.hermes/')) or n.startswith('/') or '..' in Path(n).parts for n in names)
    t.extractall(OUT/'source',filter='data')
report={'commit':PIN,'tag':'v0.22.5','origin':origin,'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'archive_bytes':archive.stat().st_size}
(OUT/'provenance.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
