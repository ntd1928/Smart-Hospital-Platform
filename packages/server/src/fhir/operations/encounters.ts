// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Encounter, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const completeOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Encounter' },
  { name: 'encounter-complete', code: 'complete', parameter: [
    param('in', 'encounter', 'Reference', 1, '1'),
    param('in', 'summary', 'string', 1, '1'),
    param('out', 'return', 'Encounter', 1, '1'),
  ] }
);

interface CompleteParameters { encounter: Reference; summary: string }

/** Completes an open Encounter with a required, attributed clinical closure summary. */
export async function encounterCompleteHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const params = parseInputParameters<CompleteParameters>(completeOperation, req);
  const encounterId = /^Encounter\/([^/]+)$/.exec(params.encounter.reference ?? '')?.[1];
  const summary = params.summary.trim();
  if (!encounterId) return [badRequest('An Encounter reference is required.')];
  if (summary.length < 10 || summary.length > 4000) return [badRequest('Closure summary must contain 10–4000 characters.')];

  const encounter = await ctx.repo.ensureInTransaction(async (txRepo) => {
    await txRepo.executeRawSql(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`${ctx.project.id}:Encounter:complete:${encounterId}`],
      { resourceTypes: ['Encounter'], operation: 'write', mode: DatabaseMode.WRITER, source: 'encounter.completeLock' }
    );
    const current = await txRepo.readResource<Encounter>('Encounter', encounterId);
    if (current.meta?.project !== ctx.project.id) throw new OperationOutcomeError(forbidden('Encounter belongs to another project.'));
    if (current.status !== 'in-progress') throw new OperationOutcomeError(conflict('Only an in-progress Encounter can be completed.'));
    const practitionerId = /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
    if (!ctx.membership.admin) {
      if (!practitionerId) throw new OperationOutcomeError(forbidden('Only authorized Practitioner staff may complete an Encounter.'));
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.meta?.project !== ctx.project.id || practitioner.active === false) {
        throw new OperationOutcomeError(forbidden('Inactive or out-of-project Practitioners cannot complete an Encounter.'));
      }
      const patientId = /^Patient\/([^/]+)$/.exec(current.subject?.reference ?? '')?.[1];
      if (!patientId) throw new OperationOutcomeError(badRequest('Encounter must reference one Patient.'));
      const patient = await txRepo.readResource<Patient>('Patient', patientId);
      const assigned = patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`);
      const participant = current.participant?.some((item) => item.individual?.reference === `Practitioner/${practitionerId}`);
      if (!assigned && !participant) throw new OperationOutcomeError(forbidden('Only the assigned or participating Practitioner may complete this Encounter.'));
    }
    const endedAt = new Date();
    if (current.period?.start && endedAt < new Date(current.period.start)) {
      throw new OperationOutcomeError(badRequest('Encounter end cannot be earlier than its start.'));
    }
    const actor = practitionerId ? `Practitioner/${practitionerId}` : 'Project Admin';
    return txRepo.updateResource<Encounter>({
      ...current,
      status: 'finished',
      period: { ...current.period, end: endedAt.toISOString() },
      note: [...(current.note ?? []), {
        time: endedAt.toISOString(),
        text: `[completion · ${actor}] ${summary}`,
        authorReference: practitionerId ? { reference: `Practitioner/${practitionerId}` } : undefined,
      }],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['Encounter', 'Patient', 'Practitioner'], source: 'encounter.complete' });
  return [allOk, buildOutputParameters(completeOperation, { return: encounter })];
}
