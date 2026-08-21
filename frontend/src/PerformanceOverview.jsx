/**
 * PerformanceOverview.jsx
 * ------------------------
 * "Performance Overview" section for the Student Dashboard — sits directly
 * below the dashboard header and above the "Practice Tests" module grid
 * (see StudentDashboard.jsx). Deliberately its own component/file, mirroring
 * how PracticeTestsSection lives in its own module (PracticeTests.jsx),
 * rather than being folded into that grid.
 *
 * Today this is a presentational shell: a row of quick-stat cards plus a
 * placeholder container reserved for a future analytics/live chart. There
 * is no student-facing "my scores" endpoint on the backend yet — every
 * /api/submissions and /api/full-mocks route is teacher/institute-only (see
 * routes/submissions.js, routes/fullMockSessions.js), and standalone
 * practice attempts are never persisted at all (graded and handed back in
 * the response, nothing written to Mongo — see submissions.js's POST /
 * handler). So every stat below defaults to an honest "no data yet" state
 * instead of a fabricated number. Once a student-scoped results endpoint
 * exists, wire real numbers in through the `stats` prop — see its shape
 * (DEFAULT_STATS) below — without needing to touch this file's layout.
 */

const DEFAULT_STATS = {
  latestScore: null, // e.g. "Band 7.0"
  averageBand: null, // e.g. "6.5"
  testsCompleted: 0, // a real count, so 0 (not "—") is the honest empty value
};

function IconTrophy({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a1 1 0 0 0-1 1v1a4 4 0 0 0 4 4M17 5h3a1 1 0 0 1 1 1v1a4 4 0 0 1-4 4" />
    </svg>
  );
}

function IconTrendingUp({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </svg>
  );
}

function IconCheckSquare({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function IconChartBar({ className = 'h-8 w-8' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" rx="0.5" />
      <rect x="12.5" y="8" width="3" height="10" rx="0.5" />
      <rect x="18" y="5" width="3" height="13" rx="0.5" />
    </svg>
  );
}

/** One quick-stat card — same card language as PracticeTestsSection's module cards. */
function StatCard({ icon, accent, label, value, subtext }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
      <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${accent}`}>{icon}</div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-800">{value ?? '—'}</p>
        {subtext && <p className="mt-0.5 text-xs text-slate-400">{subtext}</p>}
      </div>
    </div>
  );
}

/**
 * PerformanceOverview
 * --------------------
 * `stats` is optional and merges over DEFAULT_STATS, so a caller can pass
 * just the fields it already has real data for (see the doc comment above
 * for why nothing is wired to a live endpoint yet).
 */
export default function PerformanceOverview({ stats }) {
  const { latestScore, averageBand, testsCompleted } = { ...DEFAULT_STATS, ...stats };

  return (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-slate-800">Performance Overview</h2>
      <p className="mt-1 text-sm text-slate-500">Your recent test performance at a glance.</p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<IconTrophy className="h-6 w-6" />}
          accent="bg-amber-50 text-amber-600"
          label="Latest Mock Test Score"
          value={latestScore}
          subtext={latestScore ? 'Most recent attempt' : 'Complete a mock test to see your score'}
        />
        <StatCard
          icon={<IconTrendingUp className="h-6 w-6" />}
          accent="bg-sky-50 text-sky-600"
          label="Average Band Score"
          value={averageBand}
          subtext={averageBand ? 'Across all graded tests' : 'No graded tests yet'}
        />
        <StatCard
          icon={<IconCheckSquare className="h-6 w-6" />}
          accent="bg-emerald-50 text-emerald-600"
          label="Tests Completed"
          value={testsCompleted}
          subtext="Total mock tests submitted"
        />
      </div>

      {/* Future analytics/live graph container — intentionally wider than the
          stat cards above (full-width, not part of the 3-col grid) since a
          real chart will need the room. Swap the placeholder block below for
          the actual chart component when that's ready. */}
      <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Score Trend</p>
        <div className="mt-3 flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/60">
          <IconChartBar className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-medium text-slate-400">Analytics Chart Component (Coming Soon)</p>
        </div>
      </div>
    </section>
  );
}
