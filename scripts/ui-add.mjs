import {spawnSync} from 'node:child_process';
import {constants, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ui = join(root, 'src', 'shared', 'ui');
const componentName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function addComponents(args) {
 const preview = args.includes('--dry-run');
 const names = [...new Set(args.filter(arg => arg !== '--dry-run'))];
 if (!names.length || names.some(name => !componentName.test(name))) {
  throw new Error('Usage: npm run ui:add -- <component> [component ...] [--dry-run]');
 }

 const npm = process.env.npm_execpath;
 if (!npm) throw new Error('Run this script with npm run ui:add.');

 const hasIndex = dir => ['index.tsx', 'index.ts'].some(file => existsSync(join(dir, file)));
 const pending = names.filter(name => {
  if (!existsSync(join(ui, `${name}.tsx`)) && !hasIndex(join(ui, name))) return true;
  console.log(`${name}: already exists, skipping.`);
  return false;
 });
 if (!pending.length) return 0;

 const before = new Set(readdirSync(ui));
 const result = spawnSync(
  process.execPath,
  [npm, 'exec', '--yes', '--', 'shadcn@latest', 'add', ...pending, preview ? '--dry-run' : '--yes'],
  {cwd: root, stdio: 'inherit'}
 );
 if (result.error) throw result.error;
 if (result.status !== 0) return result.status ?? 1;
 if (preview) {
  console.log('On install, new src/shared/ui/<name>.tsx files become src/shared/ui/<name>/index.tsx.');
  return 0;
 }

 // Include registry dependencies, but leave pre-existing files and non-UI paths alone.
 for (const entry of readdirSync(ui, {withFileTypes: true})) {
  const name = entry.name.slice(0, -4);
  if (!entry.isFile() || before.has(entry.name) || !entry.name.endsWith('.tsx') || !componentName.test(name)) {
   continue;
  }
  const source = join(ui, entry.name);
  const dir = join(ui, name);
  const target = join(dir, 'index.tsx');
  if (hasIndex(dir)) {
   // shadcn sees only the flat file when resolving a registry dependency.
   unlinkSync(source);
   console.log(`${name}: keeping the existing folder component.`);
  } else {
   mkdirSync(dir, {recursive: true});
   copyFileSync(source, target, constants.COPYFILE_EXCL);
   unlinkSync(source);
   console.log(`${relative(root, source)} → ${relative(root, target)}`);
  }
 }
 return 0;
}

try {
 process.exitCode = addComponents(process.argv.slice(2));
} catch (error) {
 console.error(error.message);
 process.exitCode = 1;
}
