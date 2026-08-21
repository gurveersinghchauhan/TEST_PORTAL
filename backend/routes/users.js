const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Batch = require('../models/Batch');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const SALT_ROUNDS = 10;

/**
 * Shared creation logic for both /add-teacher and /add-student — the two
 * routes only differ in the role being created and which field links the
 * new account back to its creator (institute -> teacher, teacher -> student).
 * The parent id always comes from req.user.id (the verified JWT), never
 * from the request body, so an institute can only ever create teachers
 * under itself, and a teacher only students under itself.
 */
async function createLinkedUser(req, res, { role, parentField }) {
  try {
    const { name, email, password, contactNumber, batchId } = req.body;

    if (!name || !email || !password || !contactNumber) {
      return res.status(400).json({ error: 'name, email, password and contactNumber are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    // Every account created here inherits the creator's own tenant
    // verbatim (an institute creating a teacher, or a teacher creating a
    // student) — the SAME instituteId already sitting on the creator's own
    // verified JWT (see middleware/auth.js). That's what makes tenant
    // isolation automatic: nothing here has to re-derive or guess it.
    const instituteId = req.user.instituteId;
    if (!instituteId) {
      return res.status(400).json({
        error: 'Your account is not linked to an institute tenant. Please log out and back in, then try again.',
      });
    }

    // Students must belong to a batch, and that batch must actually belong
    // to the SAME institute tenant the creating teacher belongs to —
    // otherwise a teacher could (accidentally or not) link a student to
    // another institute's batch just by guessing/copying its id. Scoping
    // straight on Batch.instituteId means a batchId from another tenant
    // simply won't match, same as it not existing at all.
    let batch = null;
    if (role === 'student') {
      if (!batchId || !mongoose.Types.ObjectId.isValid(batchId)) {
        return res.status(400).json({ error: 'A valid batchId is required.' });
      }

      batch = await Batch.findOne({ _id: batchId, instituteId, isActive: true });
      if (!batch) {
        return res.status(400).json({ error: 'That batch does not belong to your institute, or no longer exists.' });
      }
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const user = await User.create({
      name,
      email: String(email).toLowerCase().trim(),
      passwordHash,
      contactNumber: String(contactNumber).trim(),
      role,
      instituteId,
      [parentField]: req.user.id,
      ...(batch ? { batchId: batch._id } : {}),
    });

    res.status(201).json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        contactNumber: user.contactNumber,
        role: user.role,
        batchId: user.batchId || null,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    console.error(`Failed to create ${role}:`, err);
    res.status(500).json({ error: `Failed to create ${role}.` });
  }
}

/**
 * POST /api/users/add-teacher
 * Tier 2 — only a logged-in 'institute' account can create teachers under itself.
 * Body: { name, email, password, contactNumber }
 */
router.post('/add-teacher', requireAuth, requireRole('institute'), (req, res) =>
  createLinkedUser(req, res, { role: 'teacher', parentField: 'institute' })
);

/**
 * POST /api/users/add-student
 * Tier 3 — only a logged-in 'teacher' account can create students under itself.
 * Body: { name, email, password, contactNumber, batchId }
 */
router.post('/add-student', requireAuth, requireRole('teacher'), (req, res) =>
  createLinkedUser(req, res, { role: 'student', parentField: 'teacher' })
);

/**
 * GET /api/users/teachers
 * Lists every teacher belonging to the logged-in institute — powers the
 * "manage teachers" table on the Institute Dashboard. Never returns
 * passwordHash.
 */
router.get('/teachers', requireAuth, requireRole('institute'), async (req, res) => {
  try {
    const teachers = await User.find({ role: 'teacher', instituteId: req.user.instituteId })
      .select('name email contactNumber createdAt')
      .sort({ createdAt: -1 });

    res.json({ teachers });
  } catch (err) {
    console.error('Failed to list teachers:', err);
    res.status(500).json({ error: 'Failed to list teachers.' });
  }
});

/**
 * Accepts ?batchIds=a&batchIds=b (repeated) or ?batchIds=a,b (comma-separated)
 * and returns only the well-formed ObjectId strings out of it.
 */
function parseBatchIds(raw) {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  return parts.map((s) => String(s).trim()).filter((s) => s && mongoose.Types.ObjectId.isValid(s));
}

/**
 * GET /api/users/students?batchIds=<id>&batchIds=<id2>
 * Institute & teacher — fetches students belonging to ANY of the given
 * batches, so a teacher managing several batches can see a combined roster
 * in one view. Strictly scoped to the caller's own instituteId — a
 * batchId from another tenant simply matches nothing, so there's no need
 * to separately verify batch ownership before filtering. Omitting
 * batchIds entirely defaults to "every student in my institute."
 */
router.get('/students', requireAuth, requireRole('institute', 'teacher'), async (req, res) => {
  try {
    const instituteId = req.user.instituteId;
    if (!instituteId) {
      return res.json({ students: [] });
    }

    const requestedBatchIds = parseBatchIds(req.query.batchIds);

    const filter = { role: 'student', instituteId };
    if (requestedBatchIds.length > 0) {
      filter.batchId = { $in: requestedBatchIds };
    }

    const students = await User.find(filter)
      .select('name email contactNumber batchId createdAt')
      .populate('batchId', 'name')
      .sort({ name: 1 });

    res.json({ students });
  } catch (err) {
    console.error('Failed to list students:', err);
    res.status(500).json({ error: 'Failed to list students.' });
  }
});

module.exports = router;
