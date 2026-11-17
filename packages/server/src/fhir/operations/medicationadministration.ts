// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Encounter, Medication, MedicationAdministration, MedicationRequest, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const recordOperation = makeOperationDefinition(
  { scope: 'type', resource: 'MedicationAdministration' },
  {
    name: 'medication-administration-record',
    code: 'record',
    parameter: [
      param('in', 'resource', 'MedicationAdministration', 1, '1'),
      param('out', 'return', 'MedicationAdministration', 1, '1'),
    ],
  }
);

const updateOperation = makeOperationDefinition({ scope: 'type', resource: 'MedicationAdministration' }, {
  name: 'medication-administration-update', code: 'update', parameter: [
    param('in', 'administration', 'Reference', 1, '1'),
    param('in', 'status', 'code', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('out', 'return', 'MedicationAdministration', 1, '1'),
  ],
});

/** Creates a completed administration after verifying the Patient, order, Encounter and authenticated Practitioner. */
export async function medicationAdministrationRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
  if (!practitionerId) {
    throw new OperationOutcomeError(forbidden('Only authenticated Practitioner profiles may record medication administration.'));
  }
  const params = parseInputParameters<{ resource: MedicationAdministration }>(recordOperation, req);
  const input = params.resource;
  const patientId = getId(input.subject, 'Patient');
  const effectiveTime = input.effectiveDateTime ? new Date(input.effectiveDateTime).getTime() : Number.NaN;
  if (!patientId) return [badRequest('MedicationAdministration must reference a Patient subject.')];
  if (input.status !== 'completed' || !Number.isFinite(effectiveTime) || effectiveTime > Date.now()) {
    return [badRequest('Only completed medication administrations with a valid past or current time can be recorded.')];
  }
  if (!input.medicationCodeableConcept?.text && !input.medicationCodeableConcept?.coding?.length && !input.medicationReference?.reference) {
    return [badRequest('A medication code or reference is required.')];
  }
  const dose = input.dosage?.dose?.value;
  if (dose !== undefined && (!Number.isFinite(dose) || dose <= 0)) return [badRequest('Medication dose must be a positive quantity.')];

  const administration = await ctx.systemRepo.ensureInTransaction(
    async (txRepo) => {
      const patient = await txRepo.readResource<Patient>('Patient', patientId);
      verifyProject(patient.meta?.project, ctx.project.id);
      if (patient.active === false) throw new OperationOutcomeError(badRequest('Cannot record medication for an inactive Patient.'));
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      verifyProject(practitioner.meta?.project, ctx.project.id);
      if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot record medication administration.'));
      if (!ctx.membership.admin && !patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`)) {
        throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Patient may record medication administration.'));
      }

      const requestId = getId(input.request, 'MedicationRequest');
      if (input.request && !requestId) throw new OperationOutcomeError(badRequest('The medication request reference is invalid.'));
      if (requestId) {
        const request = await txRepo.readResource<MedicationRequest>('MedicationRequest', requestId);
        verifyProject(request.meta?.project, ctx.project.id);
        if (request.subject?.reference !== `Patient/${patientId}` || request.status !== 'active') {
          throw new OperationOutcomeError(conflict('The linked MedicationRequest must be active and belong to the same Patient.'));
        }
        if (request.medicationReference?.reference && request.medicationReference.reference !== input.medicationReference?.reference) {
          throw new OperationOutcomeError(conflict('The administered Medication must match the linked MedicationRequest.'));
        }
        if (request.medicationCodeableConcept && !matchesMedication(request.medicationCodeableConcept, input.medicationCodeableConcept)) {
          throw new OperationOutcomeError(conflict('The administered medication must match the linked MedicationRequest.'));
        }
      }

      const medicationId = getId(input.medicationReference, 'Medication');
      if (input.medicationReference && !medicationId) {
        throw new OperationOutcomeError(badRequest('The Medication reference is invalid.'));
      }
      if (medicationId) {
        const medication = await txRepo.readResource<Medication>('Medication', medicationId);
        verifyProject(medication.meta?.project, ctx.project.id);
      }

      const encounterId = getId(input.context, 'Encounter');
      if (input.context && !encounterId) throw new OperationOutcomeError(badRequest('The Encounter reference is invalid.'));
      if (encounterId) {
        const encounter = await txRepo.readResource<Encounter>('Encounter', encounterId);
        verifyProject(encounter.meta?.project, ctx.project.id);
        if (encounter.subject?.reference !== `Patient/${patientId}` || !['in-progress', 'finished'].includes(encounter.status ?? '')) {
          throw new OperationOutcomeError(conflict('The linked Encounter must belong to the same Patient and be open or finished.'));
        }
      }

      const at = new Date().toISOString();
      const saved: MedicationAdministration = {
        ...input,
        status: 'completed',
        performer: [{ actor: { reference: `Practitioner/${practitionerId}` } }],
        note: [
          ...(input.note ?? []).map((note) => ({
            ...note,
            authorReference: { reference: `Practitioner/${practitionerId}` },
          })),
          { time: at, text: `MedicationAdministration recorded by Practitioner/${practitionerId}.`, authorReference: { reference: `Practitioner/${practitionerId}` } },
        ],
      };
      delete saved.id;
      delete saved.meta;
      return txRepo.createResource<MedicationAdministration>(saved);
    },
    {
      resourceTypes: ['MedicationAdministration', 'MedicationRequest', 'Medication', 'Encounter', 'Patient', 'Practitioner'],
      source: 'medicationadministration.record',
    }
  );

  return [allOk, buildOutputParameters(recordOperation, { return: administration })];
}

/** Marks an administration entered-in-error without deleting the original clinical record. */
export async function medicationAdministrationUpdateHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
  if (!practitionerId) throw new OperationOutcomeError(forbidden('Only authenticated Practitioner profiles may review medication administration.'));
  const params = parseInputParameters<{ administration: Reference; status: string; reason: string }>(updateOperation, req);
  const administrationId = getId(params.administration, 'MedicationAdministration');
  const reason = params.reason.trim();
  if (!administrationId) return [badRequest('A MedicationAdministration reference is required.')];
  if (params.status !== 'entered-in-error') return [badRequest('Only entered-in-error correction is supported.')];
  if (!reason || reason.length > 500) return [badRequest('A correction reason of 1–500 characters is required.')];

  const administration = await ctx.systemRepo.ensureInTransaction(async (txRepo) => {
    await txRepo.executeRawSql(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.project.id}:MedicationAdministration:${administrationId}`],
      { resourceTypes: ['MedicationAdministration'], operation: 'write', mode: DatabaseMode.WRITER, source: 'medicationadministration.updateLock' }
    );
    const current = await txRepo.readResource<MedicationAdministration>('MedicationAdministration', administrationId);
    verifyProject(current.meta?.project, ctx.project.id);
    if (current.status !== 'completed') throw new OperationOutcomeError(conflict('Only a completed MedicationAdministration can be corrected.'));
    const patientId = getId(current.subject, 'Patient');
    if (!patientId) throw new OperationOutcomeError(badRequest('MedicationAdministration must reference one Patient.'));
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    verifyProject(patient.meta?.project, ctx.project.id);
    const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
    verifyProject(practitioner.meta?.project, ctx.project.id);
    if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot review medication administration.'));
    if (!ctx.membership.admin && !patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`)) {
      throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Patient may review medication administration.'));
    }
    const at = new Date().toISOString();
    return txRepo.updateResource<MedicationAdministration>({
      ...current,
      status: 'entered-in-error',
      note: [...(current.note ?? []), {
        time: at,
        text: `MedicationAdministration marked entered-in-error; original data retained. Reason: ${reason}`,
        authorReference: { reference: `Practitioner/${practitionerId}` },
      }],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['MedicationAdministration', 'Patient', 'Practitioner'], source: 'medicationadministration.update' });
  return [allOk, buildOutputParameters(updateOperation, { return: administration })];
}

function getId(reference: Reference | undefined, resourceType: 'Patient' | 'MedicationRequest' | 'Medication' | 'Encounter' | 'MedicationAdministration'): string | undefined {
  return new RegExp(`^${resourceType}\\/([^/]+)$`).exec(reference?.reference ?? '')?.[1];
}

function verifyProject(resourceProject: string | undefined, projectId: string): void {
  if (resourceProject !== projectId) throw new OperationOutcomeError(forbidden('Resource belongs to another project.'));
}

function matchesMedication(
  ordered: MedicationAdministration['medicationCodeableConcept'],
  administered: MedicationAdministration['medicationCodeableConcept']
): boolean {
  if (!administered) return false;
  const orderedCodes = ordered?.coding?.filter((coding) => coding.code).map((coding) => `${coding.system ?? ''}|${coding.code}`) ?? [];
  const administeredCodes = administered.coding?.filter((coding) => coding.code).map((coding) => `${coding.system ?? ''}|${coding.code}`) ?? [];
  if (orderedCodes.length && administeredCodes.length) return orderedCodes.some((code) => administeredCodes.includes(code));
  const orderedText = ordered?.text?.trim().toLocaleLowerCase();
  const administeredText = administered.text?.trim().toLocaleLowerCase();
  return Boolean(orderedText && administeredText && orderedText === administeredText);
}
