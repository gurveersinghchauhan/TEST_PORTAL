const express = require('express');
const mongoose = require('mongoose');
const FullMockSession = require('../models/FullMockSession');
const LiveSession = require('../models/LiveSession');
const Submission = require('../models/Submission');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/** Rounds to the nearest 0.5 — the standard IELTS band-score granularity. */
function roundToHalfBand(value) {
  return Math.round(value * 2) / 2;
}

/**
 * Averages whichever of the four module bands are actually present. A mock
 * where, say, Speaking hasn't been graded yet still gets a meaningful
 * running average from Reading/Listening/Writing rather than showing
 * nothing until all four exist. Returns null only when NONE are present.
 */
function computeOverallBand({ readingBand, listeningBand, writingBand, speakingBand }) {
  const bands = [readingBand, listeningBand, writingBand, speakingBand].filter(
    (b) => typeof b === 'number' && !Number.isNaN(b)
  );
  if (bands.length === 0) return null;
  const avg = bands.reduce((sum, b) => sum + b, 0) / bands.length;
  return roundToHalfBand(avg);
}

/**
 * Same "teacherId alone is sufficient, no instituteId dependency for a
 * teacher" ownership model routes/liveSessions.js settled on (see that
 * file's ownershipDenialReason for the full incident this avoids repeating
 * — a null/mismatched instituteId silently locking a teacher out of their
 * own record). Not a risk here the way it was there (this route always
 * stamps instituteId straight from a real req.user at creation time below,
 * never from an unauthenticated socket payload), but kept identical for
 * consistency and because teacherId equality is simply the more precise
 * check regardless.
 */
function ownershipDenialReason(doc, reqUser) {
  if (reqUser.role === 'teacher') {
    return String(doc.teacherId) === String(reqUser.id)
      ? null
      : `teacherId mismatch (doc.teacherId=${doc.teacherId}, req.user.id=${reqUser.id})`;
  }
  return String(doc.instituteId) === String(reqUser.instituteId)
    ? null
    : `instituteId mismatch (doc.instituteId=${doc.instituteId}, req.user.instituteId=${reqUser.instituteId})`;
}

/**
 * POST /api/full-mocks
 * Body: { title, readingLiveSessionId?, listeningLiveSessionId? }
 * Creates a new Full Mock Test bundle, linking an existing (teacher-owned)
 * Reading and/or Listening LIVE TEST session under one title. Seeds a
 * per-student results roster from the union of both sessions' rosters —
 * dedup'd by studentId, since the same batch is normally invited to both —
 * with Writing/Speaking left blank for Manual Grading to fill in later.
 * Teacher-only: a bundle always belongs to exactly one teacher, the same
 * way a LiveSession does.
 */
router.post('/', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { title, readingLiveSessionId, listeningLiveSessionId } = req.body;
    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    if (!trimmedTitle) {
      return res.status(400).json({ error: 'A title is required (e.g. "Saturday Mock Test - 22").' });
    }

    const safeReadingId = mongoose.Types.ObjectId.isValid(readingLiveSessionId) ? readingLiveSessionId : null;
    const safeListeningId = mongoose.Types.ObjectId.isValid(listeningLiveSessionId) ? listeningLiveSessionId : null;
    if (!safeReadingId && !safeListeningId) {
      return res.status(400).json({ error: 'Link at least one Reading or Listening live test session.' });
    }

    const linkedIds = [safeReadingId, safeListeningId].filter(Boolean);
    const linkedSessions = await LiveSession.find({ _id: { $in: linkedIds } });
    if (linkedSessions.some((session) => String(session.teacherId) !== String(req.user.id))) {
      return res.status(403).json({ error: 'One of the selected live test sessions does not belong to you.' });
    }

    const readingSession = safeReadingId
      ? linkedSessions.find((s) => String(s._id) === String(safeReadingId))
      : null;
    const listeningSession = safeListeningId
      ? linkedSessions.find((s) => String(s._id) === String(safeListeningId))
      : null;
    if (safeReadingId && !readingSession) {
      return res.status(404).json({ error: 'The selected Reading session was not found.' });
    }
    if (safeListeningId && !listeningSession) {
      return res.status(404).json({ error: 'The selected Listening session was not found.' });
    }

    const studentIds = new Set();
    (readingSession?.participants || []).forEach((p) => studentIds.add(String(p.studentId)));
    (listeningSession?.participants || []).forEach((p) => studentIds.add(String(p.studentId)));

    // LiveSession.participants never stores a name (see LiveSession.js's
    // own comment on liveParticipantSchema) — resolve it here, once, in
    // bulk, rather than leaving the roster nameless like a freshly-resumed
    // LiveTestMonitor session does (there it's backfilled client-side; here
    // it's simpler to just resolve server-side at creation time since this
    // only ever happens once per bundle).
    const students = await User.find({ _id: { $in: [...studentIds] } }).select('name');
    const nameById = new Map(students.map((s) => [String(s._id), s.name]));

    const fullMock = await FullMockSession.create({
      title: trimmedTitle,
      teacherId: req.user.id,
      instituteId: req.user.instituteId,
      readingLiveSessionId: safeReadingId,
      listeningLiveSessionId: safeListeningId,
      results: [...studentIds].map((studentId) => ({
        studentId,
        studentName: nameById.get(studentId) || 'Unknown student',
      })),
    });

    res.status(201).json({ fullMock });
  } catch (err) {
    console.error('Failed to create full mock test:', err);
    res.status(500).json({ error: 'Failed to create the full mock test.' });
  }
});

/**
 * GET /api/full-mocks?search=<text>&from=<ISO date>&to=<ISO date>
 * Search list for FullMockTests.jsx — same title-search / createdAt-range
 * shape as GET /api/live-sessions, scoped the same way (teacherId for a
 * teacher, instituteId for an institute viewer).
 */
router.get('/', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const { search, from, to, linkedLiveSessionId } = req.query;
    const query = req.user.role === 'teacher' ? { teacherId: req.user.id } : { instituteId: req.user.instituteId };

    if (search && search.trim()) {
      query.title = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }

    // TestRecord.jsx's per-session detail view uses this to ask "does a
    // Full Mock Test bundle include THIS specific LiveSession (as either
    // its Reading or Listening leg)?" so it can surface a link to the
    // unified scorecard right from the single-module view a teacher is
    // already looking at. An invalid/malformed id just yields an empty
    // list — same "unrecognized reads as empty, not an error" convention
    // routes/submissions.js's liveSessionId lookup already uses.
    if (linkedLiveSessionId) {
      if (!mongoose.Types.ObjectId.isValid(linkedLiveSessionId)) {
        return res.json({ fullMocks: [] });
      }
      query.$or = [{ readingLiveSessionId: linkedLiveSessionId }, { listeningLiveSessionId: linkedLiveSessionId }];
    }

    if (from || to) {
      query.createdAt = {};
      if (from) {
        const fromDate = new Date(from);
        if (!Number.isNaN(fromDate.getTime())) query.createdAt.$gte = fromDate;
      }
      if (to) {
        const toDate = new Date(to);
        if (!Number.isNaN(toDate.getTime())) query.createdAt.$lte = toDate;
      }
      if (Object.keys(query.createdAt).length === 0) delete query.createdAt;
    }

    const fullMocks = await FullMockSession.find(query)
      .select('title createdAt readingLiveSessionId listeningLiveSessionId results.overallBand')
      .sort({ createdAt: -1 })
      .limit(200);
    res.json({ fullMocks });
  } catch (err) {
    console.error('Failed to list full mock tests:', err);
    res.status(500).json({ error: 'Failed to load full mock tests.' });
  }
});

/**
 * GET /api/full-mocks/:id
 * The unified scorecard: Reading/Listening are read LIVE from Submission
 * (via the linked LiveSession ids), merged in-memory with each student's
 * stored Writing/Speaking, with overallBand recomputed fresh on every call
 * — see computeOverallBand and mockResultSchema's own comment on why the
 * persisted `overallBand` field is only ever a convenience cache, never
 * the source of truth this response uses.
 */
router.get('/:id', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'That full mock test id is not valid.' });
  }
  try {
    const fullMock = await FullMockSession.findById(req.params.id);
    if (!fullMock) {
      return res.status(404).json({ error: 'This full mock test no longer exists — it may have been deleted.' });
    }
    const denialReason = ownershipDenialReason(fullMock, req.user);
    if (denialReason) {
      console.warn(`[full-mock] GET /:id denied for ${req.params.id}: ${denialReason}`);
      return res.status(404).json({ error: "This full mock test doesn't belong to your account." });
    }

    const [readingSession, listeningSession, readingSubs, listeningSubs] = await Promise.all([
      fullMock.readingLiveSessionId ? LiveSession.findById(fullMock.readingLiveSessionId) : null,
      fullMock.listeningLiveSessionId ? LiveSession.findById(fullMock.listeningLiveSessionId) : null,
      fullMock.readingLiveSessionId ? Submission.find({ liveSessionId: fullMock.readingLiveSessionId }) : [],
      fullMock.listeningLiveSessionId ? Submission.find({ liveSessionId: fullMock.listeningLiveSessionId }) : [],
    ]);
    const readingByStudent = new Map(readingSubs.map((s) => [String(s.student), s]));
    const listeningByStudent = new Map(listeningSubs.map((s) => [String(s.student), s]));

    const results = fullMock.results.map((r) => {
      const reading = readingByStudent.get(String(r.studentId));
      const listening = listeningByStudent.get(String(r.studentId));
      const overallBand = computeOverallBand({
        readingBand: reading?.bandScore ?? null,
        listeningBand: listening?.bandScore ?? null,
        writingBand: r.writingBand,
        speakingBand: r.speakingBand,
      });
      return {
        studentId: String(r.studentId),
        studentName: r.studentName,
        reading: reading
          ? { score: reading.score, totalQuestions: reading.totalQuestions, bandScore: reading.bandScore }
          : null,
        listening: listening
          ? { score: listening.score, totalQuestions: listening.totalQuestions, bandScore: listening.bandScore }
          : null,
        writingBand: r.writingBand,
        writingFeedback: r.writingFeedback,
        speakingBand: r.speakingBand,
        speakingFeedback: r.speakingFeedback,
        overallBand,
        gradedAt: r.gradedAt,
      };
    });

    res.json({
      fullMock: {
        _id: fullMock._id,
        title: fullMock.title,
        createdAt: fullMock.createdAt,
        readingSession: readingSession
          ? { _id: readingSession._id, title: readingSession.title, testTitle: readingSession.testTitle, status: readingSession.status }
          : null,
        listeningSession: listeningSession
          ? { _id: listeningSession._id, title: listeningSession.title, testTitle: listeningSession.testTitle, status: listeningSession.status }
          : null,
        results,
      },
    });
  } catch (err) {
    console.error('Failed to fetch full mock test:', err);
    res.status(500).json({ error: 'Failed to fetch the full mock test.' });
  }
});

/**
 * PUT /api/full-mocks/:id/results/:studentId
 * Body: { writingBand?, writingFeedback?, speakingBand?, speakingFeedback? }
 * "Manual Grading" save — the only write path for Writing/Speaking, since
 * neither module has an auto-checker (see models/Submission.js's module
 * enum, which only covers 'reading'/'listening'). A band field left blank
 * ('', null, or undefined) clears that score rather than erroring; anything
 * that doesn't parse as a number is rejected with a 400 instead of being
 * silently coerced to 0 or NaN.
 */
router.put('/:id/results/:studentId', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'That full mock test id is not valid.' });
  }
  try {
    const fullMock = await FullMockSession.findById(req.params.id);
    if (!fullMock) {
      return res.status(404).json({ error: 'This full mock test no longer exists — it may have been deleted.' });
    }
    const denialReason = ownershipDenialReason(fullMock, req.user);
    if (denialReason) {
      console.warn(`[full-mock] PUT results denied for ${req.params.id}: ${denialReason}`);
      return res.status(404).json({ error: "This full mock test doesn't belong to your account." });
    }

    const result = fullMock.results.find((r) => String(r.studentId) === String(req.params.studentId));
    if (!result) {
      return res.status(404).json({ error: 'This student is not on this mock test roster.' });
    }

    const { writingBand, writingFeedback, speakingBand, speakingFeedback } = req.body;
    // undefined return value is a distinct "this didn't parse" signal from
    // null ("the teacher explicitly cleared this band") — see the two
    // `=== undefined` checks below, which turn only the former into a 400.
    const clampBand = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      if (Number.isNaN(n)) return undefined;
      return Math.max(0, Math.min(9, n));
    };

    const nextWriting = clampBand(writingBand);
    const nextSpeaking = clampBand(speakingBand);
    if (nextWriting === undefined || nextSpeaking === undefined) {
      return res.status(400).json({ error: 'Writing/Speaking bands must be numbers between 0 and 9 (or left blank).' });
    }

    result.writingBand = nextWriting;
    if (typeof writingFeedback === 'string') result.writingFeedback = writingFeedback;
    result.speakingBand = nextSpeaking;
    if (typeof speakingFeedback === 'string') result.speakingFeedback = speakingFeedback;
    result.gradedAt = new Date();

    // Best-effort cache refresh for the persisted document — see this
    // route's own doc comment and mockResultSchema's comment on why GET
    // /:id doesn't depend on this being perfectly fresh.
    const [reading, listening] = await Promise.all([
      fullMock.readingLiveSessionId
        ? Submission.findOne({ liveSessionId: fullMock.readingLiveSessionId, student: req.params.studentId })
        : null,
      fullMock.listeningLiveSessionId
        ? Submission.findOne({ liveSessionId: fullMock.listeningLiveSessionId, student: req.params.studentId })
        : null,
    ]);
    result.overallBand = computeOverallBand({
      readingBand: reading?.bandScore ?? null,
      listeningBand: listening?.bandScore ?? null,
      writingBand: result.writingBand,
      speakingBand: result.speakingBand,
    });

    await fullMock.save();
    res.json({ result });
  } catch (err) {
    console.error('Failed to save manual grading:', err);
    res.status(500).json({ error: 'Failed to save this grading.' });
  }
});

module.exports = router;
