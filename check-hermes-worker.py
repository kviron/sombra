import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('worker',Path(__file__).with_name('sombra-hermes-worker.py'))
worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)

class FakeAPI:
    def __init__(self):self.replies={};self.acks=[];self.fail_reply=False;self.fail_ack=False;self.revoked=False
    def call(self,op,**data):
        if op=='bot_reply':
            if self.fail_reply:self.fail_reply=False;raise worker.BotAPIError(500)
            if self.revoked:raise worker.BotAPIError(400)
            self.replies.setdefault(data['update_id'],data['text']);return {'id':str(data['update_id'])}
        if op=='bot_ack':
            if self.fail_ack:self.fail_ack=False;raise worker.BotAPIError(500)
            self.acks.append(data['update_id']);return {'ok':True}
        raise AssertionError(op)
class FakeHermes:
    def __init__(self):self.calls=[]
    def run(self,text,history,update):self.calls.append((text,history));return 'Ответ '+text

def update(number,text='/ask@hermes тест',channel='room',sender='human',command=None):
    item={'update_id':number,'channel':channel,'sender':{'id':sender},'message':{'text':text},'chat':{'kind':'group'}}
    if command is not None:item['command']=command
    else:item['command']={'name':'ask','args':text.split(' ',1)[-1]}
    return item

class Tests(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory();self.path=Path(self.folder.name)/'state.sqlite3'
        self.api=FakeAPI();self.hermes=FakeHermes();self.store=worker.Store(self.path);self.store.bind('bot')
        self.runworker=worker.Worker(self.api,self.store,self.hermes)
    def tearDown(self):self.store.connection.close();self.folder.cleanup()
    def test_cached_answer_survives_transport_failure_and_restart(self):
        self.api.fail_reply=True
        with self.assertRaises(worker.BotAPIError):self.runworker.process(update(1))
        self.store.connection.close();self.store=worker.Store(self.path);self.store.bind('bot')
        worker.Worker(self.api,self.store,self.hermes).process(update(1))
        self.assertEqual(len(self.hermes.calls),1);self.assertEqual(len(self.api.replies),1);self.assertEqual(self.api.acks,[1])
    def test_ack_failure_does_not_regenerate_or_duplicate(self):
        self.api.fail_ack=True
        with self.assertRaises(worker.BotAPIError):self.runworker.process(update(1))
        self.runworker.process(update(1))
        self.assertEqual(len(self.hermes.calls),1);self.assertEqual(len(self.api.replies),1)
        self.assertEqual(len(self.store.history('room:human')),2)
    def test_commands_reset_and_context_are_isolated(self):
        self.runworker.process(update(1))
        self.runworker.process(update(2,sender='other'))
        self.runworker.process(update(3,channel='dm'))
        self.assertEqual(self.hermes.calls[1][1],[]);self.assertEqual(self.hermes.calls[2][1],[])
        for n,name in [(4,'help'),(5,'start'),(6,'reset')]:self.runworker.process(update(n,command={'name':name,'args':''}))
        self.assertEqual(len(self.hermes.calls),3);self.assertEqual(self.store.history('room:human'),[])
    def test_source_removed_does_not_block_queue(self):
        self.api.revoked=True;self.runworker.process(update(1));self.assertEqual(self.api.acks,[1]);self.assertEqual(self.store.history('room:human'),[])
    def test_database_cannot_be_reused_for_another_bot(self):
        with self.assertRaises(RuntimeError):self.store.bind('other-bot')
    def test_https_enforced(self):
        with self.assertRaises(ValueError):worker.API('http://example.com/api','test')
        worker.API('https://example.com/api','test');worker.API('http://127.0.0.1:3847/api','test')
    def test_bounded_context(self):
        for i in range(1,20):self.runworker.process(update(i))
        self.assertEqual(len(self.store.history('room:human')),12)

if __name__=='__main__':unittest.main()
