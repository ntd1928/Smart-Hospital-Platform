// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Condition, Encounter, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const recordOperation = makeOperationDefinition({ scope: 'type', resource: 'Condition' }, {
  name: 'condition-record', code: 'record', parameter: [
    param('in', 'resource', 'Condition', 1, '1'),
    param('out', 'return', 'Condition', 1, '1'),
  ],
});

const reviewOperation = makeOperationDefinition({ scope: 'type', resource: 'Condition' }, {
  name: 'condition-review', code: 'review', parameter: [
    param('in', 'condition', 'Reference', 1, '1'),
    param('in', 'change', 'code', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('out', 'return', 'Condition', 1, '1'),
  ],
});

const changes = ['confirm', 'refute', 'active', 'inactive', 'resolved'] as const;
type Change = (typeof changes)[number];
const clinicalSystem = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const verificationSystem = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';
const clinicalStatuses = ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'];

/** Creates a Condition with server-verified Patient, Encounter, and Practitioner references. */
export async function conditionRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getPractitionerId(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ resource: Condition }>(recordOperation, req);
  const input = params.resource;
  const patientId = getId(input.subject, 'Patient');
  const code = input.code?.text?.trim() || input.code?.coding?.[0]?.display?.trim();
  const verification = input.verificationStatus?.coding?.[0]?.code ?? 'confirmed';
  const onset = input.onsetDateTime ? new Date(input.onsetDateTime).getTime() : undefined;
  if (!patientId || !code || code.length > 500) return [badRequest('Condition requires a Patient and a diagnosis of at most 500 characters.')];
  if (!['confirmed', 'provisional', 'unconfirmed', 'differential'].includes(verification)) {
    return [badRequest('New diagnosis verification must be confirmed, provisional, unconfirmed, or differential.')];
  }
  if (onset !== undefined && !Number.isFinite(onset)) return [badRequest('Condition onset date is invalid.')];
  const clinical = input.clinicalStatus?.coding?.[0]?.code ?? 'active';
  if (!clinicalStatuses.includes(clinical)) return [badRequest('Condition clinical status is invalid.')];

  const condition = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    if (patient.active === false) throw new OperationOutcomeError(conflict('Cannot record a diagnosis for an inactive Patient.'));
    await authorizePatient(txRepo, ctx, patient, practitionerId);

    const encounterId = getId(input.encounter, 'Encounter');
    if (input.encounter && !encounterId) throw new OperationOutcomeError(badRequest('Condition Encounter reference is invalid.'));
    if (encounterId) {
      const encounter = await txRepo.readResource<Encounter>('Encounter', encounterId);
      verifyProject(encounter.meta?.project, ctx.project.id);
      if (encounter.subject?.reference !== `Patient/${patientId}`) {
        throw new OperationOutcomeError(conflict('Condition Encounter must belong to the same Patient.'));
      }
    }

    const at = new Date().toISOString();
    const saved: Condition = {
      ...input,
      subject: { reference: `Patient/${patientId}` },
      encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
      clinicalStatus: { coding: [{ system: clinicalSystem, code: clinical }] },
      verificationStatus: { coding: [{ system: verificationSystem, code: verification }] },
      recordedDate: at,
      recorder: { reference: `Practitioner/${practitionerId}` },
      note: [{
        time: at,
        text: `Condition recorded with verification status ${verification}.`,
        authorReference: { reference: `Practitioner/${practitionerId}` },
      }],
    };
    delete saved.id;
    delete saved.meta;
    return txRepo.createResource(saved);
  }, { resourceTypes: ['Condition', 'Encounter', 'Patient', 'Practitioner'], source: 'condition.record' });
  return [allOk, buildOutputParameters(recordOperation, { return: condition })];
}

/** Applies a valid diagnosis lifecycle transition with a required reason and attributed audit note. */
export async function conditionReviewHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getPractitionerId(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ condition: Reference; change: Change; reason: string }>(reviewOperation, req);
  const conditionId = getId(params.condition, 'Condition');
  const reason = params.reason.trim();
  if (!conditionId) return [badRequest('A Condition reference is required.')];
  if (!changes.includes(params.change)) return [badRequest('Condition review action is invalid.')];
  if (!reason || reason.length > 500) return [badRequest('A review reason of 1–500 characters is required.')];

  const condition = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    await txRepo.executeRawSql(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.project.id}:Condition:${conditionId}`],
      { resourceTypes: ['Condition'], operation: 'write', mode: DatabaseMode.WRITER, source: 'condition.reviewLock' }
    );
    const current = await txRepo.readResource<Condition>('Condition', conditionId);
    verifyProject(current.meta?.project, ctx.project.id);
    const patientId = getId(current.subject, 'Patient');
    if (!patientId) throw new OperationOutcomeError(badRequest('Condition must reference one Patient.'));
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    await authorizePatient(txRepo, ctx, patient, practitionerId);

    const verification = current.verificationStatus?.coding?.[0]?.code;
    const clinical = current.clinicalStatus?.coding?.[0]?.code;
    let verificationStatus = current.verificationStatus;
    let clinicalStatus = current.clinicalStatus;
    let abatementDateTime = current.abatementDateTime;
    switch (params.change) {
      case 'confirm':
        if (!['provisional', 'unconfirmed', 'differential'].includes(verification ?? '')) {
          throw new OperationOutcomeError(conflict('Only provisional, unconfirmed, or differential diagnoses can be confirmed.'));
        }
        verificationStatus = { coding: [{ system: verificationSystem, code: 'confirmed' }] };
        break;
      case 'refute':
        if (['refuted', 'entered-in-error'].includes(verification ?? '')) {
          throw new OperationOutcomeError(conflict('This diagnosis is already refuted or entered in error.'));
        }
        verificationStatus = { coding: [{ system: verificationSystem, code: 'refuted' }] };
        clinicalStatus = { coding: [{ system: clinicalSystem, code: 'inactive' }] };
        break;
      case 'active':
        if (clinical !== 'inactive' || verification === 'refuted') {
          throw new OperationOutcomeError(conflict('Only an inactive, non-refuted diagnosis can be made active.'));
        }
        clinicalStatus = { coding: [{ system: clinicalSystem, code: 'active' }] };
        abatementDateTime = undefined;
        break;
      case 'inactive':
        if (clinical !== 'active') throw new OperationOutcomeError(conflict('Only an active diagnosis can be made inactive.'));
        clinicalStatus = { coding: [{ system: clinicalSystem, code: 'inactive' }] };
        break;
      case 'resolved':
        if (clinical !== 'active') throw new OperationOutcomeError(conflict('Only an active diagnosis can be resolved.'));
        clinicalStatus = { coding: [{ system: clinicalSystem, code: 'resolved' }] };
        abatementDateTime = new Date().toISOString();
        break;
    }
    const at = new Date().toISOString();
    return txRepo.updateResource<Condition>({
      ...current,
      verificationStatus,
      clinicalStatus,
      abatementDateTime,
      ...(params.change === 'active' || params.change === 'resolved' ? {
        abatementAge: undefined,
        abatementBoolean: undefined,
        abatementPeriod: undefined,
        abatementRange: undefined,
        abatementString: undefined,
      } : {}),
      note: [...(current.note ?? []), {
        time: at,
        text: `Condition ${params.change}: ${reason}`,
        authorReference: { reference: `Practitioner/${practitionerId}` },
      }],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['Condition', 'Patient', 'Practitioner'], source: 'condition.review' });
  return [allOk, buildOutputParameters(reviewOperation, { return: condition })];
}

function getPractitionerId(profileReference?: string): string {
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(profileReference ?? '')?.[1];
  if (!practitionerId) throw new OperationOutcomeError(forbidden('Diagnosis management requires an authenticated Practitioner profile.'));
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
  if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot manage diagnoses.'));
  if (!ctx.membership.admin && !patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`)) {
    throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Patient may manage diagnoses.'));
  }
}

function getId(reference: Reference | undefined, resourceType: 'Patient' | 'Encounter' | 'Condition'): string | undefined {
  return new RegExp(`^${resourceType}\\/([^/]+)$`).exec(reference?.reference ?? '')?.[1];
}

function verifyProject(resourceProject: string | undefined, projectId: string): void {
  if (resourceProject !== projectId) throw new OperationOutcomeError(forbidden('Resource belongs to another project.'));
}
