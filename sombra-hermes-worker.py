"""Durable Sombra bot connector for an existing Hermes install (Python stdlib).

No incoming listener/webhook, no provider keys in Sombra, no model tools.
SOMBRA_BOT_TOKEN must be provided by a protected service environment file.
"""
import json
import logging
import os
from pathlib import Path
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request

HELP='Я Hermes, ИИ-помощник Sombra.\n/ask вопрос — спросить ИИ\n/ai вопрос — то же самое\n/help — команды\n/start — знакомство\n/reset — очистить ваш контекст в этом чате\nВ группе используйте /ask@hermes вопрос или @hermes вопрос. В личных сообщениях можно писать обычным текстом. Я не вижу остальную переписку и не имею доступа к серверным инструментам.'

class BotAPIError(Exception):
    def __init__(self,status): self.status=status

class API:
    def __init__(self,url,token):
        from urllib.parse import urlsplit
        parsed=urlsplit(url)
        if parsed.scheme!='https' and not(parsed.scheme=='http' and parsed.hostname in ('127.0.0.1','localhost','::1')):
            raise ValueError('Bot API requires HTTPS (loopback HTTP allowed)')
        self.url,self.token=url,token
    def call(self,op,**fields):
        request=urllib.request.Request(self.url,data=json.dumps({'op':op,**fields}).encode(),headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=20) as response: result=json.load(response)
        except urllib.error.HTTPError as error: raise BotAPIError(error.code) from None
        if result.get('error'): raise BotAPIError(400)
        return result['data']

class Store:
    def __init__(self,path):
        self.connection=sqlite3.connect(path)
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('PRAGMA synchronous=FULL')
        self.connection.executescript('''CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY, scope TEXT NOT NULL, input TEXT NOT NULL, answer TEXT, committed INTEGER DEFAULT 0, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS context(id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, job INTEGER NOT NULL, created REAL NOT NULL, UNIQUE(job,role));''')
        self.connection.commit()
    def job(self,update):
        scope=str(update['channel'])+':'+str(update['sender']['id'])
        text=update['message'].get('text','')
        self.connection.execute('INSERT OR IGNORE INTO jobs(id,scope,input,created) VALUES(?,?,?,?)',(update['update_id'],scope,text,time.time()))
        self.connection.commit()
        return self.connection.execute('SELECT scope,input,answer,committed FROM jobs WHERE id=?',(update['update_id'],)).fetchone()
    def bind(self,bot_id):
        self.connection.execute('CREATE TABLE IF NOT EXISTS identity(id TEXT NOT NULL)')
        row=self.connection.execute('SELECT id FROM identity LIMIT 1').fetchone()
        if row and row[0]!=bot_id:raise RuntimeError('Worker database belongs to another bot')
        if not row:self.connection.execute('INSERT INTO identity(id) VALUES(?)',(bot_id,));self.connection.commit()
    def history(self,scope):
        rows=self.connection.execute('SELECT role,text FROM context WHERE scope=? ORDER BY id DESC LIMIT 12',(scope,)).fetchall()
        return [{'role':role,'content':text} for role,text in reversed(rows)]
    def answer(self,job,text):
        self.connection.execute('UPDATE jobs SET answer=? WHERE id=?',(text,job));self.connection.commit()
    def commit(self,job,scope,query,answer,reset=False,remember=True):
        with self.connection:
            if reset:self.connection.execute('DELETE FROM context WHERE scope=?',(scope,))
            if remember:
                now=time.time()
                self.connection.execute('INSERT OR IGNORE INTO context(scope,role,text,job,created) VALUES(?,?,?,?,?)',(scope,'user',query,job,now))
                self.connection.execute('INSERT OR IGNORE INTO context(scope,role,text,job,created) VALUES(?,?,?,?,?)',(scope,'assistant',answer,job,now))
                self.connection.execute('DELETE FROM context WHERE scope=? AND id NOT IN (SELECT id FROM context WHERE scope=? ORDER BY id DESC LIMIT 12)',(scope,scope))
            self.connection.execute('UPDATE jobs SET committed=1 WHERE id=?',(job,))
    def prune(self):
        before=time.time()-30*86400
        with self.connection:
            self.connection.execute('DELETE FROM context WHERE created<?',(before,))
            self.connection.execute('DELETE FROM jobs WHERE committed=1 AND created<?',(before,))

class Hermes:
    def __init__(self,launcher,turn_path):
        result=subprocess.run([launcher,'--print-runtime-command'],capture_output=True,text=True,check=True,timeout=30)
        command=json.loads(result.stdout)
        if len(command)!=4 or command[1:3]!=['-I','-c']: raise RuntimeError('Unsupported Hermes runtime launcher')
        root=os.environ.get('SOMBRA_HERMES_ROOT','/home/hermes/.hermes/hermes-agent')
        # Keep the runtime interpreter selected by Hermes; use its dependency bootstrap.
        bootstrap=f"import sys,runpy; sys.path.insert(0,{root!r}); sys._hermes_pin_default_home=True; import hermes_bootstrap; runpy.run_path({str(turn_path)!r},run_name='__main__')"
        self.command=[command[0],'-I','-c',bootstrap]
    def run(self,text,history,update,probe=False):
        payload={'text':text,'history':history,'chat_id':update['channel'],'chat_kind':update.get('chat',{}).get('kind','direct'),'probe':probe}
        result=subprocess.run(self.command,input=json.dumps(payload),capture_output=True,text=True,timeout=130,cwd='/var/lib/sombra-hermes')
        try: response=json.loads(result.stdout)
        except ValueError: raise RuntimeError('HermesProtocolError') from None
        if result.returncode or response.get('error'): raise RuntimeError('HermesTurnError')
        return response if probe else response['text']

class Worker:
    def __init__(self,api,store,hermes): self.api,self.store,self.hermes=api,store,hermes
    def process(self,update):
        job=update['update_id']
        scope,original,answer,committed=self.store.job(update)
        command=update.get('command') or {}
        name=command.get('name','')
        query=command.get('args','') if name in ('ask','ai') else original
        if not name and query.lstrip().startswith('@') and update.get('chat',{}).get('kind')=='group':
            query=query.lstrip().partition(' ')[2].strip()
        local=name in ('start','help','reset') or (name in ('ask','ai') and not query.strip())
        if answer is None:
            if name in ('start','help') or (name in ('ask','ai') and not query.strip()):answer=HELP
            elif name=='reset':answer='Ваш контекст в этом чате очищен. Можем начать заново.'
            elif not query.strip():answer='Пока я обрабатываю только текст. Напишите вопрос сообщением.';local=True
            else:
                for attempt in range(3):
                    try:
                        answer=self.hermes.run(query,self.store.history(scope),update)
                        break
                    except Exception:
                        logging.warning('Hermes turn retry update=%s attempt=%s',job,attempt+1)
                        if attempt<2:time.sleep(2**attempt)
                if answer is None:answer='Hermes временно недоступен. Попробуйте отправить запрос ещё раз позже.';local=True
            answer=answer.strip()[:2000]
            self.store.answer(job,answer)
        if not committed:
            # The server infers destination from the update. Repeating this request
            # after a crash/network loss returns the same stored message ID.
            try:self.api.call('bot_reply',update_id=job,response_key='main',text=answer)
            except BotAPIError as error:
                if error.status!=400:raise
                # A source user may have lost channel membership while Hermes ran.
                # Discard this reply, but acknowledge the stale request to avoid starvation.
                logging.warning('Discarded unavailable update=%s',job)
                local=True
            local=local or answer.startswith(('Hermes временно недоступен.','Пока я обрабатываю только текст.'))
            self.store.commit(job,scope,query,answer,reset=name=='reset',remember=not local)
        self.api.call('bot_ack',update_id=job)
        logging.info('Processed update=%s',job)

def main():
    logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    token=os.environ.get('SOMBRA_BOT_TOKEN')
    if not token:raise SystemExit('SOMBRA_BOT_TOKEN is required')
    root=Path(os.environ.get('SOMBRA_BOT_STATE','/var/lib/sombra-hermes'))
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    import fcntl
    lock=(root/'worker.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    store=Store(root/'worker.sqlite3')
    api=API(os.environ.get('SOMBRA_API','http://127.0.0.1:3847/api'),token)
    hermes=Hermes(os.environ.get('SOMBRA_HERMES_LAUNCHER','/home/hermes/.local/bin/hermes'),Path(__file__).with_name('hermes-turn.py'))
    identity=api.call('bot_get_me')
    if identity['bot'].get('legacy'):raise SystemExit('Use a new privacy-mode bot identity')
    store.bind(identity['user']['id'])
    probe=hermes.run('',[],{'channel':'probe'},probe=True)
    if probe.get('tools')!=0 or probe.get('memory') is not False:raise SystemExit('Unsafe Hermes configuration')
    logging.info('Sombra Hermes connector ready (tools=0, private-context isolation enabled)')
    worker=Worker(api,store,hermes)
    last_prune=0
    while True:
        try:
            batch=api.call('bot_get_updates',limit=20)
            for update in batch['updates']:worker.process(update)
            if time.time()-last_prune>3600:store.prune();last_prune=time.time()
        except BotAPIError as error:
            if error.status in (401,403):
                logging.error('Bot credentials revoked or access denied; stopping connector');return 1
            logging.warning('Sombra API retry status=%s',error.status)
        except Exception as error:
            logging.warning('Connector retry category=%s',type(error).__name__)
        time.sleep(2)

if __name__=='__main__':raise SystemExit(main())
