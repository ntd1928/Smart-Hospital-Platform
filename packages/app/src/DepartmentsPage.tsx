import { normalizeErrorString } from '@medplum/core';
import type { HealthcareService, Organization, Practitioner, PractitionerRole } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

export function DepartmentsPage(): React.ReactElement {
  const client = useMedplum();
  const [departments, setDepartments] = useState<Organization[]>([]);
  const [services, setServices] = useState<HealthcareService[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [practitionerRoles, setPractitionerRoles] = useState<PractitionerRole[]>([]);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const [organizationResults, serviceResults, practitionerResults, roleResults] = await Promise.all([
        client.searchResources('Organization', { _count: '100', _sort: 'name' }),
        client.searchResources('HealthcareService', { _count: '100', _sort: 'name' }),
        client.searchResources('Practitioner', { _count: '100', _sort: 'name' }),
        client.searchResources('PractitionerRole', { _count: '100' }),
      ]);
      setDepartments(organizationResults);
      setServices(serviceResults);
      setPractitioners(practitionerResults);
      setPractitionerRoles(roleResults);
    } catch (e) {
      setError(e);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('departmentName') ?? '').trim();
    const code = String(data.get('departmentCode') ?? '').trim();
    const parentId = String(data.get('parentDepartment') ?? '');
    if (!name) {
      setError(new Error('Nhập tên khoa.'));
      return;
    }
    if (code && departments.some((department) => department.identifier?.some((identifier) => identifier.value === code))) {
      setError(new Error('Mã khoa đã tồn tại trong danh mục.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const department = await client.createResource<Organization>({
        resourceType: 'Organization',
        active: true,
        name,
        type: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/organization-type', code: 'dept', display: 'Hospital Department' }] }],
        identifier: code ? [{ value: code }] : undefined,
        partOf: parentId ? { reference: `Organization/${parentId}` } : undefined,
      });
      setDepartments((current) => [...current, department].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')));
      setMessage('Đã tạo khoa.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('serviceName') ?? '').trim();
    const departmentId = String(data.get('serviceDepartment') ?? '');
    const serviceType = String(data.get('serviceType') ?? '').trim();
    const specialty = String(data.get('serviceSpecialty') ?? '').trim();
    const comment = String(data.get('serviceComment') ?? '').trim();
    if (!name || !departmentId || !serviceType) {
      setError(new Error('Nhập tên, khoa phụ trách và loại dịch vụ.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const service = await client.createResource<HealthcareService>({
        resourceType: 'HealthcareService',
        active: true,
        name,
        providedBy: { reference: `Organization/${departmentId}` },
        type: [{ text: serviceType }],
        specialty: specialty ? [{ text: specialty }] : undefined,
        comment: comment || undefined,
      });
      setServices((current) => [...current, service].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')));
      setMessage('Đã tạo dịch vụ.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function renameDepartment(department: Organization, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!department.id) return;
    const name = String(new FormData(event.currentTarget).get('renameDepartment') ?? '').trim();
    if (!name) return;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<Organization>({ ...department, name });
      setDepartments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã cập nhật khoa.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setDepartmentActive(department: Organization) {
    if (!department.id) return;
    const active = department.active === false;
    if (!active && departments.some((child) => child.partOf?.reference === `Organization/${department.id}` && child.active !== false)) {
      setError(new Error('Hãy ngừng các khoa trực thuộc trước.'));
      return;
    }
    if (!active && services.some((service) => service.providedBy?.reference === `Organization/${department.id}` && service.active !== false)) {
      setError(new Error('Hãy ngừng các dịch vụ đang hoạt động trong khoa trước.'));
      return;
    }
    if (!active && !window.confirm(`Ngừng hoạt động khoa “${department.name ?? department.id}”?`)) return;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<Organization>({ ...department, active });
      setDepartments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(active ? 'Đã kích hoạt khoa.' : 'Đã ngừng khoa.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setServiceActive(service: HealthcareService) {
    if (!service.id) return;
    const active = service.active === false;
    if (!active && !window.confirm(`Ngừng dịch vụ “${service.name ?? service.id}”?`)) return;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<HealthcareService>({ ...service, active });
      setServices((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(active ? 'Đã kích hoạt dịch vụ.' : 'Đã ngừng dịch vụ.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function assignPractitioner(event: FormEvent<HTMLFormElement>, service: HealthcareService) {
    event.preventDefault();
    if (!service.id || !service.providedBy?.reference) return;
    const form = event.currentTarget;
    const practitionerId = String(new FormData(form).get('practitioner') ?? '');
    if (!practitionerId) return;
    const exists = practitionerRoles.some(
      (role) => role.active !== false && role.practitioner?.reference === `Practitioner/${practitionerId}` &&
        role.healthcareService?.some((reference) => reference.reference === `HealthcareService/${service.id}`)
    );
    if (exists) {
      setError(new Error('Bác sĩ đã được phân công cho dịch vụ này.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const role = await client.createResource<PractitionerRole>({
        resourceType: 'PractitionerRole',
        active: true,
        practitioner: { reference: `Practitioner/${practitionerId}` },
        organization: service.providedBy,
        healthcareService: [{ reference: `HealthcareService/${service.id}` }],
      });
      setPractitionerRoles((current) => [...current, role]);
      form.reset();
      setMessage('Đã phân công bác sĩ cho dịch vụ.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function setPractitionerRoleActive(role: PractitionerRole) {
    if (!role.id) return;
    const active = role.active === false;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<PractitionerRole>({ ...role, active });
      setPractitionerRoles((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(active ? 'Đã kích hoạt phân công.' : 'Đã ngừng phân công.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const activeDepartments = departments.filter((department) => department.active !== false);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">HOSPITAL DIRECTORY</span>
          <h1>Khoa & dịch vụ</h1>
          <p className="muted">Quản lý cơ cấu khoa và danh mục dịch vụ y tế theo FHIR.</p>
        </div>
      </div>
      {error && <div className="notice error" role="alert">{normalizeErrorString(error)}</div>}
      {message && <div className="notice" role="status">{message}</div>}
      <form className="panel editor" onSubmit={createDepartment}>
        <h2>Thêm khoa</h2>
        <div className="form-grid">
          <label>Tên khoa<input name="departmentName" maxLength={200} required /></label>
          <label>Mã khoa<input name="departmentCode" maxLength={80} /></label>
          <label>Khoa trực thuộc
            <select name="parentDepartment" defaultValue="">
              <option value="">Đơn vị gốc</option>
              {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
        </div>
        <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Tạo khoa'}</button></div>
      </form>
      <form className="panel editor" onSubmit={createService}>
        <h2>Thêm dịch vụ</h2>
        <div className="form-grid">
          <label>Tên dịch vụ<input name="serviceName" maxLength={200} required /></label>
          <label>Khoa phụ trách
            <select name="serviceDepartment" defaultValue="" required>
              <option value="" disabled>Chọn khoa</option>
              {activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select>
          </label>
          <label>Loại dịch vụ<input name="serviceType" maxLength={120} placeholder="Khám ngoại trú, xét nghiệm…" required /></label>
          <label>Chuyên khoa<input name="serviceSpecialty" maxLength={120} placeholder="Tim mạch, nhi khoa…" /></label>
          <label className="full-width">Ghi chú<input name="serviceComment" maxLength={500} /></label>
        </div>
        <div className="form-actions"><button className="button primary" disabled={busy || activeDepartments.length === 0}>{busy ? 'Đang lưu…' : 'Tạo dịch vụ'}</button></div>
      </form>
      <section className="panel">
        <h2>Danh mục</h2>
        {departments.length ? departments.map((department) => {
          const departmentServices = services.filter((service) => service.providedBy?.reference === `Organization/${department.id}`);
          return (
            <article className="directory-card" key={department.id}>
              <div className="panel-heading">
                <div>
                  <h3>{department.name ?? 'Khoa chưa đặt tên'}</h3>
                  <p className="muted">{department.identifier?.[0]?.value ?? department.id} · {department.partOf?.display ?? department.partOf?.reference ?? 'Đơn vị gốc'}</p>
                </div>
                <span className={`pill ${department.active === false ? 'inactive' : ''}`}>{department.active === false ? 'Ngừng hoạt động' : 'Đang hoạt động'}</span>
              </div>
              <div className="form-grid">
                <form className="toolbar" onSubmit={(event) => void renameDepartment(department, event)}>
                  <label>Tên khoa<input name="renameDepartment" maxLength={200} defaultValue={department.name ?? ''} required /></label>
                  <button className="button secondary" disabled={busy}>Đổi tên</button>
                </form>
                <button className="button secondary" disabled={busy} onClick={() => void setDepartmentActive(department)}>
                  {department.active === false ? 'Kích hoạt' : 'Ngừng hoạt động'}
                </button>
              </div>
              <h4>Dịch vụ ({departmentServices.length})</h4>
              {departmentServices.length ? <ul>{departmentServices.map((service) => (
                <li key={service.id}>
                  <strong>{service.name}</strong> · {service.type?.map((item) => item.text ?? item.coding?.[0]?.display).filter(Boolean).join(', ') || 'Chưa phân loại'}
                  {service.specialty?.length ? ` · ${service.specialty.map((item) => item.text ?? item.coding?.[0]?.display).filter(Boolean).join(', ')}` : ''}
                  <span className="pill">{service.active === false ? 'Ngừng' : 'Hoạt động'}</span>{' '}
                  <button className="button secondary" disabled={busy} onClick={() => void setServiceActive(service)}>
                    {service.active === false ? 'Kích hoạt' : 'Ngừng'}
                  </button>
                  <ul className="service-practitioners">
                    {practitionerRoles.filter((role) => role.healthcareService?.some((reference) => reference.reference === `HealthcareService/${service.id}`)).map((role) => {
                      const practitioner = practitioners.find((item) => `Practitioner/${item.id}` === role.practitioner?.reference);
                      return <li key={role.id}>{practitioner ? `${practitioner.name?.[0]?.given?.join(' ') ?? ''} ${practitioner.name?.[0]?.family ?? ''}`.trim() : role.practitioner?.display ?? role.practitioner?.reference}
                        <span className={`pill ${role.active === false ? 'inactive' : ''}`}>{role.active === false ? 'Ngừng phân công' : 'Đang nhận khám'}</span>{' '}
                        <button className="button secondary" disabled={busy} onClick={() => void setPractitionerRoleActive(role)}>{role.active === false ? 'Kích hoạt' : 'Ngừng phân công'}</button>
                      </li>;
                    })}
                  </ul>
                  <form className="toolbar assign-practitioner" onSubmit={(event) => void assignPractitioner(event, service)}>
                    <label>Bác sĩ
                      <select name="practitioner" required defaultValue="">
                        <option value="" disabled>Chọn bác sĩ</option>
                        {practitioners.filter((practitioner) => practitioner.active !== false).map((practitioner) => <option key={practitioner.id} value={practitioner.id}>{practitioner.name?.[0]?.given?.join(' ')} {practitioner.name?.[0]?.family}</option>)}
                      </select>
                    </label>
                    <button className="button secondary" disabled={busy || service.active === false || !practitioners.some((practitioner) => practitioner.active !== false)}>Phân công</button>
                  </form>
                </li>
              ))}</ul> : <p className="muted">Chưa có dịch vụ được gắn với khoa này.</p>}
            </article>
          );
        }) : <p className="empty">Chưa có khoa trong danh mục.</p>}
        {!departments.length && services.length > 0 && <p className="notice error">Có dịch vụ chưa gắn với khoa đang tải.</p>}
      </section>
      <button className="button secondary" disabled={busy} onClick={() => void load()}>Tải lại danh mục</button>
    </>
  );
}
