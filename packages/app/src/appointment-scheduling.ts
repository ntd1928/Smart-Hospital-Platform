import type { Appointment } from '@medplum/fhirtypes';

const nonBlockingStatuses = new Set(['cancelled', 'entered-in-error', 'fulfilled', 'noshow']);

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
