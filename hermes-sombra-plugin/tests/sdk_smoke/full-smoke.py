"""Full real Gateway startup/poll/native SQLite admission/worker/LLM/delivery QA.
No handler override, no direct AIAgent construction, no outer invocation/profile bind.
"""
import asyncio,base64,faulthandler,hashlib,json,os,pathlib,re,sqlite3,sys,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
assert os.getuid()==10001
assert 'CapEff:\t0000000000000000' in pathlib.Path('/proc/self/status').read_text()
faulthandler.dump_traceback_later(240,exit=True)
ROOT=pathlib.Path('/scope/home')
TOKEN='fake-shared-bot-token-not-real'
PROVIDER_KEY='qa-provider-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=')
calls=[];models=[];canonicals={};updates=[];acks={};producer_calls=[];producer_routes={};fixture_errors=[];system_context_cases=set();expected_platform_context='';lock=threading.Lock()
PRODUCED=ROOT/'profiles/sombra/cache/images/qa-produced-7.png'
FORGED=pathlib.Path('/scope/workspace/forged-private.png')
TELEGRAM_IMAGE=ROOT/'cache/images/telegram-private.png'
class Fake(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def reply(self,result,mime='application/json',status=200):
        raw=result if isinstance(result,bytes) else json.dumps(result).encode()
        self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
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
        if case and names:
            system='\n'.join(str(m.get('content','')) for m in data['messages'] if m.get('role') in ('system','developer'))
            if not expected_platform_context or expected_platform_context not in system:
                with lock:fixture_errors.append(('actual SYSTEM missing immutable Sombra platform context',case))
                self.reply({'error':{'message':'QA SYSTEM platform-context assertion failed','type':'invalid_request_error','code':'qa_system_context'}},status=400)
                return
            with lock:system_context_cases.add(case)
        has_tool=any(m.get('role')=='tool' for m in data.get('messages',[])[start+1:])
        message={'role':'assistant','content':('FULL_FINAL_CASE_'+str(case)) if case and 'terminal' in names else 'QA_AUX_TITLE'}
        finish='stop'
        if case in (7,8,9) and names:
            link=PRODUCED if case==7 else (FORGED if case==8 else TELEGRAM_IMAGE)
            message={'role':'assistant','content':'FULL_FINAL_CASE_'+str(case)+' [Image]('+link.as_uri()+')'+(' [Earlier image]('+PRODUCED.as_uri()+')' if case==8 else '')}
            if case in (7,9) and not has_tool:
                tool_args={'prompt':'QA_IMAGE_CASE_'+str(case)}
                if 'tool_call' in names:
                    function={'name':'tool_call','arguments':json.dumps({'calls':[{'name':'image_generate','arguments':tool_args}]})}
                elif 'image_generate' in names:
                    function={'name':'image_generate','arguments':json.dumps(tool_args)}
                else:
                    with lock:fixture_errors.append(('native image/bridge schema missing',sorted(names)))
                    self.reply({'error':{'message':'QA fixture expected native image or supported bridge schema','type':'invalid_request_error','code':'qa_fixture_schema'}},status=400)
                    return
                with lock:producer_routes[case]=function['name']
                message={'role':'assistant','content':None,'tool_calls':[{'id':'full-image-'+str(case),'type':'function','function':function}]};finish='tool_calls'
        elif case and 'terminal' in names and not has_tool:
            message={'role':'assistant','content':None,'tool_calls':[{'id':'full-tool-'+str(case),'type':'function','function':{'name':'terminal','arguments':json.dumps({'command':"printf 'QA_FULL_TOOL_"+str(case)+"' > /scope/workspace/full-proof-"+str(case)+".txt; printf 'QA_FULL_TOOL_"+str(case)+"'",'timeout':10})}}]};finish='tool_calls'
        response={'id':'chatcmpl-full-fixture','object':'chat.completion','created':int(time.time()),'model':'qa-fake','choices':[{'index':0,'message':message,'finish_reason':finish}],'usage':{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}}
        if data.get('stream'):
            delta=dict(message)
            for index,tool in enumerate(delta.get('tool_calls',[])):tool['index']=index
            chunk={'id':response['id'],'object':'chat.completion.chunk','created':response['created'],'model':'qa-fake','choices':[{'index':0,'delta':delta,'finish_reason':None}]}
            tail={**chunk,'choices':[{'index':0,'delta':{},'finish_reason':finish}],'usage':response['usage']}
            self.reply(('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(tail)+'\n\ndata: [DONE]\n\n').encode(),'text/event-stream')
        else:self.reply(response)

def queue_case(number,actor,kind,ask=False,attachment=False,control_text=None):
    channel='owner-dm' if kind=='direct' else ('first-image-group' if number in (7,8,9) else 'shared-group')
    chat='direct-dialog' if kind=='direct' else 'group'
    text='/reset@hermes' if number==10 else ('/ask@hermes ' if ask else '')+'FULL_CASE_'+str(number)+' run harmless QA proof'
    if control_text is not None:text=control_text
    message={'id':'full-source-'+str(number),'text':text}
    if attachment:message['attachment']={'id':'one-png'}
    canonical={'update_id':number,'bot_id':'bot','channel':channel,'sender':{'id':actor},'chat':{'id':chat,'kind':kind},'access':{'trusted':True,'policy_revision':1}}
    update={'update_id':number,'channel':channel,'sender':{'id':actor},'chat':{'id':chat,'kind':kind},'message':message}
    with lock:canonicals[number]=canonical;acks[number]=threading.Event();updates.append(update)

async def run_real_confirmation(runner,adapter,shared):
    """Observe, never replace, the actual SDK reset callback reached through nonce polling."""
    from hermes_constants import get_hermes_home
    from agent.secret_scope import current_secret_scope_home,current_secret_scope
    from tools import slash_confirm
    metadata=[];seen_frames=set();code=runner._handle_reset_command.__func__.__code__
    def trace(frame,event,arg):
        if event=='call' and frame.f_code is code and id(frame) not in seen_frames:
            seen_frames.add(id(frame));source=frame.f_locals['event'].source
            metadata.append({'home':str(get_hermes_home()),'secret_home':str(current_secret_scope_home()),'secret_bound':current_secret_scope() is not None,'actor_matches':source.user_id=='actor-a','channel_matches':source.chat_id=='owner-dm'})
    async def wait_for(predicate):
        async def poll():
            while not predicate():
                assert not fixture_errors,fixture_errors
                await asyncio.sleep(.05)
        await asyncio.wait_for(poll(),65)
    def main_count():return sum(bool(request.get('tools')) for request in models)
    def native_rows():
        found={}
        for database in ROOT.rglob('state.db'):
            with sqlite3.connect(database) as db:
                if not db.execute("SELECT 1 FROM sqlite_master WHERE name='session_admissions'").fetchone():continue
                for target,payload,status in db.execute('SELECT target_session_id,payload_json,status FROM session_admissions'):
                    native=json.loads(payload).get('native_text_v1',{});number=native.get('event',{}).get('platform_update_id')
                    if str(number) in ('1','11'):found[int(number)]=(target,status,native)
        return found
    queue_case(1,'actor-a','direct');await wait_for(acks[1].is_set)
    assert pathlib.Path('/scope/workspace/full-proof-1.txt').exists()
    before=main_count();queue_case(10,'actor-a','direct')
    def prompt():
        with lock:
            for response in calls:
                if response['op']=='bot_reply' and response.get('update_id')==10:
                    match=re.search(r'(/sombra-confirm@hermes ([a-f0-9]{32}) )once\|cancel',response.get('text',''))
                    if match:return match
        return None
    await wait_for(lambda:prompt() is not None)
    match=prompt();assert not acks[10].is_set() and main_count()==before
    pending_records=[]
    for scope in adapter._scopes.values():
        pending_records.extend(record for nonce,record in scope['prompts'].items() if nonce==match.group(2))
    assert len(pending_records)==1
    record=pending_records[0];pending=slash_confirm.get_pending(record['session'])
    assert record['kind']=='slash' and record['actor']=='actor-a' and record['channel']=='owner-dm'
    assert pending and pending['confirm_id']==record['sdk_id'] and callable(pending['handler'])
    print('REAL_DEFAULT_TRUE_SDK_NONCE_PROMPT_PENDING_ORIGINAL_UNACKED_NO_MODEL_OK',flush=True)
    sys.setprofile(trace)
    try:
        # This is the actual rendered nonce command, returned through the real fake-backend poll.
        # No callback, waiter, SDK resolver or confirmation handler is invoked by the fixture.
        queue_case(12,'actor-a','direct',control_text=match.group(1)+'once')
        await wait_for(lambda:acks[12].is_set() and acks[10].is_set())
    except Exception:
        print('REAL_CONFIRM_CALLBACK_SCOPE_METADATA',metadata,flush=True)
        raise
    finally:sys.setprofile(None)
    assert main_count()==before,'real confirmation invoked main model'
    assert metadata,'actual SDK reset callback was never entered'
    print('REAL_CONFIRM_CALLBACK_SCOPE_METADATA',metadata,flush=True)
    assert all(item['home']==str(ROOT/'profiles/sombra') and item['secret_home']==str(ROOT/'profiles/sombra') and item['secret_bound'] and item['actor_matches'] and item['channel_matches'] for item in metadata),'actual confirmation callback left named home/secret scope'
    assert sum(call['op']=='bot_ack' and call.get('update_id')==10 for call in calls)==1
    assert sum(call['op']=='bot_ack' and call.get('update_id')==12 for call in calls)==1
    assert sum(call['op']=='bot_authorize_update' and int(call.get('update_id',0))==12 for call in calls)>=1
    queue_case(11,'actor-a','direct');await wait_for(acks[11].is_set)
    rows=native_rows();assert set(rows)=={1,11} and rows[1][0]!=rows[11][0]
    assert all(row[1]=='terminal' and row[2].get('provenance') for row in rows.values())
    assert system_context_cases=={1,11}
    assert (ROOT/'SOUL.md').read_text()=='QA_ROOT_TELEGRAM_PERSONA_MUST_NOT_COPY'
    assert pathlib.Path('/scope/workspace/full-proof-11.txt').exists()
    print('REAL_DEFAULT_TRUE_NONCE_POLL_CALLBACK_NAMED_SCOPE_BOTH_ACK_NEW_SESSION_SYSTEM_OK',flush=True)
    print(json.dumps({'pass':True,'mode':'default TRUE actual nonce consumer','model_calls_during_reset_and_confirm':0,'original_and_control_ack_once':True,'callback_named_home_and_secret_scope':True,'next_session_rotated':True,'actual_system_context':True,'real_inference_calls':0}))

server=ThreadingHTTPServer(('127.0.0.1',18765),Fake);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
async def main():
    global expected_platform_context
    from hermes_cli.plugins import discover_plugins
    from gateway.config import Platform,load_gateway_config
    from gateway.run import GatewayRunner,_multiplex_profile_homes,_profile_runtime_scope
    from gateway.run_bootstrap import (_start_gateway_reserve_profiles,
        _start_gateway_claim_pid_file,_start_gateway_start_control_socket)
    from gateway.run_runtime import (initialize_gateway_runtime,start_gateway_runtime_api,
        publish_gateway_runtime_ready,drain_gateway_runtime)
    from gateway.status import release_gateway_runtime_lock,remove_pid_file
    from gateway import session_envelope
    from agent.secret_scope import current_secret_scope
    discover_plugins()
    # Only the paid backend is fake. Native image_generate dispatch/normalization,
    # actual post_tool_call hooks and all authorization/delivery remain real.
    from agent import image_gen_registry
    from agent.image_gen_provider import ImageGenProvider,success_response
    from hermes_constants import get_hermes_home
    class QAImageProvider(ImageGenProvider):
        @property
        def name(self):return 'qa-fake-image'
        def is_available(self):return True
        def generate(self,prompt,aspect_ratio='landscape',**kwargs):
            assert get_hermes_home()==ROOT/'profiles/sombra','native producer ran under a foreign profile'
            case=int(re.search(r'QA_IMAGE_CASE_(\d+)',prompt).group(1))
            path=PRODUCED if case==7 else TELEGRAM_IMAGE
            if case==7:path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(PNG)
            with lock:producer_calls.append({'case':case,'path':str(path)})
            return success_response(image=str(path),model='qa-native-png',prompt=prompt,aspect_ratio=aspect_ratio,provider=self.name)
    qa_image=QAImageProvider()
    image_gen_registry.register_provider(qa_image,scope=str(ROOT/'profiles/sombra'))
    from tools import image_generation_tool
    from tools.registry import registry
    with _profile_runtime_scope(ROOT/'profiles/sombra'):
        assert image_generation_tool.check_image_generation_requirements()
        assert registry.get_entry('image_generate').handler.__module__=='tools.image_generation_tool','native tool handler was replaced'
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
        expected_platform_context=shared.HINT
        assert 'Sombra' in expected_platform_context and 'NOT a Telegram' in expected_platform_context,'app-specific non-Telegram identity descriptor missing'
        assert shared.INVOCATION.get() is None
        assert adapter._message_handler.__module__.startswith('gateway.'),'actual wired handler was replaced by a fixture'
        assert 'platform_update_id' in session_envelope._EVENT_FIELDS
        print('FULL_REAL_GATEWAY_START_WORKERS_BEFORE_EVENT_NO_HANDLER_OVERRIDE_OK')
        from tools.registry import invalidate_check_fn_cache
        image_gen_registry.register_provider(qa_image,scope=str(ROOT/'profiles/sombra'))
        invalidate_check_fn_cache()
        with _profile_runtime_scope(ROOT/'profiles/sombra'):
            assert image_gen_registry.get_active_provider() is qa_image
        FORGED.write_bytes(PNG+b'FORGED_PRIVATE_SENTINEL')
        TELEGRAM_IMAGE.parent.mkdir(parents=True,exist_ok=True)
        TELEGRAM_IMAGE.write_bytes(PNG+b'TELEGRAM_PRIVATE_SENTINEL')
        if os.environ.get('QA_INTERACTIVE_CONFIRM')=='1':
            await run_real_confirmation(runner,adapter,shared)
            return
        cases=[(7,'actor-a','group',False,False), # genuinely first-contact image group
               (1,'actor-a','direct',False,False),(2,'actor-a','direct',True,False),
               (3,'actor-a','group',False,False),(4,'actor-a','group',True,False),
               (5,'actor-a','direct',False,True),(6,'actor-b','group',False,False),
               (8,'actor-a','group',False,False),(9,'actor-a','group',False,False),
               (10,'actor-a','direct',False,False),(11,'actor-a','direct',False,False)]
        for number,actor,kind,ask,attachment in cases:
            assert shared.INVOCATION.get() is None,'fixture leaked an outer invocation binding'
            main_calls_before=sum(bool(request.get('tools')) for request in models)
            queue_case(number,actor,kind,ask,attachment)
            if number==9:
                async def wait_uncertain():
                    while True:
                        assert not fixture_errors,fixture_errors
                        for scope in adapter._scopes.values():
                            row=scope['journal'].db.execute('SELECT state FROM updates WHERE id=?',(str(number),)).fetchone()
                            if row and row[0]=='UNCERTAIN' and scope['halted']:return True
                        await asyncio.sleep(.05)
                ok=await asyncio.wait_for(wait_uncertain(),65)
                assert not acks[number].is_set(),'unsafe producer failure was ACKed and could be silently replayed'
            else:
                async def wait_ack():
                    while not acks[number].is_set():
                        assert not fixture_errors,fixture_errors
                        await asyncio.sleep(.05)
                    return True
                try:ok=await asyncio.wait_for(wait_ack(),65)
                except TimeoutError:
                    diagnostics=[]
                    for scope in adapter._scopes.values():
                        row=scope['journal'].db.execute('SELECT state FROM updates WHERE id=?',(str(number),)).fetchone()
                        if row:
                            cur=scope.get('current') or {}
                            done=cur.get('done')
                            diagnostics.append({'state':row[0],'halted':scope['halted'],'failed':cur.get('failed'),'final':cur.get('final'),'done':done.is_set() if hasattr(done,'is_set') else None,'parts':cur.get('parts')})
                    print('QA_CASE_ACK_TIMEOUT_METADATA',number,diagnostics,flush=True)
                    raise
            with lock:outputs=[c for c in calls if c['op']=='bot_reply' and c['update_id']==number]
            assert ok,('full actual ingress failed before expected disposition',number,outputs)
            if number not in (9,10):
                assert any('FULL_FINAL_CASE_'+str(number) in c.get('text','') for c in outputs),('not a genuine successful SDK turn final',number,outputs)
            elif number==9:
                assert any(any(word in c.get('text','').lower() for word in ('не удалось','не отправлен','ошибк','error')) for c in outputs),'unsafe producer failure had no explicit safe notice'
            else:
                assert sum(bool(request.get('tools')) for request in models)==main_calls_before,'native reset invoked main inference'
                assert outputs and any(c.get('text') for c in outputs),'native reset had no SDK confirmation'
                print('ACTUAL_NATIVE_RESET_AT_HANDLE_NO_MAIN_MODEL_CALL_OK')
            assert not any('refused' in c.get('text','').lower() or 'invalid_params' in c.get('text','') for c in outputs)
            if number<=6 or number==11:
                assert pathlib.Path('/scope/workspace/full-proof-'+str(number)+'.txt').read_text()=='QA_FULL_TOOL_'+str(number),('actual queued tool did not execute',number)
            elif number==7:
                images=[c['attachment'] for c in outputs if c.get('attachment')]
                assert len(images)==1 and images[0]['mime']=='image/png','native post-tool producer did not deliver exactly one PNG'
                assert hashlib.sha256(base64.b64decode(images[0]['data'])).digest()==hashlib.sha256(PNG).digest()
                text=''.join(c.get('text','') for c in outputs)
                assert 'file://' not in text and str(PRODUCED) not in text,'successful image host path leaked instead of attachment reference'
                assert sum(p['case']==7 for p in producer_calls)==1,'native image producer executed more than once'
                assert producer_routes.get(7)=='tool_call','progressive real SDK bridge was not exercised'
                assert not any(word in text.lower() for word in ('sethome','home channel','домашн')),'operational home prompt leaked to first-contact group'
                records=[]
                for journal in pathlib.Path('/scope/state/scopes').glob('*/journal.sqlite'):
                    with sqlite3.connect(journal) as db:
                        if db.execute("SELECT 1 FROM sqlite_master WHERE name='generated_artifacts'").fetchone():
                            records.extend(db.execute('SELECT update_id,tool_call_id,source_path,sha256,staged_path,mime,size,tool_result_hash,response_ref FROM generated_artifacts WHERE update_id=?',(str(number),)).fetchall())
                assert len(records)==1,'actual post_tool_call producer manifest was not persisted exactly once'
                uid,tool_id,source_path,sha,staged,mime,size,result_hash,response_ref=records[0]
                assert str(uid)=='7' and tool_id=='full-image-7' and source_path==str(PRODUCED)
                assert sha==hashlib.sha256(PNG).hexdigest() and size==len(PNG) and mime=='image/png'
                assert re.fullmatch(r'[0-9a-f]{64}',result_hash) and response_ref,'manifest missing result hash/delivery reference'
                assert pathlib.Path(staged).is_relative_to('/scope/state/scopes') and pathlib.Path(staged).read_bytes()==PNG
                copied=list(pathlib.Path('/scope/state/scopes').glob('*/artifacts/*'))
                assert any(p.is_file() and p.read_bytes()==PNG for p in copied),'producer bytes were not copied into scoped export artifacts'
                print('NATIVE_STRUCTURED_IMAGE_POSTHOOK_MARKDOWN_WITHOUT_MEDIA_PNG_EXPORT_OK')
            elif number in (8,9):
                leaked=[]
                for output in outputs:
                    if output.get('attachment'):
                        part=output['attachment'];data=base64.b64decode(part.get('data',''))
                        leaked.append({'mime':part.get('mime'),'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),'synthetic_Telegram_marker':b'TELEGRAM_PRIVATE_SENTINEL' in data})
                assert not leaked,('unmanifested arbitrary/Telegram file exported',number,leaked)
                text=''.join(c.get('text','') for c in outputs)
                assert 'file://' not in text and str(FORGED if number==8 else TELEGRAM_IMAGE) not in text,'unproven file reference was not scrubbed'
                if number==8:assert 'файл не отправлен' in text.lower(),'unproven file lacked explicit not-sent label'
                assert not any('FORGED_PRIVATE_SENTINEL' in json.dumps(c) or 'TELEGRAM_PRIVATE_SENTINEL' in json.dumps(c) for c in outputs)
                if number==9:
                    assert sum(p['case']==9 for p in producer_calls)==1,'unrelated-cache producer negative was not exercised exactly once'
                    assert producer_routes.get(9)=='tool_call','negative producer did not pass through real SDK bridge'
                for journal in pathlib.Path('/scope/state/scopes').glob('*/journal.sqlite'):
                    with sqlite3.connect(journal) as db:
                        if db.execute("SELECT 1 FROM sqlite_master WHERE name='generated_artifacts'").fetchone():
                            assert db.execute('SELECT COUNT(*) FROM generated_artifacts WHERE update_id=?',(str(number),)).fetchone()[0]==0,'unproven file created a producer export manifest'
                print('UNMANIFESTED_OR_TELEGRAM_FILE_EXPORT_DENIED_OK',number)
            assert sum(c['op']=='bot_ack' and c['update_id']==number for c in calls)==(0 if number==9 else 1)
            if number!=9:
                with lock:
                    reply_index=max(i for i,c in enumerate(calls) if c['op']=='bot_reply' and c['update_id']==number)
                    ack_index=next(i for i,c in enumerate(calls) if c['op']=='bot_ack' and c['update_id']==number)
                assert reply_index<ack_index
            marker='FULL_NATIVE_DURABLE_ACTUAL_AGENT_TERMINAL_FINAL_ACK_OK' if number<=6 else ('FULL_NATIVE_DURABLE_UNSAFE_PRODUCER_UNCERTAIN_NO_ACK_OK' if number==9 else 'FULL_NATIVE_DURABLE_ACTUAL_FINAL_ACK_OK')
            print(marker,number,actor,kind,'ask' if ask else 'plain','attachment' if attachment else 'text')
        admissions={}
        for database in ROOT.rglob('state.db'):
            with sqlite3.connect(database) as db:
                if not db.execute("SELECT 1 FROM sqlite_master WHERE name='session_admissions'").fetchone():continue
                for admission_id,target,payload,status,outcome in db.execute('SELECT admission_id,target_session_id,payload_json,status,outcome FROM session_admissions'):
                    native=json.loads(payload).get('native_text_v1',{})
                    value=native.get('event',{}).get('platform_update_id')
                    if str(value) not in {str(x[0]) for x in cases}:continue
                    assert status in (('terminal','unknown') if int(value)==9 else ('terminal',)),(value,status,outcome)
                    assert not native['event'].get('metadata'),('private metadata crossed codec',value)
                    assert native.get('provenance') and native['source']['platform']=='sombra'
                    assert native['source'].get('profile')=='sombra'
                    admissions[int(value)]=(target,native,status,outcome)
        assert set(admissions)=={case[0] for case in cases if case[0]!=10},('missing real durable native admissions',sorted(admissions))
        assert admissions[1][0]==admissions[2][0]==admissions[5][0],'same owner DM was not the same reused durable session'
        assert admissions[3][0]==admissions[4][0],'sequential group turns did not reuse durable session'
        assert admissions[3][0]!=admissions[6][0],'group actors merged into the same session'
        assert admissions[7][0]==admissions[8][0]==admissions[9][0],'producer/forged followups did not reuse the same image-group session'
        assert admissions[7][0]!=admissions[3][0],'first-contact image group merged with previous group'
        assert admissions[5][1].get('media'),'attachment was not captured by actual native codec'
        assert admissions[11][0]!=admissions[1][0],'actual native reset did not rotate owner DM session'
        print('ACTUAL_NATIVE_RESET_ROTATED_SESSION_NEXT_TURN_NEW_SYSTEM_CONTEXT_OK')
        print('REAL_SQLITE_NATIVE_ENVELOPES_STANDARD_UPDATE_IDS_PROVENANCE_ATTACHMENT_AND_REUSED_WORKERS_OK',len(admissions))
        assert system_context_cases=={case[0] for case in cases if case[0]!=10}
        assert (ROOT/'SOUL.md').read_text()=='QA_ROOT_TELEGRAM_PERSONA_MUST_NOT_COPY','root Telegram persona was modified'
        print('ACTUAL_SDK_SYSTEM_SOMBRA_PLATFORM_CONTEXT_AND_UNCHANGED_TELEGRAM_PERSONA_OK')
        assert TOKEN not in json.dumps(models) and 'QA_ROOT_TELEGRAM_PERSONA_MUST_NOT_COPY' not in json.dumps(models)
        print(json.dumps({'pass':True,'actual_gateway_start':True,'native_durable_admissions':len(admissions),'native_terminal_admissions':sum(row[2]=='terminal' for row in admissions.values()),'unsafe_producer_sql_status':admissions[9][2],'unsafe_producer_adapter_disposition':'UNCERTAIN halted no ACK','native_image_png_export':True,'progressive_tool_call_real_native_handler':True,'native_reset_no_main_model':True,'reset_next_turn_session_rotated':True,'actual_system_platform_context':True,'unmanifested_file_export_denied':True,'telegram_cache_export_denied':True,'same_actor_dm_sequential':True,'same_actor_group_sequential':True,'two_group_actors_separate':True,'actual_provider_http_calls':len(models),'real_inference_calls':0,'not_claimed':['real account authorization','real Telegram','production deployment','live filesystem confidentiality']}))
    finally:
        try:
            await asyncio.wait_for(drain_gateway_runtime(runner),15)
            await asyncio.wait_for(runner.stop(),55)
        finally:
            if control is not None:await asyncio.wait_for(control.stop(),15)
            remove_pid_file();release_gateway_runtime_lock()
try:asyncio.run(main())
finally:server.shutdown();server.server_close();thread.join();faulthandler.cancel_dump_traceback_later()
