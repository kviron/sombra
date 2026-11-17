"""Full real Gateway startup/poll/native SQLite admission/worker/LLM/delivery QA.
No handler override, no direct AIAgent construction, no outer invocation/profile bind.
"""
import asyncio,base64,faulthandler,json,os,pathlib,re,sqlite3,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
assert os.getuid()==10001
assert 'CapEff:\t0000000000000000' in pathlib.Path('/proc/self/status').read_text()
faulthandler.dump_traceback_later(240,exit=True)
ROOT=pathlib.Path('/scope/home')
TOKEN='fake-shared-bot-token-not-real'
PROVIDER_KEY='qa-provider-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=')
calls=[];models=[];canonicals={};updates=[];acks={};lock=threading.Lock()
class Fake(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,result,mime='application/json'):
        raw=result if isinstance(result,bytes) else json.dumps(result).encode()
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        if self.path.endswith('/models'):self.reply({'data':[{'id':'qa-fake','object':'model'}]})
        else:self.send_response(404);self.end_headers()
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path=='/api/show':self.reply({'model_info':{'qa.context_length':262144}});return
        if self.path=='/api':
            assert self.headers['Authorization']=='Bearer '+TOKEN
            with lock:calls.append(data)
            op=data['op']
            if op=='bot_get_me':result={'bot':{'id':'bot','transportVersion':2},'toolPolicy':{'owner':'actor-a','users':['actor-b'],'revision':1}}
            elif op=='bot_authorize_update':result=canonicals[int(data['update_id'])]
            elif op=='bot_get_updates':
                after=int(data.get('after',0))
                with lock:result={'updates':[u for u in updates if u['update_id']>after and not acks[u['update_id']].is_set()]}
            elif op=='bot_attachment_file':result={'name':'one.png','mime':'image/png','data':base64.b64encode(PNG).decode()}
            elif op=='bot_reply':result={'id':'reply-'+str(data['update_id'])+'-'+data['response_key']}
            elif op=='bot_ack':acks[int(data['update_id'])].set();result={'ok':True}
            elif op in ('bot_typing','bot_edit','bot_delete','bot_react'):result={'ok':True}
            else:raise AssertionError('Unexpected fake backend operation '+op)
            self.reply({'data':result});return
        assert self.path=='/v1/chat/completions','Unexpected fake-provider endpoint '+self.path
        assert self.headers.get('Authorization')=='Bearer '+PROVIDER_KEY,'actual configured provider authorization was not selected'
        with lock:models.append(data)
        names={t['function']['name'] for t in data.get('tools',[])}
        matches=[]
        for index,message in enumerate(data.get('messages',[])):
            if message.get('role')=='user':
                for found in re.findall(r'FULL_CASE_(\d+)',str(message.get('content',''))):matches.append((index,int(found)))
        case=matches[-1][1] if matches else 0
        start=matches[-1][0] if matches else 0
        has_tool=any(m.get('role')=='tool' for m in data.get('messages',[])[start+1:])
        message={'role':'assistant','content':('FULL_FINAL_CASE_'+str(case)) if case and 'terminal' in names else 'QA_AUX_TITLE'}
        finish='stop'
        if case and 'terminal' in names and not has_tool:
            message={'role':'assistant','content':None,'tool_calls':[{'id':'full-tool-'+str(case),'type':'function','function':{'name':'terminal','arguments':json.dumps({'command':"printf 'QA_FULL_TOOL_"+str(case)+"' > /scope/workspace/full-proof-"+str(case)+".txt; printf 'QA_FULL_TOOL_"+str(case)+"'",'timeout':10})}}]};finish='tool_calls'
        response={'id':'chatcmpl-full-fixture','object':'chat.completion','created':int(time.time()),'model':'qa-fake','choices':[{'index':0,'message':message,'finish_reason':finish}],'usage':{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}}
        if data.get('stream'):
            delta=dict(message)
            for index,tool in enumerate(delta.get('tool_calls',[])):tool['index']=index
            chunk={'id':response['id'],'object':'chat.completion.chunk','created':response['created'],'model':'qa-fake','choices':[{'index':0,'delta':delta,'finish_reason':None}]}
            tail={**chunk,'choices':[{'index':0,'delta':{},'finish_reason':finish}],'usage':response['usage']}
            self.reply(('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(tail)+'\n\ndata: [DONE]\n\n').encode(),'text/event-stream')
        else:self.reply(response)

def queue_case(number,actor,kind,ask=False,attachment=False):
    channel='owner-dm' if kind=='direct' else 'shared-group'
    chat='direct-dialog' if kind=='direct' else 'group'
    text=('/ask@hermes ' if ask else '')+'FULL_CASE_'+str(number)+' run harmless QA proof'
    message={'id':'full-source-'+str(number),'text':text}
    if attachment:message['attachment']={'id':'one-png'}
    canonical={'update_id':number,'bot_id':'bot','channel':channel,'sender':{'id':actor},'chat':{'id':chat},'access':{'trusted':True,'policy_revision':1}}
    update={'update_id':number,'channel':channel,'sender':{'id':actor},'chat':{'id':chat,'kind':kind},'message':message}
    with lock:canonicals[number]=canonical;acks[number]=threading.Event();updates.append(update)

server=ThreadingHTTPServer(('127.0.0.1',18765),Fake);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
async def main():
    from hermes_cli.plugins import discover_plugins
    from gateway.config import Platform,load_gateway_config
    from gateway.run import GatewayRunner,_multiplex_profile_homes
    from gateway.run_bootstrap import (_start_gateway_reserve_profiles,
        _start_gateway_claim_pid_file,_start_gateway_start_control_socket)
    from gateway.run_runtime import (initialize_gateway_runtime,start_gateway_runtime_api,
        publish_gateway_runtime_ready,drain_gateway_runtime)
    from gateway.status import release_gateway_runtime_lock,remove_pid_file
    from gateway import session_envelope
    from agent.secret_scope import current_secret_scope
    discover_plugins()
    config=load_gateway_config();assert config.platforms[Platform('sombra')].enabled
    # The ordinary CLI owns this bootstrap OUTSIDE GatewayRunner.start(). Without it
    # start() alone silently uses the legacy in-process path and proves no native codec.
    homes=_multiplex_profile_homes(config)
    assert _start_gateway_reserve_profiles(homes)
    assert _start_gateway_claim_pid_file(force=False)
    config._runtime_profile_homes=tuple(homes)
    runner=GatewayRunner(config=config)
    control=None
    try:
        # Workers, authorities and adapters start before ANY fixture event/binding exists.
        assert current_secret_scope() is None
        await asyncio.wait_for(initialize_gateway_runtime(runner),35)
        assert runner.session_authority is not None
        from gateway.session_authorities import all_authorities
        assert len(all_authorities(runner))>=2,'named Sombra native authority was not initialized'
        control=await asyncio.wait_for(_start_gateway_start_control_socket(runner),20)
        assert control is not None and runner.session_control_server is control
        await asyncio.wait_for(start_gateway_runtime_api(runner),30)
        assert await asyncio.wait_for(runner.start(),75)
        publish_gateway_runtime_ready(runner)
        assert runner._running and Platform('sombra') in runner.adapters,'full Gateway.start did not become running'
        adapter=runner.adapters[Platform('sombra')]
        shared=__import__(adapter.__class__.__module__,fromlist=['INVOCATION'])
        assert shared.INVOCATION.get() is None
        assert adapter._message_handler.__module__.startswith('gateway.'),'actual wired handler was replaced by a fixture'
        assert 'platform_update_id' in session_envelope._EVENT_FIELDS
        print('FULL_REAL_GATEWAY_START_WORKERS_BEFORE_EVENT_NO_HANDLER_OVERRIDE_OK')
        cases=[(1,'actor-a','direct',False,False),(2,'actor-a','direct',True,False),
               (3,'actor-a','group',False,False),(4,'actor-a','group',True,False),
               (5,'actor-a','direct',False,True),(6,'actor-b','group',False,False)]
        for number,actor,kind,ask,attachment in cases:
            assert shared.INVOCATION.get() is None,'fixture leaked an outer invocation binding'
            queue_case(number,actor,kind,ask,attachment)
            ok=await asyncio.to_thread(acks[number].wait,65)
            with lock:outputs=[c for c in calls if c['op']=='bot_reply' and c['update_id']==number]
            assert ok,('full actual ingress failed before ACK',number,outputs)
            assert any('FULL_FINAL_CASE_'+str(number) in c.get('text','') for c in outputs),('not a genuine successful SDK turn final',number,outputs)
            assert not any('refused' in c.get('text','').lower() or 'invalid_params' in c.get('text','') for c in outputs)
            assert pathlib.Path('/scope/workspace/full-proof-'+str(number)+'.txt').read_text()=='QA_FULL_TOOL_'+str(number),('actual queued tool did not execute',number)
            with lock:
                reply_index=next(i for i,c in enumerate(calls) if c['op']=='bot_reply' and c['update_id']==number)
                ack_index=next(i for i,c in enumerate(calls) if c['op']=='bot_ack' and c['update_id']==number)
            assert reply_index<ack_index
            print('FULL_NATIVE_DURABLE_ACTUAL_AGENT_TERMINAL_FINAL_ACK_OK',number,actor,kind,'ask' if ask else 'plain','attachment' if attachment else 'text')
        admissions={}
        for database in ROOT.rglob('state.db'):
            with sqlite3.connect(database) as db:
                if not db.execute("SELECT 1 FROM sqlite_master WHERE name='session_admissions'").fetchone():continue
                for admission_id,target,payload,status,outcome in db.execute('SELECT admission_id,target_session_id,payload_json,status,outcome FROM session_admissions'):
                    native=json.loads(payload).get('native_text_v1',{})
                    value=native.get('event',{}).get('platform_update_id')
                    if str(value) not in {str(x[0]) for x in cases}:continue
                    assert status=='terminal',(value,status,outcome)
                    assert not native['event'].get('metadata'),('private metadata crossed codec',value)
                    assert native.get('provenance') and native['source']['platform']=='sombra'
                    assert native['source'].get('profile')=='sombra'
                    admissions[int(value)]=(target,native)
        assert set(admissions)=={1,2,3,4,5,6},('missing real durable native admissions',sorted(admissions))
        assert admissions[1][0]==admissions[2][0]==admissions[5][0],'same owner DM was not the same reused durable session'
        assert admissions[3][0]==admissions[4][0],'sequential group turns did not reuse durable session'
        assert admissions[3][0]!=admissions[6][0],'group actors merged into the same session'
        assert admissions[5][1].get('media'),'attachment was not captured by actual native codec'
        print('REAL_SQLITE_NATIVE_ENVELOPES_STANDARD_UPDATE_IDS_PROVENANCE_ATTACHMENT_AND_REUSED_WORKERS_OK',len(admissions))
        assert TOKEN not in json.dumps(models) and 'QA_ROOT_TELEGRAM_PERSONA_MUST_NOT_COPY' not in json.dumps(models)
        print(json.dumps({'pass':True,'actual_gateway_start':True,'native_durable_admissions':6,'same_actor_dm_sequential':True,'same_actor_group_sequential':True,'two_group_actors_separate':True,'actual_provider_http_calls':len(models),'real_inference_calls':0,'not_claimed':['real account authorization','real Telegram','production deployment','live filesystem confidentiality']}))
    finally:
        try:
            await asyncio.wait_for(drain_gateway_runtime(runner),15)
            await asyncio.wait_for(runner.stop(),55)
        finally:
            if control is not None:await asyncio.wait_for(control.stop(),15)
            remove_pid_file();release_gateway_runtime_lock()
try:asyncio.run(main())
finally:server.shutdown();server.server_close();thread.join();faulthandler.cancel_dump_traceback_later()
