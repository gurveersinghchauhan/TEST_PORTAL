const express = require('express');
const Batch = require('../models/Batch');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/batches
 * Institute-only — creates a batch under the logged-in institute's tenant.
 * Body: { name }
 */
router.post('/', requireAuth, requireRole('institute'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required.' });
    }
    if (!req.user.instituteId) {
      return res.status(400).json({
        error: 'Your account is not linked to an institute tenant. Please log out and back in, then try again.',
      });
    }

    const batch = await Batch.create({
      institute: req.user.id,
      instituteId: req.user.instituteId,
      name: String(name).trim(),
    });

    res.status(201).json({ batch });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A batch with this name already exists for your institute.' });
    }
    console.error('Failed to create batch:', err);
    res.status(500).json({ error: 'Failed to create batch.' });
  }
});

/**
 * GET /api/batches
 * Institute & teacher — returns every active batch belonging to the
 * logged-in user's institute tenant, read straight off their own verified
 * JWT (req.user.instituteId) rather than re-derived — strict, and free.
 */
router.get('/', requireAuth, requireRole('institute', 'teacher'), async (req, res) => {
  try {
    const instituteId = req.user.instituteId;
    if (!instituteId) {
      // e.g. an account that somehow isn't linked to an institute tenant yet.
      return res.json({ batches: [] });
    }

    const batches = await Batch.find({ instituteId, isActive: true }).sort({ name: 1 });
    res.json({ batches });
  } catch (err) {
    console.error('Failed to list batches:', err);
    res.status(500).json({ error: 'Failed to list batches.' });
  }
});

module.exports = router;
