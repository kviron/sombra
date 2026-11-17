"""Exact-SDK same-process Sombra QA with simulated unrelated Telegram hooks.
No real provider/backend/Telegram; network-none container is only the TEST boundary.
"""
import asyncio,contextvars,hashlib,importlib,json,os,pathlib,threading,time,traceback
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
assert os.getuid()==10001
assert 'CapEff:\t0000000000000000' in pathlib.Path('/proc/self/status').read_text()
assert not pathlib.Path('/run/sombra-runtime/compartment.json').exists()
ROOT=pathlib.Path('/scope/home');PROFILE=ROOT/'profiles/sombra'
canonicals={};calls=[];models=[];web_calls=[];stale_contexts=[];sessions=[];public_results=[]
TOKEN='fake-shared-bot-token-not-real'
class Fake(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):self.send_response(404);self.end_headers()
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path=='/api/show':result={'model_info':{'qa.context_length':262144}}
        elif self.path=='/api':
            assert self.headers['Authorization']=='Bearer '+TOKEN
            calls.append(data);op=data['op']
            if op=='bot_get_me':result={'bot':{'id':'bot','transportVersion':2},'toolPolicy':{'owner':'actor-a','users':['actor-b'],'revision':1}}
            elif op=='bot_authorize_update':result=canonicals[int(data['update_id'])]
            elif op=='bot_get_updates':result={'updates':[]}
            elif op=='bot_reply':result={'id':'message-'+str(data['update_id'])+'-'+data['response_key']}
            elif op in ('bot_ack','bot_typing','bot_edit','bot_delete','bot_react'):result={'ok':True}
            else:raise AssertionError('Unexpected actual backend operation '+op)
            result={'data':result}  # Actual Sombra backend envelope, not the older broker fixture.
        elif self.path=='/v1/chat/completions':
            models.append(data)
            names={t['function']['name'] for t in data.get('tools',[])}
            public='terminal' not in names
            tool_results=[m for m in data['messages'] if m.get('role')=='tool']
            has_tool=bool(tool_results)
            user=' '.join(str(m.get('content','')) for m in data['messages'] if m.get('role')=='user')
            actor='actor-b' if 'actor-b' in user else 'actor-a'
            msg={'role':'assistant','content':('PUBLIC_FAKE_FINAL '+('p'*4300)+' PUBLIC_LONG_END') if public else 'TRUSTED_FAKE_FINAL'}
            if not has_tool:
                tool='web_search' if public else 'terminal'
                args={'query':'harmless fixture','limit':1} if public else {'command':"printf 'REAL_SDK_TOOL_OK' > /scope/workspace/proof-"+actor+".txt; printf 'REAL_SDK_TOOL_OK'",'timeout':10}
                msg={'role':'assistant','content':None,'tool_calls':[{'id':'call-'+actor+('-public' if public else ''),'type':'function','function':{'name':tool,'arguments':json.dumps(args)}}]}
            if public and len(tool_results)==1:
                attacks=[('sombra_react',{'emoji':'👍','enabled':True}),('terminal',{'command':"printf CHANGED > /scope/workspace/public-deny-sentinel"}),('write_file',{'path':'/scope/workspace/public-deny-sentinel','content':'CHANGED'}),('read_file',{'path':'/scope/credentials/bot.env'})]
                msg={'role':'assistant','content':None,'tool_calls':[{'id':('allowed-' if name=='sombra_react' else 'malicious-')+name,'type':'function','function':{'name':name,'arguments':json.dumps(args)}} for name,args in attacks]}
                has_tool=False
            result={'id':'chatcmpl-shared-fixture','object':'chat.completion','created':int(time.time()),'model':'qa-fake','choices':[{'index':0,'message':msg,'finish_reason':'stop' if has_tool else 'tool_calls'}],'usage':{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}}
        else:raise AssertionError('Unexpected endpoint '+self.path)
        if self.path=='/v1/chat/completions' and data.get('stream'):
            delta=dict(result['choices'][0]['message'])
            for index,tool in enumerate(delta.get('tool_calls',[])):tool['index']=index
            chunk={'id':result['id'],'object':'chat.completion.chunk','created':result['created'],'model':'qa-fake','choices':[{'index':0,'delta':delta,'finish_reason':None}]}
            end={**chunk,'choices':[{'index':0,'delta':{},'finish_reason':result['choices'][0]['finish_reason']}],'usage':result['usage']}
            encoded=('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode();mime='text/event-stream'
        else:encoded=json.dumps(result).encode();mime='application/json'
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)

def event(number,actor,trusted=True):
    channel='chan-'+actor
    canonical={'update_id':number,'bot_id':'bot','channel':channel,'sender':{'id':actor},'chat':{'id':'group'},'access':{'trusted':trusted,'policy_revision':1}}
    canonicals[number]=canonical
    return {'update_id':number,'channel':channel,'sender':{'id':actor},'chat':{'id':'group','kind':'group'},'message':{'id':'msg-'+str(number),'text':('TRUSTED ' if trusted else 'PUBLIC ')+actor}},canonical

def provider():return {'base_url':'http://127.0.0.1:18765/v1','api_key':'fake-provider-key','provider':'custom','api_mode':'chat_completions','model':'qa-fake'}
def blocked(results):return any(isinstance(r,dict) and r.get('action')=='block' for r in results)

server=ThreadingHTTPServer(('127.0.0.1',18765),Fake);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    from hermes_cli.plugins import discover_plugins,invoke_hook
    from gateway.platform_registry import platform_registry
    discover_plugins();entry=platform_registry.get('sombra')
    assert entry and entry.adapter_factory.__name__=='SharedHostAdapter',entry
    shared=importlib.import_module(entry.adapter_factory.__module__)
    public=importlib.import_module(entry.adapter_factory.__module__.rsplit('.',1)[0]+'.public_runner')
    from gateway.config import Platform,load_gateway_config
    from gateway.run import GatewayRunner,_profile_runtime_scope,_own_policy_open_startup_violation
    from gateway.run_startup import _own_policy_envs
    from run_agent import AIAgent
    platform=Platform('sombra')
    config=load_gateway_config()
    assert config.multiplex_profiles and config.platforms[platform].enabled
    assert entry.own_policy_env==('SOMBRA_DM_POLICY','SOMBRA_GROUP_POLICY'),entry.own_policy_env
    policy_envs=_own_policy_envs(platform)
    assert len(policy_envs)==3 and policy_envs[:2]==('SOMBRA_DM_POLICY','SOMBRA_GROUP_POLICY') and not policy_envs[2],policy_envs
    assert not entry.allow_all_env and not entry.trusted_inbound
    runner=GatewayRunner(config=config)
    from agent.secret_scope import is_multiplex_active
    assert is_multiplex_active(),'actual secret-scope multiplex guard is not active'
    with _profile_runtime_scope(ROOT):
        assert _own_policy_open_startup_violation(config) is None
        assert runner._start_check_access_policy() is False
        aborted,enabled,skipped,pending=asyncio.run(runner._start_prefilter_platforms())
    assert not aborted and enabled==1 and not skipped and len(pending)==1,(aborted,enabled,skipped,pending)
    assert pending[0][0]==platform
    adapter=pending[0][2]
    assert adapter.gateway_runner is runner
    assert not (PROFILE/'.env').exists(),'fixture must not copy root credentials or nonsecret sentinel into named profile'
    print('REAL_CONFIG_POLICY_UNPACK_ACCESSCHECK_AND_ADAPTER_PREFILTER_OK')
    with _profile_runtime_scope(PROFILE):
        discover_plugins()
        named_config=load_gateway_config()
        assert not named_config.platforms[platform].enabled
        runner._profile_configs['sombra']=named_config
        named=platform_registry.get('sombra')
        named_shared=importlib.import_module(named.adapter_factory.__module__)
        assert named_shared.INVOCATION is shared.INVOCATION,'profile modules split invocation ContextVar'
        assert shared.protected_persona(None,'sombra')==''
        assert shared.protected_persona(str(PROFILE/'SOUL.md'),'sombra')=='QA_CLEAN_SOMBRA_PERSONA'
    print('REAL_NAMED_PROFILE_LOADER_SINGLETON_AND_EXPLICIT_PERSONA_OK')
    original_build_source=adapter.build_source
    def checked_build_source(*args,**kwargs):
        import copy
        source=original_build_source(*args,**kwargs)
        trusted=bool(adapter._scope() and adapter._scope()['trusted'])
        verdicts=[]
        from gateway.authz_mixin import _auth_env
        for home in (ROOT,PROFILE):
            with _profile_runtime_scope(home):
                forged=copy.copy(source);forged.user_id='not-the-canonical-actor'
                raw=runner._is_user_authorized(source);scoped=runner._is_user_authorized_for_source(source)
                forged_raw=runner._is_user_authorized(forged);forged_scoped=runner._is_user_authorized_for_source(forged)
                verdicts.append((str(home),raw,scoped,forged_raw,forged_scoped,bool(_auth_env('SOMBRA_ALLOWED_USERS'))))
        print('ACTUAL_AUTHZ_LADDER_DIAGNOSTIC',trusted,verdicts)
        for home,raw,scoped,forged_raw,forged_scoped,has_list in verdicts:
            # Raw SDK ladder requires the receiving transport's secret scope. Its actual
            # source-bound wrapper performs that binding even while runtime profile is Sombra.
            if home==str(ROOT):
                assert raw is trusted,('raw transport-home actual authz',home,source.user_id,trusted)
                assert forged_raw is False,('mismatched source actor actual raw transport-home ladder',home,has_list)
            assert scoped is trusted,('transport-scoped actual authz',home,source.user_id,trusted)
            assert forged_scoped is False,('mismatched source actor actual transport-scoped ladder',home,has_list)
            with _profile_runtime_scope(pathlib.Path(home)):
                assert adapter._authorization_check(source.user_id,source.chat_type,source.chat_id) is trusted,'actual wired SDK adapter authorization callback disagrees'
                assert adapter._authorization_check('not-the-canonical-actor',source.chat_type,source.chat_id) is False
        return source
    adapter.build_source=checked_build_source
    def web_validate(args):
        assert set(args)<= {'query','limit'} and isinstance(args['query'],str)
    def web_handler(args,root,guard):
        guard();web_calls.append(args);return {'results':[{'title':'offline fixture','url':'https://example.org/fixture'}]}
    callback=public.create_public_callback(authorize=adapter._public_authorize,artifact_base='/scope/state/scopes',resolve_provider=provider,
        confined_tools={'web_search':public.ConfinedTool(web_validate,web_handler,{'name':'web_search','description':'Offline safe search fixture','parameters':{'type':'object','properties':{'query':{'type':'string'},'limit':{'type':'integer'}},'required':['query']}})},persona='QA_CLEAN_SOMBRA_PERSONA')
    async def provider_secret_scope_regression():
        from unittest.mock import patch
        from agent.credential_pool import CredentialPool,PooledCredential
        from agent.secret_scope import (UnscopedSecretError,current_secret_scope,current_secret_scope_home,
            set_secret_scope,reset_secret_scope,is_multiplex_active)
        from hermes_cli import runtime_provider
        from hermes_constants import get_hermes_home
        assert is_multiplex_active()
        assert current_secret_scope() is not None,'main public wrapper did not install official secret scope'
        assert pathlib.Path(current_secret_scope_home()).resolve()==PROFILE.resolve()
        assert pathlib.Path(get_hermes_home()).resolve()==PROFILE.resolve()
        before_env=dict(os.environ);before_scope=current_secret_scope();before_home=current_secret_scope_home()
        count_models=len(models);count_calls=len(calls)
        entry=PooledCredential.from_dict('openai-codex',{'id':'qa-synthetic','label':'qa','auth_type':'api_key',
            'source':'manual','access_token':'qa_only_'+('x'*64),'base_url':'https://chatgpt.com/backend-api/codex'})
        token=set_secret_scope(None)
        try:
            try:runtime_provider._pool_entry_base_url(entry)
            except UnscopedSecretError:pass
            else:raise AssertionError('exact pooled runtime_base_url secret read did not reject unscoped multiplex access')
        finally:reset_secret_scope(token)
        class InMemoryNoRefreshPool(CredentialPool):
            def _refresh_entry(self,*args,**kwargs):raise AssertionError('Synthetic API-key fixture attempted OAuth refresh')
        pool=InMemoryNoRefreshPool('openai-codex',[entry])
        sombra_url='http://127.0.0.1:18765/qa-scoped-codex'
        telegram_url='https://telegram-synthetic.invalid/codex'
        original_loader=runtime_provider.load_pool
        with _profile_runtime_scope(ROOT):
            telegram=set_secret_scope({'HERMES_CODEX_BASE_URL':telegram_url},profile_home=str(ROOT))
            try:
                assert entry.runtime_base_url==telegram_url
                with _profile_runtime_scope(PROFILE):
                    scoped=set_secret_scope({'HERMES_CODEX_BASE_URL':sombra_url},profile_home=str(PROFILE))
                    try:
                        assert runtime_provider._pool_entry_base_url(entry)==sombra_url
                        # Only the credential-storage seam is synthetic. Actual public helper,
                        # provider resolver, pool selection, pooled property and secret guard run.
                        with patch.object(runtime_provider,'load_pool',return_value=pool) as storage:
                            resolved=public.existing_provider()
                            assert resolved['provider']=='openai-codex' and resolved['api_mode']=='codex_responses'
                            assert resolved['base_url']==sombra_url and resolved['api_key']==entry.access_token
                            copied=contextvars.copy_context().run(public.existing_provider)
                            threaded=await asyncio.to_thread(public.existing_provider)
                            assert copied==resolved and threaded==resolved
                            runtime=runtime_provider.resolve_runtime_provider(requested='openai-codex',target_model='gpt-5')
                            assert runtime['credential_pool'] is pool and runtime['base_url']==sombra_url
                            assert storage.call_count>=4
                    finally:reset_secret_scope(scoped)
                assert entry.runtime_base_url==telegram_url,'Sombra scope changed unrelated synthetic Telegram scope'
            finally:reset_secret_scope(telegram)
        assert runtime_provider.load_pool is original_loader
        assert current_secret_scope() is before_scope and current_secret_scope_home()==before_home
        assert dict(os.environ)==before_env,'provider scope regression mutated process environment'
        assert len(models)==count_models and len(calls)==count_calls,'synthetic provider resolution performed HTTP'
        print('REAL_EXISTING_PROVIDER_POOLED_SECRET_SCOPE_UNSCOPED_REPRO_THREADCOPY_RESTORE_OK')
    async def capture_public_callback(payload,history):
        assert not adapter._scope()['trusted']
        await provider_secret_scope_regression()
        adapter.build_source(chat_id=adapter.channel,chat_type='group',user_id=adapter.actor,guild_id='group')
        result=await callback(payload,history)
        assert result['text']=='PUBLIC_FAKE_FINAL '+('p'*4300)+' PUBLIC_LONG_END','public callback silently truncated actual SDK final'
        public_results.append(result)
        return result
    adapter.public_runner=capture_public_callback
    async def handler(ev):
        assert ev.source.profile=='sombra' and not ev.source.profile_route_rejected
        actor=ev.source.user_id;sid='qa-trusted-'+actor;sessions.append(sid)
        with _profile_runtime_scope(PROFILE):
            if stale_contexts:
                old=stale_contexts[0]
                assert blocked(old.run(invoke_hook,'pre_tool_call',tool_name='terminal',args={},session_id=sessions[0]))
            agent=AIAgent(**provider(),enabled_toolsets=['terminal'],max_iterations=3,quiet_mode=True,skip_context_files=True,skip_memory=True,skip_background_review=True,platform='sombra',session_id=sid,cwd='/scope/workspace')
            result=await asyncio.to_thread(agent.run_conversation,ev.text)
            assert 'TRUSTED_FAKE_FINAL' in result['final_response'],result
            assert pathlib.Path('/scope/workspace/proof-'+actor+'.txt').read_text()=='REAL_SDK_TOOL_OK'
            assert sid in shared.SESSION_BINDINGS,'actual SDK pre_llm hook did not bind session'
            allowed=await asyncio.to_thread(invoke_hook,'pre_tool_call',tool_name='terminal',args={},session_id=sid)
            assert not blocked(allowed),allowed
            current=adapter.current['id'];canonicals[current]['access']['trusted']=False
            denied=await asyncio.to_thread(invoke_hook,'pre_tool_call',tool_name='terminal',args={},session_id=sid)
            assert blocked(denied),denied
            canonicals[current]['access']['trusted']=True
            invoke_hook('pre_llm_call',session_id=sid+'-child',parent_session_id=sid,platform='delegate')
            assert not blocked(invoke_hook('pre_tool_call',tool_name='terminal',args={},session_id=sid+'-child'))
            assert blocked(contextvars.Context().run(invoke_hook,'pre_tool_call',tool_name='terminal',args={},session_id=sid+'-child'))
            assert not blocked(contextvars.Context().run(invoke_hook,'pre_tool_call',tool_name='terminal',args={},session_id='simulated-telegram-session'))
            stale_contexts.append(contextvars.copy_context())
            import base64
            artifact=adapter._scope()['directory']/'artifacts'/'one.png'
            artifact.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII='))
            document=artifact.with_suffix('.txt');document.write_text('shared fixture '+actor)
            assert (await adapter.send_image_file(ev.source.chat_id,str(artifact))).success
            assert (await adapter.send_document(ev.source.chat_id,str(document))).success
            return result['final_response']+' '+actor+' '+('x'*2100)
    adapter.set_message_handler(handler)
    original_error=adapter._notify_turn_error
    async def diagnostic_error(ev,error):traceback.print_exception(error);return await original_error(ev,error)
    adapter._notify_turn_error=diagnostic_error
    async def run():
        with _profile_runtime_scope(ROOT):
            raw=await runner._start_connect_pending(pending)
            assert raw is not None
            connected=await runner._start_aggregate_connect_results(raw,[],[])
        assert connected==1 and runner.adapters.get(platform) is adapter,'actual gateway startup did not publish connected fake-API adapter'
        print('REAL_STARTUP_CONNECT_PENDING_AND_AGGREGATE_FAKE_API_OK')
        try:
            for number,actor in ((1,'actor-a'),(2,'actor-b')):
                update,authority=event(number,actor);_,scope=adapter._new_scope(authority)
                await asyncio.wait_for(adapter._run_scope(scope,update,authority),100)
                assert scope['journal'].begin(number,shared.digest(update))=='ACKED'
                output=[x for x in calls if x['op']=='bot_reply' and x['update_id']==number]
                assert all(len(x.get('text',''))<=2000 for x in output)
                assert sum(bool(x.get('text')) for x in output)>=2
                assert any(x.get('attachment',{}).get('mime')=='image/png' for x in output)
                assert sum(bool(x.get('attachment')) for x in output)>=2
                first_reply=next(i for i,x in enumerate(calls) if x['op']=='bot_reply' and x['update_id']==number)
                first_ack=next(i for i,x in enumerate(calls) if x['op']=='bot_ack' and x['update_id']==number)
                assert first_reply<first_ack
                before=len(models)
                await asyncio.wait_for(adapter._run_scope(scope,update,authority),20)
                assert len(models)==before,'ACKED shared source redelivery invoked model again'
            assert len(adapter._scopes)==2 and shared.INVOCATION.get() is None
            assert adapter._scopes[next(iter(adapter._scopes))]['directory']!=list(adapter._scopes.values())[1]['directory']
            # No route -> hard rejection rather than default Telegram/root fallback.
            update,authority=event(4,'actor-a');_,scope=adapter._new_scope(authority)
            token=shared.INVOCATION.set((adapter,scope,'4'));scope['current']={'id':4}
            saved=config.profile_routes;config.profile_routes=[]
            try:
                try:adapter.build_source(chat_id='chan-actor-a',chat_type='group',user_id='actor-a')
                except shared.SafetyError:pass
                else:raise AssertionError('default/root profile fallback accepted')
            finally:config.profile_routes=saved;scope['current']=None;shared.INVOCATION.reset(token)
            with _profile_runtime_scope(PROFILE):
                assert blocked(stale_contexts[0].run(invoke_hook,'pre_tool_call',tool_name='terminal',args={},session_id=sessions[0]))
                assert not blocked(invoke_hook('pre_tool_call',tool_name='terminal',args={},session_id='simulated-telegram-session'))
            sentinel=pathlib.Path('/scope/workspace/public-deny-sentinel');sentinel.write_text('ORIGINAL')
            update,authority=event(3,'public-actor',False);_,scope=adapter._new_scope(authority)
            # Do not prebind a profile here: the product public-ingest wrapper must do it.
            await asyncio.wait_for(adapter._run_scope(scope,update,authority),100)
            replies=[x for x in calls if x['op']=='bot_reply' and x['update_id']==3]
            assert any('PUBLIC_FAKE_FINAL' in x.get('text','') for x in replies),replies
            public_chunks=[x['text'] for x in replies if x.get('text')]
            assert len(public_chunks)>=3 and all(len(text)<=2000 for text in public_chunks),public_chunks
            assert ''.join(public_chunks)==public_results[-1]['text'],'shared adapter lost or altered public long-answer chunks'
            assert ''.join(public_chunks).endswith(' PUBLIC_LONG_END')
            print('PUBLIC_LONG_FINAL_CALLBACK_AND_CHUNK_ROUNDTRIP_OK',len(public_results[-1]['text']),len(public_chunks))
            assert web_calls,'actual restricted public SDK did not call confined fake web wrapper'
            assert sentinel.read_text()=='ORIGINAL','public malicious tool mutated sentinel'
            public_requests=[x for x in models if any('PUBLIC public-actor' in str(m.get('content','')) for m in x['messages'])]
            assert len(public_requests)>=3,'malicious tool round did not reach actual SDK executor'
            denied_results=[m for x in public_requests for m in x['messages'] if m.get('role')=='tool' and str(m.get('tool_call_id','')).startswith('malicious-')]
            assert {m['tool_call_id'] for m in denied_results}=={'malicious-terminal','malicious-write_file','malicious-read_file'},denied_results
            assert all(any(word in str(m.get('content','')).lower() for word in ('denied','not available','does not exist')) for m in denied_results),denied_results
            assert any(x['op']=='bot_react' and x['update_id']==3 and x.get('emoji')=='👍' for x in calls),'public native reaction lost owning invocation context'
            assert scope['journal'].begin(3,shared.digest(update))=='ACKED'
            assert not pathlib.Path('/scope/workspace/proof-public-actor.txt').exists()
            serialized=json.dumps(models)
            assert TOKEN not in serialized and 'QA_ROOT_TELEGRAM_PERSONA_MUST_NOT_COPY' not in serialized
            assert all('terminal' not in {t['function']['name'] for t in x.get('tools',[])} for x in models if any('PUBLIC public-actor' in str(m.get('content','')) for m in x['messages']))
            assert not any(x['op'].startswith('runtime_') for x in calls),'shared mode used isolated runtime broker'
            assert len(sessions)==2,'public input dispatched through normal trusted Gateway handler'
            assert not any(os.environ.get(name,'').lower() in ('true','1','yes') for name in ('GATEWAY_ALLOW_ALL_USERS','SOMBRA_ALLOW_ALL_USERS'))
            with _profile_runtime_scope(ROOT):
                previous=config.platforms[platform].extra.get('dm_policy')
                config.platforms[platform].extra['dm_policy']='open'
                try:
                    assert _own_policy_open_startup_violation(config)=='sombra: open policy without allow-all opt-in'
                    assert runner._start_check_access_policy() is True,'actual startup checker accepted malicious open policy'
                finally:config.platforms[platform].extra['dm_policy']=previous
            print('REAL_STARTUP_OPEN_POLICY_DENIED_AND_ACTUAL_AUTHZ_LADDER_TWO_SECRET_SCOPES_OK')
            print('SHARED_TRUSTED_ACTUAL_SDK_TWO_ACTORS_REFRESH_REVOKE_STALE_AND_SIMULATED_TELEGRAM_HOOKS_OK')
            print('SHARED_PUBLIC_ACTUAL_SDK_CONFINED_MOCK_WEB_AND_ENVELOPE_ACK_OK')
            print(json.dumps({'pass':True,'fake_model_calls':len(models),'mock_web_calls':len(web_calls),'runtime':'shared same process inside TEST-only private network-none container','not_tested':['real Telegram','actual delegate tool execution','actual GatewayRunner native handlers','full gateway startup','production provider authorization','filesystem privacy shared host explicitly NOT claimed']}))
        finally:await adapter.disconnect()
    asyncio.run(run())
finally:server.shutdown();server.server_close();thread.join()
