import { useEffect, useState } from 'react';
import { authHeaders } from './apiAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/**
 * MyResultsSection
 * -----------------
 * "My Results" — sits on the Student Dashboard between PerformanceOverview
 * and the Practice Tests grid (see StudentDashboard.jsx). This is the
 * student-facing half of the Teacher-Gated Result Release workflow: a LIVE
 * TEST submission is graded and saved the instant a student submits (see
 * routes/submissions.js's POST /), but its score/band/per-question answers
 * stay withheld — server-side, not just visually — until a teacher
 * explicitly clicks "Publish Scorecard to Student" on TestRecord.jsx or
 * LiveTestMonitor.jsx's report view (POST /api/submissions/:id/publish).
 *
 * Reads GET /api/submissions/mine, which already does the actual gating:
 * a submission still pending release comes back with no score field at
 * all (see routes/submissions.js's serializeSubmissionForStudent), so this
 * component only ever has to branch on `status`/`isPublished`, never
 * decide on its own whether to hide anything.
 *
 * Self-contained (own fetch, own loading/error/empty state), matching how
 * PerformanceOverview and PracticeTestsSection are each their own file/
 * fetch rather than threading data down from StudentDashboard.
 */
export default function MyResultsSection() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${API_URL}/api/submissions/mine`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load your results (HTTP ${res.status}).`);
        if (!cancelled) setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show at all (no live tests taken yet) — skip the whole
  // section rather than rendering an empty card, same spirit as
  // ComingSoonView's "nothing to click through to" for gated modules.
  if (!loading && !error && submissions.length === 0) return null;

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-slate-800">My Results</h2>
      <p className="mt-1 text-sm text-slate-500">Results from LIVE TEST sessions you've taken.</p>

      <div className="mt-4 space-y-3">
        {loading ? (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-400 shadow-sm">
            Loading your results…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-center text-sm text-rose-700">
            {error}
          </div>
        ) : (
          submissions.map((sub) => (
            <ResultCard
              key={sub._id}
              submission={sub}
              expanded={expandedId === sub._id}
              onToggleExpand={() => setExpandedId((prev) => (prev === sub._id ? null : sub._id))}
            />
          ))
        )}
      </div>
    </section>
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

function ResultCard({ submission, expanded, onToggleExpand }) {
  const isPending = submission.status === 'pending_release' || !submission.isPublished;
  const testTitle = submission.test?.title || 'Untitled test';
  const module = submission.test?.module || submission.module;

  if (isPending) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-800">{testTitle}</p>
            <p className="mt-0.5 text-xs capitalize text-slate-400">
              {module} · Submitted {formatDate(submission.submittedAt)}
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-700 sm:self-auto">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Pending review
          </span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-amber-800">
          Test submitted successfully. Your instructor is reviewing your submission; results will be released
          shortly.
        </p>
      </div>
    );
  }

  const pct = submission.totalQuestions > 0 ? Math.round((submission.score / submission.totalQuestions) * 100) : 0;
  const sortedAnswers = Array.isArray(submission.answers)
    ? [...submission.answers].sort((a, b) => (a?.questionNumber ?? 0) - (b?.questionNumber ?? 0))
    : [];

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-800">{testTitle}</p>
          <p className="mt-0.5 text-xs capitalize text-slate-400">
            {module} · Submitted {formatDate(submission.submittedAt)}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          ✓ Released
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Score</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {submission.score}/{submission.totalQuestions}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Percentage</p>
          <p className="mt-1 text-xl font-bold text-slate-900">{pct}%</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Band</p>
          <p className="mt-1 text-xl font-bold text-slate-900">
            {submission.bandScore != null ? String(submission.bandScore) : '—'}
          </p>
        </div>
      </div>

      {sortedAnswers.length > 0 && (
        <>
          <button
            type="button"
            onClick={onToggleExpand}
            className="mt-3 text-xs font-semibold text-slate-600 underline underline-offset-2 hover:text-slate-800"
          >
            {expanded ? 'Hide full report' : 'View full report'}
          </button>

          {expanded && (
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Q#</th>
                    <th className="px-3 py-2 font-medium">Your answer</th>
                    <th className="px-3 py-2 font-medium">Correct answer</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedAnswers.map((a) => (
                    <tr key={a.questionNumber}>
                      <td className="px-3 py-1.5 font-medium text-slate-700">{a.questionNumber}</td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {Array.isArray(a.studentAnswer) ? a.studentAnswer.join(', ') : a.studentAnswer ?? '—'}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">
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
        </>
      )}
    </div>
  );
}
