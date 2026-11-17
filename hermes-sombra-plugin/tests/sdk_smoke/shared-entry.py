"""Disposable same-process shared-host QA setup; NOT a production runtime plan."""
import os,pathlib
root=pathlib.Path('/scope')
for name in ('home','home/profiles/sombra','workspace','state','legacy','cache','xdg/config','xdg/data','xdg/state','credentials'):
    (root/name).mkdir(parents=True,exist_ok=True)
for home in (root/'home',root/'home/profiles/sombra'):
    (home/'plugins').mkdir()
    (home/'plugins/sombra-platform').symlink_to('/opt/sombra-plugin',target_is_directory=True)
config='plugins:\n  enabled: [sombra-platform]\nterminal:\n  backend: local\n  cwd: /scope/workspace\ncompression:\n  enabled: false\ncurator:\n  enabled: false\n'
(root/'home/config.yaml').write_text(config+'platforms:\n  sombra:\n    enabled: true\n    extra: {dm_policy: allowlist, group_policy: allowlist}\ngateway:\n  multiplex_profiles: true\n  profile_routes:\n    - {name: sombra-route, platform: sombra, profile: sombra}\n')
(root/'home/profiles/sombra/config.yaml').write_text(config+'model:\n  default: gpt-5\n  provider: openai-codex\nplatforms:\n  sombra:\n    enabled: false\n    extra: {dm_policy: allowlist, group_policy: allowlist}\n')
(root/'home/SOUL.md').write_text('QA_ROOT_TELEGRAM_PERSONA_MUST_NOT_COPY')
(root/'home/profiles/sombra/SOUL.md').write_text('QA_CLEAN_SOMBRA_PERSONA')
(root/'credentials/bot.env').write_text("SOMBRA_BOT_TOKEN='fake-shared-bot-token-not-real'\n")
(root/'credentials/bot.env').chmod(0o600)
for item in [root,*root.rglob('*')]:
    if not item.is_symlink():os.chown(item,10001,10001)
os.environ.update(HOME='/scope/home',HERMES_HOME='/scope/home',XDG_CONFIG_HOME='/scope/xdg/config',XDG_DATA_HOME='/scope/xdg/data',XDG_STATE_HOME='/scope/xdg/state',XDG_CACHE_HOME='/scope/cache',SOMBRA_MODE='shared_host',SOMBRA_SHARED_HOST_ACK='I_ACCEPT_SHARED_HOST_FULL_TOOLS',SOMBRA_PROFILE='sombra',SOMBRA_STATE_DIR='/scope/state',SOMBRA_LEGACY_STATE_DIR='/scope/legacy',SOMBRA_API_URL='http://127.0.0.1:18765/api',SOMBRA_TOKEN_FILE='/scope/credentials/bot.env',SOMBRA_SOUL_FILE='/scope/home/profiles/sombra/SOUL.md',SOMBRA_TEST_LOOPBACK='1',TERMINAL_ENV='local',TERMINAL_CWD='/scope/workspace')
os.chdir('/scope/workspace');os.setgroups([]);os.setgid(10001);os.setuid(10001)
os.execv('/opt/venv/bin/python',['/opt/venv/bin/python','/opt/qa/smoke.py'])
