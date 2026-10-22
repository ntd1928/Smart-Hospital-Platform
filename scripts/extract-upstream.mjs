import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Default output lists missing static imports; EXTRACT_CHUNK emits serialized source chunks.
const source = path.resolve(process.argv[2] ?? '../medplum');
const root = path.resolve(import.meta.dirname, '..');
const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: source, encoding: 'utf8' }).trim().split('\n'));
const seen = new Set();
const entries = process.argv.slice(3);
const queue = entries.length ? entries : ['packages/server/src/index.ts'];
const files = [];
while (queue.length) {
  const relative = queue.shift();
  if (seen.has(relative)) continue;
  seen.add(relative);
  const target = path.join(root, relative);
  const original = path.join(source, relative);
  if (!fs.existsSync(target) && !tracked.has(relative)) throw new Error(`Untracked dependency: ${relative}`);
  const content = fs.readFileSync(fs.existsSync(target) ? target : original, 'utf8');
  if (!fs.existsSync(target)) files.push({ path: relative, content });
  const imports = [...content.matchAll(/^(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"]([^'"]+)['"]/gm)];
  for (const [, specifier] of imports) {
    if (!specifier.startsWith('.')) continue;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
    const resolved = [base, `${base}.ts`, `${base}.json`, `${base}/index.ts`].find(
      (p) => (fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isFile()) || tracked.has(p)
    );
    if (!resolved) throw new Error(`Missing ${specifier} from ${relative}`);
    queue.push(resolved);
  }
}
const serialized = JSON.stringify(files);
if (process.env.EXTRACT_CHUNK !== undefined) {
  const offset = Number(process.env.EXTRACT_CHUNK) * 80000;
  process.stdout.write(JSON.stringify(serialized.slice(offset, offset + 80000)));
} else {
  process.stdout.write(
    JSON.stringify({
      count: files.length,
      chunks: Math.ceil(serialized.length / 80000),
      paths: files.map((f) => f.path),
    })
  );
}
