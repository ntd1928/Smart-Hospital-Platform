import type { Appointment, Schedule, Slot } from '@medplum/fhirtypes';

const nonBlockingStatuses = new Set(['cancelled', 'entered-in-error', 'fulfilled', 'noshow']);

export interface AvailableSlot {
  slot: Slot;
  practitionerReference: string;
}

export function findAvailableSlots(slots: Slot[], schedules: Schedule[], practitionerId?: string): AvailableSlot[] {
  const schedulesByReference = new Map(schedules.map((schedule) => [`Schedule/${schedule.id}`, schedule]));
  return slots.flatMap((slot) => {
    if (slot.status !== 'free' || !slot.start || !slot.end) return [];
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start <= new Date() || end <= start) {
      return [];
    }
    const schedule = schedulesByReference.get(slot.schedule?.reference ?? '');
    if (!schedule || schedule.active === false) return [];
    const practitionerReference = schedule.actor?.find((actor) => actor.reference?.startsWith('Practitioner/'))
      ?.reference;
    if (
      !practitionerReference ||
      !practitionerReference.slice('Practitioner/'.length) ||
      (practitionerId && practitionerReference !== `Practitioner/${practitionerId}`)
    ) {
      return [];
    }
    return [{ slot, practitionerReference }];
  });
}

/** Finds an overlapping active appointment for the selected practitioner. */
export function findAppointmentConflict(
  appointments: Appointment[],
  practitionerId: string,
  start: Date,
  end: Date
): Appointment | undefined {
  const practitionerReference = `Practitioner/${practitionerId}`;
  return appointments.find((appointment) => {
    if (!appointment.start || !appointment.end || nonBlockingStatuses.has(appointment.status ?? '')) return false;
    const hasPractitioner = appointment.participant?.some(
      (participant) => participant.actor?.reference === practitionerReference
    );
    if (!hasPractitioner) return false;
    const existingStart = new Date(appointment.start);
    const existingEnd = new Date(appointment.end);
    if (
      !Number.isFinite(existingStart.getTime()) ||
      !Number.isFinite(existingEnd.getTime()) ||
      existingEnd <= existingStart
    ) {
      return false;
    }
    return start < existingEnd && existingStart < end;
  });
}
