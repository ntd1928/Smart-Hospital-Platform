import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const upstream = path.resolve(process.argv[2] ?? path.join(root, '../medplum'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: upstream, encoding: 'utf8' }).trim();
const tracked = execFileSync('git', ['ls-files'], { cwd: upstream, encoding: 'utf8' }).trim().split('\n');
const hash = (content) => createHash('sha256').update(content).digest('hex');
const files = tracked
  .filter((file) => file.startsWith('packages/server/src/') || ['LICENSE.txt', 'NOTICE'].includes(file))
  .filter((file) => fs.existsSync(path.join(root, file)))
  .map((file) => {
    const upstreamSha256 = hash(fs.readFileSync(path.join(upstream, file)));
    const currentSha256 = hash(fs.readFileSync(path.join(root, file)));
    return {
      path: file,
      upstreamSha256,
      currentSha256,
      status: upstreamSha256 === currentSha256 ? 'unchanged' : 'adapted-or-formatted',
    };
  });
process.stdout.write(
  JSON.stringify(
    { repository: 'https://github.com/medplum/medplum', commit, packageVersion: '5.2.7', files },
    null,
    2
  ) + '\n'
);
