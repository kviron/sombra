"""Apply the reviewed Sombra platform to the existing Hermes gateway.

Administrative deployment only; caller must stop the old Sombra worker/gateway,
create private backups, and own the installation. Never prints configuration or keys.
No dependency installation and no Telegram persona/context copying.
"""
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import sys
import tarfile
import tempfile

PIN = 'bf0203a794a07aac3ff764972ab9087baa4e4f4e'
HOME = Path('/home/hermes/.hermes')
STAGE = Path('/root/sombra-stage-0.1.17')
PLUGIN = HOME / 'plugins/sombra-platform'
PROFILE = HOME / 'profiles/sombra'
WORKSPACE = Path('/home/hermes/workspace-sombra')
STATE = Path('/var/lib/sombra-hermes-platform')
FILES = {'plugin.yaml', '__init__.py', 'adapter.py', 'shared_host.py', 'decorations.py', 'public_runner.py', 'native_tools.py', 'persona/SOUL.md'}


def checked(path):
    path = Path(path)
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError('Unexpected deployment path')
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError('Symlink in deployment path')
    return path


def atomic(path, content, owner, mode=0o600):
    checked(path)
    handle, temporary = tempfile.mkstemp(prefix='.sombra-', dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.chown(temporary, owner.pw_uid, owner.pw_gid)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def directory(path, owner, mode=0o700):
    checked(path)
    path.mkdir(parents=True, exist_ok=True)
    os.chmod(path, mode)
    os.chown(path, owner.pw_uid, owner.pw_gid)


def main():
    import yaml
    if os.geteuid() != 0 or len(sys.argv) != 2:
        raise ValueError('Administrative backup path required')
    backup = checked(Path(sys.argv[1]))
    if not backup.is_dir() or not str(backup).startswith('/root/sombra-backups/release-0.1.17-'):
        raise ValueError('Unexpected backup path')
    checked(STAGE)
    repo = HOME / 'hermes-agent'
    head = subprocess.check_output(['git', '-c', f'safe.directory={repo}', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    if head != PIN:
        raise ValueError('Hermes source revision changed; revalidation required')
    owner = pwd.getpwnam('hermes')
    config_path = checked(HOME / 'config.yaml')
    original = config_path.read_bytes()
    config = yaml.safe_load(original) or {}
    if not isinstance(config, dict):
        raise ValueError('Unsupported Hermes configuration')
    root_soul = HOME / 'SOUL.md'
    soul_hash = hashlib.sha256(root_soul.read_bytes()).hexdigest() if root_soul.is_file() else None
    if PROFILE.exists() or PLUGIN.exists():
        raise ValueError('Sombra profile/plugin already exists; do not overwrite automatically')
    with tarfile.open(STAGE / 'sombra-platform.tar', 'r') as archive:
        members = archive.getmembers()
        if {member.name for member in members} != FILES or any(not member.isfile() for member in members):
            raise ValueError('Unexpected plugin archive members')
        payloads = {member.name: archive.extractfile(member).read() for member in members}
    if any(len(data) > 512 * 1024 for data in payloads.values()):
        raise ValueError('Unexpected plugin source size')
    shutil.copy2(config_path, backup / 'hermes-config.yaml')
    # A new logical profile shares the installed code/auth fallback, never Telegram context.
    profile_config = {
        'model': {},
        'agent': {'max_turns': 20, 'run_budget_seconds': 180},
        'terminal': {'backend': 'local', 'cwd': str(WORKSPACE)},
        'plugins': {'enabled': ['sombra-platform']},
        'platforms': {'sombra': {'enabled': False}, 'telegram': {'enabled': False}},
    }
    model = config.get('model')
    if not isinstance(model, dict):
        raise ValueError('Unsupported existing model configuration')
    for key in ('default', 'provider', 'base_url', 'api_mode'):
        value = model.get(key)
        if isinstance(value, str):
            profile_config['model'][key] = value
    profile_config['model']['max_tokens'] = 4000
    for section in ('image_gen', 'video_gen'):
        selection = config.get(section)
        if isinstance(selection, dict) and isinstance(selection.get('provider'), str):
            profile_config[section] = {'provider': selection['provider']}
    if not profile_config['model'].get('default') or not profile_config['model'].get('provider'):
        raise ValueError('Missing existing provider/model selection')
    directory(PROFILE, owner)
    directory(WORKSPACE, owner)
    directory(WORKSPACE / 'artifacts', owner)
    directory(STATE, owner)
    # Explicit copies permit profile-local discovery without a second transport or install.
    for destination in (PLUGIN, PROFILE / 'plugins/sombra-platform'):
        directory(destination, owner, 0o755)
        for name, data in payloads.items():
            target = destination / name
            if not target.parent.exists():
                directory(target.parent, owner, 0o755)
            atomic(target, data, owner, 0o644)
    atomic(PROFILE / 'config.yaml', yaml.safe_dump(profile_config, allow_unicode=True, sort_keys=False).encode(), owner)
    atomic(PROFILE / 'SOUL.md', payloads['persona/SOUL.md'], owner)
    atomic(PROFILE / 'SOMBRA-INSTALL.json', json.dumps({'schema': 1, 'hermes_commit': PIN, 'release': '0.1.17'}).encode(), owner)
    enabled = config.setdefault('plugins', {}).setdefault('enabled', [])
    if not isinstance(enabled, list):
        raise ValueError('Unsupported enabled plugin list')
    if 'sombra-platform' not in enabled:
        enabled.append('sombra-platform')
    config.setdefault('platforms', {})['sombra'] = {'enabled': True}
    gateway = config.setdefault('gateway', {})
    gateway['multiplex_profiles'] = True
    routes = gateway.setdefault('profile_routes', [])
    if not isinstance(routes, list) or any(isinstance(route, dict) and route.get('name') == 'sombra-platform' for route in routes):
        raise ValueError('Unexpected existing Sombra route')
    # Match only Sombra before any unrelated broad route; all old routes stay unchanged.
    routes.insert(0, {'name': 'sombra-platform', 'platform': 'sombra', 'profile': 'sombra'})
    atomic(config_path, yaml.safe_dump(config, allow_unicode=True, sort_keys=False).encode(), owner)
    env = '\n'.join([
        'SOMBRA_MODE=shared_host',
        'SOMBRA_SHARED_HOST_ACK=I_ACCEPT_SHARED_HOST_FULL_TOOLS',
        'SOMBRA_ALLOWED_USERS=__sombra_canonical_backend_policy__',
        'SOMBRA_DM_POLICY=allowlist',
        'SOMBRA_GROUP_POLICY=allowlist',
        'SOMBRA_API_URL=https://sombra.mi-nerva.ru/api',
        'SOMBRA_TOKEN_FILE=/etc/sombra-hermes/bot.env',
        f'SOMBRA_STATE_DIR={STATE}',
        'SOMBRA_PROFILE=sombra',
        'SOMBRA_LEGACY_STATE_DIR=/var/lib/sombra-hermes',
        f'SOMBRA_SOUL_FILE={PROFILE}/SOUL.md',
        "SOMBRA_ARTIFACT_ROOTS='" + json.dumps([str(WORKSPACE / 'artifacts'), str(PROFILE / 'cache/images'), str(PROFILE / 'cache/audio'), str(PROFILE / 'cache/videos'), str(PROFILE / 'cache/generated')], separators=(',', ':')) + "'",
        '',
    ]).encode()
    # Private behavior configuration only: actual bot/provider secrets remain in original stores.
    atomic(Path('/etc/sombra-hermes/platform.env'), env, owner)
    dropin = Path('/etc/systemd/system/roxy-hermes.service.d')
    checked(dropin)
    dropin.mkdir(parents=True, exist_ok=True)
    target = dropin / 'sombra-platform.conf'
    if target.exists():
        raise ValueError('Refusing to overwrite an existing service override')
    target.write_text('[Service]\nEnvironmentFile=/etc/sombra-hermes/platform.env\nReadWritePaths=/var/lib/sombra-hermes-platform /var/lib/sombra-hermes/worker.lock\n', encoding='utf-8')
    os.chmod(target, 0o644)
    if root_soul.is_file() and hashlib.sha256(root_soul.read_bytes()).hexdigest() != soul_hash:
        raise ValueError('Default Telegram persona changed unexpectedly')
    (backup / 'platform-metadata.json').write_text(json.dumps({'hermes_commit': PIN, 'root_soul_sha256': soul_hash, 'release': '0.1.17'}), encoding='utf-8')
    print('Sombra platform/profile configured; existing Telegram persona preserved; no dependency installation')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Sombra platform configuration failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
