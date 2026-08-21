/**
 * createSuperAdmin.js
 * -------------------
 * Provisions a 'superadmin' account (see models/User.js) — the role that
 * unlocks routes/superAdmin.js's cross-tenant routes (register/list/block
 * any institute) now that they require requireAuth + requireRole('superadmin')
 * instead of being open to anyone.
 *
 * There is deliberately no public route to create this role — it's a
 * platform-operator account, not something any tenant should ever be able
 * to self-provision. This CLI script is the only way to create one, exactly
 * like scripts/createInstitute.js was the only way to create an institute
 * account before the Super Admin dashboard existed.
 *
 * A superadmin account has no instituteId (it sits above every tenant, not
 * inside one — see the required() exception on User.instituteId) and logs
 * in through the SAME POST /api/auth/login used by every other role; the
 * JWT it gets back just carries role: 'superadmin' instead.
 *
 * Usage (run from the backend/ directory, so dotenv finds .env):
 *   node scripts/createSuperAdmin.js "<Name>" "<Email>" "<Password>" "<ContactNumber>"
 */

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function printUsageAndExit() {
  console.error('Usage: node scripts/createSuperAdmin.js "<Name>" "<Email>" "<Password>" "<ContactNumber>"');
  console.error('Example: node scripts/createSuperAdmin.js "Platform Admin" "admin@bandultra.com" "pass1234" "9876543210"');
  process.exit(1);
}

async function main() {
  const [, , rawName, rawEmail, rawPassword, rawContactNumber] = process.argv;

  if (!rawName || !rawEmail || !rawPassword || !rawContactNumber) {
    printUsageAndExit();
  }

  const name = rawName.trim();
  const email = rawEmail.trim().toLowerCase();
  const password = rawPassword;
  const contactNumber = rawContactNumber.trim();

  if (!name) {
    console.error('❌ Name cannot be empty.');
    process.exit(1);
  }
  if (!EMAIL_PATTERN.test(email)) {
    console.error(`❌ "${email}" doesn't look like a valid email address.`);
    process.exit(1);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`❌ Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(1);
  }
  if (!contactNumber) {
    console.error('❌ Contact number cannot be empty.');
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

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const superAdmin = await User.create({
      name,
      email,
      passwordHash,
      contactNumber,
      role: 'superadmin',
      // No instituteId — superadmin accounts sit above every tenant.
    });

    console.log('✅ Super Admin account created:');
    console.log(`   id:      ${superAdmin._id}`);
    console.log(`   name:    ${superAdmin.name}`);
    console.log(`   email:   ${superAdmin.email}`);
    console.log(`   contact: ${superAdmin.contactNumber}`);
    console.log('They can now log in via POST /api/auth/login with this email and password,');
    console.log('and use the returned token to call the routes under /api/super.');
  } catch (err) {
    if (err.code === 11000) {
      console.error(`❌ A user with the email "${email}" already exists.`);
    } else if (err.name === 'ValidationError') {
      console.error('❌ Validation failed:', err.message);
    } else {
      console.error('❌ Failed to create Super Admin account:', err);
    }
    exitCode = 1;
  } finally {
    // Crucial: without this the script hangs forever on the open Mongo
    // connection instead of returning control to the terminal.
    await mongoose.disconnect();
    process.exit(exitCode);
  }
}

main();
