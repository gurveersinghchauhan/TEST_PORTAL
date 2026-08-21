import { useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from './apiAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function IconArrowLeft({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

function IconUserPlus({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20c0-3.31 2.46-6 5.5-6s5.5 2.69 5.5 6" />
      <path d="M18.5 8.5v5M16 11h5" />
    </svg>
  );
}

function IconX({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconPlay({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M7 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

function IconPause({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="5" width="4.5" height="14" rx="1" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="1" />
    </svg>
  );
}

function IconSkipBack({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9.5 12 19 6v12l-9.5-6Z" fill="currentColor" stroke="none" />
      <path d="M5 6v12" />
    </svg>
  );
}

function IconSkipForward({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 12 5 6v12l9.5-6Z" fill="currentColor" stroke="none" />
      <path d="M19 6v12" />
    </svg>
  );
}

function IconRotateLeft({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3.5 12a8.5 8.5 0 1 1 2.5 6" />
      <path d="M3.5 6.5v5.5H9" />
    </svg>
  );
}

function IconVolume({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z" />
      <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </svg>
  );
}

const STATUS_BADGE = {
  invited: 'bg-amber-50 text-amber-700 border-amber-200',
  joined: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  dismissed: 'bg-neutral-100 text-neutral-500 border-neutral-200',
  // Deliberately distinct from 'dismissed' — the student never actively
  // declined, they just didn't respond within the 2-minute window (see
  // useLiveTestChannel.js). Same reasoning as the schema comment on
  // LiveSession.js's status enum.
  dismissed_timeout: 'bg-orange-50 text-orange-600 border-orange-200',
  // Set once studentSubmitted's LiveSession update lands (see
  // socketHandler.js) — kept distinct from 'joined' so a finished student
  // reads clearly as done rather than still mid-test, and so
  // markStudentDisconnected's status:'joined' guard is visibly why a
  // submitted student never flips to 'Disconnected' afterward.
  submitted: 'bg-sky-50 text-sky-700 border-sky-200',
};

const STATUS_LABEL = {
  invited: 'Invited',
  joined: 'Joined',
  dismissed: 'Dismissed',
  dismissed_timeout: 'Timeout',
  submitted: 'Submitted',
};

const CONTROLS_BADGE = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused: 'bg-amber-50 text-amber-700 border-amber-200',
  blocked: 'bg-rose-50 text-rose-700 border-rose-200',
  // Server-detected (socket drop or test_exited), never a direct teacher
  // action — see LiveSession.js's schema comment on this value. Distinct
  // amber/orange-adjacent but different from 'paused' so a teacher can
  // tell "I paused them" apart from "they lost connection" at a glance.
  disconnected: 'bg-orange-50 text-orange-700 border-orange-200',
};

const CONTROLS_LABEL = {
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  disconnected: 'Disconnected',
};

// A freshly-started session (LiveTestSetup.jsx's onStarted) already builds
// its participants with studentName/studentEmail attached, straight from
// the audience the teacher just picked. A RESUMED session (see
// TeacherDashboard.jsx's openLiveTest/toMonitorSession) instead comes
// straight from the database, whose participant subdocument never stores a
// name/email at all (see backend/models/LiveSession.js) — this fills those
// in from `allStudents` (already loaded for the invite modal regardless),
// and is a safe no-op for the already-named case.
function autoSubmitMessage(count) {
  return `${count} student${count === 1 ? '' : 's'} still mid-test ${
    count === 1 ? 'was' : 'were'
  } automatically submitted so their results are saved.`;
}

function enrichParticipants(list, allStudents) {
  if (!list.some((p) => !p.studentName)) return list;
  const byId = new Map(allStudents.map((s) => [String(s._id), s]));
  return list.map((p) => {
    if (p.studentName) return p;
    const match = byId.get(String(p.studentId));
    return { ...p, studentName: match?.name || 'Student', studentEmail: match?.email || '' };
  });
}

function formatAudioTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * AudioControlPanel — Teacher-Controlled Centralized Audio Player
 * ------------------------------------------------------------------------
 * Rendered only for a Listening session (see LiveTestMonitor's return
 * below). This is the ONE place that actually plays the test's audio for
 * the teacher — every connected student's TestInterface.jsx has its own
 * <audio> element (LockedAudioPlayer) that just mirrors whatever this one
 * broadcasts, never plays independently.
 *
 * A Listening test has exactly ONE pre-merged master audio file
 * (test.masterAudioUrl — this component fetches the full Test doc itself,
 * since the `session` prop only ever carries testId/testTitle/module, not
 * the test's own fields) covering all 4 sections back-to-back, replacing
 * the old per-part audioUrl system — there's no "which part is live"
 * selector anymore, just one continuous stream.
 *
 * Every control funnels through the real <audio> element's own native
 * events (onPlay/onPause/onSeeked) to trigger a broadcast — a button never
 * broadcasts directly, it just mutates audioRef.current (play/pause/
 * currentTime) and lets the resulting native event do it. That keeps
 * "what actually happened to the audio" and "what we told students
 * happened" impossible to drift apart, whether the action came from a
 * button, a progress-bar drag, or (if the browser exposes them) native
 * media-key/keyboard controls.
 *
 * On mount, joins this session's audio room and asks the server for
 * whatever's already live (socketHandler.js's 'audio:join_session' /
 * resyncAudioState) — the counterpart to a student's late-join resync,
 * just for a teacher reopening/reloading this monitor mid-broadcast
 * instead of a student reconnecting.
 */
function AudioControlPanel({ session, socket }) {
  const [test, setTest] = useState(null);
  const [testLoading, setTestLoading] = useState(true);
  const [testError, setTestError] = useState(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  // While non-null, the progress bar shows this instead of `currentTime` —
  // lets the teacher drag the scrubber smoothly without seeking (and
  // broadcasting) on every intermediate pixel; the real seek + broadcast
  // only happens once they release it (see the range input's onMouseUp/
  // onTouchEnd below).
  const [seekDraft, setSeekDraft] = useState(null);

  const audioRef = useRef(null);
  // Set by a server resync (see the socket effect below) and consumed
  // exactly once, in the <audio> element's onLoadedMetadata — that's the
  // first reliable point a freshly-mounted element will accept a
  // currentTime assignment / .play() call. Stays null when nothing needs
  // hydrating (e.g. no resync has arrived yet).
  const pendingHydrateRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setTestLoading(true);
    setTestError(null);
    fetch(`${API_URL}/api/tests/${session.testId}`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load this test's audio (HTTP ${res.status}).`);
        if (!cancelled) setTest(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setTestError(
            err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
          );
        }
      })
      .finally(() => {
        if (!cancelled) setTestLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.testId]);

  const hasMasterAudio = Boolean(test?.masterAudioUrl);

  // Join this session's audio room and resync to whatever's already live —
  // see socketHandler.js's 'audio:join_session' handler / resyncAudioState.
  useEffect(() => {
    if (!socket || !session?.sessionId) return undefined;
    socket.emit('audio:join_session', { sessionId: session.sessionId });

    function handleAudioState(update) {
      if (!update || update.sessionId !== session.sessionId) return;
      const target = update.isPlaying
        ? update.currentTime + (Date.now() - update.updatedAt) / 1000
        : update.currentTime;
      pendingHydrateRef.current = { currentTime: Math.max(0, target), isPlaying: update.isPlaying };
      setIsPlaying(update.isPlaying);
      setCurrentTime(Math.max(0, target));
    }

    socket.on('audio:state', handleAudioState);
    return () => socket.off('audio:state', handleAudioState);
  }, [socket, session?.sessionId]);

  function broadcast(overrides = {}) {
    if (!socket || !session?.sessionId || !hasMasterAudio) return;
    const audio = audioRef.current;
    socket.emit('audio:control', {
      sessionId: session.sessionId,
      isPlaying: overrides.isPlaying ?? (audio ? !audio.paused : isPlaying),
      currentTime: overrides.currentTime ?? (audio ? audio.currentTime : currentTime),
    });
  }

  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    // The resulting native 'play'/'pause' event broadcasts — no emit here.
  }

  function skip(deltaSeconds) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + deltaSeconds), duration || audio.currentTime + deltaSeconds);
    // The resulting native 'seeked' event broadcasts — no emit here.
  }

  function resetToStart() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    // 'pause' + 'seeked' both fire natively and each broadcast — a couple
    // of harmless extra emits of the same end state is fine.
  }

  function commitSeekDraft() {
    const audio = audioRef.current;
    if (audio && seekDraft != null) audio.currentTime = seekDraft;
    setSeekDraft(null);
    // The resulting native 'seeked' event broadcasts — no emit here.
  }

  if (session.module !== 'listening') return null;

  return (
    <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-neutral-800">Centralized audio player</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Every joined student's audio mirrors this player — they can't play, pause, or scrub it themselves.
          </p>
        </div>
      </div>

      {testLoading ? (
        <p className="py-4 text-center text-sm text-neutral-400">Loading audio…</p>
      ) : testError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{testError}</p>
      ) : !hasMasterAudio ? (
        <p className="py-4 text-center text-sm text-neutral-400">
          No master audio file has been uploaded for this test yet.
        </p>
      ) : (
        <div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioRef}
            src={test.masterAudioUrl}
            className="hidden"
              onLoadedMetadata={(e) => {
                const audio = e.currentTarget;
                audio.volume = volume;
                setDuration(audio.duration || 0);
                const pending = pendingHydrateRef.current;
                if (pending) {
                  audio.currentTime = pending.currentTime;
                  if (pending.isPlaying) audio.play().catch(() => {});
                  pendingHydrateRef.current = null;
                }
              }}
              onPlay={() => {
                setIsPlaying(true);
                broadcast({ isPlaying: true });
              }}
              onPause={() => {
                setIsPlaying(false);
                broadcast({ isPlaying: false });
              }}
              onSeeked={() => broadcast({})}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
            />

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => skip(-10)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-50"
                aria-label="Back 10 seconds"
              >
                <IconSkipBack className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={togglePlayPause}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-neutral-800 text-white shadow-sm transition hover:bg-neutral-900"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <IconPause className="h-5 w-5" /> : <IconPlay className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={() => skip(10)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-50"
                aria-label="Forward 10 seconds"
              >
                <IconSkipForward className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={resetToStart}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition hover:bg-neutral-50"
                aria-label="Reset to start"
              >
                <IconRotateLeft className="h-4 w-4" />
              </button>

              <div className="flex flex-1 items-center gap-2">
                <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-neutral-400">
                  {formatAudioTime(seekDraft ?? currentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.01)}
                  step={0.1}
                  value={seekDraft ?? currentTime}
                  onChange={(e) => setSeekDraft(Number(e.target.value))}
                  onMouseUp={commitSeekDraft}
                  onTouchEnd={commitSeekDraft}
                  className="h-1.5 flex-1 cursor-pointer accent-neutral-800"
                />
                <span className="w-10 shrink-0 text-[11px] tabular-nums text-neutral-400">
                  {formatAudioTime(duration)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <IconVolume className="h-4 w-4 text-neutral-400" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    if (audioRef.current) audioRef.current.volume = v;
                  }}
                  className="h-1.5 w-20 cursor-pointer accent-neutral-800"
                  aria-label="Volume (this device only — not broadcast to students)"
                />
              </div>
            </div>
          </div>
      )}
    </div>
  );
}

/**
 * LiveTestMonitor
 * ----------------
 * The real-time monitoring table for a just-started LIVE TEST session (see
 * LiveTestSetup.jsx's `onStarted`, which hands off the initial `session`
 * object here). Listens for `live_test_status_update` on the SAME shared
 * socket TeacherDashboard already keeps alive, and keeps its local roster
 * in sync by overwriting the matching participant in place — the server
 * always sends that participant's FULL current state (not a partial diff),
 * so there's no reducer/merge logic needed beyond "replace by studentId".
 *
 * Block/Pause/Unblock buttons emit `live_test_control` — see
 * socketHandler.js's `liveTestControl` handler, which relays the lock/
 * unlock to the student's own socket room and also echoes back a
 * `live_test_status_update` here for confirmation (so this component
 * doesn't need to optimistically update local state at all; it just waits
 * for the server's echo, same as how `live_test_response` updates work).
 *
 * `batches`/`allStudents` are the SAME already-fetched arrays TeacherDashboard
 * passes into LiveTestSetup — reused here (not re-fetched) so "Invite More
 * Students" can offer the exact same search/batch-checkbox experience as
 * the original setup flow, just scoped to a session that's already running.
 *
 * @param {{
 *   session: { sessionId, teacherId, testId, testTitle, module, participants: Array } | null,
 *   socket: import('socket.io-client').Socket | null,
 *   onBack: () => void,
 *   batches: Array, batchesLoading: boolean, batchesError: string|null,
 *   allStudents: Array, allStudentsLoading: boolean, allStudentsError: string|null,
 * }} props
 */
export default function LiveTestMonitor({
  session,
  socket,
  onBack,
  batches,
  batchesLoading,
  batchesError,
  allStudents,
  allStudentsLoading,
  allStudentsError,
}) {
  const [participants, setParticipants] = useState(() => session?.participants || []);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  // Mirrors session.status ('active' | 'completed') locally so "End Live
  // Session" can flip the UI the instant the server acks, without waiting
  // on a prop update from TeacherDashboard (which only ever hands this
  // component the session object it was started/reopened with).
  const [sessionStatus, setSessionStatus] = useState(() => session?.status || 'active');
  const [endingSession, setEndingSession] = useState(false);
  const [endSessionError, setEndSessionError] = useState(null);
  // Set once "End Live Session" (or another open tab/teacher ending the
  // same session — see the live_session_ended listener below) reports that
  // some students were still mid-test at that moment — see
  // socketHandler.js's endLiveSession, which auto force-submits them as
  // part of ending the session so their in-progress answers are captured
  // rather than abandoned.
  const [autoSubmitNotice, setAutoSubmitNotice] = useState(null);
  // Set when the server tells us a student's submission was graded but
  // failed to SAVE (a DB error mid-live-session — see routes/submissions.js's
  // 'live_test_submission_error' emit) — distinct from autoSubmitNotice
  // above, which is about End Session's own auto-force-submit, not a save
  // failure. The teacher needs to know to have that student retry, since
  // their row will otherwise just look like they never submitted at all.
  const [submissionErrorNotice, setSubmissionErrorNotice] = useState(null);
  // "View Report" modal state for a 'submitted' participant — fetches this
  // session's submissions (GET /api/submissions?liveSessionId=...) and
  // shows the one matching this studentId. { studentId, studentName,
  // loading, error, data } | null.
  const [reportModal, setReportModal] = useState(null);
  // Teacher-Gated Result Release — true while a "Publish Scorecard to
  // Student" click inside ReportModal is in flight (see publishReport
  // below), so its button can show "Publishing…" and disable itself.
  const [publishingReport, setPublishingReport] = useState(false);

  // Reset the local roster whenever a new session is handed in (i.e. a
  // fresh "Start Live Test" run, OR a resumed session handed off by
  // TeacherDashboard's openLiveTest — see toMonitorSession there) — this
  // component never straddles two sessions at once.
  useEffect(() => {
    setParticipants(enrichParticipants(session?.participants || [], allStudents));
    setInviteModalOpen(false);
    setInviteError(null);
    setSessionStatus(session?.status || 'active');
    setEndingSession(false);
    setEndSessionError(null);
    setAutoSubmitNotice(null);
    setSubmissionErrorNotice(null);
    setReportModal(null);
    // allStudents deliberately excluded — see the backfill effect right
    // below, which handles it separately so a LATE allStudents load
    // doesn't also reset inviteModalOpen/endSessionError/etc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.sessionId]);

  // Backfills names into a resumed session's roster once allStudents
  // finishes loading, without resetting any of the rest of this
  // component's local state (unlike the effect above) — this only ever
  // does anything the first time allStudents goes from empty to populated
  // right after a resume; enrichParticipants is a no-op once every
  // participant already has a name.
  useEffect(() => {
    if (allStudents.length === 0) return;
    setParticipants((prev) => enrichParticipants(prev, allStudents));
  }, [allStudents]);

  useEffect(() => {
    if (!socket || !session?.sessionId) return undefined;

    function handleStatusUpdate(update) {
      if (!update || update.sessionId !== session.sessionId) return;
      setParticipants((prev) =>
        prev.map((p) =>
          p.studentId === update.studentId
            ? { ...p, status: update.status, controls: update.controls }
            : p
        )
      );
    }

    socket.on('live_test_status_update', handleStatusUpdate);
    return () => socket.off('live_test_status_update', handleStatusUpdate);
  }, [socket, session?.sessionId]);

  // Keeps this monitor in sync if the session gets ended from elsewhere —
  // another open monitor tab, or a second teacher watching the same
  // session — same server-authoritative-broadcast principle as
  // live_test_status_update above (see socketHandler.js's endLiveSession).
  useEffect(() => {
    if (!socket || !session?.sessionId) return undefined;

    function handleSessionEnded(update) {
      if (!update || update.sessionId !== session.sessionId) return;
      setSessionStatus('completed');
      const n = update.autoSubmittedStudentIds?.length || 0;
      if (n > 0) setAutoSubmitNotice(autoSubmitMessage(n));
    }

    socket.on('live_session_ended', handleSessionEnded);
    return () => socket.off('live_session_ended', handleSessionEnded);
  }, [socket, session?.sessionId]);

  // A student's submission was graded but couldn't be SAVED (see
  // routes/submissions.js's POST handler, which emits this on a DB error) —
  // surfaced here so the teacher knows to have that specific student retry,
  // rather than the row silently staying stuck at 'joined'/whatever it last
  // was, which would otherwise look identical to "hasn't submitted yet".
  useEffect(() => {
    if (!socket || !session?.sessionId) return undefined;

    function handleSubmissionError(update) {
      if (!update || update.sessionId !== session.sessionId) return;
      setSubmissionErrorNotice(
        `${update.studentName || 'A student'}'s test was graded but couldn't be saved — ask them to click Retry.`
      );
    }

    socket.on('live_test_submission_error', handleSubmissionError);
    return () => socket.off('live_test_submission_error', handleSubmissionError);
  }, [socket, session?.sessionId]);

  function sendControl(studentId, control) {
    if (!socket || !session?.sessionId) return;
    socket.emit('live_test_control', { sessionId: session.sessionId, studentId, control });
  }

  // Pure relay server-side (see socketHandler.js's 'force_submit_test'
  // handler) — the student's own client performs the real submit through
  // its existing useExamTimer onForceSubmit -> submitTest path, same as the
  // pre-existing per-student force_submit button elsewhere in the app. No
  // optimistic local update here: the roster's `status` flips to
  // 'submitted' once the student's real POST succeeds and studentSubmitted
  // broadcasts live_test_status_update, same as every other status change
  // in this table.
  function sendForceSubmit(studentId) {
    if (!socket || !session?.sessionId) return;
    socket.emit('force_submit_test', { sessionId: session.sessionId, studentId });
  }

  // Explicit teacher signal that this broadcast is over — a real HTTP call
  // (PATCH /api/live-sessions/:id/end, see routes/liveSessions.js) rather
  // than a socket emit, so ending the session doesn't depend on this
  // teacher's socket still being connected at that exact instant. Flips
  // LiveSession.status to 'completed' directly in MongoDB, which is what
  // makes it show up as a finished record in TestRecord.jsx (whose search
  // now only lists status:'completed' sessions) and stop being eligible
  // for the strict-resume-gatekeeper's resync/disconnect-tracking queries.
  // Also performs a final consistency check server-side: anyone still
  // mid-test (status:'joined') gets automatically force-submitted as part
  // of ending the session, so nobody's in-progress answers are silently
  // abandoned just because the teacher closed the broadcast — see the
  // route's own doc comment. Individual participants who'd already
  // finished are untouched either way, so whatever their screen last
  // showed is exactly what TestRecord.jsx's summary table will read.
  async function endSession() {
    if (!session?.sessionId || sessionStatus === 'completed') return;
    // Ending is destructive-ish and irreversible from the teacher's side
    // (auto force-submits anyone still mid-test, then archives the session
    // as 'completed' — see the route doc comment below) — a stray/misclick
    // on this button previously had no confirmation step at all, unlike
    // every other one-way action in this table (Block, Force submit, etc.
    // are all at least deliberate per-student clicks). window.confirm is a
    // blocking native dialog, which is fine here: this click already isn't
    // part of any fast-moving realtime flow the way Pause/Unblock are.
    const confirmed = window.confirm(
      'Are you sure you want to end this live session? This will force-submit any active students and archive the record.'
    );
    if (!confirmed) return;
    // Debug aid — confirms the exact id this request is about to send,
    // straight from the browser console, without having to guess whether a
    // stale/undefined session prop was the cause of a failure.
    console.log('[live-test] End Live Session confirmed — sessionId:', session.sessionId);
    setEndingSession(true);
    setEndSessionError(null);
    try {
      const res = await fetch(`${API_URL}/api/live-sessions/${session.sessionId}/end`, {
        method: 'PATCH',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      // The backend now returns a specific reason (invalid id / session
      // deleted / belongs to a different account / etc. — see
      // routes/liveSessions.js's PATCH /:id/end) rather than one generic
      // string, so surfacing data?.error directly here is what makes that
      // distinction actually visible to the teacher instead of a flat
      // "failed to end" every time.
      if (!res.ok) throw new Error(data?.error || `Failed to end the live session (HTTP ${res.status}).`);
      setSessionStatus('completed');
      if (data.autoSubmittedCount > 0) setAutoSubmitNotice(autoSubmitMessage(data.autoSubmittedCount));
    } catch (err) {
      console.error('[live-test] End Live Session failed:', err);
      setEndSessionError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setEndingSession(false);
    }
  }

  // "View Report" — a 'submitted' participant's graded result, fetched from
  // the same GET /api/submissions?liveSessionId=... TestRecord.jsx's
  // per-session table already uses, filtered down to just this studentId.
  // Kept local to this component (rather than navigating away to
  // TestRecord) so a teacher can check one student's result without
  // leaving the live roster mid-session.
  async function viewReport(studentId, studentName) {
    setReportModal({ studentId, studentName, loading: true, error: null, data: null });
    try {
      const res = await fetch(`${API_URL}/api/submissions?liveSessionId=${encodeURIComponent(session.sessionId)}`, {
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to load report (HTTP ${res.status}).`);
      const match = (data.submissions || []).find((s) => String(s.student) === String(studentId));
      if (!match) throw new Error('No saved submission was found for this student yet — try again in a moment.');
      setReportModal((prev) => (prev?.studentId === studentId ? { ...prev, loading: false, data: match } : prev));
    } catch (err) {
      const message =
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message;
      setReportModal((prev) => (prev?.studentId === studentId ? { ...prev, loading: false, error: message } : prev));
    }
  }

  // Teacher-Gated Result Release — "Publish Scorecard to Student", reachable
  // from inside the report modal so a teacher can review AND release a
  // result in one place without leaving the live roster. Mirrors
  // TestRecord.jsx's own publishSubmission (same endpoint), just updating
  // reportModal.data.isPublished in place afterward instead of a table row.
  function publishReport() {
    const submissionId = reportModal?.data?._id;
    if (!submissionId) return;
    setPublishingReport(true);
    fetch(`${API_URL}/api/submissions/${submissionId}/publish`, {
      method: 'POST',
      headers: authHeaders(),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to publish (HTTP ${res.status}).`);
        setReportModal((prev) => (prev ? { ...prev, data: { ...prev.data, isPublished: true } } : prev));
      })
      .catch((err) => {
        alert(err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message);
      })
      .finally(() => setPublishingReport(false));
  }

  // studentsToInvite: full student objects (not just ids) — we already have
  // their name/email locally via `allStudents`, so the row can render
  // immediately rather than waiting on a second fetch/broadcast. The server
  // (see socketHandler.js's inviteMidSession) still independently dedupes
  // against the session's real roster and tells us via `addedStudentIds`
  // which ones actually landed — only those get appended locally, so a
  // student who (e.g.) was already re-added by a concurrent click doesn't
  // show up twice.
  function sendInvite(studentsToInvite) {
    if (!socket || !session?.sessionId || studentsToInvite.length === 0) return;
    setInviting(true);
    setInviteError(null);

    const studentIds = studentsToInvite.map((s) => s._id);
    socket.emit('invite_mid_session', { sessionId: session.sessionId, studentIds }, (ack) => {
      setInviting(false);
      if (!ack?.ok) {
        setInviteError(ack?.error || 'Failed to invite additional students.');
        return;
      }

      const addedIds = new Set((ack.addedStudentIds || []).map(String));
      const newParticipants = studentsToInvite
        .filter((s) => addedIds.has(String(s._id)))
        .map((s) => ({ studentId: s._id, studentName: s.name, studentEmail: s.email, status: 'invited', controls: 'active' }));

      if (newParticipants.length > 0) {
        setParticipants((prev) => [...prev, ...newParticipants]);
      }
      setInviteModalOpen(false);
    });
  }

  const joinedCount = participants.filter((p) => p.status === 'joined').length;
  const dismissedCount = participants.filter((p) => p.status === 'dismissed' || p.status === 'dismissed_timeout').length;
  const invitedCount = participants.filter((p) => p.status === 'invited').length;

  // Already-on-the-roster ids — the invite modal excludes these from both
  // search results and batch-checkbox expansion, so a teacher can't re-add
  // (and silently no-op reset to 'invited') someone who's mid-test.
  const existingStudentIds = useMemo(() => new Set(participants.map((p) => String(p.studentId))), [participants]);

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-neutral-50 text-neutral-500">
        <p className="text-sm">No live test session to monitor.</p>
        <button
          onClick={onBack}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-white"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-neutral-50">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
          >
            <IconArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <div className="h-6 w-px bg-neutral-200" />
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">{session.title || 'LIVE TEST — Monitoring'}</h1>
            <p className="text-xs text-neutral-500">
              {session.testTitle} · <span className="capitalize">{session.module}</span>
            </p>
          </div>
          {sessionStatus === 'completed' && (
            <span className="rounded-full border border-neutral-300 bg-neutral-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Session ended
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {joinedCount} joined
            </span>
            <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">
              {invitedCount} waiting
            </span>
            <span className="flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 px-3 py-1 text-neutral-500">
              {dismissedCount} dismissed
            </span>
          </div>
          {sessionStatus !== 'completed' && (
            <>
              <button
                type="button"
                onClick={() => setInviteModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-rose-700"
              >
                <IconUserPlus className="h-4 w-4" />
                Invite More Students
              </button>
              <button
                type="button"
                onClick={endSession}
                disabled={endingSession}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {endingSession ? 'Ending…' : 'End Live Session'}
              </button>
            </>
          )}
        </div>
      </div>

      {endSessionError && (
        <p className="border-b border-rose-200 bg-rose-50 px-6 py-2 text-sm text-rose-700">{endSessionError}</p>
      )}
      {autoSubmitNotice && (
        <p className="flex items-center justify-between gap-3 border-b border-sky-200 bg-sky-50 px-6 py-2 text-sm text-sky-700">
          <span>{autoSubmitNotice}</span>
          <button
            type="button"
            onClick={() => setAutoSubmitNotice(null)}
            className="shrink-0 text-xs font-medium text-sky-500 underline hover:text-sky-700"
          >
            Dismiss
          </button>
        </p>
      )}
      {submissionErrorNotice && (
        <p className="flex items-center justify-between gap-3 border-b border-rose-200 bg-rose-50 px-6 py-2 text-sm text-rose-700">
          <span>{submissionErrorNotice}</span>
          <button
            type="button"
            onClick={() => setSubmissionErrorNotice(null)}
            className="shrink-0 text-xs font-medium text-rose-500 underline hover:text-rose-700"
          >
            Dismiss
          </button>
        </p>
      )}

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl">
          {/* Teacher-Controlled Centralized Audio Player — Listening
              sessions only (the component itself also guards on
              session.module, so this outer check is just cheap short-circuit,
              not the only thing standing between it and rendering). */}
          {session.module === 'listening' && <AudioControlPanel session={session} socket={socket} />}

          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Controls</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {participants.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-neutral-400">
                      No students were invited to this session.
                    </td>
                  </tr>
                ) : (
                  participants.map((p) => {
                    const joined = p.status === 'joined';
                    const submitted = p.status === 'submitted';
                    return (
                      <tr key={p.studentId} className="align-middle">
                        <td className="px-4 py-3">
                          <p className="font-medium text-neutral-800">{p.studentName}</p>
                          <p className="text-xs text-neutral-400">{p.studentEmail}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[p.status] || STATUS_BADGE.invited}`}
                          >
                            {STATUS_LABEL[p.status] || p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${CONTROLS_BADGE[p.controls] || CONTROLS_BADGE.active}`}
                          >
                            {CONTROLS_LABEL[p.controls] || p.controls}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {submitted ? (
                              // Active "View Report" for anyone whose
                              // status flipped to 'submitted' (self-submit,
                              // teacher force-submit, or an End Session
                              // auto-submit — all funnel through the same
                              // studentSubmitted path server-side) — see
                              // viewReport() above.
                              <button
                                type="button"
                                onClick={() => viewReport(p.studentId, p.studentName)}
                                className="rounded-md border border-sky-500 px-2.5 py-1 text-xs font-medium text-sky-600 transition hover:bg-sky-50"
                              >
                                View Report
                              </button>
                            ) : !joined ? (
                              <span className="text-xs text-neutral-300">—</span>
                            ) : p.controls === 'disconnected' ? (
                              // Server-detected drop (socket disconnect or
                              // test_exited) — this is the ONLY action shown
                              // while disconnected, since Pause/Block/Force
                              // submit don't make sense against a student who
                              // isn't currently connected. Emits the exact
                              // same live_test_control event as Unblock,
                              // just with control:'resume' — see
                              // socketHandler.js's LIVE_CONTROL_TO_STATE,
                              // which maps both to controls:'active'.
                              <button
                                type="button"
                                onClick={() => sendControl(p.studentId, 'resume')}
                                className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-700"
                              >
                                Allow Resume
                              </button>
                            ) : (
                              <>
                                {p.controls !== 'paused' && (
                                  <button
                                    type="button"
                                    onClick={() => sendControl(p.studentId, 'pause')}
                                    className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                                  >
                                    Pause
                                  </button>
                                )}
                                {p.controls !== 'blocked' && (
                                  <button
                                    type="button"
                                    onClick={() => sendControl(p.studentId, 'block')}
                                    className="rounded-md bg-gray-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-gray-800"
                                  >
                                    Block
                                  </button>
                                )}
                                {p.controls !== 'active' && (
                                  <button
                                    type="button"
                                    onClick={() => sendControl(p.studentId, 'unblock')}
                                    className="rounded-md border border-emerald-300 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50"
                                  >
                                    Unblock
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => sendForceSubmit(p.studentId)}
                                  className="rounded-md border border-red-500 px-2.5 py-1 text-xs font-medium text-red-500 transition hover:bg-red-50"
                                >
                                  Force submit
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {inviteModalOpen && (
        <InviteMoreModal
          existingStudentIds={existingStudentIds}
          batches={batches}
          batchesLoading={batchesLoading}
          batchesError={batchesError}
          allStudents={allStudents}
          allStudentsLoading={allStudentsLoading}
          allStudentsError={allStudentsError}
          inviting={inviting}
          inviteError={inviteError}
          onClose={() => setInviteModalOpen(false)}
          onInvite={sendInvite}
        />
      )}

      {reportModal && (
        <ReportModal
          studentName={reportModal.studentName}
          loading={reportModal.loading}
          error={reportModal.error}
          data={reportModal.data}
          onClose={() => setReportModal(null)}
          onPublish={publishReport}
          publishing={publishingReport}
        />
      )}
    </div>
  );
}

/**
 * ReportModal
 * -----------
 * "View Report" for one submitted participant — same score/band + per-
 * question breakdown shape TestRecord.jsx's expanded row already uses,
 * just in a modal so the teacher doesn't have to leave the live roster.
 */
function ReportModal({ studentName, loading, error, data, onClose, onPublish, publishing }) {
  const sortedAnswers = Array.isArray(data?.answers)
    ? [...data.answers].sort((a, b) => (a?.questionNumber ?? 0) - (b?.questionNumber ?? 0))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">{studentName}'s report</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-neutral-400">Loading report…</p>
        ) : error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : (
          <>
            {/* Teacher-Gated Result Release — a teacher reviewing this
                report is exactly the moment they'd decide to release it,
                so the action lives right here rather than only back on
                TestRecord.jsx's table. */}
            <div
              className={`mb-4 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
                data.isPublished ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              <span className="font-medium">
                {data.isPublished
                  ? '✓ This scorecard is released — visible on the student\'s dashboard.'
                  : 'This scorecard is not visible to the student yet.'}
              </span>
              {!data.isPublished && (
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={publishing}
                  className="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishing ? 'Publishing…' : 'Publish Scorecard to Student'}
                </button>
              )}
            </div>

            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Score</p>
                <p className="mt-1 text-xl font-bold text-neutral-900">
                  {data.score}/{data.totalQuestions}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Band</p>
                <p className="mt-1 text-xl font-bold text-neutral-900">
                  {data.bandScore != null ? String(data.bandScore) : '—'}
                </p>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Submitted</p>
                <p className="mt-1 text-xs font-semibold text-neutral-700">
                  {data.submittedAt ? new Date(data.submittedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                </p>
              </div>
            </div>

            {sortedAnswers.length === 0 ? (
              <p className="text-sm text-neutral-400">No per-question answers were recorded.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-neutral-200">
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
          </>
        )}
      </div>
    </div>
  );
}

/**
 * InviteMoreModal
 * ---------------
 * Same search-a-student / check-a-whole-batch pattern as LiveTestSetup.jsx
 * Step 1, scoped down to a modal (this is mid-session, not a fresh setup
 * flow) and filtered against `existingStudentIds` so anyone already on the
 * session's roster never shows up as selectable again.
 */
function InviteMoreModal({
  existingStudentIds,
  batches,
  batchesLoading,
  batchesError,
  allStudents,
  allStudentsLoading,
  allStudentsError,
  inviting,
  inviteError,
  onClose,
  onInvite,
}) {
  const [search, setSearch] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);

  function toggleStudent(id) {
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleBatch(id) {
    setSelectedBatchIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return allStudents
      .filter((s) => !existingStudentIds.has(String(s._id)))
      .filter((s) => !selectedStudentIds.includes(s._id))
      .filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.email.toLowerCase().includes(q) ||
          (s.batchId?.name || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [search, allStudents, selectedStudentIds, existingStudentIds]);

  const individuallySelectedStudents = allStudents.filter((s) => selectedStudentIds.includes(s._id));

  const batchExpandedStudentIds = useMemo(
    () =>
      allStudents
        .filter((s) => selectedBatchIds.includes(s.batchId?._id) && !existingStudentIds.has(String(s._id)))
        .map((s) => s._id),
    [allStudents, selectedBatchIds, existingStudentIds]
  );

  const finalStudentIds = useMemo(
    () => Array.from(new Set([...selectedStudentIds, ...batchExpandedStudentIds])),
    [selectedStudentIds, batchExpandedStudentIds]
  );
  const finalStudents = allStudents.filter((s) => finalStudentIds.includes(s._id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">Invite more students</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-neutral-500">
          Newly added students get the live test prompt immediately — everyone already on the roster is unaffected.
        </p>

        <label htmlFor="invite-search" className="mb-1 block text-xs font-medium text-neutral-600">
          Search students by name or email
        </label>
        <div className="relative">
          <input
            id="invite-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students…"
            autoComplete="off"
            className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
          />
          {search.trim() && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
              {allStudentsLoading ? (
                <p className="px-3 py-2 text-sm text-neutral-400">Loading students…</p>
              ) : allStudentsError ? (
                <p className="px-3 py-2 text-sm text-rose-600">{allStudentsError}</p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-2 text-sm text-neutral-400">No matching students.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto">
                  {searchResults.map((s) => (
                    <li key={s._id}>
                      <button
                        type="button"
                        onClick={() => {
                          toggleStudent(s._id);
                          setSearch('');
                        }}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-neutral-50"
                      >
                        <span className="min-w-0">
                          <span className="font-medium text-neutral-800">{s.name}</span>
                          <span className="ml-2 text-xs text-neutral-400">{s.batchId?.name || 'No batch'}</span>
                        </span>
                        <span className="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
                          Add
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {individuallySelectedStudents.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">Selected:</span>
            {individuallySelectedStudents.map((s) => (
              <span
                key={s._id}
                className="flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-sm text-rose-800"
              >
                {s.name}
                <button
                  type="button"
                  onClick={() => toggleStudent(s._id)}
                  className="text-rose-500 transition hover:text-rose-800"
                  aria-label={`Remove ${s.name}`}
                >
                  <IconX />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-5">
          <label className="mb-1 block text-xs font-medium text-neutral-600">Or invite whole batches</label>
          {batchesLoading ? (
            <p className="text-sm text-neutral-400">Loading batches…</p>
          ) : batchesError ? (
            <p className="text-sm text-rose-600">{batchesError}</p>
          ) : batches.length === 0 ? (
            <p className="text-sm text-neutral-400">No batches exist yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {batches.map((b) => {
                const checked = selectedBatchIds.includes(b._id);
                // Only count students in this batch who AREN'T already on
                // the session's roster — otherwise checking a batch that's
                // mostly already invited would look like it's adding
                // everyone when most would silently no-op server-side.
                const count = allStudents.filter(
                  (s) => s.batchId?._id === b._id && !existingStudentIds.has(String(s._id))
                ).length;
                return (
                  <label
                    key={b._id}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                      checked
                        ? 'border-neutral-800 bg-neutral-800 text-white'
                        : 'border-neutral-300 text-neutral-700 hover:bg-neutral-50'
                    } ${count === 0 ? 'opacity-50' : ''}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleBatch(b._id)} className="sr-only" />
                    {b.name} <span className={checked ? 'text-neutral-300' : 'text-neutral-400'}>({count})</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {inviteError && (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{inviteError}</p>
        )}

        <div className="mt-6 flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-600">
            <span className="font-semibold text-neutral-900">{finalStudentIds.length}</span> student
            {finalStudentIds.length === 1 ? '' : 's'} will be invited
          </span>
          <button
            type="button"
            disabled={finalStudentIds.length === 0 || inviting}
            onClick={() => onInvite(finalStudents)}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {inviting ? 'Inviting…' : 'Send invites'}
          </button>
        </div>
      </div>
    </div>
  );
}
