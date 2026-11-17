"""Fresh QA-only shared daemon with genuine Gateway ingress and fake provider config."""
import os,pathlib
root=pathlib.Path('/scope')
for name in ('home','home/profiles/sombra','workspace','state','legacy','cache','xdg/config','xdg/data','xdg/state','credentials'):
    (root/name).mkdir(parents=True,exist_ok=True)
for home in (root/'home',root/'home/profiles/sombra'):
    (home/'plugins').mkdir()
    (home/'plugins/sombra-platform').symlink_to('/opt/sombra-plugin',target_is_directory=True)
config='''plugins:
  enabled: [sombra-platform]
model:
  default: qa-fake
  provider: qa-fake-provider
custom_providers:
  - name: qa-fake-provider
    base_url: http://127.0.0.1:18765/v1
    api_key: qa-provider-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    api_mode: chat_completions
terminal:
  backend: local
  cwd: /scope/workspace
agent:
  max_turns: 4
approvals:
  destructive_slash_confirm: false
allow_lazy_installs: false
compression:
  enabled: false
curator:
  enabled: false
memory:
  enabled: false
  memory_enabled: false
  user_profile_enabled: false
tools:
  tool_search:
    enabled: 'on'
    defer: [image_generate]
platform_toolsets:
  sombra: [hermes-cli, image_gen]
image_gen:
  provider: qa-fake-image
gateway:
  multiplex_profiles: true
  profile_routes:
    - {name: sombra-route, platform: sombra, profile: sombra}
'''
if os.environ.get('QA_INTERACTIVE_CONFIRM')=='1':
    config=config.replace('destructive_slash_confirm: false','destructive_slash_confirm: true')
(root/'home/config.yaml').write_text(config+'platforms:\n  sombra:\n    enabled: true\n    extra: {dm_policy: allowlist, group_policy: allowlist}\n')
(root/'home/profiles/sombra/config.yaml').write_text(config+'platforms:\n  sombra:\n    enabled: false\n    extra: {dm_policy: allowlist, group_policy: allowlist}\n')
(root/'home/SOUL.md').write_text('QA_ROOT_TELEGRAM_PERSONA_MUST_NOT_COPY')
(root/'home/profiles/sombra/SOUL.md').write_text('QA_CLEAN_SOMBRA_PERSONA')
(root/'credentials/bot.env').write_text("SOMBRA_BOT_TOKEN='fake-shared-bot-token-not-real'\n")
(root/'credentials/bot.env').chmod(0o600)
for item in [root,*root.rglob('*')]:
    if not item.is_symlink():os.chown(item,10001,10001)
# The second export root is deliberately unsafe QA input: producer fencing must
# reject the unrelated synthetic Telegram cache even when an operator lists it.
os.environ['SOMBRA_ARTIFACT_ROOTS']='["/scope/home/profiles/sombra/cache/images","/scope/home/cache/images"]'
os.environ.update(HOME='/scope/home',HERMES_HOME='/scope/home',XDG_CONFIG_HOME='/scope/xdg/config',XDG_DATA_HOME='/scope/xdg/data',XDG_STATE_HOME='/scope/xdg/state',XDG_CACHE_HOME='/scope/cache',SOMBRA_MODE='shared_host',SOMBRA_SHARED_HOST_ACK='I_ACCEPT_SHARED_HOST_FULL_TOOLS',SOMBRA_PROFILE='sombra',SOMBRA_STATE_DIR='/scope/state',SOMBRA_LEGACY_STATE_DIR='/scope/legacy',SOMBRA_API_URL='http://127.0.0.1:18765/api',SOMBRA_TOKEN_FILE='/scope/credentials/bot.env',SOMBRA_SOUL_FILE='/scope/home/profiles/sombra/SOUL.md',SOMBRA_TEST_LOOPBACK='1',TERMINAL_ENV='local',TERMINAL_CWD='/scope/workspace')
os.chdir('/scope/workspace');os.setgroups([]);os.setgid(10001);os.setuid(10001)
os.execv('/opt/venv/bin/python',['/opt/venv/bin/python','/opt/qa/smoke.py'])
