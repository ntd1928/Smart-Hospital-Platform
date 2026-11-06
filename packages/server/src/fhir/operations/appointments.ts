// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import {
  allOk,
  badRequest,
  conflict,
  forbidden,
  isNotFound,
  normalizeOperationOutcome,
  OperationOutcomeError,
  parseSearchRequest,
} from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Appointment, Bundle, Practitioner, Reference, Schedule, Slot } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { findActiveAppointmentForSlot, findAppointmentConflict } from '../appointment-conflicts';
import type { SystemRepository } from '../repo';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const availableOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-available',
    code: 'available',
    parameter: [param('out', 'return', 'Bundle', 1, '1')],
  }
);

const bookOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-book',
    code: 'book',
    parameter: [
      param('in', 'slot', 'Reference', 1, '1'),
      param('in', 'description', 'string', 0, '1'),
      param('out', 'return', 'Appointment', 1, '1'),
    ],
  }
);

const cancelOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-cancel',
    code: 'cancel',
    parameter: [
      param('in', 'appointment', 'Reference', 1, '1'),
      param('out', 'return', 'Appointment', 1, '1'),
    ],
  }
);

const rescheduleOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-reschedule',
    code: 'reschedule',
    parameter: [
      param('in', 'appointment', 'Reference', 1, '1'),
      param('in', 'slot', 'Reference', 1, '1'),
      param('out', 'return', 'Appointment', 1, '1'),
    ],
  }
);

interface BookParameters {
  slot: Reference;
  description?: string;
}

interface CancelParameters {
  appointment: Reference;
}

interface RescheduleParameters {
  appointment: Reference;
  slot: Reference;
}

/** Returns a bounded list of public availability and minimal provider identity for Patient booking. */
export async function appointmentAvailableHandler(_req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const patientId = getPatientId();
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const search = parseSearchRequest<Slot>(
    `Slot?status=free&start=ge${encodeURIComponent(now.toISOString())}&start=lt${encodeURIComponent(horizon.toISOString())}&_sort=start&_count=500`
  );
  const matches = await ctx.systemRepo.search<Slot>(search);
  const slots = (matches.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is Slot => resource?.resourceType === 'Slot');
  const schedules = new Map<string, Schedule>();
  const practitioners = new Map<string, Practitioner>();
  const entries: NonNullable<Bundle['entry']> = [];
  const included = new Set<string>();

  for (const slot of slots) {
    if (!slot.id || !isFutureInterval(slot)) continue;
    const scheduleId = /^Schedule\/([^/]+)$/.exec(slot.schedule?.reference ?? '')?.[1];
    if (!scheduleId) continue;
    let schedule = schedules.get(scheduleId);
    if (!schedule) {
      schedule = await ctx.systemRepo.readResource<Schedule>('Schedule', scheduleId).catch((error) => {
        if (isNotFound(normalizeOperationOutcome(error))) return undefined;
        throw error;
      });
      if (!schedule) continue;
      schedules.set(scheduleId, schedule);
    }
    if (schedule.active === false) continue;
    const practitionerRefs = schedule.actor
      ?.map((actor) => actor.reference)
      .filter((reference): reference is string => /^Practitioner\/[^/]+$/.test(reference ?? ''));
    if (practitionerRefs?.length !== 1) continue;
    const practitionerId = practitionerRefs[0].slice('Practitioner/'.length);
    let practitioner = practitioners.get(practitionerId);
    if (!practitioner) {
      practitioner = await ctx.systemRepo.readResource<Practitioner>('Practitioner', practitionerId).catch((error) => {
        if (isNotFound(normalizeOperationOutcome(error))) return undefined;
        throw error;
      });
      if (!practitioner) continue;
      practitioners.set(practitionerId, practitioner);
    }
    if (practitioner.active === false) continue;

    entries.push({
      resource: {
        resourceType: 'Slot',
        id: slot.id,
        status: 'free',
        start: slot.start,
        end: slot.end,
        schedule: { reference: `Schedule/${scheduleId}` },
      },
    });
    const scheduleKey = `Schedule/${scheduleId}`;
    if (!included.has(scheduleKey)) {
      included.add(scheduleKey);
      entries.push({
        resource: { resourceType: 'Schedule', id: scheduleId, actor: [{ reference: `Practitioner/${practitionerId}` }] },
      });
    }
    const practitionerKey = `Practitioner/${practitionerId}`;
    if (!included.has(practitionerKey)) {
      included.add(practitionerKey);
      entries.push({ resource: toPublicPractitioner(practitioner) });
    }
  }

  const patientAppointments = await ctx.systemRepo.search<Appointment>(
    parseSearchRequest<Appointment>(`Appointment?actor=Patient/${encodeURIComponent(patientId)}&_sort=-date&_count=100`)
  );
  for (const entry of patientAppointments.entry ?? []) {
    const appointment = entry.resource;
    const practitionerId = appointment?.participant
      ?.map((participant) => /^Practitioner\/([^/]+)$/.exec(participant.actor?.reference ?? '')?.[1])
      .find((id): id is string => Boolean(id));
    if (!practitionerId || included.has(`Practitioner/${practitionerId}`)) continue;
    const practitioner = await ctx.systemRepo.readResource<Practitioner>('Practitioner', practitionerId).catch((error) => {
      if (isNotFound(normalizeOperationOutcome(error))) return undefined;
      throw error;
    });
    if (!practitioner) continue;
    included.add(`Practitioner/${practitionerId}`);
    entries.push({ resource: toPublicPractitioner(practitioner) });
  }

  const bundle: Bundle = { resourceType: 'Bundle', type: 'collection', entry: entries };
  return [allOk, buildOutputParameters(availableOperation, { return: bundle })];
}

/** Books one currently free Slot for the authenticated Patient in a guarded FHIR transaction. */
export async function appointmentBookHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const patientId = getPatientId();
  const params = parseInputParameters<BookParameters>(bookOperation, req);
  const slotId = /^Slot\/([^/]+)$/.exec(params.slot.reference ?? '')?.[1];
  if (!slotId) return [badRequest('A Slot reference is required.')];
  const description = params.description?.trim();
  if (description && description.length > 200) return [badRequest('Appointment description must be 200 characters or fewer.')];

  const appointment = await ctx.systemRepo.ensureInTransaction(
    async (txRepo) => {
      const slot = await txRepo.readResource<Slot>('Slot', slotId);
      if (slot.status !== 'free' || !isFutureInterval(slot)) {
        throw new OperationOutcomeError(conflict('The selected Slot is no longer available.'));
      }
      const scheduleId = /^Schedule\/([^/]+)$/.exec(slot.schedule?.reference ?? '')?.[1];
      if (!scheduleId) throw new OperationOutcomeError(badRequest('The Slot is not attached to a valid Schedule.'));
      const schedule = await txRepo.readResource<Schedule>('Schedule', scheduleId);
      if (schedule.active === false) throw new OperationOutcomeError(conflict('The Schedule is no longer active.'));
      const practitionerRefs = schedule.actor
        ?.map((actor) => actor.reference)
        .filter((reference): reference is string => /^Practitioner\/[^/]+$/.test(reference ?? ''));
      if (practitionerRefs?.length !== 1) {
        throw new OperationOutcomeError(badRequest('The Schedule must have exactly one Practitioner.'));
      }
      const practitionerId = practitionerRefs[0].slice('Practitioner/'.length);
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.active === false) throw new OperationOutcomeError(conflict('The Practitioner is not active.'));
      if (await findActiveAppointmentForSlot(txRepo, slotId)) {
        throw new OperationOutcomeError(conflict('An active Appointment already references this Slot.'));
      }

      const newAppointment: Appointment = {
        resourceType: 'Appointment',
        status: 'booked',
        description: description || undefined,
        start: slot.start,
        end: slot.end,
        slot: [{ reference: `Slot/${slotId}` }],
        participant: [
          { actor: { reference: `Patient/${patientId}` }, status: 'accepted' },
          { actor: { reference: `Practitioner/${practitionerId}` }, status: 'accepted' },
        ],
      };
      const conflictAppointment = await findAppointmentConflict(txRepo, newAppointment);
      if (conflictAppointment) throw new OperationOutcomeError(conflict('The Practitioner has an overlapping Appointment.'));

      await txRepo.updateResource({ ...slot, status: 'busy' });
      return txRepo.createResource<Appointment>(newAppointment);
    },
    { resourceTypes: ['Appointment', 'Slot', 'Schedule', 'Practitioner'], source: 'appointment.book' }
  );

  return [allOk, buildOutputParameters(bookOperation, { return: appointment })];
}

/** Cancels the Patient's own future Appointment and releases its Slot atomically. */
export async function appointmentCancelHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const patientId = getPatientId();
  const params = parseInputParameters<CancelParameters>(cancelOperation, req);
  const appointmentId = /^Appointment\/([^/]+)$/.exec(params.appointment.reference ?? '')?.[1];
  if (!appointmentId) return [badRequest('An Appointment reference is required.')];

  const appointment = await ctx.systemRepo.ensureInTransaction(
    async (txRepo) => {
      const current = await txRepo.readResource<Appointment>('Appointment', appointmentId);
      const belongsToPatient = current.participant?.some(
        (participant) => participant.actor?.reference === `Patient/${patientId}`
      );
      if (!belongsToPatient) throw new OperationOutcomeError(forbidden('Patients may only cancel their own Appointments.'));
      const cancellable = ['proposed', 'pending', 'booked', 'waitlist'].includes(current.status ?? '');
      const start = current.start ? new Date(current.start).getTime() : Number.NaN;
      if (!cancellable || !Number.isFinite(start) || start <= Date.now()) {
        throw new OperationOutcomeError(badRequest('Only future scheduled Appointments can be cancelled.'));
      }

      const updated = await txRepo.updateResource<Appointment>({ ...current, status: 'cancelled' });
      const slotIds = new Set(
        current.slot
          ?.map((slot) => /^Slot\/([^/]+)$/.exec(slot.reference ?? '')?.[1])
          .filter((id): id is string => Boolean(id)) ?? []
      );
      for (const slotId of slotIds) await releaseSlotIfSchedulable(txRepo, slotId);
      return updated;
    },
    { resourceTypes: ['Appointment', 'Slot', 'Schedule', 'Practitioner'], source: 'appointment.patientCancel' }
  );

  return [allOk, buildOutputParameters(cancelOperation, { return: appointment })];
}

/** Moves the Patient's own future Appointment to a free Slot and releases the old Slot atomically. */
export async function appointmentRescheduleHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const patientId = getPatientId();
  const params = parseInputParameters<RescheduleParameters>(rescheduleOperation, req);
  const appointmentId = /^Appointment\/([^/]+)$/.exec(params.appointment.reference ?? '')?.[1];
  const newSlotId = /^Slot\/([^/]+)$/.exec(params.slot.reference ?? '')?.[1];
  if (!appointmentId || !newSlotId) return [badRequest('Appointment and Slot references are required.')];

  const appointment = await ctx.systemRepo.ensureInTransaction(
    async (txRepo) => {
      const current = await txRepo.readResource<Appointment>('Appointment', appointmentId);
      const belongsToPatient = current.participant?.some(
        (participant) => participant.actor?.reference === `Patient/${patientId}`
      );
      if (!belongsToPatient) throw new OperationOutcomeError(forbidden('Patients may only reschedule their own Appointments.'));
      if (!['proposed', 'pending', 'booked', 'waitlist'].includes(current.status ?? '')) {
        throw new OperationOutcomeError(badRequest('Only future scheduled Appointments can be rescheduled.'));
      }
      const currentStart = current.start ? new Date(current.start).getTime() : Number.NaN;
      if (!Number.isFinite(currentStart) || currentStart <= Date.now()) {
        throw new OperationOutcomeError(badRequest('Only future scheduled Appointments can be rescheduled.'));
      }
      const oldSlotIds = current.slot
        ?.map((slot) => /^Slot\/([^/]+)$/.exec(slot.reference ?? '')?.[1])
        .filter((id): id is string => Boolean(id)) ?? [];
      if (oldSlotIds.length !== 1) {
        throw new OperationOutcomeError(badRequest('Only Appointments linked to one Slot can be rescheduled.'));
      }
      if (oldSlotIds[0] === newSlotId) throw new OperationOutcomeError(badRequest('Choose a different Slot.'));

      const newSlot = await txRepo.readResource<Slot>('Slot', newSlotId);
      if (newSlot.status !== 'free' || !isFutureInterval(newSlot)) {
        throw new OperationOutcomeError(conflict('The selected Slot is no longer available.'));
      }
      const scheduleId = /^Schedule\/([^/]+)$/.exec(newSlot.schedule?.reference ?? '')?.[1];
      if (!scheduleId) throw new OperationOutcomeError(badRequest('The Slot is not attached to a valid Schedule.'));
      const schedule = await txRepo.readResource<Schedule>('Schedule', scheduleId);
      if (schedule.active === false) throw new OperationOutcomeError(conflict('The Schedule is no longer active.'));
      const practitionerRefs = schedule.actor
        ?.map((actor) => actor.reference)
        .filter((reference): reference is string => /^Practitioner\/[^/]+$/.test(reference ?? ''));
      if (practitionerRefs?.length !== 1) {
        throw new OperationOutcomeError(badRequest('The Schedule must have exactly one Practitioner.'));
      }
      const practitionerId = practitionerRefs[0].slice('Practitioner/'.length);
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.active === false) throw new OperationOutcomeError(conflict('The Practitioner is not active.'));
      if (await findActiveAppointmentForSlot(txRepo, newSlotId)) {
        throw new OperationOutcomeError(conflict('An active Appointment already references this Slot.'));
      }

      const updated: Appointment = {
        ...current,
        start: newSlot.start,
        end: newSlot.end,
        slot: [{ reference: `Slot/${newSlotId}` }],
        participant: [
          ...(current.participant ?? []).filter(
            (participant) => !participant.actor?.reference?.startsWith('Practitioner/')
          ),
          { actor: { reference: `Practitioner/${practitionerId}` }, status: 'accepted' },
        ],
      };
      const conflictAppointment = await findAppointmentConflict(txRepo, updated, current.id);
      if (conflictAppointment) throw new OperationOutcomeError(conflict('The Practitioner has an overlapping Appointment.'));

      await txRepo.updateResource({ ...newSlot, status: 'busy' });
      const saved = await txRepo.updateResource<Appointment>(updated);
      await releaseSlotIfSchedulable(txRepo, oldSlotIds[0]);
      return saved;
    },
    { resourceTypes: ['Appointment', 'Slot', 'Schedule', 'Practitioner'], source: 'appointment.patientReschedule' }
  );

  return [allOk, buildOutputParameters(rescheduleOperation, { return: appointment })];
}

function getPatientId(): string {
  const reference = getAuthenticatedContext().profile.reference ?? '';
  const patientId = /^Patient\/([^/]+)$/.exec(reference)?.[1];
  if (!patientId) throw new OperationOutcomeError(forbidden('This operation is only available to Patient profiles.'));
  return patientId;
}

function isFutureInterval(slot: Slot): boolean {
  if (!slot.start || !slot.end) return false;
  const start = new Date(slot.start).getTime();
  const end = new Date(slot.end).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start > Date.now() && end > start;
}

async function releaseSlotIfSchedulable(repo: SystemRepository, slotId: string): Promise<void> {
  const slot = await repo.readResource<Slot>('Slot', slotId);
  if (slot.status !== 'busy') return;
  const scheduleId = /^Schedule\/([^/]+)$/.exec(slot.schedule?.reference ?? '')?.[1];
  if (!scheduleId) return;
  const schedule = await repo.readResource<Schedule>('Schedule', scheduleId).catch((error) => {
    if (isNotFound(normalizeOperationOutcome(error))) return undefined;
    throw error;
  });
  if (!schedule || schedule.active === false) return;
  const practitionerIds =
    schedule.actor
      ?.map((actor) => /^Practitioner\/([^/]+)$/.exec(actor.reference ?? '')?.[1])
      .filter((id): id is string => Boolean(id)) ?? [];
  if (practitionerIds.length === 0) return;
  for (const practitionerId of practitionerIds) {
    const practitioner = await repo.readResource<Practitioner>('Practitioner', practitionerId).catch((error) => {
      if (isNotFound(normalizeOperationOutcome(error))) return undefined;
      throw error;
    });
    if (!practitioner || practitioner.active === false) return;
  }
  await repo.updateResource({ ...slot, status: 'free' });
}

function toPublicPractitioner(practitioner: Practitioner): Practitioner {
  return {
    resourceType: 'Practitioner',
    id: practitioner.id,
    active: practitioner.active,
    name: practitioner.name,
  };
}
