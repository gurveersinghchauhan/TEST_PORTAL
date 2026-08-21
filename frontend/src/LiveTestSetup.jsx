import { useEffect, useMemo, useState } from 'react';
import { authHeaders } from './apiAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const MODULES = [
  { value: 'reading', label: 'Reading' },
  { value: 'listening', label: 'Listening' },
  { value: 'writing', label: 'Writing' },
  { value: 'speaking', label: 'Speaking' },
];

const STEPS = [
  { n: 1, label: 'Audience' },
  { n: 2, label: 'Test' },
  { n: 3, label: 'Start' },
];

function IconArrowLeft({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

function IconX({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function StepDots({ step }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
              s.n === step
                ? 'bg-rose-600 text-white'
                : s.n < step
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-neutral-100 text-neutral-400'
            }`}
          >
            {s.n < step ? '✓' : s.n}
          </div>
          <span className={`text-sm font-medium ${s.n === step ? 'text-neutral-900' : 'text-neutral-400'}`}>{s.label}</span>
          {i < STEPS.length - 1 && <div className="h-px w-8 bg-neutral-200" />}
        </div>
      ))}
    </div>
  );
}

/**
 * LiveTestSetup
 * -------------
 * The 3-step "LIVE TEST" flow: pick an audience (individual students and/or
 * whole batches), pick a test, then broadcast it. Emits 'initiate_live_test'
 * on the SAME socket connection TeacherDashboard already keeps alive for the
 * whole dashboard session (passed in as `socket`), rather than opening a
 * second one — see socketHandler.js for the server side.
 *
 * `batches`/`allStudents` are passed down already-fetched from
 * TeacherDashboard (which loads them for the existing "batch roster"/"pin a
 * student" features), so this component doesn't re-fetch either.
 *
 * @param {{
 *   teacherId: string, teacherName: string, socket: import('socket.io-client').Socket | null,
 *   batches: Array, batchesLoading: boolean, batchesError: string|null,
 *   allStudents: Array, allStudentsLoading: boolean, allStudentsError: string|null,
 *   onBack: () => void, onStarted: (session: object) => void,
 * }} props
 */
export default function LiveTestSetup({
  teacherId,
  teacherName,
  socket,
  batches,
  batchesLoading,
  batchesError,
  allStudents,
  allStudentsLoading,
  allStudentsError,
  onBack,
  onStarted,
}) {
  const [step, setStep] = useState(1);

  // --- Step 1: audience --------------------------------------------------
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [audienceSearch, setAudienceSearch] = useState('');

  // --- Step 2: test ---------------------------------------------------
  const [module, setModule] = useState('reading');
  const [tests, setTests] = useState([]);
  const [testsLoading, setTestsLoading] = useState(true);
  const [testsError, setTestsError] = useState(null);
  const [selectedTestId, setSelectedTestId] = useState('');

  // --- Step 3: start -------------------------------------------------
  // The teacher-chosen label for THIS broadcast — distinct from the
  // underlying Test's own title (selectedTest.title), which is fixed and
  // reusable across many separate live sessions (e.g. running the same
  // Cambridge test for two different batches on two different days).
  // Required — see LiveSession.js's `title` field and startLiveTest below.
  const [liveTestTitle, setLiveTestTitle] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setTestsLoading(true);
    setTestsError(null);
    fetch(`${API_URL}/api/tests`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => []);
        if (!res.ok) throw new Error(data?.error || `Failed to load tests (HTTP ${res.status}).`);
        if (!cancelled) setTests(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setTestsError(err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setTestsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleStudent(id) {
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleBatch(id) {
    setSelectedBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const searchResults = useMemo(() => {
    const q = audienceSearch.trim().toLowerCase();
    if (!q) return [];
    return allStudents
      .filter((s) => !selectedStudentIds.includes(s._id))
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          (s.batchId?.name || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [audienceSearch, allStudents, selectedStudentIds]);

  const individuallySelectedStudents = allStudents.filter((s) => selectedStudentIds.includes(s._id));

  // Batch checkboxes expand to every student currently in that batch — this
  // is computed from `allStudents` (already loaded) rather than a second
  // fetch, since Batch itself has no student array (see backend/models/Batch.js).
  const batchExpandedStudentIds = useMemo(
    () => allStudents.filter((s) => selectedBatchIds.includes(s.batchId?._id)).map((s) => s._id),
    [allStudents, selectedBatchIds]
  );

  // The final, deduplicated audience — a student picked both individually
  // AND via a batch checkbox is only counted once.
  const finalStudentIds = useMemo(
    () => Array.from(new Set([...selectedStudentIds, ...batchExpandedStudentIds])),
    [selectedStudentIds, batchExpandedStudentIds]
  );
  const finalStudents = allStudents.filter((s) => finalStudentIds.includes(s._id));

  // Only published tests — inviting students into a still-being-built draft
  // would put them in front of a broken/incomplete paper.
  const modulesTests = tests.filter((t) => t.module === module && t.isPublished);
  const selectedTest = tests.find((t) => (t._id || t.id) === selectedTestId);

  const trimmedLiveTestTitle = liveTestTitle.trim();

  function startLiveTest() {
    if (!socket || finalStudentIds.length === 0 || !selectedTest || !trimmedLiveTestTitle) return;
    setStarting(true);
    setStartError(null);

    const testId = selectedTest._id || selectedTest.id;
    socket.emit(
      'initiate_live_test',
      {
        teacherId,
        teacherName,
        studentIds: finalStudentIds,
        testId,
        testTitle: selectedTest.title,
        title: trimmedLiveTestTitle,
        module,
      },
      (ack) => {
        setStarting(false);
        if (!ack?.ok) {
          setStartError(ack?.error || 'Failed to start the live test.');
          return;
        }
        // The server only confirms ids — we already know every invited
        // student's name/details locally, so build the initial display
        // roster here rather than requiring the server to populate/return
        // it (see socketHandler.js's initiateLiveTest ack).
        onStarted({
          sessionId: ack.sessionId,
          teacherId,
          title: ack.title,
          testId: ack.testId,
          testTitle: ack.testTitle,
          module: ack.module,
          status: 'active',
          participants: finalStudents.map((s) => ({
            studentId: s._id,
            studentName: s.name,
            studentEmail: s.email,
            status: 'invited',
            controls: 'active',
          })),
        });
      }
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-50">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <div className="h-6 w-px bg-neutral-200" />
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">LIVE TEST</h1>
        </div>
        <StepDots step={step} />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {step === 1 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="mb-1 text-lg font-semibold text-neutral-800">Who is this for?</h2>
              <p className="mb-4 text-sm text-neutral-500">
                Search for individual students, or check whole batches to invite everyone in them.
              </p>

              <label htmlFor="audience-search" className="mb-1 block text-xs font-medium text-neutral-600">
                Search students by name or email
              </label>
              <div className="relative max-w-sm">
                <input
                  id="audience-search"
                  type="text"
                  value={audienceSearch}
                  onChange={(e) => setAudienceSearch(e.target.value)}
                  placeholder="Search students…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                />
                {audienceSearch.trim() && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
                    {allStudentsLoading ? (
                      <p className="px-3 py-2 text-sm text-neutral-400">Loading students…</p>
                    ) : allStudentsError ? (
                      <p className="px-3 py-2 text-sm text-rose-600">{allStudentsError}</p>
                    ) : searchResults.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-neutral-400">No matching students.</p>
                    ) : (
                      <ul className="max-h-56 overflow-y-auto">
                        {searchResults.map((s) => (
                          <li key={s._id}>
                            <button
                              type="button"
                              onClick={() => {
                                toggleStudent(s._id);
                                setAudienceSearch('');
                              }}
                              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                            >
                              <span className="min-w-0">
                                <span className="font-medium text-neutral-800">{s.name}</span>
                                <span className="ml-2 text-xs text-neutral-400">{s.batchId?.name || 'No batch'}</span>
                              </span>
                              <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                                Add
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {individuallySelectedStudents.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Selected:</span>
                  {individuallySelectedStudents.map((s) => (
                    <span
                      key={s._id}
                      className="flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-sm text-rose-800"
                    >
                      {s.name}
                      <button
                        type="button"
                        onClick={() => toggleStudent(s._id)}
                        className="text-rose-500 transition hover:text-rose-800"
                        aria-label={`Remove ${s.name}`}
                      >
                        <IconX />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-6">
                <label className="mb-1 block text-xs font-medium text-neutral-600">Or invite whole batches</label>
                {batchesLoading ? (
                  <p className="text-sm text-neutral-400">Loading batches…</p>
                ) : batchesError ? (
                  <p className="text-sm text-rose-600">{batchesError}</p>
                ) : batches.length === 0 ? (
                  <p className="text-sm text-neutral-400">No batches exist yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {batches.map((b) => {
                      const checked = selectedBatchIds.includes(b._id);
                      const count = allStudents.filter((s) => s.batchId?._id === b._id).length;
                      return (
                        <label
                          key={b._id}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                            checked
                              ? 'border-neutral-800 bg-neutral-800 text-white'
                              : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                          }`}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleBatch(b._id)} className="sr-only" />
                          {b.name} <span className={checked ? 'text-neutral-300' : 'text-neutral-400'}>({count})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="mt-6 flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
                <span className="text-sm text-neutral-600">
                  <span className="font-semibold text-neutral-900">{finalStudentIds.length}</span> student
                  {finalStudentIds.length === 1 ? '' : 's'} will be invited
                </span>
                <button
                  type="button"
                  disabled={finalStudentIds.length === 0}
                  onClick={() => setStep(2)}
                  className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next: choose a test →
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="mb-1 text-lg font-semibold text-neutral-800">Which test?</h2>
              <p className="mb-4 text-sm text-neutral-500">Only published tests can be started live.</p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="live-module" className="mb-1 block text-xs font-medium text-neutral-600">
                    Module
                  </label>
                  <select
                    id="live-module"
                    value={module}
                    onChange={(e) => {
                      setModule(e.target.value);
                      setSelectedTestId('');
                    }}
                    className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                  >
                    {MODULES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="live-test" className="mb-1 block text-xs font-medium text-neutral-600">
                    Test
                  </label>
                  {testsLoading ? (
                    <p className="text-sm text-neutral-400">Loading tests…</p>
                  ) : testsError ? (
                    <p className="text-sm text-rose-600">{testsError}</p>
                  ) : modulesTests.length === 0 ? (
                    <p className="text-sm text-neutral-400">No published {module} tests yet.</p>
                  ) : (
                    <select
                      id="live-test"
                      value={selectedTestId}
                      onChange={(e) => setSelectedTestId(e.target.value)}
                      className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                    >
                      <option value="" disabled>
                        Select a test…
                      </option>
                      {modulesTests.map((t) => (
                        <option key={t._id || t.id} value={t._id || t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={!selectedTestId}
                  onClick={() => setStep(3)}
                  className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next: review →
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="mb-1 text-lg font-semibold text-neutral-800">Ready to go live</h2>
              <p className="mb-4 text-sm text-neutral-500">
                Every invited student gets a prompt on their dashboard the instant you start.
              </p>

              <label htmlFor="live-test-title" className="mb-1 block text-xs font-medium text-neutral-600">
                Live test title <span className="text-rose-500">*</span>
              </label>
              <input
                id="live-test-title"
                type="text"
                value={liveTestTitle}
                onChange={(e) => setLiveTestTitle(e.target.value)}
                placeholder='e.g. "Morning Batch — Mock Test 1"'
                autoComplete="off"
                className="w-full max-w-md rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
              />
              <p className="mb-4 mt-1 text-xs text-neutral-400">
                Your own label for this session — shown to you in the monitor and later in Test Record. Students
                never see it.
              </p>

              <div className="space-y-3">
                <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Test</p>
                  <p className="text-sm font-semibold text-neutral-900">{selectedTest?.title || '—'}</p>
                  <p className="text-xs text-neutral-500">{MODULES.find((m) => m.value === module)?.label}</p>
                </div>

                <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                    Audience — {finalStudents.length} student{finalStudents.length === 1 ? '' : 's'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {finalStudents.map((s) => (
                      <span key={s._id} className="rounded-full bg-white px-2.5 py-1 text-xs text-neutral-700 shadow-sm">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {startError && (
                <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {startError}
                </p>
              )}

              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={starting || !trimmedLiveTestTitle}
                  onClick={startLiveTest}
                  title={!trimmedLiveTestTitle ? 'Enter a live test title first' : undefined}
                  className="rounded-lg bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {starting ? 'Starting…' : 'Start Live Test'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
