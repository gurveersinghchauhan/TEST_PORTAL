import { useEffect, useMemo, useRef, useState } from 'react';
import TestInterface from './TestInterface';

/**
 * TestInterfaceSession
 * ---------------------
 * Teacher-only wrapper around the real student TestInterface — the single
 * component behind BOTH the "Preview Test" and "Attempt Test" buttons on a
 * Reading/Listening test card (see PracticeTests.jsx's
 * PracticeTestsGridView, the only caller). Reusing TestInterface itself
 * (rather than a bespoke preview page) is the whole point: a teacher gets
 * byte-for-byte UI parity with what a student actually sees — split-screen
 * Reading, full-width Listening, identical footer/nav — instead of a
 * separate flat approximation that can drift out of sync with the real
 * thing.
 *
 * Deliberately NOT wired to useExamTimer/useLiveTestChannel — those two
 * hooks open a socket and register the caller as if they were a real
 * student sitting a real LiveSession (student:join, student:register_presence,
 * LiveSession participant lookups, etc. — see backend/socketHandler.js).
 * Reusing them here would create phantom "student" socket rooms for a
 * teacher just clicking around their own dashboard. Preview needs no timer
 * at all (TestInterface's own mode==='preview' branch freezes it
 * regardless of what's passed in here); Attempt needs a REAL countdown so
 * the timed-practice experience is authentic, but with nothing but local
 * component state behind it — no server round trip, no persistence, so a
 * teacher can attempt the same test as many times as they like with zero
 * side effects on real student data.
 *
 * @param {{ test: object, mode: 'preview'|'attempt', onExit: () => void }} props
 */
export default function TestInterfaceSession({ test, mode, onExit }) {
  const isPreview = mode === 'preview';
  const [activePartIndex, setActivePartIndex] = useState(0);
  // Attempt-only: once the teacher ends the attempt, this holds the local
  // score summary and the exam UI is replaced by the result screen below.
  // Preview never sets this — "Exit Preview" goes straight back via onExit.
  const [summary, setSummary] = useState(null);

  // --- Attempt-only local countdown -------------------------------------
  // A real ticking clock (unlike preview, which TestInterface itself
  // freezes), but purely client-side — setInterval, not a socket
  // subscription — so nothing here ever touches activeSessions or
  // LiveSession on the backend.
  const totalSeconds = Math.max(0, (test?.durationMinutes || 0) * 60);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  useEffect(() => {
    if (isPreview) return undefined;
    setSecondsLeft(totalSeconds);
    const intervalId = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(intervalId);
    // Deliberately re-keyed only on identity/mode, not totalSeconds — a
    // fresh attempt of the same test shouldn't restart the clock just
    // because some unrelated re-render recomputed the same number.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, test?._id, test?.id]);

  const timer = useMemo(() => {
    if (isPreview) return { label: 'Preview', status: 'running' };
    const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
    const ss = String(secondsLeft % 60).padStart(2, '0');
    return { label: `${mm}:${ss}`, timeRemaining: secondsLeft, status: secondsLeft <= 0 ? 'time_up' : 'running' };
  }, [isPreview, secondsLeft]);

  // Mirrors TestInterface's own onAnswersChange snapshot so a summary can
  // still be computed even if, for some reason, onSubmitTest fires with no
  // argument — same defensive pattern StudentTestPage.jsx uses for its own
  // force-submit path.
  const latestAnswersRef = useRef({});

  function handleSubmit(answersSnapshot) {
    if (isPreview) {
      // Nothing was ever saved in preview — there's nothing to score or
      // confirm, just leave.
      onExit();
      return;
    }
    // Attempt — grade locally against each question's correctAnswer and
    // show the teacher a summary. Deliberately never calls
    // POST /api/submissions (see StudentTestPage.jsx for that real path),
    // so an attempt can never pollute real student analytics or create a
    // stray Submission document.
    setSummary(scoreAttempt(test, answersSnapshot || latestAnswersRef.current));
  }

  // Fixed, viewport-covering shell — this is what makes Preview/Attempt a
  // TRUE full-screen takeover instead of just another panel inside
  // PracticeTestsGridView's own content area. Without it, this component
  // only ever fills whatever space its caller happens to give it, which
  // for both current callers (TeacherDashboard, InstituteDashboard — see
  // App.jsx) is the area BELOW the persistent institute/teacher header
  // (Live Dashboard / Test Builder tabs, teacher name, Log out). `fixed
  // inset-0` escapes that ancestor entirely and covers the whole browser
  // viewport, visually replacing the header rather than merely sitting
  // below it — no header-hiding state needs to be threaded up through
  // TeacherDashboard/PracticeTestsGridView/App.jsx for this. z-[300] is
  // higher than every other overlay in the app (the incoming-live-test
  // invite modal tops out at z-[200] — see App.jsx — and can never be
  // showing at the same time as a teacher's own Preview/Attempt session
  // anyway, but this keeps the ordering unambiguous regardless). The
  // "Exit Preview"/"End Attempt"/"Back to Tests" controls already wired
  // below (via TestInterface's own footer, and this component's own
  // summary screen) remain the only way out, same as before — this wrapper
  // only changes what's visible AROUND the test interface, not how a
  // teacher leaves it.
  return (
    <div className="fixed inset-0 z-[300] h-screen w-screen bg-white">
      {summary ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-white p-8 text-center">
          <div className="mb-1 flex h-16 w-16 items-center justify-center rounded-full bg-slate-800 text-xl font-bold text-white">
            {summary.total > 0 ? `${summary.percentage}%` : '—'}
          </div>
          <h2 className="text-xl font-bold text-slate-800">Attempt ended</h2>
          <p className="max-w-sm text-sm text-slate-500">
            {summary.total > 0
              ? `You got ${summary.correct} out of ${summary.total} auto-gradable questions right. This attempt was never saved — it's only visible to you.`
              : "This test has no auto-gradable questions to score, but nothing from this attempt was saved either way."}
          </p>
          <button
            onClick={onExit}
            className="mt-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
          >
            Back to Tests
          </button>
        </div>
      ) : (
        <TestInterface
          test={test}
          mode={mode}
          activePartIndex={activePartIndex}
          onChangePart={setActivePartIndex}
          timer={timer}
          onAnswersChange={(snapshot) => {
            latestAnswersRef.current = snapshot;
          }}
          onSubmitTest={handleSubmit}
        />
      )}
    </div>
  );
}

// Compares each question's correctAnswer (String | String[] — see
// backend/models/Test.js) against whatever the teacher actually answered
// during the attempt. Questions with no correctAnswer at all (e.g. a
// 'speaking-prompt', or a question that was never keyed) are excluded from
// both the numerator and denominator entirely, rather than counting as
// wrong — TestInterface.jsx's own module branch means this only ever runs
// against Reading/Listening tests in practice, but the check is harmless
// either way.
function scoreAttempt(test, answersSnapshot) {
  const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
  let correct = 0;
  let total = 0;

  (test?.parts || []).forEach((part) => {
    (part.questionGroups || []).forEach((group) => {
      (group.questions || []).forEach((q) => {
        const expected = q.correctAnswer;
        const isGraded = Array.isArray(expected) ? expected.length > 0 : Boolean(expected);
        if (!isGraded) return;

        total += 1;
        const given = answersSnapshot?.[q.questionNumber];
        let isCorrect;
        if (Array.isArray(expected)) {
          const givenArr = Array.isArray(given) ? given : given != null ? [given] : [];
          const expectedSet = new Set(expected.map(norm));
          const givenSet = new Set(givenArr.map(norm));
          isCorrect = expectedSet.size === givenSet.size && [...expectedSet].every((v) => givenSet.has(v));
        } else {
          isCorrect = norm(given) === norm(expected);
        }
        if (isCorrect) correct += 1;
      });
    });
  });

  return { correct, total, percentage: total > 0 ? Math.round((correct / total) * 100) : 0 };
}
