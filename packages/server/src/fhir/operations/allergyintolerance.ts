// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { AllergyIntolerance, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const recordOperation = makeOperationDefinition({ scope: 'type', resource: 'AllergyIntolerance' }, {
  name: 'allergy-intolerance-record', code: 'record', parameter: [
    param('in', 'resource', 'AllergyIntolerance', 1, '1'),
    param('out', 'return', 'AllergyIntolerance', 1, '1'),
  ],
});
const reviewOperation = makeOperationDefinition({ scope: 'type', resource: 'AllergyIntolerance' }, {
  name: 'allergy-intolerance-review', code: 'review', parameter: [
    param('in', 'allergy', 'Reference', 1, '1'),
    param('in', 'status', 'code', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('out', 'return', 'AllergyIntolerance', 1, '1'),
  ],
});

const reviewStatuses = ['confirmed', 'refuted', 'inactive', 'resolved'] as const;
type ReviewStatus = (typeof reviewStatuses)[number];

/** Records an attributed AllergyIntolerance for an assigned Patient. */
export async function allergyIntoleranceRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getPractitionerId(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ resource: AllergyIntolerance }>(recordOperation, req);
  const input = params.resource;
  const patientId = getId(input.patient, 'Patient');
  const allergen = input.code?.text?.trim() || input.code?.coding?.[0]?.display?.trim();
  if (!patientId || !allergen) return [badRequest('AllergyIntolerance requires a Patient and an allergen.')];
  if (!input.category?.length || input.category.some((category) => !['food', 'medication', 'environment', 'biologic'].includes(category))) {
    return [badRequest('Allergy category must be food, medication, environment, or biologic.')];
  }
  const verification = input.verificationStatus?.coding?.[0]?.code;
  if (verification !== 'confirmed' && verification !== 'unconfirmed') return [badRequest('New allergy verification must be confirmed or unconfirmed.')];
  const onset = input.onsetDateTime ? new Date(input.onsetDateTime).getTime() : undefined;
  if (onset !== undefined && !Number.isFinite(onset)) return [badRequest('Allergy onset date is invalid.')];

  const allergy = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    if (patient.active === false) throw new OperationOutcomeError(conflict('Cannot record an allergy for an inactive Patient.'));
    await authorizePatient(txRepo, ctx, patient, practitionerId);
    const at = new Date().toISOString();
    const saved: AllergyIntolerance = {
      ...input,
      patient: { reference: `Patient/${patientId}` },
      recorder: { reference: `Practitioner/${practitionerId}` },
      recordedDate: at,
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: verification }] },
      note: [{
        time: at,
        text: `Dị ứng được ghi nhận bởi Practitioner/${practitionerId} với trạng thái xác minh ${verification}.`,
        authorReference: { reference: `Practitioner/${practitionerId}` },
      }],
    };
    delete saved.id;
    delete saved.meta;
    return txRepo.createResource(saved);
  }, { resourceTypes: ['AllergyIntolerance', 'Patient', 'Practitioner'], source: 'allergyintolerance.record' });
  return [allOk, buildOutputParameters(recordOperation, { return: allergy })];
}

/** Reviews verification or clinical status with a reason, per-resource lock, and actor audit. */
export async function allergyIntoleranceReviewHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getPractitionerId(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ allergy: Reference; status: ReviewStatus; reason: string }>(reviewOperation, req);
  const allergyId = getId(params.allergy, 'AllergyIntolerance');
  const reason = params.reason.trim();
  if (!allergyId) return [badRequest('An AllergyIntolerance reference is required.')];
  if (!reviewStatuses.includes(params.status)) return [badRequest('Allergy review status is invalid.')];
  if (!reason || reason.length > 500) return [badRequest('A review reason of 1–500 characters is required.')];

  const allergy = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    await txRepo.executeRawSql(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.project.id}:AllergyIntolerance:${allergyId}`],
      { resourceTypes: ['AllergyIntolerance'], operation: 'write', mode: DatabaseMode.WRITER, source: 'allergyintolerance.reviewLock' }
    );
    const current = await txRepo.readResource<AllergyIntolerance>('AllergyIntolerance', allergyId);
    verifyProject(current.meta?.project, ctx.project.id);
    const patientId = getId(current.patient, 'Patient');
    if (!patientId) throw new OperationOutcomeError(badRequest('AllergyIntolerance must reference one Patient.'));
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    if (patient.active === false) throw new OperationOutcomeError(conflict('Cannot review allergies for an inactive Patient.'));
    await authorizePatient(txRepo, ctx, patient, practitionerId);

    let verificationStatus = current.verificationStatus;
    let clinicalStatus = current.clinicalStatus;
    if (params.status === 'confirmed' || params.status === 'refuted') {
      if (current.verificationStatus?.coding?.[0]?.code !== 'unconfirmed') {
        throw new OperationOutcomeError(conflict('Only an unconfirmed allergy can be confirmed or refuted.'));
      }
      verificationStatus = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: params.status }] };
      if (params.status === 'refuted') {
        clinicalStatus = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'inactive' }] };
      }
    } else {
      if (current.clinicalStatus?.coding?.[0]?.code !== 'active') {
        throw new OperationOutcomeError(conflict('Only an active allergy can be resolved or made inactive.'));
      }
      clinicalStatus = { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: params.status }] };
    }
    const at = new Date().toISOString();
    return txRepo.updateResource<AllergyIntolerance>({
      ...current,
      verificationStatus,
      clinicalStatus,
      note: [...(current.note ?? []), {
        time: at,
        text: `AllergyIntolerance review ${params.status}: ${reason}`,
        authorReference: { reference: `Practitioner/${practitionerId}` },
      }],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['AllergyIntolerance', 'Patient', 'Practitioner'], source: 'allergyintolerance.review' });
  return [allOk, buildOutputParameters(reviewOperation, { return: allergy })];
}

function getPractitionerId(profileReference?: string): string {
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(profileReference ?? '')?.[1];
  if (!practitionerId) throw new OperationOutcomeError(forbidden('Allergy management requires an authenticated Practitioner profile.'));
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
  if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot manage allergies.'));
  if (!ctx.membership.admin && !patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`)) {
    throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Patient may manage allergies.'));
  }
}

function getId(reference: Reference | undefined, resourceType: 'Patient' | 'AllergyIntolerance'): string | undefined {
  return new RegExp(`^${resourceType}\/([^/]+)$`).exec(reference?.reference ?? '')?.[1];
}

function verifyProject(resourceProject: string | undefined, projectId: string): void {
  if (resourceProject !== projectId) throw new OperationOutcomeError(forbidden('Resource belongs to another project.'));
}
