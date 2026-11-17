"""Non-generating deployment health/security checks; output contains no credentials."""
import hashlib
import json
from pathlib import Path
import subprocess
import time
import urllib.request

path=Path('/etc/sombra-hermes/bot.env')
assert path.stat().st_mode&0o777==0o640
settings=dict(line.split('=',1) for line in path.read_text().splitlines() if '=' in line)
token=settings['SOMBRA_BOT_TOKEN']
request=urllib.request.Request('http://127.0.0.1:3847/api',data=b'{"op":"bot_get_me"}',headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
with urllib.request.urlopen(request,timeout=15) as response:identity=json.load(response)['data']
assert identity['user']['bot'] and identity['user']['online']
assert identity['user']['username']=='hermes' and identity['bot']['privacy']=='commands_only'
db=json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
bot=next(b for b in db['bots'] if b['id']==identity['user']['id'])
group=next(g for g in db['groups'] if g['name']=='Игровая')
assert bot['id'] in group['members'] and group['id'] in bot['groups']
assert all(token not in json.dumps(value) for value in [db,identity])
record=json.loads(Path('/root/sombra-attachments-stage/hermes-live-qa.json').read_text())
assert record['cleanup']['done']
assert all(u['id']!=record['user'] for u in db['users'])
assert all(u.get('sender',{}).get('id')!=record['user'] for u in db['bot_updates'])
assert all(m['id'] not in record['messages'] for m in db['messages'])
for service in ['sombra','sombra-hermes','roxy-hermes']:
    assert subprocess.run(['systemctl','is-active','--quiet',service]).returncode==0
print('PASS bot installed, online, privacy-scoped, secret not exposed, QA cleaned, Sombra/Hermes/Telegram active')
