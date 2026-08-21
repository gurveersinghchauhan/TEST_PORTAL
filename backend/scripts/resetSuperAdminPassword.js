/**
 * resetSuperAdminPassword.js
 * ----------------------------
 * Resets the password for an EXISTING 'superadmin' account (see
 * models/User.js) when the original password has been lost. Companion to
 * scripts/listSuperAdmins.js — run that first if you don't remember which
 * email the account was created under.
 *
 * Safety properties, by construction:
 *  - The lookup filter is { email, role: 'superadmin' } — this can only
 *    ever match a document that already has role: 'superadmin'. It cannot
 *    match (and therefore cannot modify) an institute/teacher/student
 *    account, even if the email happens to collide with one (it won't,
 *    since email is unique across the whole User collection).
 *  - If no matching superadmin is found, the script logs that and exits
 *    WITHOUT calling .save()/.updateOne() at all — no document is created
 *    or touched. This never falls back to creating a new account; that's
 *    what scripts/createSuperAdmin.js is for, and is not this script's job.
 *  - Only passwordHash is updated. name, email, contactNumber, role,
 *    instituteId, createdAt, etc. are left exactly as they were.
 *  - The new password and the resulting hash are never logged — only a
 *    confirmation that the reset happened, for which email.
 *
 * Uses the same bcrypt + SALT_ROUNDS = 10 approach as
 * scripts/createSuperAdmin.js, so the resulting passwordHash is
 * indistinguishable from one created the normal way — nothing about the
 * account's shape changes, only the password value.
 *
 * Usage (run from the backend/ directory, so dotenv finds .env):
 *   node scripts/resetSuperAdminPassword.js "<Email>" "<NewPassword>"
 *
 * Example:
 *   node scripts/resetSuperAdminPassword.js "admin@bandultra.com" "NewPass1234"
 */

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const SALT_ROUNDS = 10; // matches scripts/createSuperAdmin.js
const MIN_PASSWORD_LENGTH = 8; // matches scripts/createSuperAdmin.js

function printUsageAndExit() {
  console.error('Usage: node scripts/resetSuperAdminPassword.js "<Email>" "<NewPassword>"');
  console.error('Example: node scripts/resetSuperAdminPassword.js "admin@bandultra.com" "NewPass1234"');
  console.error('Don\'t know the email? Run: node scripts/listSuperAdmins.js');
  process.exit(1);
}

async function main() {
  const [, , rawEmail, newPassword] = process.argv;

  if (!rawEmail || !newPassword) {
    printUsageAndExit();
  }

  const email = rawEmail.trim().toLowerCase();

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    console.error(`❌ New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not set. Copy backend/.env.example to backend/.env and fill it in.');
    process.exit(1);
  }

  let exitCode = 0;

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // The { role: 'superadmin' } half of this filter is what makes the
    // whole script safe — see the file-level comment above. It is not
    // optional and must not be removed or relaxed.
    const superAdmin = await User.findOne({ email, role: 'superadmin' });

    if (!superAdmin) {
      console.error(`❌ No superadmin account found with email "${email}". Nothing was changed.`);
      console.error('   Run node scripts/listSuperAdmins.js to see existing superadmin accounts.');
      exitCode = 1;
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    superAdmin.passwordHash = passwordHash;
    await superAdmin.save();

    console.log(`✅ Password reset for superadmin account "${superAdmin.email}" (id: ${superAdmin._id}).`);
    console.log('They can now log in via POST /api/auth/login with this email and the new password.');
  } catch (err) {
    console.error('❌ Failed to reset password:', err);
    exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit(exitCode);
  }
}

main();
