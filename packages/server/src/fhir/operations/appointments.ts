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
import type { Appointment, Bundle, Encounter, HealthcareService, Organization, Patient, Practitioner, PractitionerRole, Reference, Schedule, Slot } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { DatabaseMode } from '../../database';
import { findActiveAppointmentForSlot, findAppointmentConflict } from '../appointment-conflicts';
import type { SystemRepository } from '../repo';
import { makeOperationDefinition } from './definitions';
import { buildOutputParameters, makeOperationDefinitionParameter as param, parseInputParameters } from './utils/parameters';

const availableOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-available',
    code: 'available',
    parameter: [param('in', 'service', 'Reference', 0, '1'), param('out', 'return', 'Bundle', 1, '1')],
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
      param('in', 'service', 'Reference', 0, '1'),
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

const checkInOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-check-in',
    code: 'check-in',
    parameter: [
      param('in', 'appointment', 'Reference', 1, '1'),
      param('in', 'note', 'string', 0, '1'),
      param('out', 'return', 'Appointment', 1, '1'),
    ],
  }
);

const startEncounterOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-start-encounter',
    code: 'start-encounter',
    parameter: [
      param('in', 'appointment', 'Reference', 1, '1'),
      param('out', 'return', 'Encounter', 1, '1'),
    ],
  }
);

const waitlistOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-waitlist',
    code: 'waitlist',
    parameter: [
      param('in', 'service', 'Reference', 1, '1'),
      param('in', 'description', 'string', 0, '1'),
      param('out', 'return', 'Appointment', 1, '1'),
    ],
  }
);

const offerWaitlistOperation = makeOperationDefinition(
  { scope: 'type', resource: 'Appointment' },
  {
    name: 'appointment-offer-waitlist',
    code: 'offer-waitlist',
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
  service?: Reference;
}

interface AvailabilityParameters {
  service?: Reference;
}

interface CancelParameters {
  appointment: Reference;
}

interface RescheduleParameters {
  appointment: Reference;
  slot: Reference;
}

interface CheckInParameters {
  appointment: Reference;
  note?: string;
}

interface StartEncounterParameters {
  appointment: Reference;
}

interface WaitlistParameters {
  service: Reference;
  description?: string;
}

interface OfferWaitlistParameters {
  appointment: Reference;
  slot: Reference;
}

/** Creates one Patient waitlist Appointment per active HealthcareService. */
export async function appointmentWaitlistHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const patientId = getPatientId();
  const params = parseInputParameters<WaitlistParameters>(waitlistOperation, req);
  const serviceId = getHealthcareServiceId(params.service);
  if (!serviceId) return [badRequest('A HealthcareService reference is required.')];
  const description = params.description?.trim();
  if (description && description.length > 200) return [badRequest('Description must be 200 characters or fewer.')];

  const appointment = await ctx.systemRepo.ensureInTransaction(
    async (txRepo) => {
      await txRepo.executeRawSql(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${ctx.project.id}:Appointment:waitlist:${patientId}:${serviceId}`],
        { resourceTypes: 'Appointment', operation: 'write', mode: DatabaseMode.WRITER, source: 'appointment.waitlistLock' }
      );
      const patient = await txRepo.readResource<Patient>('Patient', patientId);
      if (patient.active === false) throw new OperationOutcomeError(forbidden('Inactive Patients cannot join a waitlist.'));
      const service = await txRepo.readResource<HealthcareService>('HealthcareService', serviceId);
      if (service.meta?.project !== ctx.project.id || service.active === false || !(await hasActiveProviderForService(txRepo, service, ctx.project.id))) {
        throw new OperationOutcomeError(conflict('The selected HealthcareService is not accepting waitlist requests.'));
      }
      const existing = await txRepo.search<Appointment>(parseSearchRequest<Appointment>(
        `Appointment?actor=Patient/${encodeURIComponent(patientId)}&status=waitlist&_count=100`
      ));
      const duplicate = (existing.entry ?? []).map((entry) => entry.resource).find((resource) =>
        resource?.meta?.project === ctx.project.id &&
        resource.participant?.some((participant) => participant.actor?.reference === `HealthcareService/${serviceId}`)
      );
      if (duplicate) return duplicate as Appointment;
      const serviceType = service.type?.length ? service.type : [{ text: service.name }];
      return txRepo.createResource<Appointment>({
        resourceType: 'Appointment',
        meta: { project: ctx.project.id },
        status: 'waitlist',
        description: description || undefined,
        serviceType,
        participant: [
          { actor: { reference: `Patient/${patientId}` }, status: 'accepted' },
          { actor: { reference: `HealthcareService/${serviceId}` }, status: 'accepted' },
        ],
      });
    },
    { resourceTypes: ['Appointment', 'HealthcareService', 'PractitionerRole', 'Practitioner', 'Organization', 'Patient'], source: 'appointment.waitlist' }
  );
  return [allOk, buildOutputParameters(waitlistOperation, { return: appointment })];
}

/** Assigns a waiting Patient to a free Slot in their selected service atomically. */
export async function appointmentOfferWaitlistHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const staffPractitionerId = /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
  if (!staffPractitionerId) throw new OperationOutcomeError(forbidden('Only authenticated Practitioner staff may assign waitlist appointments.'));
  const params = parseInputParameters<OfferWaitlistParameters>(offerWaitlistOperation, req);
  const appointmentId = /^Appointment\/([^/]+)$/.exec(params.appointment.reference ?? '')?.[1];
  const slotId = /^Slot\/([^/]+)$/.exec(params.slot.reference ?? '')?.[1];
  if (!appointmentId || !slotId) return [badRequest('Appointment and Slot references are required.')];
  const staffPractitioner = await ctx.systemRepo.readResource<Practitioner>('Practitioner', staffPractitionerId);
  if (staffPractitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot assign appointments.'));

  const appointment = await ctx.repo.ensureInTransaction(
    async (txRepo) => {
      const current = await txRepo.readResource<Appointment>('Appointment', appointmentId);
      if (current.meta?.project !== ctx.project.id) throw new OperationOutcomeError(forbidden('Waitlist Appointment belongs to another project.'));
      if (current.status !== 'waitlist') throw new OperationOutcomeError(conflict('The Appointment is no longer waiting.'));
      const patientParticipant = current.participant?.find((participant) => participant.actor?.reference?.startsWith('Patient/'));
      const serviceId = current.participant?.map((participant) => getHealthcareServiceId(participant.actor)).find(Boolean);
      if (!patientParticipant?.actor || !serviceId) throw new OperationOutcomeError(badRequest('Waitlist Appointment must reference a Patient and HealthcareService.'));
      const slot = await txRepo.readResource<Slot>('Slot', slotId);
      if (slot.meta?.project !== ctx.project.id || slot.status !== 'free' || !isFutureInterval(slot)) throw new OperationOutcomeError(conflict('The selected Slot is no longer available.'));
      const scheduleId = /^Schedule\/([^/]+)$/.exec(slot.schedule?.reference ?? '')?.[1];
      if (!scheduleId) throw new OperationOutcomeError(badRequest('The Slot is not attached to a valid Schedule.'));
      const schedule = await txRepo.readResource<Schedule>('Schedule', scheduleId);
      if (schedule.meta?.project !== ctx.project.id || schedule.active === false) throw new OperationOutcomeError(conflict('The Schedule is no longer active.'));
      const practitionerRefs = schedule.actor?.map((actor) => actor.reference)
        .filter((reference): reference is string => /^Practitioner\/[^/]+$/.test(reference ?? ''));
      if (practitionerRefs?.length !== 1) throw new OperationOutcomeError(badRequest('The Schedule must have exactly one Practitioner.'));
      const practitionerId = practitionerRefs[0].slice('Practitioner/'.length);
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.meta?.project !== ctx.project.id || practitioner.active === false || !(await isAssignedToService(txRepo, practitionerId, serviceId, ctx.project.id))) {
        throw new OperationOutcomeError(conflict('The selected Practitioner is not available for this HealthcareService.'));
      }
      if (await findActiveAppointmentForSlot(txRepo, slotId)) throw new OperationOutcomeError(conflict('The Slot is already assigned.'));
      const updated: Appointment = {
        ...current,
        status: 'booked',
        start: slot.start,
        end: slot.end,
        slot: [{ reference: `Slot/${slotId}` }],
        participant: [
          { ...patientParticipant, status: 'accepted' },
          ...(current.participant ?? []).filter((participant) => getHealthcareServiceId(participant.actor) === serviceId),
          { actor: { reference: `Practitioner/${practitionerId}` }, status: 'accepted' },
        ],
        note: [...(current.note ?? []), {
          time: new Date().toISOString(),
          authorReference: { reference: `Practitioner/${staffPractitionerId}` },
          text: 'Yêu cầu chờ đã được ghép với khung giờ trống.',
        }],
      };
      const conflictAppointment = await findAppointmentConflict(txRepo, updated, current.id);
      if (conflictAppointment) throw new OperationOutcomeError(conflict('The Practitioner has an overlapping Appointment.'));
      await txRepo.updateResource({ ...slot, status: 'busy' });
      return txRepo.updateResource<Appointment>(updated, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
    },
    { resourceTypes: ['Appointment', 'Slot', 'Schedule', 'Practitioner', 'PractitionerRole', 'HealthcareService', 'Organization'], source: 'appointment.offerWaitlist' }
  );
  return [allOk, buildOutputParameters(offerWaitlistOperation, { return: appointment })];
}

/** Marks an upcoming appointment as arrived and records the authenticated staff member. */
export async function appointmentCheckInHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
  if (!practitionerId) throw new OperationOutcomeError(forbidden('Only authenticated Practitioner staff may check in appointments.'));
  const params = parseInputParameters<CheckInParameters>(checkInOperation, req);
  const appointmentId = /^Appointment\/([^/]+)$/.exec(params.appointment.reference ?? '')?.[1];
  if (!appointmentId) return [badRequest('An Appointment reference is required.')];
  const note = params.note?.trim();
  if (note && note.length > 500) return [badRequest('Check-in note must be 500 characters or fewer.')];
  const practitioner = await ctx.systemRepo.readResource<Practitioner>('Practitioner', practitionerId);
  if (practitioner.active === false) throw new OperationOutcomeError(forbidden('Inactive Practitioners cannot check in appointments.'));

  const appointment = await ctx.repo.ensureInTransaction(
    async (txRepo) => {
      const current = await txRepo.readResource<Appointment>('Appointment', appointmentId);
      if (current.status === 'arrived') return current;
      if (!['booked', 'pending', 'waitlist'].includes(current.status ?? '')) {
        throw new OperationOutcomeError(conflict('Only scheduled appointments can be checked in.'));
      }
      const start = current.start ? new Date(current.start).getTime() : Number.NaN;
      const end = current.end ? new Date(current.end).getTime() : start + 60 * 60 * 1000;
      const now = Date.now();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || now < start - 4 * 60 * 60 * 1000 || now > end) {
        throw new OperationOutcomeError(conflict('Check-in is available from four hours before the appointment until it ends.'));
      }
      const checkInNote = {
        time: new Date(now).toISOString(),
        authorReference: { reference: `Practitioner/${practitionerId}` },
        text: `Bệnh nhân đã đến${note ? `: ${note}` : '.'}`,
      };
      return txRepo.updateResource<Appointment>({
        ...current,
        status: 'arrived',
        note: [...(current.note ?? []), checkInNote],
      }, current.meta?.versionId ? { ifMatch: current.meta.versionId } : undefined);
    },
    { resourceTypes: ['Appointment', 'Practitioner'], source: 'appointment.checkIn' }
  );
  return [allOk, buildOutputParameters(checkInOperation, { return: appointment })];
}

/** Starts an Encounter for an arrived or fulfilled Appointment, avoiding duplicate links. */
export async function appointmentStartEncounterHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const practitionerId = /^Practitioner\/([^/]+)$/.exec(ctx.profile.reference ?? '')?.[1];
  if (!practitionerId) throw new OperationOutcomeError(forbidden('Only authenticated Practitioner staff may start an Encounter.'));
  const params = parseInputParameters<StartEncounterParameters>(startEncounterOperation, req);
  const appointmentId = /^Appointment\/([^/]+)$/.exec(params.appointment.reference ?? '')?.[1];
  if (!appointmentId) return [badRequest('An Appointment reference is required.')];

  const encounter = await ctx.repo.ensureInTransaction(
    async (txRepo) => {
      await txRepo.executeRawSql(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${ctx.project.id}:Encounter:Appointment:${appointmentId}`],
        { resourceTypes: ['Appointment', 'Encounter'], operation: 'write', mode: DatabaseMode.WRITER, source: 'appointment.startEncounterLock' }
      );
      const appointment = await txRepo.readResource<Appointment>('Appointment', appointmentId);
      if (appointment.meta?.project !== ctx.project.id) throw new OperationOutcomeError(forbidden('Appointment belongs to another project.'));
      if (!['arrived', 'fulfilled'].includes(appointment.status ?? '')) {
        throw new OperationOutcomeError(conflict('Check in the Patient before starting an Encounter.'));
      }
      const patientReferences = [...new Set((appointment.participant ?? [])
        .map((participant) => participant.actor?.reference)
        .filter((reference): reference is string => /^Patient\/[^/]+$/.test(reference ?? '')))];
      if (patientReferences.length !== 1) throw new OperationOutcomeError(badRequest('Appointment must reference exactly one Patient.'));
      const patient = await txRepo.readResource<Patient>('Patient', patientReferences[0].slice('Patient/'.length));
      if (patient.meta?.project !== ctx.project.id) throw new OperationOutcomeError(forbidden('Patient belongs to another project.'));
      const staff = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (staff.meta?.project !== ctx.project.id || staff.active === false) {
        throw new OperationOutcomeError(forbidden('Inactive or out-of-project Practitioners cannot start an Encounter.'));
      }
      if (!ctx.membership.admin && !(appointment.participant ?? []).some((participant) => participant.actor?.reference === `Practitioner/${practitionerId}`)) {
        throw new OperationOutcomeError(forbidden('Only the Practitioner assigned to this Appointment may start its Encounter.'));
      }

      const linked = await txRepo.search<Encounter>(parseSearchRequest<Encounter>(
        `Encounter?appointment=Appointment/${encodeURIComponent(appointmentId)}&_count=100`
      ));
      const existing = (linked.entry ?? []).map((entry) => entry.resource).find((resource) =>
        resource?.meta?.project === ctx.project.id &&
        resource.status !== 'cancelled' &&
        resource.status !== 'entered-in-error'
      );
      if (existing) return existing as Encounter;

      const now = new Date().toISOString();
      return txRepo.createResource<Encounter>({
        resourceType: 'Encounter',
        meta: { project: ctx.project.id },
        status: 'in-progress',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
        subject: { reference: patientReferences[0] },
        appointment: [{ reference: `Appointment/${appointmentId}` }],
        participant: [{ individual: { reference: `Practitioner/${practitionerId}` } }],
        period: { start: now },
        reasonCode: [{ text: appointment.description?.trim() || appointment.serviceType?.map((item) => item.text ?? item.coding?.[0]?.display).filter(Boolean).join(', ') || 'Khám theo lịch hẹn' }],
      });
    },
    { resourceTypes: ['Appointment', 'Encounter', 'Patient', 'Practitioner'], source: 'appointment.startEncounter' }
  );
  return [allOk, buildOutputParameters(startEncounterOperation, { return: encounter })];
}

/** Returns a bounded list of public availability and minimal provider identity for Patient booking. */
export async function appointmentAvailableHandler(req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const patientId = getPatientId();
  const params = parseInputParameters<AvailabilityParameters>(availableOperation, req);
  const selectedServiceId = getHealthcareServiceId(params.service);
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const search = parseSearchRequest<Slot>(
    `Slot?status=free&start=ge${encodeURIComponent(now.toISOString())}&start=lt${encodeURIComponent(horizon.toISOString())}&_sort=start&_count=500`
  );
  const matches = await ctx.systemRepo.search<Slot>(search);
  const slots = (matches.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is Slot => resource?.resourceType === 'Slot' && resource.meta?.project === ctx.project.id);
  const schedules = new Map<string, Schedule>();
  const practitioners = new Map<string, Practitioner>();
  const entries: NonNullable<Bundle['entry']> = [];
  const included = new Set<string>();
  const roleByPractitioner = new Map<string, PractitionerRole[]>();
  const serviceById = new Map<string, HealthcareService>();
  const publicServiceIds = new Set<string>();
  const roles: PractitionerRole[] = [];
  await ctx.systemRepo.processAllResources<PractitionerRole>(
    { resourceType: 'PractitionerRole', active: 'true' },
    async (role) => { roles.push(role); }
  );
  for (const role of roles) {
    if (role.meta?.project !== ctx.project.id) continue;
    const practitionerId = /^Practitioner\/([^/]+)$/.exec(role.practitioner?.reference ?? '')?.[1];
    if (!practitionerId || role.active === false) continue;
    const current = roleByPractitioner.get(practitionerId) ?? [];
    current.push(role);
    roleByPractitioner.set(practitionerId, current);
    for (const reference of role.healthcareService ?? []) {
      const serviceId = getHealthcareServiceId(reference);
      if (serviceId && !serviceById.has(serviceId)) {
        const service = await ctx.systemRepo.readResource<HealthcareService>('HealthcareService', serviceId).catch((error) => {
          if (isNotFound(normalizeOperationOutcome(error))) return undefined;
          throw error;
        });
        if (service && service.active !== false && service.meta?.project === ctx.project.id) serviceById.set(serviceId, service);
      }
    }
  }
  for (const [serviceId, service] of serviceById) {
    const departmentId = /^Organization\/([^/]+)$/.exec(service.providedBy?.reference ?? '')?.[1];
    if (!departmentId) continue;
    const department = await ctx.systemRepo.readResource<Organization>('Organization', departmentId).catch((error) => {
      if (isNotFound(normalizeOperationOutcome(error))) return undefined;
      throw error;
    });
    if (!department || department.active === false || department.meta?.project !== ctx.project.id) continue;
    const assignedRoles = roles.filter((role) =>
      role.organization?.reference === service.providedBy?.reference &&
      role.healthcareService?.some((reference) => getHealthcareServiceId(reference) === serviceId)
    );
    let hasActiveProvider = false;
    for (const role of assignedRoles) {
      const practitionerId = /^Practitioner\/([^/]+)$/.exec(role.practitioner?.reference ?? '')?.[1];
      if (!practitionerId) continue;
      const practitioner = await ctx.systemRepo.readResource<Practitioner>('Practitioner', practitionerId).catch((error) => {
        if (isNotFound(normalizeOperationOutcome(error))) return undefined;
        throw error;
      });
      if (practitioner && practitioner.active !== false && practitioner.meta?.project === ctx.project.id) hasActiveProvider = true;
    }
    if (hasActiveProvider) {
      publicServiceIds.add(serviceId);
      entries.push({ resource: toPublicHealthcareService(service) });
    }
  }

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
      if (!schedule || schedule.meta?.project !== ctx.project.id) continue;
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
      if (!practitioner || practitioner.meta?.project !== ctx.project.id) continue;
      practitioners.set(practitionerId, practitioner);
    }
    if (practitioner.active === false) continue;
    const serviceRoles = roleByPractitioner.get(practitionerId) ?? [];
    const assignedServiceIds = new Set(
      serviceRoles.flatMap((role) => (role.healthcareService ?? [])
        .map(getHealthcareServiceId)
        .filter((id): id is string => id !== undefined && publicServiceIds.has(id) && serviceById.get(id)?.providedBy?.reference === role.organization?.reference))
    );
    if (selectedServiceId && (!publicServiceIds.has(selectedServiceId) || !assignedServiceIds.has(selectedServiceId))) continue;

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
    if (appointment?.meta?.project !== ctx.project.id) continue;
    const practitionerId = appointment?.participant
      ?.map((participant) => /^Practitioner\/([^/]+)$/.exec(participant.actor?.reference ?? '')?.[1])
      .find((id): id is string => Boolean(id));
    if (!practitionerId || included.has(`Practitioner/${practitionerId}`)) continue;
    const practitioner = await ctx.systemRepo.readResource<Practitioner>('Practitioner', practitionerId).catch((error) => {
      if (isNotFound(normalizeOperationOutcome(error))) return undefined;
      throw error;
    });
    if (!practitioner || practitioner.meta?.project !== ctx.project.id) continue;
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
  const serviceId = getHealthcareServiceId(params.service);
  if (params.service && !serviceId) return [badRequest('A HealthcareService reference is required.')];
  if (description && description.length > 200) return [badRequest('Appointment description must be 200 characters or fewer.')];

  const appointment = await ctx.systemRepo.ensureInTransaction(
    async (txRepo) => {
      const slot = await txRepo.readResource<Slot>('Slot', slotId);
      if (slot.meta?.project !== ctx.project.id || slot.status !== 'free' || !isFutureInterval(slot)) {
        throw new OperationOutcomeError(conflict('The selected Slot is no longer available.'));
      }
      const scheduleId = /^Schedule\/([^/]+)$/.exec(slot.schedule?.reference ?? '')?.[1];
      if (!scheduleId) throw new OperationOutcomeError(badRequest('The Slot is not attached to a valid Schedule.'));
      const schedule = await txRepo.readResource<Schedule>('Schedule', scheduleId);
      if (schedule.meta?.project !== ctx.project.id || schedule.active === false) throw new OperationOutcomeError(conflict('The Schedule is no longer active.'));
      const practitionerRefs = schedule.actor
        ?.map((actor) => actor.reference)
        .filter((reference): reference is string => /^Practitioner\/[^/]+$/.test(reference ?? ''));
      if (practitionerRefs?.length !== 1) {
        throw new OperationOutcomeError(badRequest('The Schedule must have exactly one Practitioner.'));
      }
      const practitionerId = practitionerRefs[0].slice('Practitioner/'.length);
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.meta?.project !== ctx.project.id || practitioner.active === false) throw new OperationOutcomeError(conflict('The Practitioner is not active.'));
      let healthcareService: HealthcareService | undefined;
      if (serviceId && !(await isAssignedToService(txRepo, practitionerId, serviceId, ctx.project.id))) {
        throw new OperationOutcomeError(conflict('The Practitioner is not assigned to the selected HealthcareService.'));
      }
      if (serviceId) healthcareService = await txRepo.readResource<HealthcareService>('HealthcareService', serviceId);
      if (await findActiveAppointmentForSlot(txRepo, slotId)) {
        throw new OperationOutcomeError(conflict('An active Appointment already references this Slot.'));
      }

      const serviceType = healthcareService?.type?.length
        ? healthcareService.type
        : healthcareService
          ? [{ text: healthcareService.name }]
          : undefined;
      const newAppointment: Appointment = {
        resourceType: 'Appointment',
        meta: { project: ctx.project.id },
        status: 'booked',
        description: description || undefined,
        serviceType,
        start: slot.start,
        end: slot.end,
        slot: [{ reference: `Slot/${slotId}` }],
        participant: [
          { actor: { reference: `Patient/${patientId}` }, status: 'accepted' },
          { actor: { reference: `Practitioner/${practitionerId}` }, status: 'accepted' },
          ...(serviceId ? [{ actor: { reference: `HealthcareService/${serviceId}` }, status: 'accepted' as const }] : []),
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
      const unscheduledWaitlist = current.status === 'waitlist' && !current.start && !current.slot?.length;
      const start = current.start ? new Date(current.start).getTime() : Number.NaN;
      if (!cancellable || (!unscheduledWaitlist && (!Number.isFinite(start) || start <= Date.now()))) {
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
      if (newSlot.meta?.project !== ctx.project.id || newSlot.status !== 'free' || !isFutureInterval(newSlot)) {
        throw new OperationOutcomeError(conflict('The selected Slot is no longer available.'));
      }
      const scheduleId = /^Schedule\/([^/]+)$/.exec(newSlot.schedule?.reference ?? '')?.[1];
      if (!scheduleId) throw new OperationOutcomeError(badRequest('The Slot is not attached to a valid Schedule.'));
      const schedule = await txRepo.readResource<Schedule>('Schedule', scheduleId);
      if (schedule.meta?.project !== ctx.project.id || schedule.active === false) throw new OperationOutcomeError(conflict('The Schedule is no longer active.'));
      const practitionerRefs = schedule.actor
        ?.map((actor) => actor.reference)
        .filter((reference): reference is string => /^Practitioner\/[^/]+$/.test(reference ?? ''));
      if (practitionerRefs?.length !== 1) {
        throw new OperationOutcomeError(badRequest('The Schedule must have exactly one Practitioner.'));
      }
      const practitionerId = practitionerRefs[0].slice('Practitioner/'.length);
      const practitioner = await txRepo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.meta?.project !== ctx.project.id || practitioner.active === false) throw new OperationOutcomeError(conflict('The Practitioner is not active.'));
      const serviceId = current.participant?.map((participant) => getHealthcareServiceId(participant.actor)).find(Boolean);
      if (serviceId && !(await isAssignedToService(txRepo, practitionerId, serviceId, ctx.project.id))) {
        throw new OperationOutcomeError(conflict('The selected Practitioner is not assigned to this Appointment service.'));
      }
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

function getHealthcareServiceId(reference?: Reference): string | undefined {
  return /^HealthcareService\/([^/]+)$/.exec(reference?.reference ?? '')?.[1];
}

function toPublicHealthcareService(service: HealthcareService): HealthcareService {
  return {
    resourceType: 'HealthcareService',
    id: service.id,
    active: true,
    name: service.name,
    type: service.type,
    specialty: service.specialty,
  };
}

async function isAssignedToService(repo: SystemRepository, practitionerId: string, serviceId: string, projectId: string): Promise<boolean> {
  const service = await repo.readResource<HealthcareService>('HealthcareService', serviceId);
  if (service.active === false || service.meta?.project !== projectId) return false;
  const departmentId = /^Organization\/([^/]+)$/.exec(service.providedBy?.reference ?? '')?.[1];
  if (!departmentId) return false;
  const department = await repo.readResource<Organization>('Organization', departmentId);
  if (department.active === false || department.meta?.project !== projectId) return false;
  let assigned = false;
  await repo.processAllResources<PractitionerRole>(
    { resourceType: 'PractitionerRole', practitioner: `Practitioner/${practitionerId}`, active: 'true' },
    async (role) => {
      if (
        role.active !== false &&
        role.meta?.project === projectId &&
        role.organization?.reference === service.providedBy?.reference &&
        role.healthcareService?.some((reference) => getHealthcareServiceId(reference) === serviceId)
      ) {
        const practitioner = await repo.readResource<Practitioner>('Practitioner', practitionerId);
        if (practitioner.active !== false && practitioner.meta?.project === projectId) assigned = true;
      }
    }
  );
  return assigned;
}

async function hasActiveProviderForService(repo: SystemRepository, service: HealthcareService, projectId: string): Promise<boolean> {
  if (service.meta?.project !== projectId) return false;
  const departmentId = /^Organization\/([^/]+)$/.exec(service.providedBy?.reference ?? '')?.[1];
  if (!departmentId) return false;
  const department = await repo.readResource<Organization>('Organization', departmentId);
  if (department.active === false || department.meta?.project !== projectId) return false;
  let hasProvider = false;
  await repo.processAllResources<PractitionerRole>(
    { resourceType: 'PractitionerRole', active: 'true' },
    async (role) => {
      if (
        hasProvider || role.meta?.project !== projectId || role.active === false || role.organization?.reference !== service.providedBy?.reference ||
        !role.healthcareService?.some((reference) => getHealthcareServiceId(reference) === service.id)
      ) return;
      const practitionerId = /^Practitioner\/([^/]+)$/.exec(role.practitioner?.reference ?? '')?.[1];
      if (!practitionerId) return;
      const practitioner = await repo.readResource<Practitioner>('Practitioner', practitionerId);
      if (practitioner.active !== false && practitioner.meta?.project === projectId) hasProvider = true;
    }
  );
  return hasProvider;
}
