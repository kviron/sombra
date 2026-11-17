import asyncio
import os
import ast
import importlib.util
import json
from pathlib import Path
import socket
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
import base64
import types

SPEC = importlib.util.spec_from_file_location('sombra_public_runner_tests', Path(__file__).parents[1] / 'public_runner.py')
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


class FakeAgent:
    instances = []
    calls = [('web_search', {'query': 'weather'})]
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.tools = []
        self.valid_tool_names = set()
        self.closed = []
        self.instances.append(self)
    def run_conversation(self, text, **kwargs):
        self.input = (text, kwargs)
        messages = []
        for index, (name, args) in enumerate(self.calls):
            call = NS(id=str(index), function=NS(name=name, arguments=json.dumps(args)))
            self._execute_tool_calls(NS(tool_calls=[call]), messages, 'fake')
        self.results = messages
        return {'final_response': getattr(self, 'answer', 'done')}
    def _close_request_clients(self, reason):
        self.closed.append(reason)
    def _drop_shared_client(self, disposer):
        self.closed.append('own-client')
    def close(self):
        raise AssertionError('must not globally close tools')


class RunnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.payload = {'update': {'message': {'text': 'ordinary user /root/secrets user 999'}}, 'authority': {
            'update_id': 'u', 'bot_id': 'bot', 'channel': 'c', 'chat': {'id': 'chat'},
            'sender': {'id': 'ordinary'}, 'access': {'trusted': False}}}
        self.auth_calls = 0
        self.tool_calls = []
        FakeAgent.calls = [('web_search', {'query': 'weather'})]
        def search(args):
            self.tool_calls.append(args)
            return json.dumps({'success': True, 'data': {'results': []}})
        search.__module__ = 'tools.web_tools'
        self.registry = NS(get_entry=lambda name: NS(handler=search, schema={'name': name, 'parameters': {'type': 'object'}}) if name == 'web_search' else None)
    async def asyncTearDown(self):
        self.tmp.cleanup()
    async def authorize(self, payload):
        self.auth_calls += 1
        return payload['authority']
    def runner(self, **kwargs):
        return r.create_public_callback(authorize=kwargs.pop('authorize', self.authorize), artifact_base=self.tmp.name,
            resolve_provider=lambda: {'model': 'fake'}, registry=self.registry, agent_class=FakeAgent, **kwargs)
    async def test_ordinary_user_and_only_registered_safe_names(self):
        result = await self.runner()(self.payload, [{'role': 'system', 'content': 'secret'}, {'role': 'assistant', 'content': 'hello'}])
        self.assertEqual(result, {'text': 'done', 'media': []})
        self.assertEqual(len(self.tool_calls), 1)
        self.assertEqual(self.auth_calls, 3)
        agent = FakeAgent.instances[-1]
        self.assertEqual(agent.valid_tool_names, {'web_search'})
        self.assertEqual(agent.kwargs['enabled_toolsets'], [])
        for flag in ('skip_memory', 'skip_context_files', 'skip_background_review'):
            self.assertTrue(agent.kwargs[flag])
        self.assertFalse(agent.kwargs['load_soul_identity'])
        self.assertFalse(agent.kwargs['save_trajectories'])
        self.assertEqual(agent.input[1]['conversation_history'], [{'role': 'assistant', 'content': 'hello'}])
        self.assertEqual(agent.closed, ['sombra_public_turn', 'own-client'])
    async def test_real_source_secret_scope_runtime_property_thread_chain(self):
        source = Path(__file__).parents[2] / 'deploy-qa' / 'hermes-runtime-integration' / 'source'
        provider_source = Path(__file__).parents[2] / 'deploy-qa' / 'hermes-plugin-inspect' / 'source' / 'hermes_cli' / 'runtime_provider.py'
        if not (source / 'agent' / 'secret_scope.py').exists() or not provider_source.exists():
            self.skipTest('SDK source inspection mirrors unavailable')
        # Import the real stdlib-only SDK secret-scope implementation. Compile the
        # exact inspected property/helper AST to avoid importing unrelated OAuth
        # providers/config bootstrap or touching any real credential/profile store.
        spec = importlib.util.spec_from_file_location('sombra_test_sdk_secret_scope', source / 'agent' / 'secret_scope.py')
        scope = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(scope)
        pool_tree = ast.parse((source / 'agent' / 'credential_pool.py').read_text(encoding='utf-8'))
        prop = next(node for node in ast.walk(pool_tree) if isinstance(node, ast.FunctionDef) and node.name == 'runtime_base_url')
        provider_tree = ast.parse(provider_source.read_text(encoding='utf-8'))
        helper = next(node for node in provider_tree.body if isinstance(node, ast.FunctionDef) and node.name == '_pool_entry_base_url')
        code = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), prop, helper], type_ignores=[])
        namespace = {'get_secret_str': scope.get_secret_str}
        exec(compile(ast.fix_missing_locations(code), 'reviewed_sdk_scope_contract.py', 'exec'), namespace)
        entry = type('SourcePoolEntry', (), {'runtime_base_url': namespace['runtime_base_url']})()
        entry.provider, entry.base_url = 'openai-codex', 'https://default.invalid'
        resolve = namespace['_pool_entry_base_url']
        env_before = dict(os.environ)
        multiplex = scope.set_multiplex_context(True)
        try:
            with self.assertRaises(scope.UnscopedSecretError):
                resolve(entry)
            telegram = scope.set_secret_scope({'HERMES_CODEX_BASE_URL': 'https://telegram.invalid'}, profile_home=self.tmp.name+'/telegram')
            try:
                public = scope.set_secret_scope({'HERMES_CODEX_BASE_URL': 'https://sombra.invalid/'}, profile_home=self.tmp.name+'/sombra')
                try:
                    self.assertEqual(await asyncio.to_thread(resolve, entry), 'https://sombra.invalid')
                finally:
                    scope.reset_secret_scope(public)
                self.assertEqual(await asyncio.to_thread(resolve, entry), 'https://telegram.invalid')
            finally:
                scope.reset_secret_scope(telegram)
            with self.assertRaises(scope.UnscopedSecretError):
                resolve(entry)
        finally:
            scope.reset_multiplex_context(multiplex)
        self.assertEqual(dict(os.environ), env_before)

    async def test_operator_diagnostics_never_log_exception_body(self):
        secret = 'SECRET_KEY_123 https://private-provider.invalid/token user-private-text'
        with patch.object(FakeAgent, '__init__', side_effect=ValueError(secret)), self.assertLogs(r.LOGGER, level='WARNING') as captured:
            result = await self.runner()(self.payload, [])
        self.assertEqual(result, {'text': r.GENERIC_ERROR, 'media': []})
        output = '\n'.join(captured.output)
        self.assertIn('sombra_public_failure type=ValueError', output)
        self.assertIn('"file":', output)
        self.assertIn('"line":', output)
        self.assertIn('"function":', output)
        for forbidden in ('SECRET_KEY_123', 'private-provider', 'user-private-text', 'Traceback', str(Path(__file__).parent)):
            self.assertNotIn(forbidden, output)
        for record in captured.records:
            self.assertFalse(record.exc_info)

    async def test_operator_persona_preserves_policy(self):
        await self.runner(persona='Сомбра любит игры.')(self.payload, [])
        system = FakeAgent.instances[-1].input[1]['system_message']
        self.assertTrue(system.startswith(r.SYSTEM))
        self.assertTrue(system.endswith(r.SYSTEM))
        self.assertIn('Сомбра любит игры.', system)
        with self.assertRaises(r.PolicyError):
            self.runner(persona='x'*32769)

    async def test_operator_persona_reload_is_per_turn(self):
        values = ['first']
        runner = self.runner(get_persona=lambda: values[0])
        await runner(self.payload, [])
        first = FakeAgent.instances[-1].input[1]['system_message']
        values[0] = 'updated'
        await runner(self.payload, [])
        second = FakeAgent.instances[-1].input[1]['system_message']
        self.assertIn('first', first)
        self.assertNotIn('updated', first)
        self.assertIn('updated', second)
        self.assertTrue(second.startswith(r.SYSTEM) and second.endswith(r.SYSTEM))

    async def test_indirect_nested_and_unknown_args_denied(self):
        FakeAgent.calls = [('terminal', {'command': 'id'}), ('execute_code', {}), ('web_search', {'query': 'x', 'nested': {'tool': 'read_file'}})]
        await self.runner()(self.payload, [])
        self.assertEqual(self.tool_calls, [])
        self.assertTrue(all('denied' in m['content'] for m in FakeAgent.instances[-1].results))
    async def test_role_change_before_tool(self):
        async def changed(payload):
            self.auth_calls += 1
            if self.auth_calls > 1:
                raise r.PolicyError('removed')
            return payload['authority']
        result = await self.runner(authorize=changed)(self.payload, [])
        self.assertEqual(self.tool_calls, [])
        self.assertEqual(result['text'], r.GENERIC_ERROR)
    async def test_changed_actor(self):
        async def wrong(payload):
            payload['authority']['sender']['id'] = 'other'
            return payload['authority']
        self.assertEqual((await self.runner(authorize=wrong)(self.payload, []))['text'], r.GENERIC_ERROR)
    async def test_registered_image_fake_provider_scoped_artifact(self):
        raw = b'\x89PNG\r\n\x1a\nFAKE'
        module = types.ModuleType('fake_codex_provider')
        provider_type = type('OpenAICodexImageGenProvider', (), {'__module__': module.__name__})
        module._read_codex_credential = lambda: ('never-display-key', 'https://configured-provider.invalid')
        module._resolve_model = lambda: ('configured', {'quality': 'medium'})
        module._build_image_request = lambda **kw: ('images/generations', kw)
        module.size_for = lambda aspect: '1024x1024'
        registry = types.ModuleType('agent.image_gen_registry')
        registry.get_active_provider = lambda: provider_type()
        headers = types.ModuleType('agent.codex_headers')
        headers.codex_cloudflare_headers = lambda *a, **kw: {}
        httpx = types.ModuleType('httpx')
        httpx.Timeout = lambda *a, **kw: (a, kw)
        class Response:
            status_code = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def iter_bytes(self):
                yield json.dumps({'data': [{'b64_json': base64.b64encode(raw).decode()}]}).encode()
        class Client:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def stream(self, method, url, **kwargs):
                assert method == 'POST' and url.endswith('/images/generations')
                assert 'image_url' not in kwargs['json']
                return Response()
        httpx.Client = Client
        modules = {module.__name__: module, 'agent': types.ModuleType('agent'),
                   'agent.image_gen_registry': registry, 'agent.codex_headers': headers, 'httpx': httpx}
        self.registry = NS(get_entry=lambda name: NS(handler=lambda *a: None, schema={'name': name}) if name == 'image_generate' else None)
        FakeAgent.calls = [('image_generate', {'prompt': 'cat'}), ('image_generate', {'prompt': 'cat', 'image_url': '/etc/passwd'})]
        with patch.dict('sys.modules', modules):
            result = await self.runner()(self.payload, [])
        self.assertEqual(result['text'], 'done')
        self.assertEqual(len(result['media']), 1)
        path = Path(result['media'][0]['path'])
        self.assertTrue(path.is_relative_to(Path(self.tmp.name)))
        self.assertEqual(path.read_bytes(), raw)
        self.assertNotIn('never-display-key', str(result))
        self.assertIn('denied', FakeAgent.instances[-1].results[1]['content'])
        props = FakeAgent.instances[-1].tools[0]['function']['parameters']['properties']
        self.assertEqual(set(props), {'prompt', 'aspect_ratio'})

    async def test_registered_video_fake_provider_no_shell(self):
        module = types.ModuleType('fake_xai_provider')
        provider_type = type('XAIVideoGenProvider', (), {'__module__': module.__name__})
        module._resolve_xai_credentials = lambda: ('private-key', 'https://api.x.ai/v1')
        module._xai_headers = lambda key: {'Authorization': 'Bearer '+key}
        module.DEFAULT_TEXT_TO_VIDEO_MODEL = 'grok-imagine-video'
        registry = types.ModuleType('agent.video_gen_registry')
        registry.get_active_provider = lambda: provider_type()
        httpx = types.ModuleType('httpx')
        httpx.Timeout = lambda *a, **kw: None
        class Response:
            status_code = 200
            def __init__(self, body): self.body = body
            def json(self): return self.body
        class Client:
            def __init__(self, **kwargs): pass
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def post(self, url, **kwargs):
                assert url.endswith('/videos/generations')
                assert set(kwargs['json']) == {'model', 'prompt', 'duration', 'aspect_ratio', 'resolution'}
                return Response({'request_id': 'fake-id'})
            def get(self, url, **kwargs):
                return Response({'status': 'done', 'video': {'url': 'https://cdn.example/video.mp4'}})
        httpx.Client = Client
        modules = {'agent': types.ModuleType('agent'), module.__name__: module,
                   'agent.video_gen_registry': registry, 'httpx': httpx}
        self.registry = NS(get_entry=lambda name: NS(handler=lambda *a: None, schema={'name': name}) if name == 'video_generate' else None)
        FakeAgent.calls = [('video_generate', {'prompt': 'cat dancing'})]
        with patch.dict('sys.modules', modules), patch.object(r, 'fetch_public', return_value=(b'fake-video', 'video/mp4')):
            result = await self.runner()(self.payload, [])
        self.assertEqual(len(result['media']), 1)
        self.assertEqual(Path(result['media'][0]['path']).read_bytes(), b'fake-video')
        self.assertNotIn('private-key', str(result))

    async def test_public_reaction_exact_native_and_source(self):
        native = types.ModuleType('fake_sombra.native_tools')
        shared = types.ModuleType('fake_sombra.shared_host')
        native.EMOJI = ('👍', '❤️', '😂', '🔥', '🎉', '👀')
        calls = []
        async def native_react(args):
            calls.append(args)
            return {'ok': True}
        native.react = native_react
        async def authorize_native():
            return dict(self.payload['authority'])
        adapter = NS(current={'id': 'u'}, _authorize=authorize_native)
        shared.get_current_adapter = lambda: adapter
        self.registry = NS(get_entry=lambda name: NS(handler=lambda *a: self.fail('must not call arbitrary registry handler'), schema={'name': name})
                           if name in ('sombra_react', 'sombra_bot_settings', 'sombra_personality') else None)
        FakeAgent.calls = [('sombra_react', {'emoji': '👍', 'enabled': True}),
                           ('sombra_react', {'emoji': '🔥', 'enabled': False}),
                           ('sombra_react', {'emoji': '👍', 'enabled': 1}),
                           ('sombra_react', {'emoji': '👍', 'channel': 'forged'}),
                           ('sombra_react', {'emoji': '👍', 'update_id': 'other'}),
                           ('sombra_bot_settings', {'action': 'get'}), ('sombra_personality', {'action': 'get'})]
        modules = {'fake_sombra': types.ModuleType('fake_sombra'), 'fake_sombra.native_tools': native, 'fake_sombra.shared_host': shared}
        with patch.dict('sys.modules', modules), patch.object(r, '__package__', 'fake_sombra'):
            result = await self.runner()(self.payload, [])
            self.assertEqual(result['text'], 'done')
            self.assertEqual(calls, [{'emoji': '👍', 'enabled': True}, {'emoji': '🔥', 'enabled': False}])
            self.assertEqual(FakeAgent.instances[-1].valid_tool_names, {'sombra_react'})
            calls.clear()
            adapter.current = {'id': 'other'}
            await self.runner()(self.payload, [])
            self.assertEqual(calls, [])
            adapter.current = {'id': 'u'}
            async def wrong_native_source():
                authority = dict(self.payload['authority'])
                authority['sender'] = {'id': 'different-human'}
                return authority
            adapter._authorize = wrong_native_source
            await self.runner()(self.payload, [])
            self.assertEqual(calls, [])

    async def test_full_long_reply_and_paid_media_empty_text(self):
        long_answer = 'Полный ответ. '*400
        with patch.object(FakeAgent, 'answer', long_answer, create=True):
            result = await self.runner()(self.payload, [])
        self.assertGreater(len(long_answer), 2000)
        self.assertEqual(result['text'], long_answer)
        def generate(args, root, guard):
            guard()
            path = root / 'paid.png'
            path.write_bytes(b'generated')
            return {'success': True, 'media': [{'path': str(path)}]}
        wrapper = r.ConfinedTool(lambda args: None, generate)
        with patch.object(FakeAgent, 'answer', '', create=True):
            result = await self.runner(confined_tools={'web_search': wrapper})(self.payload, [])
        self.assertEqual(result['text'], 'Готово.')
        self.assertEqual(len(result['media']), 1)
        with patch.object(FakeAgent, 'answer', 'x'*48001, create=True):
            result = await self.runner(confined_tools={'web_search': wrapper})(self.payload, [])
        self.assertIn('превышает лимит', result['text'])
        self.assertEqual(len(result['media']), 1)
        self.payload['update']['message']['text'] = ''
        result = await self.runner()(self.payload, [])
        self.assertEqual(result['text'], 'Добавьте вопрос к вложению.')

    async def test_media_budget_is_atomic(self):
        def handler(args, root, guard):
            guard()
            file = root / 'own.png'
            file.write_bytes(b'generated')
            return {'success': True, 'media': [{'path': str(file)} for _ in range(33)]}
        wrapper = r.ConfinedTool(lambda args: None, handler)
        result = await self.runner(confined_tools={'web_search': wrapper})(self.payload, [])
        self.assertEqual(result['media'], [])
        self.assertIn('denied', FakeAgent.instances[-1].results[0]['content'])

    async def test_registry_and_other_agent_unchanged(self):
        other = FakeAgent(model='telegram')
        other.tools = [{'type': 'function', 'function': {'name': 'terminal'}}]
        other.valid_tool_names = {'terminal'}
        before = self.registry.get_entry('web_search').handler
        await self.runner()(self.payload, [])
        self.assertIs(self.registry.get_entry('web_search').handler, before)
        self.assertEqual(other.valid_tool_names, {'terminal'})
        self.assertEqual(other.closed, [])

    async def test_no_model_installed_wrapper(self):
        with self.assertRaises(r.PolicyError):
            self.runner(confined_tools={'terminal': r.ConfinedTool(lambda x: None, lambda *x: {})})


class ValidationTests(unittest.TestCase):
    def test_metadata_env_projection_has_no_secret_or_probe_access(self):
        config = types.ModuleType('hermes_cli.config')
        config.load_config_readonly = lambda: {'model': {'provider': 'openai-codex'}}
        providers = types.ModuleType('hermes_cli.providers')
        providers.get_provider = lambda name: NS(api_key_env_vars=('OPENAI_API_KEY', 'TELEGRAM_API_KEY'), base_url_env_var='OPENAI_BASE_URL')
        def search(args): raise AssertionError('metadata must not execute tools')
        search.__module__ = 'tools.web_tools'
        entry = NS(handler=search, requires_env=['FIRECRAWL_API_KEY', 'SOMBRA_BOT_TOKEN', 'ROOT_ADMIN_API_KEY', 'PATH', 'HTTPS_PROXY'])
        registry = NS(get_entry=lambda name: entry if name == 'web_search' else self.fail('must not inspect arbitrary tools'))
        provider_type = type('XAIVideoGenProvider', (), {'get_setup_schema': lambda self: {'env_vars': [{'key': 'XAI_API_KEY'}, {'key': 'DISCORD_BOT_TOKEN'}]}})
        modules = {'hermes_cli': types.ModuleType('hermes_cli'), 'hermes_cli.config': config, 'hermes_cli.providers': providers}
        before = dict(os.environ)
        with patch.dict('sys.modules', modules):
            names = r.public_provider_env_names(registry=registry, provider_snapshot={'video': provider_type()})
        self.assertEqual(names, frozenset({'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'HERMES_CODEX_BASE_URL', 'FIRECRAWL_API_KEY', 'XAI_API_KEY', 'XAI_BASE_URL'}))
        self.assertEqual(dict(os.environ), before)

    def test_explicit_provider_snapshot_never_discovers_named_providers(self):
        image = types.ModuleType('agent.image_gen_registry')
        video = types.ModuleType('agent.video_gen_registry')
        def forbidden(): raise AssertionError('must not probe named-provider availability')
        image.get_active_provider = video.get_active_provider = forbidden
        with patch.dict('sys.modules', {'agent': types.ModuleType('agent'), 'agent.image_gen_registry': image, 'agent.video_gen_registry': video}):
            wrappers = r.sdk_public_wrappers(provider_snapshot={})
        self.assertEqual(set(wrappers), {'web_extract'})

    def test_installed_source_ast_contract(self):
        mirror = Path(__file__).parents[2] / 'deploy-qa' / 'hermes-runtime-integration' / 'source' / 'run_agent.py'
        if not mirror.exists():
            self.skipTest('SDK inspection mirror not present')
        tree = ast.parse(mirror.read_text(encoding='utf-8'))
        cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'AIAgent')
        init = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == '__init__')
        names = {arg.arg for arg in init.args.args + init.args.kwonlyargs}
        for required in ('enabled_toolsets', 'max_iterations', 'max_tokens', 'run_budget_seconds',
                         'skip_memory', 'skip_context_files', 'load_soul_identity', 'skip_background_review',
                         'save_trajectories', 'checkpoints_enabled'):
            self.assertIn(required, names)
        executor = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == '_execute_tool_calls')
        self.assertEqual([arg.arg for arg in executor.args.args][:4], ['self', 'assistant_message', 'messages', 'effective_task_id'])

    def test_ssrf(self):
        def resolve(address):
            return lambda *a, **kw: [(socket.AF_INET6 if ':' in address else socket.AF_INET, 1, 6, '', (address, 443))]
        for url in ('file:///etc/passwd', 'http://127.0.0.1', 'https://[::1]', 'http://2130706433', 'http://0x7f000001', 'https://user:pw@example.com', 'https://example.com:444', 'https://example.com\\@evil.com'):
            with self.subTest(url=url), self.assertRaises(r.PolicyError):
                r.public_url(url, resolve('8.8.8.8'))
        for address in ('127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1'):
            with self.subTest(address=address), self.assertRaises(r.PolicyError):
                r.public_url('https://example.com.', resolve(address))
        self.assertEqual(r.public_url('https://example.com.', resolve('8.8.8.8')), 'https://example.com.')
        with self.assertRaises(r.PolicyError):
            r.public_url('https://example.com', lambda *a, **kw: resolve('8.8.8.8')() + resolve('10.0.0.1')())
    def test_redirect_revalidated_before_private_fetch(self):
        original = r.public_url
        addresses = [(socket.AF_INET, 1, 6, '', ('8.8.8.8', 80))]
        response = NS(status=302, getheader=lambda name: 'http://127.0.0.1/latest/meta-data')
        connection = NS(sock=None, request=lambda *a, **kw: None, getresponse=lambda: response, close=lambda: None)
        sock = NS(close=lambda: None)
        with patch.object(r, 'public_url', side_effect=lambda url: original(url, lambda *a, **kw: addresses)), \
             patch.object(r.socket, 'getaddrinfo', return_value=addresses), \
             patch.object(r.socket, 'create_connection', return_value=sock), \
             patch.object(r.http.client, 'HTTPConnection', return_value=connection) as factory:
            with self.assertRaises(r.PolicyError):
                r.fetch_public('http://public.example', lambda: None)
            self.assertEqual(factory.call_count, 1)

    def test_artifacts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            file = root / 'generated.png'
            file.write_bytes(b'fake')
            self.assertEqual(r.artifact_file(root, str(file)), file)
            for value in ('/etc/passwd', str(root / '..' / 'secret'), 'relative.png'):
                with self.assertRaises((r.PolicyError, FileNotFoundError)):
                    r.artifact_file(root, value)


if __name__ == '__main__':
    unittest.main()
