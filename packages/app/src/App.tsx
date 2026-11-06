import { normalizeErrorString } from '@medplum/core';
import type { Appointment, Patient, Practitioner, ProjectMembership, ResourceType, Schedule, Slot, User } from '@medplum/fhirtypes';
import { SignInForm, useMedplum, useMedplumProfile } from '@medplum/react';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router';
import { getRole, personName, ROLE_LABELS } from './access';
import { EhrPage } from './EhrPage';
import {
  expandRecurringSlotIntervals,
  findAppointmentConflict,
  findAvailableSlots,
  RECURRING_SLOT_SERIES_SYSTEM,
  removeIntervalsConflictingWithSlots,
  removeOverlappingIntervals,
} from './appointment-scheduling';
import type { HospitalRole } from './access';

function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <div className="notice error" role="alert">
      {normalizeErrorString(error)}
    </div>
  ) : null;
}

export function App() {
  const client = useMedplum();
  const profile = useMedplumProfile();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>();
  const [projectId, setProjectId] = useState<string>();
  useEffect(() => {
    fetch(new URL('config/public', client.getBaseUrl()))
      .then(async (response) => {
        if (!response.ok) throw new Error('Chạy npm run seed để khởi tạo project demo.');
        return response.json();
      })
      .then((config) => setProjectId(config.projectId))
      .catch(setError);
  }, [client]);
  if (client.isLoading()) return <main className="loading">Đang khôi phục phiên…</main>;
  if (!profile)
    return (
      <Routes>
        <Route
          path="/signin"
          element={
            <div className="login-layout">
              <section className="login-story">
                <div className="brand-mark">+</div>
                <span className="eyebrow">SMART HOSPITAL PLATFORM</span>
                <h1>
                  Kết nối chăm sóc.
                  <br />
                  Đồng hành sức khỏe.
                </h1>
                <p>Không gian làm việc chung cho quản trị viên, bác sĩ và bệnh nhân.</p>
                <span className="edition">Nền tảng quản lý bệnh viện · FHIR</span>
              </section>
              <main className="login-form">
                <ErrorMessage error={error} />
                {!projectId ? (
                  <p className="muted">Đang tải cấu hình bệnh viện…</p>
                ) : (
                  <SignInForm projectId={projectId} disableGoogleAuth onSuccess={() => navigate('/dashboard')}>
                    <h2>Chào mừng trở lại</h2>
                    <p className="muted">Đăng nhập với tài khoản bệnh viện của bạn.</p>
                  </SignInForm>
                )}
              </main>
            </div>
          }
        />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  const role = getRole(client.getProjectMembership(), profile);
  if (!role)
    return (
      <div role="alert">
        Tài khoản chưa được cấu hình vai trò.<button onClick={() => client.signOut()}>Đăng xuất</button>
      </div>
    );
  async function signOut() {
    try {
      await client.signOut();
      navigate('/signin');
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link to="/dashboard" className="wordmark">
          <span className="brand-mark small">+</span>
          <span>
            Smart Hospital<small>CARE WORKSPACE</small>
          </span>
        </Link>
        <div className="sidebar-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav>
          <NavLink to="/dashboard">◈ Tổng quan</NavLink>
          {role !== 'Patient' && (
            <>
              <NavLink to="/patients">♡ Bệnh nhân</NavLink>
              <NavLink to="/doctors">✚ Bác sĩ</NavLink>
            </>
          )}
          {role === 'Patient' && <NavLink to={`/patients/${profile.id}`}>♡ Hồ sơ của tôi</NavLink>}
          <NavLink to="/appointments">◷ Lịch hẹn</NavLink>
          <NavLink to="/records">▤ Bệnh án</NavLink>
          {role === 'Admin' && <NavLink to="/users">▤ Người dùng</NavLink>}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> Local environment<small>Powered by Medplum · FHIR R4</small>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div>
            <span className="muted">Bệnh viện / </span>
            {ROLE_LABELS[role]}
          </div>
          <div className="account">
            <span className="avatar">{personName(profile as Patient).slice(0, 1)}</span>
            <span>
              {personName(profile as Patient)}
              <small>{role}</small>
            </span>
            <button className="button secondary" onClick={signOut}>
              Đăng xuất
            </button>
          </div>
        </header>
        <main className="content">
          <ErrorMessage error={error} />
          <Routes>
            <Route path="/dashboard" element={<Dashboard role={role} />} />
            <Route
              path="/appointments"
              element={<AppointmentPage role={role} profile={profile as Patient | Practitioner} />}
            />
            <Route path="/records" element={<EhrPage role={role} profile={profile as Patient | Practitioner} />} />
            <Route
              path="/patients"
              element={
                role !== 'Patient' ? <PeopleList type="Patient" /> : <Navigate to={`/patients/${profile.id}`} replace />
              }
            />
            <Route path="/doctors" element={role !== 'Patient' ? <PeopleList type="Practitioner" /> : <Forbidden />} />
            <Route
              path="/patients/new"
              element={role !== 'Patient' ? <PersonEditor type="Patient" /> : <Forbidden />}
            />
            <Route
              path="/doctors/new"
              element={role === 'Admin' ? <PersonEditor type="Practitioner" /> : <Forbidden />}
            />
            <Route path="/patients/:id/edit" element={<PersonEditor type="Patient" />} />
            <Route
              path="/doctors/:id/edit"
              element={role === 'Admin' ? <PersonEditor type="Practitioner" /> : <Forbidden />}
            />
            <Route path="/patients/:id" element={<PersonDetails type="Patient" />} />
            <Route
              path="/doctors/:id"
              element={role !== 'Patient' ? <PersonDetails type="Practitioner" /> : <Forbidden />}
            />
            <Route path="/users" element={role === 'Admin' ? <Users /> : <Forbidden />} />
            <Route path="/signin" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
        <footer>
          Smart Hospital Platform <span>Quản lý tài khoản & hồ sơ bệnh nhân</span>
        </footer>
      </div>
    </div>
  );
}

function Forbidden() {
  return (
    <div className="notice error" role="alert">
      Bạn không có quyền truy cập chức năng này.
    </div>
  );
}

function Dashboard({ role }: { role: HospitalRole }) {
  const client = useMedplum();
  const [stats, setStats] = useState<Record<string, number>>({});
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let live = true;
    const types: ResourceType[] =
      role === 'Patient' ? ['Patient', 'Appointment'] : ['Patient', 'Practitioner', 'Appointment'];
    Promise.all(
      types.map(
        async (type) =>
          [type, (await client.search(type, { _summary: 'count', _total: 'accurate' })).total ?? 0] as const
      )
    )
      .then((entries) => {
        if (live) setStats(Object.fromEntries(entries));
      })
      .catch((e) => {
        if (live) setError(e);
      });
    client
      .searchResources('Appointment', { _count: '5', _sort: 'date' })
      .then((data) => {
        if (live) setAppointments(data);
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
    };
  }, [client, role]);
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE OVERVIEW"
        title={`Tổng quan ${ROLE_LABELS[role].toLowerCase()}`}
        description="Dữ liệu trong phạm vi quyền truy cập của bạn."
      />
      <ErrorMessage error={error} />
      <div className="stat-grid">
        {Object.entries(stats).map(([type, count]) => (
          <section className="stat-card" key={type}>
            <span>
              {
                (
                  { Patient: 'Hồ sơ bệnh nhân', Practitioner: 'Bác sĩ', Appointment: 'Lịch hẹn cơ bản' } as Record<
                    string,
                    string
                  >
                )[type]
              }
            </span>
            <strong>{count}</strong>
            <small>Đồng bộ từ FHIR API</small>
          </section>
        ))}
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Lịch hẹn trong hệ thống</h2>
            <p className="muted">Lịch hẹn mẫu · Chưa hỗ trợ quy trình đặt lịch</p>
          </div>
          <span className="pill">FHIR Appointment</span>
        </div>
        {appointments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Nội dung</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td>{a.start ? new Date(a.start).toLocaleString('vi-VN') : 'Chưa xác định'}</td>
                    <td>{a.description}</td>
                    <td>
                      <span className="pill">{a.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Chưa có lịch hẹn trong phạm vi truy cập.</p>
        )}
      </section>
      <section className="info-banner">
        <span>✦</span>
        <div>
          <h3>Một hồ sơ, thông tin nhất quán</h3>
          <p>
            Dữ liệu Patient và Practitioner được tổ chức theo FHIR R4. Mọi truy cập đều được backend kiểm tra quyền.
          </p>
        </div>
      </section>
    </>
  );
}

function AppointmentPage({ role, profile }: { role: HospitalRole; profile: Patient | Practitioner }) {
  const client = useMedplum();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [practitioners, setPractitioners] = useState<Practitioner[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [recurringSeriesIds, setRecurringSeriesIds] = useState<string[]>(() => {
    try {
      const stored = window.sessionStorage.getItem('smart-hospital.recurring-slot-series-list');
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) return parsed;
        return [];
      }
      const previous = window.sessionStorage.getItem('smart-hospital.recurring-slot-series');
      return previous ? [previous] : [];
    } catch {
      return [];
    }
  });
  const [selectedRecurringSeriesId, setSelectedRecurringSeriesId] = useState<string>();
  const staff = role !== 'Patient';

  useEffect(() => {
    let live = true;
    setError(undefined);
    const requests: Promise<unknown>[] = [client.searchResources('Appointment', { _count: '100', _sort: 'date' })];
    if (staff) {
      requests.push(
        client.searchResources('Patient', { _count: '100', _sort: 'name' }),
        client.searchResources('Practitioner', { _count: '100', _sort: 'name' }),
        client.searchResources('Schedule', { _count: '100' }),
        client.searchResources('Slot', {
          status: 'free',
          start: `ge${new Date().toISOString()}`,
          _count: '100',
          _sort: 'start',
        })
      );
    }
    Promise.all(requests)
      .then(([appointmentResults, patientResults, practitionerResults, scheduleResults, slotResults]) => {
        if (!live) return;
        setAppointments(appointmentResults as Appointment[]);
        if (staff) {
          setPatients(patientResults as Patient[]);
          setPractitioners(practitionerResults as Practitioner[]);
          setSchedules(scheduleResults as Schedule[]);
          setSlots(slotResults as Slot[]);
        }
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
    };
  }, [client, staff, refresh]);

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const selected = availableSlots.find(({ slot }) => slot.id === String(data.get('slot')));
    if (!selected?.slot.id || !selected.slot.start || !selected.slot.end) {
      setError(new Error('Chọn một khung giờ còn trống.'));
      return;
    }
    const slot = selected.slot;
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    const patientId = String(data.get('patient'));
    const practitionerId = selected.practitionerReference.split('/')[1];
    if (!patientId || !practitionerId || start <= new Date() || end <= start) {
      setError(new Error('Khung giờ, bệnh nhân hoặc bác sĩ không còn hợp lệ.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const currentSlot = await client.readResource<Slot>('Slot', slot.id);
      if (currentSlot.status !== 'free') {
        setError(new Error('Khung giờ vừa được đặt. Hãy chọn khung giờ khác.'));
        setRefresh((value) => value + 1);
        return;
      }
      const existing = await client.searchResources('Appointment', {
        actor: `Practitioner/${practitionerId}`,
        _count: '1000',
      });
      const conflict = findAppointmentConflict(existing, practitionerId, start, end);
      if (conflict) {
        const conflictTime = conflict.start ? new Date(conflict.start).toLocaleString('vi-VN') : 'không xác định';
        setError(new Error(`Bác sĩ đã có lịch hẹn bắt đầu lúc ${conflictTime}.`));
        return;
      }
      await client.post('fhir/R4', {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: [
          {
            resource: { ...currentSlot, status: 'busy' },
            request: {
              method: 'PUT',
              url: `Slot/${slot.id}`,
              ifMatch: currentSlot.meta?.versionId ? `W/"${currentSlot.meta.versionId}"` : undefined,
            },
          },
          {
            resource: {
              resourceType: 'Appointment',
              status: 'booked',
              description: String(data.get('description')).trim() || undefined,
              start: start.toISOString(),
              end: end.toISOString(),
              slot: [{ reference: `Slot/${slot.id}` }],
              participant: [
                { actor: { reference: `Patient/${patientId}` }, status: 'accepted' },
                { actor: { reference: `Practitioner/${practitionerId}` }, status: 'accepted' },
              ],
            },
            request: { method: 'POST', url: 'Appointment' },
          },
        ],
      });
      setMessage('Đã tạo lịch hẹn và đánh dấu khung giờ bận.');
      form.reset();
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancelAppointment(appointment: Appointment) {
    if (!appointment.id || !window.confirm('Hủy lịch hẹn này?')) return;
    setError(undefined);
    setMessage('');
    try {
      const entries: Array<Record<string, unknown>> = [
        {
          resource: { ...appointment, status: 'cancelled' },
          request: {
            method: 'PUT',
            url: `Appointment/${appointment.id}`,
            ifMatch: appointment.meta?.versionId ? `W/"${appointment.meta.versionId}"` : undefined,
          },
        },
      ];
      const slotReference = appointment.slot?.[0]?.reference;
      if (slotReference?.startsWith('Slot/')) {
        const slot = await client.readResource<Slot>('Slot', slotReference.slice('Slot/'.length));
        if (slot.status === 'busy' && slot.id) {
          entries.push({
            resource: { ...slot, status: 'free' },
            request: {
              method: 'PUT',
              url: `Slot/${slot.id}`,
              ifMatch: slot.meta?.versionId ? `W/"${slot.meta.versionId}"` : undefined,
            },
          });
        }
      }
      await client.post('fhir/R4', { resourceType: 'Bundle', type: 'transaction', entry: entries });
      setMessage('Đã hủy lịch hẹn.');
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(e);
    }
  }

  async function recordAppointmentOutcome(appointment: Appointment, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!staff || !appointment.id || !appointment.start || new Date(appointment.start) > new Date()) return;
    if (!['proposed', 'pending', 'booked', 'arrived', 'checked-in', 'waitlist'].includes(appointment.status ?? '')) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const status = String(data.get('appointmentOutcome'));
    const reason = String(data.get('appointmentOutcomeReason') ?? '').trim();
    if ((status !== 'fulfilled' && status !== 'noshow') || !reason) {
      setError(new Error('Chọn kết quả hợp lệ và nhập lý do ghi nhận.'));
      return;
    }
    if (status === 'noshow' && appointment.end && new Date(appointment.end) > new Date()) {
      setError(new Error('Chỉ ghi nhận không đến sau khi khung giờ hẹn đã kết thúc.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const timestamp = new Date().toISOString();
      const actor = profile.id ? `Practitioner/${profile.id}` : 'Nhân viên';
      const comment = [appointment.comment, `[${timestamp} · ${actor}] ${status}: ${reason}`].filter(Boolean).join('\n');
      const updated = await client.updateResource<Appointment>({ ...appointment, status, comment });
      setAppointments((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(status === 'fulfilled' ? 'Đã ghi nhận lịch hẹn hoàn tất.' : 'Đã ghi nhận bệnh nhân không đến.');
      form.reset();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function createAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const start = new Date(String(data.get('availabilityStart')));
    const end = new Date(String(data.get('availabilityEnd')));
    const practitionerId = role === 'Doctor' ? profile.id : String(data.get('availabilityPractitioner'));
    if (!practitionerId || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start <= new Date() || end <= start) {
      setError(new Error('Chọn bác sĩ và khung giờ tương lai hợp lệ.'));
      return;
    }
    const practitionerReference = `Practitioner/${practitionerId}`;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const existingAppointments = await client.searchResources('Appointment', {
        actor: practitionerReference,
        _count: '1000',
      });
      const appointmentConflict = findAppointmentConflict(existingAppointments, practitionerId, start, end);
      if (appointmentConflict) {
        setError(new Error('Không thể mở khung giờ trong khoảng thời gian đã có lịch hẹn.'));
        return;
      }
      const practitionerSchedules = await client.searchResources('Schedule', {
        actor: practitionerReference,
        _count: '100',
      });
      const activeSchedules = practitionerSchedules.filter((item) => item.active !== false);
      let schedule = activeSchedules[0];
      if (!schedule) {
        schedule = await client.createResource<Schedule>({
          resourceType: 'Schedule',
          identifier: [{ system: 'urn:smart-hospital:availability', value: practitionerId }],
          active: true,
          actor: [{ reference: practitionerReference }],
        });
      }
      const existingSlots = (
        await Promise.all(
          activeSchedules.map((item) =>
            client.searchResources('Slot', { schedule: `Schedule/${item.id}`, _count: '1000' })
          )
        )
      ).flat();
      const slotConflict = existingSlots.some((slot) => {
        if (!slot.start || !slot.end || slot.status === 'entered-in-error') return false;
        const slotStart = new Date(slot.start);
        const slotEnd = new Date(slot.end);
        return Number.isFinite(slotStart.getTime()) && Number.isFinite(slotEnd.getTime()) && start < slotEnd && slotStart < end;
      });
      if (slotConflict) {
        setError(new Error('Khung giờ giao nhau với một Slot hiện có.'));
        return;
      }
      await client.createResource<Slot>({
        resourceType: 'Slot',
        schedule: { reference: `Schedule/${schedule.id}` },
        status: 'free',
        start: start.toISOString(),
        end: end.toISOString(),
      });
      setMessage('Đã thêm khung giờ trống.');
      form.reset();
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function createRecurringAvailability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const practitionerId = role === 'Doctor' ? profile.id : String(data.get('availabilityPractitioner'));
    const replaceSeries = data.has('replaceRecurringSeries');
    const seriesIdToReplace = selectedRecurringSeriesId ?? recurringSeriesIds[0];
    const intervals = removeOverlappingIntervals(expandRecurringSlotIntervals({
      startDate: new Date(`${String(data.get('recurringStartDate'))}T00:00:00`),
      endDate: new Date(`${String(data.get('recurringEndDate'))}T00:00:00`),
      startTime: String(data.get('recurringStartTime')),
      endTime: String(data.get('recurringEndTime')),
      weekdays: data.getAll('recurringWeekday').map(Number),
    })).filter(({ start }) => start > new Date());
    if (!practitionerId || intervals.length === 0) {
      setError(new Error('Chọn các ngày và khoảng thời gian tương lai hợp lệ để tạo lịch.'));
      return;
    }
    if (intervals.length > 100) {
      setError(new Error('Lịch lặp vượt quá 100 Slot. Hãy rút ngắn khoảng ngày.'));
      return;
    }
    if (replaceSeries && !seriesIdToReplace) {
      setError(new Error('Chọn một series gần đây để thay đổi.'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const practitionerReference = `Practitioner/${practitionerId}`;
      const [appointments, practitionerSchedules] = await Promise.all([
        client.searchResources('Appointment', { actor: practitionerReference, _count: '1000' }),
        client.searchResources('Schedule', { actor: practitionerReference, _count: '100' }),
      ]);
      const oldSeriesSlots = replaceSeries
        ? await client.searchResources('Slot', {
            identifier: `${RECURRING_SLOT_SERIES_SYSTEM}|${seriesIdToReplace}`,
            status: 'free',
            start: `ge${new Date().toISOString()}`,
            _count: '100',
          })
        : [];
      if (replaceSeries && oldSeriesSlots.length === 0) {
        setError(new Error('Series không còn Slot trống trong tương lai để thay đổi.'));
        return;
      }
      const activeSchedules = practitionerSchedules.filter((item) => item.active !== false);
      let schedule = replaceSeries
        ? activeSchedules.find((item) => `Schedule/${item.id}` === oldSeriesSlots[0]?.schedule?.reference)
        : activeSchedules[0];
      if (replaceSeries && !schedule) {
        setError(new Error('Series không thuộc bác sĩ đã chọn hoặc Schedule của series đã ngừng hoạt động.'));
        return;
      }
      const existingSlots = (
        await Promise.all(
          activeSchedules.map((item) =>
            client.searchResources('Slot', { schedule: `Schedule/${item.id}`, _count: '1000' })
          )
        )
      ).flat();
      const oldSlotIds = new Set(oldSeriesSlots.map((slot) => slot.id).filter((id): id is string => Boolean(id)));
      const availableIntervals = removeIntervalsConflictingWithSlots(intervals, existingSlots, oldSlotIds).filter(
        ({ start, end }) => !findAppointmentConflict(appointments, practitionerId, start, end)
      );
      if (availableIntervals.length === 0) {
        setError(new Error('Mọi khung giờ tạo ra đều trùng với lịch hẹn hoặc Slot hiện có.'));
        return;
      }
      if (!schedule && !replaceSeries) {
        schedule = await client.createResource<Schedule>({
          resourceType: 'Schedule',
          identifier: [{ system: 'urn:smart-hospital:availability', value: practitionerId }],
          active: true,
          actor: [{ reference: practitionerReference }],
        });
      }
      if (!schedule) throw new Error('Schedule không khả dụng để tạo Slot.');
      const seriesId = replaceSeries ? seriesIdToReplace! : crypto.randomUUID();
      const transactionEntries = [
        ...oldSeriesSlots.filter((slot) => slot.id).map((slot) => ({
          resource: { ...slot, status: 'entered-in-error' },
          request: {
            method: 'PUT',
            url: `Slot/${slot.id}`,
            ifMatch: slot.meta?.versionId ? `W/\"${slot.meta.versionId}\"` : undefined,
          },
        })),
        ...availableIntervals.map(({ start, end }) => ({
          resource: {
            resourceType: 'Slot',
            schedule: { reference: `Schedule/${schedule.id}` },
            identifier: [{ system: RECURRING_SLOT_SERIES_SYSTEM, value: seriesId }],
            status: 'free',
            start: start.toISOString(),
            end: end.toISOString(),
          },
          request: { method: 'POST', url: 'Slot' },
        })),
      ];
      if (transactionEntries.length > 100) {
        setError(new Error('Thay đổi series vượt quá 100 thao tác. Hãy dùng khoảng ngày ngắn hơn.'));
        return;
      }
      await client.post('fhir/R4', {
        resourceType: 'Bundle',
        type: 'transaction',
        entry: transactionEntries,
      });
      const nextSeriesIds = [seriesId, ...recurringSeriesIds.filter((id) => id !== seriesId)].slice(0, 20);
      window.sessionStorage.setItem('smart-hospital.recurring-slot-series-list', JSON.stringify(nextSeriesIds));
      setRecurringSeriesIds(nextSeriesIds);
      setSelectedRecurringSeriesId(seriesId);
      setMessage(
        `${replaceSeries ? 'Đã cập nhật' : 'Đã thêm'} ${availableIntervals.length} khung giờ; bỏ qua ${
          intervals.length - availableIntervals.length
        } khung giờ bị trùng.`
      );
      form.reset();
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function cancelCreatedRecurringSeries() {
    if (!selectedRecurringSeriesId || !window.confirm('Hủy các Slot trống trong tương lai của series đã chọn?')) return;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const seriesSlots = await client.searchResources('Slot', {
        identifier: `${RECURRING_SLOT_SERIES_SYSTEM}|${selectedRecurringSeriesId}`,
        status: 'free',
        start: `ge${new Date().toISOString()}`,
        _count: '100',
      });
      if (seriesSlots.length > 0) {
        await client.post('fhir/R4', {
          resourceType: 'Bundle',
          type: 'transaction',
          entry: seriesSlots.filter((slot) => slot.id).map((slot) => ({
            resource: { ...slot, status: 'busy-unavailable' },
            request: {
              method: 'PUT',
              url: `Slot/${slot.id}`,
              ifMatch: slot.meta?.versionId ? `W/\"${slot.meta.versionId}\"` : undefined,
            },
          })),
        });
      }
      setMessage(`Đã ngừng ${seriesSlots.length} Slot còn trống; Slot đã có lịch hẹn được giữ nguyên.`);
      const nextSeriesIds = recurringSeriesIds.filter((id) => id !== selectedRecurringSeriesId);
      window.sessionStorage.setItem('smart-hospital.recurring-slot-series-list', JSON.stringify(nextSeriesIds));
      window.sessionStorage.removeItem('smart-hospital.recurring-slot-series');
      setRecurringSeriesIds(nextSeriesIds);
      setSelectedRecurringSeriesId(nextSeriesIds[0]);
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function deactivateSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const scheduleId = String(new FormData(form).get('scheduleToDeactivate'));
    if (!scheduleId || !window.confirm('Tắt Schedule và ngừng các Slot còn trống trong tương lai?')) return;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const [schedule, futureFreeSlots] = await Promise.all([
        client.readResource<Schedule>('Schedule', scheduleId),
        client.searchResources('Slot', {
          schedule: `Schedule/${scheduleId}`,
          status: 'free',
          start: `ge${new Date().toISOString()}`,
          _count: '1000',
        }),
      ]);
      if (schedule.active === false) {
        setError(new Error('Schedule đã được tắt.'));
        return;
      }
      if (futureFreeSlots.length > 999) {
        setError(new Error('Schedule cần hơn 1.000 thao tác. Hãy ngừng một số series trước khi tắt Schedule.'));
        return;
      }
      const entries = [
        ...futureFreeSlots.filter((slot) => slot.id).map((slot) => ({
          resource: { ...slot, status: 'busy-unavailable' },
          request: {
            method: 'PUT',
            url: `Slot/${slot.id}`,
            ifMatch: slot.meta?.versionId ? `W/\"${slot.meta.versionId}\"` : undefined,
          },
        })),
        {
          resource: { ...schedule, active: false },
          request: {
            method: 'PUT',
            url: `Schedule/${schedule.id}`,
            ifMatch: schedule.meta?.versionId ? `W/\"${schedule.meta.versionId}\"` : undefined,
          },
        },
      ];
      await client.post('fhir/R4', { resourceType: 'Bundle', type: 'transaction', entry: entries });
      setMessage(`Đã tắt Schedule và ngừng ${futureFreeSlots.length} Slot còn trống trong tương lai.`);
      form.reset();
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const patientProfile = profile.resourceType === 'Patient' ? profile : undefined;
  const doctorProfile = profile.resourceType === 'Practitioner' ? profile : undefined;
  const availableSlots = findAvailableSlots(slots, schedules, role === 'Doctor' ? doctorProfile?.id : undefined).filter(
    ({ practitionerReference }) =>
      practitioners.some((practitioner) => `Practitioner/${practitioner.id}` === practitionerReference && practitioner.active !== false)
  );
  return (
    <>
      <PageTitle
        eyebrow="APPOINTMENTS"
        title="Lịch hẹn"
        description={staff ? 'Tạo và theo dõi lịch hẹn trong phạm vi quyền truy cập.' : 'Lịch hẹn trong hồ sơ của bạn.'}
      />
      <ErrorMessage error={error} />
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {staff && (
        <form className="panel editor" onSubmit={createAppointment}>
          <h2>Tạo lịch hẹn</h2>
          <p className="muted">Chỉ khung giờ FHIR Slot còn trống mới được dùng để đặt lịch.</p>
          <div className="form-grid">
            <label>
              Bệnh nhân
              <select name="patient" required defaultValue="">
                <option value="" disabled>
                  Chọn bệnh nhân
                </option>
                {patients
                  .filter((patient) => patient.active !== false)
                  .map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {personName(patient)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Khung giờ trống
              <select name="slot" required defaultValue="">
                <option value="" disabled>
                  Chọn khung giờ
                </option>
                {availableSlots.map(({ slot, practitionerReference }) => {
                  const practitioner = practitioners.find((item) => `Practitioner/${item.id}` === practitionerReference);
                  return (
                    <option key={slot.id} value={slot.id}>
                      {new Date(slot.start!).toLocaleString('vi-VN')} – {new Date(slot.end!).toLocaleTimeString('vi-VN')} · {practitioner ? personName(practitioner) : 'Bác sĩ'}
                    </option>
                  );
                })}
              </select>
            </label>
            {availableSlots.length === 0 && (
              <p className="empty full-width">Chưa có khung giờ trống cho bác sĩ bạn được phép xem.</p>
            )}
            <label className="full-width">
              Nội dung
              <input name="description" maxLength={200} placeholder="Ví dụ: Tái khám" />
            </label>
          </div>
          <div className="form-actions">
            <button
              className="button primary"
              disabled={busy || patients.length === 0 || availableSlots.length === 0}
            >
              {busy ? 'Đang lưu…' : 'Tạo lịch hẹn'}
            </button>
          </div>
        </form>
      )}
      {staff && (
        <form className="panel editor" onSubmit={createAvailability}>
          <h2>Thêm khung giờ trống</h2>
          <p className="muted">Tạo một Slot riêng trong Schedule của bác sĩ.</p>
          <div className="form-grid">
            {role === 'Admin' ? (
              <label>
                Bác sĩ
                <select name="availabilityPractitioner" required defaultValue="">
                  <option value="" disabled>
                    Chọn bác sĩ
                  </option>
                  {practitioners
                    .filter((practitioner) => practitioner.active !== false)
                    .map((practitioner) => (
                      <option key={practitioner.id} value={practitioner.id}>
                        {personName(practitioner)}
                      </option>
                    ))}
                </select>
              </label>
            ) : (
              <label>
                Bác sĩ
                <input value={doctorProfile ? personName(doctorProfile) : 'Hồ sơ bác sĩ hiện tại'} disabled />
              </label>
            )}
            <label>
              Bắt đầu
              <input
                name="availabilityStart"
                type="datetime-local"
                min={localDateTimeValue(new Date())}
                required
              />
            </label>
            <label>
              Kết thúc
              <input name="availabilityEnd" type="datetime-local" required />
            </label>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={busy || (role === 'Admin' && practitioners.length === 0)}>
              {busy ? 'Đang lưu…' : 'Thêm Slot'}
            </button>
          </div>
        </form>
      )}
      {staff && (
        <form className="panel editor" onSubmit={createRecurringAvailability}>
          <h2>Tạo khung giờ lặp</h2>
          <p className="muted">Tạo hoặc thay Slot trống của lịch lặp; Slot đã có lịch hẹn được giữ nguyên. Mỗi transaction tối đa 100 thao tác.</p>
          <div className="form-grid">
            {role === 'Admin' ? (
              <label>
                Bác sĩ
                <select name="availabilityPractitioner" required defaultValue="">
                  <option value="" disabled>Chọn bác sĩ</option>
                  {practitioners.filter((practitioner) => practitioner.active !== false).map((practitioner) => (
                    <option key={practitioner.id} value={practitioner.id}>{personName(practitioner)}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label>Bác sĩ<input value={doctorProfile ? personName(doctorProfile) : 'Hồ sơ bác sĩ hiện tại'} disabled /></label>
            )}
            <label>Ngày bắt đầu<input name="recurringStartDate" type="date" required /></label>
            <label>Ngày kết thúc<input name="recurringEndDate" type="date" required /></label>
            <label>Giờ bắt đầu<input name="recurringStartTime" type="time" required /></label>
            <label>Giờ kết thúc<input name="recurringEndTime" type="time" required /></label>
            <label className="full-width">
              <input name="replaceRecurringSeries" type="checkbox" disabled={recurringSeriesIds.length === 0} />
              {' '}Thay các Slot còn trống trong tương lai của series đã chọn
            </label>
            <fieldset className="full-width">
              <legend>Ngày trong tuần</legend>
              {['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'].map((day, index) => (
                <label key={day}><input name="recurringWeekday" type="checkbox" value={index} /> {day}</label>
              ))}
            </fieldset>
          </div>
          <div className="form-actions">
            <button className="button primary" disabled={busy || (role === 'Admin' && practitioners.length === 0)}>
              {busy ? 'Đang lưu…' : 'Tạo lịch lặp'}
            </button>
            {recurringSeriesIds.length > 0 && (
              <>
                <label>
                  Series gần đây
                  <select
                    value={selectedRecurringSeriesId ?? recurringSeriesIds[0]}
                    onChange={(event) => setSelectedRecurringSeriesId(event.currentTarget.value)}
                  >
                    {recurringSeriesIds.map((seriesId) => <option key={seriesId} value={seriesId}>{seriesId}</option>)}
                  </select>
                </label>
                <button className="button" type="button" disabled={busy} onClick={cancelCreatedRecurringSeries}>
                  Hủy Slot trống của series đã chọn
                </button>
              </>
            )}
          </div>
        </form>
      )}
      {staff && schedules.some((schedule) => schedule.active !== false) && (
        <form className="panel editor" onSubmit={deactivateSchedule}>
          <h2>Tắt Schedule</h2>
          <p className="muted">Các Slot còn trống trong tương lai được ngừng cùng lúc; lịch hẹn đã đặt vẫn giữ nguyên.</p>
          <div className="form-grid">
            <label>
              Schedule đang hoạt động
              <select name="scheduleToDeactivate" required defaultValue="">
                <option value="" disabled>Chọn Schedule</option>
                {schedules.filter((schedule) => schedule.active !== false).map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>{schedule.actor?.map((actor) => actor.display ?? actor.reference).join(', ') || schedule.id}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="button" disabled={busy}>{busy ? 'Đang lưu…' : 'Tắt Schedule'}</button>
          </div>
        </form>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{patientProfile ? 'Lịch hẹn của tôi' : 'Lịch hẹn trong hệ thống'}</h2>
            <p className="muted">Dữ liệu được lọc theo quyền trên FHIR API.</p>
          </div>
          <span className="pill">FHIR Appointment</span>
        </div>
        {appointments.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Bệnh nhân</th>
                  <th>Bác sĩ</th>
                  <th>Nội dung</th>
                  <th>Trạng thái</th>
                  <th>Ghi chú</th>
                  {staff && <th />}
                </tr>
              </thead>
              <tbody>
                {appointments.map((appointment) => {
                  const patientRef = appointment.participant?.find((participant) =>
                    participant.actor?.reference?.startsWith('Patient/')
                  )?.actor?.reference;
                  const practitionerRef = appointment.participant?.find((participant) =>
                    participant.actor?.reference?.startsWith('Practitioner/')
                  )?.actor?.reference;
                  const patient = patients.find((item) => `Patient/${item.id}` === patientRef);
                  const practitioner = practitioners.find((item) => `Practitioner/${item.id}` === practitionerRef);
                  const canCancel =
                    ['proposed', 'pending', 'booked', 'waitlist'].includes(appointment.status ?? '') &&
                    !!appointment.start &&
                    new Date(appointment.start) > new Date();
                  const canRecordOutcome =
                    ['proposed', 'pending', 'booked', 'arrived', 'checked-in', 'waitlist'].includes(appointment.status ?? '') &&
                    !!appointment.start && new Date(appointment.start) <= new Date();
                  return (
                    <tr key={appointment.id} data-resource-id={appointment.id}>
                      <td>
                        {appointment.start ? new Date(appointment.start).toLocaleString('vi-VN') : 'Chưa xác định'}
                      </td>
                      <td>
                        {patient
                          ? personName(patient)
                          : patientProfile && patientRef === `Patient/${patientProfile.id}`
                            ? 'Tôi'
                            : (patientRef ?? '—')}
                      </td>
                      <td>{practitioner ? personName(practitioner) : practitionerRef ? 'Bác sĩ' : '—'}</td>
                      <td>{appointment.description || '—'}</td>
                      <td>
                        <span className="pill">{appointment.status}</span>
                      </td>
                      <td>{appointment.comment || '—'}</td>
                      {staff && <td>
                          {canCancel && (
                            <button className="button secondary" onClick={() => void cancelAppointment(appointment)}>
                              Hủy
                            </button>
                          )}
                          {canRecordOutcome && <details>
                            <summary>Ghi nhận kết quả</summary>
                            <form className="editor" onSubmit={(event) => void recordAppointmentOutcome(appointment, event)}>
                              <label>Kết quả
                                <select name="appointmentOutcome" defaultValue="fulfilled">
                                  <option value="fulfilled">Đã hoàn tất</option>
                                  <option value="noshow" disabled={!!appointment.end && new Date(appointment.end) > new Date()}>Bệnh nhân không đến</option>
                                </select>
                              </label>
                              <label>Lý do/ghi chú<textarea name="appointmentOutcomeReason" maxLength={500} rows={2} required /></label>
                              <button className="button" disabled={busy}>Lưu kết quả</button>
                            </form>
                          </details>}
                        </td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Chưa có lịch hẹn trong phạm vi truy cập.</p>
        )}
      </section>
    </>
  );
}

function localDateTimeValue(date: Date): string {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

function PeopleList({ type }: { type: 'Patient' | 'Practitioner' }) {
  const client = useMedplum();
  const [items, setItems] = useState<(Patient | Practitioner)[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const base = type === 'Patient' ? '/patients' : '/doctors';
  const admin = client.getProjectMembership()?.admin;
  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setItems(
        await client.searchResources(type, {
          ...(query.trim() ? { name: query.trim() } : {}),
          _count: '100',
          _sort: '-_lastUpdated',
        })
      );
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [client, type, query]);
  useEffect(() => {
    setItems([]);
    void load();
  }, [type]);
  return (
    <>
      <PageTitle
        eyebrow={type === 'Patient' ? 'PATIENT DIRECTORY' : 'CARE TEAM'}
        title={type === 'Patient' ? 'Quản lý bệnh nhân' : 'Danh sách bác sĩ'}
        description="Tìm kiếm và quản lý thông tin hồ sơ theo chuẩn FHIR."
        action={
          (type === 'Patient' || admin) && (
            <Link className="button primary" to={`${base}/new`}>
              + Thêm {type === 'Patient' ? 'bệnh nhân' : 'bác sĩ'}
            </Link>
          )
        }
      />
      <section className="panel">
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
        >
          <label htmlFor="search" className="sr-only">
            Tìm theo tên
          </label>
          <input id="search" placeholder="Tìm theo tên…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="button secondary">Tìm kiếm</button>
          <span className="muted">{items.length} hồ sơ</span>
        </form>
        <ErrorMessage error={error} />
        {loading ? (
          <p className="empty">Đang tải hồ sơ…</p>
        ) : items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Họ và tên</th>
                  <th>Giới tính</th>
                  <th>Liên hệ</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`${base}/${item.id}`} className="person-link">
                        {personName(item)}
                      </Link>
                      <small>{item.identifier?.[0]?.value ?? item.id?.slice(0, 8)}</small>
                    </td>
                    <td>{item.gender ?? '—'}</td>
                    <td>{item.telecom?.find((t) => t.system === 'phone')?.value ?? '—'}</td>
                    <td>
                      <span className={`pill ${item.active === false ? 'inactive' : ''}`}>
                        {item.active === false ? 'Ngừng hoạt động' : 'Đang hoạt động'}
                      </span>
                    </td>
                    <td>
                      <Link to={`${base}/${item.id}`}>Xem hồ sơ →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Không tìm thấy hồ sơ phù hợp.</p>
        )}
      </section>
    </>
  );
}

function PersonDetails({ type }: { type: 'Patient' | 'Practitioner' }) {
  const client = useMedplum();
  const { id } = useParams();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Patient | Practitioner>();
  const [error, setError] = useState<unknown>();
  const role = getRole(client.getProjectMembership(), client.getProfile());
  const base = type === 'Patient' ? '/patients' : '/doctors';
  useEffect(() => {
    setPerson(undefined);
    setError(undefined);
    client.readResource(type, id!).then(setPerson).catch(setError);
  }, [client, type, id]);
  async function remove() {
    if (!window.confirm('Xóa mềm hồ sơ này?')) return;
    try {
      await client.deleteResource(type, id!);
      navigate(base);
    } catch (e) {
      setError(e);
    }
  }
  const canEdit = type === 'Patient' || role === 'Admin';
  return (
    <>
      <PageTitle
        eyebrow="PERSON RECORD"
        title={person ? personName(person) : 'Hồ sơ'}
        description={`${type} · ${id}`}
        action={
          canEdit &&
          person && (
            <Link className="button primary" to={`${base}/${id}/edit`}>
              Chỉnh sửa hồ sơ
            </Link>
          )
        }
      />
      <ErrorMessage error={error} />
      {person && (
        <section className="panel details">
          <h2>Thông tin cá nhân</h2>
          <dl>
            <dt>Họ và tên</dt>
            <dd>{personName(person)}</dd>
            <dt>Ngày sinh</dt>
            <dd>{person.birthDate ?? '—'}</dd>
            <dt>Giới tính</dt>
            <dd>{person.gender ?? '—'}</dd>
            <dt>Điện thoại</dt>
            <dd>{person.telecom?.find((t) => t.system === 'phone')?.value ?? '—'}</dd>
            <dt>Email</dt>
            <dd>{person.telecom?.find((t) => t.system === 'email')?.value ?? '—'}</dd>
            <dt>Địa chỉ</dt>
            <dd>{person.address?.[0]?.text ?? '—'}</dd>
            <dt>Cập nhật lần cuối</dt>
            <dd>{person.meta?.lastUpdated ? new Date(person.meta.lastUpdated).toLocaleString('vi-VN') : '—'}</dd>
          </dl>
          {role === 'Admin' && (
            <button className="button danger" onClick={remove}>
              Xóa mềm hồ sơ
            </button>
          )}
        </section>
      )}
    </>
  );
}

function PersonEditor({ type }: { type: 'Patient' | 'Practitioner' }) {
  const client = useMedplum();
  const { id } = useParams();
  const navigate = useNavigate();
  const [person, setPerson] = useState<Patient | Practitioner>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const base = type === 'Patient' ? '/patients' : '/doctors';
  useEffect(() => {
    setPerson(undefined);
    if (id) client.readResource(type, id).then(setPerson).catch(setError);
    else setPerson({ resourceType: type, active: true });
  }, [client, id, type]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!person) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    const resource = {
      ...person,
      name: [{ family: String(data.get('family')).trim(), given: [String(data.get('given')).trim()] }],
      gender: String(data.get('gender')) || undefined,
      birthDate: String(data.get('birthDate')) || undefined,
      telecom: [
        { system: 'phone', value: String(data.get('phone')) },
        { system: 'email', value: String(data.get('email')) },
      ].filter((t) => t.value),
      address: [{ text: String(data.get('address')) }],
      active: data.get('active') === 'on',
    } as Patient | Practitioner;
    try {
      const result = resource.id ? await client.updateResource(resource) : await client.createResource(resource);
      navigate(`${base}/${result.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="PERSON RECORD"
        title={`${id ? 'Chỉnh sửa' : 'Thêm'} ${type === 'Patient' ? 'bệnh nhân' : 'bác sĩ'}`}
        description="Thông tin được kiểm tra và lưu trực tiếp qua FHIR API."
      />
      <ErrorMessage error={error} />
      {person && (
        <form className="panel editor" onSubmit={save}>
          <div className="form-grid">
            <label>
              Họ
              <input name="family" required maxLength={100} defaultValue={person.name?.[0]?.family} />
            </label>
            <label>
              Tên
              <input name="given" required maxLength={100} defaultValue={person.name?.[0]?.given?.join(' ')} />
            </label>
            <label>
              Ngày sinh
              <input
                name="birthDate"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                defaultValue={person.birthDate}
              />
            </label>
            <label>
              Giới tính
              <select name="gender" defaultValue={person.gender ?? ''}>
                <option value="">Chưa xác định</option>
                <option value="male">Nam</option>
                <option value="female">Nữ</option>
                <option value="other">Khác</option>
                <option value="unknown">Không rõ</option>
              </select>
            </label>
            <label>
              Điện thoại
              <input
                name="phone"
                type="tel"
                maxLength={30}
                defaultValue={person.telecom?.find((t) => t.system === 'phone')?.value}
              />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue={person.telecom?.find((t) => t.system === 'email')?.value}
              />
            </label>
            <label className="full-width">
              Địa chỉ
              <input name="address" maxLength={300} defaultValue={person.address?.[0]?.text} />
            </label>
          </div>
          <label className="checkbox">
            <input name="active" type="checkbox" defaultChecked={person.active !== false} />
            Đang hoạt động
          </label>
          <div className="form-actions">
            <button className="button primary" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu hồ sơ'}
            </button>
            <Link className="button secondary" to={id ? `${base}/${id}` : base}>
              Hủy
            </Link>
          </div>
        </form>
      )}
    </>
  );
}

function Users() {
  const client = useMedplum();
  const [members, setMembers] = useState<ProjectMembership[]>([]);
  const [users, setUsers] = useState<Record<string, User>>({});
  const [profiles, setProfiles] = useState<Record<string, Patient | Practitioner>>({});
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const data = await client.searchResources('ProjectMembership', { _count: '100' });
    const humanMembers = data.filter(
      (member) =>
        member.user.reference?.startsWith('User/') &&
        (member.profile.reference?.startsWith('Patient/') || member.profile.reference?.startsWith('Practitioner/'))
    );
    setMembers(humanMembers);
    const profileData = await Promise.all(
      humanMembers.map((member) => {
        const [type, id] = member.profile.reference!.split('/');
        return client.readResource(type as 'Patient' | 'Practitioner', id);
      })
    );
    setProfiles(Object.fromEntries(profileData.map((profile) => [`${profile.resourceType}/${profile.id}`, profile])));
    const people = await client.searchResources('User', { _count: '100' });
    setUsers(Object.fromEntries(people.map((u) => [u.id!, u])));
  }, [client]);
  useEffect(() => {
    void load().catch(setError);
  }, [load]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      await client.invite(client.getProject()!.id!, {
        resourceType: data.get('role') === 'Patient' ? 'Patient' : 'Practitioner',
        firstName: String(data.get('firstName')).trim(),
        lastName: String(data.get('lastName')).trim(),
        email: String(data.get('email')),
        password: String(data.get('password')),
        admin: data.get('role') === 'Admin',
        sendEmail: false,
      });
      for (const type of ['ProjectMembership', 'User', 'Patient', 'Practitioner'] as const) {
        client.invalidateSearches(type);
      }
      form.reset();
      await load();
      setMessage('Đã tạo tài khoản local thành công.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(member: ProjectMembership) {
    if (member.id === client.getProjectMembership()?.id) return;
    try {
      await client.updateResource({ ...member, active: member.active === false });
      await load();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ACCESS MANAGEMENT"
        title="Quản lý người dùng"
        description="Tài khoản và quyền truy cập trong project bệnh viện."
      />
      <ErrorMessage error={error} />
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Thành viên</h2>
          <span className="pill">{members.length} tài khoản</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Người dùng</th>
                <th>Vai trò</th>
                <th>Trạng thái</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const user = users[member.user.reference?.split('/')[1] ?? ''];
                const profile = profiles[member.profile.reference ?? ''];
                return (
                  <tr key={member.id}>
                    <td>
                      {user
                        ? `${user.firstName} ${user.lastName}`
                        : profile
                          ? personName(profile)
                          : (member.profile.display ?? member.id)}
                      <small>
                        {user?.email ?? profile?.telecom?.find((contact) => contact.system === 'email')?.value}
                      </small>
                    </td>
                    <td>
                      {member.admin ? 'Admin' : member.profile.reference?.startsWith('Patient/') ? 'Patient' : 'Doctor'}
                    </td>
                    <td>{member.active === false ? 'Đã khóa' : 'Hoạt động'}</td>
                    <td>
                      {member.id !== client.getProjectMembership()?.id && (
                        <button className="button secondary" onClick={() => toggle(member)}>
                          {member.active === false ? 'Mở khóa' : 'Khóa tài khoản'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <form className="panel editor" onSubmit={invite}>
        <h2>Tạo tài khoản local</h2>
        <p className="muted">Dùng cơ chế invite của Medplum. Mật khẩu được đặt trực tiếp, không gửi email.</p>
        <div className="form-grid">
          <label>
            Tên người dùng
            <input name="firstName" required />
          </label>
          <label>
            Họ người dùng
            <input name="lastName" required />
          </label>
          <label>
            Email đăng nhập
            <input name="email" type="email" required />
          </label>
          <label>
            Mật khẩu ban đầu
            <input name="password" type="password" minLength={8} autoComplete="new-password" required />
          </label>
          <label>
            Vai trò
            <select name="role">
              <option>Doctor</option>
              <option>Patient</option>
              <option>Admin</option>
            </select>
          </label>
        </div>
        <button className="button primary" disabled={busy}>
          {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
        </button>
      </form>
    </>
  );
}
