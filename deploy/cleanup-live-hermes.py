"""Bounded cleanup of this release's temporary QA identity. Services must be stopped."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time

for service in ['sombra','sombra-hermes']:
    if subprocess.run(['systemctl','is-active','--quiet',service]).returncode==0:raise SystemExit('Stop both Sombra services before QA cleanup')
record_path=Path('/root/sombra-attachments-stage/hermes-live-qa.json')
record=json.loads(record_path.read_text())
path=Path('/var/lib/sombra/mines-db.json')
stat=path.stat();db=json.loads(path.read_text())
uid=record['user'];prefix=record['prefix']
assert isinstance(uid,str) and prefix.startswith('sombra-hermes-qa-')
user=next(u for u in db['users'] if u['id']==uid)
assert user['email']==prefix+'@example.invalid' and user['name']=='Sombra Hermes QA' and not user.get('bot')
assert all(g['owner']!=uid for g in db['groups'])
updates=[u for u in db.get('bot_updates',[]) if u.get('sender',{}).get('id')==uid]
message_ids=set(record['messages'])|{u['message']['id'] for u in updates}|{u['response']['id'] for u in updates if u.get('response')}
dialog_ids={d['id'] for d in db['dialogs'] if uid in d['members']}
assert all(set(d['members'])=={uid,record['bot']} for d in db['dialogs'] if d['id'] in dialog_ids)
for m in db['messages']:
    if m['id'] in message_ids:assert m['user'] in (uid,record['bot'])
# Only QA-authored requests and their correlated bot responses are removed.
before=len(db['messages'])
db['messages']=[m for m in db['messages'] if m['user']!=uid and m['id'] not in message_ids and m['channel'] not in dialog_ids]
db['bot_updates']=[u for u in db.get('bot_updates',[]) if u.get('sender',{}).get('id')!=uid]
db['dialogs']=[d for d in db['dialogs'] if d['id'] not in dialog_ids]
db['users']=[u for u in db['users'] if u['id']!=uid]
db['sessions']=[s for s in db.get('sessions',[]) if s['user_id']!=uid]
db['friends']=[f for f in db.get('friends',[]) if f.get('from')!=uid and f.get('to')!=uid]
for group in db['groups']:group['members']=[member for member in group['members'] if member!=uid]
# Bot cursor is per-bot monotonic; removing completed QA tombstones cannot rewind it.
backup=Path('/root/sombra-backups')/('hermes-qa-cleanup-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime()))
backup.mkdir(mode=0o700)
(backup/'mines-db.json').write_bytes(path.read_bytes());(backup/'mines-db.json').chmod(0o600)
tmp=path.with_suffix('.qa-cleanup.tmp')
with tmp.open('w') as file:
    json.dump(db,file,ensure_ascii=False,indent=2);file.flush();os.fsync(file.fileno())
os.chmod(tmp,stat.st_mode&0o777);os.chown(tmp,stat.st_uid,stat.st_gid);os.replace(tmp,path)
fd=os.open(str(path.parent),os.O_RDONLY);os.fsync(fd);os.close(fd)
worker=Path('/var/lib/sombra-hermes/worker.sqlite3')
if worker.exists():
    connection=sqlite3.connect(worker)
    with connection:
        connection.execute('DELETE FROM context WHERE substr(scope,-?)=?',(len(uid)+1,':'+uid))
        connection.execute('DELETE FROM jobs WHERE substr(scope,-?)=?',(len(uid)+1,':'+uid))
    connection.close()
record['cleanup']={'done':True,'removed_messages':before-len(db['messages']),'removed_dialogs':len(dialog_ids),'backup':str(backup)}
record_path.write_text(json.dumps(record,ensure_ascii=True));record_path.chmod(0o600)
print('PASS temporary QA account, test messages, dialog and isolated bot context removed')
