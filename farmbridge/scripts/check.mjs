import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
walk(path.join(root, 'src'));
walk(path.join(root, 'bin'));
walk(path.join(root, 'test'));
const scripts = files.filter(x => /\.(?:js|mjs)$/.test(x));
for (const file of scripts) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}
console.log(`Syntax OK: ${scripts.length} JavaScript files`);

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p); else files.push(p);
  }
}
