const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One invited student's state within a LIVE TEST session. `status` tracks
 * whether they've responded to the invite at all; `controls` is the
 * teacher's live proctoring lever over their test UI once joined — these
 * are deliberately separate fields (a student can be 'joined' AND
 * 'blocked' at the same time) rather than folding proctoring into the
 * response status.
 */
const liveParticipantSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // A student moves through these response states — 'invited' until they
    // act on the incoming_live_test prompt (or let it expire), then
    // 'joined', 'dismissed', or 'dismissed_timeout'. A teacher CAN still
    // re-add a dismissed/timed-out student through the mid-session invite
    // flow below, which is why 'invited' stays a valid target of a second
    // push, not just the initial create. 'dismissed_timeout' is kept
    // distinct from a deliberate 'dismissed' so the Teacher Monitoring UI
    // can show "Timeout" rather than implying the student actively
    // declined — see useLiveTestChannel.js's 120s countdown and
    // socketHandler.js's 'live_test_response' handler. 'submitted' is set
    // once a 'joined' student's real POST /api/submissions succeeds (see
    // socketHandler.js's studentSubmitted) — critically, this is what lets
    // markStudentDisconnected's query (which only ever targets
    // status:'joined') correctly ignore a student who finished normally
    // and then closed the tab, instead of misreporting them as
    // 'disconnected' right after they submitted.
    status: {
      type: String,
      enum: ['invited', 'joined', 'dismissed', 'dismissed_timeout', 'submitted'],
      default: 'invited',
    },
    // Teacher-controlled (or server-detected, for 'disconnected') lock on
    // this student's TestInterface, independent of `status` above — see
    // socketHandler.js's 'live_test_control'/markStudentDisconnected and
    // StudentTestPage.jsx's lock overlay / App.jsx's App-level lock screen.
    // 'disconnected' is set automatically (never by a teacher action) when
    // a joined student's socket drops or their client reports test_exited
    // (browser back button, tab close, hard refresh) — see
    // socketHandler.js's 'test_exited' handler and native 'disconnect'
    // handler. Only a teacher's explicit "Allow Resume" click (which maps
    // to this same 'active' value via LIVE_CONTROL_TO_STATE.resume) clears
    // it — a student simply reconnecting does NOT auto-clear it, which is
    // the whole point of the strict resume gatekeeper.
    controls: { type: String, enum: ['active', 'paused', 'blocked', 'disconnected'], default: 'active' },
    respondedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * A single "LIVE TEST" broadcast: one teacher, one test, a roster of
 * invited students and their live join/proctoring state. Created the
 * moment a teacher hits "Start Live Test" (see socketHandler.js's
 * 'initiate_live_test' handler) and updated in place as students respond
 * and the teacher applies pause/block/unblock controls — this is the
 * durable record LiveTestMonitor.jsx's real-time table is built from.
 */
const liveSessionSchema = new Schema(
  {
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Denormalized alongside testTitle below, for the exact same reason —
    // a student invited mid-session (see socketHandler.js's
    // inviteMidSession) needs a teacherName for their incoming_live_test
    // prompt, and by then the original socket payload's teacherName (which
    // was never persisted before this field existed) is long gone.
    teacherName: { type: String, default: '' },
    // The teacher-chosen label for THIS broadcast (e.g. "Morning Batch Mock
    // 1"), typed into LiveTestSetup.jsx's final step — distinct from
    // testTitle below, which is the underlying Test document's own title.
    // A teacher can run the same Test multiple times as differently-named
    // sessions (e.g. re-running "Cambridge 21 Test 4" for two different
    // batches on two different days), and this is what tells those
    // sessions apart in LiveTestMonitor.jsx's header and TestRecord.jsx's
    // search-by-title list. Deliberately never shown to students — the
    // incoming_live_test prompt/modal only ever says "Live test started by
    // [Teacher Name]" (see App.jsx), with no test or session details.
    title: { type: String, required: true, trim: true },
    testId: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
    // Denormalized snapshot so the monitor table and the student's
    // incoming_live_test prompt never need an extra populate/lookup just
    // to show a title — mirrors the same pattern socketHandler.js's
    // exam-timer `activeSessions` already uses for `testTitle`.
    testTitle: { type: String, default: '' },
    module: { type: String, enum: ['reading', 'listening', 'speaking', 'writing'], required: true },
    participants: { type: [liveParticipantSchema], default: [] },
    // 'completed' is set by LiveTestMonitor.jsx's "End Live Session" button
    // (see socketHandler.js's endLiveSession) — the teacher's explicit
    // signal that this broadcast is over. This is also the field
    // TestRecord.jsx's history list and the strict-resume-gatekeeper
    // queries (resyncStudentLiveTestState/markStudentDisconnected/
    // studentSubmitted, all filtered to status:'active') key off of: once a
    // session is 'completed', it stops being eligible for those live
    // control/resync flows and simply becomes a historical record.
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    // Tenant scoping — resolved server-side in socketHandler.js's
    // initiateLiveTest via resolveTenantInstituteId(teacherId), never from
    // client input. Required as of the Phase 2 schema-hardening pass; any
    // pre-existing document missing this must go through
    // scripts/migrateInstituteId.js FIRST. Note: initiateLiveTest itself is
    // Socket.IO code and is intentionally left untouched by that pass — if
    // resolveTenantInstituteId ever can't resolve a teacher's tenant (an
    // already-anomalous case it has logged a warning for since before this
    // change), LiveSession.create() will now reject with a validation
    // error instead of silently persisting a null-tenant document; that
    // create() call is wrapped in initiateLiveTest's own try/catch, which
    // already turns any create() failure into a clean
    // { ok: false, error: 'Failed to start the live test.' } ack — so this
    // surfaces as a normal handled error, not a crash.
    instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },

    // Teacher-Controlled Centralized Audio Player (Listening only) — the
    // single authoritative position of whatever the teacher's centralized
    // player in LiveTestMonitor.jsx is doing, updated on every play/pause/
    // seek/part-switch (see socketHandler.js's audioControl). Deliberately
    // a POSITION ANCHOR, not a per-second ticking value like the exam
    // timer's activeSessions Map: `currentTime` is where playback was AT
    // THE MOMENT `updatedAt` was written, so any client — a student's
    // locked player (TestInterface.jsx's LockedAudioPlayer) syncing live,
    // a student joining late, a reconnect after a network blip, or the
    // teacher's own panel reloading mid-session — can derive "where the
    // audio should be right now" as
    //   isPlaying ? currentTime + (Date.now() - updatedAt) / 1000 : currentTime
    // without the server running a second global interval alongside
    // startGlobalTicker. Persisted here (not just held in the in-memory
    // activeSessions Map) specifically so that derivation still works after
    // a server restart or for a socket that connects well after the last
    // broadcast — see socketHandler.js's resyncAudioState. `partNumber`
    // tracks which part's audioUrl this anchor applies to, since a
    // Listening test has one separate audio file PER PART (see
    // partSchema.audioUrl) rather than a single combined track for the
    // whole test — default: null means "no part is live yet", which every
    // part's locked player reads as "waiting for the instructor" rather
    // than assuming Part 1.
    audioState: {
      partNumber: { type: Number, default: null },
      isPlaying: { type: Boolean, default: false },
      currentTime: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

liveSessionSchema.index({ teacherId: 1, status: 1 });

module.exports = mongoose.model('LiveSession', liveSessionSchema);
