import { useEffect, useState } from 'react';
import TestDraftEditor from './TestDraftEditor';
import ReadingTestWizard from './ReadingTestWizard';
import SpeakingTestWizard from './SpeakingTestWizard';
import WritingTestWizard from './WritingTestWizard';
import ListeningTestWizard from './ListeningTestWizard';
import TestInterfaceSession from './TestInterfaceSession';
import { SpeakingPart2Pane, SpeakingPromptsPane } from './SpeakingTestView';
import { THEME } from './TestInterface';
import { authHeaders } from './apiAuth';
import { useBackNavigation } from './useBackNavigation';
import { SPEAKING_CATEGORY_OPTIONS, UNCATEGORIZED, speakingCategoryLabel } from './speakingCategories';
import { writingTypeLabel, writingSubTypeLabel } from './writingClassification';

// Writing-only: pulls the classification off a part's single 'writing-task'
// question (see WritingTestWizard.jsx's buildWritingTaskQuestionGroup) —
// that question's `prompt` is just a short placeholder label ("Task 1"),
// never real content, so it's read here for its classification fields only.
function writingTaskClassification(part) {
  const question = (part?.questionGroups || [])
    .flatMap((g) => g.questions || [])
    .find((q) => q.type === 'writing-task');
  if (!question) return null;
  return {
    type: question.writingQuestionType || null,
    subType: question.writingQuestionSubType || null,
  };
}

/**
 * PracticeTests.jsx
 * -----------------
 * Shared across all three dashboards (Institute, Teacher, Student) so the
 * "Practice Tests" section and its module drill-down look identical no
 * matter which role is looking at it — that's the whole point of this file
 * existing separately instead of being copy-pasted into each dashboard.
 *
 * Exports:
 *   PRACTICE_MODULES      — the 4 module definitions (key/label/icon/accent)
 *   PracticeTestsSection  — the "Practice Tests" heading + 4-card grid
 *   PracticeTestsGridView — the dedicated "module drill-down" page. A
 *                           viewer with canPreview=true (institute/teacher)
 *                           can click any test, any module, to open a
 *                           read-only question preview instead of taking
 *                           it — and from there, "Edit Test" opens the same
 *                           builder UI a fresh test would use, pre-loaded
 *                           with this test's data.
 *   ComingSoonView        — animated placeholder shown to students instead
 *                           of the grid for Writing/Speaking, since those
 *                           modules aren't launchable yet.
 */

export const UNLAUNCHABLE_MODULES = ['writing', 'speaking']; // no real test-taking flow exists for these yet

/* -------------------------------------------------------------------------
 * Icons — small hand-rolled outline icons, one per module.
 * ---------------------------------------------------------------------- */
function IconBookOpen({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5.5c-1.6-1.2-3.7-1.8-6-1.8v13.6c2.3 0 4.4.6 6 1.8" />
      <path d="M12 5.5c1.6-1.2 3.7-1.8 6-1.8v13.6c-2.3 0-4.4.6-6 1.8" />
      <path d="M12 5.5v13.6" />
    </svg>
  );
}

function IconHeadphones({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="4" height="6" rx="1.5" />
      <rect x="17" y="14" width="4" height="6" rx="1.5" />
    </svg>
  );
}

function IconMic({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3M9 21h6" />
    </svg>
  );
}

function IconPenLine({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 20l4.5-1 10-10a2.12 2.12 0 0 0-3-3l-10 10z" />
      <path d="M13 6l3 3" />
      <path d="M4 20l1-4.5" />
    </svg>
  );
}

function IconArrowLeft({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

function IconPencil({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconPlay({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className={className}>
      <path d="M7 5.5c0-1.19 1.29-1.93 2.32-1.33l10.5 6.5a1.54 1.54 0 0 1 0 2.66l-10.5 6.5C8.29 20.43 7 19.69 7 18.5v-13Z" />
    </svg>
  );
}

function IconExit({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconSparkles({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  );
}

export const PRACTICE_MODULES = [
  { key: 'reading', label: 'Reading', description: 'Passages & comprehension', Icon: IconBookOpen, accent: 'bg-sky-50 text-sky-600' },
  { key: 'listening', label: 'Listening', description: 'Audio-based questions', Icon: IconHeadphones, accent: 'bg-violet-50 text-violet-600' },
  { key: 'speaking', label: 'Speaking', description: 'Spoken response practice', Icon: IconMic, accent: 'bg-amber-50 text-amber-600' },
  { key: 'writing', label: 'Writing', description: 'Task 1 & Task 2 essays', Icon: IconPenLine, accent: 'bg-emerald-50 text-emerald-600' },
];

// The real Test model only supports module: 'reading' | 'listening' today
// (see backend/models/Test.js), so Speaking/Writing — and Reading/Listening
// before any real tests are uploaded — fall back to these so the 4-module
// UI structure is fully clickable and complete regardless of backend state.
// Every placeholder carries isPlaceholder so the grid view can visibly mark
// it as sample content rather than pretending it's real, launchable data.
const PLACEHOLDER_TESTS_BY_MODULE = {
  reading: [
    { title: 'Cambridge 21 Test 4 — Academic Reading', durationMinutes: 60, totalQuestions: 40 },
    { title: 'Cambridge 20 Test 2 — Academic Reading', durationMinutes: 60, totalQuestions: 40 },
    { title: 'Cambridge 19 Test 1 — General Training Reading', durationMinutes: 60, totalQuestions: 40 },
  ],
  listening: [
    { title: 'Cambridge 21 Test 3 — Listening', durationMinutes: 30, totalQuestions: 40 },
    { title: 'Cambridge 20 Test 1 — Listening', durationMinutes: 30, totalQuestions: 40 },
    { title: 'Cambridge 19 Test 4 — Listening', durationMinutes: 30, totalQuestions: 40 },
  ],
  speaking: [
    { title: 'Speaking Practice Set A — Parts 1, 2 & 3', durationMinutes: 15, totalQuestions: 3 },
    { title: 'Speaking Practice Set B — Parts 1, 2 & 3', durationMinutes: 15, totalQuestions: 3 },
  ],
  writing: [
    { title: 'Academic Writing Practice Set A — Task 1 & 2', durationMinutes: 60, totalQuestions: 2 },
    { title: 'Academic Writing Practice Set B — Task 1 & 2', durationMinutes: 60, totalQuestions: 2 },
  ],
};

/* -------------------------------------------------------------------------
 * "Practice Tests" section — 4-card module grid, dropped into any
 * dashboard's normal (non-drill-down) view.
 * ---------------------------------------------------------------------- */
export function PracticeTestsSection({ onSelectModule }) {
  return (
    <section className="mb-6">
      <h2 className="text-lg font-bold text-slate-800">Practice Tests</h2>
      <p className="mt-1 text-sm text-slate-500">Browse practice content by module.</p>

      <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {PRACTICE_MODULES.map(({ key, label, description, Icon, accent }) => (
          <button
            key={key}
            onClick={() => onSelectModule(key)}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110 ${accent}`}>
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">{label}</h3>
              <p className="mt-0.5 text-xs text-slate-500">{description}</p>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------
 * Dedicated full-page module drill-down.
 * ---------------------------------------------------------------------- */
export function PracticeTestsGridView({ module, onBack, onSelectTest, testsEndpoint, canPreview, viewerRole }) {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Which test (if any) is currently open in the OLD flat, read-only
  // question-list preview — a teacher/institute-only affordance. Kept local
  // to this component rather than lifted to the caller, since it's just a
  // sub-view of "browsing this module's tests," not a dashboard-level
  // navigation concern.
  //
  // As of the TestInterface-based Preview/Attempt refactor below, this flat
  // view is DEPRECATED for Reading/Listening — real tests in those two
  // modules now open through interfaceSession (canUseTestInterface),
  // reusing the actual student TestInterface for exact split-screen/
  // full-width UI parity instead of this vertical list. It's kept around
  // (not deleted) as the fallback for Speaking/Writing — modules
  // TestInterface doesn't know how to render at all — and for any
  // Reading/Listening test with no real parts/questionGroups content yet
  // (including placeholders), where this view's existing empty state is
  // still the right thing to show.
  const [previewTest, setPreviewTest] = useState(null);
  // Which test (if any) is open via the NEW TestInterface-based flow — the
  // exact student interface, in either 'preview' (frozen timer + inline
  // answer keys) or 'attempt' (real local countdown, nothing saved) mode.
  // Reading/Listening only — see canUseTestInterface below.
  const [interfaceSession, setInterfaceSession] = useState(null); // { test, mode: 'preview' | 'attempt' }
  // Which test (if any) is currently open for editing — reached via
  // "Edit Test" on the preview page. Reuses the same builder UI a fresh
  // test would use (TestDraftEditor for Reading/Listening, SpeakingTestWizard
  // for Speaking), just pre-loaded with this test's data and PATCHing
  // instead of POSTing on save.
  const [editingTest, setEditingTest] = useState(null);
  // Speaking-only: 'ALL', one of the 16 fixed speakingCategory values, or
  // UNCATEGORIZED (tests saved before this feature existed / with no clear
  // Part 2 match). Irrelevant for every other module.
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // testsEndpoint is a full URL like `${API_BASE}/tests` — strip the
  // trailing /tests so the editors (which build their own /tests/... and
  // /tests/:id/publish URLs) can share the same base.
  const apiBase = testsEndpoint.replace(/\/tests\/?$/, '');

  // Edit is reachable two ways now: from a card's own "Edit" button (grid ->
  // editor directly, previewTest never gets involved) or from the old
  // QuestionPreviewView's "Edit Test" button (grid -> preview -> editor).
  // previewTest is left untouched for the whole time editingTest is open,
  // so its value here still tells us which path we came in through: only
  // update it (to the freshly-saved data, so the preview isn't left
  // showing stale content) if it was already set; otherwise leave it null
  // so saving drops the teacher back on the grid, not a preview screen
  // they never opened.
  function handleTestSaved(updated) {
    setTests((prev) => {
      const exists = prev.some((t) => t._id === updated._id);
      return exists ? prev.map((t) => (t._id === updated._id ? updated : t)) : [...prev, updated];
    });
    setEditingTest(null);
    setPreviewTest((prev) => (prev ? updated : null));
  }

  // cancelEdit intentionally does NOT touch previewTest either, for the
  // same reason — whatever it already holds (the test being previewed, or
  // null) is exactly the right screen to fall back to once editingTest
  // clears.
  function cancelEdit() {
    setEditingTest(null);
  }

  // See useBackNavigation.js. These three sub-screens can nest (Preview ->
  // Edit is two levels deep), so each gets its own hook call rather than
  // one shared "any sub-screen is open" flag — that's what makes a single
  // Back press step out exactly one level instead of exiting straight to
  // the module grid from two levels down.
  useBackNavigation(Boolean(editingTest), cancelEdit);
  useBackNavigation(Boolean(interfaceSession), () => setInterfaceSession(null));
  useBackNavigation(Boolean(previewTest), () => setPreviewTest(null));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(testsEndpoint, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load tests (HTTP ${res.status}).`);
        const data = await res.json();
        return Array.isArray(data) ? data : data?.tests || [];
      })
      .then((data) => {
        if (!cancelled) setTests(data);
      })
      .catch((err) => {
        console.error('Failed to fetch tests:', err);
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [testsEndpoint]);

  const moduleDef = PRACTICE_MODULES.find((m) => m.key === module) || PRACTICE_MODULES[0];
  // Institute/teacher viewers can preview questions for ANY module's tests
  // (not just Writing/Speaking) — Reading/Listening previews just tend to
  // have real content sooner since those modules have a working builder.
  const isPreviewableModule = canPreview;
  const realTests = tests.filter((t) => t.module === module);

  function openInterfaceSession(t, mode) {
    setInterfaceSession({ test: t, mode });
  }

  // Real, published tests for this module win if there are any; otherwise
  // (nothing uploaded yet, fetch failed, or this module — Speaking/Writing —
  // isn't even supported by the backend schema yet) fall back to realistic
  // placeholders so the UI structure is fully populated regardless.
  const usingPlaceholders = !loading && realTests.length === 0;
  const displayTests = usingPlaceholders
    ? (PLACEHOLDER_TESTS_BY_MODULE[module] || []).map((t) => ({ ...t, isPlaceholder: true }))
    : realTests;

  // Speaking → [Category] filter. Only meaningful once there are real,
  // saved tests to filter (placeholders carry no speakingCategory at all).
  // A missing/null speakingCategory (legacy tests saved before this field
  // existed) is treated as UNCATEGORIZED here and in the filter options
  // below, matching how the backend defaults it (see backend/models/Test.js).
  const showCategoryFilter = module === 'speaking' && !usingPlaceholders && displayTests.length > 0;
  const categoriesPresent = showCategoryFilter
    ? new Set(displayTests.map((t) => t.speakingCategory || UNCATEGORIZED))
    : null;
  const categoryFilterOptions = showCategoryFilter
    ? [
        ...SPEAKING_CATEGORY_OPTIONS.filter((o) => categoriesPresent.has(o.value)),
        ...(categoriesPresent.has(UNCATEGORIZED) ? [{ value: UNCATEGORIZED, label: 'Uncategorized' }] : []),
      ]
    : [];
  const visibleTests =
    showCategoryFilter && categoryFilter !== 'ALL'
      ? displayTests.filter((t) => (t.speakingCategory || UNCATEGORIZED) === categoryFilter)
      : displayTests;

  if (editingTest) {
    // "Back to Preview" only makes sense if Preview is actually where this
    // edit will land the teacher back on (see handleTestSaved/cancelEdit
    // above) — reached via the grid card's own Edit button, there's no
    // preview screen behind this one, just the grid.
    const editorBackLabel = previewTest ? 'Back to Preview' : 'Back to Tests';

    if (editingTest.module === 'speaking') {
      return (
        <SpeakingTestWizard
          key={editingTest._id}
          apiBase={apiBase}
          initialTest={editingTest}
          backLabel={editorBackLabel}
          onBack={() => window.history.back()}
          onSaved={handleTestSaved}
        />
      );
    }

    if (editingTest.module === 'writing') {
      return (
        <WritingTestWizard
          key={editingTest._id}
          apiBase={apiBase}
          initialTest={editingTest}
          backLabel={editorBackLabel}
          onBack={() => window.history.back()}
          onSaved={handleTestSaved}
        />
      );
    }

    if (editingTest.module === 'reading') {
      return (
        <ReadingTestWizard
          key={editingTest._id}
          apiBase={apiBase}
          initialTest={editingTest}
          backLabel={editorBackLabel}
          onBack={() => window.history.back()}
          onSaved={handleTestSaved}
        />
      );
    }

    if (editingTest.module === 'listening') {
      return (
        <ListeningTestWizard
          key={editingTest._id}
          apiBase={apiBase}
          initialTest={editingTest}
          backLabel={editorBackLabel}
          onBack={() => window.history.back()}
          onSaved={handleTestSaved}
        />
      );
    }

    // Defensive fallback for any test whose module doesn't match one of the
    // four dedicated wizards above (shouldn't happen in practice now that
    // every module has its own wizard, but keeps editing from ever hard-failing).
    return (
      <TestDraftEditor
        key={editingTest._id}
        test={editingTest}
        apiBase={apiBase}
        backLabel={editorBackLabel}
        onBack={() => window.history.back()}
        onSaved={handleTestSaved}
      />
    );
  }

  if (interfaceSession) {
    return (
      <TestInterfaceSession
        key={`${interfaceSession.test._id}-${interfaceSession.mode}`}
        test={interfaceSession.test}
        mode={interfaceSession.mode}
        onExit={() => window.history.back()}
      />
    );
  }

  if (previewTest) {
    const isEditableTest = canPreview && !previewTest.isPlaceholder && Boolean(previewTest._id);
    return (
      <QuestionPreviewView
        key={previewTest._id || previewTest.title}
        test={previewTest}
        module={module}
        onBack={() => window.history.back()}
        onEdit={isEditableTest ? () => setEditingTest(previewTest) : null}
        viewerRole={viewerRole}
      />
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${moduleDef.accent}`}>
              <moduleDef.Icon className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">{moduleDef.label} Practice Tests</h1>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-6xl">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="animate-pulse text-sm font-medium text-slate-500">Loading tests…</p>
            </div>
          ) : error && tests.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-sm">
              <p className="text-slate-600">Could not reach the server. Showing sample tests instead.</p>
            </div>
          ) : null}

          {!loading && (
            <>
              {usingPlaceholders && (
                <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                  No {moduleDef.label.toLowerCase()} tests have been published yet — showing sample content so you can
                  see how this page will look.
                </p>
              )}

              {showCategoryFilter && (
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</span>
                  <button
                    onClick={() => setCategoryFilter('ALL')}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      categoryFilter === 'ALL'
                        ? 'bg-amber-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    All categories
                  </button>
                  {categoryFilterOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setCategoryFilter(opt.value)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                        categoryFilter === opt.value
                          ? 'bg-amber-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              {showCategoryFilter && categoryFilter !== 'ALL' && visibleTests.length === 0 && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                  No {moduleDef.label.toLowerCase()} tests in this category yet.
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visibleTests.map((t, i) => {
                  // Any real, saved test a teacher/institute is allowed to
                  // preview is also editable — independent of which action
                  // button(s) the card ends up showing below (Preview may
                  // route through the newer TestInterface-based flow for
                  // Reading/Listening, which has no edit affordance of its
                  // own — see TestInterfaceSession.jsx), so this is the only
                  // reliable place left to reach the editor for those tests.
                  const isEditableCard = canPreview && !t.isPlaceholder && Boolean(t._id);

                  return (
                    <div
                      key={t._id || `${module}-placeholder-${i}`}
                      className="group relative flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                    >
                      {isEditableCard && (
                        <button
                          onClick={() => setEditingTest(t)}
                          title="Edit test"
                          aria-label={`Edit ${t.title}`}
                          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 shadow-sm transition duration-150 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <div className="flex items-start gap-3">
                        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${moduleDef.accent}`}>
                          <moduleDef.Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1 pr-5">
                          <h3 className="truncate text-sm font-semibold leading-snug text-slate-800" title={t.title}>
                            {t.title}
                          </h3>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                              ⏳ {t.durationMinutes}m
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5">
                              ❓ {t.totalQuestions} {t.totalQuestions === 1 ? 'Q' : 'Qs'}
                            </span>
                            {module === 'speaking' && !t.isPlaceholder && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">
                                {speakingCategoryLabel(t.speakingCategory)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 border-t border-slate-100 pt-3">
                        {isPreviewableModule ? (
                          (() => {
                            // TestInterface only knows how to render Reading
                            // (split-screen) and Listening (full-width) — see
                            // its own moduleType branch — and needs a real
                            // parts/questionGroups shape to walk, which
                            // placeholders and not-yet-built tests don't have.
                            // Everything else (Speaking/Writing, or a
                            // Reading/Listening test with no content yet)
                            // still falls back to the old flat QuestionPreviewView,
                            // which already has an empty-state for exactly
                            // that case.
                            const hasRealContent =
                              !t.isPlaceholder &&
                              Array.isArray(t.parts) &&
                              t.parts.some((p) => Array.isArray(p.questionGroups) && p.questionGroups.length > 0);
                            const canUseTestInterface = (module === 'reading' || module === 'listening') && hasRealContent;
                            return (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => (canUseTestInterface ? openInterfaceSession(t, 'preview') : setPreviewTest(t))}
                                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-slate-900 active:scale-[0.98]"
                                >
                                  Preview Test
                                </button>
                                {canUseTestInterface && (
                                  <button
                                    onClick={() => openInterfaceSession(t, 'attempt')}
                                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-800 px-3 py-2 text-sm font-semibold text-slate-800 transition-all duration-150 hover:bg-slate-50 active:scale-[0.98]"
                                  >
                                    Attempt Test
                                  </button>
                                )}
                              </div>
                            );
                          })()
                        ) : t.isPlaceholder ? (
                          <span className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-400">
                            Sample — not yet available
                          </span>
                        ) : onSelectTest ? (
                          <button
                            onClick={() => onSelectTest(t)}
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-slate-900 active:scale-[0.98]"
                          >
                            Take Test
                            <svg className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        ) : (
                          <span className="flex w-full items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-400">
                            Practice content
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Question Preview — teacher/institute-only, read-only view of one test's
 * questions, reachable for every module. Renders the parts/questionGroups/
 * questions shape the real Test schema uses (backend/models/Test.js); for
 * Writing specifically there's no builder yet so real content essentially
 * never exists, and this shows the empty state below instead — the page
 * structure is ready, it just has nothing to show yet. When `onEdit` is
 * provided (a real, non-placeholder test), an "Edit Test" button opens the
 * matching builder pre-loaded with this test's data.
 * ---------------------------------------------------------------------- */
/* -------------------------------------------------------------------------
 * Speaking preview — deliberately bespoke rather than reusing the generic
 * parts/questionGroups renderer below, so it can match authentic Cambridge
 * IELTS Speaking booklet formatting:
 *   Part 1 — clean numbered interview questions, no metadata clutter.
 *   Part 2 — the cue card as a boxed topic + "You should say:" bullet
 *            list, with the standard rubric in its own box to the right
 *            (matches how the request asked for the instructions box to
 *            sit alongside the cue card, not merged into it).
 *   Part 3 — bold topic headings, each followed by its own question list,
 *            with no "Questions N–M · speaking prompt" metadata line
 *            (that labeling belongs to scored Reading/Listening question
 *            groups, not spoken discussion topics).
 * Falls back gracefully for tests saved before Part 2 had structured
 * bullets (cueCardBullets missing/empty): the original cue card text —
 * whatever was in passageText — still renders in full inside the box.
 * ---------------------------------------------------------------------- */
function SpeakingPreviewParts({ parts }) {
  const part1 = parts.find((p) => p.partNumber === 1);
  const part2 = parts.find((p) => p.partNumber === 2);
  const part3 = parts.find((p) => p.partNumber === 3);
  const part1Questions = (part1?.questionGroups || []).flatMap((g) => g.questions || []);
  const part2Bullets = Array.isArray(part2?.cueCardBullets) ? part2.cueCardBullets.filter((b) => b && b.trim()) : [];

  return (
    <div className="space-y-6">
      {part1 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-800">{part1.title || 'Part 1 — Introduction and Interview'}</h2>
          {part1.instructions && <p className="mt-1 text-sm text-slate-500">{part1.instructions}</p>}
          {part1Questions.length > 0 && (
            <ol className="mt-4 list-decimal space-y-2.5 pl-5">
              {part1Questions.map((q) => (
                <li key={q.questionNumber} className="text-sm leading-relaxed text-slate-800">
                  {q.prompt}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {part2 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-800">{part2.title || 'Part 2 — Cue Card'}</h2>

          <div className="mt-4 flex flex-col gap-5 md:flex-row md:items-start">
            <div className="flex-1 rounded-lg border-2 border-slate-800 p-5">
              <p className="font-semibold leading-relaxed text-slate-900">{part2.passageText}</p>
              {part2Bullets.length > 0 && (
                <>
                  <p className="mt-3 text-sm font-semibold text-slate-800">You should say:</p>
                  <ul className="mt-2 space-y-1.5 pl-5">
                    {part2Bullets.map((b, bi) => (
                      <li key={bi} className="list-disc text-sm leading-relaxed text-slate-700">
                        {b}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {part2.instructions && (
              <div className="w-full shrink-0 rounded-lg border border-slate-300 bg-slate-50 p-4 md:w-56">
                <p className="text-xs leading-relaxed text-slate-600">{part2.instructions}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {part3 && (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-slate-800">{part3.title || 'Part 3 — Two-way Discussion'}</h2>
          {part3.instructions && <p className="mt-1 text-sm text-slate-500">{part3.instructions}</p>}

          <div className="mt-4 space-y-5">
            {(part3.questionGroups || []).map((group, gi) => (
              <div key={gi} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                <h3 className="text-sm font-bold text-slate-800">{group.groupInstructions}</h3>
                <ul className="mt-2 space-y-2 pl-5">
                  {(group.questions || []).map((q) => (
                    <li key={q.questionNumber} className="list-disc text-sm leading-relaxed text-slate-700">
                      {q.prompt}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionPreviewView({ test, module, onBack, onEdit, viewerRole }) {
  const moduleDef = PRACTICE_MODULES.find((m) => m.key === module) || PRACTICE_MODULES[0];
  const parts = Array.isArray(test.parts) ? test.parts : [];
  const hasContent = parts.some(
    (p) =>
      (Array.isArray(p.questionGroups) && p.questionGroups.length > 0) ||
      (p.passageText && p.passageText.trim()) ||
      (p.imageUrl && p.imageUrl.trim())
  );

  // Live Test Simulation (Speaking only) — swaps the static, read-only
  // SpeakingPreviewParts layout below for the SAME interactive cue-card +
  // prep/speak-timer console a student actually uses (see
  // SpeakingTestView.jsx's SpeakingPart2Pane/SpeakingPromptsPane), so a
  // teacher can rehearse running a real Part 2 sequence — full-screen cue
  // card, the amber 60s prep countdown, the emerald 2:00 speaking count-up
  // — rather than just reading the questions off the page. Deliberately
  // reuses those two panes directly instead of routing through
  // TestInterface/TestInterfaceSession: this preview has no split-pane,
  // word-bank, or real exam-clock machinery to reuse, just the two
  // Speaking-specific panes and a simple set of part tabs.
  const canSimulate = module === 'speaking' && hasContent;
  const [simulationActive, setSimulationActive] = useState(false);
  const [simPartIndex, setSimPartIndex] = useState(0);
  const simPart = parts[simPartIndex] || parts[0];

  function startSimulation() {
    setSimPartIndex(0);
    setSimulationActive(true);
  }

  return (
    // `fixed inset-0 z-[300]` only while simulating — same technique
    // TestInterfaceSession.jsx uses for real Preview/Attempt sessions (see
    // its own doc comment) to escape the ancestor App.jsx teacher chrome
    // ("Live Dashboard" / "Test Builder" tabs, name, "Log out") entirely,
    // rather than just hiding this component's own local header below.
    // z-[300] matches that same precedent so ordering stays unambiguous
    // against every other overlay in the app.
    <div className={simulationActive ? 'fixed inset-0 z-[300] flex h-screen w-screen flex-col bg-slate-50' : 'flex h-full flex-col bg-slate-50'}>
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to {moduleDef.label} Tests
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${moduleDef.accent}`}>
              <moduleDef.Icon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="flex items-center gap-2 text-base font-bold leading-snug text-slate-900">
                {test.title}
                {simulationActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    Live Simulation
                  </span>
                )}
              </h1>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {simulationActive
                  ? `Live test simulation · ${moduleDef.label} · Part ${simPart?.partNumber ?? simPartIndex + 1}`
                  : `Question preview · ${moduleDef.label} · ${test.durationMinutes} mins · ${test.totalQuestions} ${
                      test.totalQuestions === 1 ? 'question' : 'questions'
                    }`}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canSimulate &&
            (simulationActive ? (
              <button
                onClick={() => setSimulationActive(false)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                <IconExit className="h-4 w-4" />
                Exit Simulation
              </button>
            ) : (
              <button
                onClick={startSimulation}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
              >
                <IconPlay className="h-3.5 w-3.5" />
                Start Test Simulation
              </button>
            ))}

          {onEdit && !simulationActive && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-900"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Edit Test
            </button>
          )}
        </div>
      </div>

      {simulationActive ? (
        // Live admin console — visually distinct (dark chrome) from the
        // static, light "editing mode" preview below, so it reads as the
        // console a teacher uses to run a real examination rather than
        // another editable/document-style screen.
        <div className="flex flex-1 flex-col overflow-hidden bg-neutral-900">
          <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/10 bg-neutral-950 px-6 py-3">
            {parts.map((p, pi) => (
              <button
                key={p.partNumber ?? pi}
                onClick={() => setSimPartIndex(pi)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition ${
                  pi === simPartIndex ? 'bg-white text-neutral-900' : 'text-neutral-400 hover:text-white'
                }`}
              >
                Part {p.partNumber ?? pi + 1}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white">
            {/* Light theme — this console's content area is a plain white
                panel (unlike the real exam's contrast-aware TestInterface
                wrapper), so the panes always render in black-on-white here
                regardless of whatever contrast mode a student picked. */}
            {simPart?.partNumber === 2 ? (
              <SpeakingPart2Pane part={simPart} theme={THEME['black-on-white']} />
            ) : (
              <SpeakingPromptsPane part={simPart} theme={THEME['black-on-white']} />
            )}
          </div>
        </div>
      ) : (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          {!hasContent ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center">
              <p className="font-medium text-slate-600">No question content has been uploaded for this test yet.</p>
              <p className="mt-1 text-sm text-slate-400">
                Once {moduleDef.label.toLowerCase()} content is added, its prompts and questions will appear here for
                review.
              </p>
            </div>
          ) : module === 'speaking' ? (
            <SpeakingPreviewParts parts={parts} />
          ) : (
            <div className="space-y-6">
              {parts.map((part, pi) => (
                <div key={pi} className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
                  <h2 className="text-base font-bold text-slate-800">{part.title || `Part ${part.partNumber ?? pi + 1}`}</h2>
                  {part.instructions && <p className="mt-1 text-sm text-slate-500">{part.instructions}</p>}

                  {part.passageText && part.passageText.trim() && (
                    <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{part.passageText}</p>
                    </div>
                  )}

                  {part.imageUrl && part.imageUrl.trim() && (
                    <div className="mt-4">
                      <img
                        src={part.imageUrl}
                        alt={`${part.title || 'Part'} visual`}
                        className="max-h-96 w-auto rounded-lg border border-slate-200 object-contain"
                      />
                    </div>
                  )}

                  {Boolean(part.wordCountTarget) && (
                    <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-400">
                      Target: at least {part.wordCountTarget} words
                    </p>
                  )}

                  {module === 'writing' &&
                    part.partNumber &&
                    (() => {
                      const classification = writingTaskClassification(part);
                      const typeLabel = classification?.type
                        ? writingTypeLabel(part.partNumber, classification.type)
                        : 'Uncategorized';
                      const subTypeLabel = classification?.subType ? writingSubTypeLabel(classification.subType) : '';
                      return (
                        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          {typeLabel}
                          {subTypeLabel ? ` — ${subTypeLabel}` : ''}
                        </p>
                      );
                    })()}

                  {/* Writing's questionGroups carry only an internal
                      classification placeholder (see writingTaskClassification
                      above), not real display content — the actual task
                      prompt is already shown via passageText above, so
                      rendering questionGroups here for Writing would just
                      duplicate it. Reading/Listening still render normally. */}
                  <div className="mt-4 space-y-5">
                    {module !== 'writing' && (part.questionGroups || []).map((group, gi) => (
                      <div key={gi} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                        <p className="text-sm font-semibold text-slate-700">{group.groupInstructions}</p>
                        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                          Questions {group.startNumber}–{group.endNumber} · {group.questionType.replace(/-/g, ' ')}
                        </p>

                        <ol className="space-y-3">
                          {(group.questions || []).map((q) => (
                            <li key={q.questionNumber} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                              <p className="text-sm text-slate-800">
                                <span className="font-semibold">{q.questionNumber}.</span> {q.prompt}
                              </p>
                              {q.options?.length > 0 && (
                                <ul className="mt-2 space-y-1 pl-5 text-sm text-slate-600">
                                  {q.options.map((opt, oi) => (
                                    <li key={oi} className="list-disc">
                                      {opt}
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {(Array.isArray(q.correctAnswer) ? q.correctAnswer.length > 0 : Boolean(q.correctAnswer)) && (
                                <p className="mt-2 text-xs font-medium text-emerald-700">
                                  Correct answer: {Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer}
                                </p>
                              )}
                              {viewerRole === 'teacher' && (Boolean(q.answer) || Boolean(q.explanation)) && (
                                <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50 p-2.5">
                                  {Boolean(q.answer) && (
                                    <p className="text-xs font-semibold text-indigo-800">Answer key: {q.answer}</p>
                                  )}
                                  {Boolean(q.explanation) && (
                                    <p className="mt-1 text-xs leading-relaxed text-indigo-700">
                                      <span className="font-semibold">Explanation: </span>
                                      {q.explanation}
                                    </p>
                                  )}
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {onEdit && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={onEdit}
                className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Edit Test
              </button>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * "Coming Soon" — shown to students in place of the grid view for modules
 * with no real test-taking flow yet (Writing/Speaking). Gated at the
 * dashboard level (see StudentDashboard.jsx) rather than inside
 * PracticeTestsGridView, so a student never even reaches a test card for
 * these modules — there's nothing to accidentally click through to.
 * ---------------------------------------------------------------------- */
export function ComingSoonView({ module, onBack }) {
  const moduleDef = PRACTICE_MODULES.find((m) => m.key === module) || PRACTICE_MODULES[0];

  return (
    <div className="flex h-full flex-col bg-slate-50">
      <div className="flex shrink-0 items-center border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <IconArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <div className="relative flex h-24 w-24 items-center justify-center">
          <span className={`absolute inset-0 animate-ping rounded-full opacity-40 ${moduleDef.accent}`} />
          <span className={`absolute inset-2 animate-pulse rounded-full opacity-60 ${moduleDef.accent}`} />
          <span className={`relative flex h-16 w-16 items-center justify-center rounded-full shadow-inner ${moduleDef.accent}`}>
            <moduleDef.Icon className="h-8 w-8" />
          </span>
        </div>

        <div>
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 shadow-sm">
            <IconSparkles className="h-3.5 w-3.5 text-amber-500" />
            Coming Soon
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{moduleDef.label} practice is on its way</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">
            We're still building the {moduleDef.label.toLowerCase()} practice experience. Check back soon — in the
            meantime, Reading and Listening tests are ready to go.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="h-2 w-2 animate-bounce rounded-full bg-slate-300"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
