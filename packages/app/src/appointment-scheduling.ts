import type { Appointment, Schedule, Slot } from '@medplum/fhirtypes';

const nonBlockingStatuses = new Set(['cancelled', 'entered-in-error', 'fulfilled', 'noshow']);

export interface AvailableSlot {
  slot: Slot;
  practitionerReference: string;
}

export interface RecurringSlotInput {
  startDate: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
  weekdays: number[];
}

export interface SlotInterval {
  start: Date;
  end: Date;
}

/** Expands a local time range into dated intervals for selected weekdays. */
export function expandRecurringSlotIntervals(input: RecurringSlotInput): SlotInterval[] {
  const { startDate, endDate, startTime, endTime, weekdays } = input;
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return [];
  const firstDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const lastDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const dayCount = Math.floor((lastDate.getTime() - firstDate.getTime()) / 86_400_000) + 1;
  if (dayCount < 1 || dayCount > 366) return [];
  const startTimeMatch = /^(\d{2}):(\d{2})$/.exec(startTime);
  const endTimeMatch = /^(\d{2}):(\d{2})$/.exec(endTime);
  if (!startTimeMatch || !endTimeMatch || weekdays.length === 0) return [];

  const startHour = Number(startTimeMatch[1]);
  const startMinute = Number(startTimeMatch[2]);
  const endHour = Number(endTimeMatch[1]);
  const endMinute = Number(endTimeMatch[2]);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return [];
  const selectedWeekdays = new Set(weekdays.filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6));
  if (selectedWeekdays.size === 0) return [];

  const results: SlotInterval[] = [];
  const cursor = new Date(firstDate);
  while (cursor <= lastDate) {
    if (selectedWeekdays.has(cursor.getDay())) {
      const start = new Date(cursor);
      start.setHours(startHour, startMinute, 0, 0);
      const end = new Date(cursor);
      end.setHours(endHour, endMinute, 0, 0);
      if (end > start) results.push({ start, end });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return results;
}

/** Keeps the first interval and drops any later intervals that overlap it. */
export function removeOverlappingIntervals(intervals: SlotInterval[]): SlotInterval[] {
  const ordered = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: SlotInterval[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const interval of ordered) {
    const start = interval.start.getTime();
    const end = interval.end.getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < previousEnd) continue;
    result.push(interval);
    previousEnd = end;
  }
  return result;
}

/** Drops generated intervals that overlap an existing non-invalid Slot. */
export function removeIntervalsConflictingWithSlots(intervals: SlotInterval[], slots: Slot[]): SlotInterval[] {
  const occupied = slots.flatMap((slot) => {
    if (slot.status === 'entered-in-error' || !slot.start || !slot.end) return [];
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    return Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end > start ? [{ start, end }] : [];
  });
  return intervals.filter(({ start, end }) => {
    const intervalStart = start.getTime();
    const intervalEnd = end.getTime();
    if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd) || intervalEnd <= intervalStart) return false;
    return !occupied.some((existing) => intervalStart < existing.end.getTime() && existing.start.getTime() < intervalEnd);
  });
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
    const practitionerResourceId = practitionerReference?.slice('Practitioner/'.length);
    if (
      !practitionerResourceId ||
      practitionerResourceId.includes('/') ||
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
