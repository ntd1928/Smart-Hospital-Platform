import { badRequest, getStatus, normalizeOperationOutcome } from '@medplum/core';
import cors from 'cors';
import type { Express, NextFunction, Request, Response } from 'express';
import { json, Router, urlencoded } from 'express';
import http from 'node:http';
import { inviteHandler, inviteValidator } from './admin/invite';
import { verifyProjectAdmin } from './admin/utils';
import { authRouter } from './auth/routes';
import { loadConfig } from './config/loader';
import type { ServerConfig } from './config/utils';
import { attachRequestContext, closeRequestContext } from './context';
import { closeDatabase, initDatabase } from './database';
import { fhirRouter } from './fhir/routes';
import { loadStructureDefinitions } from './fhir/structure';
import { healthcheckHandler, cleanupReservedDatabaseConnections } from './healthcheck';
import { initKeys } from './oauth/keys';
import { authenticateRequest } from './oauth/middleware';
import { oauthRouter } from './oauth/routes';
import { closeRedis, initRedis } from './redis';
import { seedDatabase } from './seed';
import { initBinaryStorage } from './storage/loader';
import { Operator } from '@medplum/core';
import { getGlobalSystemRepo } from './fhir/repo';

export async function initAppServices(config: ServerConfig): Promise<void> {
  loadStructureDefinitions(config);
  initRedis(config);
  await initDatabase(config);
  await seedDatabase(config);
  await initKeys(config);
  initBinaryStorage(config.binaryStorage);
}

export async function initApp(app: Express, config: ServerConfig): Promise<http.Server> {
  await initAppServices(config);
  app.disable('x-powered-by');
  app.use(cors({ origin: config.appBaseUrl.replace(/\/$/, ''), credentials: true }));
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(
    json({ limit: '1mb', type: ['application/json', 'application/*+json'] }),
    urlencoded({ extended: false }),
    attachRequestContext
  );
  app.get('/healthcheck', healthcheckHandler);
  app.get('/config/public', async (_req, res) => {
    const project = await getGlobalSystemRepo().searchOne({
      resourceType: 'Project',
      filters: [{ code: 'name', operator: Operator.EQUALS, value: 'Smart Hospital Demo' }],
    });
    if (!project) {
      res.status(503).json({ error: 'Run npm run seed first' });
      return;
    }
    res.json({ projectId: project.id });
  });
  app.use('/auth', authRouter);
  app.use('/oauth2', oauthRouter);
  const admin = Router().use(authenticateRequest, verifyProjectAdmin);
  admin.post('/:projectId/invite', inviteValidator, inviteHandler);
  app.use('/admin/projects', admin);
  app.use('/fhir/R4', fhirRouter);
  app.use((_req, res) =>
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'Endpoint outside weeks 5–6 scope' }],
    })
  );
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    closeRequestContext();
    const outcome = err.type === 'entity.parse.failed' ? badRequest('Invalid JSON') : normalizeOperationOutcome(err);
    res.status(getStatus(outcome)).json(outcome);
  });
  return http.createServer(app);
}

export async function shutdownApp(): Promise<void> {
  cleanupReservedDatabaseConnections();
  await closeDatabase();
  await closeRedis();
}
