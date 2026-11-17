import { isOk, OperationOutcomeError } from '@medplum/core';
import { FhirRouter, processBatch } from '@medplum/fhir-router';
import type { FhirRequest, HttpMethod } from '@medplum/fhir-router';
import { Router } from 'express';
import { getAuthenticatedContext } from '../context';
import { authenticateRequest } from '../oauth/middleware';
import {
  appointmentAvailableHandler,
  appointmentBookHandler,
  appointmentCancelHandler,
  appointmentCheckInHandler,
  appointmentOfferWaitlistHandler,
  appointmentRecordOutcomeHandler,
  appointmentRescheduleHandler,
  appointmentStaffCancelHandler,
  appointmentStartEncounterHandler,
  appointmentWaitlistHandler,
} from './operations/appointments';
import { medicationAdministrationRecordHandler } from './operations/medicationadministration';
import { encounterAddNoteHandler, encounterCancelHandler, encounterCompleteHandler, encounterRecordHandler, encounterUpdateDetailsHandler } from './operations/encounters';
import { medicationStatementRecordHandler, medicationStatementUpdateStatusHandler } from './operations/medicationstatement';
import { medicationRequestRecordHandler, medicationRequestUpdateStatusHandler } from './operations/medicationrequest';
import { allergyIntoleranceRecordHandler, allergyIntoleranceReviewHandler } from './operations/allergyintolerance';
import { projectInitHandler } from './operations/projectinit';
import { sendFhirResponse } from './response';

export const SUPPORTED_FHIR_RESOURCES = [
  'Patient',
  'Practitioner',
  'PractitionerRole',
  'Appointment',
  'Encounter',
  'Condition',
  'Observation',
  'MedicationRequest',
  'MedicationStatement',
  'MedicationAdministration',
  'AllergyIntolerance',
  'Schedule',
  'Slot',
  'Organization',
  'HealthcareService',
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
        interaction: [{ code: 'transaction' }],
        resource: SUPPORTED_FHIR_RESOURCES.map((type) => ({
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
router.add('POST', '/Appointment/$available', appointmentAvailableHandler);
router.add('POST', '/Appointment/$book', appointmentBookHandler);
router.add('POST', '/Appointment/$cancel', appointmentCancelHandler);
router.add('POST', '/Appointment/$check-in', appointmentCheckInHandler);
router.add('POST', '/Appointment/$record-outcome', appointmentRecordOutcomeHandler);
router.add('POST', '/Appointment/$start-encounter', appointmentStartEncounterHandler);
router.add('POST', '/Encounter/$complete', encounterCompleteHandler);
router.add('POST', '/Encounter/$record', encounterRecordHandler);
router.add('POST', '/Encounter/$update-details', encounterUpdateDetailsHandler);
router.add('POST', '/Encounter/$add-note', encounterAddNoteHandler);
router.add('POST', '/Encounter/$cancel', encounterCancelHandler);
router.add('POST', '/MedicationStatement/$record', medicationStatementRecordHandler);
router.add('POST', '/MedicationStatement/$update-status', medicationStatementUpdateStatusHandler);
router.add('POST', '/MedicationRequest/$record', medicationRequestRecordHandler);
router.add('POST', '/MedicationRequest/$update-status', medicationRequestUpdateStatusHandler);
router.add('POST', '/AllergyIntolerance/$record', allergyIntoleranceRecordHandler);
router.add('POST', '/AllergyIntolerance/$review', allergyIntoleranceReviewHandler);
router.add('POST', '/Appointment/$waitlist', appointmentWaitlistHandler);
router.add('POST', '/Appointment/$staff-cancel', appointmentStaffCancelHandler);
router.add('POST', '/Appointment/$offer-waitlist', appointmentOfferWaitlistHandler);
router.add('POST', '/Appointment/$reschedule', appointmentRescheduleHandler);
router.add('POST', '/MedicationAdministration/$record', medicationAdministrationRecordHandler);
fhirRouter.use(async (req, res) => {
  const ctx = getAuthenticatedContext();
  const fhirRequest: FhirRequest = {
    method: req.method as HttpMethod,
    url: req.url,
    pathname: '',
    params: {},
    query: Object.create(null),
    body: req.body ?? {},
    headers: req.headers,
    config: {},
  };
  if (
    req.method === 'POST' &&
    (req.path === '/' || req.path === '') &&
    req.body?.resourceType === 'Bundle' &&
    req.body.type === 'transaction'
  ) {
    const entries = Array.isArray(req.body.entry) ? req.body.entry : [];
    const unsupported = entries.find((entry: any) => {
      const url = String(entry?.request?.url ?? '').replace(/^.*\/fhir\/R4\//, '').replace(/^\//, '');
      const resourceType = entry?.resource?.resourceType ?? url.split(/[/?]/)[0];
      return !SUPPORTED_FHIR_RESOURCES.includes(resourceType);
    });
    if (unsupported) {
      res.status(404).json({
        resourceType: 'OperationOutcome',
        issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'Bundle entry resource is not enabled' }],
      });
      return;
    }
    res.status(200).json(await processBatch(fhirRequest, ctx.repo, router, req.body));
    return;
  }
  const resourceType = req.path.split('/')[1];
  if (!SUPPORTED_FHIR_RESOURCES.includes(resourceType)) {
    res.status(404).json({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'not-supported', diagnostics: 'Resource is not enabled for this deployment' }],
    });
    return;
  }
  const result = await router.handleRequest(fhirRequest, ctx.repo);
  if (!isOk(result[0])) throw new OperationOutcomeError(result[0]);
  if (result.length === 1) {
    res.sendStatus(204);
    return;
  }
  await sendFhirResponse(req, res, result[0], result[1], result[2]);
});
