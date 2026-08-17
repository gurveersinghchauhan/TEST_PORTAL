/**
 * socketHandler.js
 * ----------------
 * Server-authoritative exam timers. Each student's remaining time lives
 * ONLY on the server (`activeSessions`); every client (student or teacher)
 * is just a display of whatever the server last broadcast. This means a
 * student can't cheat the clock by editing local state, and a page refresh
 * just re-syncs to the true server value on reconnect.
 *
 * Design note: rather than one setInterval per student (which gets heavy
 * with hundreds of concurrent sessions), a single global 1s interval walks
 * every active session and ticks the ones that are 'running' or 'overtime'.
 * Swap `activeSessions` for a Redis-backed store if you need this to scale
 * across multiple Node processes.
 */

/** @type {Map<string, Session>} keyed by studentId
 * Session = {
 *   studentId, studentName, teacherId, testId,
 *   timeRemaining: number,           // seconds; can go negative once in 'overtime'
 *   status: 'running'|'paused'|'time_up'|'overtime'|'submitted',
 *   studentSocketId: string|null,    // for direct emits; null if student is offline
 * }
 */
const activeSessions = new Map();

const ROOM_TEACHER = (teacherId) => `teacher:${teacherId}`;
const ROOM_STUDENT = (studentId) => `student:${studentId}`;

function formatLabel(seconds) {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const mm = String(Math.floor(abs / 60)).padStart(2, '0');
  const ss = String(abs % 60).padStart(2, '0');
  return `${sign}${mm}:${ss}`;
}

function publicSessionView(session) {
  return {
    studentId: session.studentId,
    studentName: session.studentName,
    timeRemaining: session.timeRemaining,
    label: formatLabel(session.timeRemaining),
    status: session.status,
  };
}

/** Push the latest state to the student themself and to their teacher's dashboard. */
function broadcastSession(io, session) {
  const payload = publicSessionView(session);
  io.to(ROOM_STUDENT(session.studentId)).emit('timer:update', payload);
  io.to(ROOM_TEACHER(session.teacherId)).emit('timer:update', payload);
}

/**
 * The single global tick. Runs every second for the lifetime of the process.
 */
function startGlobalTicker(io) {
  setInterval(() => {
    for (const session of activeSessions.values()) {
      if (session.status !== 'running' && session.status !== 'overtime') continue;

      session.timeRemaining -= 1;

      if (session.status === 'running' && session.timeRemaining <= 0) {
        // ---- Exact "zero" flow -------------------------------------
        session.timeRemaining = 0;
        session.status = 'time_up'; // pauses the tick — see the guard above
        broadcastSession(io, session);

        io.to(ROOM_TEACHER(session.teacherId)).emit('STUDENT_TIME_UP', {
          studentId: session.studentId,
          studentName: session.studentName,
        });
        continue;
      }

      // 'overtime' sessions are allowed to keep going past zero into negatives.
      broadcastSession(io, session);
    }
  }, 1000);
}

/* ---------------------------------------------------------------------- */
/* Teacher command handlers                                                */
/* ---------------------------------------------------------------------- */

function grantFixedTime(io, { studentId, seconds }) {
  const session = activeSessions.get(studentId);
  if (!session) return;

  session.timeRemaining = Math.max(0, Number(seconds) || 0);
  session.status = 'running';
  broadcastSession(io, session);
}

function allowOvertime(io, { studentId }) {
  const session = activeSessions.get(studentId);
  if (!session) return;

  session.status = 'overtime'; // tick resumes, now free to go negative
  broadcastSession(io, session);
}

function forceSubmit(io, { studentId }) {
  const session = activeSessions.get(studentId);
  if (!session) return;

  session.status = 'submitted';
  broadcastSession(io, session);
  io.to(ROOM_STUDENT(studentId)).emit('force_submit'); // client triggers its real submit-to-DB flow
  activeSessions.delete(studentId);
}

/* ---------------------------------------------------------------------- */
/* Socket.io wiring                                                        */
/* ---------------------------------------------------------------------- */

/**
 * @param {import('socket.io').Server} io
 */
function initSocketHandler(io) {
  startGlobalTicker(io);

  io.on('connection', (socket) => {
    // --- Student joins their own test session -----------------------
    // Called once when the student's TestInterface mounts (see useExamTimer).
    socket.on('student:join', ({ studentId, studentName, teacherId, testId, durationSeconds }) => {
      socket.join(ROOM_STUDENT(studentId));
      socket.data.studentId = studentId; // for cleanup on disconnect

      let session = activeSessions.get(studentId);
      if (!session) {
        // First time this student has connected for this test — start a fresh timer.
        session = {
          studentId,
          studentName,
          teacherId,
          testId,
          timeRemaining: durationSeconds,
          status: 'running',
          studentSocketId: socket.id,
        };
        activeSessions.set(studentId, session);
      } else {
        // Reconnect (e.g. page refresh) — resync socket id, keep true remaining time.
        session.studentSocketId = socket.id;
      }

      broadcastSession(io, session);
    });

    // --- Teacher joins their dashboard room ---------------------------
    socket.on('teacher:join', ({ teacherId }) => {
      socket.join(ROOM_TEACHER(teacherId));
      socket.data.teacherId = teacherId;

      // Immediately hydrate the dashboard with everyone currently active under this teacher.
      const mine = [...activeSessions.values()].filter((s) => s.teacherId === teacherId);
      socket.emit('timer:bulk_sync', mine.map(publicSessionView));
    });

    // --- Teacher controls ----------------------------------------------
    socket.on('GRANT_FIXED_TIME', (data) => grantFixedTime(io, data)); // { studentId, seconds }
    socket.on('ALLOW_OVERTIME', (data) => allowOvertime(io, data)); // { studentId }
    socket.on('FORCE_SUBMIT', (data) => forceSubmit(io, data)); // { studentId }

    // Teacher can also pause/resume the whole cohort — reuses the same session store.
    socket.on('teacher:pause', ({ studentId }) => {
      const session = activeSessions.get(studentId);
      if (session && session.status === 'running') {
        session.status = 'paused';
        broadcastSession(io, session);
      }
    });
    socket.on('teacher:resume', ({ studentId }) => {
      const session = activeSessions.get(studentId);
      if (session && session.status === 'paused') {
        session.status = 'running';
        broadcastSession(io, session);
      }
    });

    socket.on('disconnect', () => {
      const session = activeSessions.get(socket.data.studentId);
      if (session && session.studentSocketId === socket.id) {
        // Leave the timer running server-side — it keeps ticking while the
        // student is offline, same as a real exam clock would.
        session.studentSocketId = null;
      }
    });
  });
}

module.exports = { initSocketHandler, activeSessions };