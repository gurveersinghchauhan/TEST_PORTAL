import { useRef, useState } from 'react';
import { useExamTimer } from "./useExamTimer";
import TestInterface from './TestInterface';
import { authHeaders } from './apiAuth';
import ErrorBoundary from './ErrorBoundary';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

/**
 * StudentTestPage
 * ---------------
 * The actual page a student sees. All timer state comes from the server
 * via useExamTimer — this component just feeds it into TestInterface and
 * reacts to a force-submit by kicking off the real submit-to-DB flow.
 */
export default function StudentTestPage({ student, teacherId, test, liveControlStatus = 'active', liveSessionId = null }) {
  const [activePartIndex, setActivePartIndex] = useState(0);
  const [answered] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  // Set only for a standalone practice attempt (no liveSessionId) — the
  // backend deliberately skips saving those to the database and instead
  // hands the full graded result straight back in the POST response (see
  // routes/submissions.js's POST handler) so it can be shown immediately
  // below instead of the plain "Test submitted" confirmation. Left null
  // for a LIVE TEST submission, which IS persisted and reviewed later via
  // the teacher's LiveTestMonitor/TestRecord instead.
  const [reportData, setReportData] = useState(null);

  // TestInterface owns the live answers state; it mirrors a snapshot up here
  // via onAnswersChange so a server-initiated force-submit (which has no
  // access to TestInterface's internal state) still has something to submit.
  const latestAnswersRef = useRef({});

  // Test docs come straight from Mongoose's res.json() — the `id` virtual
  // isn't serialized by default, only `_id` is. Resolve ONE testId here and
  // reuse it everywhere (socket join + submit POST) so the value the Teacher
  // Dashboard later reads off the live session (session.testId) is guaranteed
  // to match what actually got stored on the submission — otherwise the two
  // could disagree (e.g. one undefined) and "View Report" would look up the
  // wrong thing.
  // Optional chaining throughout this block: `test`/`student` are passed
  // down from parent state and, especially in the moment a force-submit
  // lands, could momentarily be incomplete — better to fall back to a safe
  // default than throw and blank the whole page.
  const testId = test?.id || test?._id;

  const timer = useExamTimer(
    {
      studentId: student?.id,
      studentName: student?.name,
      teacherId,
      testId,
      testTitle: test?.title,
      durationSeconds: (test?.durationMinutes || 0) * 60,
      // Centralized audio (Listening LIVE TEST only) — see useExamTimer.js's
      // own doc comment. null for a standalone practice attempt, which is
      // exactly what keeps TestInterface rendering the normal, unlocked
      // native <audio controls> for practice (see its liveSessionId prop
      // below and ListeningPane's branch on it).
      liveSessionId,
    },
    () => {
      // Server told us the teacher force-submitted — submit whatever the
      // student has answered so far.
      submitTest(latestAnswersRef.current, { auto: true, reason: 'teacher_force_submit' });
    }
  );

  async function submitTest(answersSnapshot, meta = {}) {
    if (submitting || submitted) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API_URL}/api/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          studentId: student?.id,
          studentName: student?.name,
          teacherId,
          testId,
          // Only set when this attempt came from a LIVE TEST (see
          // App.jsx's liveSessionId, threaded down as a prop) — null for
          // an ordinary practice-test attempt. Lets the backend link this
          // submission to that specific LiveSession, which is what
          // TestRecord.jsx's per-session summary table reads (see
          // routes/submissions.js's POST handler).
          liveSessionId: liveSessionId || null,
          answers: answersSnapshot || {},
          timeTakenSeconds: Math.max(0, (test?.durationMinutes || 0) * 60 - (timer?.timeRemaining ?? 0)),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A LIVE TEST submission that failed to SAVE (backend DB error)
        // still comes back with a graded-but-unsaved `submission` payload
        // alongside the error (see routes/submissions.js) — surfacing
        // data?.error here (rather than a generic message) is what lets
        // the student see "we graded it, just couldn't save it, please
        // retry" instead of a plain failure with no explanation.
        throw new Error(data?.error || `Submit failed (HTTP ${res.status})`);
      }
      // The grade is saved now, but nothing has told the LIVE timer session
      // (activeSessions on the server) to stop ticking / flip to 'submitted'
      // — that only happened automatically for teacher-forced submits. Tell
      // it explicitly so the Teacher Dashboard's status updates too. Passing
      // liveSessionId lets the server target this exact LiveSession even if
      // the teacher already ended it a moment ago (see useExamTimer.js's
      // notifySubmitted and socketHandler.js's studentSubmitted/
      // endLiveSession) — otherwise a straggler auto-submitted right as the
      // session closes could finish its POST just after status flips to
      // 'completed' and never get its participant record finalized.
      timer?.notifySubmitted?.(liveSessionId);
      // Standalone practice (no liveSessionId): nothing was saved
      // server-side — the graded result came back directly in this
      // response. Stash it so the render below can show an instant report
      // instead of the plain confirmation screen.
      if (!liveSessionId && data?.submission) {
        setReportData(data.submission);
      }
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit test:', meta, err);
      // Network errors (backend down, wrong port, CORS) throw a bare
      // "Failed to fetch" with no HTTP status — surface something readable.
      setSubmitError(err?.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : (err?.message || 'Unknown error.'));
    } finally {
      setSubmitting(false); // allow retry
    }
  }

  // Guards against rendering the exam UI (or the timer bar) off of
  // incomplete data — e.g. `test` failing to load, or a stale/partial
  // props update landing mid force-submit. Shows a clear message and a way
  // out instead of a component crash / blank white screen.
  if (!test || !student) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white p-8 text-center">
        <h2 className="text-lg font-bold text-slate-800">Couldn't load this test</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Some test or student information is missing. Try reloading the page — if that doesn't help, let your
          teacher know.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
        >
          Reload page
        </button>
      </div>
    );
  }

  // Once the POST succeeds, replace the exam UI entirely — there's nothing
  // left to answer and re-showing TestInterface risked looking like nothing
  // had happened at all.
  if (submitted) {
    // Standalone practice attempt: instead of dropping the student onto a
    // separate flat results page, hand them straight back into the SAME
    // split-pane TestInterface they just took the test in — mode="review"
    // is the student-facing counterpart to the teacher's own Preview mode
    // (see TestInterface.jsx's mode doc comment), so the passage and
    // questions stay side-by-side and every question shows its own
    // correct/incorrect verdict, correct answer, and explanation directly
    // underneath, in place. Nothing here was persisted server-side — this
    // `reportData` response IS the only record of the result that will
    // ever exist — so `test` (the full definition this page already has,
    // correctAnswer/explanation included — see TestInterfaceSession.jsx's
    // Preview mode for the same trust model) plus `reportData` together are
    // the only two things review mode needs; no extra fetch required.
    if (reportData) {
      const initialAnswers = Object.fromEntries(
        (Array.isArray(reportData.answers) ? reportData.answers : []).map((a) => [
          a.questionNumber,
          a.studentAnswer,
        ])
      );
      const pct =
        reportData.totalQuestions > 0 ? Math.round((reportData.score / reportData.totalQuestions) * 100) : 0;
      return (
        // Same scoped-crash protection as the live exam's own TestInterface
        // below — malformed question data shouldn't turn an already-graded
        // result into a blank white screen with no way out.
        <ErrorBoundary
          resetKey={testId}
          fallback={
            <div className="flex h-full flex-col items-center justify-center bg-white p-8 text-center">
              <h2 className="text-lg font-bold text-slate-800">This result couldn't be displayed</h2>
              <p className="mt-2 max-w-sm text-sm text-slate-500">
                Something about this test's content looks incomplete. Your score was {reportData.score}/
                {reportData.totalQuestions} ({pct}%) — reloading usually fixes the review view itself.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
              >
                Reload page
              </button>
            </div>
          }
        >
          <TestInterface
            test={test}
            mode="review"
            // Reusing this page's own activePartIndex/setActivePartIndex
            // (already declared above for the exam itself, still in scope)
            // rather than introducing a second copy — lets the student move
            // freely between Part 1/2/3 to review their mistakes part by
            // part, same split-pane navigation as the live test.
            activePartIndex={activePartIndex}
            onChangePart={setActivePartIndex}
            initialAnswers={initialAnswers}
            scoreSummary={{
              score: reportData.score,
              totalQuestions: reportData.totalQuestions,
              percentage: pct,
              bandScore: reportData.bandScore,
            }}
            // "Close Review" (BottomPagination's labeled button in review
            // mode) reloads the page — same as the old flat report's own
            // Close button — which drops the student back on their
            // dashboard rather than leaving this unsaved, one-time-only
            // result sitting around in memory with no way to reach it again.
            onExit={() => window.location.reload()}
          />
        </ErrorBoundary>
      );
    }

    // LIVE TEST submission: graded and saved instantly, but the score is
    // withheld until a teacher explicitly releases it — see
    // routes/submissions.js's isPublished/GET-mine/POST-:id-publish and
    // TestRecord.jsx's/LiveTestMonitor.jsx's "Publish Scorecard to
    // Student" (Teacher-Gated Result Release). This page doesn't poll for
    // that release itself — it's fine for the student to close this
    // window now; "My Results" on the Student Dashboard is where they
    // check back once their teacher has released it.
    return (
      <div className="flex h-full flex-col items-center justify-center bg-white p-8 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-2xl text-green-600">
          ✓
        </div>
        <h2 className="text-xl font-bold text-slate-800">Test submitted successfully</h2>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Your instructor is reviewing your submission; results will be released shortly. You can check back under
          "My Results" on your dashboard, or close this window now.
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Scoped ErrorBoundary: if the test content itself is malformed
          (unexpected part/question shape), the student sees a clear
          message with a reload option instead of a blank page — and the
          force-submit flow this component drives keeps working either way. */}
      <ErrorBoundary
        resetKey={testId}
        fallback={
          <div className="flex h-full flex-col items-center justify-center bg-white p-8 text-center">
            <h2 className="text-lg font-bold text-slate-800">This test couldn't be displayed</h2>
            <p className="mt-2 max-w-sm text-sm text-slate-500">
              Something about this test's content looks incomplete. Reloading usually fixes it — let your teacher
              know if it keeps happening.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
            >
              Reload page
            </button>
          </div>
        }
      >
        <TestInterface
          test={test}
          activePartIndex={activePartIndex}
          onChangePart={setActivePartIndex}
          answeredQuestionNumbers={answered}
          timer={timer} // { label, status, timeRemaining, connected }
          // Centralized audio (Listening LIVE TEST only) — see
          // useExamTimer.js/TestInterface.jsx's LockedAudioPlayer. Passing
          // liveSessionId itself (not just audioState) is what tells
          // ListeningPane whether to render the locked player at all —
          // audioState alone can't distinguish "practice attempt, no
          // teacher ever broadcasting" from "live test, teacher just
          // hasn't pressed Play yet," both of which are null/empty.
          liveSessionId={liveSessionId}
          audioState={timer.audioState}
          onAnswersChange={(snapshot) => {
            latestAnswersRef.current = snapshot;
          }}
          onSubmitTest={(answersSnapshot) => submitTest(answersSnapshot, { auto: false })}
        />
      </ErrorBoundary>

      {/* LIVE TEST proctoring lock — layered ON TOP of TestInterface rather
          than replacing it, so a teacher pausing/blocking a student never
          unmounts TestInterface and loses whatever they've typed/placed so
          far (that state lives inside TestInterface's own useState, only
          mirrored up via onAnswersChange above). z-[100] so this sits above
          everything else in this stack, including FloatingQuestionNav/
          DragOverlay inside TestInterface and the submitting/error toasts
          below. See useLiveTestChannel.js / App.jsx for where this prop
          comes from, and socketHandler.js's 'live_test_control' handler for
          the server side. */}
      {(liveControlStatus === 'paused' || liveControlStatus === 'blocked' || liveControlStatus === 'disconnected') && (
        <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-slate-900/90 px-6 text-center backdrop-blur-sm">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
              liveControlStatus === 'blocked'
                ? 'bg-rose-500/20 text-rose-300'
                : liveControlStatus === 'disconnected'
                ? 'bg-sky-500/20 text-sky-300'
                : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {liveControlStatus === 'blocked' ? '⛔' : liveControlStatus === 'disconnected' ? '🔒' : '⏸'}
          </div>
          <h2 className="text-lg font-bold text-white">
            {liveControlStatus === 'blocked'
              ? 'Your test has been blocked'
              : liveControlStatus === 'disconnected'
              ? 'Test paused'
              : 'Your test has been paused'}
          </h2>
          <p className="max-w-sm text-sm text-slate-300">
            {liveControlStatus === 'blocked'
              ? 'Your teacher has blocked your access to this test. Please wait for them to unblock it.'
              : liveControlStatus === 'disconnected'
              ? "Waiting for teacher's permission to resume. Your answers are safe — this screen will unlock automatically."
              : 'Your teacher has paused this test. Your answers are safe — you can continue as soon as they resume it.'}
          </p>
        </div>
      )}

      {/* Submitting / error feedback — the confirm() dialog gave no indication
          either way before this, so a failed or in-flight submit looked
          identical to nothing happening. */}
      {submitting && (
        <div className="absolute inset-x-0 bottom-4 z-50 mx-auto w-fit rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-600 shadow-lg">
          Submitting your test…
        </div>
      )}
      {submitError && (
        <div className="absolute inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-lg">
          <div className="flex items-start justify-between gap-3">
            <span>Couldn't submit your test: {submitError}</span>
            <button
              onClick={() => setSubmitError(null)}
              className="shrink-0 text-xs font-medium text-rose-500 underline hover:text-rose-700"
            >
              Dismiss
            </button>
          </div>
          <button
            onClick={() => submitTest(latestAnswersRef.current, { auto: false })}
            className="mt-2 rounded bg-rose-600 px-3 py-1 text-xs font-medium text-white hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
