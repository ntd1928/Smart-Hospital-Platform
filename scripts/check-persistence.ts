import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { Redis } from 'ioredis';

if (process.env.NODE_ENV === 'production') throw new Error('Local demo check only');
const fixture = JSON.parse(await readFile(new URL('../.runtime/demo.json', import.meta.url), 'utf8'));
const config = JSON.parse(await readFile(new URL('../packages/server/medplum.config.json', import.meta.url), 'utf8'));
const ids = [...fixture.patients.map((patient: { id: string }) => patient.id), fixture.isolatedPatientId];
const poolOptions = {
  host: process.env.MEDPLUM_DATABASE_HOST ?? config.database.host,
  port: Number(process.env.MEDPLUM_DATABASE_PORT ?? config.database.port),
  database: process.env.MEDPLUM_DATABASE_DBNAME ?? config.database.dbname,
  user: process.env.MEDPLUM_DATABASE_USERNAME ?? config.database.username,
  password: process.env.MEDPLUM_DATABASE_PASSWORD ?? config.database.password,
  connectionTimeoutMillis: 1000,
};
const redisOptions = {
  host: process.env.MEDPLUM_REDIS_HOST ?? config.redis.host,
  port: Number(process.env.MEDPLUM_REDIS_PORT ?? config.redis.port),
  password: process.env.MEDPLUM_REDIS_PASSWORD ?? config.redis.password,
  lazyConnect: true,
  connectTimeout: 1000,
  retryStrategy: () => null,
};
const key = `shp:verification:${randomUUID()}`;
const value = randomUUID();
async function snapshot() {
  const pool = new Pool(poolOptions);
  try {
    const result = await pool.query(
      'SELECT "id", "content" FROM "Patient" WHERE "id" = ANY($1::uuid[]) ORDER BY "id"',
      [ids]
    );
    return result.rows;
  } finally {
    await pool.end();
  }
}
const before = await snapshot();
assert.equal(before.length, 11);
const initial = new Redis(redisOptions);
initial.on('error', () => {});
await initial.connect();
await initial.set(key, value, 'EX', 120);
await initial.quit();
console.log('Restarting only this Compose project PostgreSQL/Redis services; volumes are retained.');
execFileSync('docker', ['compose', 'restart', 'postgres', 'redis'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
});
const deadline = Date.now() + 60000;
while (true) {
  const redis = new Redis(redisOptions);
  redis.on('error', () => {});
  try {
    const after = await snapshot();
    await redis.connect();
    assert.deepEqual(after, before);
    assert.equal(await redis.get(key), value);
    await redis.del(key);
    await redis.quit();
    console.log(
      JSON.stringify({ persistenceChecksPassed: 2, patientRecordsPreserved: after.length, redisAofPreserved: true })
    );
    break;
  } catch (error) {
    redis.disconnect();
    if (Date.now() >= deadline || error instanceof assert.AssertionError) throw error;
    await delay(500);
  }
}
