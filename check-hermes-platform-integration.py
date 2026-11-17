"""Independent Hermes exact-pin Docker QA launcher (no production or real inference).

Usage: python app/check-hermes-platform-integration.py --full-ingress --build --run
Use --shared-host instead for the separate public/authorization/provider-scope contract suite.
Omit both mode flags only to reproduce the earlier isolated-adapter fixture.
Acquire public exact source first with --acquire; artifacts stay under ignored deploy-qa.
Harness source is versioned in hermes-sombra-plugin/tests/sdk_smoke/.
Docker context is an explicit clean allowlist; never send repository/home/.env.
"""
from __future__ import annotations
import argparse, hashlib, json, pathlib, shutil, subprocess, sys, tarfile

ROOT = pathlib.Path(__file__).resolve().parent
QA = ROOT / 'deploy-qa/hermes-runtime-integration'
SOURCES = ROOT / 'hermes-sombra-plugin/tests/sdk_smoke'
PIN = 'bf0203a794a07aac3ff764972ab9087baa4e4f4e'
IMAGE = 'sombra-hermes-qa:integration-bf0203a'
LABEL = 'org.sombra.qa.goal=hermes-platform-integration'

def run(*args):
    # inherit handles: no captured subprocess pipes (Windows confinement-safe).
    subprocess.run(args, check=True)

def prepare(shared_host=False, full_ingress=False):
    provenance = json.loads((QA/'provenance.json').read_text())
    assert provenance['commit'] == PIN
    # Ref and annotated tag are retained independently of archive provenance.
    tag = json.loads((QA/'tag-target.json').read_text(encoding='utf-8-sig'))
    assert tag['tag'] == 'v0.22.5' and tag['object']['sha'] == PIN
    archive = QA/'hermes-pinned.tar'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == provenance['archive_sha256']
    context=QA/'context';context.mkdir(exist_ok=True)
    shutil.copyfile(archive,context/'hermes-clean.tar')
    shutil.copyfile(SOURCES/'Dockerfile',context/'Dockerfile')
    for name in ('smoke.py','entry.py'):
        prefix='full-' if full_ingress else ('shared-' if shared_host else '')
        shutil.copyfile(SOURCES/(prefix+name),context/name)
    with tarfile.open(context/'plugin.tar','w') as target:
        files=['plugin.yaml','__init__.py','adapter.py']
        if shared_host:files.extend(['shared_host.py','public_runner.py','native_tools.py','persona/SOUL.md'])
        for name in files:
            source=ROOT/'hermes-sombra-plugin'/name
            assert source.is_file()
            target.add(source,arcname=name,recursive=False)
    (context/'provenance.json').write_text(json.dumps(provenance,indent=2))
    (context/'.dockerignore').write_text('*\n!Dockerfile\n!hermes-clean.tar\n!plugin.tar\n!provenance.json\n!smoke.py\n!entry.py\n')
    return context

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--acquire',action='store_true',help='Acquire public pinned framework source into ignored QA artifacts')
    parser.add_argument('--build',action='store_true');parser.add_argument('--run',action='store_true')
    parser.add_argument('--shared-host',action='store_true',help='Test new same-process shared-host plugin, not a deployment runtime')
    parser.add_argument('--full-ingress',action='store_true',help='Run actual Gateway startup, native admission and durable trusted turns')
    parser.add_argument('--confirm-reset',action='store_true',help='Run separate default-on real nonce confirmation consumer regression')
    args=parser.parse_args()
    if args.acquire:
        QA.mkdir(parents=True,exist_ok=True)
        # Preserve the verified helper's __file__-relative artifact/credential-root semantics.
        shutil.copyfile(SOURCES/'acquire.py',QA/'acquire.py')
        run(sys.executable,str(QA/'acquire.py'))
    if args.build:
        full=args.full_ingress or args.confirm_reset
        context=prepare(args.shared_host or full,full)
        run('docker','build','--label',LABEL,'-t',IMAGE,str(context))
    if args.run:
        # Entire agent and fake HTTP service run inside network-none private container.
        # No mounts, host socket, credentials, real API or Telegram transport.
        run('docker','run','--rm','--name','sombra-hermes-qa-integration','--label',LABEL,
            '--network','none','--memory','512m','--cpus','1','--pids-limit','128',
            '--cap-drop','ALL','--cap-add','SETUID','--cap-add','SETGID','--cap-add','CHOWN',
            '--security-opt','no-new-privileges',*(['-e','QA_INTERACTIVE_CONFIRM=1'] if args.confirm_reset else []),IMAGE)
    if not args.acquire and not args.build and not args.run:parser.print_help()

if __name__=='__main__':main()
