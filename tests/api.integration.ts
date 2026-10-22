import assert from 'node:assert/strict';
import type { Appointment, Patient, Practitioner, ProjectMembership } from '@medplum/fhirtypes';
import { fixture, signIn, request, password, baseUrl } from './helpers';

const data = await fixture();
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
const health = await (await request('healthcheck')).json();
assert.equal(health.postgres, true);
assert.equal(health.redis, true);
console.log('PASS PostgreSQL/Redis healthcheck');
passed++;
await check('anonymous and invalid token rejected', async () => {
  assert.equal((await request('fhir/R4/Patient')).status, 401);
  assert.equal((await request('fhir/R4/Patient', 'invalid-token')).status, 401);
});
await check('incorrect password rejected', async () => {
  await assert.rejects(signIn('admin@hospital.test', data.projectId, 'NotThePassword!2026'));
});
const admin = await signIn('admin@hospital.test', data.projectId);
const doctor = await signIn('doctor1@hospital.test', data.projectId);
const patient = await signIn('patient1@hospital.test', data.projectId);
const patient2 = await signIn('patient2@hospital.test', data.projectId);
const clients = [admin, doctor, patient, patient2];
try {
  await check('three role profiles and admin membership', async () => {
    assert.equal(admin.getProjectMembership()?.admin, true);
    assert.equal(doctor.getProfile()?.resourceType, 'Practitioner');
    assert.notEqual(doctor.getProjectMembership()?.admin, true);
    assert.equal(patient.getProfile()?.resourceType, 'Patient');
    assert.equal(patient.getProfile()?.id, data.patients[0].id);
  });
  await check('Patient FHIR CRUD and name search', async () => {
    const created = await admin.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Integration', given: ['UniqueTest'] }],
      active: true,
    });
    try {
      assert.equal((await doctor.readResource('Patient', created.id)).id, created.id);
      assert((await admin.searchResources('Patient', { name: 'UniqueTest' })).some((p) => p.id === created.id));
      const updated = await doctor.updateResource({ ...created, gender: 'female' });
      assert.equal((await admin.readResource('Patient', updated.id)).gender, 'female');
      const history = await admin.readHistory('Patient', created.id);
      assert((history.entry?.length ?? 0) >= 2);
    } finally {
      await admin.deleteResource('Patient', created.id);
    }
    assert.equal((await request(`fhir/R4/Patient/${created.id}`, admin.getAccessToken())).status, 410);
  });
  await check('invalid FHIR Patient rejected', async () => {
    const response = await request('fhir/R4/Patient', admin.getAccessToken(), 'POST', {
      resourceType: 'Patient',
      gender: 'not-a-valid-gender',
    });
    assert.equal(response.status, 400);
  });
  await check('Practitioner CRUD/search through existing FHIR API', async () => {
    const created = await admin.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ family: 'Test', given: ['DoctorTemporary'] }],
    });
    try {
      assert(
        (await admin.searchResources('Practitioner', { name: 'DoctorTemporary' })).some((p) => p.id === created.id)
      );
      const updated = await admin.updateResource({ ...created, active: false });
      assert.equal((await admin.readResource('Practitioner', updated.id)).active, false);
    } finally {
      await admin.deleteResource('Practitioner', created.id);
    }
  });
  await check('Patient search and direct read limited to own profile', async () => {
    const list = await patient.searchResources('Patient', { _count: '100' });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, data.patients[0].id);
    for (const otherId of [data.patients[1].id, data.isolatedPatientId]) {
      assert([403, 404].includes((await request(`fhir/R4/Patient/${otherId}`, patient.getAccessToken())).status));
    }
    assert.equal((await patient.searchResources('Patient', { _id: data.patients[1].id })).length, 0);
  });
  await check('Patient cannot modify another patient or create arbitrary records', async () => {
    const other = await admin.readResource('Patient', data.patients[1].id);
    assert(
      [403, 404].includes(
        (await request(`fhir/R4/Patient/${other.id}`, patient.getAccessToken(), 'PUT', { ...other, gender: 'unknown' }))
          .status
      )
    );
    assert(
      [403, 404].includes(
        (
          await request('fhir/R4/Patient', patient.getAccessToken(), 'POST', {
            resourceType: 'Patient',
            name: [{ text: 'Forbidden' }],
          })
        ).status
      )
    );
  });
  await check('Doctor and Patient blocked from admin invite API', async () => {
    for (const client of [doctor, patient])
      assert.equal(
        (
          await request(`admin/projects/${data.projectId}/invite`, client.getAccessToken(), 'POST', {
            resourceType: 'Practitioner',
            firstName: 'No',
            lastName: 'Access',
            email: 'denied@hospital.test',
            password,
            sendEmail: false,
          })
        ).status,
        403
      );
  });
  await check('Doctor cannot promote own membership', async () => {
    const member = await admin.readResource('ProjectMembership', data.doctors[0].membershipId);
    assert.equal(
      (
        await request(`fhir/R4/ProjectMembership/${member.id}`, doctor.getAccessToken(), 'PUT', {
          ...member,
          admin: true,
        })
      ).status,
      403
    );
  });
  await check('project isolation applies to admin as well', async () => {
    assert(
      [403, 404].includes((await request(`fhir/R4/Patient/${data.isolatedPatientId}`, admin.getAccessToken())).status)
    );
    assert.equal((await admin.searchResources('Patient', { _id: data.isolatedPatientId })).length, 0);
  });
  await check('basic Appointment API and patient compartment', async () => {
    const own = await patient.searchResources('Appointment');
    assert(own.length >= 1);
    assert(own.every((a) => a.participant.some((p) => p.actor?.reference === `Patient/${data.patients[0].id}`)));
    assert((await doctor.searchResources('Appointment')).length >= 4);
    const other = await patient2.searchResources('Appointment');
    assert(other.length >= 1);
    assert(other.every((a) => a.participant.some((p) => p.actor?.reference === `Patient/${data.patients[1].id}`)));
  });
  await check('future modules not exposed', async () => {
    for (const resource of ['Encounter', 'Condition', 'Observation', 'Bot', '$ai'])
      assert.equal((await request(`fhir/R4/${resource}`, admin.getAccessToken())).status, 404);
  });
  await check('basic Appointment create update delete', async () => {
    const created = await admin.createResource<Appointment>({
      resourceType: 'Appointment',
      status: 'booked',
      start: '2026-10-24T01:00:00Z',
      end: '2026-10-24T01:30:00Z',
      participant: [{ actor: { reference: `Patient/${data.patients[0].id}` }, status: 'accepted' }],
    });
    try {
      assert.equal((await patient.readResource('Appointment', created.id)).status, 'booked');
      await admin.updateResource({ ...created, status: 'cancelled' });
      assert.equal((await doctor.readResource('Appointment', created.id)).status, 'cancelled');
    } finally {
      await admin.deleteResource('Appointment', created.id);
    }
  });
  await check('Admin provisions account and disabled membership blocks login', async () => {
    const email = `api-${Date.now()}@hospital.test`;
    const member = (await admin.invite(data.projectId, {
      resourceType: 'Patient',
      firstName: 'API',
      lastName: 'Temporary',
      email,
      password,
      sendEmail: false,
    })) as ProjectMembership;
    assert.equal(member.resourceType, 'ProjectMembership');
    const userId = member.user.reference!.split('/')[1];
    const profileId = member.profile.reference!.split('/')[1];
    try {
      const fresh = await signIn(email, data.projectId);
      const token = fresh.getAccessToken();
      await admin.updateResource({ ...member, active: false });
      assert([401, 403].includes((await request('auth/me', token)).status));
      fresh.clear();
      await assert.rejects(signIn(email, data.projectId));
      await admin.updateResource({ ...member, active: true });
      const restored = await signIn(email, data.projectId);
      await restored.signOut();
    } finally {
      await admin.deleteResource('ProjectMembership', member.id!);
      await admin.deleteResource('Patient', profileId);
      await admin.deleteResource('User', userId);
    }
  });
  await check('refresh token establishes a working session', async () => {
    const login = await signIn('doctor2@hospital.test', data.projectId);
    try {
      const response = await fetch(new URL('oauth2/token', baseUrl), {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: login.getActiveLogin()!.refreshToken }),
      });
      assert.equal(response.status, 200);
      const tokens = await response.json();
      assert.equal((await request('auth/me', tokens.access_token)).status, 200);
      await request('oauth2/logout', tokens.access_token, 'POST', {});
    } finally {
      login.clear();
    }
  });
  await check('logout revokes access token', async () => {
    const login = await signIn('doctor2@hospital.test', data.projectId);
    const token = login.getAccessToken();
    await login.signOut();
    assert.equal((await request('auth/me', token)).status, 401);
  });
  console.log(JSON.stringify({ apiChecksPassed: passed }));
} finally {
  for (const client of clients) {
    await client.signOut().catch(() => client.clear());
  }
}
