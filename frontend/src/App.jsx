import React, { useEffect, useRef, useState } from 'react';
import LoginPage from './LoginPage';
import InstituteDashboard from './InstituteDashboard';
import StudentDashboard from './StudentDashboard';
import StudentTestPage from './StudentTestPage';
import TeacherDashboard from './TeacherDashboard';
import TestBuilder from './Testbuilder';
import SuperAdminDashboard from './SuperAdminDashboard';
import { authHeaders } from './apiAuth';
import { useLiveTestChannel } from './useLiveTestChannel';
import { useBackNavigation } from './useBackNavigation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function formatCountdown(seconds) {
  const s = Math.max(0, seconds);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export default function App() {
  // /super-admin is a standalone console, entirely outside the normal
  // login/role flow (see SuperAdminDashboard.jsx) — there's no client-side
  // router in this app, so it's just detected from the URL directly. This
  // check happens before anything else (including the auth rehydration
  // below) so visiting /super-admin never gets caught up in a logged-in
  // institute/teacher/student session.
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/super-admin') {
    return (
      <div className="h-screen w-screen overflow-hidden bg-slate-50">
        <SuperAdminDashboard />
      </div>
    );
  }

  return <AuthenticatedApp />;
}

function AuthenticatedApp() {
  // Rehydrate from localStorage on first mount so a page refresh doesn't
  // throw a logged-in user back to the login screen. Shape: { token, user }
  // where user = { id, name, email, role, teacher, institute }.
  const [auth, setAuth] = useState(() => {
    try {
      const token = localStorage.getItem('auth_token');
      const userRaw = localStorage.getItem('auth_user');
      if (token && userRaw) return { token, user: JSON.parse(userRaw) };
    } catch (err) {
      console.error('Failed to read saved session:', err);
    }
    return null;
  });

  // Which test (if any) the student is currently taking — StudentDashboard
  // owns fetching/browsing tests itself now (see PracticeTests.jsx), App
  // just needs to know when to swap in StudentTestPage.
  const [selectedTest, setSelectedTest] = useState(null);

  // A teacher's own workspace has two tabs. Kept as `hidden`-toggled panels
  // (not conditional rendering) further down so switching tabs doesn't tear
  // down TeacherDashboard's socket or TestBuilder's in-progress draft.
  const [teacherView, setTeacherView] = useState('dashboard'); // 'dashboard' | 'builder'

  const role = auth?.user?.role;

  // LIVE TEST — student-side channel. Called unconditionally (rules of
  // hooks) but only actually connects once studentId is truthy (see
  // useLiveTestChannel's own guard) — this has to live here, at the level
  // that stays mounted across StudentDashboard <-> StudentTestPage swaps,
  // rather than inside either of those screens (see that hook's doc
  // comment for why).
  const { incomingLiveTest, respond, liveControlStatus, liveTestLock, inviteSecondsLeft } = useLiveTestChannel(
    role === 'student' ? auth?.user?.id : undefined
  );
  const [liveJoinError, setLiveJoinError] = useState(null);
  const [liveJoining, setLiveJoining] = useState(false);
  // Which LiveSession (see backend/models/LiveSession.js) the student is
  // currently inside, if any — null for an ordinary practice-test attempt.
  // Set the moment they join (or auto-resume into) a live test, and handed
  // down to StudentTestPage.jsx so its POST /api/submissions payload can
  // carry it as `liveSessionId`, which is what lets TestRecord.jsx's
  // per-session summary table find this student's result later. Cleared
  // whenever they leave the test screen (Back to Test List / logout) —
  // it only ever describes the CURRENT attempt, not history.
  const [liveSessionId, setLiveSessionId] = useState(null);
  // Auto-resume feedback for the App-level lock screen below — separate
  // from liveJoining/liveJoinError above (those belong to the "student
  // clicked Join on the incoming_live_test modal" flow, this is the
  // "teacher clicked Allow Resume while the student had no page open at
  // all" flow).
  const [liveResuming, setLiveResuming] = useState(false);
  const [liveResumeError, setLiveResumeError] = useState(null);

  // Strict resume gatekeeper, App-level half (see StudentTestPage.jsx for
  // the in-place overlay half, used when TestInterface is still mounted).
  // This app has no client-side router — a hard refresh or the browser's
  // back button just resets `selectedTest` to null, which would otherwise
  // drop the student straight onto StudentDashboard with zero indication
  // they're still locked out of a live test. `liveTestLock` (from
  // useLiveTestChannel) is the source of truth regardless of what's
  // mounted — it's re-pushed by the server's resyncStudentLiveTestState on
  // every reconnect (see socketHandler.js), so it's still correct even
  // after a full page reload. The lock screen render itself lives further
  // down, gated on `liveTestLock && !selectedTest`; this effect only
  // handles the OTHER direction — once a teacher's "Allow Resume" clears
  // the lock while the student is sitting on that screen (not inside
  // StudentTestPage, which has its own overlay/unlock), seamlessly refetch
  // the test and drop them back into it instead of leaving them stranded
  // on a lock screen with no way back in.
  const prevLiveTestLockRef = useRef(liveTestLock);
  useEffect(() => {
    const prevLock = prevLiveTestLockRef.current;
    prevLiveTestLockRef.current = liveTestLock;
    if (!prevLock || liveTestLock || selectedTest) return;

    setLiveResuming(true);
    setLiveResumeError(null);
    setLiveSessionId(prevLock.sessionId);
    fetch(`${API_URL}/api/tests/${prevLock.testId}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load the test (HTTP ${res.status}).`);
        setSelectedTest(data);
      })
      .catch((err) => {
        setLiveResumeError(
          err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
        );
      })
      .finally(() => setLiveResuming(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTestLock, selectedTest]);

  function handleLiveTestJoin() {
    if (!incomingLiveTest) return;
    const { testId, sessionId } = incomingLiveTest;
    setLiveJoining(true);
    setLiveJoinError(null);
    setLiveSessionId(sessionId);
    respond('join');

    fetch(`${API_URL}/api/tests/${testId}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load the test (HTTP ${res.status}).`);
        setSelectedTest(data);
      })
      .catch((err) => {
        setLiveJoinError(
          err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
        );
      })
      .finally(() => setLiveJoining(false));
  }

  function handleLiveTestDismiss() {
    respond('dismiss');
  }

  // Leaves the test screen back to StudentDashboard — always paired with
  // clearing liveSessionId, since that field only ever describes whichever
  // attempt is CURRENTLY in progress (see its own declaration above).
  function backToTestList() {
    setSelectedTest(null);
    setLiveSessionId(null);
  }

  // The student test-taking screen (StudentTestPage swapped in for
  // StudentDashboard) is the single most important case of the browser
  // back-button bug this hook fixes — without it, a student mid-test who
  // taps physical Back gets kicked out of the app entirely instead of
  // landing back on the test list. See useBackNavigation.js.
  useBackNavigation(Boolean(selectedTest), backToTestList);

  function handleLogin({ token, user }) {
    setAuth({ token, user });
  }

  function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setAuth(null);
    setSelectedTest(null);
    setLiveSessionId(null);
    setTeacherView('dashboard');
  }

  if (!auth) {
    return (
      <div className="h-screen w-screen bg-slate-50">
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-50">
      {role === 'institute' && <InstituteDashboard auth={auth} onLogout={handleLogout} />}

      {role === 'teacher' && (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTeacherView('dashboard')}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  teacherView === 'dashboard' ? 'bg-rose-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Live Dashboard
              </button>
              <button
                onClick={() => setTeacherView('builder')}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  teacherView === 'builder' ? 'bg-rose-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Test Builder
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">Teacher</p>
                <p className="text-sm font-medium text-slate-700">{auth.user.name}</p>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Log out
              </button>
            </div>
          </div>

          {/* min-h-0 overrides the flex default of min-height: auto — without
              it, this flex item refuses to shrink below the intrinsic height
              of whatever's inside it (TeacherDashboard's own content), so on
              a shorter viewport the dashboard could grow taller than the
              space actually available here and get clipped by the outer
              shell's h-screen overflow-hidden with no way to scroll to the
              clipped part. min-h-0 lets this flex item actually respect
              flex-1's bounded height, so TeacherDashboard's own
              h-full overflow-y-auto can do its job and every card stays
              reachable by scrolling inside the dashboard, not cut off. */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div className={`h-full ${teacherView === 'dashboard' ? '' : 'hidden'}`}>
              <TeacherDashboard teacherId={auth.user.id} teacherName={auth.user.name} />
            </div>
            <div className={`h-full ${teacherView === 'builder' ? '' : 'hidden'}`}>
              <TestBuilder />
            </div>
          </div>
        </div>
      )}

      {role === 'student' && (
        <div className="flex h-full flex-col">
          {!selectedTest ? (
            liveTestLock ? (
              // App-level lock screen — see the prevLiveTestLockRef effect
              // above for how this clears itself automatically once the
              // teacher hits "Allow Resume". Deliberately its own screen
              // rather than reusing StudentDashboard/StudentTestPage: there
              // is no TestInterface mounted here to overlay (that's
              // StudentTestPage.jsx's job when the student never left the
              // test), so this exists purely to stop a reload/back-button
              // from ever showing the dashboard while a lock is active.
              <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/20 text-2xl text-sky-300">
                  🔒
                </div>
                <h2 className="text-lg font-bold text-white">Test paused</h2>
                <p className="max-w-sm text-sm text-slate-300">
                  Waiting for teacher's permission to resume.
                </p>
                {liveResuming && <p className="text-xs text-slate-400">Resuming…</p>}
                {liveResumeError && (
                  <p className="max-w-sm text-xs text-rose-400">Couldn't resume automatically: {liveResumeError}</p>
                )}
                <button
                  onClick={handleLogout}
                  className="mt-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-900"
                >
                  Log out
                </button>
              </div>
            ) : (
              <StudentDashboard auth={auth} onSelectTest={setSelectedTest} onLogout={handleLogout} />
            )
          ) : (
            /* Jab test select ho jaye, toh real StudentTestPage kholo — no
               app-level navy chrome here anymore. TestInterface's own
               TopNavbar (PrepPortal logo, test title, countdown timer,
               connectivity icon, utility icons — see TestInterface.jsx) is
               now the ONLY header on this screen, edge-to-edge and
               distraction-free, matching the real IELTS (Inspera)
               computer-delivered exam interface. There is deliberately no
               "Back to Test List" / "Log out" escape hatch here anymore,
               same as the real exam platform — leaving mid-test is handled
               by the browser back button (see useBackNavigation) and the
               teacher-side controls, not a header button. */
            <div className="flex-1 overflow-hidden">
              <StudentTestPage
                student={{ id: auth.user.id, name: auth.user.name }}
                teacherId={auth.user.teacher}
                test={selectedTest}
                liveControlStatus={liveControlStatus}
                liveSessionId={liveSessionId}
              />
            </div>
          )}

          {incomingLiveTest && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4">
              <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-2xl">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
                  <span className="h-3 w-3 animate-pulse rounded-full bg-rose-600" />
                </div>
                <h2 className="text-lg font-bold text-slate-900">Live Test</h2>
                {/* Deliberately no test name/number here — the student
                    should only know a live test has started, not which one,
                    until they actually join it. */}
                <p className="mt-2 text-sm text-slate-600">
                  Live test started by{' '}
                  <span className="font-semibold text-slate-800">{incomingLiveTest.teacherName || 'your teacher'}</span>
                </p>

                {/* Visible 120s countdown — the actual auto-dismiss timing
                    lives in useLiveTestChannel's own setTimeout, this is
                    purely the display; see that hook's inviteSecondsLeft. */}
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-rose-500 transition-all duration-1000 ease-linear"
                      style={{ width: `${(inviteSecondsLeft / 120) * 100}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Auto-dismissing in <span className="font-mono font-medium text-slate-600">{formatCountdown(inviteSecondsLeft)}</span>
                  </p>
                </div>

                <div className="mt-5 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={handleLiveTestDismiss}
                    disabled={liveJoining}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={handleLiveTestJoin}
                    disabled={liveJoining}
                    className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {liveJoining ? 'Joining…' : 'Join'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rendered independently of the invite modal above (rather than
              inside it) — 'join' clears incomingLiveTest immediately so the
              modal closes the instant the student clicks it, but the
              GET /api/tests/:id fetch that follows can still fail after
              that point, and this is the only place left to tell them. */}
          {liveJoinError && !incomingLiveTest && !selectedTest && (
            <div className="fixed inset-x-4 bottom-4 z-[200] mx-auto w-fit max-w-md rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <span>Couldn't join the live test: {liveJoinError}</span>
                <button
                  onClick={() => setLiveJoinError(null)}
                  className="shrink-0 text-xs font-medium text-rose-500 underline hover:text-rose-700"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {!['institute', 'teacher', 'student'].includes(role) && (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm text-slate-500">Unrecognized account role "{role}".</p>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
