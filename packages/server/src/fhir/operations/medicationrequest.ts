// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { AllergyIntolerance, Encounter, MedicationRequest, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const recordOperation = makeOperationDefinition({ scope: 'type', resource: 'MedicationRequest' }, {
  name: 'medication-request-record', code: 'record', parameter: [
    param('in', 'resource', 'MedicationRequest', 1, '1'),
    param('in', 'allergy-reviewed', 'boolean', 1, '1'),
    param('out', 'return', 'MedicationRequest', 1, '1'),
  ],
});
const updateOperation = makeOperationDefinition({ scope: 'type', resource: 'MedicationRequest' }, {
  name: 'medication-request-update-status', code: 'update-status', parameter: [
    param('in', 'request', 'Reference', 1, '1'),
    param('in', 'status', 'code', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('out', 'return', 'MedicationRequest', 1, '1'),
  ],
});
const mutableStatuses = ['stopped', 'cancelled', 'completed', 'entered-in-error'] as const;
type MutableStatus = (typeof mutableStatuses)[number];

/** Records a prescription after server-side patient, allergy, and encounter review. */
export async function medicationRequestRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getStaffPractitioner(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ resource: MedicationRequest; allergyReviewed: boolean }>(recordOperation, req);
  const input = params.resource;
  const patientId = getId(input.subject, 'Patient');
  const medication = input.medicationCodeableConcept?.text?.trim() || input.medicationCodeableConcept?.coding?.[0]?.display?.trim();
  if (!patientId || !medication) return [badRequest('MedicationRequest requires a Patient subject and medication name.')];
  if (!input.dosageInstruction?.length || !input.dosageInstruction.some((dose) => dose.text?.trim())) {
    return [badRequest('At least one medication dosage instruction is required.')];
  }
  const doseValues = input.dosageInstruction.flatMap((dose) => dose.doseAndRate ?? []).map((rate) => rate.doseQuantity?.value).filter((value): value is number => value !== undefined);
  if (doseValues.some((value) => !Number.isFinite(value) || value <= 0)) return [badRequest('Dose quantities must be positive numbers.')];
  const quantity = input.dispenseRequest?.quantity?.value;
  if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) return [badRequest('Dispense quantity must be positive.')];
  const repeats = input.dispenseRequest?.numberOfRepeatsAllowed;
  if (repeats !== undefined && (!Number.isInteger(repeats) || repeats < 0)) return [badRequest('Repeat count must be a non-negative integer.')];

  const request = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    assertProject(patient.meta?.project, ctx.project.id);
    if (patient.active === false) throw new OperationOutcomeError(conflict('Cannot prescribe medication for an inactive Patient.'));
    await authorizePatient(txRepo, ctx, patient, practitionerId);

    let activeMedicationAllergies: AllergyIntolerance[] = [];
    await txRepo.processAllResources<AllergyIntolerance>(
      { resourceType: 'AllergyIntolerance', patient: `Patient/${patientId}` },
      async (allergy) => {
        if (allergy.meta?.project === ctx.project.id && allergy.patient?.reference === `Patient/${patientId}` &&
          allergy.clinicalStatus?.coding?.[0]?.code === 'active' && allergy.category?.includes('medication')) {
          activeMedicationAllergies.push(allergy);
        }
      }
    );
    if (!params.allergyReviewed) throw new OperationOutcomeError(conflict('Confirm review of the Patient allergy list before prescribing.'));

    const encounterId = getId(input.encounter, 'Encounter');
    if (input.encounter && !encounterId) throw new OperationOutcomeError(badRequest('Encounter reference is invalid.'));
    if (encounterId) {
      const encounter = await txRepo.readResource<Encounter>('Encounter', encounterId);
      assertProject(encounter.meta?.project, ctx.project.id);
      if (encounter.subject?.reference !== `Patient/${patientId}`) throw new OperationOutcomeError(badRequest('Encounter belongs to another Patient.'));
    }

    const matchingAllergies = activeMedicationAllergies.filter((allergy) => {
      const name = allergy.code?.text ?? allergy.code?.coding?.map((coding) => coding.display ?? coding.code).join(' ') ?? '';
      return name.trim().length > 0 && medication.toLocaleLowerCase().includes(name.trim().toLocaleLowerCase());
    });
    const at = new Date().toISOString();
    const notes: NonNullable<MedicationRequest['note']> = [{
      time: at,
      text: `Người kê đơn xác nhận đã rà soát danh sách dị ứng; ${activeMedicationAllergies.length} dị ứng thuốc đang hoạt động.${matchingAllergies.length
        ? ` Khớp tên dạng văn bản: ${matchingAllergies.map(getAllergyName).join(', ')}.`
        : ' Không khớp tên dạng văn bản; không loại trừ dị ứng, phản ứng chéo hoặc tương tác.'}`,
      authorReference: { reference: `Practitioner/${practitionerId}` },
    }];
    const saved: MedicationRequest = {
      ...input,
      status: 'active',
      intent: 'order',
      subject: { reference: `Patient/${patientId}` },
      requester: { reference: `Practitioner/${practitionerId}` },
      authoredOn: at,
      note: notes,
    };
    delete saved.id;
    delete saved.meta;
    return txRepo.createResource(saved);
  }, { resourceTypes: ['MedicationRequest', 'AllergyIntolerance', 'Patient', 'Practitioner', 'Encounter'], source: 'medicationrequest.record' });
  return [allOk, buildOutputParameters(recordOperation, { return: request })];
}

/** Changes prescription lifecycle state with an audit reason and serialized updates. */
export async function medicationRequestUpdateStatusHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = getStaffPractitioner(ctx.profile.reference?.reference);
  const params = parseInputParameters<{ request: Reference; status: MutableStatus; reason: string }>(updateOperation, req);
  const requestId = getId(params.request, 'MedicationRequest');
  const reason = params.reason.trim();
  if (!requestId) return [badRequest('A MedicationRequest reference is required.')];
  if (!mutableStatuses.includes(params.status)) return [badRequest('MedicationRequest status is invalid.')];
  if (!reason || reason.length > 500) return [badRequest('A reason of 1–500 characters is required.')];

  const request = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    await txRepo.executeRawSql(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.project.id}:MedicationRequest:${requestId}`],
      { resourceTypes: ['MedicationRequest'], operation: 'write', mode: DatabaseMode.WRITER, source: 'medicationrequest.statusLock' }
    );
    const current = await txRepo.readResource<MedicationRequest>('MedicationRequest', requestId);
    assertProject(current.meta?.project, ctx.project.id);
    const patientId = getId(current.subject, 'Patient');
    if (!patientId) throw new OperationOutcomeError(badRequest('MedicationRequest must reference a Patient.'));
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    assertProject(patient.meta?.project, ctx.project.id);
    await authorizePatient(txRepo, ctx, patient, practitionerId);
    if (current.status === 'entered-in-error') throw new OperationOutcomeError(conflict('MedicationRequest is already marked entered-in-error.'));
    if (params.status !== 'entered-in-error' && current.status !== 'active') {
      throw new OperationOutcomeError(conflict('Only an active MedicationRequest can be stopped, cancelled, or completed.'));
    }
    const at = new Date().toISOString();
    const description = params.status === 'entered-in-error'
      ? `Yêu cầu thuốc được đánh dấu nhập nhầm; dữ liệu kê đơn được giữ để truy vết. Lý do: ${reason}`
      : `Yêu cầu thuốc chuyển từ ${current.status} sang ${params.status}: ${reason}`;
    return txRepo.updateResource<MedicationRequest>({
      ...current,
      status: params.status,
      statusReason: { text: reason },
      note: [...(current.note ?? []), { time: at, text: description, authorReference: { reference: `Practitioner/${practitionerId}` } }],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['MedicationRequest', 'Patient', 'Practitioner'], source: 'medicationrequest.updateStatus' });
  return [allOk, buildOutputParameters(updateOperation, { return: request })];
}

function getStaffPractitioner(profileReference?: string): string {
  const id = /^Practitioner\/([^/]+)$/.exec(profileReference ?? '')?.[1];
  if (!id) throw new OperationOutcomeError(forbidden('Medication orders require an authenticated Practitioner profile.'));
  return id;
}

async function authorizePatient(
  repo: { readResource<T>(type: string, id: string): Promise<T> },
  ctx: ReturnType<typeof getAuthenticatedContext>,
  patient: Patient,
  practitionerId: string
): Promise<void> {
  const practitioner = await repo.readResource<Practitioner>('Practitioner', practitionerId);
  assertProject(practitioner.meta?.project, ctx.project.id);
  if (practitioner.active === false || patient.active === false) throw new OperationOutcomeError(forbidden('Inactive profiles cannot manage medication orders.'));
  if (!ctx.membership.admin && !patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`)) {
    throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Patient may manage medication orders.'));
  }
}

function getId(reference: Reference | undefined, resourceType: string): string | undefined {
  return new RegExp(`^${resourceType}/([^/]+)$`).exec(reference?.reference ?? '')?.[1];
}

function assertProject(resourceProject: string | undefined, projectId: string): void {
  if (resourceProject !== projectId) throw new OperationOutcomeError(forbidden('Resource belongs to another project.'));
}

function getAllergyName(allergy: AllergyIntolerance): string {
  return allergy.code?.text ?? allergy.code?.coding?.[0]?.display ?? 'Unspecified allergen';
}
