import { normalizeErrorString } from '@medplum/core';
import type { AllergyIntolerance, Appointment, Condition, Encounter, MedicationRequest, Observation, Patient, Practitioner } from '@medplum/fhirtypes';
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
  const [medicationRequests, setMedicationRequests] = useState<MedicationRequest[]>([]);
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
      appointmentResultsPromise,
    ])
      .then(([encounterResults, conditionResults, observationResults, medicationRequestResults, allergyResults, appointmentResults]) => {
        if (!live) return;
        setEncounters(encounterResults);
        setConditions(conditionResults);
        setObservations(observationResults);
        setMedicationRequests(medicationRequestResults);
        setAllergies(allergyResults);
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
      const encounter = await client.createResource<Encounter>({
        resourceType: 'Encounter',
        status: 'in-progress',
        class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
        subject: { reference: `Patient/${patientId}` },
        appointment: appointmentId ? [{ reference: `Appointment/${appointmentId}` }] : undefined,
        period: { start: start.toISOString() },
        reasonCode: [{ text: reason }],
        note: clinicalNote ? [{ time: new Date().toISOString(), text: clinicalNote }] : undefined,
      });
      setEncounters((current) => [encounter, ...current]);
      setMessage('Đã tạo lần khám.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
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

  async function createMedicationRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const medication = String(data.get('medicationName') ?? '').trim();
    const dosage = String(data.get('medicationDosage') ?? '').trim();
    const quantity = String(data.get('medicationQuantity') ?? '').trim();
    const quantityUnit = String(data.get('medicationQuantityUnit') ?? '').trim();
    const repeats = String(data.get('medicationRepeats') ?? '').trim();
    const allergyReviewAcknowledged = data.get('medicationAllergyReview') === 'on';
    const activeMedicationAllergies = allergies.filter((allergy) =>
      allergy.clinicalStatus?.coding?.[0]?.code === 'active' && allergy.category?.includes('medication')
    );
    if (!patientId || !medication || !dosage || (quantity && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0)) || (repeats && (!Number.isInteger(Number(repeats)) || Number(repeats) < 0))) {
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
      const request = await client.createResource<MedicationRequest>({
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: { text: medication },
        subject: { reference: `Patient/${patientId}` },
        requester: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined,
        encounter: encounterId ? { reference: `Encounter/${encounterId}` } : undefined,
        authoredOn: new Date().toISOString(),
        dosageInstruction: [{ text: dosage }],
        note: activeMedicationAllergies.length ? [{
          time: new Date().toISOString(),
          text: 'Người kê đơn xác nhận đã xem xét các dị ứng thuốc đang hoạt động trên hồ sơ.',
          authorReference: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined,
        }] : undefined,
        dispenseRequest: {
          quantity: quantity ? { value: Number(quantity), unit: quantityUnit || undefined } : undefined,
          numberOfRepeatsAllowed: repeats ? Number(repeats) : undefined,
        },
      });
      setMedicationRequests((current) => [request, ...current]);
      setMessage('Đã lưu yêu cầu thuốc.');
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
      const time = new Date().toISOString();
      const updated = await client.updateResource<MedicationRequest>({
        ...request,
        status,
        statusReason: { text: reason },
        note: [...(request.note ?? []), {
          time,
          text: `Yêu cầu thuốc chuyển sang trạng thái ${status}: ${reason}`,
          authorReference: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined,
        }],
      });
      setMedicationRequests((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(status === 'completed' ? 'Đã đánh dấu liệu trình hoàn tất.' : status === 'cancelled' ? 'Đã hủy yêu cầu thuốc.' : 'Đã ngừng yêu cầu thuốc.');
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
      const allergy = await client.createResource<AllergyIntolerance>({
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
      });
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
    const time = new Date().toISOString();
    const statusLabel = status === 'resolved' ? 'đã hết' : 'không còn được xem là đang hoạt động';
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<AllergyIntolerance>({
        ...allergy,
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: status }] },
        note: [...(allergy.note ?? []), {
          time,
          text: `Trạng thái dị ứng được cập nhật: ${statusLabel}.`,
          authorReference: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined,
        }],
      });
      setAllergies((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(status === 'resolved' ? 'Đã đánh dấu dị ứng đã hết.' : 'Đã đánh dấu dị ứng không còn hoạt động.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  async function reviewAllergyVerification(allergy: AllergyIntolerance, status: 'confirmed' | 'refuted') {
    if (!allergy.id || allergy.verificationStatus?.coding?.[0]?.code !== 'unconfirmed') return;
    const time = new Date().toISOString();
    setSaving(true);
    setError(undefined);
    setMessage('');
    try {
      const updated = await client.updateResource<AllergyIntolerance>({
        ...allergy,
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: status }] },
        clinicalStatus: status === 'refuted'
          ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'inactive' }] }
          : allergy.clinicalStatus,
        note: [...(allergy.note ?? []), {
          time,
          text: status === 'confirmed' ? 'Dị ứng được staff xác nhận sau review.' : 'Dị ứng được staff xác định là không đúng sau review.',
          authorReference: profile.id ? { reference: `Practitioner/${profile.id}` } : undefined,
        }],
      });
      setAllergies((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(status === 'confirmed' ? 'Đã xác nhận dị ứng.' : 'Đã bác bỏ bản ghi dị ứng.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  const selectedPatient = patients.find((patient) => patient.id === patientId) ?? selectedPatientRecord;
  const inProgressEncounterCount = encounters.filter((encounter) => encounter.status === 'in-progress').length;
  const activeConditionCount = conditions.filter((condition) => condition.clinicalStatus?.coding?.[0]?.code === 'active').length;
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
      {role !== 'Patient' && (
        <form className="panel editor" onSubmit={createMedicationRequest}>
          <h2>Kê thuốc</h2>
          {activeMedicationAllergies.length > 0 && <div className="notice error" role="alert">
            <strong>Có dị ứng thuốc đang hoạt động.</strong> Hãy đánh giá thủ công trước khi kê; hệ thống chưa kiểm tra tương tác tự động.
            <ul>{activeMedicationAllergies.map((allergy) => (
              <li key={allergy.id}>{allergy.code?.text ?? allergy.code?.coding?.[0]?.display ?? 'Chưa rõ tác nhân'} · {allergy.verificationStatus?.coding?.[0]?.code ?? 'chưa xác minh'}{allergy.criticality ? ` · nguy cơ ${allergy.criticality}` : ''}</li>
            ))}</ul>
          </div>}
          <div className="form-grid">
            <label>Tên thuốc<input name="medicationName" maxLength={200} required /></label>
            <label>Cách dùng<input name="medicationDosage" maxLength={500} placeholder="Liều dùng, đường dùng, tần suất" required /></label>
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
            {activeMedicationAllergies.length > 0 && <label className="full-width">
              <input type="checkbox" name="medicationAllergyReview" required /> Tôi đã xem và đánh giá dị ứng thuốc của bệnh nhân trước khi kê.
            </label>}
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={saving || !patientId}>{saving ? 'Đang lưu…' : 'Lưu yêu cầu thuốc'}</button>
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
                      <p>{note.text}</p>
                    </div>
                  ))}
                </div> : '—'}</td>
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
                <td>{request.dosageInstruction?.map((instruction) => instruction.text).filter(Boolean).join('; ') || '—'}</td>
                <td>{quantity ? `${quantity.value ?? ''} ${quantity.unit ?? ''}` : '—'}{request.dispenseRequest?.numberOfRepeatsAllowed !== undefined ? ` · cấp thêm ${request.dispenseRequest.numberOfRepeatsAllowed} lần` : ''}</td>
                <td>{request.status}</td>
                <td>{request.statusReason?.text ?? '—'}</td>
                <td>{request.note?.map((note) => `${note.time ? new Date(note.time).toLocaleString('vi-VN') : ''}${note.authorReference?.reference ? ` · ${note.authorReference.reference}` : ''}: ${note.text ?? ''}`).join('\n') || '—'}</td>
                <td>{encounter?.period?.start ? new Date(encounter.period.start).toLocaleString('vi-VN') : request.encounter?.display ?? request.encounter?.reference ?? '—'}</td>
                {role !== 'Patient' && <td>{request.status === 'active' && <details>
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
                </details>}</td>}
              </tr>
            );
          })}</tbody>
        </table></div> : <p className="empty">{medicationRequests.length ? 'Không có đơn thuốc phù hợp với bộ lọc.' : 'Chưa có đơn thuốc trong phạm vi truy cập.'}</p>}
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
