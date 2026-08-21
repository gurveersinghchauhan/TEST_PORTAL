import { useEffect, useMemo, useState } from 'react';
import { authHeaders } from './apiAuth';
import { useBackNavigation } from './useBackNavigation';
import ManualEvaluationModal from './ManualEvaluationModal';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function IconArrowLeft({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

function IconSearch({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconPlus({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconPrinter({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z" />
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

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

/** '—' for a null/undefined band, otherwise the number as-typed (e.g. "6.5", not "6.50"). */
function bandCell(band) {
  return band != null ? String(band) : '—';
}

/**
 * FullMockTests
 * -------------
 * "Full Mock Test Bundle" — the multi-module counterpart to TestRecord.jsx.
 * Where TestRecord shows ONE LIVE TEST session's submissions (a single
 * module), this bundles a Reading session + a Listening session (both
 * already run through the ordinary LIVE TEST flow) under one title, adds
 * manually-graded Writing/Speaking per student (see ManualEvaluationModal),
 * and shows a unified 4-module scorecard with an overall band average —
 * see backend/routes/fullMockSessions.js for the aggregate logic.
 *
 * Same self-contained, fetch-its-own-data shape as TestRecord.jsx and
 * LiveTestMonitor.jsx (list view + detail view, its own state, no shared
 * socket needed since everything here is REST/historical).
 *
 * @param {{ onBack: () => void, initialMockId?: string | null }} props
 */
export default function FullMockTests({ onBack, initialMockId = null }) {
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [mocks, setMocks] = useState([]);
  const [mocksLoading, setMocksLoading] = useState(true);
  const [mocksError, setMocksError] = useState(null);

  const [selectedMockId, setSelectedMockId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [gradingStudent, setGradingStudent] = useState(null); // full result row | null

  // See useBackNavigation.js — without this, opening a mock's detail view
  // and then pressing the physical Back button exits the app instead of
  // returning to the search/list view (same pattern as TestRecord.jsx).
  useBackNavigation(Boolean(selectedMockId), () => setSelectedMockId(null));

  // TeacherDashboard.jsx hands this in when the teacher arrived here via
  // TestRecord.jsx's "View unified scorecard" link rather than the
  // dashboard's own "Full Mock Test" card — jump straight to that mock's
  // detail view instead of landing on the list. Runs once at mount (this
  // component is remounted fresh every time TeacherDashboard flips
  // isFullMockOpen to true — see the conditional render there — so a
  // mount-only effect is enough; no need to guard against initialMockId
  // changing under an already-mounted instance).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (initialMockId) openMock(initialMockId);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setMocksLoading(true);
      setMocksError(null);

      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (fromDate) params.set('from', new Date(fromDate).toISOString());
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        params.set('to', end.toISOString());
      }

      fetch(`${API_URL}/api/full-mocks?${params.toString()}`, { headers: authHeaders() })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `Failed to load full mock tests (HTTP ${res.status}).`);
          if (!cancelled) setMocks(data.fullMocks || []);
        })
        .catch((err) => {
          if (!cancelled) {
            setMocksError(
              err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
            );
          }
        })
        .finally(() => {
          if (!cancelled) setMocksLoading(false);
        });
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [search, fromDate, toDate]);

  function loadDetail(id) {
    setDetailLoading(true);
    setDetailError(null);
    fetch(`${API_URL}/api/full-mocks/${id}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load this mock test (HTTP ${res.status}).`);
        setDetail(data.fullMock);
      })
      .catch((err) => {
        setDetailError(
          err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
        );
      })
      .finally(() => setDetailLoading(false));
  }

  function openMock(id) {
    setSelectedMockId(id);
    setDetail(null);
    loadDetail(id);
  }

  function handleCreated(fullMock) {
    setCreateOpen(false);
    // Drop straight into the newly-created bundle's detail view rather
    // than back to the list — there's nothing useful to look at on the
    // list right after creating one.
    openMock(fullMock._id);
    // Refresh the list in the background so it's there once the teacher
    // backs out again.
    setMocks((prev) => [{ _id: fullMock._id, title: fullMock.title, createdAt: fullMock.createdAt, results: [] }, ...prev]);
  }

  // Re-fetches the whole detail view after a grading save rather than
  // patching just that one row in place — Writing/Speaking changing can
  // shift the overall band average for that student, and re-fetching is
  // the simplest way to guarantee the row shown matches exactly what
  // GET /:id would compute (same source computeOverallBand uses server-side).
  function handleGraded() {
    setGradingStudent(null);
    if (selectedMockId) loadDetail(selectedMockId);
  }

  const avgOverall = useMemo(() => {
    if (!detail) return null;
    const bands = detail.results.map((r) => r.overallBand).filter((b) => typeof b === 'number');
    if (bands.length === 0) return null;
    return Math.round((bands.reduce((sum, b) => sum + b, 0) / bands.length) * 2) / 2;
  }, [detail]);

  // ---- Detail view: unified 4-module scorecard for one mock --------------
  if (selectedMockId) {
    return (
      <div className="flex h-full flex-col bg-neutral-50">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-4 shadow-sm print:hidden">
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.history.back()}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
            >
              <IconArrowLeft className="h-4 w-4" />
              Back to Full Mock Tests
            </button>
            <div className="h-6 w-px bg-neutral-200" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-neutral-900">{detail?.title || 'Full mock test'}</h1>
              <p className="text-xs text-neutral-500">{formatDate(detail?.createdAt)}</p>
            </div>
          </div>
          {detail && (
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
            >
              <IconPrinter className="h-4 w-4" />
              Print / Export Report
            </button>
          )}
        </div>

        {/* Print-only header — the screen header above is print:hidden so
            the browser's print dialog doesn't also try to print the Back/
            Print buttons themselves; this stands in for it on paper. */}
        <div className="hidden px-6 pt-6 print:block">
          <h1 className="text-xl font-bold text-neutral-900">{detail?.title || 'Full mock test'}</h1>
          <p className="text-xs text-neutral-500">{formatDate(detail?.createdAt)}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 print:overflow-visible">
          <div className="mx-auto max-w-5xl">
            {detailLoading ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">Loading scorecard…</p>
            ) : detailError ? (
              <p className="px-4 py-10 text-center text-sm text-rose-600">{detailError}</p>
            ) : !detail ? null : (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Students</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">{detail.results.length}</p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Reading</p>
                    <p className="mt-1 truncate text-sm font-semibold text-neutral-800">
                      {detail.readingSession?.title || detail.readingSession?.testTitle || '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Listening</p>
                    <p className="mt-1 truncate text-sm font-semibold text-neutral-800">
                      {detail.listeningSession?.title || detail.listeningSession?.testTitle || '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Avg. overall band</p>
                    <p className="mt-1 text-2xl font-bold text-neutral-900">{bandCell(avgOverall)}</p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                  {detail.results.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-neutral-400">
                      No students are on this mock test's roster.
                    </p>
                  ) : (
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                        <tr>
                          <th className="px-4 py-3 font-medium">Student</th>
                          <th className="px-4 py-3 font-medium">Reading</th>
                          <th className="px-4 py-3 font-medium">Listening</th>
                          <th className="px-4 py-3 font-medium">Writing</th>
                          <th className="px-4 py-3 font-medium">Speaking</th>
                          <th className="px-4 py-3 font-medium">Overall band</th>
                          <th className="px-4 py-3 font-medium text-right print:hidden">Manual Grading</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {detail.results.map((r) => (
                          <tr key={r.studentId} className="align-middle">
                            <td className="px-4 py-3 font-medium text-neutral-800">{r.studentName}</td>
                            <td className="px-4 py-3 text-neutral-700">
                              {r.reading ? `${bandCell(r.reading.bandScore)} (${r.reading.score}/${r.reading.totalQuestions})` : '—'}
                            </td>
                            <td className="px-4 py-3 text-neutral-700">
                              {r.listening ? `${bandCell(r.listening.bandScore)} (${r.listening.score}/${r.listening.totalQuestions})` : '—'}
                            </td>
                            <td className="px-4 py-3 text-neutral-700">{bandCell(r.writingBand)}</td>
                            <td className="px-4 py-3 text-neutral-700">{bandCell(r.speakingBand)}</td>
                            <td className="px-4 py-3 font-semibold text-neutral-900">{bandCell(r.overallBand)}</td>
                            <td className="px-4 py-3 text-right print:hidden">
                              <button
                                type="button"
                                onClick={() => setGradingStudent(r)}
                                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50"
                              >
                                Manual Grading
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {gradingStudent && (
          <ManualEvaluationModal
            fullMockId={selectedMockId}
            student={gradingStudent}
            onClose={() => setGradingStudent(null)}
            onSaved={handleGraded}
          />
        )}
      </div>
    );
  }

  // ---- List view: search past full mock tests by title/date --------------
  return (
    <div className="flex h-full flex-col bg-neutral-50">
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <div className="h-6 w-px bg-neutral-200" />
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">Full Mock Tests</h1>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700"
        >
          <IconPlus className="h-4 w-4" />
          New Full Mock Test
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="mock-search" className="mb-1 block text-xs font-medium text-neutral-600">
                Search by title
              </label>
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="mock-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. Saturday Mock Test - 22"
                  autoComplete="off"
                  className="w-full rounded-lg border border-neutral-300 py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                />
              </div>
            </div>
            <div>
              <label htmlFor="mock-from" className="mb-1 block text-xs font-medium text-neutral-600">
                From
              </label>
              <input
                id="mock-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
              />
            </div>
            <div>
              <label htmlFor="mock-to" className="mb-1 block text-xs font-medium text-neutral-600">
                To
              </label>
              <input
                id="mock-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
              />
            </div>
            {(search || fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setFromDate('');
                  setToDate('');
                }}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            {mocksLoading ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">Loading full mock tests…</p>
            ) : mocksError ? (
              <p className="px-4 py-10 text-center text-sm text-rose-600">{mocksError}</p>
            ) : mocks.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">
                {search || fromDate || toDate
                  ? 'No full mock tests match your search.'
                  : 'No full mock tests yet — click "New Full Mock Test" to bundle a Reading and Listening session together.'}
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {mocks.map((mock) => (
                    <tr
                      key={mock._id}
                      onClick={() => openMock(mock._id)}
                      className="cursor-pointer align-middle transition hover:bg-neutral-50"
                    >
                      <td className="px-4 py-3 font-medium text-neutral-800">{mock.title || 'Untitled mock test'}</td>
                      <td className="px-4 py-3 text-neutral-500">{formatDate(mock.createdAt)}</td>
                      <td className="px-4 py-3 text-neutral-600">{mock.results?.length ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {createOpen && <CreateMockModal onClose={() => setCreateOpen(false)} onCreated={handleCreated} />}
    </div>
  );
}

/**
 * CreateMockModal
 * ---------------
 * "New Full Mock Test" — a title plus a pick-one-of-each dropdown for the
 * teacher's own COMPLETED Reading and Listening LIVE TEST sessions (see
 * TestRecord.jsx for how those get run/ended in the first place). At least
 * one of the two must be selected; the roster is seeded server-side from
 * whichever session(s) are linked (see routes/fullMockSessions.js's POST).
 */
function CreateMockModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [readingLiveSessionId, setReadingLiveSessionId] = useState('');
  const [listeningLiveSessionId, setListeningLiveSessionId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/live-sessions?status=completed`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load live test sessions (HTTP ${res.status}).`);
        if (!cancelled) setSessions(data.sessions || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setSessionsError(
            err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
          );
        }
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const readingOptions = useMemo(() => sessions.filter((s) => s.module === 'reading'), [sessions]);
  const listeningOptions = useMemo(() => sessions.filter((s) => s.module === 'listening'), [sessions]);

  async function handleCreate(e) {
    e.preventDefault();
    setCreateError(null);
    if (!title.trim()) {
      setCreateError('A title is required (e.g. "Saturday Mock Test - 22").');
      return;
    }
    if (!readingLiveSessionId && !listeningLiveSessionId) {
      setCreateError('Link at least one Reading or Listening live test session.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/full-mocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          title: title.trim(),
          readingLiveSessionId: readingLiveSessionId || null,
          listeningLiveSessionId: listeningLiveSessionId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to create the full mock test (HTTP ${res.status}).`);
      onCreated(data.fullMock);
    } catch (err) {
      setCreateError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">New Full Mock Test</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-neutral-500">
          Bundle a completed Reading and/or Listening live test under one title — Writing and Speaking are added
          afterward via Manual Grading.
        </p>

        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label htmlFor="mock-title" className="mb-1 block text-xs font-medium text-neutral-600">
              Title
            </label>
            <input
              id="mock-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Saturday Mock Test - 22"
              className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
            />
          </div>

          {sessionsLoading ? (
            <p className="text-sm text-neutral-400">Loading completed live test sessions…</p>
          ) : sessionsError ? (
            <p className="text-sm text-rose-600">{sessionsError}</p>
          ) : (
            <>
              <div>
                <label htmlFor="mock-reading" className="mb-1 block text-xs font-medium text-neutral-600">
                  Reading session
                </label>
                <select
                  id="mock-reading"
                  value={readingLiveSessionId}
                  onChange={(e) => setReadingLiveSessionId(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                >
                  <option value="">None</option>
                  {readingOptions.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.title || s.testTitle} — {formatDate(s.createdAt)}
                    </option>
                  ))}
                </select>
                {readingOptions.length === 0 && (
                  <p className="mt-1 text-xs text-neutral-400">No completed Reading live tests yet.</p>
                )}
              </div>

              <div>
                <label htmlFor="mock-listening" className="mb-1 block text-xs font-medium text-neutral-600">
                  Listening session
                </label>
                <select
                  id="mock-listening"
                  value={listeningLiveSessionId}
                  onChange={(e) => setListeningLiveSessionId(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                >
                  <option value="">None</option>
                  {listeningOptions.map((s) => (
                    <option key={s._id} value={s._id}>
                      {s.title || s.testTitle} — {formatDate(s.createdAt)}
                    </option>
                  ))}
                </select>
                {listeningOptions.length === 0 && (
                  <p className="mt-1 text-xs text-neutral-400">No completed Listening live tests yet.</p>
                )}
              </div>
            </>
          )}

          {createError && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {createError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={creating || sessionsLoading}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
