const express = require('express');
const bcrypt = require('bcryptjs');
const Institute = require('../models/Institute');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Every route below acts across every tenant (register/list/block any
// institute), so every route in this file requires a logged-in 'superadmin'
// account — the same JWT-based requireAuth/requireRole guard already used
// on every other protected route in the app (see middleware/auth.js), just
// applied once at the router level so no route in this file can accidentally
// ship unprotected. Anonymous requests get 401 (no/invalid token);
// authenticated non-superadmin requests (institute/teacher/student) get 403.
// Provision a superadmin account with scripts/createSuperAdmin.js, then log
// in via the existing POST /api/auth/login exactly like any other account.
router.use(requireAuth, requireRole('superadmin'));

const SALT_ROUNDS = 10;

// Fields safe to send to the frontend — passwordHash never leaves the server.
const PUBLIC_FIELDS =
  'instituteName ownerName username email address primaryContact secondaryContact status createdAt';

/**
 * POST /api/super/register-institute
 * -----------------------------------
 * Super Admin onboards a new institute (tenant). Hashes the password,
 * rejects duplicate usernames, and saves the record.
 *
 * To make the new institute immediately usable — not just a row in the
 * Super Admin table — this also provisions a matching login account in the
 * existing `User` collection (role: 'institute', same email + password
 * hash) so the owner can sign in through the normal Login page right away.
 * That's the same account the kill-switch check in auth.js looks up by
 * email when deciding whether to block a login.
 *
 * Body: { instituteName, ownerName, username, password, email, address,
 *         primaryContact, secondaryContact? }
 */
router.post('/register-institute', async (req, res) => {
  try {
    const {
      instituteName,
      ownerName,
      username,
      password,
      email,
      address,
      primaryContact,
      secondaryContact,
    } = req.body;

    const missing = [];
    if (!instituteName || !String(instituteName).trim()) missing.push('instituteName');
    if (!ownerName || !String(ownerName).trim()) missing.push('ownerName');
    if (!username || !String(username).trim()) missing.push('username');
    if (!password) missing.push('password');
    if (!email || !String(email).trim()) missing.push('email');
    if (!address || !String(address).trim()) missing.push('address');
    if (!primaryContact || !String(primaryContact).trim()) missing.push('primaryContact');

    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}.` });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const normalizedUsername = String(username).trim();
    const normalizedEmail = String(email).toLowerCase().trim();

    const existingUsername = await Institute.findOne({ username: normalizedUsername });
    if (existingUsername) {
      return res.status(409).json({ error: 'That username is already taken by another institute.' });
    }

    const existingEmail = await Institute.findOne({ email: normalizedEmail });
    if (existingEmail) {
      return res.status(409).json({ error: 'An institute is already registered with this email.' });
    }

    const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);

    const institute = await Institute.create({
      instituteName: String(instituteName).trim(),
      ownerName: String(ownerName).trim(),
      username: normalizedUsername,
      passwordHash,
      email: normalizedEmail,
      address: String(address).trim(),
      primaryContact: String(primaryContact).trim(),
      secondaryContact: secondaryContact ? String(secondaryContact).trim() : '',
      status: 'active',
    });

    // Best-effort: also provision the actual login account for this
    // institute (same email/passwordHash) so it can sign in through the
    // normal portal login. If a User with this email already exists for
    // some other reason, don't fail the whole registration over it — the
    // Institute record (and its kill switch) is still valid on its own.
    try {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (!existingUser) {
        await User.create({
          name: String(ownerName).trim(),
          email: normalizedEmail,
          passwordHash,
          contactNumber: String(primaryContact).trim(),
          role: 'institute',
          // This account IS the tenant boundary for everything created
          // under it — every teacher/student it creates inherits this
          // same instituteId verbatim (see routes/users.js). Without this,
          // User.create() fails its required `instituteId` validator and
          // the auto-provisioned login account silently never gets
          // created (caught by the try/catch below), leaving the new
          // institute registered but unable to log in.
          instituteId: institute._id,
        });
      }
    } catch (linkErr) {
      console.error('Institute registered, but failed to auto-provision its login User:', linkErr);
    }

    const { passwordHash: _omit, ...safeInstitute } = institute.toObject();
    res.status(201).json({ institute: safeInstitute });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'That username or email is already registered.' });
    }
    console.error('Institute registration failed:', err);
    res.status(500).json({ error: 'Failed to register institute.' });
  }
});

/**
 * GET /api/super/institutes
 * Lists every registered institute, newest first. Never returns passwordHash.
 */
router.get('/institutes', async (req, res) => {
  try {
    const institutes = await Institute.find().select(PUBLIC_FIELDS).sort({ createdAt: -1 });
    res.json({ institutes });
  } catch (err) {
    console.error('Failed to list institutes:', err);
    res.status(500).json({ error: 'Failed to list institutes.' });
  }
});

/**
 * PATCH /api/super/institutes/:id/status
 * The kill switch: flips an institute between 'active' and 'blocked'.
 * Body: { status: 'active' | 'blocked' }
 */
router.patch('/institutes/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'blocked'." });
    }

    const institute = await Institute.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { returnDocument: 'after', runValidators: true }
    ).select(PUBLIC_FIELDS);

    if (!institute) {
      return res.status(404).json({ error: 'Institute not found.' });
    }

    res.json({ institute });
  } catch (err) {
    console.error('Failed to update institute status:', err);
    res.status(500).json({ error: 'Failed to update institute status.' });
  }
});

module.exports = router;
