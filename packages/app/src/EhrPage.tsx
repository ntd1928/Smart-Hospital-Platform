import { normalizeErrorString } from '@medplum/core';
import type { Appointment, Condition, Encounter, Observation, Patient, Practitioner } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { personName } from './access';
import type { HospitalRole } from './access';

export function EhrPage({ role, profile }: { role: HospitalRole; profile: Patient | Practitioner }): React.ReactElement {
  const client = useMedplum();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState(role === 'Patient' ? profile.id ?? '' : '');
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (role === 'Patient') return;
    let live = true;
    client.searchResources('Patient', { _count: '100', _sort: 'name' })
      .then((results) => {
        if (!live) return;
        setPatients(results);
        if (results[0]?.id) setPatientId((current) => current || results[0].id || '');
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
    };
  }, [client, role]);

  useEffect(() => {
    if (!patientId) return;
    let live = true;
    setLoading(true);
    setError(undefined);
    const patientReference = `Patient/${patientId}`;
    Promise.all([
      client.searchResources('Encounter', { patient: patientReference, _count: '100', _sort: '-date' }),
      client.searchResources('Condition', { patient: patientReference, _count: '100', _sort: '-onset-date' }),
      client.searchResources('Observation', { patient: patientReference, _count: '100', _sort: '-date' }),
      client.searchResources('Appointment', { patient: patientReference, _count: '100', _sort: '-date' }),
    ])
      .then(([encounterResults, conditionResults, observationResults, appointmentResults]) => {
        if (!live) return;
        setEncounters(encounterResults);
        setConditions(conditionResults);
        setObservations(observationResults);
        setAppointments(appointmentResults);
      })
      .catch((e) => {
        if (live) setError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [client, patientId]);

  async function createEncounter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const start = new Date(`${String(data.get('encounterDate'))}T${String(data.get('encounterTime'))}`);
    const reason = String(data.get('encounterReason')).trim();
    if (!patientId || !reason || !Number.isFinite(start.getTime())) {
      setError(new Error('Chọn bệnh nhân, thời gian và lý do khám hợp lệ.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const appointmentId = String(data.get('encounterAppointment') ?? '');
      await client.createResource<Encounter>({
        resourceType: 'Encounter',
        status: 'in-progress',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
        subject: { reference: `Patient/${patientId}` },
        appointment: appointmentId ? [{ reference: `Appointment/${appointmentId}` }] : undefined,
        period: { start: start.toISOString() },
        reasonCode: [{ text: reason }],
      });
      setMessage('Đã tạo lần khám.');
      form.reset();
      setLoading(true);
      const updated = await client.searchResources('Encounter', {
        patient: `Patient/${patientId}`,
        _count: '100',
        _sort: '-date',
      });
      setEncounters(updated);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
      setLoading(false);
    }
  }

  async function updateEncounterStatus(encounter: Encounter, status: 'finished' | 'cancelled') {
    if (!encounter.id || encounter.status !== 'in-progress') return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const end = new Date();
      if (encounter.period?.start && end < new Date(encounter.period.start)) {
        throw new Error('Thời điểm kết thúc không thể trước thời điểm bắt đầu.');
      }
      const updated = await client.updateResource<Encounter>({
        ...encounter,
        status,
        period: { ...encounter.period, end: end.toISOString() },
      });
      setEncounters((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(status === 'finished' ? 'Đã kết thúc lần khám.' : 'Đã hủy lần khám.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function createCondition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = String(data.get('conditionCode')).trim();
    if (!patientId || !code) {
      setError(new Error('Chọn bệnh nhân và nhập chẩn đoán.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const encounterId = String(data.get('conditionEncounter') ?? '');
      const condition = await client.createResource<Condition>({
        resourceType: 'Condition',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
        code: { text: code },
        subject: { reference: `Patient/${patientId}` },
        encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        recordedDate: new Date().toISOString(),
      });
      setConditions((current) => [condition, ...current]);
      setMessage('Đã lưu chẩn đoán.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function createObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = String(data.get('observationCode')).trim();
    const value = String(data.get('observationValue')).trim();
    const effectiveDateTime = String(data.get('observationDateTime') ?? '');
    if (!patientId || !code || !value || (effectiveDateTime && !Number.isFinite(new Date(effectiveDateTime).getTime()))) {
      setError(new Error('Chọn bệnh nhân và nhập chỉ số, giá trị hợp lệ.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const encounterId = String(data.get('observationEncounter') ?? '');
      const observation = await client.createResource<Observation>({
        resourceType: 'Observation',
        status: 'final',
        code: { text: code },
        subject: { reference: `Patient/${patientId}` },
        encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        effectiveDateTime: effectiveDateTime ? new Date(effectiveDateTime).toISOString() : new Date().toISOString(),
        valueString: value,
      });
      setObservations((current) => [observation, ...current]);
      setMessage('Đã lưu kết quả.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const selectedPatient = patients.find((patient) => patient.id === patientId);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">EHR · FHIR R4</span>
          <h1>Hồ sơ bệnh án</h1>
          <p className="muted">Encounter, chẩn đoán và kết quả được đọc từ FHIR API theo quyền truy cập.</p>
        </div>
      </div>
      {role !== 'Patient' ? (
        <section className="panel editor">
          <label>
            Bệnh nhân
            <select value={patientId} onChange={(event) => setPatientId(event.currentTarget.value)}>
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>{personName(patient)}</option>
              ))}
            </select>
          </label>
        </section>
      ) : (
        <p className="muted">Hồ sơ của {personName(profile as Patient)}</p>
      )}
      {error && <div className="notice error" role="alert">{normalizeErrorString(error)}</div>}
      {message && <div className="notice" role="status">{message}</div>}
      {loading ? <p className="muted">Đang tải hồ sơ…</p> : null}
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createEncounter}>
          <h2>Ghi nhận lần khám</h2>
          <div className="form-grid">
            <label>Ngày khám<input name="encounterDate" type="date" required /></label>
            <label>Giờ khám<input name="encounterTime" type="time" required /></label>
            <label>Appointment đã hoàn tất
              <select name="encounterAppointment" defaultValue="">
                <option value="">Không liên kết</option>
                {appointments.filter((appointment) => appointment.status === 'fulfilled').map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.start ? new Date(appointment.start).toLocaleString('vi-VN') : appointment.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="full-width">Lý do khám<input name="encounterReason" maxLength={200} required /></label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>
              {saving ? 'Đang lưu…' : 'Tạo lần khám'}
            </button>
          </div>
        </form>
      )}
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createCondition}>
          <h2>Ghi chẩn đoán</h2>
          <div className="form-grid">
            <label className="full-width">Chẩn đoán<input name="conditionCode" maxLength={200} required /></label>
            <label>Lần khám liên quan
              <select name="conditionEncounter" defaultValue="">
                <option value="">Không liên kết</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>
                    {encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : encounter.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>
              {saving ? 'Đang lưu…' : 'Lưu chẩn đoán'}
            </button>
          </div>
        </form>
      )}
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createObservation}>
          <h2>Ghi kết quả</h2>
          <div className="form-grid">
            <label>Chỉ số<input name="observationCode" maxLength={200} required /></label>
            <label>Giá trị<input name="observationValue" maxLength={200} required /></label>
            <label>Thời điểm<input name="observationDateTime" type="datetime-local" /></label>
            <label>Lần khám liên quan
              <select name="observationEncounter" defaultValue="">
                <option value="">Không liên kết</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>
                    {encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : encounter.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>
              {saving ? 'Đang lưu…' : 'Lưu kết quả'}
            </button>
          </div>
        </form>
      )}
      <section className="panel">
        <h2>Lần khám</h2>
        {encounters.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Ngày</th><th>Trạng thái</th><th>Lý do</th><th>Appointment</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
            <tbody>{encounters.map((encounter) => (
              <tr key={encounter.id}>
                <td>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : '—'}{encounter.period?.end ? ` – ${new Date(encounter.period.end).toLocaleString('vi-VN')}` : ''}</td>
                <td>{encounter.status}</td>
                <td>{encounter.reasonCode?.map((reason) => reason.text ?? reason.coding?.[0]?.display).filter(Boolean).join(', ') || '—'}</td>
                <td>{encounter.appointment?.map((reference) => {
                  const appointment = appointments.find((item) => reference.reference === `Appointment/${item.id}`);
                  return appointment?.start ? new Date(appointment.start).toLocaleString('vi-VN') : reference.display ?? reference.reference;
                }).join(', ') || '—'}</td>
                {role !== 'Patient' && <td>{encounter.status === 'in-progress' && <>
                  <button className="button" disabled={saving} onClick={() => void updateEncounterStatus(encounter, 'finished')}>Kết thúc</button>{' '}
                  <button className="button" disabled={saving} onClick={() => void updateEncounterStatus(encounter, 'cancelled')}>Hủy</button>
                </>}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="empty">{loading ? 'Đang tải…' : 'Chưa có lần khám trong phạm vi truy cập.'}</p>}
      </section>
      <section className="panel">
        <h2>Chẩn đoán</h2>
        {conditions.length ? <div className="table-wrap"><table>
          <thead><tr><th>Chẩn đoán</th><th>Trạng thái</th><th>Lần khám</th></tr></thead>
          <tbody>{conditions.map((condition) => {
            const encounter = encounters.find((item) => condition.encounter?.reference === `Encounter/${item.id}`);
            return (
              <tr key={condition.id}>
                <td>{condition.code?.text ?? condition.code?.coding?.[0]?.display ?? 'Chưa có tên'}</td>
                <td>{condition.clinicalStatus?.coding?.[0]?.code ?? condition.verificationStatus?.coding?.[0]?.code ?? '—'}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : condition.encounter?.display ?? condition.encounter?.reference ?? '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">Chưa có chẩn đoán trong phạm vi truy cập.</p>}
      </section>
      <section className="panel">
        <h2>Kết quả</h2>
        {observations.length ? <div className="table-wrap"><table>
          <thead><tr><th>Ngày</th><th>Chỉ số</th><th>Giá trị</th><th>Lần khám</th></tr></thead>
          <tbody>{observations.map((observation) => {
            const encounter = encounters.find((item) => observation.encounter?.reference === `Encounter/${item.id}`);
            return (
              <tr key={observation.id}>
                <td>{observation.effectiveDateTime ? new Date(observation.effectiveDateTime).toLocaleString('vi-VN') : '—'}</td>
                <td>{observation.code.text ?? observation.code.coding?.[0]?.display ?? '—'}</td>
                <td>{observation.valueString ?? (observation.valueQuantity ? `${observation.valueQuantity.value ?? ''} ${observation.valueQuantity.unit ?? ''}` : '—')}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : observation.encounter?.display ?? observation.encounter?.reference ?? '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">Chưa có kết quả trong phạm vi truy cập.</p>}
      </section>
      {role !== 'Patient' && selectedPatient && <p className="muted">Bác sĩ/nhân viên: dữ liệu chỉ hiện khi FHIR API cho phép đọc bệnh nhân đã chọn.</p>}
    </>
  );
}
