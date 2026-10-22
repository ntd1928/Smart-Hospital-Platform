import type { Patient, Practitioner, ProjectMembership, Resource } from '@medplum/fhirtypes';
export type HospitalRole = 'Admin' | 'Doctor' | 'Patient';
export function getRole(membership?: ProjectMembership, profile?: Resource): HospitalRole | undefined {
  if (!membership || !profile) return undefined;
  if (membership.admin && profile.resourceType === 'Practitioner') return 'Admin';
  if (profile.resourceType === 'Practitioner') return 'Doctor';
  if (profile.resourceType === 'Patient') return 'Patient';
  return undefined;
}
export function personName(resource: Patient | Practitioner): string {
  const name = resource.name?.[0];
  return name?.text || [...(name?.given ?? []), name?.family].filter(Boolean).join(' ') || 'Chưa có tên';
}
export const ROLE_LABELS: Record<HospitalRole, string> = {
  Admin: 'Quản trị viên',
  Doctor: 'Bác sĩ',
  Patient: 'Bệnh nhân',
};
