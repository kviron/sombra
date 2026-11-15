import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const script = resolve('release-manifest.mjs');
for (const missing of [true, false]) test(`release manifest ${missing ? 'rejects missing installer' : 'describes existing installer'}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sombra-release-'));
  try {
    writeFileSync(join(dir, 'tauri.conf.json'), JSON.stringify({version:'0.1.0'}));
    writeFileSync(join(dir, 'setup.exe.sig'), 'test-signature');
    if (!missing) writeFileSync(join(dir, 'setup.exe'), 'installer-fixture');
    const result = spawnSync(process.execPath, [script, 'setup.exe', 'https://example.com/0.1.0/setup.exe'], {cwd:dir});
    if (missing) {
      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(dir, 'latest.json')), false);
    } else {
      assert.equal(result.status, 0, result.stderr.toString());
      const manifest = JSON.parse(readFileSync(join(dir, 'latest.json')));
      assert.equal(manifest.version, '0.1.0');
      assert.equal(manifest.notes, 'Новая версия Sombra');
      assert.equal(manifest.platforms['windows-x86_64'].signature, 'test-signature');
    }
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
