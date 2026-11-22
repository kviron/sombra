"""Minimal live test: one temporary ordinary human, private bot DM, no group spam.
No provider tokens or reply bodies are printed; IDs are recorded for guarded cleanup.
"""
import http.cookiejar
import json
from pathlib import Path
import secrets
import time
import urllib.request
import uuid

URL = 'https://sombra.mi-nerva.ru/api'
RECORD = Path('/root/sombra-stage-0.1.17/platform-live-qa-2.json')
record = json.loads(RECORD.read_text()) if RECORD.exists() else {'prefix': 'sombra-platform-017-qa-' + uuid.uuid4().hex, 'user': None, 'dialogs': [], 'messages': [], 'checks': [], 'qa_password': secrets.token_urlsafe(32)}
if not record.get('qa_password'):
    raise SystemExit('QA credentials absent; do not modify any existing user')
cookies = http.cookiejar.CookieJar()
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def save():
    RECORD.write_text(json.dumps(record), encoding='utf-8')
    RECORD.chmod(0o600)


def api(op, **args):
    request = urllib.request.Request(URL, data=json.dumps({'op': op, **args}).encode(), headers={'Content-Type': 'application/json'})
    with client.open(request, timeout=30) as response:
        value = json.load(response)
    if value.get('error'):
        raise RuntimeError('API operation rejected: ' + op)
    return value['data']


def check(label):
    record['checks'].append(label)
    save()
    print('PASS ' + label, flush=True)


def request_and_wait(text, *, reaction=False):
    before = {m['id'] for m in api('state')['messages'] if m['channel'] == dialog}
    api('message', channel=dialog, text=text)
    state = api('state')
    original = next(m for m in reversed(state['messages']) if m['channel'] == dialog and m['user'] == uid and m['text'] == text)
    record['messages'].append(original['id'])
    save()
    deadline = time.monotonic() + 170
    while time.monotonic() < deadline:
        state = api('state')
        rows = [m for m in state['messages'] if m['channel'] == dialog]
        responses = [m for m in rows if m['user'] == bot_id and m['id'] not in before]
        source = next(m for m in rows if m['id'] == original['id'])
        if responses:
            record['messages'] = sorted(set(record['messages']) | {m['id'] for m in responses})
            save()
            combined = '\n'.join(m['text'] for m in responses)
            if 'Не удалось выполнить запрос' in combined:
                raise RuntimeError('Public callback returned its generic failure; inspect secret-safe operator diagnostics')
            if reaction:
                if any(r.get('user') == bot_id and r.get('emoji') == '👍' for r in source.get('reactions', [])):
                    assert combined.strip()
                    return combined
            elif record['prefix'] + '-OK' in combined:
                return combined
            # Wait briefly for a multi-part response/tool mutation rather than treating progress as final.
        time.sleep(2)
    raise RuntimeError('Live bot result did not satisfy the observable check; reply content withheld')


raw = json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
bot = next(b for b in raw['bots'] if b.get('username') == 'hermes' and b.get('enabled') is not False)
bot_id = bot['id']
record['bot'] = bot_id
assert bot['name'] == 'Сомбра'
save()  # Temporary QA-only credential stays root-private for bounded retries.
registered = api('login' if record['user'] else 'register', name='Sombra Platform QA 0.1.17', email=record['prefix'] + '@example.invalid', password=record['qa_password'])
uid = registered['user']['id']
record['user'] = uid
save()
assert uid != bot['owner'] and uid not in bot.get('tool_users', [])
dialog = api('create_dialog', members=[bot_id])['id']
record['dialogs'].append(dialog)
save()
check('Temporary ordinary-user private DM; no trusted-user grant or group messages')
request_and_wait('Для проверки доставки ответь ровно ' + record['prefix'] + '-OK')
check('Actual existing-gateway model reply and new private transport')
answer = request_and_wait('Сомбра, поставь реакцию 👍 именно на это моё сообщение и кратко назови своё имя. Для этой проверки обязательно вызови инструмент реакции.', reaction=True)
assert 'сомбра' in answer.lower()
check('Actual restricted source-only reaction tool and Sombra persona')
raw = json.loads(Path('/var/lib/sombra/mines-db.json').read_text())
updates = [u for u in raw.get('bot_updates', []) if u.get('sender', {}).get('id') == uid]
assert updates and all(u.get('done') is True for u in updates)
check('Both live updates acknowledged without duplicate source delivery')
api('logout')
record['finished'] = True
save()
print('LIVE_PLATFORM_PASS checks=' + str(len(record['checks'])), flush=True)
