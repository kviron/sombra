"""Run on the production host. Creates one clearly marked temporary QA account.
Uses HTTPS, real bot worker/model, and records only QA IDs for bounded cleanup.
Never prints tokens, provider credentials, private chat contents or replies.
"""
import http.cookiejar
import json
import secrets
from pathlib import Path
import subprocess
import time
import urllib.request
import uuid

URL='https://sombra.mi-nerva.ru/api'
qa_file=Path('/root/sombra-attachments-stage/hermes-live-qa.json')
if qa_file.exists():raise SystemExit('Previous QA record exists; clean it before rerunning')
cookies=http.cookiejar.CookieJar()
client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))
record={'prefix':'sombra-hermes-qa-'+uuid.uuid4().hex,'user':None,'messages':[],'dialogs':[],'checks':[]}
def save():
    qa_file.write_text(json.dumps(record,ensure_ascii=True));qa_file.chmod(0o600)
def api(op,**fields):
    req=urllib.request.Request(URL,data=json.dumps({'op':op,**fields}).encode(),headers={'Content-Type':'application/json'})
    with client.open(req,timeout=30) as response: result=json.load(response)
    if result.get('error'):raise AssertionError('Sombra API operation failed: '+op)
    return result['data']
def message(channel,text):
    result=api('message',channel=channel,text=text)
    # message operation may return ok rather than the message itself.
    state=api('state')
    item=next(m for m in reversed(state['messages']) if m['channel']==channel and m['user']==record['user'] and m['text']==text)
    record['messages'].append(item['id']);save();return item

def response_to(original,marker):
    deadline=time.monotonic()+220
    while time.monotonic()<deadline:
        state=api('state')
        current=json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
        event=next((u for u in current.get('bot_updates',[]) if u.get('message',{}).get('id')==original['id']),{})
        response_id=event.get('response',{}).get('id')
        responses=[m for m in state['messages'] if m['id']==response_id and m['channel']==original['channel'] and m['user']==bot_id and marker in m.get('text','')]
        if responses:
            reply=responses[-1];record['messages'].append(reply['id']);save();return reply
        time.sleep(2)
    raise AssertionError('Timed out waiting for actual Hermes response')
def passed(name):
    record['checks'].append(name);save();print('PASS '+name,flush=True)

# Read metadata only; no human passwords or sessions are used.
database=json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
groups=[g for g in database['groups'] if g['name']=='Игровая']
assert len(groups)==1
group=groups[0]
bot=next(b for b in database['bots'] if b.get('username')=='hermes' and b.get('enabled') is not False)
bot_id=bot['id'];record['bot']=bot_id;record['group']=group['id']
assert bot_id in group['members'];assert bot['owner']==group['owner'];assert bot.get('legacy') is False
text_channel=next(c['id'] for c in group['channels'] if c['kind']=='text')
voice_channel=next(c['id'] for c in group['channels'] if c['kind']=='voice')
registered=api('register',name='Sombra Hermes QA',email=record['prefix']+'@example.invalid',password=secrets.token_urlsafe(30))
record['user']=registered['user']['id'];save()
api('join_group',invite=group['invite'])
state=api('state');identity=next(u for u in state['users'] if u['id']==bot_id)
assert identity['bot'] is True and identity['username']=='hermes'
assert all('token_hash' not in b for b in state['bots'])
passed('Hermes separate participant and public profile')

ordinary=[]
for channel in [text_channel,voice_channel]:ordinary.append(message(channel,record['prefix']+' ordinary privacy check'))
time.sleep(3)
db=json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
assert not any(u.get('message',{}).get('id') in {m['id'] for m in ordinary} for u in db.get('bot_updates',[]))
passed('Unaddressed text and voice-channel chat stay private')

# Verify pending requests survive connector downtime (not skipped at startup).
subprocess.run(['systemctl','stop','sombra-hermes'],check=True)
try:
    pending=message(text_channel,'/ask@hermes Ответь ровно '+record['prefix']+'-GROUP')
    db=json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
    assert any(u['message']['id']==pending['id'] and u.get('done') is not True for u in db['bot_updates'])
finally:subprocess.run(['systemctl','start','sombra-hermes'],check=True)
response_to(pending,record['prefix']+'-GROUP');passed('Actual group AI command and durable restart delivery')

spoken=message(voice_channel,'/ask@hermes Ответь ровно '+record['prefix']+'-VOICE')
response_to(spoken,record['prefix']+'-VOICE');passed('Actual AI command in voice-channel text chat')
mentioned=message(text_channel,'@hermes Ответь ровно '+record['prefix']+'-MENTION')
response_to(mentioned,record['prefix']+'-MENTION');passed('Actual group mention response')

dialog=api('create_dialog',members=[bot_id]);record['dialogs'].append(dialog['id']);save()
direct=message(dialog['id'],'Ответь ровно '+record['prefix']+'-DM')
response_to(direct,record['prefix']+'-DM');passed('Actual plain-text private message response')
help_message=message(dialog['id'],'/help')
response_to(help_message,'/ask');passed('Private /help command')
reset_message=message(dialog['id'],'/reset')
response_to(reset_message,'контекст');passed('Private /reset command')

# Completed requests/replies are persisted, with no duplicate response entries.
time.sleep(3)
db=json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
updates=[u for u in db['bot_updates'] if u.get('sender',{}).get('id')==record['user']]
assert updates and all(u.get('done') is True for u in updates)
assert len({u['response']['id'] for u in updates})==len(updates)
record['messages']=sorted(set(record['messages'])|{u['response']['id'] for u in updates})
save();passed('Acknowledged updates and unique persisted bot replies')
api('logout')
print('LIVE_HERMES_TESTS_PASS checks='+str(len(record['checks'])),flush=True)
