"""Real pinned imports only. All HTTP confined to fake in-container loopback."""
import asyncio,base64,importlib.util,json,os,pathlib,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

assert os.getuid()==10001
assert 'CapEff:\t0000000000000000' in pathlib.Path('/proc/self/status').read_text()
calls=[]; model_calls=[]
class Fake(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        self.send_response(404);self.end_headers()
    def do_POST(self):
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path=='/api/show':
            result={'model_info':{'qa.context_length':262144}}
        elif self.path=='/api':
            assert self.headers['Authorization']=='Bearer sombra_scope_fixture'
            calls.append(data);op=data['op'];result={}
            if op=='bot_get_me':result={'bot':{'id':'bot'},'toolPolicy':{'owner':'actor','users':[],'revision':1}}
            elif op=='bot_authorize_update':result={'update_id':data['update_id'],'bot_id':'bot','channel':'chan','sender':{'id':'actor'},'chat':{'id':'group'},'access':{'trusted':True,'policy_revision':1}}
            elif op=='bot_get_updates':result={'updates':[]}
            elif op=='bot_reply':result={'id':'message-'+data['response_key']}
            else:result={'ok':True}
        elif self.path=='/v1/chat/completions':
            model_calls.append(data)
            has_tool=any(m.get('role')=='tool' for m in data['messages'])
            message={'role':'assistant','content':'FAKE_FINAL_OK'}
            if not has_tool:
                message={'role':'assistant','content':None,'tool_calls':[{'id':'qa-terminal-1','type':'function','function':{'name':'terminal','arguments':json.dumps({'command':"printf 'SDK_TOOL_OK' > /scope/workspace/tool-proof.txt; printf 'SDK_TOOL_OK'",'timeout':10})}}]}
            result={'id':'chatcmpl-fixture','object':'chat.completion','created':int(time.time()),'model':'qa-fake','choices':[{'index':0,'message':message,'finish_reason':'stop' if has_tool else 'tool_calls'}],'usage':{'prompt_tokens':100,'completion_tokens':10,'total_tokens':110}}
        else:raise AssertionError('Unexpected HTTP endpoint '+self.path)
        if self.path=='/v1/chat/completions' and data.get('stream'):
            delta=dict(result['choices'][0]['message'])
            for index,tool in enumerate(delta.get('tool_calls',[])):tool['index']=index
            chunk={'id':result['id'],'object':'chat.completion.chunk','created':result['created'],'model':'qa-fake','choices':[{'index':0,'delta':delta,'finish_reason':None}]}
            end={**chunk,'choices':[{'index':0,'delta':{},'finish_reason':result['choices'][0]['finish_reason']}],'usage':result['usage']}
            encoded=('data: '+json.dumps(chunk)+'\n\ndata: '+json.dumps(end)+'\n\ndata: [DONE]\n\n').encode()
            mime='text/event-stream'
        else:encoded=json.dumps(result).encode();mime='application/json'
        self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(encoded)));self.end_headers();self.wfile.write(encoded)

server=ThreadingHTTPServer(('127.0.0.1',18765),Fake);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
    from hermes_cli.plugins import discover_plugins
    discover_plugins()
    from gateway.platform_registry import platform_registry
    entry=platform_registry.get('sombra')
    assert entry is not None,'real loader did not register sombra'
    import toolsets
    # Dynamic platform core is source capability inventory, not all enabled tools.
    available=toolsets.resolve_toolset('hermes-sombra')
    assert {'terminal','read_file','write_file','web_search'}.issubset(set(available)),available
    print('DYNAMIC_CORE_INVENTORY_OK',len(available))
    print('REAL_REGISTRATION_OK',entry)
    import inspect
    from gateway.platforms.base import BasePlatformAdapter
    cls=entry.adapter_factory
    def shape(method):return [(p.name,p.kind,p.default) for p in inspect.signature(method).parameters.values()]
    assert shape(cls._dispatch_inline_reply)==shape(BasePlatformAdapter._dispatch_inline_reply)
    for command,expected in [('/start@hermes',('native','/help')),('/help',('native','/help')),('/reset@hermes',('native','/reset')),('/approve once',('control','/approve once')),('/sudo anything',('control','/sudo anything'))]:
        assert cls.classify_text({'message':{'text':command}})==expected
    print('PINNED_NATIVE_LIFECYCLE_SIGNATURE_AND_CLASSIFICATION_OK')
    from run_agent import AIAgent
    async def coupled():
        from gateway.config import PlatformConfig
        adapter=entry.adapter_factory(PlatformConfig())
        async def handler(event):
            agent=AIAgent(base_url='http://127.0.0.1:18765/v1',api_key='fake-provider-not-a-secret',provider='custom',api_mode='chat_completions',model='qa-fake',max_iterations=3,enabled_toolsets=['terminal'],quiet_mode=True,skip_context_files=True,skip_memory=True,skip_background_review=True,platform='sombra',cwd='/scope/workspace')
            result=await asyncio.to_thread(agent.run_conversation,event.text)
            assert 'FAKE_FINAL_OK' in result['final_response'],result
            # Fixture-generated artifact; real media SDK transport methods, no remote URL.
            artifact=pathlib.Path('/scope/workspace/artifacts/one.png')
            artifact.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII='))
            doc=artifact.with_suffix('.txt');doc.write_text('fixture document')
            await adapter.send_typing('chan')
            image=await adapter.send_image_file('chan',str(artifact))
            document=await adapter.send_document('chan',str(doc))
            assert image.success and document.success
            return result['final_response']+' '+('x'*2100)
        original_error=adapter._notify_turn_error
        async def diagnostic_error(event,error):
            import traceback
            traceback.print_exception(error)
            print('FAKE_MODEL_CALL_COUNT',len(model_calls),'BOT_OPERATIONS',[c['op'] for c in calls])
            return await original_error(event,error)
        adapter._notify_turn_error=diagnostic_error
        adapter.set_message_handler(handler)
        assert await adapter.connect()
        try:
            event={'update_id':1,'channel':'chan','sender':{'id':'actor'},'chat':{'id':'group','kind':'group'},'message':{'id':'source','text':'Run fixture terminal then answer.'}}
            await asyncio.wait_for(adapter.ingest(event),90)
            assert pathlib.Path('/scope/workspace/tool-proof.txt').read_text()=='SDK_TOOL_OK'
            ops=[call['op'] for call in calls]
            assert ops.index('bot_reply')<ops.index('bot_ack')
            replies=[call for call in calls if call['op']=='bot_reply']
            assert all(len(call.get('text',''))<=2000 for call in replies)
            assert sum(bool(call.get('text')) for call in replies)>=2
            assert any(call.get('attachment',{}).get('mime')=='image/png' for call in replies)
            assert any(call.get('attachment',{}).get('mime')=='application/octet-stream' or call.get('attachment',{}).get('mime')=='text/plain' for call in replies)
            before=len(model_calls)
            await adapter.ingest(event)
            assert len(model_calls)==before,'ACKED redelivery reexecuted model'
            print('REAL_BASE_GATEWAY_DELIVERY_ACK_OK',ops)
        finally:await adapter.disconnect()
    asyncio.run(coupled())
    assert len(model_calls)>=2
    print('REAL_AGENT_TOOL_LOOP_OK',len(model_calls))
    print(json.dumps({'registration':True,'agent_terminal_fake_provider':True,'base_gateway_adapter_delivery':True,'network':'none','uid':os.getuid(),'mounts':'none','scope':'fresh private container','limitations':['Uses real BasePlatformAdapter handler with real AIAgent, not complete GatewayRunner startup','Cross-actor/browser/provider-proxy tests not yet executed']}))
finally:
    server.shutdown();server.server_close();thread.join()
