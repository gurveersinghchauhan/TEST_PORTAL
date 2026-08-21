const express = require('express');
const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const Test = require('../models/Test');
const { checkIeltsAnswer } = require('../utils/answerChecker');
const { getBandScore } = require('../utils/bandScore');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROOM_TEACHER } = require('../socketHandler');

const router = express.Router();

/** Flattens every question across every part/group of a Test into one array. */
function flattenQuestions(test) {
  const all = [];
  for (const part of test.parts) {
    for (const group of part.questionGroups) {
      for (const q of group.questions) {
        all.push(q);
      }
    }
  }
  return all;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).toLowerCase().trim()).sort();
  if (value == null || value === '') return [];
  return [String(value).toLowerCase().trim()];
}

/**
 * Grades one question. Array correctAnswers (multi-select /
 * matching-information-with-multiple-answers) require an exact set match;
 * everything else goes through the fuzzy IELTS checker (handles slashes,
 * optional bracketed words, case/whitespace).
 */
function gradeAnswer(studentAnswer, correctAnswer) {
  if (Array.isArray(correctAnswer)) {
    const a = normalizeArray(studentAnswer);
    const b = normalizeArray(correctAnswer);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  if (studentAnswer == null) return false;
  const studentStr = Array.isArray(studentAnswer) ? studentAnswer[0] : String(studentAnswer);
  if (!studentStr || !studentStr.trim()) return false;
  return checkIeltsAnswer(studentStr, String(correctAnswer));
}

/**
 * Shapes ONE submission for GET /mine — the actual Teacher-Gated Result
 * Release enforcement point. Fields never present in the pending shape
 * (score/totalQuestions/bandScore/answers/timeTakenSeconds) are omitted
 * from the object entirely rather than nulled out, so there's nothing for
 * a curious student to reconstruct from a null/zero value either.
 */
function serializeSubmissionForStudent(sub) {
  const base = {
    _id: sub._id,
    test: sub.test,
    module: sub.module,
    liveSessionId: sub.liveSessionId,
    submittedAt: sub.submittedAt,
    isPublished: sub.isPublished,
  };

  if (!sub.isPublished) {
    return { ...base, status: 'pending_release' };
  }

  return {
    ...base,
    status: 'released',
    score: sub.score,
    totalQuestions: sub.totalQuestions,
    bandScore: sub.bandScore,
    answers: sub.answers,
    timeTakenSeconds: sub.timeTakenSeconds,
  };
}

/**
 * POST /api/submissions
 * Body: { studentName, teacherId, testId, answers: {questionNumber: value}, timeTakenSeconds, liveSessionId? }
 * Grades the submitted answers against the Test's correct answers and
 * computes the raw score + band score. What happens next branches on
 * whether this came from a LIVE TEST broadcast:
 *
 *   - liveSessionId present (LIVE TEST): the graded result is PERSISTED —
 *     upserted on {student, test, liveSessionId} instead of always
 *     inserting, so a straggler auto-submitted at End Session can never
 *     create a duplicate row alongside an earlier self-submit for the same
 *     live session (see the upsert call below). This is what
 *     TestRecord.jsx's/LiveTestMonitor.jsx's "View Report" both read.
 *
 *   - liveSessionId absent (standalone practice attempt): NOTHING is saved
 *     to MongoDB. The full graded result (score, band, and each question's
 *     studentAnswer/correctAnswer/explanation/isCorrect) is computed here
 *     and handed straight back in the response so StudentTestPage.jsx can
 *     render an instant report — practice attempts were never shown
 *     anywhere else in the app (no student-facing history view reads them,
 *     and TestRecord.jsx only ever looked submissions up by liveSessionId —
 *     see routes/liveSessions.js), so skipping the write is a pure win:
 *     one fewer Submission row per practice run, with no feature depending
 *     on that row existing.
 *
 * Student-only. studentId is deliberately NOT taken from the request body
 * — it's always req.user.id, straight off the verified JWT, so a student
 * can never submit a result under someone else's name. teacherId still
 * comes from the body (denormalized display info, not a security
 * boundary); the real tenant tag — instituteId — comes from req.user too,
 * so even a bogus teacherId can't smuggle a submission into another
 * institute's data.
 *
 * liveSessionId is optional and, like teacherId, taken as-given from the
 * body rather than re-derived server-side — the client (App.jsx/
 * StudentTestPage.jsx/TestInterface.jsx) only ever sets it to the sessionId
 * it actually joined/resumed over the socket (see useLiveTestChannel.js),
 * and a wrong or fabricated value here has no privilege implications: at
 * worst it mislinks a submission to the wrong LiveSession for
 * TestRecord.jsx's summary table, which isn't a security boundary. Left
 * unset (null) for every ordinary practice-test submission — see
 * TestInterface.jsx's mode-aware submit payload.
 */
router.post('/', requireAuth, requireRole('student'), async (req, res) => {
  try {
    const { studentName, teacherId, testId, answers = {}, timeTakenSeconds = 0, liveSessionId } = req.body;

    if (!teacherId || !testId) {
      return res.status(400).json({ error: 'teacherId and testId are required.' });
    }
    if (!req.user.instituteId) {
      return res.status(400).json({
        error: 'Your account is not linked to an institute tenant. Please log out and back in, then try again.',
      });
    }

    const test = await Test.findById(testId);
    if (!test) return res.status(404).json({ error: 'Test not found.' });

    const questions = flattenQuestions(test);

    const gradedAnswers = questions.map((q) => {
      const studentAnswer = answers[q.questionNumber] ?? answers[String(q.questionNumber)] ?? null;
      const isCorrect = gradeAnswer(studentAnswer, q.correctAnswer);
      return {
        questionNumber: q.questionNumber,
        studentAnswer,
        correctAnswer: q.correctAnswer,
        // Teacher-authored answer-key notes (see models/Test.js) — included
        // here so a standalone practice attempt's instant report can show
        // "why" alongside "right/wrong". Submission.answers doesn't declare
        // this field (see models/Submission.js), so for a LIVE TEST
        // submission below, Mongoose silently drops it on save — harmless,
        // it just isn't persisted for that path.
        explanation: q.explanation || '',
        isCorrect,
      };
    });

    const score = gradedAnswers.filter((a) => a.isCorrect).length;
    // The published IELTS raw-score-to-band conversion table (0-40) is the
    // same for Academic Reading and Listening — see utils/bandScore.js —
    // so both modules use it here. Writing/Speaking have no raw score to
    // convert at all (they're free-response, no auto-checker exists for
    // either — see models/Submission.js's module enum, which only ever
    // covers 'reading'/'listening'); those two bands only ever come from a
    // teacher's Manual Grading entry on a Full Mock Test bundle instead —
    // see routes/fullMockSessions.js.
    const bandScore = test.module === 'reading' || test.module === 'listening' ? getBandScore(score) : null;

    // Tolerate a garbage/malformed liveSessionId (never expected from our
    // own client, but this is client-supplied) by silently dropping it
    // rather than letting a Mongoose CastError fail the whole submission —
    // losing the live-session link is far less bad than losing the
    // student's graded result entirely.
    const safeLiveSessionId =
      typeof liveSessionId === 'string' && mongoose.Types.ObjectId.isValid(liveSessionId) ? liveSessionId : null;

    // ---- Standalone practice attempt: compute-and-return, skip the DB ----
    if (!safeLiveSessionId) {
      return res.status(200).json({
        submission: {
          persisted: false,
          testId: test._id,
          module: test.module,
          score,
          totalQuestions: questions.length,
          bandScore,
          answers: gradedAnswers,
          timeTakenSeconds,
        },
      });
    }

    // ---- LIVE TEST attempt: must persist ----------------------------------
    // Upserts on {student, test, liveSessionId} rather than always
    // inserting. This is what makes "refresh / overwrite the records to
    // ensure all data is consistent and finalized" concrete: a self-submit
    // and a teacher-forced submit for the same student can theoretically
    // race right around End Session (see socketHandler.js's endLiveSession
    // / routes/liveSessions.js's PATCH /:id/end, which force-submit anyone
    // still 'joined' at that instant) — without the upsert that race could
    // leave two Submission rows for the same student+session, and
    // TestRecord.jsx's per-session table (which lists every submission for
    // a liveSessionId) would show a duplicate. Upserting guarantees exactly
    // one row per student per live session, always reflecting the latest
    // graded answers.
    // Deliberately omits `isPublished` — it's never part of this $set.
    // Combined with `setDefaultsOnInsert: true` below, that means the
    // schema default (isPublished: false) only ever applies on the FIRST
    // insert; a later re-submit for the same {student, test,
    // liveSessionId} (the straggler-race case the upsert comment above
    // describes) updates the grade in place without silently un-publishing
    // a result a teacher already released in the meantime.
    const submissionDoc = {
      student: req.user.id,
      studentName: studentName || 'Unknown student',
      teacher: teacherId,
      test: test._id,
      module: test.module,
      liveSessionId: safeLiveSessionId,
      answers: gradedAnswers,
      score,
      totalQuestions: questions.length,
      bandScore,
      instituteId: req.user.instituteId,
      status: 'submitted',
      submittedAt: new Date(),
      timeTakenSeconds,
    };

    let submission;
    try {
      submission = await Submission.findOneAndUpdate(
        { student: req.user.id, test: test._id, liveSessionId: safeLiveSessionId },
        { $set: submissionDoc },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (dbErr) {
      // The test WAS graded — only the save to MongoDB failed (e.g. a
      // transient Atlas blip). Log it loudly, tell the teacher's dashboard
      // in real time (so they know to have the student retry rather than
      // silently losing a result), and hand the student back the same
      // graded-but-unsaved shape the standalone-practice branch above
      // returns, with a clear error and a non-2xx status so
      // StudentTestPage.jsx's existing submitError/Retry UI kicks in
      // (submitted never flips to true, so Retry re-attempts this exact
      // upsert — safe to call again, it's keyed the same way every time).
      console.error(
        `[live-test] Failed to save submission to MongoDB (student=${req.user.id}, liveSessionId=${safeLiveSessionId}):`,
        dbErr
      );
      const io = req.app.get('io');
      if (io) {
        io.to(ROOM_TEACHER(teacherId)).emit('live_test_submission_error', {
          sessionId: safeLiveSessionId,
          studentId: req.user.id,
          studentName: studentName || 'Unknown student',
          message: 'Failed to save this submission to the database.',
        });
      }
      return res.status(502).json({
        error: "We graded your test but couldn't save it — please stay on this page and click Retry.",
        submission: {
          persisted: false,
          testId: test._id,
          module: test.module,
          score,
          totalQuestions: questions.length,
          bandScore,
          answers: gradedAnswers,
          timeTakenSeconds,
        },
      });
    }

    res.status(201).json({ submission: { ...submission.toObject(), persisted: true } });
  } catch (err) {
    console.error('Failed to create submission:', err);
    res.status(500).json({ error: 'Failed to submit test.' });
  }
});

/**
 * GET /api/submissions?student=<studentId>&test=<testId>
 *   Looks up the most recent submission for a given student+test. Used by
 *   the Teacher Dashboard's "View Report" button, which only knows the
 *   studentId and testId from the live socket session, not a submission
 *   _id. Returns a single `{ submission }`.
 *
 * GET /api/submissions?liveSessionId=<sessionId>
 *   Every submission tied to one LIVE TEST broadcast — TestRecord.jsx's
 *   per-session summary table. Returns a list, `{ submissions: [...] }`
 *   (note the different shape from the student+test mode above), sorted
 *   newest-first. An unrecognized/mistyped liveSessionId simply yields an
 *   empty array rather than a 404 — "no submissions yet for this session"
 *   and "this session id doesn't exist" look the same to the caller and
 *   don't need to be told apart here.
 *
 * Both modes are scoped to the caller's own institute tenant — a
 * student/test pair or liveSessionId from another institute simply won't
 * match, same as it not existing.
 */
router.get('/', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const { student, test, liveSessionId } = req.query;

    if (liveSessionId) {
      // Invalid/malformed id (e.g. a stray query param) would otherwise
      // throw a Mongoose CastError on .find() — short-circuit to an empty
      // list instead, matching the "unrecognized id reads as empty, not an
      // error" behavior documented above.
      if (!mongoose.Types.ObjectId.isValid(liveSessionId)) {
        return res.json({ submissions: [] });
      }
      const submissions = await Submission.find({ liveSessionId, instituteId: req.user.instituteId })
        .sort({ submittedAt: -1, createdAt: -1 })
        .populate('test', 'title module');
      return res.json({ submissions });
    }

    if (!student || !test) {
      return res.status(400).json({ error: 'Either liveSessionId, or both student and test, query params are required.' });
    }
    const submission = await Submission.findOne({ student, test, instituteId: req.user.instituteId })
      .sort({ submittedAt: -1, createdAt: -1 })
      .populate('test', 'title module');
    if (!submission) return res.status(404).json({ error: 'No submission found for this student and test.' });
    res.json({ submission });
  } catch (err) {
    console.error('Failed to look up submission(s):', err);
    res.status(500).json({ error: 'Failed to look up submission(s).' });
  }
});

/**
 * GET /api/submissions/mine
 * -------------------------
 * Student-only, self-scoped results list — Teacher-Gated Result Release.
 * Always filters on req.user.id (never a client-supplied student id, unlike
 * the teacher/institute-only GET / above), so a student can only ever see
 * their own results. This is what a "My Results" list on the student
 * dashboard reads (see MyResultsSection.jsx).
 *
 * A LIVE TEST submission is graded and saved instantly (see POST / above),
 * but its score/bandScore/answers are REDACTED from this response entirely
 * — not just hidden client-side — for as long as isPublished stays false.
 * That's the actual security boundary: a student can't see their band
 * score by opening devtools and reading the raw response, because the
 * server never sends it until a teacher calls POST /:id/publish below.
 * Until then, all this returns is the bare fact a submission exists and is
 * pending review — enough for the "Your instructor is reviewing your
 * submission" message, nothing else.
 *
 * Optional ?liveSessionId= narrows to one specific live session (e.g. the
 * one the student just finished); omitted, this returns every one of the
 * student's own live-test submissions, newest first.
 *
 * Registered before GET /:id below so "mine" is never swallowed by that
 * route's :id param.
 */
router.get('/mine', requireAuth, requireRole('student'), async (req, res) => {
  try {
    if (!req.user.instituteId) {
      return res.json({ submissions: [] });
    }

    const { liveSessionId } = req.query;
    const query = { student: req.user.id, instituteId: req.user.instituteId };
    if (liveSessionId) {
      // Malformed id (stray query param) would otherwise throw a Mongoose
      // CastError on .find() — short-circuit to an empty list instead.
      if (!mongoose.Types.ObjectId.isValid(liveSessionId)) {
        return res.json({ submissions: [] });
      }
      query.liveSessionId = liveSessionId;
    }

    const submissions = await Submission.find(query)
      .sort({ submittedAt: -1, createdAt: -1 })
      .populate('test', 'title module');

    res.json({ submissions: submissions.map(serializeSubmissionForStudent) });
  } catch (err) {
    console.error('Failed to fetch my submissions:', err);
    res.status(500).json({ error: 'Failed to fetch your results.' });
  }
});

/**
 * GET /api/submissions/:id
 * Full report: evaluated answers, raw score, and band score. Same
 * tenant-ownership check as the list route above — a submission id from
 * another institute reads back as "not found," never leaking that it exists.
 */
router.get('/:id', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id).populate('test', 'title module');
    if (!submission || String(submission.instituteId) !== String(req.user.instituteId)) {
      return res.status(404).json({ error: 'Submission not found.' });
    }
    res.json({ submission });
  } catch (err) {
    console.error('Failed to fetch submission:', err);
    res.status(500).json({ error: 'Failed to fetch submission.' });
  }
});

/**
 * POST /api/submissions/:id/publish
 * ----------------------------------
 * Teacher-Gated Result Release — the teacher's side of the workflow. Flips
 * isPublished so the graded score/band/per-question answers become visible
 * to the student on their own dashboard (see GET /mine above). Grading
 * itself already happened at submit time; this only ever controls
 * VISIBILITY — nothing here re-grades or changes the stored result.
 *
 * One-directional, mirroring how routes/testUpload.js's POST /:id/publish
 * works for a Test draft (no "unpublish" counterpart either) — a teacher
 * releasing a scorecard is treated the same way as publishing a test: a
 * forward step, not a togglable draft state.
 *
 * Same tenant-ownership check as GET /:id — a submission id from another
 * institute reads back as "not found."
 */
router.post('/:id/publish', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const existing = await Submission.findById(req.params.id).select('instituteId');
    if (!existing || String(existing.instituteId) !== String(req.user.instituteId)) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    const submission = await Submission.findByIdAndUpdate(
      req.params.id,
      { isPublished: true },
      { returnDocument: 'after' }
    ).populate('test', 'title module');

    res.json({ submission });
  } catch (err) {
    console.error('Failed to publish submission:', err);
    res.status(500).json({ error: 'Failed to publish result.' });
  }
});

module.exports = router;
