// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Encounter, MedicationRequest, MedicationStatement, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const recordOperation = makeOperationDefinition({ scope: 'type', resource: 'MedicationStatement' }, {
  name: 'medication-statement-record', code: 'record', parameter: [
    param('in', 'resource', 'MedicationStatement', 1, '1'),
    param('in', 'source', 'code', 1, '1'),
    param('out', 'return', 'MedicationStatement', 1, '1'),
  ],
});
const updateOperation = makeOperationDefinition({ scope: 'type', resource: 'MedicationStatement' }, {
  name: 'medication-statement-update-status', code: 'update-status', parameter: [
    param('in', 'statement', 'Reference', 1, '1'),
    param('in', 'status', 'code', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('out', 'return', 'MedicationStatement', 1, '1'),
  ],
});

const validStatuses = ['active', 'completed', 'stopped', 'on-hold', 'not-taken'] as const;
type StatementStatus = (typeof validStatuses)[number];

/** Creates a reconciled medication record after validating patient and linked resources. */
export async function medicationStatementRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = requireStaff(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ resource: MedicationStatement; source: 'patient' | 'practitioner' }>(recordOperation, req);
  const input = params.resource;
  const patientId = getResourceId(input.subject, 'Patient');
  const medication = input.medicationCodeableConcept?.text?.trim() || input.medicationCodeableConcept?.coding?.[0]?.display?.trim();
  if (!patientId || !medication) return [badRequest('MedicationStatement requires a Patient subject and medication name.')];
  if (!validStatuses.includes(input.status as StatementStatus)) return [badRequest('MedicationStatement status is invalid.')];
  const assertedStart = input.effectiveDateTime ? new Date(input.effectiveDateTime).getTime() : undefined;
  if (assertedStart !== undefined && !Number.isFinite(assertedStart)) return [badRequest('Medication effective date is invalid.')];
  const doseValue = input.dosage?.flatMap((dose) => dose.doseAndRate ?? []).flatMap((rate) => rate.doseQuantity?.value ?? []);
  if (doseValue?.some((value) => !Number.isFinite(value) || value <= 0)) return [badRequest('Medication dose quantities must be positive numbers.')];
  if (!['patient', 'practitioner'].includes(params.source)) return [badRequest('Information source must be patient or practitioner.')];
  if (params.source === 'practitioner' && !practitionerId) throw new OperationOutcomeError(forbidden('Practitioner confirmation requires an authenticated Practitioner.'));

  const statement = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    if (patient.active === false) throw new OperationOutcomeError(conflict('Cannot reconcile medications for an inactive Patient.'));
    await authorizePatient(txRepo, ctx, patient, practitionerId);

    const encounterId = getResourceId(input.context, 'Encounter');
    if (input.context && !encounterId) throw new OperationOutcomeError(badRequest('Encounter reference is invalid.'));
    if (encounterId) {
      const encounter = await txRepo.readResource<Encounter>('Encounter', encounterId);
      verifyProject(encounter.meta?.project, ctx.project.id);
      if (encounter.subject?.reference !== `Patient/${patientId}`) throw new OperationOutcomeError(badRequest('Encounter belongs to another Patient.'));
    }
    const requestIds = (input.basedOn ?? []).map((reference) => getResourceId(reference, 'MedicationRequest'));
    if (requestIds.some((id) => !id)) throw new OperationOutcomeError(badRequest('MedicationRequest reference is invalid.'));
    for (const requestId of requestIds as string[]) {
      const request = await txRepo.readResource<MedicationRequest>('MedicationRequest', requestId);
      verifyProject(request.meta?.project, ctx.project.id);
      if (request.subject?.reference !== `Patient/${patientId}`) throw new OperationOutcomeError(badRequest('MedicationRequest belongs to another Patient.'));
      if (request.status === 'entered-in-error') throw new OperationOutcomeError(conflict('Cannot reconcile against a MedicationRequest marked entered-in-error.'));
    }

    const now = new Date().toISOString();
    const saved: MedicationStatement = {
      ...input,
      subject: { reference: `Patient/${patientId}` },
      informationSource: params.source === 'patient'
        ? { reference: `Patient/${patientId}` }
        : { reference: `Practitioner/${practitionerId}` },
      dateAsserted: now,
      note: [...(input.note ?? []), {
        time: now,
        text: `Đối soát thuốc được ghi nhận bởi ${practitionerId ? `Practitioner/${practitionerId}` : 'Project Admin'}.`,
        authorReference: practitionerId ? { reference: `Practitioner/${practitionerId}` } : undefined,
      }],
    };
    delete saved.id;
    delete saved.meta;
    return txRepo.createResource(saved);
  }, { resourceTypes: ['MedicationStatement', 'Patient', 'Practitioner', 'Encounter', 'MedicationRequest'], source: 'medicationstatement.record' });
  return [allOk, buildOutputParameters(recordOperation, { return: statement })];
}

/** Updates reconciliation status with a required audit reason and server-attributed author. */
export async function medicationStatementUpdateStatusHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = requireStaff(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ statement: Reference; status: StatementStatus; reason: string }>(updateOperation, req);
  const statementId = getResourceId(params.statement, 'MedicationStatement');
  const reason = params.reason.trim();
  if (!statementId) return [badRequest('A MedicationStatement reference is required.')];
  if (!validStatuses.includes(params.status)) return [badRequest('MedicationStatement status is invalid.')];
  if (!reason || reason.length > 500) return [badRequest('A reason of 1–500 characters is required.')];

  const statement = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    await txRepo.executeRawSql(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.project.id}:MedicationStatement:${statementId}`],
      { resourceTypes: ['MedicationStatement'], operation: 'write', mode: DatabaseMode.WRITER, source: 'medicationstatement.statusLock' }
    );
    const current = await txRepo.readResource<MedicationStatement>('MedicationStatement', statementId);
    verifyProject(current.meta?.project, ctx.project.id);
    const patientId = getResourceId(current.subject, 'Patient');
    if (!patientId) throw new OperationOutcomeError(badRequest('MedicationStatement must reference one Patient.'));
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    if (patient.active === false) throw new OperationOutcomeError(conflict('Cannot reconcile medications for an inactive Patient.'));
    await authorizePatient(txRepo, ctx, patient, practitionerId);
    if (current.status === 'entered-in-error') throw new OperationOutcomeError(conflict('MedicationStatement is marked entered-in-error.'));
    const now = new Date().toISOString();
    return txRepo.updateResource<MedicationStatement>({
      ...current,
      status: params.status,
      statusReason: [{ text: reason }],
      note: [...(current.note ?? []), {
        time: now,
        text: `MedicationStatement chuyển từ ${current.status} sang ${params.status}: ${reason}`,
        authorReference: practitionerId ? { reference: `Practitioner/${practitionerId}` } : undefined,
      }],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['MedicationStatement', 'Patient', 'Practitioner'], source: 'medicationstatement.updateStatus' });
  return [allOk, buildOutputParameters(updateOperation, { return: statement })];
}

function requireStaff(profileReference?: string): string | undefined {
  const ctx = getAuthenticatedContext();
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(profileReference ?? '')?.[1];
  if (!ctx.membership.admin && !practitionerId) throw new OperationOutcomeError(forbidden('Only authenticated staff may reconcile medications.'));
  return practitionerId;
}

async function authorizePatient(repo: { readResource<T>(type: string, id: string): Promise<T> }, ctx: ReturnType<typeof getAuthenticatedContext>, patient: Patient, practitionerId?: string): Promise<void> {
  const practitioner = practitionerId ? await repo.readResource<Practitioner>('Practitioner', practitionerId) : undefined;
  if (practitioner) {
    verifyProject(practitioner.meta?.project, ctx.project.id);
    if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot reconcile medications.'));
  }
  if (ctx.membership.admin) return;
  if (!practitionerId || !practitioner) throw new OperationOutcomeError(forbidden('An authenticated Practitioner is required.'));
  if (patient.active === false) throw new OperationOutcomeError(forbidden('Inactive Patients cannot reconcile medications.'));
  if (!patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`)) {
    throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Patient may reconcile medications.'));
  }
}

function getResourceId(reference: Reference | undefined, resourceType: string): string | undefined {
  return new RegExp(`^${resourceType}/([^/]+)$`).exec(reference?.reference ?? '')?.[1];
}

function verifyProject(resourceProject: string | undefined, projectId: string): void {
  if (resourceProject !== projectId) throw new OperationOutcomeError(forbidden('Resource belongs to another project.'));
}
