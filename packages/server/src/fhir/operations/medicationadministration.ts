// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Encounter, Medication, MedicationAdministration, MedicationRequest, Patient, Practitioner } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
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

/** Creates a completed administration after verifying the Patient, order, Encounter and authenticated Practitioner. */
export async function medicationAdministrationRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
  if (!practitionerId) {
    throw new OperationOutcomeError(forbidden('Only authenticated Practitioner profiles may record medication administration.'));
  }
  const params = parseInputParameters<{ resource: MedicationAdministration }>(recordOperation, req);
  const input = params.resource;
  const patientId = /^Patient\/([^/]+)$/.exec(input.subject?.reference ?? '')?.[1];
  const effectiveTime = input.effectiveDateTime ? new Date(input.effectiveDateTime).getTime() : Number.NaN;
  if (!patientId) return [badRequest('MedicationAdministration must reference a Patient subject.')];
  if (input.status !== 'completed' || !Number.isFinite(effectiveTime) || effectiveTime > Date.now()) {
    return [badRequest('Only completed medication administrations with a valid past or current time can be recorded.')];
  }
  if (!input.medicationCodeableConcept?.text && !input.medicationCodeableConcept?.coding?.length && !input.medicationReference?.reference) {
    return [badRequest('A medication code or reference is required.')];
  }

  const administration = await ctx.systemRepo.ensureInTransaction(
    async (txRepo) => {
      const patient = await txRepo.readResource<Patient>('Patient', patientId);
      if (patient.active === false) throw new OperationOutcomeError(badRequest('Cannot record medication for an inactive Patient.'));
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot record medication administration.'));

      const requestId = /^MedicationRequest\/([^/]+)$/.exec(input.request?.reference ?? '')?.[1];
      if (input.request && !requestId) throw new OperationOutcomeError(badRequest('The medication request reference is invalid.'));
      if (requestId) {
        const request = await txRepo.readResource<MedicationRequest>('MedicationRequest', requestId);
        if (request.subject?.reference !== `Patient/${patientId}`) {
          throw new OperationOutcomeError(badRequest('The linked MedicationRequest belongs to another Patient.'));
        }
      }

      const medicationId = /^Medication\/([^/]+)$/.exec(input.medicationReference?.reference ?? '')?.[1];
      if (input.medicationReference && !medicationId) {
        throw new OperationOutcomeError(badRequest('The Medication reference is invalid.'));
      }
      if (medicationId) await txRepo.readResource<Medication>('Medication', medicationId);

      const encounterId = /^Encounter\/([^/]+)$/.exec(input.context?.reference ?? '')?.[1];
      if (input.context && !encounterId) throw new OperationOutcomeError(badRequest('The Encounter reference is invalid.'));
      if (encounterId) {
        const encounter = await txRepo.readResource<Encounter>('Encounter', encounterId);
        if (encounter.subject?.reference !== `Patient/${patientId}`) {
          throw new OperationOutcomeError(badRequest('The linked Encounter belongs to another Patient.'));
        }
      }

      const saved: MedicationAdministration = {
        ...input,
        status: 'completed',
        performer: [{ actor: { reference: `Practitioner/${practitionerId}` } }],
        note: input.note?.map((note) => ({
          ...note,
          authorReference: { reference: `Practitioner/${practitionerId}` },
        })),
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
