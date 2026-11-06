// SPDX-License-Identifier: Apache-2.0
import type { Appointment, Schedule, Slot } from '@medplum/fhirtypes';
import type { Repository } from './repo';

const nonBlockingStatuses = new Set(['cancelled', 'entered-in-error', 'fulfilled', 'noshow']);

export function getAppointmentPractitionerReferences(candidate: Appointment): string[] {
  return Array.from(
    new Set(
      candidate.participant
        ?.map((participant) => participant.actor?.reference)
        .filter((reference): reference is string => reference?.startsWith('Practitioner/') ?? false)
    )
  ).sort();
}

/** Finds an active Appointment that overlaps the candidate for any assigned Practitioner. */
export async function findAppointmentConflict(
  repo: Repository,
  candidate: Appointment,
  excludeId?: string
): Promise<Appointment | undefined> {
  if (!candidate.start || !candidate.end || nonBlockingStatuses.has(candidate.status ?? '')) return undefined;
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return undefined;

  for (const actor of getAppointmentPractitionerReferences(candidate)) {
    let conflict: Appointment | undefined;
    await repo.processAllResources<Appointment>({ resourceType: 'Appointment', actor }, async (existing) => {
      if (existing.id === excludeId || !existing.start || !existing.end) return;
      if (nonBlockingStatuses.has(existing.status ?? '')) return;
      const existingStart = new Date(existing.start);
      const existingEnd = new Date(existing.end);
      if (!Number.isFinite(existingStart.getTime()) || !Number.isFinite(existingEnd.getTime())) return;
      if (existingEnd > existingStart && start < existingEnd && existingStart < end) {
        conflict = existing;
      }
    });
    if (conflict) return conflict;
  }
  return undefined;
}

/** Finds another Slot on the same Schedule that overlaps the candidate interval. */
export async function findSlotConflict(repo: Repository, candidate: Slot, excludeId?: string): Promise<Slot | undefined> {
  const scheduleReference = candidate.schedule?.reference;
  if (!scheduleReference || !candidate.start || !candidate.end || candidate.status === 'entered-in-error') {
    return undefined;
  }
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return undefined;

  const scheduleReferences = new Set([scheduleReference]);
  const scheduleMatch = /^Schedule\/([^/]+)$/.exec(scheduleReference);
  if (scheduleMatch) {
    const schedule = await repo.readResource<Schedule>('Schedule', scheduleMatch[1]);
    const practitionerReferences = schedule.actor
      ?.map((actor) => actor.reference)
      .filter((reference): reference is string => reference?.startsWith('Practitioner/') ?? false);
    for (const actor of practitionerReferences ?? []) {
      await repo.processAllResources<Schedule>({ resourceType: 'Schedule', actor }, async (relatedSchedule) => {
        if (relatedSchedule.active !== false && relatedSchedule.id) {
          scheduleReferences.add(`Schedule/${relatedSchedule.id}`);
        }
      });
    }
  }

  let conflict: Slot | undefined;
  for (const reference of scheduleReferences) {
    await repo.processAllResources<Slot>({ resourceType: 'Slot', schedule: reference }, async (existing) => {
      if (existing.id === excludeId || existing.status === 'entered-in-error' || !existing.start || !existing.end) return;
      const existingStart = new Date(existing.start);
      const existingEnd = new Date(existing.end);
      if (!Number.isFinite(existingStart.getTime()) || !Number.isFinite(existingEnd.getTime())) return;
      if (existingEnd > existingStart && start < existingEnd && existingStart < end) conflict = existing;
    });
  }
  return conflict;
}

/** Finds an active Appointment that still references the given Slot. */
export async function findAppointmentForSlot(
  repo: Repository,
  slotId: string,
  excludeAppointmentId?: string
): Promise<Appointment | undefined> {
  let match: Appointment | undefined;
  await repo.processAllResources<Appointment>({ resourceType: 'Appointment', slot: `Slot/${slotId}` }, async (appointment) => {
    if (appointment.id !== excludeAppointmentId && !nonBlockingStatuses.has(appointment.status ?? '')) {
      match = appointment;
    }
  });
  return match;
}

/** Finds an active Appointment that still depends on the Slot being bookable. */
export async function findActiveAppointmentForSlot(repo: Repository, slotId: string): Promise<Appointment | undefined> {
  let match: Appointment | undefined;
  await repo.processAllResources<Appointment>({ resourceType: 'Appointment', slot: `Slot/${slotId}` }, async (appointment) => {
    if (!nonBlockingStatuses.has(appointment.status ?? '')) match = appointment;
  });
  return match;
}

/** Finds an active Appointment overlapping a Slot for any scheduled Practitioner. */
export async function findAppointmentConflictForSlot(
  repo: Repository,
  candidate: Slot,
  practitionerReferences: string[]
): Promise<Appointment | undefined> {
  if (!candidate.start || !candidate.end) return undefined;
  const start = new Date(candidate.start);
  const end = new Date(candidate.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return undefined;

  for (const actor of Array.from(new Set(practitionerReferences)).sort()) {
    let conflict: Appointment | undefined;
    await repo.processAllResources<Appointment>({ resourceType: 'Appointment', actor }, async (appointment) => {
      if (nonBlockingStatuses.has(appointment.status ?? '') || !appointment.start || !appointment.end) return;
      const appointmentStart = new Date(appointment.start);
      const appointmentEnd = new Date(appointment.end);
      if (!Number.isFinite(appointmentStart.getTime()) || !Number.isFinite(appointmentEnd.getTime())) return;
      if (appointmentEnd > appointmentStart && start < appointmentEnd && appointmentStart < end) conflict = appointment;
    });
    if (conflict) return conflict;
  }
  return undefined;
}
