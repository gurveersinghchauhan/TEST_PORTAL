const express = require('express');
const mongoose = require('mongoose');
const LiveSession = require('../models/LiveSession');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ROOM_TEACHER, ROOM_STUDENT } = require('../socketHandler');

const router = express.Router();

/**
 * Whether `reqUser` may act on `session` — and if not, a specific reason
 * (never sent verbatim to the client; logged server-side and collapsed to
 * a generic-but-distinguishable message in the response — see the routes
 * below). Deliberately does NOT check instituteId for a teacher: teacherId
 * alone already fully and safely identifies ownership (a session's
 * teacherId can only ever be that one teacher), so gating it behind an
 * ADDITIONAL instituteId match was redundant at best — and at worst, wrong
 * whenever that field was missing. It was: every LiveSession created
 * before socketHandler.js's initiateLiveTest started setting instituteId
 * has it as null (the schema's default), so the old
 * `String(session.instituteId) !== String(req.user.instituteId)` check
 * failed for EVERY teacher trying to act on EVERY session they'd ever
 * started — which is exactly what surfaced as "Live session not found" on
 * the End Live Session button. Institute-role access still checks
 * instituteId, since that's the only signal available to scope "every
 * session across this whole institute" to the right tenant.
 */
function ownershipDenialReason(session, reqUser) {
  if (reqUser.role === 'teacher') {
    return String(session.teacherId) === String(reqUser.id)
      ? null
      : `teacherId mismatch (session.teacherId=${session.teacherId}, req.user.id=${reqUser.id})`;
  }
  return String(session.instituteId) === String(reqUser.instituteId)
    ? null
    : `instituteId mismatch (session.instituteId=${session.instituteId}, req.user.instituteId=${reqUser.instituteId})`;
}

/**
 * GET /api/live-sessions?search=<text>&from=<ISO date>&to=<ISO date>&status=<active|completed>
 * -----------------------------------------------------------------------
 * Powers TestRecord.jsx's "search past sessions by title/date" list —
 * every LIVE TEST broadcast this teacher has ever started (or, for an
 * institute viewer, every broadcast across the whole institute), newest
 * first. `search` matches against the teacher-chosen `title` (see
 * models/LiveSession.js — NOT the underlying Test's own title) OR the
 * denormalized `testTitle`, case-insensitively, so "find last week's
 * mock" and "find the Cambridge 21 session" both work from one box.
 * `from`/`to` filter on `createdAt` (inclusive); either can be given alone
 * for an open-ended range. `status` is an optional exact filter
 * ('active' | 'completed') — omitted, both show.
 *
 * Scoped the same way every other tenant-aware list route in this app is:
 * a teacher only ever sees their OWN sessions (teacherId: req.user.id — see
 * ownershipDenialReason's doc comment above for why this alone is enough,
 * with no additional instituteId condition); an institute viewer sees
 * every session across their whole institute (instituteId only, no
 * teacherId filter) — same distinction testUpload.js's GET /api/tests
 * draws.
 */
router.get('/', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const { search, from, to, status } = req.query;

    const query = req.user.role === 'teacher' ? { teacherId: req.user.id } : { instituteId: req.user.instituteId };

    if (status === 'active' || status === 'completed') {
      query.status = status;
    }

    if (search && search.trim()) {
      const re = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ title: re }, { testTitle: re }];
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

    const sessions = await LiveSession.find(query).sort({ createdAt: -1 }).limit(200);
    res.json({ sessions });
  } catch (err) {
    console.error('Failed to list live sessions:', err);
    res.status(500).json({ error: 'Failed to load live test history.' });
  }
});

/**
 * GET /api/live-sessions/:id
 * Single session detail (title, roster, status) — a light convenience
 * lookup for TestRecord.jsx to re-confirm a session's own metadata (e.g.
 * after deep-linking or a refresh) without re-running the whole search
 * list query. Same tenant scoping as the list route above (see
 * ownershipDenialReason).
 */
router.get('/:id', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'That live session id is not valid.' });
  }
  try {
    const session = await LiveSession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'This live session no longer exists — it may have been deleted.' });
    }
    const denialReason = ownershipDenialReason(session, req.user);
    if (denialReason) {
      console.warn(`[live-test] GET /:id denied for session ${req.params.id}: ${denialReason}`);
      return res.status(404).json({ error: "This live session doesn't belong to your account." });
    }
    res.json({ session });
  } catch (err) {
    console.error('Failed to fetch live session:', err);
    res.status(500).json({ error: 'Failed to fetch live session.' });
  }
});

/**
 * PATCH /api/live-sessions/:id/end
 * -----------------------------------------------------------------------
 * The REST counterpart to socketHandler.js's 'end_live_session' socket
 * event — a real HTTP call that flips LiveSession.status to 'completed'
 * directly in MongoDB, independent of whether the teacher's socket happens
 * to be connected at that instant. LiveTestMonitor.jsx's "End Live Session"
 * button now calls THIS first (the authoritative persistence step) rather
 * than relying solely on a socket emit — a flaky/reconnecting socket right
 * when the teacher clicks it can no longer leave the session stuck at
 * status:'active' forever, which (now that TestRecord.jsx's search only
 * lists status:'completed' sessions — see the GET / route above) would
 * otherwise mean the session never shows up in Test Record at all.
 *
 * Same "snapshot who's still `joined` BEFORE flipping status, then
 * auto-force-submit each of them" flow as socketHandler.js's endLiveSession
 * — kept in sync with it so ending via REST and ending via socket behave
 * identically. Still emits the same 'force_submit_test' / 'live_session_ended'
 * socket events afterward (via req.app.get('io'), set once in server.js) so
 * every connected student/teacher client stays in sync exactly as before —
 * only the initial trigger changed from "socket emit + ack" to "HTTP call
 * + JSON response".
 *
 * Idempotent: calling this again on an already-completed session is a
 * harmless no-op that just returns its current state, rather than erroring
 * or re-submitting anyone a second time.
 *
 * Was previously always failing with "Live session not found" — see
 * ownershipDenialReason's doc comment above for the root cause (an
 * instituteId that was never actually being set at session-creation time)
 * and socketHandler.js's initiateLiveTest for the fix to where it's set.
 * This route no longer depends on instituteId for a teacher's own session
 * at all, so it now also works correctly for sessions that were created
 * before that fix shipped (their instituteId stays null forever unless
 * something else backfills it, but teacherId — the real ownership check —
 * was always correct).
 */
router.patch('/:id/end', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  // Debug logging per request — cheap and left in permanently (this whole
  // route only ever runs on an explicit "End Live Session" click, so the
  // volume is negligible) specifically so a future "not found"-style report
  // can be diagnosed straight from the server console instead of having to
  // reproduce it with extra instrumentation added after the fact.
  console.log(`[live-test] PATCH /:id/end: sessionId=${req.params.id} requester=${req.user.role}:${req.user.id}`);

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    console.warn(`[live-test] PATCH /:id/end: "${req.params.id}" is not a valid ObjectId — rejecting before hitting the DB.`);
    return res.status(400).json({ error: 'That live session id is not valid.' });
  }

  try {
    // No need to wrap req.params.id in `new mongoose.Types.ObjectId(...)`
    // here — findById already casts a valid hex string to ObjectId
    // internally, and the isValid() check just above already rejects
    // anything that wouldn't cast cleanly. An explicit `new ObjectId(...)`
    // would just be redundant with what findById already does.
    const before = await LiveSession.findById(req.params.id);
    if (!before) {
      console.warn(`[live-test] PATCH /:id/end: no LiveSession found for id ${req.params.id}.`);
      return res.status(404).json({ error: 'This live session no longer exists — it may have been deleted.' });
    }

    const denialReason = ownershipDenialReason(before, req.user);
    if (denialReason) {
      console.warn(`[live-test] PATCH /:id/end: denied for session ${req.params.id}: ${denialReason}`);
      return res.status(404).json({ error: "This live session doesn't belong to your account." });
    }

    if (before.status === 'completed') {
      return res.json({ session: before, autoSubmittedCount: 0 });
    }

    // Snapshot BEFORE flipping status — exactly who still needs to be
    // force-submitted so their result is consistent and finalized once
    // this broadcast closes (see endLiveSession's own comment for the full
    // rationale — this mirrors it).
    const stillInProgress = before.participants.filter((p) => p.status === 'joined');

    const session = await LiveSession.findByIdAndUpdate(
      req.params.id,
      { $set: { status: 'completed' } },
      { returnDocument: 'after' }
    );

    const io = req.app.get('io');
    if (io) {
      stillInProgress.forEach((p) => {
        io.to(ROOM_STUDENT(p.studentId)).emit('force_submit_test', { sessionId: String(session._id) });
      });
      // Broadcast (not just this HTTP response) so a second open monitor
      // tab / another teacher watching the same session also flips to the
      // ended state immediately, same as the socket-driven path.
      io.to(ROOM_TEACHER(session.teacherId)).emit('live_session_ended', {
        sessionId: String(session._id),
        autoSubmittedStudentIds: stillInProgress.map((p) => String(p.studentId)),
      });
    } else {
      // Shouldn't happen outside of tests (server.js always sets this) —
      // the status change above already persisted either way, so this is
      // only a loss of the real-time relay, not of correctness.
      console.warn('[live-test] PATCH /:id/end: no io instance on app — skipping socket notifications.');
    }

    res.json({ session, autoSubmittedCount: stillInProgress.length });
  } catch (err) {
    console.error('Failed to end live session via REST:', err);
    res.status(500).json({ error: 'Failed to end the live session.' });
  }
});

module.exports = router;
