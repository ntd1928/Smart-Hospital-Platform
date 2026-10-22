import { isOk, OperationOutcomeError } from '@medplum/core';
import { FhirRouter } from '@medplum/fhir-router';
import type { HttpMethod } from '@medplum/fhir-router';
import { Router } from 'express';
import { getAuthenticatedContext } from '../context';
import { authenticateRequest } from '../oauth/middleware';
import { projectInitHandler } from './operations/projectinit';
import { sendFhirResponse } from './response';

export const WEEK6_RESOURCES = [
  'Patient',
  'Practitioner',
  'Appointment',
  'Organization',
  'User',
  'Project',
  'ProjectMembership',
  'AccessPolicy',
  'UserConfiguration',
  'ClientApplication',
  'StructureDefinition',
  'SearchParameter',
  'ValueSet',
  'CodeSystem',
  'AuditEvent',
];
export const fhirRouter = Router();
fhirRouter.get('/metadata', (_req, res) =>
  res.json({
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: '2026-10-22',
    kind: 'instance',
    fhirVersion: '4.0.1',
    format: ['json'],
    rest: [
      {
        mode: 'server',
        resource: WEEK6_RESOURCES.map((type) => ({
          type,
          interaction: ['read', 'search-type', 'create', 'update', 'delete', 'history-instance', 'vread'].map(
            (code) => ({ code })
          ),
        })),
      },
    ],
  })
);
fhirRouter.use(authenticateRequest);
const router = new FhirRouter({ introspectionEnabled: true });
router.add('POST', '/Project/$init', projectInitHandler);
fhirRouter.use(async (req, res) => {
  const resourceType = req.path.split('/')[1];
  if (!WEEK6_RESOURCES.includes(resourceType)) {
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'Resource outside weeks 5–6 scope' }],
    });
    return;
  }
  const ctx = getAuthenticatedContext();
  const result = await router.handleRequest(
    {
      method: req.method as HttpMethod,
      url: req.url,
      pathname: '',
      params: {},
      query: Object.create(null),
      body: req.body ?? {},
      headers: req.headers,
      config: {},
    },
    ctx.repo
  );
  if (!isOk(result[0])) throw new OperationOutcomeError(result[0]);
  if (result.length === 1) {
    res.sendStatus(204);
    return;
  }
  await sendFhirResponse(req, res, result[0], result[1], result[2]);
});
