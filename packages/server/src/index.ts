import express from 'express';
import { initApp, shutdownApp } from './app';
import { loadConfig } from './config/loader';

const config = await loadConfig(process.argv[2] ?? 'file:medplum.config.json,env');
const app = express();
await initApp(app, config);
const server = app.listen(config.port, '0.0.0.0', () => console.log(`Smart Hospital API: ${config.baseUrl}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await shutdownApp();
      process.exit(0);
    });
  });
}
