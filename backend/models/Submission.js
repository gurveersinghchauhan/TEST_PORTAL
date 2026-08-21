const mongoose = require('mongoose');
const { Schema } = mongoose;

const answerSchema = new Schema(
  {
    questionNumber: { type: Number, required: true },
    studentAnswer: { type: Schema.Types.Mixed, default: null }, // String | String[] | null (unanswered)
    correctAnswer: { type: Schema.Types.Mixed, required: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: false }
);

const submissionSchema = new Schema(
  {
    // NOTE: this app has no real auth/User records wired up yet — the frontend
    // passes plain dummy ids (e.g. 'student_123', 'teacher_999') straight
    // through, not real Mongo ObjectIds. So these stay plain strings rather
    // than ObjectId refs to 'User' (an ObjectId ref would reject those ids).
    student: { type: String, required: true },
    // Denormalized so the Teacher Review report can show a name without
    // joining through a (currently nonexistent) student record.
    studentName: { type: String, required: true },
    teacher: { type: String, required: true },

    test: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
    module: { type: String, enum: ['reading', 'listening'], required: true },

    // Set only when this submission came from a LIVE TEST broadcast (see
    // backend/models/LiveSession.js) rather than a student practicing on
    // their own — null for every ordinary practice-test submission.
    // Populated from the client's own tracked liveSessionId (see
    // App.jsx/StudentTestPage.jsx), which in turn traces back to the
    // sessionId the student actually joined/resumed over the socket — see
    // routes/submissions.js's POST handler. This is the join key
    // TestRecord.jsx's per-session summary table uses (GET
    // /api/submissions?liveSessionId=...) to show every student's result
    // for one specific broadcast.
    liveSessionId: { type: Schema.Types.ObjectId, ref: 'LiveSession', default: null, index: true },

    // Multi-tenant isolation: which Institute (coaching center) this
    // student response/result belongs to — resolved server-side from the
    // submitting student's own req.user.instituteId (verified JWT), never
    // from client input (see routes/submissions.js's POST /). Required as
    // of the Phase 2 schema-hardening pass; any pre-existing document
    // missing this must go through scripts/migrateInstituteId.js FIRST.
    instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },

    answers: [answerSchema],

    score: { type: Number, default: 0 }, // raw correct count
    totalQuestions: { type: Number, required: true },
    bandScore: { type: Number, default: null }, // optional, filled in if using a raw->band conversion table

    status: {
      type: String,
      enum: ['in-progress', 'submitted', 'graded'],
      default: 'submitted',
    },

    // Teacher-Gated Result Release — grading happens instantly at submit
    // time (see routes/submissions.js's POST /), but the score/band/
    // per-question answers stay hidden from the student (GET /mine
    // redacts them entirely, not just client-side) until a teacher
    // explicitly flips this via POST /:id/publish. Defaults to false so
    // every freshly-graded LIVE TEST result starts out pending review —
    // a student never sees their score before their teacher has released
    // it. Irrelevant to a standalone practice attempt, which is never
    // persisted at all (see the POST handler's early-return branch), so
    // this only ever matters for LIVE TEST submissions in practice.
    isPublished: { type: Boolean, default: false },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    timeTakenSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

submissionSchema.index({ student: 1, test: 1 });
submissionSchema.index({ teacher: 1, module: 1 });

module.exports = mongoose.model('Submission', submissionSchema);
