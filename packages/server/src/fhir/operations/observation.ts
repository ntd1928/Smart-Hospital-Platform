// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Encounter, Observation, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const recordOperation = makeOperationDefinition({ scope: 'type', resource: 'Observation' }, {
  name: 'observation-record', code: 'record', parameter: [
    param('in', 'resource', 'Observation', 1, '100'),
    param('out', 'return', 'Observation', 1, '100'),
  ],
});

const updateOperation = makeOperationDefinition({ scope: 'type', resource: 'Observation' }, {
  name: 'observation-update', code: 'update', parameter: [
    param('in', 'observation', 'Reference', 1, '1'),
    param('in', 'action', 'code', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('in', 'resource', 'Observation', 0, '1'),
    param('out', 'return', 'Observation', 1, '1'),
  ],
});

type ObservationAction = 'amend' | 'entered-in-error';
const observationStatuses = new Set(['registered', 'preliminary', 'final', 'amended']);
const recordStatuses = new Set(['registered', 'preliminary', 'final']);

/** Records one or more attributed Observations atomically for assigned Patients. */
export async function observationRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getPractitionerId(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ resource: Observation | Observation[] }>(recordOperation, req);
  const inputs = Array.isArray(params.resource) ? params.resource : [params.resource];
  if (!inputs.length || inputs.length > 100) return [badRequest('Record between 1 and 100 Observations per operation.')];

  const saved = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    const validated: Observation[] = [];
    const patientCache = new Map<string, Patient>();
    const encounterCache = new Map<string, Encounter>();
    for (const input of inputs) {
      const patientId = getId(input.subject, 'Patient');
      const code = input.code?.text?.trim() || input.code?.coding?.some((coding) => coding.code?.trim());
      const effective = input.effectiveDateTime ?? input.effectiveInstant;
      const effectiveTime = effective ? new Date(effective).getTime() : Number.NaN;
      if (!patientId || !code || !Number.isFinite(effectiveTime) || effectiveTime > Date.now()) {
        throw new OperationOutcomeError(badRequest('Each Observation requires a Patient, code, and valid effective time no later than now.'));
      }
      if (input.status && !recordStatuses.has(input.status)) {
        throw new OperationOutcomeError(badRequest('New Observations must be registered, preliminary, or final.'));
      }
      if (!hasValue(input)) throw new OperationOutcomeError(badRequest('Each Observation requires a value or component.'));
      let patient = patientCache.get(patientId);
      if (!patient) {
        patient = await txRepo.readResource<Patient>('Patient', patientId);
        verifyProject(patient.meta?.project, ctx.project.id);
        if (patient.active === false) throw new OperationOutcomeError(conflict('Cannot record an Observation for an inactive Patient.'));
        await authorizePatient(txRepo, ctx, patient, practitionerId);
        patientCache.set(patientId, patient);
      }
      const encounterId = getId(input.encounter, 'Encounter');
      if (input.encounter && !encounterId) throw new OperationOutcomeError(badRequest('Observation Encounter reference is invalid.'));
      let encounter: Encounter | undefined;
      if (encounterId) {
        encounter = encounterCache.get(encounterId);
        if (!encounter) {
          encounter = await txRepo.readResource<Encounter>('Encounter', encounterId);
          verifyProject(encounter.meta?.project, ctx.project.id);
          encounterCache.set(encounterId, encounter);
        }
        if (encounter.subject?.reference !== `Patient/${patientId}`) {
          throw new OperationOutcomeError(conflict('Observation Encounter must belong to the same Patient.'));
        }
      }
      validated.push(input);
    }

    const at = new Date().toISOString();
    const output: Observation[] = [];
    for (const input of validated) {
      const savedObservation: Observation = {
        ...input,
        status: input.status ?? 'final',
        performer: [{ reference: `Practitioner/${practitionerId}` }],
        issued: at,
        note: [{ time: at, text: `Observation recorded by Practitioner/${practitionerId}.`, authorReference: { reference: `Practitioner/${practitionerId}` } }],
      };
      delete savedObservation.id;
      delete savedObservation.meta;
      output.push(await txRepo.createResource<Observation>(savedObservation));
    }
    return output;
  }, { resourceTypes: ['Encounter', 'Observation', 'Patient', 'Practitioner'], source: 'observation.record' });
  return [allOk, buildOutputParameters(recordOperation, { return: saved })];
}

/** Amends or marks an Observation entered-in-error under a resource lock with reason and actor audit. */
export async function observationUpdateHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getPractitionerId(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ observation: Reference; action: ObservationAction; reason: string; resource?: Observation }>(updateOperation, req);
  const observationId = getId(params.observation, 'Observation');
  const reason = params.reason.trim();
  if (!observationId) return [badRequest('An Observation reference is required.')];
  if (!['amend', 'entered-in-error'].includes(params.action)) return [badRequest('Observation update action is invalid.')];
  if (!reason || reason.length > 500) return [badRequest('An update reason of 1–500 characters is required.')];
  if (params.action === 'amend' && !params.resource) return [badRequest('An amended Observation resource is required.')];

  const observation = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    await txRepo.executeRawSql(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.project.id}:Observation:${observationId}`],
      { resourceTypes: ['Observation'], operation: 'write', mode: DatabaseMode.WRITER, source: 'observation.updateLock' }
    );
    const current = await txRepo.readResource<Observation>('Observation', observationId);
    verifyProject(current.meta?.project, ctx.project.id);
    const patientId = getId(current.subject, 'Patient');
    if (!patientId) throw new OperationOutcomeError(badRequest('Observation must reference one Patient.'));
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    await authorizePatient(txRepo, ctx, patient, practitionerId);
    const at = new Date().toISOString();
    if (params.action === 'entered-in-error') {
      if (current.status === 'entered-in-error') throw new OperationOutcomeError(conflict('Observation is already entered in error.'));
      return txRepo.updateResource<Observation>({
        ...current,
        status: 'entered-in-error',
        note: [...(current.note ?? []), {
          time: at,
          text: `Observation marked entered-in-error; original data retained. Reason: ${reason}`,
          authorReference: { reference: `Practitioner/${practitionerId}` },
        }],
      }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
    }

    if (!observationStatuses.has(current.status ?? '') || current.status === 'registered') {
      throw new OperationOutcomeError(conflict('Only a preliminary, final, or amended Observation can be amended.'));
    }
    const replacement = params.resource as Observation;
    if (getId(replacement.subject, 'Patient') !== patientId || replacement.encounter?.reference !== current.encounter?.reference) {
      throw new OperationOutcomeError(conflict('Amendment cannot change the Observation Patient or Encounter.'));
    }
    const effective = replacement.effectiveDateTime ?? replacement.effectiveInstant;
    const effectiveTime = effective ? new Date(effective).getTime() : Number.NaN;
    if (!Number.isFinite(effectiveTime) || effectiveTime > Date.now() || !replacement.code || !hasValue(replacement)) {
      throw new OperationOutcomeError(badRequest('Amended Observation requires a code, value, and valid effective time no later than now.'));
    }
    const previous = describeValue(current);
    const next = describeValue(replacement);
    return txRepo.updateResource<Observation>({
      ...current,
      code: replacement.code,
      effectiveDateTime: replacement.effectiveDateTime,
      effectiveInstant: replacement.effectiveDateTime ? undefined : replacement.effectiveInstant,
      valueQuantity: replacement.valueQuantity,
      valueString: replacement.valueString,
      valueCodeableConcept: replacement.valueCodeableConcept,
      valueBoolean: replacement.valueBoolean,
      valueInteger: replacement.valueInteger,
      valueRange: replacement.valueRange,
      valueRatio: replacement.valueRatio,
      valueSampledData: replacement.valueSampledData,
      valueTime: replacement.valueTime,
      valueDateTime: replacement.valueDateTime,
      dataAbsentReason: replacement.dataAbsentReason,
      component: replacement.component,
      status: 'amended',
      issued: at,
      performer: [{ reference: `Practitioner/${practitionerId}` }],
      note: [...(current.note ?? []), {
        time: at,
        text: `Observation amended: ${previous} → ${next}. Reason: ${reason}`,
        authorReference: { reference: `Practitioner/${practitionerId}` },
      }],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['Encounter', 'Observation', 'Patient', 'Practitioner'], source: 'observation.update' });
  return [allOk, buildOutputParameters(updateOperation, { return: observation })];
}

function getPractitionerId(profileReference?: string): string {
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(profileReference ?? '')?.[1];
  if (!practitionerId) throw new OperationOutcomeError(forbidden('Observation management requires an authenticated Practitioner profile.'));
  return practitionerId;
}

async function authorizePatient(
  repo: { readResource<T>(type: string, id: string): Promise<T> },
  ctx: ReturnType<typeof getAuthenticatedContext>,
  patient: Patient,
  practitionerId: string
): Promise<void> {
  const practitioner = await repo.readResource<Practitioner>('Practitioner', practitionerId);
  verifyProject(practitioner.meta?.project, ctx.project.id);
  if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot manage Observations.'));
  if (!ctx.membership.admin && !patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`)) {
    throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Patient may manage Observations.'));
  }
}

function getId(reference: Reference | undefined, resourceType: 'Patient' | 'Encounter' | 'Observation'): string | undefined {
  return new RegExp(`^${resourceType}\\/([^/]+)$`).exec(reference?.reference ?? '')?.[1];
}

function verifyProject(resourceProject: string | undefined, projectId: string): void {
  if (resourceProject !== projectId) throw new OperationOutcomeError(forbidden('Resource belongs to another project.'));
}

function hasValue(observation: Observation): boolean {
  return Boolean(observation.valueQuantity || observation.valueString || observation.valueCodeableConcept || observation.valueSampledData || observation.valueBoolean !== undefined ||
    observation.valueInteger !== undefined || observation.valueRange || observation.valueRatio || observation.valueTime || observation.valueDateTime ||
    observation.dataAbsentReason || observation.component?.length);
}

function describeValue(observation: Observation): string {
  if (observation.valueString) return observation.valueString;
  if (observation.valueQuantity) return `${observation.valueQuantity.value ?? ''} ${observation.valueQuantity.unit ?? ''}`.trim();
  if (observation.component?.length) return observation.component.map((component) =>
    `${component.code.text ?? component.code.coding?.[0]?.display ?? 'component'}: ${component.valueQuantity?.value ?? component.valueString ?? '—'}`
  ).join('; ');
  return '—';
}
