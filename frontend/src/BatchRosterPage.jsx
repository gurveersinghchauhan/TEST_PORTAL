import { useMemo, useState } from 'react';

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
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/**
 * BatchRosterPage
 * ----------------
 * Dedicated full-page view for the Teacher Dashboard's "Batch student
 * roster" card. Extracted out of an inline SectionCard that used to sit at
 * the bottom of TeacherDashboard.jsx's scrollable content — that section
 * was consistently the tallest thing on the dashboard once a teacher had a
 * few batches selected, which is what forced the whole dashboard to scroll
 * even before the action cards/practice tests above it did. Moving it here
 * removes that section's height from TeacherDashboard entirely.
 *
 * Same "replaces the dashboard view while open, Back button returns to it"
 * pattern as TestRecord.jsx/FullMockTests.jsx — including using
 * window.history.back() for the on-screen Back button rather than calling
 * onBack's setter directly, so the browser's real history depth stays in
 * sync with useBackNavigation's shared stack (see that hook's doc comment
 * in useBackNavigation.js for why).
 *
 * All of the actual roster STATE (which batches are selected, the fetched
 * student list, live-session status per student) still lives in
 * TeacherDashboard and is only passed down as props — this component is
 * purely presentational, so opening/closing this page never re-fetches
 * anything that was already loaded, and the selection/results are still
 * there if the teacher comes back to this page later in the same session.
 */
export default function BatchRosterPage({
  batches,
  batchesLoading,
  batchesError,
  selectedBatchIds,
  toggleBatchSelection,
  clearSelection,
  rosterStudents,
  rosterLoading,
  rosterError,
  sessions,
  onBack,
}) {
  // Client-side name/email search over whatever roster is already loaded —
  // purely a display filter, never refetches (the batch pills above are
  // still what determines rosterStudents itself).
  const [search, setSearch] = useState('');

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rosterStudents;
    return rosterStudents.filter(
      (s) => s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q)
    );
  }, [rosterStudents, search]);

  return (
    <div className="flex h-full flex-col bg-neutral-50">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <div className="h-6 w-px bg-neutral-200" />
          <h1 className="text-xl font-bold tracking-tight text-neutral-900">Batch student roster</h1>
        </div>

        {selectedBatchIds.length > 0 && (
          <button
            onClick={clearSelection}
            className="shrink-0 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          <p className="mb-4 text-sm text-neutral-500">
            Select one or more batches to see their students in a single combined list.
          </p>

          {/* Batch filter pills */}
          {batchesLoading ? (
            <p className="text-sm text-neutral-400">Loading batches…</p>
          ) : batchesError ? (
            <p className="text-sm text-rose-600">{batchesError}</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-neutral-400">No batches exist yet — ask your institute admin to create one first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {batches.map((b) => {
                const checked = selectedBatchIds.includes(b._id);
                return (
                  <label
                    key={b._id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                      checked
                        ? 'border-neutral-800 bg-neutral-800 text-white'
                        : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleBatchSelection(b._id)} className="sr-only" />
                    {b.name}
                  </label>
                );
              })}
            </div>
          )}

          {/* Search bar + result counters — only meaningful once a batch is selected */}
          {selectedBatchIds.length > 0 && (
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full max-w-xs">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or email…"
                  autoComplete="off"
                  className="w-full rounded-lg border border-neutral-300 py-1.5 pl-8 pr-3 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                />
              </div>

              {!rosterLoading && !rosterError && (
                <p className="text-xs font-medium text-neutral-500">
                  {filteredStudents.length} of {rosterStudents.length} student{rosterStudents.length === 1 ? '' : 's'} shown ·{' '}
                  {selectedBatchIds.length} batch{selectedBatchIds.length === 1 ? '' : 'es'} selected
                </p>
              )}
            </div>
          )}

          <div className="mt-5">
            {selectedBatchIds.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-200 py-8 text-center text-sm text-neutral-400">
                No batches selected — pick one or more above to view students.
              </p>
            ) : rosterLoading ? (
              <p className="py-8 text-center text-sm text-neutral-400">Loading students…</p>
            ) : rosterError ? (
              <p className="py-8 text-center text-sm text-rose-600">{rosterError}</p>
            ) : rosterStudents.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-400">No students in the selected batches.</p>
            ) : filteredStudents.length === 0 ? (
              <p className="py-8 text-center text-sm text-neutral-400">No students match &quot;{search}&quot;.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-4 py-2 font-medium">Student</th>
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Contact</th>
                      <th className="px-4 py-2 font-medium">Batch</th>
                      <th className="px-4 py-2 font-medium">Live status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => {
                      const liveSession = sessions[s._id];
                      return (
                        <tr key={s._id} className="border-t border-neutral-200">
                          <td className="px-4 py-2 font-medium text-neutral-800">{s.name}</td>
                          <td className="px-4 py-2 text-neutral-600">{s.email}</td>
                          <td className="px-4 py-2 text-neutral-600">{s.contactNumber}</td>
                          <td className="px-4 py-2 text-neutral-600">{s.batchId?.name || '—'}</td>
                          <td className="px-4 py-2">
                            {liveSession ? (
                              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                                {liveSession.status.replace('_', ' ')} · {liveSession.label}
                              </span>
                            ) : (
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                                Not in a test
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
