"""Root fixture setup followed by irrevocable unprivileged SDK execution."""
import json,os,pathlib
base=pathlib.Path('/scope')
for directory in ('home','workspace/artifacts','state','cache','xdg/config','xdg/data','xdg/state'):
    (base/directory).mkdir(parents=True,exist_ok=True)
(base/'home/plugins').mkdir()
(base/'home/plugins/sombra-platform').symlink_to('/opt/sombra-plugin',target_is_directory=True)
(base/'home/config.yaml').write_text('plugins:\n  enabled: [sombra-platform]\nterminal:\n  backend: local\n  cwd: /scope/workspace\ncompression:\n  enabled: false\ncurator:\n  enabled: false\n')
marker=pathlib.Path('/run/sombra-runtime');marker.mkdir(parents=True)
manifest={'schema':1,'mode':'actor-channel','hermes_commit':'bf0203a794a07aac3ff764972ab9087baa4e4f4e','actor_id':'actor','channel_id':'chan','bot_id':'bot','server_id':'fake-server','broker_url':'http://127.0.0.1:18765/api','isolated':True,'no_telegram_mounts':True,'scoped_broker':True,'provider_proxy':True,'hermes_home':'/scope/home','workspace':'/scope/workspace','artifact_roots':['/scope/workspace/artifacts']}
(marker/'compartment.json').write_text(json.dumps(manifest));(marker/'compartment.json').chmod(0o444);marker.chmod(0o555)
for item in [base,*base.rglob('*')]:
    if not item.is_symlink():os.chown(item,10001,10001)
os.environ.update(HOME='/scope/home',HERMES_HOME='/scope/home',XDG_CONFIG_HOME='/scope/xdg/config',XDG_DATA_HOME='/scope/xdg/data',XDG_STATE_HOME='/scope/xdg/state',XDG_CACHE_HOME='/scope/cache',SOMBRA_ACTOR_ID='actor',SOMBRA_CHANNEL_ID='chan',SOMBRA_STATE_DIR='/scope/state',SOMBRA_API_URL=manifest['broker_url'],SOMBRA_API_TOKEN='sombra_scope_fixture',SOMBRA_TEST_LOOPBACK='1',TERMINAL_ENV='local',TERMINAL_CWD='/scope/workspace')
os.chdir('/scope/workspace');os.setgroups([]);os.setgid(10001);os.setuid(10001)
os.execv('/opt/venv/bin/python',['/opt/venv/bin/python','/opt/qa/smoke.py'])
