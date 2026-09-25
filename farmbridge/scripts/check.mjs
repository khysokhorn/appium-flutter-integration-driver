import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const files = [];
walk(path.join(root, 'src'));
walk(path.join(root, 'bin'));
walk(path.join(root, 'test'));
for (const file of files.filter(x => x.endsWith('.js'))) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log(`Syntax OK: ${files.filter(x => x.endsWith('.js')).length} JavaScript files`);

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
  }
}
