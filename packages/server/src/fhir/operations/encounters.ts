// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { allOk, badRequest, conflict, forbidden, OperationOutcomeError, parseSearchRequest } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Appointment, Encounter, Patient, Practitioner, Reference } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import type { AuthenticatedRequestContext } from '../../context';
import { DatabaseMode } from '../../database';
import type { Repository } from '../repo';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const recordOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Encounter' },
  { name: 'encounter-record', code: 'record', parameter: [
    param('in', 'patient', 'Reference', 1, '1'),
    param('in', 'start', 'dateTime', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('in', 'appointment', 'Reference', 0, '1'),
    param('in', 'noteType', 'code', 0, '1'),
    param('in', 'note', 'string', 0, '1'),
    param('out', 'return', 'Encounter', 1, '1'),
  ] }
);

const updateOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Encounter' },
  { name: 'encounter-update-details', code: 'update-details', parameter: [
    param('in', 'encounter', 'Reference', 1, '1'),
    param('in', 'start', 'dateTime', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('in', 'changeReason', 'string', 1, '1'),
    param('out', 'return', 'Encounter', 1, '1'),
  ] }
);

const noteOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Encounter' },
  { name: 'encounter-add-note', code: 'add-note', parameter: [
    param('in', 'encounter', 'Reference', 1, '1'),
    param('in', 'type', 'code', 1, '1'),
    param('in', 'text', 'string', 1, '1'),
    param('out', 'return', 'Encounter', 1, '1'),
  ] }
);

const cancelOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Encounter' },
  { name: 'encounter-cancel', code: 'cancel', parameter: [
    param('in', 'encounter', 'Reference', 1, '1'),
    param('in', 'reason', 'string', 1, '1'),
    param('out', 'return', 'Encounter', 1, '1'),
  ] }
);

const completeOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Encounter' },
  { name: 'encounter-complete', code: 'complete', parameter: [
    param('in', 'encounter', 'Reference', 1, '1'),
    param('in', 'summary', 'string', 1, '1'),
    param('out', 'return', 'Encounter', 1, '1'),
  ] }
);

interface RecordParameters { patient: Reference; start: string; reason: string; appointment?: Reference; noteType?: string; note?: string }
interface UpdateParameters { encounter: Reference; start: string; reason: string; changeReason: string }
interface NoteParameters { encounter: Reference; type: string; text: string }
interface CancelParameters { encounter: Reference; reason: string }
interface CompleteParameters { encounter: Reference; summary: string }

const encounterNoteTypes = new Set(['progress', 'assessment', 'plan', 'procedure']);

function getPractitionerId(ctx: AuthenticatedRequestContext): string | undefined {
  return /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
}

async function lockEncounter(repo: Repository, projectId: string, encounterId: string): Promise<void> {
  await repo.executeRawSql(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`${projectId}:Encounter:write:${encounterId}`],
    { resourceTypes: ['Encounter'], operation: 'write', mode: DatabaseMode.WRITER, source: 'encounter.writeLock' }
  );
}

async function authorizeEncounterWrite(repo: Repository, ctx: AuthenticatedRequestContext, encounter: Encounter): Promise<string | undefined> {
  if (encounter.meta?.project !== ctx.project.id) throw new OperationOutcomeError(forbidden('Encounter belongs to another project.'));
  const practitionerId = getPractitionerId(ctx);
  if (ctx.membership.admin) return practitionerId;
  if (!practitionerId) throw new OperationOutcomeError(forbidden('Only authenticated Practitioner staff may update an Encounter.'));
  const practitioner = await repo.readResource<Practitioner>('Practitioner', practitionerId);
  if (practitioner.meta?.project !== ctx.project.id || practitioner.active === false) {
    throw new OperationOutcomeError(forbidden('Inactive or out-of-project Practitioners cannot update an Encounter.'));
  }
  const patientId = /^Patient\/([^/]+)$/.exec(encounter.subject?.reference ?? '')?.[1];
  if (!patientId) throw new OperationOutcomeError(badRequest('Encounter must reference one Patient.'));
  const patient = await repo.readResource<Patient>('Patient', patientId);
  const assigned = patient.generalPractitioner?.some((reference) => reference.reference === `Practitioner/${practitionerId}`);
  const participant = encounter.participant?.some((item) => item.individual?.reference === `Practitioner/${practitionerId}`);
  if (patient.meta?.project !== ctx.project.id || (!assigned && !participant)) {
    throw new OperationOutcomeError(forbidden('Only the assigned or participating Practitioner may update this Encounter.'));
  }
  return practitionerId;
}

function actorReference(practitionerId: string | undefined): Reference | undefined {
  return practitionerId ? { reference: `Practitioner/${practitionerId}` } : undefined;
}

function auditNote(text: string, at: string, practitionerId: string | undefined): NonNullable<Encounter['note']>[number] {
  return {
    time: at,
    text: practitionerId ? text : `[Project Admin] ${text}`,
    authorReference: actorReference(practitionerId),
  };
}

function requiredReference(reference: Reference | undefined, resourceType: string): string | undefined {
  return new RegExp(`^${resourceType}\\/([^/]+)$`).exec(reference?.reference ?? '')?.[1];
}

/** Creates an Encounter after validating Patient assignment and any linked completed Appointment. */
export async function encounterRecordHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const params = parseInputParameters<RecordParameters>(recordOperation, req);
  const patientId = requiredReference(params.patient, 'Patient');
  const start = new Date(params.start);
  const reason = params.reason.trim();
  const note = params.note?.trim();
  const noteType = params.noteType ?? 'progress';
  const appointmentId = params.appointment ? requiredReference(params.appointment, 'Appointment') : undefined;
  if (!patientId) return [badRequest('A Patient reference is required.')];
  if (!Number.isFinite(start.getTime()) || start > new Date()) return [badRequest('Encounter start must be a valid time no later than now.')];
  if (!reason || reason.length > 200) return [badRequest('Encounter reason is required and must be 200 characters or fewer.')];
  if (note && (note.length > 4000 || !encounterNoteTypes.has(noteType))) return [badRequest('Initial note type or content is invalid.')];
  if (appointmentId === undefined && params.appointment) return [badRequest('A valid Appointment reference is required.')];

  const encounter = await ctx.repo.ensureInTransaction(async (txRepo) => {
    if (appointmentId) await lockEncounter(txRepo, ctx.project.id, `Appointment:${appointmentId}`);
    const patient = await txRepo.readResource<Patient>('Patient', patientId);
    if (patient.meta?.project !== ctx.project.id) throw new OperationOutcomeError(forbidden('Patient belongs to another project.'));
    const candidate: Encounter = {
      resourceType: 'Encounter',
      meta: { project: ctx.project.id },
      status: 'in-progress',
      class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
      subject: { reference: `Patient/${patientId}` },
      appointment: appointmentId ? [{ reference: `Appointment/${appointmentId}` }] : undefined,
      period: { start: start.toISOString() },
      reasonCode: [{ text: reason }],
      note: note ? [auditNote(`[${noteType}] ${note}`, new Date().toISOString(), getPractitionerId(ctx))] : undefined,
    };
    const practitionerId = await authorizeEncounterWrite(txRepo, ctx, candidate);
    if (appointmentId) {
      const appointment = await txRepo.readResource<Appointment>('Appointment', appointmentId);
      if (appointment.meta?.project !== ctx.project.id || appointment.status !== 'fulfilled' ||
          !appointment.participant?.some((participant) => participant.actor?.reference === `Patient/${patientId}`)) {
        throw new OperationOutcomeError(conflict('Encounter can only reference a completed Appointment for the selected Patient.'));
      }
      const linked = await txRepo.search<Encounter>(parseSearchRequest<Encounter>(
        `Encounter?appointment=Appointment/${encodeURIComponent(appointmentId)}&_count=100`
      ));
      if ((linked.entry ?? []).some((entry) => entry.resource?.meta?.project === ctx.project.id &&
          !['cancelled', 'entered-in-error'].includes(entry.resource.status ?? ''))) {
        throw new OperationOutcomeError(conflict('Appointment already has an active Encounter.'));
      }
    }
    if (practitionerId && !ctx.membership.admin) {
      candidate.participant = [{ individual: { reference: `Practitioner/${practitionerId}` } }];
    }
    return txRepo.createResource<Encounter>(candidate);
  }, { resourceTypes: ['Encounter', 'Patient', 'Practitioner', 'Appointment'], source: 'encounter.record' });
  return [allOk, buildOutputParameters(recordOperation, { return: encounter })];
}

/** Updates an open Encounter's start and reason while preserving an attributed audit trail. */
export async function encounterUpdateDetailsHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const params = parseInputParameters<UpdateParameters>(updateOperation, req);
  const encounterId = requiredReference(params.encounter, 'Encounter');
  const start = new Date(params.start);
  const reason = params.reason.trim();
  const changeReason = params.changeReason.trim();
  if (!encounterId) return [badRequest('An Encounter reference is required.')];
  if (!Number.isFinite(start.getTime()) || start > new Date()) return [badRequest('Encounter start must be a valid time no later than now.')];
  if (!reason || reason.length > 200 || !changeReason || changeReason.length > 500) {
    return [badRequest('Encounter reason and change reason are required and limited to 200 and 500 characters.')];
  }
  const encounter = await ctx.repo.ensureInTransaction(async (txRepo) => {
    await lockEncounter(txRepo, ctx.project.id, encounterId);
    const current = await txRepo.readResource<Encounter>('Encounter', encounterId);
    const practitionerId = await authorizeEncounterWrite(txRepo, ctx, current);
    if (current.status !== 'in-progress') throw new OperationOutcomeError(conflict('Only an in-progress Encounter can be updated.'));
    if (current.period?.end && start > new Date(current.period.end)) throw new OperationOutcomeError(badRequest('Encounter start cannot be after its end.'));
    const at = new Date().toISOString();
    const previousStart = current.period?.start ?? 'not recorded';
    const previousReason = current.reasonCode?.map((item) => item.text ?? item.coding?.[0]?.display).filter(Boolean).join(', ') ?? 'not recorded';
    return txRepo.updateResource<Encounter>({
      ...current,
      period: { ...current.period, start: start.toISOString() },
      reasonCode: [{ text: reason }],
      note: [...(current.note ?? []), auditNote(`[update · ${changeReason}] start ${previousStart} → ${start.toISOString()}; reason ${previousReason} → ${reason}`, at, practitionerId)],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['Encounter', 'Patient', 'Practitioner'], source: 'encounter.updateDetails' });
  return [allOk, buildOutputParameters(updateOperation, { return: encounter })];
}

/** Appends a typed clinical note to an open Encounter under the Encounter lock. */
export async function encounterAddNoteHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const params = parseInputParameters<NoteParameters>(noteOperation, req);
  const encounterId = requiredReference(params.encounter, 'Encounter');
  const type = params.type.trim();
  const text = params.text.trim();
  if (!encounterId) return [badRequest('An Encounter reference is required.')];
  if (!encounterNoteTypes.has(type) || !text || text.length > 4000) return [badRequest('Note type and content are required; content is limited to 4,000 characters.')];
  const encounter = await ctx.repo.ensureInTransaction(async (txRepo) => {
    await lockEncounter(txRepo, ctx.project.id, encounterId);
    const current = await txRepo.readResource<Encounter>('Encounter', encounterId);
    const practitionerId = await authorizeEncounterWrite(txRepo, ctx, current);
    if (current.status !== 'in-progress') throw new OperationOutcomeError(conflict('Only an in-progress Encounter can receive a note.'));
    return txRepo.updateResource<Encounter>({
      ...current,
      note: [...(current.note ?? []), auditNote(`[${type}] ${text}`, new Date().toISOString(), practitionerId)],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['Encounter', 'Patient', 'Practitioner'], source: 'encounter.addNote' });
  return [allOk, buildOutputParameters(noteOperation, { return: encounter })];
}

/** Cancels an open Encounter with an attributed reason and end time. */
export async function encounterCancelHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const params = parseInputParameters<CancelParameters>(cancelOperation, req);
  const encounterId = requiredReference(params.encounter, 'Encounter');
  const reason = params.reason.trim();
  if (!encounterId) return [badRequest('An Encounter reference is required.')];
  if (!reason || reason.length > 500) return [badRequest('Cancellation reason is required and limited to 500 characters.')];
  const encounter = await ctx.repo.ensureInTransaction(async (txRepo) => {
    await lockEncounter(txRepo, ctx.project.id, encounterId);
    const current = await txRepo.readResource<Encounter>('Encounter', encounterId);
    const practitionerId = await authorizeEncounterWrite(txRepo, ctx, current);
    if (current.status !== 'in-progress') throw new OperationOutcomeError(conflict('Only an in-progress Encounter can be cancelled.'));
    const at = new Date();
    if (current.period?.start && at < new Date(current.period.start)) throw new OperationOutcomeError(badRequest('Encounter end cannot be earlier than its start.'));
    return txRepo.updateResource<Encounter>({
      ...current,
      status: 'cancelled',
      period: { ...current.period, end: at.toISOString() },
      note: [...(current.note ?? []), auditNote(`[cancellation] ${reason}`, at.toISOString(), practitionerId)],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['Encounter', 'Patient', 'Practitioner'], source: 'encounter.cancel' });
  return [allOk, buildOutputParameters(cancelOperation, { return: encounter })];
}

/** Completes an open Encounter with a required, attributed clinical closure summary. */
export async function encounterCompleteHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const params = parseInputParameters<CompleteParameters>(completeOperation, req);
  const encounterId = requiredReference(params.encounter, 'Encounter');
  const summary = params.summary.trim();
  if (!encounterId) return [badRequest('An Encounter reference is required.')];
  if (summary.length < 10 || summary.length > 4000) return [badRequest('Closure summary must contain 10–4000 characters.')];
  const encounter = await ctx.repo.ensureInTransaction(async (txRepo) => {
    await lockEncounter(txRepo, ctx.project.id, encounterId);
    const current = await txRepo.readResource<Encounter>('Encounter', encounterId);
    if (current.status !== 'in-progress') throw new OperationOutcomeError(conflict('Only an in-progress Encounter can be completed.'));
    const practitionerId = await authorizeEncounterWrite(txRepo, ctx, current);
    const endedAt = new Date();
    if (current.period?.start && endedAt < new Date(current.period.start)) {
      throw new OperationOutcomeError(badRequest('Encounter end cannot be earlier than its start.'));
    }
    const actor = practitionerId ? `Practitioner/${practitionerId}` : 'Project Admin';
    return txRepo.updateResource<Encounter>({
      ...current,
      status: 'finished',
      period: { ...current.period, end: endedAt.toISOString() },
      note: [...(current.note ?? []), auditNote(`[completion · ${actor}] ${summary}`, endedAt.toISOString(), practitionerId)],
    }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
  }, { resourceTypes: ['Encounter', 'Patient', 'Practitioner'], source: 'encounter.complete' });
  return [allOk, buildOutputParameters(completeOperation, { return: encounter })];
}
