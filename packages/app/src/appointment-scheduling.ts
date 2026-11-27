import type { Appointment, Schedule, Slot } from '@medplum/fhirtypes';

const nonBlockingStatuses = new Set(['cancelled', 'entered-in-error', 'fulfilled', 'noshow']);
export const RECURRING_SLOT_SERIES_SYSTEM = 'urn:smart-hospital:recurring-slot-series';

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
  timeZone: string;
}

export interface SlotInterval {
  start: Date;
  end: Date;
}

export interface RecurringSlotSeries {
  id: string;
  slots: Slot[];
}

export function groupRecurringSlotSeries(slots: Slot[]): RecurringSlotSeries[] {
  const grouped = new Map<string, Slot[]>();
  for (const slot of slots) {
    const seriesId = slot.identifier?.find((identifier) => identifier.system === RECURRING_SLOT_SERIES_SYSTEM)?.value;
    if (!seriesId) continue;
    const seriesSlots = grouped.get(seriesId) ?? [];
    seriesSlots.push(slot);
    grouped.set(seriesId, seriesSlots);
  }
  return Array.from(grouped, ([id, seriesSlots]) => ({
    id,
    slots: seriesSlots.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '')),
  }));
}

function localDateTimeInZone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  formatter: Intl.DateTimeFormat
): Date | undefined {
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const fields = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, Number(part.value)]));
    const localAsUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute);
    const difference = target - localAsUtc;
    if (difference === 0) break;
    timestamp += difference;
  }
  const fields = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, Number(part.value)]));
  if (fields.year !== year || fields.month !== month || fields.day !== day || fields.hour !== hour || fields.minute !== minute) {
    return undefined;
  }
  return new Date(timestamp);
}

/** Expands local calendar dates/times in an explicit IANA timezone. */
export function expandRecurringSlotIntervals(input: RecurringSlotInput): SlotInterval[] {
  const { startDate, endDate, startTime, endTime, weekdays, timeZone } = input;
  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return [];
  const firstDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const lastDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const firstUtcDay = Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
  const lastUtcDay = Date.UTC(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
  const dayCount = Math.floor((lastUtcDay - firstUtcDay) / 86_400_000) + 1;
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
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return [];
  }

  const results: SlotInterval[] = [];
  const cursor = new Date(Date.UTC(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate()));
  const finalDate = new Date(Date.UTC(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate()));
  while (cursor <= finalDate) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    if (selectedWeekdays.has(cursor.getUTCDay())) {
      const start = localDateTimeInZone(year, month, day, startHour, startMinute, formatter);
      const end = localDateTimeInZone(year, month, day, endHour, endMinute, formatter);
      if (start && end && end > start) results.push({ start, end });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
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
export function removeIntervalsConflictingWithSlots(
  intervals: SlotInterval[],
  slots: Slot[],
  excludedSlotIds: ReadonlySet<string> = new Set()
): SlotInterval[] {
  const occupied = slots.flatMap((slot) => {
    if (slot.id && excludedSlotIds.has(slot.id)) return [];
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
