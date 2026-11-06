// SPDX-License-Identifier: Apache-2.0
import type { Appointment } from '@medplum/fhirtypes';
import type { Repository } from './repo';

const nonBlockingStatuses = new Set(['cancelled', 'entered-in-error', 'fulfilled', 'noshow']);

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

  const practitionerReferences = new Set(
    candidate.participant
      ?.map((participant) => participant.actor?.reference)
      .filter((reference): reference is string => reference?.startsWith('Practitioner/') ?? false)
  );
  for (const actor of practitionerReferences) {
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
