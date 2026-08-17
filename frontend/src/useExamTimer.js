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
 * @param {{ studentId: string, studentName: string, teacherId: string, testId: string, durationSeconds: number }} params
 * @param {(reason: 'force_submit') => void} onForceSubmit — called when the teacher force-submits this student
 * @returns {{ label: string, timeRemaining: number, status: 'running'|'paused'|'time_up'|'overtime'|'submitted', connected: boolean }}
 */
export function useExamTimer({ studentId, studentName, teacherId, testId, durationSeconds }, onForceSubmit) {
  const [state, setState] = useState({
    label: '00:00',
    timeRemaining: durationSeconds,
    status: 'running',
    connected: false,
  });
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setState((s) => ({ ...s, connected: true }));
      // Server dedupes on studentId — a reconnect resyncs to the true
      // remaining time instead of restarting the clock.
      socket.emit('student:join', { studentId, studentName, teacherId, testId, durationSeconds });
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

    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  return state;
}