import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

/**
 * useExamTimer
 * ------------
 * Connects to the socket server as a student and mirrors whatever the
 * server broadcasts for this student's session — this hook holds no
 * timing logic of its own, it's a pure display of server state.
 *
 * @param {{ studentId: string, studentName: string, teacherId: string, testId: string, testTitle: string, durationSeconds: number, liveSessionId?: string|null }} params
 * @param {(reason: 'force_submit'|'force_submit_test') => void} onForceSubmit — called when the teacher force-submits this student, either via the pre-existing per-student 'force_submit' (Live Timers panel) or the LIVE TEST feature's 'force_submit_test' (LiveTestMonitor.jsx's Force submit button) — same effect, different origin, so StudentTestPage's existing submitTest handler covers both with just a different `reason` string.
 * @returns {{ label: string, timeRemaining: number, status: 'running'|'paused'|'time_up'|'overtime'|'submitted', connected: boolean, audioState: {isPlaying: boolean, currentTime: number, updatedAt: number}|null, notifySubmitted: (liveSessionId?: string) => void, notifyExited: () => void }}
 */
export function useExamTimer({ studentId, studentName, teacherId, testId, testTitle, durationSeconds, liveSessionId = null }, onForceSubmit) {
  const [state, setState] = useState({
    label: '00:00',
    timeRemaining: durationSeconds,
    status: 'running',
    connected: false,
    // Teacher-Controlled Centralized Audio Player (Listening LIVE TEST
    // only) — a position anchor mirrored straight from the server's
    // 'audio:state' broadcast (see socketHandler.js's audioControl/
    // resyncAudioState and models/LiveSession.js's audioState field for the
    // "anchor, not a tick" rationale). null until the first 'audio:state'
    // arrives — TestInterface.jsx's LockedAudioPlayer reads that as
    // "waiting for the instructor," which is the correct default whether
    // this is a non-Listening live test (never gets one at all) or a
    // Listening one where the teacher hasn't pressed Play yet.
    audioState: null,
  });
  const socketRef = useRef(null);
  // Set the instant a legitimate submission goes out (see notifySubmitted
  // below) — notifyExited checks this so the "ghost session" unmount/
  // beforeunload handler in TestInterface.jsx never misreports a normal
  // "student finished and the page is now navigating away" as an exit.
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    // forceNew: true — see useLiveTestChannel.js's identical option for the
    // full rationale (React 18 StrictMode's dev-only double-invoke of
    // effects can otherwise hand a remounted hook a socket entangled with
    // the previous mount's in-flight disconnect instead of a clean
    // connection).
    // auth.token — see useLiveTestChannel.js's identical option for the
    // full rationale (carries the same JWT already used for REST calls so
    // backend/socketHandler.js's socketAuthMiddleware can verify identity
    // on the handshake).
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: localStorage.getItem('auth_token') },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setState((s) => ({ ...s, connected: true }));
      // Server dedupes on studentId — a reconnect resyncs to the true
      // remaining time instead of restarting the clock.
      socket.emit('student:join', { studentId, studentName, teacherId, testId, testTitle, durationSeconds });

      // Centralized audio (Listening LIVE TEST only) — joins the
      // per-session room and immediately asks the server for the current
      // position anchor (see socketHandler.js's 'audio:join_session'
      // handler / resyncAudioState). This 'connect' handler re-fires on
      // every reconnect (network blip, tab backgrounded then foregrounded),
      // which is exactly what makes "a student reconnects mid-test snaps
      // back to the live position" (requirement 3) work for free — no
      // separate reconnect-specific code path needed. Harmless no-op for a
      // non-live practice attempt (liveSessionId null) or a non-Listening
      // live test (the server simply never has an audioState to send back).
      if (liveSessionId) {
        socket.emit('audio:join_session', { sessionId: liveSessionId });
      }
    });

    socket.on('disconnect', () => {
      setState((s) => ({ ...s, connected: false }));
    });

    // The one event that drives all of this hook's state — status included,
    // so 'time_up' / 'overtime' propagate straight through to the UI.
    socket.on('timer:update', (payload) => {
      if (payload.studentId !== studentId) return;
      setState((s) => ({
        ...s,
        label: payload.label,
        timeRemaining: payload.timeRemaining,
        status: payload.status,
      }));
    });

    socket.on('force_submit', () => {
      onForceSubmit?.('force_submit');
    });

    // LIVE TEST's own force-submit — see socketHandler.js's plain relay of
    // this event (teacher -> server -> this specific student's room). Kept
    // as a distinct event name from 'force_submit' above per spec, but
    // wired to the exact same callback so StudentTestPage doesn't need a
    // second code path to actually perform the submit.
    socket.on('force_submit_test', () => {
      onForceSubmit?.('force_submit_test');
    });

    // The one event that drives the centralized audio player — see
    // socketHandler.js's audioControl (a live push from the teacher) and
    // resyncAudioState (the reply to 'audio:join_session' above). Guarded
    // on sessionId the same way 'timer:update' guards on studentId, since
    // this socket only ever joined ONE session's ROOM_LIVE_SESSION.
    socket.on('audio:state', (payload) => {
      if (!liveSessionId || payload.sessionId !== liveSessionId) return;
      setState((s) => ({
        ...s,
        audioState: {
          isPlaying: payload.isPlaying,
          currentTime: payload.currentTime,
          updatedAt: payload.updatedAt,
        },
      }));
    });

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, liveSessionId]);

  // Tells the server this student has submitted their own test (as opposed
  // to being force-submitted by the teacher) — flips the live session to
  // 'submitted' server-side so the Teacher Dashboard's status/timer stop
  // showing 'running'. Call this once the real POST /api/submissions
  // succeeds. `liveSessionId` (StudentTestPage.jsx's own prop — omit for a
  // plain practice-test submission) lets the server target that EXACT
  // LiveSession by _id rather than guessing via "whichever active session
  // has this student joined" — see socketHandler.js's studentSubmitted,
  // which needs that precision for a submission that lands just after the
  // teacher has already ended the session (an auto force-submit — see
  // endLiveSession).
  function notifySubmitted(liveSessionId) {
    hasSubmittedRef.current = true;
    socketRef.current?.emit('student:submitted', { studentId, liveSessionId: liveSessionId || null });
  }

  // "Ghost session" fix — called from TestInterface.jsx's unmount/
  // beforeunload handler. A no-op once notifySubmitted has already fired
  // (a legit Submit unmounts TestInterface too, right after; without this
  // guard that normal transition would look identical to the student
  // actually disconnecting/navigating away mid-test, and the Teacher
  // Monitor would incorrectly flip a just-finished student to
  // 'disconnected' — see socketHandler.js's markStudentDisconnected).
  function notifyExited() {
    if (hasSubmittedRef.current) return;
    socketRef.current?.emit('test_exited', { studentId });
  }

  return { ...state, notifySubmitted, notifyExited };
}