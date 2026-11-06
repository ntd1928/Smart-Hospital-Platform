import { normalizeErrorString } from '@medplum/core';
import type { Appointment, Condition, Encounter, Observation, Patient, Practitioner } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { personName } from './access';
import type { HospitalRole } from './access';

const observationCategoryLabels: Record<string, string> = {
  'vital-signs': 'Dấu hiệu sinh tồn',
  laboratory: 'Xét nghiệm',
  other: 'Khác',
};

export function EhrPage({ role, profile }: { role: HospitalRole; profile: Patient | Practitioner }): React.ReactElement {
  const client = useMedplum();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientRecord, setSelectedPatientRecord] = useState<Patient>();
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState(role === 'Patient' ? profile.id ?? '' : '');
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [encounterSearch, setEncounterSearch] = useState('');
  const [encounterStatusFilter, setEncounterStatusFilter] = useState('');
  const [encounterFrom, setEncounterFrom] = useState('');
  const [encounterTo, setEncounterTo] = useState('');
  const [conditionSearch, setConditionSearch] = useState('');
  const [conditionClinicalStatus, setConditionClinicalStatus] = useState('');
  const [conditionVerificationStatus, setConditionVerificationStatus] = useState('');
  const [observationSearch, setObservationSearch] = useState('');
  const [observationCategory, setObservationCategory] = useState('');
  const [observationFrom, setObservationFrom] = useState('');
  const [observationTo, setObservationTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (role === 'Patient') return;
    let live = true;
    const timer = window.setTimeout(() => {
      const search = patientSearch.trim();
      client.searchResources('Patient', { ...(search ? { name: search } : {}), _count: '100', _sort: 'name' })
        .then((results) => {
          if (!live) return;
          setPatients(results);
          if (!search && results[0]?.id) {
            setPatientId((current) => current || results[0].id || '');
            setSelectedPatientRecord((current) => current ?? results[0]);
          }
        })
        .catch((e) => {
          if (live) setError(e);
        });
    }, patientSearch.trim() ? 250 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [client, role, patientSearch]);

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
    const clinicalNote = String(data.get('encounterNote') ?? '').trim();
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
        note: clinicalNote ? [{ time: new Date().toISOString(), text: clinicalNote }] : undefined,
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

  async function addEncounterNote(encounter: Encounter, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!encounter.id || encounter.status !== 'in-progress') return;
    const form = event.currentTarget;
    const text = String(new FormData(form).get('encounterNote')).trim();
    if (!text) return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<Encounter>({
        ...encounter,
        note: [...(encounter.note ?? []), {
          time: new Date().toISOString(),
          text,
          authorReference: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined,
        }],
      });
      setEncounters((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã bổ sung ghi chú diễn biến.');
      form.reset();
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
    const onsetDate = String(data.get('conditionOnsetDate') ?? '');
    if (!patientId || !code || (onsetDate && !Number.isFinite(new Date(onsetDate).getTime()))) {
      setError(new Error('Chọn bệnh nhân, nhập chẩn đoán và ngày khởi phát hợp lệ.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const encounterId = String(data.get('conditionEncounter') ?? '');
      const verificationStatus = String(data.get('conditionVerificationStatus') ?? 'confirmed');
      const condition = await client.createResource<Condition>({
        resourceType: 'Condition',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: verificationStatus }] },
        code: { text: code },
        subject: { reference: `Patient/${patientId}` },
        encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        onsetDateTime: onsetDate ? new Date(`${onsetDate}T00:00:00`).toISOString() : undefined,
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

  async function resolveCondition(condition: Condition) {
    if (!condition.id || condition.clinicalStatus?.coding?.[0]?.code !== 'active') return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<Condition>({
        ...condition,
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'resolved' }] },
        abatementDateTime: new Date().toISOString(),
      });
      setConditions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã đánh dấu chẩn đoán đã giải quyết.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function confirmCondition(condition: Condition) {
    const status = condition.verificationStatus?.coding?.[0]?.code;
    if (!condition.id || !['provisional', 'unconfirmed', 'differential'].includes(status ?? '')) return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<Condition>({
        ...condition,
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
      });
      setConditions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã xác nhận chẩn đoán.');
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
    const category = String(data.get('observationCategory') ?? 'other');
    const numericValue = String(data.get('observationNumericValue') ?? '').trim();
    const textValue = String(data.get('observationTextValue') ?? '').trim();
    const unit = String(data.get('observationUnit') ?? '').trim();
    const effectiveDateTime = String(data.get('observationDateTime') ?? '');
    if (!patientId || !code || (!numericValue && !textValue) || (numericValue && !Number.isFinite(Number(numericValue))) || (effectiveDateTime && !Number.isFinite(new Date(effectiveDateTime).getTime()))) {
      setError(new Error('Chọn bệnh nhân, chỉ số và một giá trị hợp lệ.'));
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
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: category, display: observationCategoryLabels[category] ?? category }] }],
        code: { text: code },
        subject: { reference: `Patient/${patientId}` },
        encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        effectiveDateTime: effectiveDateTime ? new Date(effectiveDateTime).toISOString() : new Date().toISOString(),
        ...(numericValue ? { valueQuantity: { value: Number(numericValue), unit: unit || undefined } } : { valueString: textValue }),
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

  const selectedPatient = patients.find((patient) => patient.id === patientId) ?? selectedPatientRecord;
  const inProgressEncounterCount = encounters.filter((encounter) => encounter.status === 'in-progress').length;
  const activeConditionCount = conditions.filter((condition) => condition.clinicalStatus?.coding?.[0]?.code === 'active').length;
  const latestObservation = observations
    .slice()
    .sort((a, b) => (b.effectiveDateTime ?? '').localeCompare(a.effectiveDateTime ?? ''))[0];
  const query = encounterSearch.trim().toLocaleLowerCase();
  const filteredEncounters = encounters.filter((encounter) => {
    const startDate = encounter.period?.start?.slice(0, 10) ?? '';
    const searchableText = [
      encounter.reasonCode?.map((reason) => reason.text ?? reason.coding?.[0]?.display).join(' '),
      encounter.note?.map((note) => note.text).join(' '),
      encounter.appointment?.map((reference) => reference.display ?? reference.reference).join(' '),
    ].join(' ').toLocaleLowerCase();
    return (!query || searchableText.includes(query))
      && (!encounterStatusFilter || encounter.status === encounterStatusFilter)
      && (!encounterFrom || (startDate && startDate >= encounterFrom))
      && (!encounterTo || (startDate && startDate <= encounterTo));
  });
  const conditionQuery = conditionSearch.trim().toLocaleLowerCase();
  const filteredConditions = conditions.filter((condition) => {
    const code = condition.code?.text ?? condition.code?.coding?.[0]?.display ?? '';
    return (!conditionQuery || code.toLocaleLowerCase().includes(conditionQuery))
      && (!conditionClinicalStatus || condition.clinicalStatus?.coding?.[0]?.code === conditionClinicalStatus)
      && (!conditionVerificationStatus || condition.verificationStatus?.coding?.[0]?.code === conditionVerificationStatus);
  });
  const observationQuery = observationSearch.trim().toLocaleLowerCase();
  const filteredObservations = observations.filter((observation) => {
    const code = observation.code.text ?? observation.code.coding?.[0]?.display ?? '';
    const effectiveDate = observation.effectiveDateTime?.slice(0, 10) ?? '';
    return (!observationQuery || code.toLocaleLowerCase().includes(observationQuery))
      && (!observationCategory || observation.category?.some((category) => category.coding?.some((coding) => coding.code === observationCategory)))
      && (!observationFrom || (effectiveDate && effectiveDate >= observationFrom))
      && (!observationTo || (effectiveDate && effectiveDate <= observationTo));
  });
  function selectPatient(nextPatientId: string) {
    setPatientId(nextPatientId);
    setSelectedPatientRecord(patients.find((patient) => patient.id === nextPatientId));
    setEncounters([]);
    setConditions([]);
    setObservations([]);
    setAppointments([]);
    setEncounterSearch('');
    setEncounterStatusFilter('');
    setEncounterFrom('');
    setEncounterTo('');
    setConditionSearch('');
    setConditionClinicalStatus('');
    setConditionVerificationStatus('');
    setObservationSearch('');
    setObservationCategory('');
    setObservationFrom('');
    setObservationTo('');
    setError(undefined);
    setMessage('');
    setLoading(Boolean(nextPatientId));
  }
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
            Tìm bệnh nhân theo tên
            <input value={patientSearch} onChange={(event) => setPatientSearch(event.currentTarget.value)} placeholder="Nhập tên bệnh nhân" />
          </label>
          <label>
            Bệnh nhân
            <select value={patientId} onChange={(event) => selectPatient(event.currentTarget.value)}>
              <option value="">Chọn bệnh nhân</option>
              {selectedPatientRecord?.id === patientId && !patients.some((patient) => patient.id === patientId) && (
                <option value={selectedPatientRecord.id}>{personName(selectedPatientRecord)}</option>
              )}
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
      {patientId && <div className="stat-grid">
        <section className="stat-card"><span>Lần khám</span><strong>{encounters.length}</strong><small>{inProgressEncounterCount} đang diễn ra</small></section>
        <section className="stat-card"><span>Chẩn đoán đang hoạt động</span><strong>{activeConditionCount}</strong><small>{conditions.length} chẩn đoán được tải</small></section>
        <section className="stat-card"><span>Kết quả</span><strong>{observations.length}</strong><small>{latestObservation?.effectiveDateTime ? `Gần nhất ${new Date(latestObservation.effectiveDateTime).toLocaleDateString('vi-VN')}` : 'Chưa có kết quả'}</small></section>
      </div>}
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
            <label className="full-width">Ghi chú diễn biến<textarea name="encounterNote" maxLength={4000} rows={4} /></label>
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
            <label>Ngày khởi phát<input name="conditionOnsetDate" type="date" /></label>
            <label>Xác minh
              <select name="conditionVerificationStatus" defaultValue="confirmed">
                <option value="confirmed">Đã xác nhận</option>
                <option value="provisional">Tạm thời</option>
                <option value="unconfirmed">Chưa xác minh</option>
                <option value="differential">Chẩn đoán phân biệt</option>
              </select>
            </label>
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
            <label>Phân loại
              <select name="observationCategory" defaultValue="other">
                <option value="vital-signs">Dấu hiệu sinh tồn</option>
                <option value="laboratory">Xét nghiệm</option>
                <option value="other">Khác</option>
              </select>
            </label>
            <label>Giá trị số<input name="observationNumericValue" type="number" step="any" /></label>
            <label>Đơn vị<input name="observationUnit" maxLength={40} placeholder="mmHg, kg, °C…" /></label>
            <label className="full-width">Giá trị dạng văn bản<input name="observationTextValue" maxLength={200} /></label>
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
        <div className="form-grid">
          <label className="full-width">Tìm theo lý do, ghi chú hoặc Appointment
            <input value={encounterSearch} onChange={(event) => setEncounterSearch(event.currentTarget.value)} />
          </label>
          <label>Trạng thái
            <select value={encounterStatusFilter} onChange={(event) => setEncounterStatusFilter(event.currentTarget.value)}>
              <option value="">Tất cả</option>
              <option value="in-progress">Đang khám</option>
              <option value="finished">Đã hoàn tất</option>
              <option value="cancelled">Đã hủy</option>
            </select>
          </label>
          <label>Từ ngày<input type="date" value={encounterFrom} onChange={(event) => setEncounterFrom(event.currentTarget.value)} /></label>
          <label>Đến ngày<input type="date" value={encounterTo} onChange={(event) => setEncounterTo(event.currentTarget.value)} /></label>
        </div>
        {encounters.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Ngày</th><th>Trạng thái</th><th>Lý do</th><th>Ghi chú diễn biến</th><th>Appointment</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
            <tbody>{filteredEncounters.map((encounter) => (
              <tr key={encounter.id}>
                <td>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : '—'}{encounter.period?.end ? ` – ${new Date(encounter.period.end).toLocaleString('vi-VN')}` : ''}</td>
                <td>{encounter.status}</td>
                <td>{encounter.reasonCode?.map((reason) => reason.text ?? reason.coding?.[0]?.display).filter(Boolean).join(', ') || '—'}</td>
                <td>{encounter.note?.map((note) => note.text).filter(Boolean).join('\n') || '—'}</td>
                <td>{encounter.appointment?.map((reference) => {
                  const appointment = appointments.find((item) => reference.reference === `Appointment/${item.id}`);
                  return appointment?.start ? new Date(appointment.start).toLocaleString('vi-VN') : reference.display ?? reference.reference;
                }).join(', ') || '—'}</td>
                {role !== 'Patient' && <td>{encounter.status === 'in-progress' && <>
                  <details>
                    <summary>Bổ sung ghi chú</summary>
                    <form className="editor" onSubmit={(event) => void addEncounterNote(encounter, event)}>
                      <textarea name="encounterNote" maxLength={4000} rows={3} required />
                      <button className="button" disabled={saving}>Lưu ghi chú</button>
                    </form>
                  </details>
                  <button className="button" disabled={saving} onClick={() => void updateEncounterStatus(encounter, 'finished')}>Kết thúc</button>{' '}
                  <button className="button" disabled={saving} onClick={() => void updateEncounterStatus(encounter, 'cancelled')}>Hủy</button>
                </>}</td>}
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="empty">{loading ? 'Đang tải…' : 'Chưa có lần khám trong phạm vi truy cập.'}</p>}
        {encounters.length > 0 && filteredEncounters.length === 0 && <p className="empty">Không có lần khám phù hợp với bộ lọc.</p>}
      </section>
      <section className="panel">
        <h2>Chẩn đoán</h2>
        <div className="form-grid">
          <label className="full-width">Tìm chẩn đoán
            <input value={conditionSearch} onChange={(event) => setConditionSearch(event.currentTarget.value)} />
          </label>
          <label>Trạng thái lâm sàng
            <select value={conditionClinicalStatus} onChange={(event) => setConditionClinicalStatus(event.currentTarget.value)}>
              <option value="">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="resolved">Đã giải quyết</option>
              <option value="inactive">Không hoạt động</option>
              <option value="remission">Thuyên giảm</option>
            </select>
          </label>
          <label>Trạng thái xác minh
            <select value={conditionVerificationStatus} onChange={(event) => setConditionVerificationStatus(event.currentTarget.value)}>
              <option value="">Tất cả</option>
              <option value="confirmed">Đã xác nhận</option>
              <option value="provisional">Tạm thời</option>
              <option value="unconfirmed">Chưa xác minh</option>
              <option value="differential">Chẩn đoán phân biệt</option>
              <option value="refuted">Bác bỏ</option>
            </select>
          </label>
        </div>
        {filteredConditions.length ? <div className="table-wrap"><table>
          <thead><tr><th>Chẩn đoán</th><th>Trạng thái lâm sàng</th><th>Xác minh</th><th>Ngày giải quyết</th><th>Lần khám</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
          <tbody>{filteredConditions.map((condition) => {
            const encounter = encounters.find((item) => condition.encounter?.reference === `Encounter/${item.id}`);
            return (
              <tr key={condition.id}>
                <td>{condition.code?.text ?? condition.code?.coding?.[0]?.display ?? 'Chưa có tên'}</td>
                <td>{condition.clinicalStatus?.coding?.[0]?.code ?? '—'}</td>
                <td>{condition.verificationStatus?.coding?.[0]?.code ?? '—'}</td>
                <td>{condition.abatementDateTime ? new Date(condition.abatementDateTime).toLocaleDateString('vi-VN') : condition.abatementPeriod?.end ? new Date(condition.abatementPeriod.end).toLocaleDateString('vi-VN') : '—'}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : condition.encounter?.display ?? condition.encounter?.reference ?? '—'}</td>
                {role !== 'Patient' && <td>
                  {['provisional', 'unconfirmed', 'differential'].includes(condition.verificationStatus?.coding?.[0]?.code ?? '') && <button className="button" disabled={saving} onClick={() => void confirmCondition(condition)}>Xác nhận</button>}{' '}
                  {condition.clinicalStatus?.coding?.[0]?.code === 'active' && <button className="button" disabled={saving} onClick={() => void resolveCondition(condition)}>Đã giải quyết</button>}
                </td>}
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">{conditions.length ? 'Không có chẩn đoán phù hợp với bộ lọc.' : 'Chưa có chẩn đoán trong phạm vi truy cập.'}</p>}
      </section>
      <section className="panel">
        <h2>Kết quả</h2>
        <div className="form-grid">
          <label className="full-width">Tìm chỉ số
            <input value={observationSearch} onChange={(event) => setObservationSearch(event.currentTarget.value)} />
          </label>
          <label>Phân loại
            <select value={observationCategory} onChange={(event) => setObservationCategory(event.currentTarget.value)}>
              <option value="">Tất cả</option>
              <option value="vital-signs">Dấu hiệu sinh tồn</option>
              <option value="laboratory">Xét nghiệm</option>
              <option value="other">Khác</option>
            </select>
          </label>
          <label>Từ ngày<input type="date" value={observationFrom} onChange={(event) => setObservationFrom(event.currentTarget.value)} /></label>
          <label>Đến ngày<input type="date" value={observationTo} onChange={(event) => setObservationTo(event.currentTarget.value)} /></label>
        </div>
        {filteredObservations.length ? <div className="table-wrap"><table>
          <thead><tr><th>Ngày</th><th>Phân loại</th><th>Chỉ số</th><th>Giá trị</th><th>Lần khám</th></tr></thead>
          <tbody>{filteredObservations.map((observation) => {
            const encounter = encounters.find((item) => observation.encounter?.reference === `Encounter/${item.id}`);
            return (
              <tr key={observation.id}>
                <td>{observation.effectiveDateTime ? new Date(observation.effectiveDateTime).toLocaleString('vi-VN') : '—'}</td>
                <td>{observation.category?.[0]?.coding?.[0]?.display ?? observationCategoryLabels[observation.category?.[0]?.coding?.[0]?.code ?? ''] ?? '—'}</td>
                <td>{observation.code.text ?? observation.code.coding?.[0]?.display ?? '—'}</td>
                <td>{observation.valueString ?? (observation.valueQuantity ? `${observation.valueQuantity.value ?? ''} ${observation.valueQuantity.unit ?? ''}` : '—')}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : observation.encounter?.display ?? observation.encounter?.reference ?? '—'}</td>
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">{observations.length ? 'Không có kết quả phù hợp với bộ lọc.' : 'Chưa có kết quả trong phạm vi truy cập.'}</p>}
      </section>
      {role !== 'Patient' && selectedPatient && <p className="muted">Bác sĩ/nhân viên: dữ liệu chỉ hiện khi FHIR API cho phép đọc bệnh nhân đã chọn.</p>}
    </>
  );
}
