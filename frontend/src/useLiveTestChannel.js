import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

// How long a student has to respond to an incoming_live_test prompt before
// it's treated as a timeout — see the effect below and
// socketHandler.js's LIVE_RESPONSE_TO_STATUS['dismissed_timeout'].
const INVITE_TIMEOUT_SECONDS = 120;

/**
 * useLiveTestChannel
 * -------------------
 * The student-side half of the LIVE TEST feature (see backend/socketHandler.js's
 * 'initiate_live_test'/'live_test_response'/'live_test_control'). Owns its
 * own socket connection, separate from useExamTimer's — that hook only
 * exists once a student is already inside a test (StudentTestPage), but a
 * live test invite has to reach a student BEFORE that, while they're just
 * sitting on their dashboard. This hook is meant to be called once, high up
 * in App.jsx (the only component that stays mounted across the student's
 * whole session — see that file), so it can:
 *
 *   1. Register the student's presence (join their socket room) the moment
 *      they log in, regardless of which screen they're on.
 *   2. Surface an incoming_live_test prompt as `incomingLiveTest` whenever
 *      one arrives, for App.jsx to render a modal over.
 *   3. Track any live_test_control the teacher applies (or the server's own
 *      resync on every (re)connect — see socketHandler.js's
 *      resyncStudentLiveTestState) as `liveTestLock` — non-null exactly
 *      when the student is currently locked out of their live test by
 *      something other than 'active' ('paused', 'blocked', or
 *      'disconnected'). `liveControlStatus` is the same thing flattened to
 *      just the control string, for StudentTestPage.jsx's existing
 *      in-place overlay; `liveTestLock` carries the full session/test
 *      context too, for App.jsx's App-level lock screen — the case where
 *      the student isn't even inside StudentTestPage anymore (browser back
 *      button, hard refresh) and has no other way to know they're still
 *      locked. This is the "strict resume gatekeeper": it only ever clears
 *      when the SERVER says control is 'active' again (a teacher's
 *      explicit "Allow Resume"/"Unblock") — a student simply reconnecting
 *      does NOT clear it on its own; the resync above pushes back
 *      whatever's still persisted, disconnected included.
 *
 * @param {string|undefined} studentId
 * @returns {{
 *   incomingLiveTest: { sessionId, teacherId, teacherName, testId, testTitle, module } | null,
 *   respond: (choice: 'join'|'dismiss') => void,
 *   liveControlStatus: 'active'|'paused'|'blocked'|'disconnected',
 *   liveTestLock: { sessionId, testId, testTitle, module, control: 'paused'|'blocked'|'disconnected' } | null,
 *   inviteSecondsLeft: number,
 * }}
 */
export function useLiveTestChannel(studentId) {
  const [incomingLiveTest, setIncomingLiveTest] = useState(null);
  // null = unlocked ('active'). Non-null = currently locked, with full
  // session/test context — see the doc comment above.
  const [liveTestLock, setLiveTestLock] = useState(null);
  // Counts down from INVITE_TIMEOUT_SECONDS purely for App.jsx's modal to
  // display — the actual auto-dismiss below is driven by its own
  // setTimeout, not by this reaching 0, so a dropped/throttled interval
  // tick (e.g. a backgrounded tab) can never delay the real timeout.
  const [inviteSecondsLeft, setInviteSecondsLeft] = useState(INVITE_TIMEOUT_SECONDS);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!studentId) return undefined;

    // forceNew: true — without it, socket.io-client caches/reuses a Manager
    // (and can hand back the SAME underlying Socket) for repeat io(SOCKET_URL, ...)
    // calls with identical options. That collides badly with React 18
    // StrictMode's dev-only double-invoke of effects (mount → cleanup →
    // mount again, synchronously): the first mount's cleanup calls
    // socket.disconnect() on a connection that may still be mid-handshake,
    // and without forceNew the SECOND mount's io() call could get handed
    // back a socket tangled up in that same teardown instead of a clean
    // independent connection — so 'connect' never (reliably) fires, this
    // hook's presence registration never goes out, the student's socket is
    // never actually in ROOM_STUDENT(studentId), and 'incoming_live_test'
    // silently has nowhere to land even though the server-side emit runs
    // and the teacher's ack/monitor looks completely normal. forceNew makes
    // every hook instance/remount get its own dedicated Engine.IO
    // connection, so this can't happen.
    // auth.token — the same JWT every REST call already sends via
    // apiAuth.js's authHeaders() (localStorage 'auth_token'), now also
    // carried on the Socket.IO handshake so the server can verify identity
    // there too (see backend/socketHandler.js's socketAuthMiddleware). A
    // connection with a missing/invalid/expired token is refused at the
    // handshake — the client's 'connect' handler below simply never fires
    // for it; nothing else in this hook needed to change.
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      forceNew: true,
      auth: { token: localStorage.getItem('auth_token') },
    });
    socketRef.current = socket;

    function registerPresence() {
      socket.emit('student:register_presence', { studentId });
    }

    // Covers every case: first connect, and any reconnect after a dropped
    // connection (server restart, network blip) — the server has no
    // memory of a previous socket's room membership, so this has to run
    // again every single time 'connect' fires, not just once.
    socket.on('connect', registerPresence);
    // Extra safety net for the (rare) case where this effect's listeners
    // are attached to a socket that's already connected by the time we
    // get here — 'connect' won't fire again on its own in that case.
    if (socket.connected) registerPresence();

    socket.on('incoming_live_test', (payload) => {
      setIncomingLiveTest(payload);
    });

    // Fires both for a live push from the teacher AND for the server's own
    // resync on every (re)connect (see socketHandler.js's
    // resyncStudentLiveTestState / the 'student:join' and
    // 'student:register_presence' handlers that call it) — same event,
    // same shape, so one handler covers both. A student only ever has one
    // live test open at a time, so there's no sessionId cross-check needed
    // here; whatever arrives is simply the current truth.
    socket.on('live_test_control', (payload) => {
      const { control } = payload || {};
      if (control === 'active') {
        setLiveTestLock(null);
      } else if (control === 'paused' || control === 'blocked' || control === 'disconnected') {
        setLiveTestLock({
          sessionId: payload.sessionId,
          testId: payload.testId,
          testTitle: payload.testTitle,
          module: payload.module,
          control,
        });
      }
    });

    return () => socket.disconnect();
  }, [studentId]);

  // 2-minute auto-dismissal: if the student neither joins nor dismisses an
  // incoming_live_test prompt within INVITE_TIMEOUT_SECONDS, treat it as a
  // timeout — emit live_test_response with 'dismissed_timeout' (a distinct
  // status from an explicit 'dismiss', so LiveTestMonitor.jsx can show
  // "Timeout" rather than implying the student actively declined) and
  // close the modal automatically. Keyed to the prompt's own sessionId (not
  // just "is there a prompt") so a brand new prompt arriving right after an
  // old one resolves always gets its own fresh 120s window, never one that
  // inherited an already-elapsed countdown.
  useEffect(() => {
    if (!incomingLiveTest) {
      setInviteSecondsLeft(INVITE_TIMEOUT_SECONDS);
      return undefined;
    }

    const sessionId = incomingLiveTest.sessionId;
    setInviteSecondsLeft(INVITE_TIMEOUT_SECONDS);

    const tickId = setInterval(() => {
      setInviteSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    const timeoutId = setTimeout(() => {
      socketRef.current?.emit('live_test_response', {
        sessionId,
        studentId,
        response: 'dismissed_timeout',
      });
      setIncomingLiveTest(null);
    }, INVITE_TIMEOUT_SECONDS * 1000);

    return () => {
      clearInterval(tickId);
      clearTimeout(timeoutId);
    };
  }, [incomingLiveTest?.sessionId, studentId]);

  // Answers the incoming prompt and clears it locally — the modal is gone
  // the instant the student picks either option, regardless of whether the
  // server round trip has completed yet (fire-and-forget, matching how the
  // rest of this app's socket commands work — see socketHandler.js's
  // documented "no ack required" trust model).
  function respond(choice) {
    if (!incomingLiveTest) return;
    socketRef.current?.emit('live_test_response', {
      sessionId: incomingLiveTest.sessionId,
      studentId,
      response: choice, // 'join' | 'dismiss'
    });
    setIncomingLiveTest(null);
  }

  // Flattened for StudentTestPage.jsx's existing overlay, which only ever
  // needs the control string, not the full session/test context.
  const liveControlStatus = liveTestLock?.control || 'active';

  return { incomingLiveTest, respond, liveControlStatus, liveTestLock, inviteSecondsLeft };
}
