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
 *
 * SOCKET AUTHENTICATION & TENANT ISOLATION (Phase 3)
 * ----------------------------------------------------
 * Every connection is authenticated at the handshake — see
 * socketAuthMiddleware/verifySocketToken below, wired via `io.use(...)` in
 * initSocketHandler. It verifies the SAME JWT every REST route already
 * trusts (same jsonwebtoken library, same process.env.JWT_SECRET, same
 * decoded { id, role, instituteId } shape as middleware/auth.js's
 * requireAuth) — this is not a second auth system, just that same
 * verification adapted to Socket.IO's handshake instead of an Express
 * request. A socket that fails this never reaches 'connection' at all, so
 * every handler below can assume `socket.user` is always present.
 *
 * From there, every handler follows two rules:
 *   1. Identity comes from socket.user.id / socket.user.role, NEVER from a
 *      client-supplied studentId/teacherId used to claim "who is asking."
 *      A client-supplied id is only ever a TARGET (whose session to act
 *      on), never an identity claim.
 *   2. Every resource read/write is scoped to socket.user.instituteId
 *      (LiveSession queries add `instituteId`/`teacherId` to their filter;
 *      the in-memory `activeSessions` timer sessions carry `instituteId`,
 *      stamped from the authenticated student's own JWT at student:join
 *      time, so teacher-control actions can check it with no extra DB
 *      round trip). A request that doesn't match simply matches nothing —
 *      the exact same "unknown resource" no-op every one of these handlers
 *      already used before this pass, just now also true for "exists, but
 *      not yours."
 * See requireSocketRole/logRejected for the (non-sensitive) security
 * logging on every rejected attempt.
 */

const jwt = require('jsonwebtoken');
const LiveSession = require('./models/LiveSession');
const User = require('./models/User');
const { resolveTenantInstituteId } = require('./utils/resolveInstitute');

/** @type {Map<string, Session>} keyed by studentId
 * Session = {
 *   studentId, studentName, teacherId, testId, testTitle,
 *   instituteId,                     // tenant scope, stamped from the authenticated student's own JWT at student:join time — see socketAuthMiddleware
 *   timeRemaining: number,           // seconds; can go negative once in 'overtime'
 *   status: 'running'|'paused'|'time_up'|'overtime'|'submitted'|'blocked',
 *   studentSocketId: string|null,    // for direct emits; null if student is offline
 * }
 */
const activeSessions = new Map();

const ROOM_TEACHER = (teacherId) => `teacher:${teacherId}`;
const ROOM_STUDENT = (studentId) => `student:${studentId}`;
// One room per LIVE TEST session, joined by BOTH roles — every student
// whose TestInterface locked player wants live audio sync, and the
// teacher's own LiveTestMonitor.jsx panel(s) — see 'audio:join_session'
// below. Distinct from ROOM_TEACHER/ROOM_STUDENT (which are per-USER, not
// per-session) because the centralized audio player needs to reach
// everyone currently watching THIS session in one emit, without a DB read
// to enumerate participants on every single play/pause/seek.
const ROOM_LIVE_SESSION = (sessionId) => `live-session:${sessionId}`;

/* ---------------------------------------------------------------------- */
/* Socket authentication & authorization helpers (Phase 3)                 */
/* ---------------------------------------------------------------------- */

/**
 * Pulls the bearer token off a Socket.IO handshake and verifies it exactly
 * the way middleware/auth.js's requireAuth verifies one for a REST
 * request — same jsonwebtoken call, same JWT_SECRET, same decoded shape.
 * Accepts it from `auth.token` (the standard socket.io-client v4 handshake
 * option — see the frontend's io(SOCKET_URL, { auth: { token } }) calls)
 * or, as a fallback, an `Authorization: Bearer <token>` handshake header,
 * so either client convention works. Throws on anything wrong (missing,
 * malformed, expired, bad signature) — the caller (socketAuthMiddleware)
 * turns that into a clean handshake rejection.
 */
function verifySocketToken(socket) {
  const fromAuth = socket.handshake.auth && socket.handshake.auth.token;
  const authHeader = socket.handshake.headers && socket.handshake.headers.authorization;
  const fromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = fromAuth || fromHeader;
  if (!token) {
    throw new Error('No token provided.');
  }
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  return { id: String(decoded.id), role: decoded.role, instituteId: decoded.instituteId ? String(decoded.instituteId) : null };
}

/**
 * Socket.IO connection middleware (registered via `io.use(...)` in
 * initSocketHandler) — runs once per connection attempt, BEFORE the
 * 'connection' event fires. Calling `next(err)` here makes Socket.IO
 * refuse the handshake outright: the client gets a 'connect_error', no
 * 'connection' ever fires server-side, and none of the event handlers
 * below ever run for that socket — so every reference to `socket.user`
 * anywhere in this file can safely assume it's already set.
 */
function socketAuthMiddleware(socket, next) {
  try {
    socket.user = verifySocketToken(socket);
    next();
  } catch (err) {
    // Never log the token itself — only that a connection attempt was
    // rejected and why (message only, e.g. "jwt expired"/"invalid
    // signature"/"No token provided.").
    console.warn(`[socket-auth] rejected connection from ${socket.handshake.address}: ${err.message}`);
    next(new Error('Authentication required.'));
  }
}

/**
 * Concise, non-sensitive rejection logging for an authenticated socket
 * that tried an action it isn't allowed to perform (wrong role, or a
 * resource outside its own institute). Never logs tokens, passwords, or
 * anything beyond the caller's own id/role (already-verified, non-secret
 * identifiers — the same things routes/liveSessions.js already logs for
 * REST denials) and the event/reason.
 */
function logRejected(socket, event, reason) {
  console.warn(
    `[socket-auth] rejected '${event}' from user=${socket.user?.id || 'unknown'} role=${socket.user?.role || 'unknown'}: ${reason}`
  );
}

/**
 * Role gate for one event. Returns true and does nothing when socket.user's
 * role is one of `roles`; otherwise logs the rejection and returns false so
 * the caller can bail out (and, where an ack exists, respond with the
 * existing { ok: false, error } shape — see each socket.on(...) below).
 */
function requireSocketRole(socket, event, ...roles) {
  if (!socket.user || !roles.includes(socket.user.role)) {
    logRejected(socket, event, `requires role ${roles.join(' or ')}`);
    return false;
  }
  return true;
}

/**
 * Shared gate for the exam-timer teacher commands (GRANT_FIXED_TIME,
 * ALLOW_OVERTIME, FORCE_SUBMIT, teacher:pause/resume/block/unblock) — all
 * of them look up `activeSessions.get(studentId)` and mutate it in place.
 * Requires role 'teacher', and — once a session exists — that its
 * `instituteId` (stamped from the STUDENT's own JWT at student:join time)
 * matches the calling teacher's own institute. A missing session is left
 * exactly as much of a no-op as it always was (nothing to act on); a
 * cross-institute session is now ALSO a no-op, logged, rather than silently
 * succeeding the way it used to for any connected teacher socket.
 */
function authorizeTeacherSessionAction(socket, event, studentId) {
  if (!requireSocketRole(socket, event, 'teacher')) return null;
  const session = activeSessions.get(studentId);
  if (!session) return null;
  if (session.instituteId && String(session.instituteId) !== String(socket.user.instituteId)) {
    logRejected(socket, event, `session for student ${studentId} belongs to a different institute`);
    return null;
  }
  return session;
}

/**
 * The ONE place a socket actually joins a student's room — used by both
 * 'student:join' (entering a real test) and 'student:register_presence'
 * (just sitting on the dashboard, for the LIVE TEST invite prompt). Having
 * two call sites independently call socket.join(...) was a real drift risk
 * (one could silently diverge from the other, e.g. forgetting the
 * socket.data.studentId assignment that 'disconnect' cleanup relies on) —
 * this collapses them onto one path so there's exactly one thing to get
 * right. `studentId` is always socket.user.id by the time this is called
 * (see the two call sites below) — never a client-supplied value. Logged
 * so a student's browser console (client-side) and the server's own
 * console can be cross-checked against each other when diagnosing "the
 * student never got the incoming_live_test prompt".
 */
function joinStudentRoom(socket, studentId, via) {
  if (!studentId) return;
  socket.join(ROOM_STUDENT(studentId));
  socket.data.studentId = studentId; // read by 'disconnect' cleanup below
  console.log(`[live-test] socket ${socket.id} joined ${ROOM_STUDENT(studentId)} (via ${via})`);
}

/**
 * Diagnostic-only: how many sockets are actually sitting in a student's
 * room RIGHT NOW. Used immediately before every incoming_live_test emit so
 * a "the invite never showed up" report is trivial to diagnose from the
 * server console alone — a count of 0 means the emit had strictly nowhere
 * to go (student not connected / never registered presence yet), which is
 * a completely different problem than the event reaching the client but
 * the UI failing to render it.
 */
function studentRoomSize(io, studentId) {
  return io.sockets.adapter.rooms.get(ROOM_STUDENT(studentId))?.size || 0;
}

/**
 * "Strict resume gatekeeper" — the piece that makes a disconnected/blocked/
 * paused student STAY locked even after they reconnect (browser back
 * button, hard refresh, flaky wifi reconnecting) instead of the lock
 * silently clearing just because a fresh socket showed up. Called every
 * time a student's socket (re)joins their room — see joinStudentRoom's two
 * call sites below — so if they currently have a 'joined' participant
 * entry on some active LiveSession, we push them the CURRENT authoritative
 * controls value (whatever it is: 'active', 'paused', 'blocked', or
 * 'disconnected') over live_test_control, the exact same event a live push
 * from the teacher uses. A student who was 'disconnected' and simply
 * reconnects gets told 'disconnected' right back — only a teacher's
 * explicit "Allow Resume" (LIVE_CONTROL_TO_STATE.resume) actually changes
 * the persisted value.
 *
 * Includes testId/testTitle/module (not just sessionId/control) because,
 * unlike a live push (which always arrives while some component that
 * already has that context is mounted), this can fire while the student is
 * sitting on their dashboard with NO local memory of which test/session
 * this even refers to — App.jsx's lock screen needs those fields to render
 * anything meaningful and to know what to re-fetch once resumed.
 */
async function resyncStudentLiveTestState(io, socket, studentId) {
  if (!studentId) return;
  try {
    const session = await LiveSession.findOne({
      status: 'active',
      'participants.studentId': studentId,
      'participants.status': 'joined',
    }).sort({ createdAt: -1 });
    if (!session) return;

    const participant = session.participants.find((p) => String(p.studentId) === String(studentId));
    if (!participant) return;

    socket.emit('live_test_control', {
      sessionId: String(session._id),
      control: participant.controls,
      testId: String(session.testId),
      testTitle: session.testTitle || '',
      module: session.module,
    });
  } catch (err) {
    console.error('resyncStudentLiveTestState failed:', err);
  }
}

/**
 * The "ghost session" fix's write side — flips a student's LIVE TEST
 * participant `controls` to 'disconnected' the moment their connection
 * genuinely goes away (native socket 'disconnect') or their client
 * proactively says so (the 'test_exited' beforeunload/unmount signal from
 * TestInterface.jsx). The query itself is the safety net: it only ever
 * matches a participant whose `status` is 'joined' on a still-`active`
 * session, so this is a safe no-op for a student who (a) was never in a
 * live test, (b) only got as far as 'invited'/'dismissed', or (c) already
 * finished normally (studentSubmitted flips them to 'submitted' first,
 * specifically to make this a no-op afterward — see that function and the
 * schema comment on liveParticipantSchema's status enum).
 */
async function markStudentDisconnected(io, studentId) {
  if (!studentId) return;
  try {
    const session = await LiveSession.findOneAndUpdate(
      { status: 'active', 'participants.studentId': studentId, 'participants.status': 'joined' },
      { $set: { 'participants.$.controls': 'disconnected' } },
      { returnDocument: 'after' }
    );
    if (!session) return; // not currently mid a live test — nothing to flag

    console.log(`[live-test] student ${studentId} marked disconnected in session ${session._id}`);
    io.to(ROOM_TEACHER(session.teacherId)).emit('live_test_status_update', {
      sessionId: String(session._id),
      studentId,
      status: 'joined',
      controls: 'disconnected',
    });
  } catch (err) {
    console.error('markStudentDisconnected failed:', err);
  }
}

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
    // Included so the Teacher Dashboard's "View Report" button knows which
    // test to look up (GET /api/submissions?student=...&test=...) once a
    // session's status flips to 'submitted'.
    testId: session.testId,
    // Shown next to the student's name on the Live Timers view.
    testTitle: session.testTitle || '',
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

        // Reaches the owning teacher's dashboard room AND any other teacher
        // who has this student pinned to their watchlist (they joined
        // ROOM_STUDENT(studentId) via 'teacher:watch_student' below). The
        // student's own client is also in that room but doesn't listen for
        // this event, so it's a no-op for them.
        io.to(ROOM_TEACHER(session.teacherId))
          .to(ROOM_STUDENT(session.studentId))
          .emit('STUDENT_TIME_UP', {
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

/**
 * A student submitting their own test (clicking Submit, not teacher-forced)
 * never went through forceSubmit(), so nothing told the live session to stop
 * ticking / flip to 'submitted' — the Teacher Dashboard kept showing
 * 'running' forever even after the graded submission was saved to Mongo.
 * The client calls this once its POST /api/submissions succeeds (both a
 * plain self-submit AND the LIVE TEST 'force_submit_test' relay funnel
 * through the same submitTest() -> notifySubmitted() path client-side, so
 * this one handler covers both). `studentId` is always socket.user.id by
 * the time this is called — see the 'student:submitted' listener below.
 *
 * Also closes out the student's LIVE TEST participation, if any: flips
 * their `status` to 'submitted' on the LiveSession where they're currently
 * 'joined'. This isn't just bookkeeping — it's what makes
 * markStudentDisconnected's status:'joined' query correctly ignore them
 * afterward, so a stray test_exited/native disconnect right after a normal
 * finish (the browser tab closing a moment after Submit, say) can't
 * misreport a student who just finished as 'disconnected'.
 *
 * `liveSessionId` (from StudentTestPage.jsx's own `liveSessionId` prop —
 * see useExamTimer.js's notifySubmitted) targets this EXACT session by
 * _id when the client has one, rather than guessing via `status: 'active'`
 * + "whichever session has this student 'joined'". That precision matters
 * for endLiveSession's auto-force-submit below: a student it force-submits
 * completes their POST, and this handler's update, AFTER the session has
 * already flipped to 'completed' — a `status: 'active'` filter would miss
 * that and leave their participant record stuck at 'joined' forever even
 * though their Submission was correctly saved. Falls back to the old
 * status:'active' guess for a client that didn't send one (a stale build,
 * or a genuinely non-live submission, for which this is harmlessly a
 * no-op either way).
 */
async function studentSubmitted(io, { studentId, liveSessionId } = {}) {
  const session = activeSessions.get(studentId);
  if (session) {
    session.status = 'submitted';
    broadcastSession(io, session);
    activeSessions.delete(studentId);
  }

  if (!studentId) return;
  try {
    const query = liveSessionId
      ? { _id: liveSessionId, 'participants.studentId': studentId, 'participants.status': 'joined' }
      : { status: 'active', 'participants.studentId': studentId, 'participants.status': 'joined' };
    const liveSession = await LiveSession.findOneAndUpdate(
      query,
      { $set: { 'participants.$.status': 'submitted' } },
      { returnDocument: 'after' }
    );
    if (!liveSession) return; // not a live-test attempt — nothing more to do

    const participant = liveSession.participants.find((p) => String(p.studentId) === String(studentId));
    io.to(ROOM_TEACHER(liveSession.teacherId)).emit('live_test_status_update', {
      sessionId: String(liveSession._id),
      studentId,
      status: 'submitted',
      controls: participant?.controls || 'active',
    });
  } catch (err) {
    console.error('studentSubmitted (live-test) failed:', err);
  }
}

/* ---------------------------------------------------------------------- */
/* LIVE TEST — teacher-initiated broadcast test invites                    */
/*                                                                          */
/* A separate, self-contained feature from the exam-timer activeSessions   */
/* above: a LiveSession is a teacher's live "join this test now" broadcast */
/* to a specific list of students, persisted in Mongo (see                 */
/* models/LiveSession.js) rather than the in-memory Map, since invite/     */
/* response/control history is worth keeping past a server restart. It     */
/* does not touch activeSessions at all — a student who joins a live test  */
/* still goes through the normal 'student:join' flow once their            */
/* TestInterface actually mounts, same as any other test attempt.          */
/* ---------------------------------------------------------------------- */

// Maps the client's plain-language choice to the persisted enum value —
// kept as a lookup rather than trusting the client to send the enum
// directly, so a typo'd payload can't write something outside
// liveParticipantSchema's enum.
const LIVE_RESPONSE_TO_STATUS = { join: 'joined', dismiss: 'dismissed', dismissed_timeout: 'dismissed_timeout' };
// 'resume' is LiveTestMonitor.jsx's "Allow Resume" button — deliberately
// mapped to the SAME 'active' value 'unblock' already uses (both are "let
// the student's screen unlock"), so the strict resume gatekeeper reuses
// this one handler/event rather than needing a parallel code path. The
// only functional difference between 'unblock' and 'resume' is which
// button the teacher saw (Unblock only ever shows for 'paused'/'blocked';
// Allow Resume only ever shows for 'disconnected' — see LiveTestMonitor.jsx).
const LIVE_CONTROL_TO_STATE = { pause: 'paused', block: 'blocked', unblock: 'active', resume: 'active' };

/**
 * Teacher hits "Start Live Test": persists a new LiveSession with every
 * selected student as 'invited', then pushes the prompt to each of them.
 * `callback` is a socket.io ack — LiveTestSetup.jsx uses it to get the new
 * session's id back synchronously and navigate straight to the monitor
 * page, instead of needing a second round trip to look it up.
 *
 * `teacherId` is always socket.user.id by the time this runs (see the
 * 'initiate_live_test' listener below, which requires role 'teacher' and
 * overwrites whatever teacherId the client sent) — never a client-supplied
 * identity claim. `studentIds` ARE client-supplied targets, so they're
 * filtered down to real students in the caller's own institute before
 * anything is created — see the tenant-isolation block below.
 */
async function initiateLiveTest(io, socket, { teacherId, teacherName, studentIds, testId, testTitle, title, module } = {}, callback) {
  const ack = typeof callback === 'function' ? callback : () => {};
  try {
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    if (!teacherId || !testId || !module || !Array.isArray(studentIds) || studentIds.length === 0 || !trimmedTitle) {
      return ack({
        ok: false,
        error: 'teacherId, testId, module, a live test title, and a non-empty studentIds array are required.',
      });
    }

    // Server-side institute resolution, unchanged from before this pass —
    // ROOT CAUSE of the old "Live session not found" bug (see git history /
    // the models/LiveSession.js comment): create() never used to set
    // instituteId, so it silently fell back to null on every LIVE TEST ever
    // started. resolveTenantInstituteId does a lookup by teacherId since
    // that's what's available here, not a full req.user.
    const instituteId = await resolveTenantInstituteId({ id: teacherId });
    if (!instituteId) {
      console.warn(
        `[live-test] initiate_live_test: could not resolve an instituteId for teacher ${teacherId} — this session will be created with instituteId: null, which fails the required-instituteId schema (see models/LiveSession.js) and rejects the whole request below. Check that this teacher's User document has instituteId set.`
      );
    }

    // Phase 3 addition: teacherId is now always the AUTHENTICATED caller's
    // own id (never client input — see the listener below), so this should
    // always already match socket.user.instituteId. Checking anyway is
    // cheap defense-in-depth against a stale JWT (issued before an
    // institute reassignment) rather than trusting that equality blindly.
    if (instituteId && socket.user.instituteId && String(instituteId) !== String(socket.user.instituteId)) {
      logRejected(socket, 'initiate_live_test', 'resolved instituteId does not match the authenticated teacher\'s own institute');
      return ack({ ok: false, error: 'Your account is not linked to an institute tenant. Please log out and back in, then try again.' });
    }

    // Tenant isolation: studentIds are client-supplied TARGETS, never an
    // identity claim, so they must be ownership-validated — only real
    // students belonging to the SAME institute as the caller may be
    // invited. A stray/spoofed id from another institute is silently
    // dropped (and logged) rather than rejecting the whole request, so a
    // legitimate multi-select invite still goes through for everyone who
    // DOES belong here.
    const validStudents = await User.find({
      _id: { $in: studentIds },
      role: 'student',
      instituteId: socket.user.instituteId,
    }).select('_id');
    const validStudentIds = validStudents.map((s) => String(s._id));
    if (validStudentIds.length < studentIds.length) {
      logRejected(
        socket,
        'initiate_live_test',
        `${studentIds.length - validStudentIds.length} of ${studentIds.length} studentId(s) were not students in the caller's own institute and were dropped`
      );
    }
    if (validStudentIds.length === 0) {
      return ack({ ok: false, error: 'None of the selected students belong to your institute.' });
    }

    const session = await LiveSession.create({
      teacherId,
      teacherName: teacherName || '',
      title: trimmedTitle,
      testId,
      testTitle: testTitle || '',
      module,
      participants: validStudentIds.map((studentId) => ({ studentId, status: 'invited', controls: 'active' })),
      instituteId,
    });

    const sessionId = String(session._id);
    // Deliberately does NOT include `title` — the incoming_live_test prompt
    // this reaches students with only ever says "Live test started by
    // [Teacher Name]" (see App.jsx), with no test or session details
    // exposed. `title` is teacher-facing only; it comes back in this
    // function's ack below, for LiveTestSetup.jsx/LiveTestMonitor.jsx.
    const payload = { sessionId, teacherId, teacherName: teacherName || '', testId, testTitle: testTitle || '', module };

    // Strictly targeted: ROOM_STUDENT(studentId) only ever has that
    // student's own socket(s) in it (see the room-per-user convention at
    // the top of this file — 'student:join' and 'student:register_presence'
    // below are the only two places anything joins it), so this reaches
    // exactly the invited (and now tenant-validated) students and no one
    // else.
    validStudentIds.forEach((studentId) => {
      const memberCount = studentRoomSize(io, studentId);
      if (memberCount === 0) {
        console.warn(
          `[live-test] initiate_live_test: student ${studentId} has no connected socket in ${ROOM_STUDENT(studentId)} right now — they will not see this prompt until they're online (logged in with the dashboard/app open). This is expected for an offline student; if they ARE online and this still logs, check that their client actually emitted student:register_presence (see useLiveTestChannel.js).`
        );
      } else {
        console.log(`[live-test] initiate_live_test: emitting incoming_live_test to ${ROOM_STUDENT(studentId)} (${memberCount} connected socket(s))`);
      }
      io.to(ROOM_STUDENT(studentId)).emit('incoming_live_test', payload);
    });

    ack({ ok: true, sessionId, teacherId, title: trimmedTitle, testId, testTitle: testTitle || '', module });
  } catch (err) {
    console.error('initiate_live_test failed:', err);
    ack({ ok: false, error: 'Failed to start the live test.' });
  }
}

/**
 * Teacher hits "End Live Session" from LiveTestMonitor.jsx — the explicit
 * signal that this broadcast is over. Flips LiveSession.status to
 * 'completed', which:
 *   1. Makes it show up as a finished record in TestRecord.jsx (rather than
 *      mixed in with sessions still in progress).
 *   2. Takes it out of consideration for resyncStudentLiveTestState /
 *      markStudentDisconnected above, both of which only ever match
 *      `status: 'active'` — a completed session no longer pushes
 *      lock-state resyncs or flags disconnects for its participants.
 *
 * Final check / real-time auto-save, finalized: before flipping the status,
 * this snapshots every participant still `status: 'joined'` (still mid-test
 * — connected and actively working, paused, blocked, or even
 * server-detected 'disconnected') and auto force-submits each of them —
 * the exact same 'force_submit_test' relay the per-student "Force submit"
 * button uses, so whatever they'd answered so far gets permanently written
 * to Submission right now instead of being silently abandoned the moment
 * this broadcast closes. A disconnected student simply has nowhere to
 * deliver the relay to and this is a harmless no-op for them, same as any
 * other command aimed at an offline socket; they lose nothing they weren't
 * already going to lose by not being connected when the session ended.
 *
 * Does NOT touch individual participants' `controls` — only `status`, for
 * whoever gets auto-submitted above (and only once their actual submission
 * lands — see studentSubmitted, which now targets this exact sessionId
 * rather than requiring `status: 'active'`, specifically so a late-arriving
 * auto-submission still correctly finalizes their record after this
 * function has already flipped the session to 'completed'). Everyone else's
 * roster entry stays exactly as it last was, which is what TestRecord.jsx's
 * summary table reads.
 *
 * Phase 3 addition: only the session's own owning teacher (teacherId match)
 * or an institute-role caller from the same institute (instituteId match)
 * may end it — same ownership model routes/liveSessions.js's REST
 * counterpart (PATCH /:id/end) already enforces, mirrored here so ending a
 * session behaves identically whether it comes in over REST or the socket.
 *
 * NOTE: LiveTestMonitor.jsx no longer calls this over the socket — "End
 * Live Session" now goes through the REST counterpart, PATCH
 * /api/live-sessions/:id/end (see routes/liveSessions.js), specifically so
 * ending a session doesn't depend on the teacher's socket still being
 * connected at that exact moment. Left in place (same snapshot/flip/
 * auto-force-submit logic, kept in sync with the REST version) in case
 * anything else still emits 'end_live_session' directly.
 */
async function endLiveSession(io, socket, { sessionId } = {}, callback) {
  const ack = typeof callback === 'function' ? callback : () => {};
  try {
    if (!sessionId) return ack({ ok: false, error: 'sessionId is required.' });

    // Snapshot BEFORE flipping status — this is the "final check" pass:
    // exactly who still needs to be force-submitted so their result is
    // consistent and finalized once this broadcast closes.
    const before = await LiveSession.findById(sessionId);
    if (!before) return ack({ ok: false, error: 'This live session no longer exists.' });

    const denied =
      socket.user.role === 'teacher'
        ? String(before.teacherId) !== String(socket.user.id)
        : String(before.instituteId) !== String(socket.user.instituteId);
    if (denied) {
      logRejected(socket, 'end_live_session', `caller does not own session ${sessionId}`);
      return ack({ ok: false, error: 'This live session does not belong to your account.' });
    }

    const stillInProgress = before.participants.filter((p) => p.status === 'joined');

    const session = await LiveSession.findByIdAndUpdate(
      sessionId,
      { $set: { status: 'completed' } },
      { returnDocument: 'after' }
    );

    stillInProgress.forEach((p) => {
      io.to(ROOM_STUDENT(p.studentId)).emit('force_submit_test', { sessionId: String(session._id) });
    });
    if (stillInProgress.length > 0) {
      console.log(
        `[live-test] end_live_session: auto force-submitting ${stillInProgress.length} still-in-progress student(s) for session ${session._id}`
      );
    }

    // Broadcast (not just ack) so a second open monitor tab / teacher
    // watching the same session also flips to the ended state, same
    // "server-authoritative, every open client syncs" principle as
    // live_test_status_update above.
    io.to(ROOM_TEACHER(session.teacherId)).emit('live_session_ended', {
      sessionId: String(session._id),
      autoSubmittedStudentIds: stillInProgress.map((p) => String(p.studentId)),
    });
    ack({
      ok: true,
      sessionId: String(session._id),
      status: 'completed',
      autoSubmittedCount: stillInProgress.length,
    });
  } catch (err) {
    console.error('end_live_session failed:', err);
    ack({ ok: false, error: 'Failed to end the live session.' });
  }
}

/**
 * Student answers the incoming_live_test prompt ('join' or 'dismiss').
 * Persists their response, then tells the teacher's dashboard immediately.
 * live_test_status_update always carries the participant's FULL current
 * state (status + controls) rather than just the field that changed, so
 * the teacher's client can simply overwrite its local copy of that
 * participant by studentId — liveTestControl below reuses the exact same
 * event/shape for that reason, giving the monitor one unified handler.
 *
 * `studentId` is always socket.user.id by the time this runs (see the
 * listener below) — never a client-supplied identity claim. Tenant
 * isolation folds straight into the existing lookup query (adding
 * `instituteId: socket.user.instituteId` to the filter) rather than a
 * separate check — a session from another institute, or one this student
 * isn't actually a participant of, simply matches nothing, same "unknown
 * session" no-op this handler already had.
 */
async function liveTestResponse(io, socket, { sessionId, studentId, response } = {}) {
  const status = LIVE_RESPONSE_TO_STATUS[response];
  if (!sessionId || !studentId || !status) return;

  try {
    const session = await LiveSession.findOneAndUpdate(
      { _id: sessionId, instituteId: socket.user.instituteId, 'participants.studentId': studentId },
      { $set: { 'participants.$.status': status, 'participants.$.respondedAt': new Date() } },
      { returnDocument: 'after' }
    );
    if (!session) {
      logRejected(socket, 'live_test_response', `session ${sessionId} not found in caller's own institute, or caller is not a participant`);
      return;
    }

    const participant = session.participants.find((p) => String(p.studentId) === String(studentId));
    io.to(ROOM_TEACHER(session.teacherId)).emit('live_test_status_update', {
      sessionId,
      studentId,
      status: participant?.status || status,
      controls: participant?.controls || 'active',
    });
  } catch (err) {
    console.error('live_test_response failed:', err);
  }
}

/**
 * Teacher pauses/blocks/unblocks/allow-resumes one student's live test from
 * LiveTestMonitor.jsx. Persists the new `controls` value, relays it
 * straight to the student (StudentTestPage.jsx locks/unlocks a full-screen
 * overlay on top of TestInterface when it receives this — TestInterface
 * itself is left running underneath so no in-progress answers are lost;
 * App.jsx does the equivalent at the dashboard level for a student who
 * isn't currently inside TestInterface at all — see its lock screen), and
 * echoes the same live_test_status_update liveTestResponse uses so every
 * open teacher tab/monitor stays in sync — server-authoritative, the same
 * principle broadcastSession() above already follows rather than trusting
 * client-side optimism.
 *
 * The emitted live_test_control payload carries testId/testTitle/module
 * alongside sessionId/control, not just because resyncStudentLiveTestState
 * needs them (see that function) — keeping this event's shape identical
 * whether it's a live push or a resync means the client only needs ONE
 * handler for both.
 *
 * Phase 3 addition: `studentId` is a TARGET, ownership-validated the same
 * way endLiveSession validates `sessionId` — teacher must own the session
 * (teacherId match) or be an institute-role caller from the same institute
 * (instituteId match), folded directly into the update's filter so a
 * cross-institute or cross-teacher attempt simply matches nothing.
 */
async function liveTestControl(io, socket, { sessionId, studentId, control } = {}) {
  const controlsValue = LIVE_CONTROL_TO_STATE[control];
  if (!sessionId || !studentId || !controlsValue) return;

  try {
    const ownerFilter = socket.user.role === 'teacher' ? { teacherId: socket.user.id } : { instituteId: socket.user.instituteId };
    const session = await LiveSession.findOneAndUpdate(
      { _id: sessionId, ...ownerFilter, 'participants.studentId': studentId },
      { $set: { 'participants.$.controls': controlsValue } },
      { returnDocument: 'after' }
    );
    if (!session) {
      logRejected(socket, 'live_test_control', `session ${sessionId} not owned by caller, or student ${studentId} not a participant`);
      return;
    }

    io.to(ROOM_STUDENT(studentId)).emit('live_test_control', {
      sessionId,
      control: controlsValue,
      testId: String(session.testId),
      testTitle: session.testTitle || '',
      module: session.module,
    });

    const participant = session.participants.find((p) => String(p.studentId) === String(studentId));
    io.to(ROOM_TEACHER(session.teacherId)).emit('live_test_status_update', {
      sessionId,
      studentId,
      status: participant?.status || 'invited',
      controls: controlsValue,
    });
  } catch (err) {
    console.error('live_test_control failed:', err);
  }
}

/**
 * Teacher hits "Invite More Students" from LiveTestMonitor.jsx mid-session.
 * Appends new participants to the EXISTING LiveSession (rather than
 * creating a second one), then pushes incoming_live_test ONLY to the
 * newly added students — every student already on the roster (joined,
 * dismissed, dismissed_timeout, or still sitting on the original prompt)
 * never receives this event again, so nothing about their in-progress
 * test or pending invite is touched.
 *
 * Dedupes against both the session's existing roster and duplicates
 * within the incoming list itself, so re-clicking / a flaky double-submit
 * can't invite the same student twice or overwrite their real progress
 * with a fresh 'invited' entry. `callback` is a socket.io ack —
 * LiveTestMonitor.jsx uses it to learn exactly which ids were actually
 * new (as opposed to silently skipped) so it can merge its local roster
 * without a full session re-fetch.
 *
 * Phase 3 additions: the session itself is ownership-checked (same
 * teacherId/instituteId model as endLiveSession/liveTestControl) before
 * anything is appended, and every incoming studentId is filtered down to
 * real students in the caller's own institute, same tenant-isolation
 * treatment initiateLiveTest gives its original invite list.
 */
async function inviteMidSession(io, socket, { sessionId, studentIds } = {}, callback) {
  const ack = typeof callback === 'function' ? callback : () => {};
  try {
    if (!sessionId || !Array.isArray(studentIds) || studentIds.length === 0) {
      return ack({ ok: false, error: 'sessionId and a non-empty studentIds array are required.' });
    }

    const session = await LiveSession.findById(sessionId);
    if (!session) {
      return ack({ ok: false, error: 'This live session no longer exists.' });
    }

    const denied =
      socket.user.role === 'teacher'
        ? String(session.teacherId) !== String(socket.user.id)
        : String(session.instituteId) !== String(socket.user.instituteId);
    if (denied) {
      logRejected(socket, 'invite_mid_session', `caller does not own session ${sessionId}`);
      return ack({ ok: false, error: 'This live session does not belong to your account.' });
    }

    const existingIds = new Set(session.participants.map((p) => String(p.studentId)));
    const requestedIds = [...new Set(studentIds.map(String))].filter((id) => !existingIds.has(id));

    const validStudents = requestedIds.length
      ? await User.find({ _id: { $in: requestedIds }, role: 'student', instituteId: socket.user.instituteId }).select('_id')
      : [];
    const newIds = validStudents.map((s) => String(s._id));
    if (newIds.length < requestedIds.length) {
      logRejected(
        socket,
        'invite_mid_session',
        `${requestedIds.length - newIds.length} studentId(s) were not students in the caller's own institute and were dropped`
      );
    }

    if (newIds.length === 0) {
      // Not an error — every requested student was either already on the
      // roster, or filtered out as not belonging to this institute.
      return ack({ ok: true, sessionId, addedStudentIds: [] });
    }

    newIds.forEach((studentId) => {
      session.participants.push({ studentId, status: 'invited', controls: 'active' });
    });
    await session.save();

    const payload = {
      sessionId,
      teacherId: session.teacherId,
      teacherName: session.teacherName || '',
      testId: session.testId,
      testTitle: session.testTitle || '',
      module: session.module,
    };
    newIds.forEach((studentId) => {
      const memberCount = studentRoomSize(io, studentId);
      if (memberCount === 0) {
        console.warn(
          `[live-test] invite_mid_session: student ${studentId} has no connected socket in ${ROOM_STUDENT(studentId)} right now — they will not see this prompt until they're online.`
        );
      } else {
        console.log(`[live-test] invite_mid_session: emitting incoming_live_test to ${ROOM_STUDENT(studentId)} (${memberCount} connected socket(s))`);
      }
      io.to(ROOM_STUDENT(studentId)).emit('incoming_live_test', payload);
    });

    ack({ ok: true, sessionId, addedStudentIds: newIds });
  } catch (err) {
    console.error('invite_mid_session failed:', err);
    ack({ ok: false, error: 'Failed to invite additional students.' });
  }
}

/**
 * Teacher-Controlled Centralized Audio Player (Listening LIVE TEST only) —
 * play/pause/seek/switch-part from LiveTestMonitor.jsx's audio panel.
 * Persists a single position anchor onto the LiveSession (see
 * models/LiveSession.js's audioState field for the full "why an anchor,
 * not a tick" rationale) and broadcasts it to ROOM_LIVE_SESSION(sessionId)
 * — every joined student's locked player (TestInterface.jsx) AND any other
 * open teacher tab watching this same session, all in one emit.
 *
 * Deliberately does NOT iterate session.participants and emit to each
 * ROOM_STUDENT individually the way initiateLiveTest/endLiveSession do for
 * their (much rarer) broadcasts — play/pause/seek can fire many times a
 * minute, so paying for a participants array walk plus N separate emits on
 * every single action would be wasteful; ROOM_LIVE_SESSION exists
 * specifically so this is one Mongo write + one emit, full stop.
 *
 * Phase 3 addition: the session must belong to the caller (teacherId match
 * for a teacher, instituteId match for an institute-role caller) — folded
 * into the update filter itself, same pattern as liveTestControl.
 */
async function audioControl(io, socket, { sessionId, partNumber, isPlaying, currentTime } = {}) {
  if (!sessionId || partNumber == null || typeof currentTime !== 'number') return;

  try {
    const updatedAt = new Date();
    const audioState = { partNumber, isPlaying: Boolean(isPlaying), currentTime, updatedAt };

    const ownerFilter = socket.user.role === 'teacher' ? { teacherId: socket.user.id } : { instituteId: socket.user.instituteId };
    const session = await LiveSession.findOneAndUpdate({ _id: sessionId, ...ownerFilter }, { $set: { audioState } });
    if (!session) {
      logRejected(socket, 'audio:control', `session ${sessionId} not owned by caller`);
      return;
    }

    io.to(ROOM_LIVE_SESSION(sessionId)).emit('audio:state', {
      sessionId,
      partNumber,
      isPlaying: audioState.isPlaying,
      currentTime,
      updatedAt: updatedAt.getTime(),
    });
  } catch (err) {
    console.error('audio:control failed:', err);
  }
}

/**
 * Late-join / reconnect resync for the centralized audio player — the
 * audio counterpart to resyncStudentLiveTestState above, but pushed to ONE
 * socket (whichever one just asked, via 'audio:join_session' below) rather
 * than broadcast to the room. Used by BOTH roles: a student whose
 * TestInterface mounts (or reconnects) mid-broadcast needs to snap straight
 * to the live position instead of starting silent at 0:00 — requirement 3
 * of the centralized-audio feature — and a teacher who reloads
 * LiveTestMonitor.jsx mid-session needs their panel to reflect whatever was
 * last playing rather than resetting to a blank, paused-at-zero player.
 *
 * Silently no-ops if this session has no audioState yet (a Listening
 * session where the teacher hasn't pressed Play for the first time, or any
 * non-Listening session, which never gets one at all) — the caller's UI
 * already defaults to "waiting for the instructor" with nothing to sync to.
 * Membership is checked by the caller ('audio:join_session' below) before
 * this ever runs, so no ownership check is repeated here.
 */
async function resyncAudioState(socket, sessionId) {
  if (!sessionId) return;
  try {
    const session = await LiveSession.findById(sessionId).select('audioState');
    if (!session?.audioState?.updatedAt) return;

    socket.emit('audio:state', {
      sessionId,
      partNumber: session.audioState.partNumber,
      isPlaying: session.audioState.isPlaying,
      currentTime: session.audioState.currentTime,
      updatedAt: session.audioState.updatedAt.getTime(),
    });
  } catch (err) {
    console.error('resyncAudioState failed:', err);
  }
}

/* ---------------------------------------------------------------------- */
/* Socket.io wiring                                                        */
/* ---------------------------------------------------------------------- */

/**
 * @param {import('socket.io').Server} io
 */
function initSocketHandler(io) {
  // Phase 3: authenticate every connection at the handshake, before
  // 'connection' ever fires — see socketAuthMiddleware's own doc comment.
  io.use(socketAuthMiddleware);

  startGlobalTicker(io);

  io.on('connection', (socket) => {
    console.log(
      `[socket-auth] connected: socket=${socket.id} user=${socket.user.id} role=${socket.user.role} instituteId=${socket.user.instituteId || 'none'}`
    );

    // --- Student joins their own test session -----------------------
    // Called once when the student's TestInterface mounts (see useExamTimer).
    // Identity is ALWAYS socket.user.id — the client's own `studentId` field
    // (kept in the payload shape for backward compatibility) is ignored.
    socket.on('student:join', async ({ studentName, teacherId, testId, testTitle, durationSeconds } = {}) => {
      if (!requireSocketRole(socket, 'student:join', 'student')) return;
      const studentId = socket.user.id;

      // Tenant check on the supplied teacherId — it decides which teacher's
      // dashboard room receives this student's live ticks (ROOM_TEACHER
      // below), so it must belong to the SAME institute as the
      // authenticated student, never blindly trusted the way it used to be.
      if (teacherId) {
        try {
          const teacher = await User.findById(teacherId).select('instituteId role');
          if (!teacher || String(teacher.instituteId) !== String(socket.user.instituteId)) {
            logRejected(socket, 'student:join', `teacherId ${teacherId} is not in the caller's own institute`);
            return;
          }
        } catch (err) {
          logRejected(socket, 'student:join', `failed to verify teacherId: ${err.message}`);
          return;
        }
      }

      joinStudentRoom(socket, studentId, 'student:join');
      // Strict resume gatekeeper — see resyncStudentLiveTestState's own
      // doc comment. Covers "student reconnects mid-test after a network
      // blip" (this handler re-fires on every 'connect', including
      // auto-reconnects — see useExamTimer.js) as well as "student
      // navigates straight back into a test they were disconnected from".
      resyncStudentLiveTestState(io, socket, studentId);

      let session = activeSessions.get(studentId);
      if (!session) {
        // First time this student has connected for this test — start a fresh timer.
        session = {
          studentId,
          studentName,
          teacherId,
          testId,
          testTitle,
          instituteId: socket.user.instituteId,
          timeRemaining: durationSeconds,
          status: 'running',
          studentSocketId: socket.id,
        };
        activeSessions.set(studentId, session);
      } else {
        // Reconnect (e.g. page refresh) — resync socket id + test title, keep true remaining time.
        session.studentSocketId = socket.id;
        session.testTitle = testTitle;
        session.instituteId = socket.user.instituteId;
      }

      broadcastSession(io, session);
    });

    // --- Live presence (student is on their dashboard, not in a test yet) --
    // A lighter sibling of 'student:join' above: joins the SAME
    // ROOM_STUDENT(studentId) room but does NOT touch activeSessions/the
    // exam timer at all — this is what lets a student sitting on their
    // dashboard (see useLiveTestChannel.js) still receive an
    // 'incoming_live_test' prompt before they've ever started a test.
    // Identity is always socket.user.id.
    socket.on('student:register_presence', () => {
      if (!requireSocketRole(socket, 'student:register_presence', 'student')) return;
      const studentId = socket.user.id;
      joinStudentRoom(socket, studentId, 'student:register_presence');
      // Strict resume gatekeeper — this is the path that matters most: a
      // student who was disconnected mid-test, then hits the browser back
      // button or reloads (landing back on the dashboard, not directly
      // inside TestInterface), needs to be told RIGHT HERE that they're
      // still locked — see App.jsx's App-level lock screen, which is what
      // actually blocks them from browsing anywhere else.
      resyncStudentLiveTestState(io, socket, studentId);
    });

    // --- Teacher joins their dashboard room ---------------------------
    // Identity is always socket.user.id.
    socket.on('teacher:join', () => {
      if (!requireSocketRole(socket, 'teacher:join', 'teacher')) return;
      const teacherId = socket.user.id;
      socket.join(ROOM_TEACHER(teacherId));
      socket.data.teacherId = teacherId;

      // Immediately hydrate the dashboard with everyone currently active under this teacher.
      const mine = [...activeSessions.values()].filter((s) => s.teacherId === teacherId);
      socket.emit('timer:bulk_sync', mine.map(publicSessionView));
    });

    // --- Teacher watchlist / pinning (cross-teacher live monitoring) --
    // A teacher can "pin" a student who belongs to a DIFFERENT teacher (but
    // the SAME institute — see the tenant check below) to temporarily
    // monitor them without any database change. `broadcastSession` already
    // emits every tick to ROOM_STUDENT(studentId), so simply joining it
    // here is enough to start receiving that student's 'timer:update'
    // ticks, status changes, and testTitle in real time. Phase 3 requires
    // role 'teacher' and that the target student belongs to the caller's
    // own institute — cross-institute watching (and, by extension,
    // cross-institute pause/resume/block/force-submit via the pinned
        // room) is no longer possible; watching another teacher's student
    // within the SAME institute remains exactly as it was.
    socket.on('teacher:watch_student', async ({ studentId } = {}) => {
      if (!studentId) return;
      if (!requireSocketRole(socket, 'teacher:watch_student', 'teacher')) return;
      try {
        const student = await User.findById(studentId).select('instituteId role');
        if (!student || student.role !== 'student' || String(student.instituteId) !== String(socket.user.instituteId)) {
          logRejected(socket, 'teacher:watch_student', `student ${studentId} is not a student in the caller's own institute`);
          return;
        }
      } catch (err) {
        logRejected(socket, 'teacher:watch_student', `lookup failed: ${err.message}`);
        return;
      }

      socket.join(ROOM_STUDENT(studentId));

      // Sync immediately rather than making the teacher wait up to 1s for
      // the next global tick if this student is already mid-test.
      const session = activeSessions.get(studentId);
      if (session) {
        socket.emit('timer:update', publicSessionView(session));
      }
    });

    socket.on('teacher:unwatch_student', ({ studentId } = {}) => {
      if (!studentId) return;
      if (!requireSocketRole(socket, 'teacher:unwatch_student', 'teacher')) return;
      socket.leave(ROOM_STUDENT(studentId));
    });

    // --- Teacher controls ----------------------------------------------
    // Phase 3: each of these now requires role 'teacher' AND (once a
    // session exists) that it belongs to the caller's own institute — see
    // authorizeTeacherSessionAction. Within one institute, any teacher can
    // still act on a pinned student exactly as before (that cross-teacher
    // monitoring is existing, intentional functionality — see
    // 'teacher:watch_student' above); only cross-INSTITUTE action is newly
    // blocked.
    socket.on('GRANT_FIXED_TIME', (data) => {
      if (!authorizeTeacherSessionAction(socket, 'GRANT_FIXED_TIME', data?.studentId)) return;
      grantFixedTime(io, data);
    }); // { studentId, seconds }
    socket.on('ALLOW_OVERTIME', (data) => {
      if (!authorizeTeacherSessionAction(socket, 'ALLOW_OVERTIME', data?.studentId)) return;
      allowOvertime(io, data);
    }); // { studentId }
    socket.on('FORCE_SUBMIT', (data) => {
      if (!authorizeTeacherSessionAction(socket, 'FORCE_SUBMIT', data?.studentId)) return;
      forceSubmit(io, data);
    }); // { studentId }
    socket.on('student:submitted', (data) => {
      // Self-submit — identity is always socket.user.id.
      if (!requireSocketRole(socket, 'student:submitted', 'student')) return;
      studentSubmitted(io, { ...data, studentId: socket.user.id });
    }); // { liveSessionId? }

    // Teacher can also pause/resume the whole cohort — reuses the same session store.
    socket.on('teacher:pause', ({ studentId } = {}) => {
      const session = authorizeTeacherSessionAction(socket, 'teacher:pause', studentId);
      if (!session) return;
      if (session.status === 'running') {
        session.status = 'paused';
        broadcastSession(io, session);
      }
    });
    socket.on('teacher:resume', ({ studentId } = {}) => {
      const session = authorizeTeacherSessionAction(socket, 'teacher:resume', studentId);
      if (!session) return;
      if (session.status === 'paused') {
        session.status = 'running';
        broadcastSession(io, session);
      }
    });

    // Teacher can fully block a student — freezes the timer (the global ticker only
    // advances 'running'/'overtime' sessions, so 'blocked' is implicitly paused, same
    // mechanism as 'paused' above) AND tells the student's client to hide all test
    // content behind a full-screen overlay (see TestInterface's handling of this status).
    socket.on('teacher:block', ({ studentId } = {}) => {
      const session = authorizeTeacherSessionAction(socket, 'teacher:block', studentId);
      if (!session) return;
      if (session.status === 'running' || session.status === 'paused') {
        session.status = 'blocked';
        broadcastSession(io, session);
      }
    });
    socket.on('teacher:unblock', ({ studentId } = {}) => {
      const session = authorizeTeacherSessionAction(socket, 'teacher:unblock', studentId);
      if (!session) return;
      if (session.status === 'blocked') {
        session.status = 'running';
        broadcastSession(io, session);
      }
    });

    // --- LIVE TEST -------------------------------------------------------
    // See the handler functions above for the full flow and the Phase 3
    // ownership/tenant checks each now performs.
    socket.on('initiate_live_test', async (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!requireSocketRole(socket, 'initiate_live_test', 'teacher')) {
        return ack({ ok: false, error: 'Forbidden: teacher role required.' });
      }
      // teacherId is always the authenticated caller — never trust the
      // client's own value for identity.
      await initiateLiveTest(io, socket, { ...data, teacherId: socket.user.id }, callback);
    });
    socket.on('live_test_response', (data) => {
      if (!requireSocketRole(socket, 'live_test_response', 'student')) return;
      // studentId is always the authenticated caller.
      liveTestResponse(io, socket, { ...data, studentId: socket.user.id });
    });
    socket.on('live_test_control', (data) => {
      if (!requireSocketRole(socket, 'live_test_control', 'teacher', 'institute')) return;
      liveTestControl(io, socket, data);
    });
    socket.on('invite_mid_session', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!requireSocketRole(socket, 'invite_mid_session', 'teacher', 'institute')) {
        return ack({ ok: false, error: 'Forbidden.' });
      }
      inviteMidSession(io, socket, data, callback);
    });
    socket.on('end_live_session', (data, callback) => {
      const ack = typeof callback === 'function' ? callback : () => {};
      if (!requireSocketRole(socket, 'end_live_session', 'teacher', 'institute')) {
        return ack({ ok: false, error: 'Forbidden.' });
      }
      endLiveSession(io, socket, data, callback);
    });

    // --- Centralized Listening audio (LIVE TEST) --------------------------
    // Both a student's locked player (TestInterface.jsx, joined via
    // useExamTimer.js whenever it has a liveSessionId) and the teacher's
    // own LiveTestMonitor.jsx control panel join this SAME per-session room
    // and ask to be resynced the instant they're ready. Phase 3: a student
    // must actually be a participant of this exact session (in their own
    // institute); a teacher must own it; an institute-role caller must
    // share its institute.
    socket.on('audio:join_session', async ({ sessionId } = {}) => {
      if (!sessionId) return;
      try {
        const filter =
          socket.user.role === 'student'
            ? { _id: sessionId, instituteId: socket.user.instituteId, 'participants.studentId': socket.user.id }
            : socket.user.role === 'teacher'
            ? { _id: sessionId, teacherId: socket.user.id }
            : { _id: sessionId, instituteId: socket.user.instituteId };
        const session = await LiveSession.findOne(filter).select('_id');
        if (!session) {
          logRejected(socket, 'audio:join_session', `caller is not authorized for session ${sessionId}`);
          return;
        }
      } catch (err) {
        logRejected(socket, 'audio:join_session', `lookup failed: ${err.message}`);
        return;
      }
      socket.join(ROOM_LIVE_SESSION(sessionId));
      resyncAudioState(socket, sessionId);
    });
    socket.on('audio:control', (data) => {
      if (!requireSocketRole(socket, 'audio:control', 'teacher', 'institute')) return;
      audioControl(io, socket, data);
    });

    // "Ghost session" fix, explicit half — TestInterface.jsx's beforeunload/
    // unmount handler (see useExamTimer.js's notifyExited) fires this the
    // instant the student's browser starts navigating away/closing, which
    // is faster and more reliable than waiting for the native 'disconnect'
    // below (a browser tab close doesn't always give the socket transport
    // time to notice before the process is gone). Identity is always
    // socket.user.id.
    socket.on('test_exited', () => {
      if (!requireSocketRole(socket, 'test_exited', 'student')) return;
      markStudentDisconnected(io, socket.user.id);
    });

    // LIVE TEST's own force-submit — Teacher clicks "Force submit" in
    // LiveTestMonitor.jsx, server just relays it on to that one student's
    // room (no persistence needed here; the student's own client performs
    // the real submit, which is what actually updates state via
    // 'student:submitted' -> studentSubmitted above). Phase 3: the session
    // must belong to the caller, and the target studentId must actually be
    // one of its participants.
    socket.on('force_submit_test', async ({ sessionId, studentId } = {}) => {
      if (!sessionId || !studentId) return;
      if (!requireSocketRole(socket, 'force_submit_test', 'teacher', 'institute')) return;
      try {
        const ownerFilter = socket.user.role === 'teacher' ? { teacherId: socket.user.id } : { instituteId: socket.user.instituteId };
        const session = await LiveSession.findOne({ _id: sessionId, ...ownerFilter, 'participants.studentId': studentId }).select('_id');
        if (!session) {
          logRejected(socket, 'force_submit_test', `session ${sessionId} not owned by caller, or student ${studentId} not a participant`);
          return;
        }
      } catch (err) {
        logRejected(socket, 'force_submit_test', `lookup failed: ${err.message}`);
        return;
      }
      io.to(ROOM_STUDENT(studentId)).emit('force_submit_test', { sessionId });
    });

    socket.on('disconnect', () => {
      // socket.data.studentId is only ever set by joinStudentRoom, using
      // socket.user.id — never a client-supplied value.
      const studentId = socket.data.studentId;
      const session = activeSessions.get(studentId);
      if (session && session.studentSocketId === socket.id) {
        // Leave the timer running server-side — it keeps ticking while the
        // student is offline, same as a real exam clock would.
        session.studentSocketId = null;
      }

      // "Ghost session" fix, implicit half — catches every disconnect
      // test_exited's explicit emit might miss (network drop, phone locked/
      // backgrounded, process killed) without relying on the client to have
      // gotten a chance to say anything at all. Safe to call unconditionally
      // for EVERY disconnecting socket (dashboard-only, mid-test, teacher,
      // whatever) — see markStudentDisconnected's own doc comment for why
      // its query makes this a no-op unless the student actually had a
      // 'joined' live-test participation in progress.
      markStudentDisconnected(io, studentId);
    });
  });
}

module.exports = { initSocketHandler, activeSessions, ROOM_TEACHER, ROOM_STUDENT };
