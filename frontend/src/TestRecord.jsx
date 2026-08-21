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

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

const STATUS_BADGE = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-neutral-100 text-neutral-500 border-neutral-200',
};
const STATUS_LABEL = { active: 'Active', completed: 'Ended' };

/**
 * TestRecord
 * ----------
 * "Test Record" dashboard page — the historical counterpart to
 * LiveTestMonitor.jsx's real-time view. A teacher searches their past LIVE
 * TEST broadcasts by title/date (GET /api/live-sessions, see
 * routes/liveSessions.js), then opens one to see a summary table of every
 * student's graded submission tied to that specific liveSessionId (GET
 * /api/submissions?liveSessionId=..., see routes/submissions.js).
 *
 * Deliberately self-contained (fetches its own data, keeps its own state)
 * rather than threading through TeacherDashboard's existing socket/session
 * state — this is historical/REST data, not a live real-time view, so it
 * doesn't need the socket connection at all. Mirrors the
 * fetch-on-its-own-page pattern PracticeTestsGridView and LiveTestMonitor
 * already use.
 *
 * @param {{ onBack: () => void, onOpenFullMock?: (fullMockId: string) => void }} props
 */
export default function TestRecord({ onBack, onOpenFullMock }) {
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(null);

  const [selectedSession, setSelectedSession] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsError, setSubmissionsError] = useState(null);
  const [expandedSubmissionId, setExpandedSubmissionId] = useState(null);

  // Full Mock Test integration — does a Full Mock Test bundle include THIS
  // session as its Reading or Listening leg? (see FullMockTests.jsx / GET
  // /api/full-mocks?linkedLiveSessionId=...). Fetched full (not just the
  // {_id, title} a plain "is there one?" check would need) because the
  // Manual Grading button per student below needs each result row's
  // current writingBand/speakingBand to pre-fill the modal. null while
  // none exists — most single-module sessions never got bundled into a
  // mock, which is a normal, unremarkable state, not an error.
  const [linkedMock, setLinkedMock] = useState(null);
  const [linkedMockLoading, setLinkedMockLoading] = useState(false);
  const [gradingStudent, setGradingStudent] = useState(null); // a linkedMock.results row | null

  // Teacher-Gated Result Release — which submission id(s) currently have a
  // publish request in flight, so that row's button can show "Publishing…"
  // and disable itself without needing a whole-table loading state.
  const [publishingIds, setPublishingIds] = useState(() => new Set());

  // See useBackNavigation.js — without this, opening a session's detail
  // view and then pressing the physical Back button exits the app instead
  // of returning to the search/list view.
  useBackNavigation(Boolean(selectedSession), () => setSelectedSession(null));

  // Debounced search/date-range fetch — a fresh keystroke cancels whatever
  // fetch was in flight (via `cancelled`) so a slow earlier response can
  // never overwrite a later, more current one.
  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(() => {
      setSessionsLoading(true);
      setSessionsError(null);

      const params = new URLSearchParams();
      // Test Record is the HISTORICAL view — a session still in progress
      // belongs on the LIVE TEST card's resume flow (TeacherDashboard.jsx's
      // openLiveTest), not here. Scoping the search itself to
      // status:'completed' (rather than filtering client-side) keeps this
      // list and its "X live tests match your search" count accurate even
      // as more sessions get created while this page is open.
      params.set('status', 'completed');
      if (search.trim()) params.set('search', search.trim());
      if (fromDate) params.set('from', new Date(fromDate).toISOString());
      if (toDate) {
        // Inclusive of the whole "to" day, not just midnight at its start.
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        params.set('to', end.toISOString());
      }

      fetch(`${API_URL}/api/live-sessions?${params.toString()}`, { headers: authHeaders() })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data?.error || `Failed to load live test history (HTTP ${res.status}).`);
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
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [search, fromDate, toDate]);

  function openSession(session) {
    setSelectedSession(session);
    setExpandedSubmissionId(null);
    setSubmissionsLoading(true);
    setSubmissionsError(null);
    setSubmissions([]);
    setLinkedMock(null);
    setGradingStudent(null);

    fetch(`${API_URL}/api/submissions?liveSessionId=${encodeURIComponent(session._id)}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load submissions (HTTP ${res.status}).`);
        setSubmissions(data.submissions || []);
      })
      .catch((err) => {
        setSubmissionsError(
          err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
        );
      })
      .finally(() => setSubmissionsLoading(false));

    loadLinkedMock(session._id);
  }

  // Looks up whether a Full Mock Test bundle references this session, and
  // if so loads its FULL scorecard detail (not just the id/title a plain
  // existence check would need) — the Manual Grading button per student
  // row below reads each row's current writingBand/speakingBand/feedback
  // straight out of this to pre-fill ManualEvaluationModal. Silently gives
  // up on error (console-logged only) rather than surfacing a banner —
  // this is a nice-to-have addition to the page, and a failure here
  // shouldn't block the teacher from seeing the submissions table itself,
  // which already has its own independent loading/error state above.
  function loadLinkedMock(liveSessionId) {
    setLinkedMockLoading(true);
    fetch(`${API_URL}/api/full-mocks?linkedLiveSessionId=${encodeURIComponent(liveSessionId)}`, {
      headers: authHeaders(),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        const match = (data.fullMocks || [])[0];
        if (!match) return setLinkedMock(null);
        const detailRes = await fetch(`${API_URL}/api/full-mocks/${match._id}`, { headers: authHeaders() });
        const detailData = await detailRes.json().catch(() => ({}));
        if (!detailRes.ok) throw new Error(detailData?.error || `HTTP ${detailRes.status}`);
        setLinkedMock(detailData.fullMock);
      })
      .catch((err) => {
        console.error('Failed to check for a linked Full Mock Test:', err);
        setLinkedMock(null);
      })
      .finally(() => setLinkedMockLoading(false));
  }

  // After a grading save, refresh the linked mock so the pre-fill (and any
  // future Manual Grading re-open) reflects what was just saved.
  function handleGraded() {
    setGradingStudent(null);
    if (selectedSession) loadLinkedMock(selectedSession._id);
  }

  // Teacher-Gated Result Release — "Publish Scorecard to Student". Flips
  // isPublished on the backend (see routes/submissions.js's POST
  // /:id/publish), which is what makes the score/band/per-question
  // answers visible on that specific student's own dashboard (GET
  // /api/submissions/mine). Updates this row in place on success rather
  // than refetching the whole session — the row already has every field
  // it needs (isPublished flips from false to true, nothing else changes).
  function publishSubmission(submissionId) {
    setPublishingIds((prev) => new Set(prev).add(submissionId));
    fetch(`${API_URL}/api/submissions/${submissionId}/publish`, {
      method: 'POST',
      headers: authHeaders(),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to publish (HTTP ${res.status}).`);
        setSubmissions((prev) => prev.map((s) => (s._id === submissionId ? { ...s, isPublished: true } : s)));
      })
      .catch((err) => {
        alert(err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message);
      })
      .finally(() => {
        setPublishingIds((prev) => {
          const next = new Set(prev);
          next.delete(submissionId);
          return next;
        });
      });
  }

  const participantSummary = (session) => {
    const total = session.participants?.length || 0;
    const joined = (session.participants || []).filter(
      (p) => p.status === 'joined' || p.status === 'submitted'
    ).length;
    return { joined, total };
  };

  const submittedCount = submissions.length;
  const avgScore = useMemo(() => {
    const graded = submissions.filter((s) => typeof s.score === 'number' && typeof s.totalQuestions === 'number' && s.totalQuestions > 0);
    if (graded.length === 0) return null;
    const pct = graded.reduce((sum, s) => sum + s.score / s.totalQuestions, 0) / graded.length;
    return Math.round(pct * 100);
  }, [submissions]);

  // ---- Detail view: summary table for one session ------------------------
  if (selectedSession) {
    return (
      <div className="flex h-full flex-col bg-neutral-50">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-4 shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.history.back()}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
            >
              <IconArrowLeft className="h-4 w-4" />
              Back to Test Record
            </button>
            <div className="h-6 w-px bg-neutral-200" />
            <div>
              <h1 className="text-xl font-bold tracking-tight text-neutral-900">
                {selectedSession.title || 'Untitled live session'}
              </h1>
              <p className="text-xs text-neutral-500">
                {selectedSession.testTitle} · <span className="capitalize">{selectedSession.module}</span> ·{' '}
                {formatDate(selectedSession.createdAt)}
              </p>
            </div>
          </div>
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              STATUS_BADGE[selectedSession.status] || STATUS_BADGE.completed
            }`}
          >
            {STATUS_LABEL[selectedSession.status] || selectedSession.status}
          </span>
        </div>

        {linkedMock && (
          <p className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-200 bg-indigo-50 px-6 py-2 text-sm text-indigo-700">
            <span>
              Part of the Full Mock Test <span className="font-semibold">"{linkedMock.title}"</span> — Reading,
              Listening, Writing and Speaking bands are combined there.
            </span>
            {onOpenFullMock && (
              <button
                type="button"
                onClick={() => onOpenFullMock(linkedMock._id)}
                className="shrink-0 rounded-md border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
              >
                View unified scorecard
              </button>
            )}
          </p>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-4xl">
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Submitted</p>
                <p className="mt-1 text-2xl font-bold text-neutral-900">{submittedCount}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Invited</p>
                <p className="mt-1 text-2xl font-bold text-neutral-900">{selectedSession.participants?.length || 0}</p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-4 text-center shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Average score</p>
                <p className="mt-1 text-2xl font-bold text-neutral-900">{avgScore != null ? `${avgScore}%` : '—'}</p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              {submissionsLoading ? (
                <p className="px-4 py-8 text-center text-sm text-neutral-400">Loading submissions…</p>
              ) : submissionsError ? (
                <p className="px-4 py-8 text-center text-sm text-rose-600">{submissionsError}</p>
              ) : submissions.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-neutral-400">
                  No student has submitted a result for this session yet.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Student</th>
                      <th className="px-4 py-3 font-medium">Score</th>
                      <th className="px-4 py-3 font-medium">Band</th>
                      <th className="px-4 py-3 font-medium">Submitted</th>
                      <th className="px-4 py-3 font-medium">Result Release</th>
                      <th className="px-4 py-3 font-medium text-right">Details</th>
                      <th className="px-4 py-3 font-medium text-right">Manual Grading</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {submissions.map((sub) => {
                      const isExpanded = expandedSubmissionId === sub._id;
                      const sortedAnswers = Array.isArray(sub.answers)
                        ? [...sub.answers].sort((a, b) => (a?.questionNumber ?? 0) - (b?.questionNumber ?? 0))
                        : [];
                      // Only meaningful once this session is confirmed part
                      // of a Full Mock Test bundle AND this specific
                      // student is on that bundle's roster (seeded from
                      // whichever LiveSession(s) it links — see
                      // routes/fullMockSessions.js's POST) — PUT
                      // /:id/results/:studentId 404s for anyone not
                      // already on that roster, so the button simply isn't
                      // offered rather than offering an action that would
                      // just error.
                      const mockResult = linkedMock?.results.find((r) => String(r.studentId) === String(sub.student));
                      return (
                        <>
                          <tr key={sub._id} className="align-middle">
                            <td className="px-4 py-3 font-medium text-neutral-800">{sub.studentName}</td>
                            <td className="px-4 py-3 text-neutral-700">
                              {sub.score} / {sub.totalQuestions}
                            </td>
                            <td className="px-4 py-3 text-neutral-700">{sub.bandScore != null ? String(sub.bandScore) : '—'}</td>
                            <td className="px-4 py-3 text-neutral-500">{formatDate(sub.submittedAt)}</td>
                            <td className="px-4 py-3">
                              {sub.isPublished ? (
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                                  ✓ Released
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => publishSubmission(sub._id)}
                                  disabled={publishingIds.has(sub._id)}
                                  title="Makes this student's detailed scorecard and band score visible on their own dashboard"
                                  className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {publishingIds.has(sub._id) ? 'Publishing…' : 'Publish Scorecard to Student'}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => setExpandedSubmissionId(isExpanded ? null : sub._id)}
                                className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-50"
                              >
                                {isExpanded ? 'Hide' : 'View'}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {linkedMockLoading ? (
                                <span className="text-xs text-neutral-300">…</span>
                              ) : mockResult ? (
                                <button
                                  type="button"
                                  onClick={() => setGradingStudent(mockResult)}
                                  className="rounded-md border border-indigo-300 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-50"
                                >
                                  Manual Grading
                                </button>
                              ) : (
                                <span className="text-xs text-neutral-300" title="Not part of a Full Mock Test bundle">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${sub._id}-detail`}>
                              <td colSpan={7} className="bg-neutral-50 px-4 py-4">
                                {sortedAnswers.length === 0 ? (
                                  <p className="text-sm text-neutral-400">No per-question answers were recorded.</p>
                                ) : (
                                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                                    <table className="w-full text-left text-xs">
                                      <thead className="bg-neutral-100 text-neutral-500">
                                        <tr>
                                          <th className="px-3 py-2 font-medium">Q#</th>
                                          <th className="px-3 py-2 font-medium">Student's Answer</th>
                                          <th className="px-3 py-2 font-medium">Correct Answer</th>
                                          <th className="px-3 py-2 font-medium">Status</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-neutral-100">
                                        {sortedAnswers.map((a) => (
                                          <tr key={a.questionNumber}>
                                            <td className="px-3 py-1.5 font-medium text-neutral-700">{a.questionNumber}</td>
                                            <td className="px-3 py-1.5 text-neutral-600">
                                              {Array.isArray(a.studentAnswer) ? a.studentAnswer.join(', ') : a.studentAnswer ?? '—'}
                                            </td>
                                            <td className="px-3 py-1.5 text-neutral-600">
                                              {Array.isArray(a.correctAnswer) ? a.correctAnswer.join(', ') : a.correctAnswer}
                                            </td>
                                            <td className="px-3 py-1.5">
                                              <span className={a.isCorrect ? 'font-medium text-emerald-600' : 'font-medium text-rose-600'}>
                                                {a.isCorrect ? 'Correct' : 'Incorrect'}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {gradingStudent && linkedMock && (
          <ManualEvaluationModal
            fullMockId={linkedMock._id}
            student={gradingStudent}
            onClose={() => setGradingStudent(null)}
            onSaved={handleGraded}
          />
        )}
      </div>
    );
  }

  // ---- List view: search past sessions by title/date ---------------------
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
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">Test Record</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="record-search" className="mb-1 block text-xs font-medium text-neutral-600">
                Search by title
              </label>
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  id="record-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="e.g. Morning Batch — Mock Test 1"
                  autoComplete="off"
                  className="w-full rounded-lg border border-neutral-300 py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                />
              </div>
            </div>
            <div>
              <label htmlFor="record-from" className="mb-1 block text-xs font-medium text-neutral-600">
                From
              </label>
              <input
                id="record-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
              />
            </div>
            <div>
              <label htmlFor="record-to" className="mb-1 block text-xs font-medium text-neutral-600">
                To
              </label>
              <input
                id="record-to"
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
            {sessionsLoading ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">Loading live test history…</p>
            ) : sessionsError ? (
              <p className="px-4 py-10 text-center text-sm text-rose-600">{sessionsError}</p>
            ) : sessions.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-neutral-400">
                {search || fromDate || toDate
                  ? 'No live test sessions match your search.'
                  : "No live tests have been run yet — once you start one from LIVE TEST, it'll show up here."}
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Title</th>
                    <th className="px-4 py-3 font-medium">Test</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Joined</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {sessions.map((session) => {
                    const { joined, total } = participantSummary(session);
                    return (
                      <tr
                        key={session._id}
                        onClick={() => openSession(session)}
                        className="cursor-pointer align-middle transition hover:bg-neutral-50"
                      >
                        <td className="px-4 py-3 font-medium text-neutral-800">{session.title || 'Untitled live session'}</td>
                        <td className="px-4 py-3 text-neutral-600">
                          {session.testTitle} <span className="capitalize text-neutral-400">· {session.module}</span>
                        </td>
                        <td className="px-4 py-3 text-neutral-500">{formatDate(session.createdAt)}</td>
                        <td className="px-4 py-3 text-neutral-600">
                          {joined} / {total}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                              STATUS_BADGE[session.status] || STATUS_BADGE.completed
                            }`}
                          >
                            {STATUS_LABEL[session.status] || session.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
