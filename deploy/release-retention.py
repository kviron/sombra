"""Keep five stable release versions. Dry-run by default; no database/backups touched."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse

VERSION = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\Z')
INSTALLER = re.compile(r'Sombra_(\d+\.\d+\.\d+)_x64-setup\.exe(?:\.sig)?\Z')
PUBLIC_MANIFEST = re.compile(r'latest\.before-(\d+\.\d+\.\d+)\.json\Z')
STAGED_MANIFEST = re.compile(r'latest-(\d+\.\d+\.\d+)\.json\Z')
ROOT = Path('/var/www/sombra-updates')
STAGE = Path('/root/sombra-attachments-stage')

def version(value):
    if not VERSION.fullmatch(value):
        raise ValueError('Invalid release version: '+value)
    return tuple(map(int, value.split('.')))

def checked_root(path):
    if path.is_symlink() or path.resolve() != path.absolute() or not path.is_dir():
        raise ValueError('Not a real, absolute release directory: '+str(path))
    return path.resolve()

def checked_child(path, root, directory=False):
    if path.is_symlink() or path.resolve() != root/path.name or path.parent != root:
        raise ValueError('Unsafe release path: '+str(path))
    if directory and not path.is_dir() or not directory and not path.is_file():
        raise ValueError('Unexpected release entry: '+str(path))
    return path

def plan(root=ROOT, stage=STAGE):
    root, stage = checked_root(root), checked_root(stage)
    manifest_path=checked_child(root/'latest.json', root)
    raw=manifest_path.read_bytes()
    manifest=json.loads(raw)
    current=manifest['version']
    stable=version(current)
    releases=[]
    for entry in root.iterdir():
        if VERSION.fullmatch(entry.name):
            checked_child(entry, root, directory=True)
            # A staged, not-yet-published newer directory must not evict a stable release.
            if version(entry.name)<=stable: releases.append(entry.name)
    releases.sort(key=version, reverse=True)
    keep=releases[:5]
    if current not in keep: raise ValueError('Current stable release is missing')
    for platform in manifest['platforms'].values():
        url=urlparse(platform['url'])
        parts=url.path.split('/')
        if url.scheme!='https' or url.hostname!='sombra.mi-nerva.ru' or len(parts)!=4 or parts[1]!='updates' or parts[2] not in keep:
            raise ValueError('Manifest target would not be retained')
        target=checked_child(root/parts[2]/parts[3], root/parts[2])
        checked_child(target.with_name(target.name+'.sig'), root/parts[2])
    remove=[]
    for name in releases[5:]:
        directory=checked_child(root/name, root, directory=True)
        allowed={f'Sombra_{name}_x64-setup.exe',f'Sombra_{name}_x64-setup.exe.sig','latest.json'}
        children=list(directory.iterdir())
        for child in children:
            if child.name not in allowed: raise ValueError('Unexpected content, refusing to delete: '+str(child))
            checked_child(child,directory)
        remove.append((directory,children))
    cutoff=version(keep[-1])
    loose=[]
    for directory, patterns in [(root,[PUBLIC_MANIFEST]),(stage,[INSTALLER,STAGED_MANIFEST])]:
        for path in directory.iterdir():
            for pattern in patterns:
                match=pattern.fullmatch(path.name)
                if match and version(match[1])<cutoff:
                    loose.append(checked_child(path,directory))
                    break
    return manifest_path,raw,keep,remove,loose

def run(apply=False):
    import fcntl
    with Path('/run/lock/sombra-release-retention.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        manifest,raw,keep,remove,loose=plan()
        paths=[child for _,children in remove for child in children]+loose
        print('KEEP:',', '.join(keep))
        for directory,_ in remove: print('REMOVE DIRECTORY:',directory)
        for path in loose: print('REMOVE FILE:',path)
        size=sum(path.stat().st_size for path in paths)
        if apply:
            # Entire deletion plan was validated before modifying any file.
            for directory,children in remove:
                if manifest.read_bytes()!=raw: raise RuntimeError('Stable manifest changed; stopping cleanup')
                checked_child(directory,ROOT,directory=True)
                for child in children: checked_child(child,directory).unlink()
                directory.rmdir()
            for path in loose:
                if manifest.read_bytes()!=raw: raise RuntimeError('Stable manifest changed; stopping cleanup')
                checked_child(path,path.parent).unlink()
            assert manifest.read_bytes()==raw
            _,_,remaining,old,old_loose=plan()
            assert remaining==keep and not old and not old_loose
        print(('REMOVED' if apply else 'WOULD REMOVE')+f': {size} bytes; {len(remove)} release directories')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    run(parser.parse_args().apply)
