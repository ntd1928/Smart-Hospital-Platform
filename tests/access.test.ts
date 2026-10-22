import { describe, expect, it } from 'vitest';
import type { Patient, Practitioner, ProjectMembership } from '@medplum/fhirtypes';
import { getRole, personName } from '../packages/app/src/access';

describe('hospital role resolution', () => {
  const membership = {
    resourceType: 'ProjectMembership',
    profile: { reference: 'Practitioner/doctor' },
    project: { reference: 'Project/demo' },
    user: { reference: 'User/doctor' },
  } as ProjectMembership;
  it('requires both a verified membership and a supported profile', () => {
    expect(getRole(undefined, { resourceType: 'Patient' })).toBeUndefined();
    expect(getRole(membership, undefined)).toBeUndefined();
    expect(getRole(membership, { resourceType: 'Organization' })).toBeUndefined();
  });
  it('maps upstream membership/profile without elevating Patient profiles', () => {
    expect(getRole(membership, { resourceType: 'Practitioner' })).toBe('Doctor');
    expect(getRole({ ...membership, admin: true }, { resourceType: 'Practitioner' })).toBe('Admin');
    expect(getRole({ ...membership, admin: true }, { resourceType: 'Patient' })).toBe('Patient');
  });
  it('shows a usable name for FHIR text, structured and unnamed people', () => {
    expect(personName({ resourceType: 'Patient', name: [{ text: 'Tên hiển thị', family: 'Other' }] } as Patient)).toBe(
      'Tên hiển thị'
    );
    expect(
      personName({ resourceType: 'Practitioner', name: [{ given: ['Minh'], family: 'Nguyen' }] } as Practitioner)
    ).toBe('Minh Nguyen');
    expect(personName({ resourceType: 'Patient' })).toBe('Chưa có tên');
  });
});
