import { useState } from 'react';
import { PracticeTestsSection, PracticeTestsGridView, ComingSoonView, UNLAUNCHABLE_MODULES } from './PracticeTests';
import PerformanceOverview from './PerformanceOverview';
import MyResultsSection from './MyResultsSection';
import { useBackNavigation } from './useBackNavigation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/**
 * StudentDashboard
 * ----------------
 * Landing page for the 'student' role, extracted out of App.jsx so it's a
 * standalone component the same way InstituteDashboard/TeacherDashboard
 * are — the three role dashboards now share the same "Practice Tests"
 * section and per-module drill-down page (see PracticeTests.jsx).
 *
 * Test-taking itself still lives one level up in App.jsx: picking a real
 * test here calls onSelectTest, which App.jsx uses to swap in
 * StudentTestPage. This component only owns "which page am I looking at
 * before a test starts" (dashboard vs. a module's test grid).
 */
export default function StudentDashboard({ auth, onSelectTest, onLogout }) {
  const [selectedPracticeModule, setSelectedPracticeModule] = useState(null);

  // See useBackNavigation.js — without this, browsing into a module's test
  // grid and then pressing the physical Back button exits the app instead
  // of returning to this dashboard.
  useBackNavigation(Boolean(selectedPracticeModule), () => setSelectedPracticeModule(null));

  // Writing/Speaking have no real test-taking flow yet — students get a
  // "Coming Soon" placeholder instead of ever reaching a test grid/card
  // for these modules (Institute/Teacher still get the grid + preview).
  if (selectedPracticeModule && UNLAUNCHABLE_MODULES.includes(selectedPracticeModule)) {
    return (
      <ComingSoonView module={selectedPracticeModule} onBack={() => window.history.back()} />
    );
  }

  if (selectedPracticeModule) {
    return (
      <PracticeTestsGridView
        module={selectedPracticeModule}
        onBack={() => window.history.back()}
        onSelectTest={onSelectTest}
        testsEndpoint={`${API_URL}/api/tests`}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">Student</p>
          <p className="text-sm font-medium text-slate-700">{auth.user.name}</p>
        </div>
        <button
          onClick={onLogout}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          Log out
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-10 px-6 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight text-slate-800">Student Dashboard</h1>
            <p className="mt-1 text-slate-500">Pick a module below to start practicing.</p>
          </div>

          <PerformanceOverview />

          <MyResultsSection />

          <PracticeTestsSection onSelectModule={setSelectedPracticeModule} />
        </div>
      </div>
    </div>
  );
}
