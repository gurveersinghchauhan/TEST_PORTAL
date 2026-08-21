import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { PracticeTestsSection, PracticeTestsGridView } from './PracticeTests';
import LiveTestSetup from './LiveTestSetup';
import LiveTestMonitor from './LiveTestMonitor';
import TestRecord from './TestRecord';
import FullMockTests from './FullMockTests';
import BatchRosterPage from './BatchRosterPage';
import { useBackNavigation } from './useBackNavigation';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// Module-level (not defined inside TeacherDashboard) so every top-level
// sibling component in this file can use it without redefining its own copy.
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('auth_token')}` };
}

/* -------------------------------------------------------------------------
 * Icons — small hand-rolled outline icons so the dashboard doesn't need an
 * extra icon-library dependency.
 * ---------------------------------------------------------------------- */
function IconUserPlus({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20c0-3.31 2.46-6 5.5-6s5.5 2.69 5.5 6" />
      <path d="M18.5 8.5v5M16 11h5" />
    </svg>
  );
}

function IconUsers({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M2.75 19c0-3 2.57-5.5 5.75-5.5s5.75 2.5 5.75 5.5" />
      <circle cx="16.5" cy="8.5" r="2.4" />
      <path d="M14.75 13.8c2.65.28 4.75 2.53 4.75 5.2" />
    </svg>
  );
}

function IconClock({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function IconX({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconBroadcast({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="2.25" />
      <path d="M8.2 15.8a5.5 5.5 0 0 1 0-7.6M15.8 8.2a5.5 5.5 0 0 1 0 7.6" />
      <path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}

function IconRefresh({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3.5 12a8.5 8.5 0 0 1 14.5-6" />
      <path d="M20.5 12a8.5 8.5 0 0 1-14.5 6" />
      <path d="M18 4.5v3.5h-3.5M6 19.5V16h3.5" />
    </svg>
  );
}

function IconArchive({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3.5" y="4" width="17" height="4" rx="1" />
      <path d="M4.5 8v10.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8" />
      <path d="M10 12.5h4" />
    </svg>
  );
}

function IconLayers({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8Z" />
      <path d="m3.5 12 8.5 4.5L20.5 12" />
      <path d="m3.5 16 8.5 4.5 8.5-4.5" />
    </svg>
  );
}

/* -------------------------------------------------------------------------
 * Shared building blocks
 * ---------------------------------------------------------------------- */

/** Overlay + centered panel used by every modal on this page. */
function Modal({ title, onClose, children, maxWidth = 'max-w-lg' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className={`w-full ${maxWidth} max-h-[85vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">{title}</h2>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
              aria-label="Close"
            >
              <IconX className="h-5 w-5" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

/** One clickable tile in the top overview grid. */
function ActionCard({ icon, accent, title, subtitle, badge, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-4 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-md"
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${accent}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-neutral-800">{title}</h3>
          {badge}
        </div>
        <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>
      </div>
    </button>
  );
}

const inputClass =
  'w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100';

/* -------------------------------------------------------------------------
 * Add Student — modal form
 * ---------------------------------------------------------------------- */
function AddStudentModal({
  onClose,
  studentForm,
  updateStudentField,
  onSubmit,
  submitting,
  error,
  success,
  batches,
  batchesLoading,
  batchesError,
}) {
  return (
    <Modal title="Add a student" onClose={onClose}>
      <p className="mb-4 text-sm text-neutral-500">Creates a login for a student under you, assigned to a batch.</p>

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="student-name" className="mb-1 block text-xs font-medium text-neutral-600">
            Name
          </label>
          <input
            id="student-name"
            type="text"
            required
            value={studentForm.name}
            onChange={(e) => updateStudentField('name', e.target.value)}
            className={inputClass}
            placeholder="John Smith"
          />
        </div>

        <div>
          <label htmlFor="student-email" className="mb-1 block text-xs font-medium text-neutral-600">
            Email
          </label>
          <input
            id="student-email"
            type="email"
            required
            value={studentForm.email}
            onChange={(e) => updateStudentField('email', e.target.value)}
            className={inputClass}
            placeholder="john@example.com"
          />
        </div>

        <div>
          <label htmlFor="student-password" className="mb-1 block text-xs font-medium text-neutral-600">
            Password
          </label>
          <input
            id="student-password"
            type="password"
            required
            minLength={8}
            value={studentForm.password}
            onChange={(e) => updateStudentField('password', e.target.value)}
            className={inputClass}
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label htmlFor="student-contact" className="mb-1 block text-xs font-medium text-neutral-600">
            Contact Number
          </label>
          <input
            id="student-contact"
            type="tel"
            required
            value={studentForm.contactNumber}
            onChange={(e) => updateStudentField('contactNumber', e.target.value)}
            className={inputClass}
            placeholder="9876543210"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="student-batch" className="mb-1 block text-xs font-medium text-neutral-600">
            Batch
          </label>
          {batchesLoading ? (
            <p className="text-sm text-neutral-400">Loading batches…</p>
          ) : batchesError ? (
            <p className="text-sm text-rose-600">{batchesError}</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-neutral-400">
              No batches exist yet — ask your institute admin to create one first.
            </p>
          ) : (
            <select
              id="student-batch"
              required
              value={studentForm.batchId}
              onChange={(e) => updateStudentField('batchId', e.target.value)}
              className={`${inputClass} bg-white`}
            >
              <option value="" disabled>
                Select a batch…
              </option>
              {batches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">
            {error}
          </p>
        )}
        {success && (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 sm:col-span-2">
            {success}
          </p>
        )}

        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={submitting || batches.length === 0}
            className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create student'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
          >
            Done
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * TeacherDashboard
 * ----------------
 * Card-based home for the 'teacher' role: quick-action tiles up top, then
 * dedicated card sections for the batch roster and the live socket-driven
 * timer view below.
 *
 * @param {{ teacherId: string, teacherName?: string }} props
 */
export default function TeacherDashboard({ teacherId, teacherName }) {
  const [sessions, setSessions] = useState({}); // studentId -> { studentId, studentName, testId, testTitle, label, timeRemaining, status }
  const [timeUpQueue, setTimeUpQueue] = useState([]); // students currently showing the notification modal
  const socketRef = useRef(null);

  // --- Add Student (Tier 3) ------------------------------------------------
  const [isAddStudentModalOpen, setIsAddStudentModalOpen] = useState(false);
  const [studentForm, setStudentForm] = useState({ name: '', email: '', password: '', contactNumber: '', batchId: '' });
  const [studentSubmitting, setStudentSubmitting] = useState(false);
  const [studentFormError, setStudentFormError] = useState(null);
  const [studentFormSuccess, setStudentFormSuccess] = useState(null);
  const [batches, setBatches] = useState([]);
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchesError, setBatchesError] = useState(null);

  // --- Batch roster (multi-select filter across the teacher's batches) ----
  // The roster STATE lives here (fetching doesn't restart when the page
  // opens/closes), but the roster UI itself is a dedicated full page — see
  // BatchRosterPage.jsx — reached via isBatchRosterOpen below, same
  // "replaces the dashboard view while open" pattern as Test Record/Full
  // Mock Test. It used to be an inline SectionCard at the bottom of this
  // dashboard's scrollable content; that was consistently the single
  // tallest section once a teacher had a few batches, which is what forced
  // the whole dashboard to scroll even before the practice-tests/action
  // cards above it did. Moving it to its own page removes that section's
  // height from this component entirely.
  const [selectedBatchIds, setSelectedBatchIds] = useState([]); // [] = "no filter applied yet"
  const [rosterStudents, setRosterStudents] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState(null);
  const [isBatchRosterOpen, setIsBatchRosterOpen] = useState(false);

  // --- Test Record — dedicated full page listing past LIVE TEST sessions
  // and their submissions, replacing the dashboard view while open --------
  const [isTestRecordOpen, setIsTestRecordOpen] = useState(false);

  // --- Full Mock Tests — dedicated full page for bundling a Reading +
  // Listening LIVE TEST session under one title, manually grading
  // Writing/Speaking, and viewing the unified 4-module scorecard — see
  // FullMockTests.jsx. Same "replaces the dashboard view while open"
  // pattern as Test Record above.
  const [isFullMockOpen, setIsFullMockOpen] = useState(false);
  // Set right before switching isTestRecordOpen -> isFullMockOpen from
  // TestRecord.jsx's "View unified scorecard" link (see openFullMockFromTestRecord
  // below) — FullMockTests.jsx reads this once at mount to jump straight
  // into that mock's detail view instead of landing on its list.
  const [initialFullMockId, setInitialFullMockId] = useState(null);

  // --- Practice Tests — dedicated per-module drill-down page --------------
  const [selectedPracticeModule, setSelectedPracticeModule] = useState(null);

  // --- LIVE TEST — 'setup' (audience/test picker) then 'monitor' (real-time
  // roster) once started; see LiveTestSetup.jsx/LiveTestMonitor.jsx. Reuses
  // this SAME socket connection (socketRef, below) rather than opening a
  // second one — the events are just additional listeners on it.
  const [liveTestView, setLiveTestView] = useState(null); // null | 'setup' | 'monitor'
  const [activeLiveSession, setActiveLiveSession] = useState(null);

  // --- Session resilience — if this teacher already has a LiveSession with
  // status:'active' (started here, or in another tab/browser/device that's
  // since gone away — a logout, a closed tab, a dropped connection), the
  // "LIVE TEST" card should reconnect straight to monitoring it instead of
  // walking through Setup again and accidentally starting a duplicate
  // broadcast. `resumableSession` is fetched once on mount purely to badge
  // the card ("Resume live session") the instant the dashboard loads —
  // openLiveTest() below always re-checks fresh before actually navigating,
  // so this cached copy is never itself trusted for the real decision.
  const [resumableSession, setResumableSession] = useState(null);
  const [liveTestChecking, setLiveTestChecking] = useState(false);
  const [liveTestCheckError, setLiveTestCheckError] = useState(null);

  // --- All students in the institute — used as the audience source for
  // LiveTestSetup/LiveTestMonitor (GET /api/users/students with no
  // batchIds filter). ------------------------------------------------------
  const [allStudents, setAllStudents] = useState([]);
  const [allStudentsLoading, setAllStudentsLoading] = useState(true);
  const [allStudentsError, setAllStudentsError] = useState(null);

  // See useBackNavigation.js — without these, drilling into any of this
  // dashboard's three full-page views (Test Record, a practice module's
  // test grid, or the LIVE TEST setup/monitor flow) and then pressing the
  // physical Back button exits the app instead of returning here.
  useBackNavigation(isTestRecordOpen, () => setIsTestRecordOpen(false));
  useBackNavigation(isFullMockOpen, () => setIsFullMockOpen(false));
  useBackNavigation(isBatchRosterOpen, () => setIsBatchRosterOpen(false));
  useBackNavigation(Boolean(selectedPracticeModule), () => setSelectedPracticeModule(null));
  useBackNavigation(Boolean(liveTestView), () => {
    setLiveTestView(null);
    setActiveLiveSession(null);
  });

  // authHeaders is now defined at module scope above (shared with any other
  // sibling component in this file).

  async function loadBatches() {
    setBatchesLoading(true);
    setBatchesError(null);
    try {
      const res = await fetch(`${API_URL}/api/batches`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load batches (HTTP ${res.status}).`);
      setBatches(data.batches || []);
    } catch (err) {
      setBatchesError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setBatchesLoading(false);
    }
  }

  useEffect(() => {
    loadBatches();
  }, []);

  // Every student in the institute, regardless of batch — the search source
  // for "Add student from other batches to monitor". Fetched once: the
  // no-batchIds form of GET /api/users/students already defaults to every
  // batch in the caller's institute.
  async function loadAllStudents() {
    setAllStudentsLoading(true);
    setAllStudentsError(null);
    try {
      const res = await fetch(`${API_URL}/api/users/students`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load students (HTTP ${res.status}).`);
      setAllStudents(data.students || []);
    } catch (err) {
      setAllStudentsError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setAllStudentsLoading(false);
    }
  }

  useEffect(() => {
    loadAllStudents();
  }, []);

  // Maps one raw LiveSession record (from GET /api/live-sessions, i.e. the
  // exact shape TestRecord.jsx's list already consumes) into the shape
  // LiveTestMonitor.jsx expects — stringifying ids consistently with what
  // its socket listeners compare against, and deliberately leaving
  // studentName/studentEmail off each participant (the database record
  // never has them — see LiveSession.js's participant subdocument comment)
  // rather than trying to cross-reference `allStudents` here: LiveTestMonitor
  // backfills those itself once `allStudents` is loaded, regardless of
  // whether that happens before or after this hand-off.
  function toMonitorSession(record) {
    return {
      sessionId: String(record._id),
      teacherId: String(record.teacherId),
      title: record.title || '',
      testId: String(record.testId),
      testTitle: record.testTitle || '',
      module: record.module,
      status: record.status,
      participants: (record.participants || []).map((p) => ({
        studentId: String(p.studentId),
        status: p.status,
        controls: p.controls,
      })),
    };
  }

  // Session resilience — is there a LiveSession this teacher already has
  // running (status:'active')? Used both to badge the "LIVE TEST" card on
  // load (see the mount effect right below) and, for real, by
  // openLiveTest() every time the card is actually clicked. Returns the
  // most recently created active session, or null.
  async function findActiveLiveSession() {
    const res = await fetch(`${API_URL}/api/live-sessions?status=active`, { headers: authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Failed to check for an active live session (HTTP ${res.status}).`);
    const found = Array.isArray(data.sessions) ? data.sessions : [];
    // Defense in depth: ?status=active already scopes this query
    // server-side (see routes/liveSessions.js's GET /), but re-checking
    // status === 'active' here too means a teacher can NEVER get routed
    // back into an already-completed/ended session from this card — even
    // if that server-side filter ever regresses, or a stale/cached
    // response slips through — a completed session should always fall
    // through to the "no active session" branch below (LiveTestSetup),
    // never straight into LiveTestMonitor.
    const active = found.find((session) => session?.status === 'active');
    return active || null;
  }

  // Purely cosmetic (badges the card) — openLiveTest() below never trusts
  // this cached copy for the actual navigation decision, it always
  // re-checks fresh at click time.
  useEffect(() => {
    let cancelled = false;
    findActiveLiveSession()
      .then((session) => {
        if (!cancelled) setResumableSession(session);
      })
      .catch((err) => {
        console.error('Failed to check for a resumable live session:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // "LIVE TEST" card click — see the resumableSession state comment above.
  // Fails open on a check error: rather than blocking the teacher entirely
  // over a transient network blip, they land on a plain error banner and
  // can simply click the card again once the connection's back, instead of
  // being funneled into Setup where they might accidentally start a SECOND
  // concurrent broadcast on top of one that's still genuinely running.
  async function openLiveTest() {
    if (liveTestChecking) return;
    setLiveTestChecking(true);
    setLiveTestCheckError(null);
    try {
      const active = await findActiveLiveSession();
      if (active) {
        setActiveLiveSession(toMonitorSession(active));
        setLiveTestView('monitor');
      } else {
        setLiveTestView('setup');
      }
    } catch (err) {
      setLiveTestCheckError(
        err.message === 'Failed to fetch'
          ? 'Could not reach the server to check for an existing live session. Is the backend running?'
          : err.message
      );
    } finally {
      setLiveTestChecking(false);
    }
  }

  function toggleBatchSelection(batchId) {
    setSelectedBatchIds((prev) => (prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId]));
  }

  // Re-fetch the combined roster every time the selected batches change.
  // Selecting nothing shows nothing (rather than silently defaulting to
  // "every batch"), so the teacher always knows exactly what they're looking at.
  useEffect(() => {
    if (selectedBatchIds.length === 0) {
      setRosterStudents([]);
      setRosterError(null);
      return;
    }

    let cancelled = false;
    setRosterLoading(true);
    setRosterError(null);

    const params = new URLSearchParams();
    selectedBatchIds.forEach((id) => params.append('batchIds', id));

    fetch(`${API_URL}/api/users/students?${params.toString()}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Failed to load students (HTTP ${res.status}).`);
        if (!cancelled) setRosterStudents(data.students || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setRosterError(
            err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
          );
        }
      })
      .finally(() => {
        if (!cancelled) setRosterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedBatchIds]);

  function updateStudentField(field, value) {
    setStudentForm((f) => ({ ...f, [field]: value }));
  }

  async function handleAddStudent(e) {
    e.preventDefault();
    setStudentFormError(null);
    setStudentFormSuccess(null);
    setStudentSubmitting(true);

    try {
      const res = await fetch(`${API_URL}/api/users/add-student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(studentForm),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Failed to create student (HTTP ${res.status}).`);
      }

      setStudentFormSuccess(`Student "${data.user.name}" was created successfully.`);
      setStudentForm({ name: '', email: '', password: '', contactNumber: '', batchId: '' });
    } catch (err) {
      setStudentFormError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setStudentSubmitting(false);
    }
  }

  useEffect(() => {
    // forceNew: true — see useLiveTestChannel.js's identical option for the
    // full rationale (React 18 StrictMode's dev-only double-invoke of
    // effects can otherwise hand a remounted hook a socket entangled with
    // the previous mount's in-flight disconnect instead of a clean
    // connection).
    // auth.token — see useLiveTestChannel.js's identical option for the
    // full rationale (carries the same JWT already used for REST calls so
    // backend/socketHandler.js's socketAuthMiddleware can verify identity
    // on the handshake). teacherId is still sent in the 'teacher:join'
    // payload for backward compatibility, but the server now derives the
    // real identity from the verified token, not this field.
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: localStorage.getItem('auth_token') },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('teacher:join', { teacherId });
    });

    // Initial hydrate for anyone already mid-test when the dashboard opens.
    socket.on('timer:bulk_sync', (list) => {
      setSessions(Object.fromEntries(list.map((s) => [s.studentId, s])));
    });

    // Every subsequent tick / status change for any of this teacher's students.
    socket.on('timer:update', (payload) => {
      setSessions((prev) => ({ ...prev, [payload.studentId]: payload }));
    });

    // The moment a student's clock hits zero.
    socket.on('STUDENT_TIME_UP', ({ studentId, studentName }) => {
      setTimeUpQueue((prev) =>
        prev.some((s) => s.studentId === studentId) ? prev : [...prev, { studentId, studentName }]
      );
    });

    return () => socket.disconnect();
  }, [teacherId]);

  function dismissModal(studentId) {
    setTimeUpQueue((prev) => prev.filter((s) => s.studentId !== studentId));
  }

  function grantFixedTime(studentId, minutes) {
    socketRef.current.emit('GRANT_FIXED_TIME', { studentId, seconds: minutes * 60 });
    dismissModal(studentId);
  }

  function allowOvertime(studentId) {
    socketRef.current.emit('ALLOW_OVERTIME', { studentId });
    dismissModal(studentId);
  }

  function forceSubmit(studentId) {
    socketRef.current.emit('FORCE_SUBMIT', { studentId });
    dismissModal(studentId);
  }

  const batchesSummary = batchesLoading
    ? 'Loading batches…'
    : batchesError
    ? 'Could not load batches.'
    : `${batches.length} batch${batches.length === 1 ? '' : 'es'} available`;

  const dashboardView = (
    <div className="h-full overflow-y-auto bg-neutral-50 px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-neutral-900">Teacher dashboard</h1>
          <p className="mt-1 text-sm text-neutral-500">Manage your students and monitor live test sessions.</p>
        </header>

        {/* Overview — primary actions */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard
            icon={<IconUserPlus className="h-5 w-5 text-rose-600" />}
            accent="bg-rose-50"
            title="Add new student"
            subtitle="Register a student and assign them to a batch"
            onClick={() => setIsAddStudentModalOpen(true)}
          />
          <ActionCard
            icon={<IconUsers className="h-5 w-5 text-indigo-600" />}
            accent="bg-indigo-50"
            title="Batch student roster"
            subtitle={batchesSummary}
            badge={
              selectedBatchIds.length > 0 && (
                <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                  {selectedBatchIds.length} selected
                </span>
              )
            }
            onClick={() => setIsBatchRosterOpen(true)}
          />
          <ActionCard
            icon={<IconBroadcast className="h-5 w-5 text-rose-600" />}
            accent="bg-rose-50"
            title="LIVE TEST"
            subtitle={
              liveTestChecking
                ? 'Checking for a session in progress…'
                : resumableSession
                ? `Resume monitoring "${resumableSession.title || resumableSession.testTitle}"`
                : 'Broadcast a test to selected students or batches, in real time'
            }
            badge={
              resumableSession && !liveTestChecking && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Live
                </span>
              )
            }
            onClick={openLiveTest}
          />
          <ActionCard
            icon={<IconArchive className="h-5 w-5 text-amber-600" />}
            accent="bg-amber-50"
            title="Test Record"
            subtitle="Search past live test sessions and review student submissions"
            onClick={() => setIsTestRecordOpen(true)}
          />
          <ActionCard
            icon={<IconLayers className="h-5 w-5 text-indigo-600" />}
            accent="bg-indigo-50"
            title="Full Mock Test"
            subtitle="Bundle Reading + Listening, add Writing/Speaking, get a unified 4-module scorecard"
            onClick={() => {
              // Clear any id left over from a previous TestRecord.jsx
              // "View unified scorecard" jump (see openFullMockFromTestRecord)
              // — opening fresh from this card should always land on the
              // list, never silently reopen whatever mock was last viewed.
              setInitialFullMockId(null);
              setIsFullMockOpen(true);
            }}
          />
        </div>

        {liveTestCheckError && (
          <p className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Couldn't open LIVE TEST: {liveTestCheckError}
          </p>
        )}

        <PracticeTestsSection onSelectModule={setSelectedPracticeModule} />
      </div>

      {isAddStudentModalOpen && (
        <AddStudentModal
          onClose={() => setIsAddStudentModalOpen(false)}
          studentForm={studentForm}
          updateStudentField={updateStudentField}
          onSubmit={handleAddStudent}
          submitting={studentSubmitting}
          error={studentFormError}
          success={studentFormSuccess}
          batches={batches}
          batchesLoading={batchesLoading}
          batchesError={batchesError}
        />
      )}

      {/* One modal per queued time-up event — stacked if several students hit zero close together. */}
      {timeUpQueue.map((s) => (
        <TimeUpModal
          key={s.studentId}
          studentName={s.studentName}
          onGrantFixedTime={(minutes) => grantFixedTime(s.studentId, minutes)}
          onAllowOvertime={() => allowOvertime(s.studentId)}
          onForceSubmit={() => forceSubmit(s.studentId)}
        />
      ))}
    </div>
  );

  if (selectedPracticeModule) {
    return (
      <PracticeTestsGridView
        module={selectedPracticeModule}
        onBack={() => window.history.back()}
        testsEndpoint={`${API_URL}/api/tests`}
        canPreview
        viewerRole="teacher"
      />
    );
  }

  if (liveTestView === 'setup') {
    return (
      <LiveTestSetup
        teacherId={teacherId}
        teacherName={teacherName}
        socket={socketRef.current}
        batches={batches}
        batchesLoading={batchesLoading}
        batchesError={batchesError}
        allStudents={allStudents}
        allStudentsLoading={allStudentsLoading}
        allStudentsError={allStudentsError}
        onBack={() => window.history.back()}
        onStarted={(session) => {
          setActiveLiveSession(session);
          setLiveTestView('monitor');
        }}
      />
    );
  }

  if (liveTestView === 'monitor') {
    return (
      <LiveTestMonitor
        session={activeLiveSession}
        socket={socketRef.current}
        batches={batches}
        batchesLoading={batchesLoading}
        batchesError={batchesError}
        allStudents={allStudents}
        allStudentsLoading={allStudentsLoading}
        allStudentsError={allStudentsError}
        onBack={() => window.history.back()}
      />
    );
  }

  // TestRecord.jsx's "View unified scorecard" banner — jumps straight from
  // a single-module session's detail view into that Full Mock Test's own
  // detail view, rather than making the teacher find it again from
  // FullMockTests.jsx's search list.
  function openFullMockFromTestRecord(fullMockId) {
    setInitialFullMockId(fullMockId);
    setIsTestRecordOpen(false);
    setIsFullMockOpen(true);
  }

  if (isTestRecordOpen) {
    return (
      <>
        <TestRecord onBack={() => window.history.back()} onOpenFullMock={openFullMockFromTestRecord} />

        {timeUpQueue.map((s) => (
          <TimeUpModal
            key={s.studentId}
            studentName={s.studentName}
            onGrantFixedTime={(minutes) => grantFixedTime(s.studentId, minutes)}
            onAllowOvertime={() => allowOvertime(s.studentId)}
            onForceSubmit={() => forceSubmit(s.studentId)}
          />
        ))}
      </>
    );
  }

  if (isFullMockOpen) {
    return (
      <>
        <FullMockTests onBack={() => window.history.back()} initialMockId={initialFullMockId} />

        {timeUpQueue.map((s) => (
          <TimeUpModal
            key={s.studentId}
            studentName={s.studentName}
            onGrantFixedTime={(minutes) => grantFixedTime(s.studentId, minutes)}
            onAllowOvertime={() => allowOvertime(s.studentId)}
            onForceSubmit={() => forceSubmit(s.studentId)}
          />
        ))}
      </>
    );
  }

  if (isBatchRosterOpen) {
    return (
      <>
        <BatchRosterPage
          batches={batches}
          batchesLoading={batchesLoading}
          batchesError={batchesError}
          selectedBatchIds={selectedBatchIds}
          toggleBatchSelection={toggleBatchSelection}
          clearSelection={() => setSelectedBatchIds([])}
          rosterStudents={rosterStudents}
          rosterLoading={rosterLoading}
          rosterError={rosterError}
          sessions={sessions}
          onBack={() => window.history.back()}
        />

        {timeUpQueue.map((s) => (
          <TimeUpModal
            key={s.studentId}
            studentName={s.studentName}
            onGrantFixedTime={(minutes) => grantFixedTime(s.studentId, minutes)}
            onAllowOvertime={() => allowOvertime(s.studentId)}
            onForceSubmit={() => forceSubmit(s.studentId)}
          />
        ))}
      </>
    );
  }

  return dashboardView;
}

/**
 * TimeUpModal
 * -----------
 * The exact 3-option flow the teacher sees the instant a student's
 * timer reaches zero.
 */
function TimeUpModal({ studentName, onGrantFixedTime, onAllowOvertime, onForceSubmit }) {
  const [minutes, setMinutes] = useState(5);

  return (
    <Modal title="Time's up" maxWidth="max-w-md">
      <p className="mb-5 text-sm text-neutral-600">
        Student <span className="font-medium text-neutral-900">{studentName}</span> has run out of time.
      </p>

      <div className="space-y-3">
        {/* Option 1 — Add fixed time */}
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 p-3">
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="w-16 rounded-lg border border-neutral-300 px-2 py-1 text-sm"
          />
          <span className="text-sm text-neutral-600">minutes</span>
          <button
            onClick={() => onGrantFixedTime(minutes)}
            className="ml-auto rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-900"
          >
            Add fixed time
          </button>
        </div>

        {/* Option 2 — Allow overtime */}
        <button
          onClick={onAllowOvertime}
          className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
        >
          Allow overtime (no limit, counts into negatives)
        </button>

        {/* Option 3 — Force submit */}
        <button
          onClick={onForceSubmit}
          className="w-full rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
        >
          Force submit exam
        </button>
      </div>
    </Modal>
  );
}

