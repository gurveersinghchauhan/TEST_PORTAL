const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Institute = require('../models/Institute');

const router = express.Router();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * POST /api/auth/login
 * Universal login for all 3 roles (institute / teacher / student) — one
 * route, the role comes back inside the token instead of the client having
 * to say up front who it's logging in as. Verifies the password via bcrypt
 * and returns a JWT carrying { id, role }.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });

    // Same generic message whether the email doesn't exist or the password
    // is wrong — don't give an attacker a way to enumerate valid emails.
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Kill switch: every account now carries the Institute tenant it
    // belongs to directly (user.instituteId — see models/User.js), so this
    // check applies uniformly to the institute owner AND every teacher/
    // student under them, not just the owner's own login. Blocking one
    // institute from the Super Admin dashboard immediately locks out its
    // whole tenant. Accounts with no instituteId (pre-migration data) have
    // nothing to check against, so they're unaffected.
    if (user.instituteId) {
      const institute = await Institute.findById(user.instituteId);
      if (institute && institute.status === 'blocked') {
        return res.status(403).json({ error: 'Account suspended. Contact administrator.' });
      }
    }

    // instituteId rides in the token itself so every protected route can
    // read req.user.instituteId straight off the verified JWT (see
    // middleware/auth.js) — no extra DB lookup needed to know which tenant
    // a request belongs to.
    const token = jwt.sign(
      { id: user._id, role: user.role, instituteId: user.instituteId || null },
      process.env.JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        // A student's own teacher id, and a teacher's own institute id —
        // the frontend needs these to join the right live-session socket
        // room (e.g. StudentTestPage joining its teacher's dashboard room).
        // null/undefined for roles that don't have one.
        teacher: user.teacher || null,
        institute: user.institute || null,
        instituteId: user.instituteId || null,
      },
    });
  } catch (err) {
    console.error('Login failed:', err);
    res.status(500).json({ error: 'Failed to log in.' });
  }
});

module.exports = router;
