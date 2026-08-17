import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

/**
 * TeacherDashboard
 * ----------------
 * Subscribes to every linked student's live timer and pops the
 * "time up" modal the instant the server reports a student hit zero.
 *
 * @param {{ teacherId: string }} props
 */
export default function TeacherDashboard({ teacherId }) {
  const [sessions, setSessions] = useState({}); // studentId -> { studentId, studentName, label, timeRemaining, status }
  const [timeUpQueue, setTimeUpQueue] = useState([]); // students currently showing the notification modal
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('teacher:join', { teacherId });
    });

    // Initial hydrate for anyone already mid-test when the dashboard opens.
    socket.on('timer:bulk_sync', (list) => {
      setSessions(Object.fromEntries(list.map((s) => [s.studentId, s])));
    });

    // Every subsequent tick / status change for any of this teacher's students.
    socket.on('timer:update', (payload) => {
      setSessions((prev) => ({ ...prev, [payload.studentId]: payload }));
    });

    // The moment a student's clock hits zero.
    socket.on('STUDENT_TIME_UP', ({ studentId, studentName }) => {
      setTimeUpQueue((prev) =>
        prev.some((s) => s.studentId === studentId) ? prev : [...prev, { studentId, studentName }]
      );
    });

    return () => socket.disconnect();
  }, [teacherId]);

  function dismissModal(studentId) {
    setTimeUpQueue((prev) => prev.filter((s) => s.studentId !== studentId));
  }

  function grantFixedTime(studentId, minutes) {
    socketRef.current.emit('GRANT_FIXED_TIME', { studentId, seconds: minutes * 60 });
    dismissModal(studentId);
  }

  function allowOvertime(studentId) {
    socketRef.current.emit('ALLOW_OVERTIME', { studentId });
    dismissModal(studentId);
  }

  function forceSubmit(studentId) {
    socketRef.current.emit('FORCE_SUBMIT', { studentId });
    dismissModal(studentId);
  }

  const studentList = Object.values(sessions).sort((a, b) => a.studentName.localeCompare(b.studentName));

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Live student timers</h1>

      <div className="overflow-hidden rounded border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-2 font-medium">Student</th>
              <th className="px-4 py-2 font-medium">Time remaining</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Controls</th>
            </tr>
          </thead>
          <tbody>
            {studentList.map((s) => (
              <StudentRow
                key={s.studentId}
                session={s}
                onPause={() => socketRef.current.emit('teacher:pause', { studentId: s.studentId })}
                onResume={() => socketRef.current.emit('teacher:resume', { studentId: s.studentId })}
                onForceSubmit={() => forceSubmit(s.studentId)}
              />
            ))}
            {studentList.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  No students currently in a test.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* One modal per queued time-up event — stacked if several students hit zero close together. */}
      {timeUpQueue.map((s) => (
        <TimeUpModal
          key={s.studentId}
          studentName={s.studentName}
          onGrantFixedTime={(minutes) => grantFixedTime(s.studentId, minutes)}
          onAllowOvertime={() => allowOvertime(s.studentId)}
          onForceSubmit={() => forceSubmit(s.studentId)}
        />
      ))}
    </div>
  );
}

function StudentRow({ session, onPause, onResume, onForceSubmit }) {
  const statusStyles = {
    running: 'text-green-700 bg-green-50',
    paused: 'text-neutral-600 bg-neutral-100',
    time_up: 'text-rose-700 bg-rose-50',
    overtime: 'text-amber-700 bg-amber-50',
    submitted: 'text-neutral-400 bg-neutral-50',
  };

  return (
    <tr className="border-t border-neutral-200">
      <td className="px-4 py-2">{session.studentName}</td>
      <td className={`px-4 py-2 font-mono ${session.status === 'overtime' ? 'text-red-600' : ''}`}>
        {session.label}
      </td>
      <td className="px-4 py-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusStyles[session.status]}`}>
          {session.status.replace('_', ' ')}
        </span>
      </td>
      <td className="px-4 py-2">
        <div className="flex gap-2">
          {session.status === 'running' && (
            <button onClick={onPause} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50">
              Pause
            </button>
          )}
          {session.status === 'paused' && (
            <button onClick={onResume} className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50">
              Resume
            </button>
          )}
          {session.status !== 'submitted' && (
            <button onClick={onForceSubmit} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50">
              Force submit
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * TimeUpModal
 * -----------
 * The exact 3-option flow the teacher sees the instant a student's
 * timer reaches zero.
 */
function TimeUpModal({ studentName, onGrantFixedTime, onAllowOvertime, onForceSubmit }) {
  const [minutes, setMinutes] = useState(5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Time's up</h2>
        <p className="mb-5 text-sm text-neutral-600">
          Student <span className="font-medium text-neutral-900">{studentName}</span> has run out of time.
        </p>

        <div className="space-y-3">
          {/* Option 1 — Add fixed time */}
          <div className="flex items-center gap-2 rounded border border-neutral-200 p-3">
            <input
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-16 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
            <span className="text-sm text-neutral-600">minutes</span>
            <button
              onClick={() => onGrantFixedTime(minutes)}
              className="ml-auto rounded bg-neutral-800 px-3 py-1.5 text-sm text-white hover:bg-neutral-900"
            >
              Add fixed time
            </button>
          </div>

          {/* Option 2 — Allow overtime */}
          <button
            onClick={onAllowOvertime}
            className="w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
          >
            Allow overtime (no limit, counts into negatives)
          </button>

          {/* Option 3 — Force submit */}
          <button
            onClick={onForceSubmit}
            className="w-full rounded border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100"
          >
            Force submit exam
          </button>
        </div>
      </div>
    </div>
  );
}