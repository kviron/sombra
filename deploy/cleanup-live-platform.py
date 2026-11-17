"""Remove only this release's two temporary QA identities. Stop Sombra API first.
The existing Telegram gateway need not stop; completed private QA scopes are archived.
"""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time

if subprocess.run(['systemctl', 'is-active', '--quiet', 'sombra']).returncode == 0:
    raise SystemExit('Stop Sombra API before editing its single-writer database')
paths = [Path('/root/sombra-stage-0.1.17/platform-live-qa.json'), Path('/root/sombra-stage-0.1.17/platform-live-qa-2.json')]
records = [(p, json.loads(p.read_text())) for p in paths if p.exists()]
records = [(p, r) for p, r in records if r.get('user') and not r.get('cleanup', {}).get('done')]
if not records:
    raise SystemExit('No recorded QA identities to remove')
path = Path('/var/lib/sombra/mines-db.json')
assert path.resolve() == path and not path.is_symlink()
original = path.read_bytes()
stat = path.stat()
db = json.loads(original)
users, dialogs, messages, scope_dirs = set(), set(), set(), []
for _, record in records:
    uid, prefix, bot = record['user'], record['prefix'], record['bot']
    assert isinstance(uid, str) and prefix.startswith('sombra-platform-017-qa-')
    user = next(u for u in db['users'] if u['id'] == uid)
    assert user['email'] == prefix + '@example.invalid' and user['name'] == 'Sombra Platform QA 0.1.17' and not user.get('bot')
    assert all(g['owner'] != uid for g in db['groups']) and all(b.get('owner') != uid for b in db['bots'])
    updates = [u for u in db.get('bot_updates', []) if u.get('sender', {}).get('id') == uid]
    assert all(u.get('done') is True for u in updates), 'Do not remove an in-flight source'
    owned_dialogs = [d for d in db['dialogs'] if uid in d['members']]
    assert all(set(d['members']) == {uid, bot} for d in owned_dialogs)
    for dialog in owned_dialogs:
        did = dialog['id']
        dialogs.add(did)
        assert all(m['user'] in {uid, bot} for m in db['messages'] if m['channel'] == did)
        value = {'server': 'https://sombra.mi-nerva.ru/api', 'bot': bot, 'actor': uid, 'channel': did}
        key = hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        scope = Path('/var/lib/sombra-hermes-platform/scopes') / key
        assert scope.resolve() == scope and not scope.is_symlink()
        if scope.exists():
            connection = sqlite3.connect((scope / 'journal.sqlite').as_uri() + '?mode=ro', uri=True)
            binding = json.loads(connection.execute('SELECT value FROM scope WHERE id=1').fetchone()[0])
            connection.close()
            assert binding['actor'] == uid and binding['channel'] == did and binding['bot'] == bot
            scope_dirs.append(scope)
    users.add(uid)
messages = {m['id'] for m in db['messages'] if m['user'] in users or m['channel'] in dialogs}
backup = Path('/root/sombra-backups') / ('platform-qa-cleanup-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))
assert backup.resolve() == backup and not backup.exists()
backup.mkdir(mode=0o700)
(backup / 'mines-db.json').write_bytes(original)
(backup / 'mines-db.json').chmod(0o600)
db['messages'] = [m for m in db['messages'] if m['id'] not in messages]
db['users'] = [u for u in db['users'] if u['id'] not in users]
db['dialogs'] = [d for d in db['dialogs'] if d['id'] not in dialogs]
db['bot_updates'] = [u for u in db.get('bot_updates', []) if u.get('sender', {}).get('id') not in users]
db['sessions'] = [s for s in db.get('sessions', []) if s['user_id'] not in users]
db['friends'] = [f for f in db.get('friends', []) if f.get('from') not in users and f.get('to') not in users]
for group in db['groups']:
    group['members'] = [uid for uid in group['members'] if uid not in users]
    roles = group.get('member_roles')
    if isinstance(roles, dict):
        for uid in users:
            roles.pop(uid, None)
for bot in db['bots']:
    if isinstance(bot.get('followups'), list):
        bot['followups'] = [f for f in bot['followups'] if f.get('sender') not in users]
read = db.get('read_state', {})
if isinstance(read.get('baselines'), dict):
    for uid in users:
        read['baselines'].pop(uid, None)
    for baseline in read['baselines'].values():
        for did in dialogs:
            baseline.get('channels', {}).pop(did, None)
if isinstance(read.get('viewers'), dict):
    for mid in messages:
        read['viewers'].pop(mid, None)
    for viewers in read['viewers'].values():
        for uid in users:
            viewers.pop(uid, None)
temporary = path.with_name('.platform-qa-cleanup.tmp')
assert temporary.resolve() == temporary and not temporary.exists()
with temporary.open('x', encoding='utf-8') as stream:
    json.dump(db, stream, ensure_ascii=False, indent=2)
    stream.flush()
    os.fsync(stream.fileno())
os.chmod(temporary, stat.st_mode & 0o777)
os.chown(temporary, stat.st_uid, stat.st_gid)
os.replace(temporary, path)
for scope in scope_dirs:
    target = backup / ('scope-' + scope.name)
    assert target.resolve() == target and not target.exists()
    scope.rename(target)  # Preserve private audit data, remove from active scope tree.
for record_path, record in records:
    record.pop('qa_password', None)
    record['cleanup'] = {'done': True, 'backup': str(backup)}
    record_path.write_text(json.dumps(record), encoding='utf-8')
    record_path.chmod(0o600)
print('PASS only recorded QA users, private dialogs/messages, sessions, receipts and active contexts removed; Telegram untouched')
