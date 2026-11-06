import { Operator, createReference } from '@medplum/core';
import type { Appointment, Patient, Practitioner, Project, ProjectMembership, Schedule, Slot, User } from '@medplum/fhirtypes';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { initAppServices, shutdownApp } from '../packages/server/src/app';
import { inviteUser } from '../packages/server/src/admin/invite';
import { bcryptHashPassword } from '../packages/server/src/auth/utils';
import { loadConfig } from '../packages/server/src/config/loader';
import { createProject } from '../packages/server/src/fhir/operations/projectinit';
import { getGlobalSystemRepo, getProjectSystemRepo } from '../packages/server/src/fhir/repo';

const root = path.resolve(import.meta.dirname, '..');
process.chdir(path.join(root, 'packages/server'));
const config = await loadConfig('file:medplum.config.json,env');
const password = process.env.DEMO_PASSWORD ?? 'HospitalDemo!2026';
if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is local-only');
await initAppServices(config);
try {
  const globalRepo = getGlobalSystemRepo();
  async function ensureProject(name: string, email: string) {
    let project = await globalRepo.searchOne<Project>({
      resourceType: 'Project',
      filters: [{ code: 'name', operator: Operator.EQUALS, value: name }],
    });
    if (!project) {
      let user = await globalRepo.searchOne<User>({
        resourceType: 'User',
        filters: [{ code: 'email', operator: Operator.EQUALS, value: email }],
      });
      user ??= await globalRepo.createResource<User>({
        resourceType: 'User',
        firstName: 'Hospital',
        lastName: 'Admin',
        email,
        emailVerified: true,
        passwordHash: await bcryptHashPassword(password),
      });
      project = (await createProject(name, user)).project;
    }
    if (!project.features?.includes('validate-terminology')) {
      project = await globalRepo.updateResource({
        ...project,
        features: [...(project.features ?? []), 'validate-terminology'],
      });
    }
    return project;
  }
  const project = await ensureProject('Smart Hospital Demo', 'admin@hospital.test');
  const repo = await getProjectSystemRepo(project);
  async function ensureMember(
    email: string,
    resourceType: 'Patient' | 'Practitioner',
    firstName: string,
    lastName: string
  ) {
    const members = await repo.searchResources<ProjectMembership>({
      resourceType: 'ProjectMembership',
      filters: [
        { code: 'user:User.email', operator: Operator.EQUALS, value: email },
        { code: 'project', operator: Operator.EQUALS, value: `Project/${project.id}` },
      ],
    });
    if (members[0]) {
      const profile = await repo.readReference(members[0].profile);
      if (
        (profile.resourceType !== 'Patient' && profile.resourceType !== 'Practitioner') ||
        profile.resourceType !== resourceType
      )
        throw new Error(`Unexpected profile type for ${email}`);
      return { membership: members[0], profile };
    }
    return inviteUser({ project, resourceType, email, firstName, lastName, password, sendEmail: false });
  }
  const doctors = [];
  for (let i = 1; i <= 2; i++)
    doctors.push(
      await ensureMember(
        `doctor${i}@hospital.test`,
        'Practitioner',
        i === 1 ? 'Minh' : 'Linh',
        i === 1 ? 'Nguyen' : 'Tran'
      )
    );
  const patients: Patient[] = [];
  for (let i = 1; i <= 10; i++) {
    const identifier = `SHP-P${String(i).padStart(3, '0')}`;
    let patient = await repo.searchOne<Patient>({
      resourceType: 'Patient',
      filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `urn:smart-hospital:demo|${identifier}` }],
    });
    if (!patient) {
      const account =
        i <= 2
          ? await ensureMember(`patient${i}@hospital.test`, 'Patient', i === 1 ? 'An' : 'Mai', 'Nguyen')
          : undefined;
      const initial = account?.profile as Patient | undefined;
      const data: Patient = {
        ...initial,
        resourceType: 'Patient',
        meta: { ...initial?.meta, project: project.id },
        identifier: [{ system: 'urn:smart-hospital:demo', value: identifier }],
        name: initial?.name ?? [{ family: ['Le', 'Tran', 'Pham'][i % 3], given: [`Benh nhan ${i}`] }],
        active: true,
        gender: i % 2 ? 'male' : 'female',
        birthDate: `199${i % 10}-05-15`,
        telecom: [...(initial?.telecom ?? []), { system: 'phone', value: `09000000${String(i).padStart(2, '0')}` }],
        address: [{ text: 'Du lieu gia lap, TP. Ho Chi Minh' }],
        generalPractitioner: [createReference(doctors[i % 2].profile as Practitioner)],
      };
      patient = data.id ? await repo.updateResource(data) : await repo.createResource(data);
    }
    patients.push(patient);
  }
  const appointments: Appointment[] = [];
  for (let i = 0; i < 4; i++) {
    const key = `SHP-A${i + 1}`;
    let item = await repo.searchOne<Appointment>({
      resourceType: 'Appointment',
      filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `urn:smart-hospital:demo|${key}` }],
    });
    item ??= await repo.createResource<Appointment>({
      resourceType: 'Appointment',
      meta: { project: project.id },
      identifier: [{ system: 'urn:smart-hospital:demo', value: key }],
      status: 'booked',
      description: 'Kham tong quat - du lieu demo',
      start: `2026-10-23T0${i + 1}:00:00Z`,
      end: `2026-10-23T0${i + 1}:30:00Z`,
      participant: [
        { actor: createReference(patients[i]), status: 'accepted' },
        { actor: createReference(doctors[i % 2].profile as Practitioner), status: 'accepted' },
      ],
    });
    appointments.push(item);
  }
  const schedules: Schedule[] = [];
  for (let i = 0; i < doctors.length; i++) {
    const key = `SHP-S${i + 1}`;
    let schedule = await repo.searchOne<Schedule>({
      resourceType: 'Schedule',
      filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `urn:smart-hospital:demo|${key}` }],
    });
    schedule ??= await repo.createResource<Schedule>({
      resourceType: 'Schedule',
      meta: { project: project.id },
      identifier: [{ system: 'urn:smart-hospital:demo', value: key }],
      active: true,
      actor: [createReference(doctors[i].profile as Practitioner)],
    });
    schedules.push(schedule);
  }
  const slots: Slot[] = [];
  const slotDate = new Date();
  slotDate.setUTCDate(slotDate.getUTCDate() + 1);
  const slotDay = slotDate.toISOString().slice(0, 10);
  for (let i = 0; i < schedules.length; i++) {
    for (let j = 0; j < 3; j++) {
      const key = `SHP-SLOT-${i + 1}-${j + 1}`;
      let slot = await repo.searchOne<Slot>({
        resourceType: 'Slot',
        filters: [{ code: 'identifier', operator: Operator.EQUALS, value: `urn:smart-hospital:demo|${key}` }],
      });
      const hour = 2 + j;
      slot ??= await repo.createResource<Slot>({
        resourceType: 'Slot',
        meta: { project: project.id },
        identifier: [{ system: 'urn:smart-hospital:demo', value: key }],
        schedule: createReference(schedules[i]),
        status: 'free',
        start: `${slotDay}T0${hour}:00:00Z`,
        end: `${slotDay}T0${hour}:30:00Z`,
      });
      slots.push(slot);
    }
  }
  const isolatedProject = await ensureProject('Smart Hospital Isolation Test', 'isolation@hospital.test');
  const isolatedRepo = await getProjectSystemRepo(isolatedProject);
  let isolatedPatient = await isolatedRepo.searchOne<Patient>({
    resourceType: 'Patient',
    filters: [{ code: 'identifier', operator: Operator.EQUALS, value: 'urn:smart-hospital:demo|ISOLATED' }],
  });
  isolatedPatient ??= await isolatedRepo.createResource<Patient>({
    resourceType: 'Patient',
    meta: { project: isolatedProject.id },
    identifier: [{ system: 'urn:smart-hospital:demo', value: 'ISOLATED' }],
    name: [{ family: 'Isolation', given: ['Patient'] }],
    active: true,
  });
  const manifest = {
    projectId: project.id,
    doctors: doctors.map((d) => ({ id: d.profile.id, membershipId: d.membership.id })),
    patients: patients.map((p) => ({ id: p.id, identifier: p.identifier?.[0]?.value })),
    appointments: appointments.map((a) => a.id),
    schedules: schedules.map((schedule) => schedule.id),
    slots: slots.map((slot) => slot.id),
    isolatedProjectId: isolatedProject.id,
    isolatedPatientId: isolatedPatient.id,
  };
  await mkdir(path.join(root, '.runtime'), { recursive: true });
  await writeFile(path.join(root, '.runtime/demo.json'), JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify({
      seeded: true,
      projectId: project.id,
      patients: patients.length,
      doctors: doctors.length,
      appointments: appointments.length,
      schedules: schedules.length,
      slots: slots.length,
    })
  );
} finally {
  await shutdownApp();
}
