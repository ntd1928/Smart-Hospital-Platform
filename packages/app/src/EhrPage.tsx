import { normalizeErrorString } from '@medplum/core';
import type { Condition, Encounter, Observation, Patient, Practitioner } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import { personName } from './access';
import type { HospitalRole } from './access';

export function EhrPage({ role, profile }: { role: HospitalRole; profile: Patient | Practitioner }): React.ReactElement {
  const client = useMedplum();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState(role === 'Patient' ? profile.id ?? '' : '');
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (role === 'Patient') return;
    let live = true;
    client.searchResources('Patient', { _count: '100', _sort: 'name' })
      .then((results) => {
        if (!live) return;
        setPatients(results);
        if (!patientId && results[0]?.id) setPatientId(results[0].id);
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
    };
  }, [client, patientId, role]);

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
    ])
      .then(([encounterResults, conditionResults, observationResults]) => {
        if (!live) return;
        setEncounters(encounterResults);
        setConditions(conditionResults);
        setObservations(observationResults);
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
      {loading ? <p className="muted">Đang tải hồ sơ…</p> : null}
      <section className="panel">
        <h2>Lần khám</h2>
        {encounters.length ? (
          <div className="table-wrap"><table>
            <thead><tr><th>Ngày</th><th>Trạng thái</th><th>Lý do</th></tr></thead>
            <tbody>{encounters.map((encounter) => (
              <tr key={encounter.id}>
                <td>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : '—'}</td>
                <td>{encounter.status}</td>
                <td>{encounter.reasonCode?.map((reason) => reason.text ?? reason.coding?.[0]?.display).filter(Boolean).join(', ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="empty">{loading ? 'Đang tải…' : 'Chưa có lần khám trong phạm vi truy cập.'}</p>}
      </section>
      <section className="panel">
        <h2>Chẩn đoán</h2>
        {conditions.length ? <ul>{conditions.map((condition) => (
          <li key={condition.id}>{condition.code?.text ?? condition.code?.coding?.[0]?.display ?? 'Chưa có tên'} · {condition.clinicalStatus?.coding?.[0]?.code ?? condition.verificationStatus?.coding?.[0]?.code ?? ''}</li>
        ))}</ul> : <p className="empty">Chưa có chẩn đoán trong phạm vi truy cập.</p>}
      </section>
      <section className="panel">
        <h2>Kết quả</h2>
        {observations.length ? <div className="table-wrap"><table>
          <thead><tr><th>Ngày</th><th>Chỉ số</th><th>Giá trị</th></tr></thead>
          <tbody>{observations.map((observation) => (
            <tr key={observation.id}>
              <td>{observation.effectiveDateTime ? new Date(observation.effectiveDateTime).toLocaleString('vi-VN') : '—'}</td>
              <td>{observation.code.text ?? observation.code.coding?.[0]?.display ?? '—'}</td>
              <td>{observation.valueString ?? (observation.valueQuantity ? `${observation.valueQuantity.value ?? ''} ${observation.valueQuantity.unit ?? ''}` : '—')}</td>
            </tr>
          ))}</tbody>
        </table></div> : <p className="empty">Chưa có kết quả trong phạm vi truy cập.</p>}
      </section>
      {role !== 'Patient' && selectedPatient && <p className="muted">Bác sĩ/nhân viên: dữ liệu chỉ hiện khi FHIR API cho phép đọc bệnh nhân đã chọn.</p>}
    </>
  );
}
