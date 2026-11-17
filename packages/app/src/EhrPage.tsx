import { normalizeErrorString } from '@medplum/core';
import type { AllergyIntolerance, Appointment, Condition, Encounter, MedicationAdministration, MedicationRequest, MedicationStatement, Observation, Parameters, Patient, Practitioner, Resource } from '@medplum/fhirtypes';
import { useMedplum } from '@medplum/react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { personName } from './access';
import type { HospitalRole } from './access';

const observationCategoryLabels: Record<string, string> = {
  'vital-signs': 'Dấu hiệu sinh tồn',
  laboratory: 'Xét nghiệm',
  other: 'Khác',
};

const encounterNoteTypeLabels: Record<string, string> = {
  progress: 'Diễn biến',
  assessment: 'Đánh giá',
  plan: 'Kế hoạch',
  procedure: 'Thủ thuật',
};

function renderEncounterNote(text: string): React.ReactNode {
  const match = /^\[(progress|assessment|plan|procedure)\]\s*/.exec(text);
  return match ? <><strong>{encounterNoteTypeLabels[match[1]]}:</strong> {text.slice(match[0].length)}</> : text;
}

function localDateTimeInput(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
}

export function EhrPage({ role, profile }: { role: HospitalRole; profile: Patient | Practitioner }): React.ReactElement {
  const client = useMedplum();
  const [searchParams] = useSearchParams();
  const requestedPatientId = role === 'Patient' ? profile.id ?? '' : searchParams.get('patient') ?? '';
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientRecord, setSelectedPatientRecord] = useState<Patient>();
  const [patientSearch, setPatientSearch] = useState('');
  const [patientId, setPatientId] = useState(requestedPatientId);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [medicationRequests, setMedicationRequests] = useState<MedicationRequest[]>([]);
  const [medicationStatements, setMedicationStatements] = useState<MedicationStatement[]>([]);
  const [medicationAdministrations, setMedicationAdministrations] = useState<MedicationAdministration[]>([]);
  const [allergies, setAllergies] = useState<AllergyIntolerance[]>([]);
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
  const [medicationSearch, setMedicationSearch] = useState('');
  const [medicationStatusFilter, setMedicationStatusFilter] = useState('');
  const [medicationFrom, setMedicationFrom] = useState('');
  const [medicationTo, setMedicationTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!requestedPatientId) return;
    let live = true;
    client.readResource<Patient>('Patient', requestedPatientId).then((patient) => {
      if (!live) return;
      setPatientId(requestedPatientId);
      setSelectedPatientRecord(patient);
      setPatients((current) => current.some((item) => item.id === patient.id) ? current : [patient, ...current]);
    }).catch((e) => {
      if (live) setError(e);
    });
    return () => {
      live = false;
    };
  }, [client, requestedPatientId]);

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
    const encounterResultsPromise = (async () => {
      const results: Encounter[] = [];
      for await (const page of client.searchResourcePages('Encounter', { patient: patientReference, _count: '100', _sort: '-date' })) results.push(...page);
      return results;
    })();
    const conditionResultsPromise = (async () => {
      const results: Condition[] = [];
      for await (const page of client.searchResourcePages('Condition', { patient: patientReference, _count: '100', _sort: '-onset-date' })) results.push(...page);
      return results;
    })();
    const observationResultsPromise = (async () => {
      const results: Observation[] = [];
      for await (const page of client.searchResourcePages('Observation', { patient: patientReference, _count: '100', _sort: '-date' })) results.push(...page);
      return results;
    })();
    const medicationRequestResultsPromise = (async () => {
      const results: MedicationRequest[] = [];
      for await (const page of client.searchResourcePages('MedicationRequest', { patient: patientReference, _count: '100', _sort: '-authoredon' })) results.push(...page);
      return results;
    })();
    const allergyResultsPromise = (async () => {
      const results: AllergyIntolerance[] = [];
      for await (const page of client.searchResourcePages('AllergyIntolerance', { patient: patientReference, _count: '100', _sort: '-recorded-date' })) results.push(...page);
      return results;
    })();
    const medicationStatementResultsPromise = (async () => {
      const results: MedicationStatement[] = [];
      for await (const page of client.searchResourcePages('MedicationStatement', { patient: patientReference, _count: '100', _sort: '-date-asserted' })) results.push(...page);
      return results;
    })();
    const medicationAdministrationResultsPromise = (async () => {
      const results: MedicationAdministration[] = [];
      for await (const page of client.searchResourcePages('MedicationAdministration', { patient: patientReference, _count: '100' })) results.push(...page);
      return results;
    })();
    const appointmentResultsPromise = (async () => {
      const results: Appointment[] = [];
      for await (const page of client.searchResourcePages('Appointment', { patient: patientReference, _count: '100', _sort: '-date' })) results.push(...page);
      return results;
    })();
    Promise.all([
      encounterResultsPromise,
      conditionResultsPromise,
      observationResultsPromise,
      medicationRequestResultsPromise,
      allergyResultsPromise,
      medicationStatementResultsPromise,
      medicationAdministrationResultsPromise,
      appointmentResultsPromise,
    ])
      .then(([encounterResults, conditionResults, observationResults, medicationRequestResults, allergyResults, medicationStatementResults, medicationAdministrationResults, appointmentResults]) => {
        if (!live) return;
        setEncounters(encounterResults);
        setConditions(conditionResults);
        setObservations(observationResults);
        setMedicationRequests(medicationRequestResults);
        setAllergies(allergyResults);
        setMedicationStatements(medicationStatementResults);
        setMedicationAdministrations(medicationAdministrationResults);
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
    const clinicalNoteType = String(data.get('encounterNoteType') ?? 'progress');
    const appointmentId = String(data.get('encounterAppointment') ?? '');
    const appointmentAlreadyLinked = appointmentId && encounters.some((encounter) =>
      encounter.appointment?.some((reference) => reference.reference === `Appointment/${appointmentId}`)
    );
    if (appointmentAlreadyLinked) {
      setError(new Error('Appointment này đã được liên kết với một Encounter.'));
      return;
    }
    if (!patientId || !reason || !Number.isFinite(start.getTime())) {
      setError(new Error('Chọn bệnh nhân, thời gian và lý do khám hợp lệ.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const parameter: NonNullable<Parameters['parameter']> = [
        { name: 'patient', valueReference: { reference: `Patient/${patientId}` } },
        { name: 'start', valueDateTime: start.toISOString() },
        { name: 'reason', valueString: reason },
        { name: 'noteType', valueCode: clinicalNoteType },
      ];
      if (appointmentId) parameter.push({ name: 'appointment', valueReference: { reference: `Appointment/${appointmentId}` } });
      if (clinicalNote) parameter.push({ name: 'note', valueString: clinicalNote });
      const result = await client.post<Parameters>('fhir/R4/Encounter/$record', { resourceType: 'Parameters', parameter });
      const encounter = result.parameter?.find((item) => item.name === 'return')?.resource as Encounter | undefined;
      if (!encounter) throw new Error('Server did not return the recorded Encounter.');
      setEncounters((current) => [encounter, ...current]);
      setMessage('Đã tạo lần khám.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function completeEncounter(encounter: Encounter, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!encounter.id || encounter.status !== 'in-progress') return;
    const data = new FormData(event.currentTarget);
    const summary = String(data.get('encounterCompletionSummary') ?? '').trim();
    if (summary.length < 10) {
      setError(new Error('Ghi phần tổng kết ít nhất 10 ký tự trước khi kết thúc lần khám.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Encounter/$complete', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'encounter', valueReference: { reference: `Encounter/${encounter.id}` } },
          { name: 'summary', valueString: summary },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as Encounter | undefined;
      if (!updated) throw new Error('Server did not return the completed Encounter.');
      setEncounters((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã kết thúc lần khám và lưu tổng kết.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function cancelEncounter(encounter: Encounter, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!encounter.id || encounter.status !== 'in-progress') return;
    const form = event.currentTarget;
    const reason = String(new FormData(form).get('encounterCancellationReason') ?? '').trim();
    if (!reason) {
      setError(new Error('Nhập lý do hủy lần khám.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Encounter/$cancel', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'encounter', valueReference: { reference: `Encounter/${encounter.id}` } },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as Encounter | undefined;
      if (!updated) throw new Error('Server did not return the cancelled Encounter.');
      setEncounters((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã hủy lần khám và lưu lý do vào lịch sử.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function updateEncounterDetails(encounter: Encounter, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!encounter.id || encounter.status !== 'in-progress') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const startDate = String(data.get('encounterStartDate') ?? '');
    const startTime = String(data.get('encounterStartTime') ?? '');
    const reason = String(data.get('encounterUpdatedReason') ?? '').trim();
    const changeReason = String(data.get('encounterChangeReason') ?? '').trim();
    const start = new Date(`${startDate}T${startTime}`);
    if (!reason || !changeReason || !Number.isFinite(start.getTime()) || (encounter.period?.end && start > new Date(encounter.period.end))) {
      setError(new Error('Nhập lý do khám, lý do chỉnh sửa và thời gian bắt đầu hợp lệ.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Encounter/$update-details', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'encounter', valueReference: { reference: `Encounter/${encounter.id}` } },
          { name: 'start', valueDateTime: start.toISOString() },
          { name: 'reason', valueString: reason },
          { name: 'changeReason', valueString: changeReason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as Encounter | undefined;
      if (!updated) throw new Error('Server did not return the updated Encounter.');
      setEncounters((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã cập nhật lần khám và lưu lịch sử thay đổi.');
      form.reset();
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
    const data = new FormData(form);
    const text = String(data.get('encounterNote') ?? '').trim();
    const type = String(data.get('encounterNoteType') ?? 'progress');
    if (!text) return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Encounter/$add-note', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'encounter', valueReference: { reference: `Encounter/${encounter.id}` } },
          { name: 'type', valueCode: type },
          { name: 'text', valueString: text },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as Encounter | undefined;
      if (!updated) throw new Error('Server did not return the updated Encounter.');
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
      const result = await client.post<Parameters>('fhir/R4/Condition/$record', {
        resourceType: 'Parameters',
        parameter: [{ name: 'resource', resource: {
        resourceType: 'Condition',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: verificationStatus }] },
        code: { text: code },
        subject: { reference: `Patient/${patientId}` },
        encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        onsetDateTime: onsetDate ? new Date(`${onsetDate}T00:00:00`).toISOString() : undefined,
        recordedDate: new Date().toISOString(),
        } }],
      });
      const condition = result.parameter?.find((item) => item.name === 'return')?.resource as Condition | undefined;
      if (!condition) throw new Error('Server did not return the recorded Condition.');
      setConditions((current) => [condition, ...current]);
      setMessage('Đã lưu chẩn đoán.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function reviewCondition(condition: Condition, change: 'confirm' | 'refute' | 'active' | 'inactive' | 'resolved', event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!condition.id) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const reason = String(data.get('conditionReviewReason') ?? '').trim();
    if (!reason) {
      setError(new Error('Nhập lý do cập nhật chẩn đoán.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Condition/$review', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'condition', valueReference: { reference: `Condition/${condition.id}` } },
          { name: 'change', valueCode: change },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as Condition | undefined;
      if (!updated) throw new Error('Server did not return the reviewed Condition.');
      setConditions((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(`Đã cập nhật chẩn đoán (${change}) và lưu lý do.`);
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
      const result = await client.post<Parameters>('fhir/R4/Observation/$record', {
        resourceType: 'Parameters',
        parameter: [{ name: 'resource', resource: {
          resourceType: 'Observation',
          status: 'final',
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: category, display: observationCategoryLabels[category] ?? category }] }],
          code: { text: code },
          subject: { reference: `Patient/${patientId}` },
          encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
          effectiveDateTime: effectiveDateTime ? new Date(effectiveDateTime).toISOString() : new Date().toISOString(),
          ...(numericValue ? { valueQuantity: { value: Number(numericValue), unit: unit || undefined } } : { valueString: textValue }),
        } }],
      });
      const observation = result.parameter?.find((item) => item.name === 'return')?.resource as Observation | undefined;
      if (!observation) throw new Error('Server did not return the recorded Observation.');
      setObservations((current) => [observation, ...current]);
      setMessage('Đã lưu kết quả.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function createVitalSigns(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId) {
      setError(new Error('Chọn bệnh nhân trước khi ghi dấu hiệu sinh tồn.'));
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const measuredAt = String(data.get('vitalDateTime') ?? '');
    const encounterId = String(data.get('vitalEncounter') ?? '');
    const systolic = String(data.get('vitalSystolic') ?? '').trim();
    const diastolic = String(data.get('vitalDiastolic') ?? '').trim();
    const fields = [
      { name: 'vitalHeartRate', code: '8867-4', display: 'Heart rate', text: 'Nhịp tim', unit: 'lần/phút', ucum: '/min' },
      { name: 'vitalRespiratoryRate', code: '9279-1', display: 'Respiratory rate', text: 'Nhịp thở', unit: 'lần/phút', ucum: '/min' },
      { name: 'vitalTemperature', code: '8310-5', display: 'Body temperature', text: 'Nhiệt độ cơ thể', unit: '°C', ucum: 'Cel' },
      { name: 'vitalWeight', code: '29463-7', display: 'Body weight', text: 'Cân nặng', unit: 'kg', ucum: 'kg' },
      { name: 'vitalHeight', code: '8302-2', display: 'Body height', text: 'Chiều cao', unit: 'cm', ucum: 'cm' },
    ];
    const values = fields.map((field) => ({ ...field, raw: String(data.get(field.name) ?? '').trim() }))
      .filter((field) => field.raw)
      .map((field) => ({ ...field, value: Number(field.raw) }));
    const hasBloodPressure = Boolean(systolic || diastolic);
    if (!Number.isFinite(new Date(measuredAt).getTime()) || (!!systolic !== !!diastolic) ||
      values.some((field) => !Number.isFinite(field.value) || (field.name !== 'vitalTemperature' && field.value <= 0)) ||
      (hasBloodPressure && (![systolic, diastolic].every((value) => Number.isFinite(Number(value)) && Number(value) > 0))) ||
      (!values.length && !hasBloodPressure) ||
      (encounterId && !encounters.some((encounter) => encounter.id === encounterId && encounter.status === 'in-progress'))) {
      setError(new Error('Nhập ít nhất một giá trị dương hợp lệ; huyết áp cần đủ tâm thu và tâm trương, thời điểm và lần khám phải hợp lệ.'));
      return;
    }

    const effectiveDateTime = new Date(measuredAt).toISOString();
    const common = {
      resourceType: 'Observation' as const,
      status: 'final' as const,
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
      subject: { reference: `Patient/${patientId}` },
      encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
      effectiveDateTime,
    };
    const observations: Observation[] = values.map((field) => ({
      ...common,
      code: { coding: [{ system: 'http://loinc.org', code: field.code, display: field.display }], text: field.text },
      valueQuantity: { value: field.value, unit: field.unit, system: 'http://unitsofmeasure.org', code: field.ucum },
    }));
    if (hasBloodPressure) {
      observations.push({
        ...common,
        code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel with all children optional' }], text: 'Huyết áp' },
        component: [
          { code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }], text: 'Tâm thu' }, valueQuantity: { value: Number(systolic), unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
          { code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }], text: 'Tâm trương' }, valueQuantity: { value: Number(diastolic), unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' } },
        ],
      });
    }

    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Observation/$record', {
        resourceType: 'Parameters',
        parameter: observations.map((observation) => ({ name: 'resource', resource: observation })),
      });
      const created = result.parameter?.filter((item) => item.name === 'return').map((item) => item.resource as Observation) ?? [];
      if (created.length !== observations.length) throw new Error('Server did not return every recorded Observation.');
      const latest: Observation[] = [];
      for await (const page of client.searchResourcePages('Observation', { patient: `Patient/${patientId}`, _count: '100', _sort: '-date' })) latest.push(...page);
      setObservations(latest);
      setMessage(`Đã lưu ${observations.length} Observation dấu hiệu sinh tồn trong một transaction.`);
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function amendObservation(observation: Observation, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!observation.id) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const code = String(data.get('observationUpdatedCode') ?? '').trim();
    const dateTime = String(data.get('observationUpdatedDateTime') ?? '');
    const numericValue = String(data.get('observationUpdatedNumericValue') ?? '').trim();
    const systolicValue = String(data.get('observationUpdatedSystolic') ?? '').trim();
    const diastolicValue = String(data.get('observationUpdatedDiastolic') ?? '').trim();
    const textValue = String(data.get('observationUpdatedTextValue') ?? '').trim();
    const unit = String(data.get('observationUpdatedUnit') ?? '').trim();
    const reason = String(data.get('observationAmendmentReason') ?? '').trim();
    const systolicComponent = observation.component?.find((component) => component.code.coding?.some((coding) => coding.code === '8480-6'));
    const diastolicComponent = observation.component?.find((component) => component.code.coding?.some((coding) => coding.code === '8462-4'));
    const isBloodPressure = !!systolicComponent && !!diastolicComponent;
    if ((!isBloodPressure && !code) || !dateTime || !Number.isFinite(new Date(dateTime).getTime()) || (isBloodPressure
      ? (!systolicValue || !diastolicValue || !Number.isFinite(Number(systolicValue)) || !Number.isFinite(Number(diastolicValue)))
      : ((!!numericValue === !!textValue) || (numericValue && !Number.isFinite(Number(numericValue))))) || !reason) {
      setError(new Error('Nhập thời điểm, giá trị hợp lệ và lý do sửa kết quả.'));
      return;
    }
    const previousValue = formatObservationValue(observation);
    const nextValue = isBloodPressure
      ? `Tâm thu ${Number(systolicValue)} ${systolicComponent.valueQuantity?.unit ?? 'mmHg'}; tâm trương ${Number(diastolicValue)} ${diastolicComponent.valueQuantity?.unit ?? 'mmHg'}`
      : numericValue ? `${Number(numericValue)} ${unit}`.trim() : textValue;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Observation/$update', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'observation', valueReference: { reference: `Observation/${observation.id}` } },
          { name: 'action', valueCode: 'amend' },
          { name: 'reason', valueString: reason },
          { name: 'resource', resource: {
            ...observation,
            status: 'amended',
            code: isBloodPressure ? observation.code : { text: code },
            effectiveDateTime: new Date(dateTime).toISOString(),
            ...(isBloodPressure ? {
              component: observation.component?.map((component) => {
                const coding = component.code.coding?.[0];
                if (coding?.code === '8480-6') return { ...component, valueQuantity: { ...component.valueQuantity, value: Number(systolicValue) } };
                if (coding?.code === '8462-4') return { ...component, valueQuantity: { ...component.valueQuantity, value: Number(diastolicValue) } };
                return component;
              }),
            } : numericValue ? { valueQuantity: { value: Number(numericValue), unit: unit || undefined }, valueString: undefined } : { valueString: textValue, valueQuantity: undefined }),
          } },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as Observation | undefined;
      if (!updated) throw new Error('Server did not return the amended Observation.');
      setObservations((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã sửa kết quả và lưu lý do vào ghi chú audit.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  function formatObservationValue(observation: Observation): string {
    if (observation.valueString) return observation.valueString;
    if (observation.valueQuantity) return `${observation.valueQuantity.value ?? ''} ${observation.valueQuantity.unit ?? ''}`.trim();
    if (observation.component?.length) return observation.component.map((component) => `${component.code.text ?? component.code.coding?.[0]?.display ?? 'Componente'}: ${component.valueQuantity?.value ?? '—'} ${component.valueQuantity?.unit ?? ''}`.trim()).join('; ');
    return '—';
  }

  async function markObservationEnteredInError(observation: Observation, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!observation.id || observation.status === 'entered-in-error') return;
    const form = event.currentTarget;
    const reason = String(new FormData(form).get('observationErrorReason') ?? '').trim();
    if (!reason) return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/Observation/$update', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'observation', valueReference: { reference: `Observation/${observation.id}` } },
          { name: 'action', valueCode: 'entered-in-error' },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as Observation | undefined;
      if (!updated) throw new Error('Server did not return the updated Observation.');
      setObservations((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã đánh dấu kết quả nhập nhầm và lưu lý do.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function createMedicationRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const medication = String(data.get('medicationName') ?? '').trim();
    const dosage = String(data.get('medicationDosage') ?? '').trim();
    const doseValue = String(data.get('medicationDoseValue') ?? '').trim();
    const doseUnit = String(data.get('medicationDoseUnit') ?? '').trim();
    const route = String(data.get('medicationRoute') ?? '').trim();
    const frequency = String(data.get('medicationFrequency') ?? '').trim();
    const quantity = String(data.get('medicationQuantity') ?? '').trim();
    const quantityUnit = String(data.get('medicationQuantityUnit') ?? '').trim();
    const repeats = String(data.get('medicationRepeats') ?? '').trim();
    const allergyReviewAcknowledged = data.get('medicationAllergyReview') === 'on';
    const activeMedicationAllergies = allergies.filter((allergy) =>
      allergy.clinicalStatus?.coding?.[0]?.code === 'active' && allergy.category?.includes('medication')
    );
    if (!patientId || !medication || !dosage || (!!doseValue !== !!doseUnit) || (doseValue && (!Number.isFinite(Number(doseValue)) || Number(doseValue) <= 0)) || (quantity && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0)) || (repeats && (!Number.isInteger(Number(repeats)) || Number(repeats) < 0))) {
      setError(new Error('Chọn bệnh nhân và nhập thuốc, hướng dẫn dùng cùng số lượng hợp lệ.'));
      return;
    }
    if (activeMedicationAllergies.length && !allergyReviewAcknowledged) {
      setError(new Error('Hãy xem và xác nhận đã đánh giá các dị ứng thuốc đang hoạt động trước khi lưu.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const encounterId = String(data.get('medicationEncounter') ?? '');
      const resource: MedicationRequest = {
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: { text: medication },
        subject: { reference: `Patient/${patientId}` },
        requester: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined,
        encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        authoredOn: new Date().toISOString(),
        dosageInstruction: [{
          text: dosage,
          doseAndRate: doseValue ? [{ doseQuantity: { value: Number(doseValue), unit: doseUnit } }] : undefined,
          route: route ? { text: route } : undefined,
          timing: frequency ? { code: { text: frequency } } : undefined,
        }],
        dispenseRequest: {
          quantity: quantity ? { value: Number(quantity), unit: quantityUnit || undefined } : undefined,
          numberOfRepeatsAllowed: repeats ? Number(repeats) : undefined,
        },
      };
      const result = await client.post<Parameters>('fhir/R4/MedicationRequest/$record', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'resource', resource },
          { name: 'allergy-reviewed', valueBoolean: allergyReviewAcknowledged },
        ],
      });
      const request = result.parameter?.find((item) => item.name === 'return')?.resource as MedicationRequest | undefined;
      if (!request) throw new Error('Server did not return the MedicationRequest.');
      setMedicationRequests((current) => [request, ...current]);
      setMessage('Đã lưu yêu cầu thuốc.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function createMedicationAdministration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const requestId = String(data.get('administrationRequest') ?? '');
    const request = medicationRequests.find((item) => item.id === requestId);
    const enteredMedication = String(data.get('administrationMedication') ?? '').trim();
    const medicationConcept = request?.medicationCodeableConcept;
    const hasMedicationConcept = Boolean(medicationConcept?.text || medicationConcept?.coding?.length);
    const medicationName = medicationConcept?.text ?? medicationConcept?.coding?.find((coding) => coding.display)?.display ?? request?.medicationReference?.display;
    const medicationChoice = hasMedicationConcept
      ? { medicationCodeableConcept: medicationConcept }
      : request?.medicationReference?.reference
        ? { medicationReference: request.medicationReference }
        : { medicationCodeableConcept: { text: enteredMedication || medicationName } };
    const doseValue = String(data.get('administrationDoseValue') ?? '').trim();
    const doseUnit = String(data.get('administrationDoseUnit') ?? '').trim();
    const route = String(data.get('administrationRoute') ?? '').trim();
    const effective = String(data.get('administrationTime') ?? '');
    const effectiveDate = new Date(effective);
    const noteText = String(data.get('administrationNote') ?? '').trim();
    if (!patientId || (!enteredMedication && !hasMedicationConcept && !request?.medicationReference?.reference) || (!!doseValue !== !!doseUnit) || (doseValue && (!Number.isFinite(Number(doseValue)) || Number(doseValue) <= 0)) || !Number.isFinite(effectiveDate.getTime()) || effectiveDate.getTime() > Date.now()) {
      setError(new Error('Chọn bệnh nhân, thuốc, thời điểm đã dùng và liều dùng hợp lệ.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const encounterId = String(data.get('administrationEncounter') ?? '');
      const result = await client.post<Parameters>('fhir/R4/MedicationAdministration/$record', {
        resourceType: 'Parameters',
        parameter: [{ name: 'resource', resource: {
          resourceType: 'MedicationAdministration',
          status: 'completed',
          ...medicationChoice,
          subject: { reference: `Patient/${patientId}` },
          effectiveDateTime: effectiveDate.toISOString(),
          request: requestId ? { reference: `MedicationRequest/${requestId}` } : undefined,
          context: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
          dosage: doseValue || route
            ? {
                dose: doseValue ? { value: Number(doseValue), unit: doseUnit } : undefined,
                route: route ? { text: route } : undefined,
              }
            : undefined,
          note: noteText ? [{ text: noteText, time: new Date().toISOString(), authorReference: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined }] : undefined,
        } }],
      });
      const administration = result.parameter?.find((item) => item.name === 'return')?.resource as MedicationAdministration | undefined;
      if (!administration) throw new Error('Server did not return the recorded MedicationAdministration.');
      setMedicationAdministrations((current) => [administration, ...current]);
      setMessage('Đã ghi nhận lần dùng thuốc thực tế.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function markMedicationAdministrationEnteredInError(administration: MedicationAdministration, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!administration.id || administration.status !== 'completed') return;
    const form = event.currentTarget;
    const reason = String(new FormData(form).get('administrationErrorReason') ?? '').trim();
    if (!reason) return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/MedicationAdministration/$update', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'administration', valueReference: { reference: `MedicationAdministration/${administration.id}` } },
          { name: 'status', valueCode: 'entered-in-error' },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as MedicationAdministration | undefined;
      if (!updated) throw new Error('Server did not return the corrected MedicationAdministration.');
      setMedicationAdministrations((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã đánh dấu lần dùng thuốc nhập nhầm và giữ dữ liệu gốc trong lịch sử.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function createMedicationStatement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const medication = String(data.get('statementMedication') ?? '').trim();
    const dosage = String(data.get('statementDosage') ?? '').trim();
    const doseValue = String(data.get('statementDoseValue') ?? '').trim();
    const doseUnit = String(data.get('statementDoseUnit') ?? '').trim();
    const route = String(data.get('statementRoute') ?? '').trim();
    const frequency = String(data.get('statementFrequency') ?? '').trim();
    const statusInput = String(data.get('statementStatus') ?? 'active');
    const effectiveDate = String(data.get('statementEffectiveDate') ?? '');
    const reason = String(data.get('statementReason') ?? '').trim();
    const sourceType = String(data.get('statementSource') ?? 'patient');
    if (!patientId || !medication || !dosage || (!!doseValue !== !!doseUnit) || (doseValue && (!Number.isFinite(Number(doseValue)) || Number(doseValue) <= 0)) || (effectiveDate && !Number.isFinite(new Date(effectiveDate).getTime()))) {
      setError(new Error('Chọn bệnh nhân, thuốc, cách dùng và ngày hợp lệ.'));
      return;
    }
    if (statusInput !== 'active' && statusInput !== 'completed' && statusInput !== 'stopped' && statusInput !== 'on-hold' && statusInput !== 'not-taken') {
      setError(new Error('Trạng thái thuốc đang dùng không hợp lệ.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const encounterId = String(data.get('statementEncounter') ?? '');
      const medicationRequestId = String(data.get('statementMedicationRequest') ?? '');
      const resource: MedicationStatement = {
        resourceType: 'MedicationStatement',
        status: statusInput,
        medicationCodeableConcept: { text: medication },
        subject: { reference: `Patient/${patientId}` },
        informationSource: sourceType === 'practitioner' && profile.id
          ? { reference: `Practitioner/${profile.id}` }
          : { reference: `Patient/${patientId}` },
        context: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        basedOn: medicationRequestId ? [{ reference: `MedicationRequest/${medicationRequestId}` }] : undefined,
        dateAsserted: new Date().toISOString(),
        effectiveDateTime: effectiveDate ? new Date(`${effectiveDate}T00:00:00`).toISOString() : undefined,
        dosage: [{
          text: dosage,
          doseAndRate: doseValue ? [{ doseQuantity: { value: Number(doseValue), unit: doseUnit } }] : undefined,
          route: route ? { text: route } : undefined,
          timing: frequency ? { code: { text: frequency } } : undefined,
        }],
        statusReason: reason ? [{ text: reason }] : undefined,
      };
      const recorded = await client.post<Parameters>('fhir/R4/MedicationStatement/$record', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'resource', resource },
          { name: 'source', valueCode: sourceType },
        ],
      });
      const statement = recorded.parameter?.find((item) => item.name === 'return')?.resource as MedicationStatement | undefined;
      if (!statement) throw new Error('Server did not return the reconciled MedicationStatement.');
      setMedicationStatements((current) => [statement, ...current]);
      setMessage('Đã ghi nhận thuốc trong danh sách đối soát.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function updateMedicationStatement(statement: MedicationStatement, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statement.id) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const statusInput = String(data.get('statementNextStatus') ?? '');
    const reason = String(data.get('statementUpdateReason') ?? '').trim();
    if (statusInput !== 'active' && statusInput !== 'completed' && statusInput !== 'stopped' && statusInput !== 'on-hold' && statusInput !== 'not-taken') {
      setError(new Error('Trạng thái thuốc đang dùng không hợp lệ.'));
      return;
    }
    if (!reason) {
      setError(new Error('Nhập lý do cập nhật trạng thái thuốc.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/MedicationStatement/$update-status', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'statement', valueReference: { reference: `MedicationStatement/${statement.id}` } },
          { name: 'status', valueCode: statusInput },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as MedicationStatement | undefined;
      if (!updated) throw new Error('Server did not return the updated MedicationStatement.');
      setMedicationStatements((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã cập nhật thuốc trong danh sách đối soát.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function updateMedicationRequestStatus(
    request: MedicationRequest,
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    if (!request.id || request.status !== 'active') return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const statusInput = String(data.get('medicationNextStatus') ?? '');
    const reason = String(data.get('medicationStatusReason') ?? '').trim();
    if (statusInput !== 'stopped' && statusInput !== 'cancelled' && statusInput !== 'completed') {
      setError(new Error('Trạng thái yêu cầu thuốc không hợp lệ.'));
      return;
    }
    const status = statusInput;
    if (!reason) {
      setError(new Error('Nhập lý do cập nhật trạng thái yêu cầu thuốc.'));
      return;
    }
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/MedicationRequest/$update-status', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'request', valueReference: { reference: `MedicationRequest/${request.id}` } },
          { name: 'status', valueCode: status },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as MedicationRequest | undefined;
      if (!updated) throw new Error('Server did not return the updated MedicationRequest.');
      setMedicationRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(status === 'completed' ? 'Đã đánh dấu liệu trình hoàn tất.' : status === 'cancelled' ? 'Đã hủy yêu cầu thuốc.' : 'Đã ngừng yêu cầu thuốc.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function markMedicationRequestEnteredInError(request: MedicationRequest, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request.id || request.status === 'entered-in-error') return;
    const form = event.currentTarget;
    const reason = String(new FormData(form).get('medicationEntryErrorReason') ?? '').trim();
    if (!reason) return;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const result = await client.post<Parameters>('fhir/R4/MedicationRequest/$update-status', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'request', valueReference: { reference: `MedicationRequest/${request.id}` } },
          { name: 'status', valueCode: 'entered-in-error' },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = result.parameter?.find((item) => item.name === 'return')?.resource as MedicationRequest | undefined;
      if (!updated) throw new Error('Server did not return the updated MedicationRequest.');
      setMedicationRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage('Đã đánh dấu yêu cầu thuốc nhập nhầm và lưu lý do.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function createAllergyIntolerance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const allergen = String(data.get('allergySubstance') ?? '').trim();
    const categoryInput = String(data.get('allergyCategory') ?? 'medication');
    const verificationInput = String(data.get('allergyVerification') ?? 'confirmed');
    const criticalityInput = String(data.get('allergyCriticality') ?? '');
    const onsetDate = String(data.get('allergyOnsetDate') ?? '');
    const reactionText = String(data.get('allergyReaction') ?? '').trim();
    const reactionSeverity = String(data.get('allergyReactionSeverity') ?? '');
    if (!patientId || !allergen || (onsetDate && !Number.isFinite(new Date(onsetDate).getTime()))) {
      setError(new Error('Chọn bệnh nhân, nhập tác nhân gây dị ứng và ngày khởi phát hợp lệ.'));
      return;
    }
    const category = categoryInput === 'food' || categoryInput === 'environment' || categoryInput === 'biologic' ? categoryInput : 'medication';
    const verificationStatus = verificationInput === 'unconfirmed' ? 'unconfirmed' : 'confirmed';
    const criticality = criticalityInput === 'low' || criticalityInput === 'high' ? criticalityInput : undefined;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const resource: AllergyIntolerance = {
        resourceType: 'AllergyIntolerance',
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: verificationStatus }] },
        category: [category],
        criticality,
        code: { text: allergen },
        patient: { reference: `Patient/${patientId}` },
        onsetDateTime: onsetDate ? new Date(`${onsetDate}T00:00:00`).toISOString() : undefined,
        recordedDate: new Date().toISOString(),
        reaction: reactionText ? [{ manifestation: [{ text: reactionText }], severity: reactionSeverity === 'mild' || reactionSeverity === 'moderate' || reactionSeverity === 'severe' ? reactionSeverity : undefined }] : undefined,
      };
      const result = await client.post<Parameters>('fhir/R4/AllergyIntolerance/$record', {
        resourceType: 'Parameters',
        parameter: [{ name: 'resource', resource }],
      });
      const allergy = result.parameter?.find((item) => item.name === 'return')?.resource as AllergyIntolerance | undefined;
      if (!allergy) throw new Error('Server did not return the AllergyIntolerance.');
      setAllergies((current) => [allergy, ...current]);
      setMessage('Đã ghi nhận dị ứng.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function updateAllergyStatus(allergy: AllergyIntolerance, status: 'inactive' | 'resolved') {
    if (!allergy.id || allergy.clinicalStatus?.coding?.[0]?.code !== 'active') return;
    const reason = window.prompt('Lý do thay đổi trạng thái dị ứng?')?.trim();
    if (!reason) return;
    const result = await updateAllergyReview(allergy, status, reason);
    if (!result) return;
    setAllergies((current) => current.map((item) => item.id === result.id ? result : item));
    setMessage(status === 'resolved' ? 'Đã đánh dấu dị ứng đã hết.' : 'Đã đánh dấu dị ứng không còn hoạt động.');
  }

  async function reviewAllergyVerification(allergy: AllergyIntolerance, status: 'confirmed' | 'refuted') {
    if (!allergy.id || allergy.verificationStatus?.coding?.[0]?.code !== 'unconfirmed') return;
    const reason = window.prompt(status === 'confirmed' ? 'Lý do xác nhận dị ứng?' : 'Lý do bác bỏ bản ghi dị ứng?')?.trim();
    if (!reason) return;
    const result = await updateAllergyReview(allergy, status, reason);
    if (!result) return;
    setAllergies((current) => current.map((item) => item.id === result.id ? result : item));
    setMessage(status === 'confirmed' ? 'Đã xác nhận dị ứng.' : 'Đã bác bỏ bản ghi dị ứng.');
  }

  async function updateAllergyReview(
    allergy: AllergyIntolerance,
    status: 'confirmed' | 'refuted' | 'inactive' | 'resolved',
    reason: string
  ): Promise<AllergyIntolerance | undefined> {
    if (!allergy.id) return undefined;
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const response = await client.post<Parameters>('fhir/R4/AllergyIntolerance/$review', {
        resourceType: 'Parameters',
        parameter: [
          { name: 'allergy', valueReference: { reference: `AllergyIntolerance/${allergy.id}` } },
          { name: 'status', valueCode: status },
          { name: 'reason', valueString: reason },
        ],
      });
      const updated = response.parameter?.find((item) => item.name === 'return')?.resource as AllergyIntolerance | undefined;
      if (!updated) throw new Error('Server did not return the reviewed AllergyIntolerance.');
      return updated;
    } catch (e) {
      setError(e);
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  const selectedPatient = patients.find((patient) => patient.id === patientId) ?? selectedPatientRecord ?? (role === 'Patient' ? profile as Patient : undefined);
  function exportFhirDocument(): void {
    if (!selectedPatient?.id || !profile.id || (profile.resourceType !== 'Patient' && profile.resourceType !== 'Practitioner')) {
      setError(new Error('Cần có hồ sơ bệnh nhân và người lập hồ sơ để xuất FHIR document.'));
      return;
    }
    const resources: Resource[] = [
      selectedPatient,
      profile,
      ...encounters,
      ...appointments,
      ...conditions,
      ...observations,
      ...allergies,
      ...medicationRequests,
      ...medicationStatements,
      ...medicationAdministrations,
    ];
    const uniqueResources = [...new Map(resources.filter((resource) => resource.id).map((resource) => [`${resource.resourceType}/${resource.id}`, resource])).values()];
    const fullUrlByReference = new Map(uniqueResources.map((resource) => [
      `${resource.resourceType}/${resource.id}`,
      `urn:uuid:${crypto.randomUUID()}`,
    ]));
    const compositionId = crypto.randomUUID();
    const compositionFullUrl = `urn:uuid:${crypto.randomUUID()}`;
    const referenceFor = (resource: Resource): string | undefined => resource.id ? fullUrlByReference.get(`${resource.resourceType}/${resource.id}`) : undefined;
    const sections = [
      { title: 'Lần khám', resources: encounters },
      { title: 'Cuộc hẹn', resources: appointments },
      { title: 'Chẩn đoán và vấn đề', resources: conditions },
      { title: 'Dấu hiệu và kết quả', resources: observations },
      { title: 'Dị ứng', resources: allergies },
      { title: 'Thuốc', resources: [...medicationRequests, ...medicationStatements, ...medicationAdministrations] },
    ].map((section) => ({
      title: section.title,
      entry: section.resources.map(referenceFor).filter((reference): reference is string => Boolean(reference)).map((reference) => ({ reference })),
    })).filter((section) => section.entry.length);
    const rewriteReferences = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewriteReferences);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
          key,
          key === 'reference' && typeof nested === 'string' ? fullUrlByReference.get(nested) ?? nested : rewriteReferences(nested),
        ]));
      }
      return value;
    };
    const now = new Date().toISOString();
    const composition = {
      resourceType: 'Composition',
      id: compositionId,
      status: 'preliminary',
      type: { coding: [{ system: 'http://loinc.org', code: '34133-9', display: 'Summary of Episode Note' }], text: 'Tóm tắt hồ sơ bệnh án' },
      subject: { reference: referenceFor(selectedPatient) },
      date: now,
      author: [{ reference: referenceFor(profile) }],
      title: 'Tóm tắt hồ sơ bệnh án (bản nháp)',
      section: sections,
    };
    const bundle = {
      resourceType: 'Bundle',
      identifier: { system: 'urn:ietf:rfc:3986', value: `urn:uuid:${crypto.randomUUID()}` },
      type: 'document',
      timestamp: now,
      entry: [
        { fullUrl: compositionFullUrl, resource: composition },
        ...uniqueResources.map((resource) => ({
          fullUrl: fullUrlByReference.get(`${resource.resourceType}/${resource.id}`),
          resource: rewriteReferences(resource),
        })),
      ],
    };
    const file = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `fhir-summary-${selectedPatient.id}-${now.slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setError(undefined);
    setMessage(`Đã xuất FHIR document preliminary với ${uniqueResources.length} tài nguyên đang có trong hồ sơ tải.`);
  }
  const inProgressEncounterCount = encounters.filter((encounter) => encounter.status === 'in-progress').length;
  const activeConditionCount = conditions.filter((condition) => condition.clinicalStatus?.coding?.[0]?.code === 'active').length;
  const ehrConsistencyFindings: string[] = [];
  const encounterIds = new Set(encounters.map((item) => item.id).filter(Boolean));
  const appointmentById = new Map(appointments.filter((item) => item.id).map((item) => [item.id as string, item]));
  const medicationRequestIds = new Set(medicationRequests.map((item) => item.id).filter(Boolean));
  for (const encounter of encounters) {
    for (const reference of encounter.appointment ?? []) {
      const match = /^Appointment\/([^/]+)$/.exec(reference.reference ?? '');
      if (!match) continue;
      const appointment = appointmentById.get(match[1]);
      if (!appointment) ehrConsistencyFindings.push(`Encounter ${encounter.id}: Appointment ${match[1]} chưa có trong hồ sơ được tải.`);
      else if (appointment.status !== 'fulfilled') ehrConsistencyFindings.push(`Encounter ${encounter.id}: Appointment ${match[1]} đang ở trạng thái ${appointment.status}, không phải fulfilled.`);
    }
  }
  const checkEncounterReference = (resourceType: string, resourceId: string | undefined, reference: string | undefined): void => {
    if (!reference) return;
    const match = /^Encounter\/([^/]+)$/.exec(reference);
    if (match && !encounterIds.has(match[1])) ehrConsistencyFindings.push(`${resourceType} ${resourceId ?? '(chưa có id)'}: Encounter ${match[1]} chưa có trong hồ sơ được tải.`);
  };
  for (const condition of conditions) checkEncounterReference('Condition', condition.id, condition.encounter?.reference);
  for (const observation of observations) checkEncounterReference('Observation', observation.id, observation.encounter?.reference);
  for (const request of medicationRequests) checkEncounterReference('MedicationRequest', request.id, request.encounter?.reference);
  for (const statement of medicationStatements) {
    checkEncounterReference('MedicationStatement', statement.id, statement.context?.reference);
    for (const reference of statement.basedOn ?? []) {
      const match = /^MedicationRequest\/([^/]+)$/.exec(reference.reference ?? '');
      if (match && !medicationRequestIds.has(match[1])) ehrConsistencyFindings.push(`MedicationStatement ${statement.id}: MedicationRequest ${match[1]} chưa có trong hồ sơ được tải.`);
    }
  }
  for (const administration of medicationAdministrations) {
    checkEncounterReference('MedicationAdministration', administration.id, administration.context?.reference);
    const match = /^MedicationRequest\/([^/]+)$/.exec(administration.request?.reference ?? '');
    if (match && !medicationRequestIds.has(match[1])) {
      ehrConsistencyFindings.push(`MedicationAdministration ${administration.id}: MedicationRequest ${match[1]} chưa có trong hồ sơ được tải.`);
    }
  }
  const activeAllergies = allergies.filter((allergy) =>
    allergy.clinicalStatus?.coding?.[0]?.code === 'active' &&
    !['refuted', 'entered-in-error'].includes(allergy.verificationStatus?.coding?.[0]?.code ?? '')
  );
  const activeMedicationAllergies = activeAllergies.filter((allergy) => allergy.category?.includes('medication'));
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
  const medicationQuery = medicationSearch.trim().toLocaleLowerCase();
  const filteredMedicationRequests = medicationRequests.filter((request) => {
    const name = request.medicationCodeableConcept?.text ?? request.medicationCodeableConcept?.coding?.[0]?.display ?? '';
    const authoredDate = request.authoredOn?.slice(0, 10) ?? '';
    const searchableText = [
      name,
      request.dosageInstruction?.map((instruction) => instruction.text).join(' '),
      request.statusReason?.text,
      request.note?.map((note) => note.text).join(' '),
    ].join(' ').toLocaleLowerCase();
    return (!medicationQuery || searchableText.includes(medicationQuery))
      && (!medicationStatusFilter || request.status === medicationStatusFilter)
      && (!medicationFrom || (authoredDate && authoredDate >= medicationFrom))
      && (!medicationTo || (authoredDate && authoredDate <= medicationTo));
  });
  function selectPatient(nextPatientId: string) {
    setPatientId(nextPatientId);
    setSelectedPatientRecord(patients.find((patient) => patient.id === nextPatientId));
    setEncounters([]);
    setConditions([]);
    setObservations([]);
    setMedicationRequests([]);
    setMedicationStatements([]);
    setMedicationAdministrations([]);
    setAllergies([]);
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
    setMedicationSearch('');
    setMedicationStatusFilter('');
    setMedicationFrom('');
    setMedicationTo('');
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
        {patientId && selectedPatient && <div className="form-actions">
          <button className="button" disabled={loading} onClick={() => window.print()}>In tóm tắt hồ sơ</button>
          <button className="button" disabled={loading} onClick={exportFhirDocument}>Xuất FHIR document</button>
        </div>}
      </div>
      {patientId && selectedPatient && !loading && <article className="ehr-print-summary" aria-hidden="true">
        <h1>Tóm tắt hồ sơ bệnh án</h1>
        <p><strong>Bệnh nhân:</strong> {personName(selectedPatient)}{selectedPatient.birthDate ? ` · Ngày sinh ${new Date(`${selectedPatient.birthDate}T00:00:00`).toLocaleDateString('vi-VN')}` : ''}</p>
        <p><strong>Ngày lập:</strong> {new Date().toLocaleString('vi-VN')}</p>
        <h2>Dị ứng đang hoạt động</h2>
        {activeAllergies.length ? <ul>{activeAllergies.map((allergy) => <li key={allergy.id}>{allergy.code?.text ?? allergy.code?.coding?.[0]?.display ?? 'Chưa rõ tác nhân'} · {allergy.verificationStatus?.coding?.[0]?.code ?? 'unknown'}{allergy.criticality ? ` · nguy cơ ${allergy.criticality}` : ''}{allergy.reaction?.map((reaction) => reaction.manifestation?.map((item) => item.text ?? item.coding?.[0]?.display).filter(Boolean).join(', ')).filter(Boolean).map((text) => ` · phản ứng ${text}`)}</li>)}</ul> : <p>Chưa ghi nhận.</p>}
        <h2>Chẩn đoán đang hoạt động</h2>
        {conditions.filter((condition) => condition.clinicalStatus?.coding?.[0]?.code === 'active' && condition.verificationStatus?.coding?.[0]?.code !== 'refuted').length
          ? <ul>{conditions.filter((condition) => condition.clinicalStatus?.coding?.[0]?.code === 'active' && condition.verificationStatus?.coding?.[0]?.code !== 'refuted').map((condition) => <li key={condition.id}>{condition.code?.text ?? condition.code?.coding?.[0]?.display ?? 'Chưa có tên'} · {condition.verificationStatus?.coding?.[0]?.code ?? 'unknown'}</li>)}</ul>
          : <p>Chưa ghi nhận.</p>}
        <h2>Thuốc đang dùng</h2>
        {medicationStatements.filter((statement) => statement.status === 'active').length
          ? <ul>{medicationStatements.filter((statement) => statement.status === 'active').map((statement) => <li key={statement.id}>{statement.medicationCodeableConcept?.text ?? statement.medicationCodeableConcept?.coding?.[0]?.display ?? 'Chưa có tên'} · {statement.dosage?.map((dose) => [dose.doseAndRate?.map((item) => item.doseQuantity ? `${item.doseQuantity.value ?? ''} ${item.doseQuantity.unit ?? ''}`.trim() : '').filter(Boolean).join(', '), dose.route?.text, dose.timing?.code?.text, dose.text].filter(Boolean).join(' · ')).filter(Boolean).join('; ')}</li>)}</ul>
          : <p>Chưa có đối soát thuốc đang dùng.</p>}
        {medicationRequests.some((request) => request.status === 'active') && <><h3>Đơn thuốc đang hiệu lực</h3><ul>{medicationRequests.filter((request) => request.status === 'active').map((request) => <li key={request.id}>{request.medicationCodeableConcept?.text ?? request.medicationCodeableConcept?.coding?.[0]?.display ?? 'Chưa có tên'} · {request.dosageInstruction?.map((dose) => [dose.doseAndRate?.map((item) => item.doseQuantity ? `${item.doseQuantity.value ?? ''} ${item.doseQuantity.unit ?? ''}`.trim() : '').filter(Boolean).join(', '), dose.route?.text, dose.timing?.code?.text, dose.text].filter(Boolean).join(' · ')).filter(Boolean).join('; ')}</li>)}</ul></>}
        <h2>Kết quả gần đây</h2>
        {observations.filter((observation) => observation.status !== 'entered-in-error').slice(0, 10).length
          ? <ul>{observations.filter((observation) => observation.status !== 'entered-in-error').slice(0, 10).map((observation) => <li key={observation.id}>{observation.effectiveDateTime ? new Date(observation.effectiveDateTime).toLocaleDateString('vi-VN') : 'Không có ngày'} · {observation.code.text ?? observation.code.coding?.[0]?.display ?? 'Chỉ số'}: {formatObservationValue(observation)} · {observation.status}</li>)}</ul>
          : <p>Chưa ghi nhận.</p>}
        <h2>Lần khám gần đây</h2>
        {encounters.slice(0, 10).length
          ? <ul>{encounters.slice(0, 10).map((encounter) => <li key={encounter.id}>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : 'Không có ngày'} · {encounter.status} · {encounter.reasonCode?.map((reason) => reason.text ?? reason.coding?.[0]?.display).filter(Boolean).join(', ') || 'Chưa ghi lý do'}</li>)}</ul>
          : <p>Chưa ghi nhận.</p>}
        <hr />
        <small>Tóm tắt được lập từ hồ sơ đã tải theo quyền truy cập hiện tại; không thay thế hồ sơ FHIR đầy đủ hoặc đánh giá lâm sàng.</small>
      </article>}
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
      {patientId && <section className="panel">
        <h2>Dị ứng đang ghi nhận</h2>
        {activeAllergies.length ? <ul>{activeAllergies.map((allergy) => (
          <li key={allergy.id}>
            <strong>{allergy.code?.text ?? allergy.code?.coding?.[0]?.display ?? 'Chưa rõ tác nhân'}</strong>
            {' · '}{allergy.category?.join(', ') || 'Chưa phân loại'}
            {' · '}xác minh: {allergy.verificationStatus?.coding?.[0]?.code ?? 'unknown'}
            {allergy.criticality ? ` · mức độ nguy cơ: ${allergy.criticality}` : ''}
            {allergy.reaction?.map((reaction) => reaction.manifestation?.map((item) => item.text ?? item.coding?.[0]?.display).filter(Boolean).join(', ')).filter(Boolean).map((text) => ` · phản ứng: ${text}`)}
          </li>
        ))}</ul> : <p className="empty">Chưa có dị ứng đang hoạt động được ghi nhận.</p>}
      </section>}
      {patientId && <div className="stat-grid">
        <section className="stat-card"><span>Lần khám</span><strong>{encounters.length}</strong><small>{inProgressEncounterCount} đang diễn ra</small></section>
        <section className="stat-card"><span>Chẩn đoán đang hoạt động</span><strong>{activeConditionCount}</strong><small>{conditions.length} chẩn đoán được tải</small></section>
        <section className="stat-card"><span>Kết quả</span><strong>{observations.length}</strong><small>{latestObservation?.effectiveDateTime ? `Gần nhất ${new Date(latestObservation.effectiveDateTime).toLocaleDateString('vi-VN')}` : 'Chưa có kết quả'}</small></section>
      </div>}
      {patientId && !loading && <section className={`notice ${ehrConsistencyFindings.length ? 'error' : ''}`} aria-live="polite">
        <strong>Rà soát liên kết hồ sơ:</strong>{' '}
        {ehrConsistencyFindings.length
          ? <><span>{ehrConsistencyFindings.length} điểm cần kiểm tra. Tham chiếu chưa tải có thể nằm ngoài quyền truy cập hiện tại.</span><ul>{ehrConsistencyFindings.map((finding, index) => <li key={`${finding}-${index}`}>{finding}</li>)}</ul></>
          : <span>Không phát hiện tham chiếu Encounter/Appointment/MedicationRequest chưa khớp trong dữ liệu đã tải.</span>}
        <small>Đây là rà soát liên kết dữ liệu, không xác nhận tính đúng đắn lâm sàng.</small>
      </section>}
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createEncounter}>
          <h2>Ghi nhận lần khám</h2>
          <div className="form-grid">
            <label>Ngày khám<input name="encounterDate" type="date" required /></label>
            <label>Giờ khám<input name="encounterTime" type="time" required /></label>
            <label>Appointment đã hoàn tất
              <select name="encounterAppointment" defaultValue="">
                <option value="">Không liên kết</option>
                {appointments.filter((appointment) => appointment.status === 'fulfilled' && !encounters.some((encounter) =>
                  encounter.appointment?.some((reference) => reference.reference === `Appointment/${appointment.id}`)
                )).map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.start ? new Date(appointment.start).toLocaleString('vi-VN') : appointment.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="full-width">Lý do khám<input name="encounterReason" maxLength={200} required /></label>
            <label>Loại ghi chú
              <select name="encounterNoteType" defaultValue="progress">
                <option value="progress">Diễn biến</option>
                <option value="assessment">Đánh giá</option>
                <option value="plan">Kế hoạch</option>
                <option value="procedure">Thủ thuật</option>
              </select>
            </label>
            <label className="full-width">Ghi chú<textarea name="encounterNote" maxLength={4000} rows={4} /></label>
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
        <form className="panel editor" onSubmit={createVitalSigns}>
          <h2>Ghi dấu hiệu sinh tồn</h2>
          <p className="muted">Lưu chỉ số bằng mã LOINC và đơn vị UCUM. Hệ thống không tự đánh giá ngưỡng lâm sàng.</p>
          <div className="form-grid">
            <label>Thời điểm đo<input name="vitalDateTime" type="datetime-local" defaultValue={localDateTimeInput(new Date().toISOString())} required /></label>
            <label>Lần khám đang diễn ra (tùy chọn)
              <select name="vitalEncounter" defaultValue="">
                <option value="">Không liên kết</option>
                {encounters.filter((encounter) => encounter.status === 'in-progress').map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : encounter.id}</option>
                ))}
              </select>
            </label>
            <label>Huyết áp tâm thu<input name="vitalSystolic" type="number" min="0.1" step="any" placeholder="mmHg" /></label>
            <label>Huyết áp tâm trương<input name="vitalDiastolic" type="number" min="0.1" step="any" placeholder="mmHg" /></label>
            <label>Nhịp tim<input name="vitalHeartRate" type="number" min="0.1" step="any" placeholder="lần/phút" /></label>
            <label>Nhịp thở<input name="vitalRespiratoryRate" type="number" min="0.1" step="any" placeholder="lần/phút" /></label>
            <label>Nhiệt độ<input name="vitalTemperature" type="number" step="any" placeholder="°C" /></label>
            <label>Cân nặng<input name="vitalWeight" type="number" min="0.1" step="any" placeholder="kg" /></label>
            <label>Chiều cao<input name="vitalHeight" type="number" min="0.1" step="any" placeholder="cm" /></label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>{saving ? 'Đang lưu…' : 'Lưu dấu hiệu sinh tồn'}</button>
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
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createMedicationRequest}>
          <h2>Kê thuốc</h2>
          {activeMedicationAllergies.length > 0 && <div className="notice error" role="alert">
            <strong>Có dị ứng thuốc đang hoạt động.</strong> Đối chiếu tên bên dưới chỉ là so khớp văn bản; không kiểm tra thành phần, đồng nghĩa, phản ứng chéo hay tương tác.
            <ul>{activeMedicationAllergies.map((allergy) => (
              <li key={allergy.id}>{allergy.code?.text ?? allergy.code?.coding?.[0]?.display ?? 'Chưa rõ tác nhân'} · {allergy.verificationStatus?.coding?.[0]?.code ?? 'chưa xác minh'}{allergy.criticality ? ` · nguy cơ ${allergy.criticality}` : ''}</li>
            ))}</ul>
          </div>}
          <div className="form-grid">
            <label>Tên thuốc<input name="medicationName" maxLength={200} required /></label>
            <label>Hướng dẫn dùng<input name="medicationDosage" maxLength={500} placeholder="Ghi chú thêm" required /></label>
            <label>Liều mỗi lần<input name="medicationDoseValue" type="number" min="0.001" step="any" /></label>
            <label>Đơn vị liều<input name="medicationDoseUnit" maxLength={40} placeholder="mg, viên, ml…" /></label>
            <label>Đường dùng<input name="medicationRoute" maxLength={100} placeholder="uống, tiêm…" /></label>
            <label>Tần suất<input name="medicationFrequency" maxLength={100} placeholder="2 lần mỗi ngày" /></label>
            <label>Số lượng<input name="medicationQuantity" type="number" min="0.01" step="any" /></label>
            <label>Đơn vị<input name="medicationQuantityUnit" maxLength={40} placeholder="viên, ml…" /></label>
            <label>Số lần cấp thêm<input name="medicationRepeats" type="number" min="0" step="1" /></label>
            <label>Lần khám liên quan
              <select name="medicationEncounter" defaultValue="">
                <option value="">Không liên kết</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : encounter.id}</option>
                ))}
              </select>
            </label>
            <div className="notice full-width" role="status"><strong>Rà soát dị ứng trước khi kê:</strong> máy chủ kiểm tra các AllergyIntolerance thuốc đang hoạt động và lưu kết quả so khớp tên cùng xác nhận của người kê. So khớp văn bản không kiểm tra thành phần, phản ứng chéo hoặc tương tác lâm sàng.</div>
            <label className="full-width">
              <input type="checkbox" name="medicationAllergyReview" required /> Tôi đã rà soát danh sách dị ứng và tự quyết định xử trí trước khi kê.
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>{saving ? 'Đang lưu…' : 'Lưu yêu cầu thuốc'}</button>
          </div>
        </form>
      )}
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createMedicationAdministration}>
          <h2>Ghi nhận dùng thuốc</h2>
          <p className="muted">Lưu lần dùng thuốc đã thực hiện, có thể liên kết đơn kê và lần khám.</p>
          <div className="form-grid">
            <label>Liên kết đơn kê
              <select name="administrationRequest" defaultValue="">
                <option value="">Ghi thuốc ngoài danh sách đơn kê</option>
                {medicationRequests.filter((request) => request.status === 'active').map((request) => (
                  <option key={request.id} value={request.id}>{request.medicationCodeableConcept?.text ?? request.medicationCodeableConcept?.coding?.[0]?.display ?? request.id}</option>
                ))}
              </select>
            </label>
            <label>Tên thuốc<input name="administrationMedication" maxLength={200} placeholder="Bắt buộc nếu không chọn đơn kê" /></label>
            <label>Thời điểm dùng<input name="administrationTime" type="datetime-local" defaultValue={localDateTimeInput(new Date().toISOString())} required /></label>
            <label>Liều đã dùng<input name="administrationDoseValue" type="number" min="0.001" step="any" /></label>
            <label>Đơn vị liều<input name="administrationDoseUnit" maxLength={40} placeholder="mg, viên, ml…" /></label>
            <label>Đường dùng<input name="administrationRoute" maxLength={100} placeholder="uống, tiêm…" /></label>
            <label>Lần khám liên quan
              <select name="administrationEncounter" defaultValue="">
                <option value="">Không liên kết</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : encounter.id}</option>
                ))}
              </select>
            </label>
            <label className="full-width">Ghi chú<textarea name="administrationNote" maxLength={500} rows={2} /></label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>{saving ? 'Đang lưu…' : 'Ghi nhận đã dùng'}</button>
          </div>
        </form>
      )}
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createMedicationStatement}>
          <h2>Đối soát thuốc đang dùng</h2>
          <div className="form-grid">
            <label>Thuốc<input name="statementMedication" maxLength={200} required /></label>
            <label>Hướng dẫn dùng đã khai báo<input name="statementDosage" maxLength={500} placeholder="Ghi chú thêm" required /></label>
            <label>Liều mỗi lần<input name="statementDoseValue" type="number" min="0.001" step="any" /></label>
            <label>Đơn vị liều<input name="statementDoseUnit" maxLength={40} placeholder="mg, viên, ml…" /></label>
            <label>Đường dùng<input name="statementRoute" maxLength={100} placeholder="uống, tiêm…" /></label>
            <label>Tần suất<input name="statementFrequency" maxLength={100} placeholder="2 lần mỗi ngày" /></label>
            <label>Nguồn thông tin
              <select name="statementSource" defaultValue="patient">
                <option value="patient">Bệnh nhân báo</option>
                <option value="practitioner">Nhân viên xác nhận</option>
              </select>
            </label>
            <label>Trạng thái
              <select name="statementStatus" defaultValue="active">
                <option value="active">Đang dùng</option>
                <option value="on-hold">Tạm ngưng</option>
                <option value="not-taken">Không dùng</option>
                <option value="stopped">Đã ngừng</option>
                <option value="completed">Đã hoàn tất</option>
              </select>
            </label>
            <label>Ngày bắt đầu<input name="statementEffectiveDate" type="date" /></label>
            <label>Lý do sử dụng hoặc trạng thái<input name="statementReason" maxLength={300} /></label>
            <label>Đơn kê liên quan
              <select name="statementMedicationRequest" defaultValue="">
                <option value="">Không liên kết</option>
                {medicationRequests.map((request) => (
                  <option key={request.id} value={request.id}>{request.medicationCodeableConcept?.text ?? request.medicationCodeableConcept?.coding?.[0]?.display ?? request.id}</option>
                ))}
              </select>
            </label>
            <label>Lần khám liên quan
              <select name="statementEncounter" defaultValue="">
                <option value="">Không liên kết</option>
                {encounters.map((encounter) => (
                  <option key={encounter.id} value={encounter.id}>{encounter.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : encounter.id}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>{saving ? 'Đang lưu…' : 'Lưu đối soát thuốc'}</button>
          </div>
        </form>
      )}
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createAllergyIntolerance}>
          <h2>Ghi nhận dị ứng</h2>
          <div className="form-grid">
            <label>Tác nhân<input name="allergySubstance" maxLength={200} required /></label>
            <label>Nhóm
              <select name="allergyCategory" defaultValue="medication">
                <option value="medication">Thuốc</option>
                <option value="food">Thực phẩm</option>
                <option value="environment">Môi trường</option>
                <option value="biologic">Sinh phẩm</option>
              </select>
            </label>
            <label>Xác minh
              <select name="allergyVerification" defaultValue="confirmed">
                <option value="confirmed">Đã xác nhận</option>
                <option value="unconfirmed">Chưa xác minh</option>
              </select>
            </label>
            <label>Mức độ nguy cơ
              <select name="allergyCriticality" defaultValue="">
                <option value="">Chưa đánh giá</option>
                <option value="low">Thấp</option>
                <option value="high">Cao</option>
              </select>
            </label>
            <label>Ngày khởi phát<input name="allergyOnsetDate" type="date" /></label>
            <label>Phản ứng<input name="allergyReaction" maxLength={300} /></label>
            <label>Mức độ phản ứng
              <select name="allergyReactionSeverity" defaultValue="">
                <option value="">Chưa đánh giá</option>
                <option value="mild">Nhẹ</option>
                <option value="moderate">Vừa</option>
                <option value="severe">Nặng</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>{saving ? 'Đang lưu…' : 'Lưu dị ứng'}</button>
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
                <td>{encounter.note?.length ? <div className="clinical-note-list">
                  {encounter.note.map((note, index) => (
                    <div key={`${note.time ?? 'note'}-${index}`}>
                      <small>{note.time ? new Date(note.time).toLocaleString('vi-VN') : 'Không có thời điểm'}{note.authorReference ? ` · ${note.authorReference.display ?? note.authorReference.reference ?? ''}` : ''}</small>
                      <p>{renderEncounterNote(note.text ?? '')}</p>
                    </div>
                  ))}
                </div> : '—'}</td>
                <td>{encounter.appointment?.map((reference) => {
                  const appointment = appointments.find((item) => reference.reference === `Appointment/${item.id}`);
                  return appointment?.start ? new Date(appointment.start).toLocaleString('vi-VN') : reference.display ?? reference.reference;
                }).join(', ') || '—'}</td>
                {role !== 'Patient' && <td>{encounter.status === 'in-progress' && <>
                  <details>
                    <summary>Sửa lần khám</summary>
                    <form className="editor" onSubmit={(event) => void updateEncounterDetails(encounter, event)}>
                      <label>Ngày bắt đầu<input name="encounterStartDate" type="date" defaultValue={encounter.period?.start?.slice(0, 10) ?? ''} required /></label>
                      <label>Giờ bắt đầu<input name="encounterStartTime" type="time" defaultValue={encounter.period?.start ? new Date(encounter.period.start).toTimeString().slice(0, 5) : ''} required /></label>
                      <label>Lý do khám<textarea name="encounterUpdatedReason" maxLength={200} defaultValue={encounter.reasonCode?.map((reason) => reason.text ?? reason.coding?.[0]?.display).filter(Boolean).join(', ')} required /></label>
                      <label>Lý do chỉnh sửa (bắt buộc)<textarea name="encounterChangeReason" maxLength={500} required /></label>
                      <button className="button" disabled={saving}>Lưu chỉnh sửa</button>
                    </form>
                  </details>
                  <details>
                    <summary>Bổ sung ghi chú</summary>
                    <form className="editor" onSubmit={(event) => void addEncounterNote(encounter, event)}>
                      <label>Loại ghi chú
                        <select name="encounterNoteType" defaultValue="progress">
                          <option value="progress">Diễn biến</option>
                          <option value="assessment">Đánh giá</option>
                          <option value="plan">Kế hoạch</option>
                          <option value="procedure">Thủ thuật</option>
                        </select>
                      </label>
                      <textarea name="encounterNote" maxLength={4000} rows={3} required />
                      <button className="button" disabled={saving}>Lưu ghi chú</button>
                    </form>
                  </details>
                  <details>
                    <summary>Kết thúc lần khám</summary>
                    <form className="editor" onSubmit={(event) => void completeEncounter(encounter, event)}>
                      <label>Tổng kết lần khám (bắt buộc)
                        <textarea name="encounterCompletionSummary" maxLength={4000} minLength={10} rows={3} required placeholder="Kết quả, hướng xử trí và dặn dò khi kết thúc…" />
                      </label>
                      <button className="button primary" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu tổng kết và kết thúc'}</button>
                    </form>
                  </details>{' '}
                  <details>
                    <summary>Hủy lần khám</summary>
                    <form className="editor" onSubmit={(event) => void cancelEncounter(encounter, event)}>
                      <label>Lý do hủy (bắt buộc)<textarea name="encounterCancellationReason" maxLength={500} rows={2} required /></label>
                      <button className="button" disabled={saving}>{saving ? 'Đang hủy…' : 'Xác nhận hủy'}</button>
                    </form>
                  </details>
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
          <thead><tr><th>Chẩn đoán</th><th>Trạng thái lâm sàng</th><th>Xác minh</th><th>Ngày giải quyết</th><th>Lần khám</th><th>Ghi chú</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
          <tbody>{filteredConditions.map((condition) => {
            const encounter = encounters.find((item) => condition.encounter?.reference === `Encounter/${item.id}`);
            return (
              <tr key={condition.id}>
                <td>{condition.code?.text ?? condition.code?.coding?.[0]?.display ?? 'Chưa có tên'}</td>
                <td>{condition.clinicalStatus?.coding?.[0]?.code ?? '—'}</td>
                <td>{condition.verificationStatus?.coding?.[0]?.code ?? '—'}</td>
                <td>{condition.abatementDateTime ? new Date(condition.abatementDateTime).toLocaleDateString('vi-VN') : condition.abatementPeriod?.end ? new Date(condition.abatementPeriod.end).toLocaleDateString('vi-VN') : '—'}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : condition.encounter?.display ?? condition.encounter?.reference ?? '—'}</td>
                <td>{condition.note?.map((note) => `${note.time ? new Date(note.time).toLocaleString('vi-VN') : ''}${note.authorReference?.reference ? ` · ${note.authorReference.reference}` : ''}: ${note.text ?? ''}`).join('\n') || '—'}</td>
                {role !== 'Patient' && <td>
                  {(() => {
                    const verification = condition.verificationStatus?.coding?.[0]?.code ?? '';
                    const clinical = condition.clinicalStatus?.coding?.[0]?.code ?? '';
                    const actions: { change: 'confirm' | 'refute' | 'active' | 'inactive' | 'resolved'; label: string }[] = [];
                    if (['provisional', 'unconfirmed', 'differential'].includes(verification)) actions.push({ change: 'confirm', label: 'Xác nhận' });
                    if (!['refuted', 'entered-in-error'].includes(verification)) actions.push({ change: 'refute', label: 'Bác bỏ chẩn đoán' });
                    if (clinical === 'active') actions.push({ change: 'resolved', label: 'Đánh dấu đã giải quyết' }, { change: 'inactive', label: 'Tạm ngưng' });
                    if (clinical === 'inactive' && verification !== 'refuted') actions.push({ change: 'active', label: 'Tái hoạt' });
                    return actions.length ? <details>
                      <summary>Cập nhật vòng đời</summary>
                      {actions.map(({ change, label }) => <form className="editor" key={change} onSubmit={(event) => void reviewCondition(condition, change, event)}>
                        <label>{label} · lý do<textarea name="conditionReviewReason" maxLength={500} rows={2} required /></label>
                        <button className="button" disabled={saving}>{label}</button>
                      </form>)}
                    </details> : '—';
                  })()}
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
          <thead><tr><th>Ngày</th><th>Phân loại</th><th>Chỉ số</th><th>Giá trị</th><th>Trạng thái</th><th>Lần khám</th><th>Ghi chú</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
          <tbody>{filteredObservations.map((observation) => {
            const encounter = encounters.find((item) => observation.encounter?.reference === `Encounter/${item.id}`);
            return (
              <tr key={observation.id}>
                <td>{observation.effectiveDateTime ? new Date(observation.effectiveDateTime).toLocaleString('vi-VN') : '—'}</td>
                <td>{observation.category?.[0]?.coding?.[0]?.display ?? observationCategoryLabels[observation.category?.[0]?.coding?.[0]?.code ?? ''] ?? '—'}</td>
                <td>{observation.code.text ?? observation.code.coding?.[0]?.display ?? '—'}</td>
                <td>{formatObservationValue(observation)}</td>
                <td>{observation.status}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : observation.encounter?.display ?? observation.encounter?.reference ?? '—'}</td>
                <td>{observation.note?.map((note) => `${note.time ? new Date(note.time).toLocaleString('vi-VN') : ''}${note.authorReference?.reference ? ` · ${note.authorReference.reference}` : ''}: ${note.text ?? ''}`).join('\n') || '—'}</td>
                {role !== 'Patient' && <td>{observation.status !== 'entered-in-error' ? <>
                  <details>
                  <summary>Sửa kết quả</summary>
                  <form className="editor" onSubmit={(event) => void amendObservation(observation, event)}>
                    {observation.component?.some((component) => component.code.coding?.some((coding) => coding.code === '8480-6'))
                      ? <>
                        <label>Tâm thu<input name="observationUpdatedSystolic" type="number" min="0.1" step="any" defaultValue={observation.component.find((component) => component.code.coding?.some((coding) => coding.code === '8480-6'))?.valueQuantity?.value ?? ''} required /></label>
                        <label>Tâm trương<input name="observationUpdatedDiastolic" type="number" min="0.1" step="any" defaultValue={observation.component.find((component) => component.code.coding?.some((coding) => coding.code === '8462-4'))?.valueQuantity?.value ?? ''} required /></label>
                      </>
                      : <label>Chỉ số<input name="observationUpdatedCode" maxLength={200} defaultValue={observation.code.text ?? observation.code.coding?.[0]?.display ?? ''} required /></label>}
                    <label>Thời điểm<input name="observationUpdatedDateTime" type="datetime-local" defaultValue={localDateTimeInput(observation.effectiveDateTime)} required /></label>
                    {!observation.component?.some((component) => component.code.coding?.some((coding) => coding.code === '8480-6')) && <>
                      <label>Giá trị số<input name="observationUpdatedNumericValue" type="number" step="any" defaultValue={observation.valueQuantity?.value ?? ''} /></label>
                      <label>Đơn vị<input name="observationUpdatedUnit" maxLength={40} defaultValue={observation.valueQuantity?.unit ?? ''} /></label>
                      <label>Giá trị văn bản<input name="observationUpdatedTextValue" maxLength={200} defaultValue={observation.valueString ?? ''} /></label>
                    </>}
                    <label>Lý do sửa<textarea name="observationAmendmentReason" maxLength={500} rows={2} required /></label>
                    <button className="button" disabled={saving}>Lưu bản sửa</button>
                  </form>
                  </details>
                  <details>
                    <summary>Đánh dấu nhập nhầm</summary>
                    <form className="editor" onSubmit={(event) => void markObservationEnteredInError(observation, event)}>
                      <label>Lý do<textarea name="observationErrorReason" maxLength={500} rows={2} required /></label>
                      <button className="button" disabled={saving}>Xác nhận nhập nhầm</button>
                    </form>
                  </details>
                </> : '—'}</td>}
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">{observations.length ? 'Không có kết quả phù hợp với bộ lọc.' : 'Chưa có kết quả trong phạm vi truy cập.'}</p>}
      </section>
      <section className="panel">
        <h2>Thuốc đang dùng và tiền sử dùng</h2>
        {medicationStatements.length ? <div className="table-wrap"><table>
          <thead><tr><th>Ngày xác nhận</th><th>Nguồn</th><th>Thuốc</th><th>Cách dùng</th><th>Trạng thái</th><th>Lý do</th><th>Đơn kê</th><th>Lần khám</th><th>Ghi chú audit</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
          <tbody>{medicationStatements.map((statement) => {
            const encounter = encounters.find((item) => statement.context?.reference === `Encounter/${item.id}`);
            const basedOnRequest = medicationRequests.find((request) => statement.basedOn?.some((reference) => reference.reference === `MedicationRequest/${request.id}`));
            const sourceLabel = statement.informationSource?.reference === `Patient/${patientId}` ? 'Bệnh nhân báo' : statement.informationSource?.display ?? statement.informationSource?.reference ?? '—';
            return (
              <tr key={statement.id}>
                <td>{statement.dateAsserted ? new Date(statement.dateAsserted).toLocaleDateString('vi-VN') : '—'}</td>
                <td>{sourceLabel}</td>
                <td>{statement.medicationCodeableConcept?.text ?? statement.medicationCodeableConcept?.coding?.[0]?.display ?? '—'}</td>
                <td>{statement.dosage?.map((dose) => [dose.doseAndRate?.map((item) => item.doseQuantity ? `${item.doseQuantity.value ?? ''} ${item.doseQuantity.unit ?? ''}`.trim() : '').filter(Boolean).join(', '), dose.route?.text, dose.timing?.code?.text, dose.text].filter(Boolean).join(' · ')).filter(Boolean).join('; ') || '—'}</td>
                <td>{statement.status}</td>
                <td>{statement.statusReason?.map((reason) => reason.text ?? reason.coding?.[0]?.display).filter(Boolean).join('; ') || '—'}</td>
                <td>{basedOnRequest?.medicationCodeableConcept?.text ?? basedOnRequest?.medicationCodeableConcept?.coding?.[0]?.display ?? statement.basedOn?.map((reference) => reference.display ?? reference.reference).join(', ') ?? '—'}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : statement.context?.display ?? statement.context?.reference ?? '—'}</td>
                <td>{statement.note?.map((note) => `${note.time ? new Date(note.time).toLocaleString('vi-VN') : ''}${note.authorReference?.reference ? ` · ${note.authorReference.reference}` : ''}: ${note.text ?? ''}`).join('\n') || '—'}</td>
                {role !== 'Patient' && <td><details>
                  <summary>Cập nhật</summary>
                  <form className="editor" onSubmit={(event) => void updateMedicationStatement(statement, event)}>
                    <label>Trạng thái
                      <select name="statementNextStatus" defaultValue={statement.status}>
                        <option value="active">Đang dùng</option>
                        <option value="on-hold">Tạm ngưng</option>
                        <option value="not-taken">Không dùng</option>
                        <option value="stopped">Đã ngừng</option>
                        <option value="completed">Đã hoàn tất</option>
                      </select>
                    </label>
                    <label>Lý do<textarea name="statementUpdateReason" maxLength={500} rows={2} required /></label>
                    <button className="button" disabled={saving}>Lưu thay đổi</button>
                  </form>
                </details></td>}
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">Chưa có bản ghi đối soát thuốc trong phạm vi truy cập.</p>}
      </section>
      <section className="panel">
        <h2>Đơn thuốc</h2>
        <div className="form-grid">
          <label className="full-width">Tìm thuốc, cách dùng hoặc ghi chú
            <input value={medicationSearch} onChange={(event) => setMedicationSearch(event.currentTarget.value)} />
          </label>
          <label>Trạng thái
            <select value={medicationStatusFilter} onChange={(event) => setMedicationStatusFilter(event.currentTarget.value)}>
              <option value="">Tất cả</option>
              <option value="active">Đang hiệu lực</option>
              <option value="on-hold">Tạm giữ</option>
              <option value="completed">Đã hoàn tất</option>
              <option value="stopped">Đã ngừng</option>
              <option value="cancelled">Đã hủy</option>
              <option value="entered-in-error">Nhập sai</option>
              <option value="draft">Bản nháp</option>
              <option value="unknown">Không rõ</option>
            </select>
          </label>
          <label>Từ ngày<input type="date" value={medicationFrom} onChange={(event) => setMedicationFrom(event.currentTarget.value)} /></label>
          <label>Đến ngày<input type="date" value={medicationTo} onChange={(event) => setMedicationTo(event.currentTarget.value)} /></label>
        </div>
        {filteredMedicationRequests.length ? <div className="table-wrap"><table>
          <thead><tr><th>Ngày kê</th><th>Thuốc</th><th>Cách dùng</th><th>Số lượng</th><th>Trạng thái</th><th>Lý do cập nhật</th><th>Ghi chú audit</th><th>Lần khám</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
          <tbody>{filteredMedicationRequests.map((request) => {
            const encounter = encounters.find((item) => request.encounter?.reference === `Encounter/${item.id}`);
            const quantity = request.dispenseRequest?.quantity;
            return (
              <tr key={request.id}>
                <td>{request.authoredOn ? new Date(request.authoredOn).toLocaleDateString('vi-VN') : '—'}</td>
                <td>{request.medicationCodeableConcept?.text ?? request.medicationCodeableConcept?.coding?.[0]?.display ?? '—'}</td>
                <td>{request.dosageInstruction?.map((instruction) => [instruction.doseAndRate?.map((item) => item.doseQuantity ? `${item.doseQuantity.value ?? ''} ${item.doseQuantity.unit ?? ''}`.trim() : '').filter(Boolean).join(', '), instruction.route?.text, instruction.timing?.code?.text, instruction.text].filter(Boolean).join(' · ')).filter(Boolean).join('; ') || '—'}</td>
                <td>{quantity ? `${quantity.value ?? ''} ${quantity.unit ?? ''}` : '—'}{request.dispenseRequest?.numberOfRepeatsAllowed !== undefined ? ` · cấp thêm ${request.dispenseRequest.numberOfRepeatsAllowed} lần` : ''}</td>
                <td>{request.status}</td>
                <td>{request.statusReason?.text ?? '—'}</td>
                <td>{request.note?.map((note) => `${note.time ? new Date(note.time).toLocaleString('vi-VN') : ''}${note.authorReference?.reference ? ` · ${note.authorReference.reference}` : ''}: ${note.text ?? ''}`).join('\n') || '—'}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : request.encounter?.display ?? request.encounter?.reference ?? '—'}</td>
                {role !== 'Patient' && <td>
                  {request.status === 'active' && <details>
                    <summary>Cập nhật trạng thái</summary>
                    <form className="editor" onSubmit={(event) => void updateMedicationRequestStatus(request, event)}>
                      <label>Trạng thái mới
                        <select name="medicationNextStatus" defaultValue="stopped">
                          <option value="stopped">Đã ngừng</option>
                          <option value="cancelled">Đã hủy trước khi dùng</option>
                          <option value="completed">Đã hoàn tất</option>
                        </select>
                      </label>
                      <label>Lý do<textarea name="medicationStatusReason" maxLength={500} rows={3} required /></label>
                      <button className="button" disabled={saving}>Lưu trạng thái</button>
                    </form>
                  </details>}
                  {request.status !== 'entered-in-error' && <details>
                    <summary>Đánh dấu nhập nhầm</summary>
                    <form className="editor" onSubmit={(event) => void markMedicationRequestEnteredInError(request, event)}>
                      <label>Lý do<textarea name="medicationEntryErrorReason" maxLength={500} rows={2} required /></label>
                      <button className="button" disabled={saving}>Xác nhận nhập nhầm</button>
                    </form>
                  </details>}
                </td>}
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">{medicationRequests.length ? 'Không có đơn thuốc phù hợp với bộ lọc.' : 'Chưa có đơn thuốc trong phạm vi truy cập.'}</p>}
      </section>
      <section className="panel">
        <h2>Lịch sử dùng thuốc đã ghi nhận</h2>
        {medicationAdministrations.length ? <div className="table-wrap"><table>
          <thead><tr><th>Thời điểm</th><th>Thuốc</th><th>Liều</th><th>Đường dùng</th><th>Trạng thái</th><th>Đơn kê</th><th>Lần khám</th><th>Người ghi nhận</th><th>Ghi chú</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
          <tbody>{medicationAdministrations.map((administration) => {
            const request = medicationRequests.find((item) => administration.request?.reference === `MedicationRequest/${item.id}`);
            const encounter = encounters.find((item) => administration.context?.reference === `Encounter/${item.id}`);
            const dose = administration.dosage?.dose;
            return (
              <tr key={administration.id}>
                <td>{administration.effectiveDateTime ? new Date(administration.effectiveDateTime).toLocaleString('vi-VN') : administration.effectivePeriod?.start ? new Date(administration.effectivePeriod.start).toLocaleString('vi-VN') : '—'}</td>
                <td>{administration.medicationCodeableConcept?.text ?? administration.medicationCodeableConcept?.coding?.[0]?.display ?? administration.medicationReference?.display ?? '—'}</td>
                <td>{dose ? `${dose.value ?? ''} ${dose.unit ?? ''}`.trim() : '—'}</td>
                <td>{administration.dosage?.route?.text ?? administration.dosage?.route?.coding?.[0]?.display ?? '—'}</td>
                <td>{administration.status}</td>
                <td>{request?.medicationCodeableConcept?.text ?? request?.medicationCodeableConcept?.coding?.[0]?.display ?? administration.request?.display ?? administration.request?.reference ?? '—'}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : administration.context?.display ?? administration.context?.reference ?? '—'}</td>
                <td>{administration.performer?.map((performer) => performer.actor?.display ?? performer.actor?.reference).filter(Boolean).join(', ') || '—'}</td>
                <td>{administration.note?.map((note) => note.text).filter(Boolean).join('; ') || '—'}</td>
                {role !== 'Patient' && <td>{administration.status === 'completed' ? <details>
                  <summary>Đánh dấu nhập nhầm</summary>
                  <form className="editor" onSubmit={(event) => void markMedicationAdministrationEnteredInError(administration, event)}>
                    <label>Lý do sửa bản ghi<textarea name="administrationErrorReason" maxLength={500} rows={2} required /></label>
                    <button className="button" disabled={saving}>Xác nhận nhập nhầm</button>
                  </form>
                </details> : '—'}</td>}
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">Chưa có lần dùng thuốc được ghi nhận.</p>}
      </section>
      <section className="panel">
        <h2>Lịch sử dị ứng</h2>
        {allergies.length ? <div className="table-wrap"><table>
          <thead><tr><th>Tác nhân</th><th>Nhóm</th><th>Trạng thái</th><th>Xác minh</th><th>Nguy cơ</th><th>Phản ứng</th><th>Khởi phát</th><th>Ghi chú trạng thái</th>{role !== 'Patient' && <th>Thao tác</th>}</tr></thead>
          <tbody>{allergies.map((allergy) => (
            <tr key={allergy.id}>
              <td>{allergy.code?.text ?? allergy.code?.coding?.[0]?.display ?? '—'}</td>
              <td>{allergy.category?.join(', ') ?? '—'}</td>
              <td>{allergy.clinicalStatus?.coding?.[0]?.code ?? '—'}</td>
              <td>{allergy.verificationStatus?.coding?.[0]?.code ?? '—'}</td>
              <td>{allergy.criticality ?? '—'}</td>
              <td>{allergy.reaction?.map((reaction) => reaction.manifestation?.map((item) => item.text ?? item.coding?.[0]?.display).filter(Boolean).join(', ')).filter(Boolean).join('; ') || '—'}</td>
              <td>{allergy.onsetDateTime ? new Date(allergy.onsetDateTime).toLocaleDateString('vi-VN') : '—'}</td>
              <td>{allergy.note?.map((note) => `${note.time ? new Date(note.time).toLocaleString('vi-VN') : ''}${note.authorReference?.reference ? ` · ${note.authorReference.reference}` : ''}: ${note.text ?? ''}`).join('\n') || '—'}</td>
              {role !== 'Patient' && <td>
                {allergy.verificationStatus?.coding?.[0]?.code === 'unconfirmed' && <>
                  <button className="button" disabled={saving} onClick={() => void reviewAllergyVerification(allergy, 'confirmed')}>Xác nhận</button>{' '}
                  <button className="button" disabled={saving} onClick={() => void reviewAllergyVerification(allergy, 'refuted')}>Bác bỏ</button>{' '}
                </>}
                {allergy.clinicalStatus?.coding?.[0]?.code === 'active' && allergy.verificationStatus?.coding?.[0]?.code !== 'refuted' && <>
                  <button className="button" disabled={saving} onClick={() => void updateAllergyStatus(allergy, 'resolved')}>Đã hết</button>{' '}
                  <button className="button" disabled={saving} onClick={() => void updateAllergyStatus(allergy, 'inactive')}>Ngừng theo dõi</button>
                </>}
              </td>}
            </tr>
          ))}</tbody>
        </table></div> : <p className="empty">Chưa có dị ứng trong phạm vi truy cập.</p>}
      </section>
      {role !== 'Patient' && selectedPatient && <p className="muted">Bác sĩ/nhân viên: dữ liệu chỉ hiện khi FHIR API cho phép đọc bệnh nhân đã chọn.</p>}
    </>
  );
}
