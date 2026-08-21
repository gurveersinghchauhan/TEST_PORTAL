const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * One student's aggregate record within a FullMockSession — the row
 * "Manual Grading" (see routes/fullMockSessions.js's PUT
 * /:id/results/:studentId) writes to. Reading/Listening scores are
 * DELIBERATELY not duplicated here — they're read live from Submission
 * (via FullMockSession.readingLiveSessionId/listeningLiveSessionId +
 * studentId) every time the unified scorecard is fetched, so there's
 * exactly one source of truth for those two modules. Writing/Speaking have
 * no auto-checker at all (see Submission.js's module enum — only
 * 'reading'/'listening' are ever graded server-side), so this row IS the
 * only record of those two scores.
 */
const mockResultSchema = new Schema(
  {
    studentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalized (same reasoning as LiveSession.teacherName/testTitle) so
    // the scorecard never needs a second lookup just to show a name.
    studentName: { type: String, required: true },
    writingBand: { type: Number, default: null, min: 0, max: 9 },
    writingFeedback: { type: String, default: '' },
    speakingBand: { type: Number, default: null, min: 0, max: 9 },
    speakingFeedback: { type: String, default: '' },
    // A convenience CACHE, recomputed and persisted every time Manual
    // Grading is saved — GET /:id in routes/fullMockSessions.js always
    // recomputes its own copy fresh (using whatever Reading/Listening
    // Submission looks like right now) rather than trusting this field, so
    // it can never look stale in what the teacher actually sees on screen.
    // Kept on the document anyway so the raw DB record itself carries a
    // meaningful "last known overall band" even outside that endpoint.
    overallBand: { type: Number, default: null },
    gradedAt: { type: Date, default: null },
  },
  { _id: false }
);

/**
 * "Full Mock Test Bundle" — one Saturday-morning-style mock exam grouping
 * a Reading LIVE TEST session and a Listening LIVE TEST session (both
 * already run through the ordinary LIVE TEST flow — see
 * socketHandler.js's initiateLiveTest) under one title, plus a
 * per-student roster of manually-entered Writing/Speaking bands. This is
 * what TestRecord.jsx's single-module history can't represent on its
 * own: one student's result across all four IELTS modules, side by side.
 */
const fullMockSessionSchema = new Schema(
  {
    // The teacher-chosen label for this mock (e.g. "Saturday Mock Test -
    // 22") — shown in FullMockTests.jsx's search list and detail header.
    title: { type: String, required: true, trim: true },
    teacherId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Resolved server-side from req.user.instituteId at creation time (see
    // routes/fullMockSessions.js's POST /), never from client input.
    // Required as of the Phase 2 schema-hardening pass; any pre-existing
    // document missing this must go through scripts/migrateInstituteId.js
    // FIRST.
    instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },
    // Both nullable and independent — a teacher can bundle just one module
    // now and nothing stops linking the other's session in later (not
    // exposed in the UI yet, but the schema doesn't block it).
    readingLiveSessionId: { type: Schema.Types.ObjectId, ref: 'LiveSession', default: null },
    listeningLiveSessionId: { type: Schema.Types.ObjectId, ref: 'LiveSession', default: null },
    results: { type: [mockResultSchema], default: [] },
  },
  { timestamps: true }
);

fullMockSessionSchema.index({ teacherId: 1, createdAt: -1 });

module.exports = mongoose.model('FullMockSession', fullMockSessionSchema);
