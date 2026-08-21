/**
 * createInstitute.js
 * ------------------
 * ⚠️ SUPERSEDED — institute accounts created this way have no Institute
 * tenant document and no `instituteId` (see models/Institute.js,
 * models/User.js), which is now a REQUIRED field on User. Since this
 * script only ever created a bare User with role 'institute', running it
 * today will fail validation on save. Use the Super Admin dashboard
 * (/super-admin → POST /api/super/register-institute, routes/superAdmin.js)
 * instead — it creates both the Institute tenant record and this same
 * kind of linked User, correctly wired together.
 *
 * Left in place for reference/history rather than deleted outright.
 *
 * Usage (run from the backend/ directory, so dotenv finds .env):
 *   node scripts/createInstitute.js "My Institute" "admin@inst.com" "pass123" "9876543210"
 */

require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function printUsageAndExit() {
  console.error('Usage: node scripts/createInstitute.js "<Name>" "<Email>" "<Password>" "<ContactNumber>"');
  console.error('Example: node scripts/createInstitute.js "My Institute" "admin@inst.com" "pass123" "9876543210"');
  process.exit(1);
}

async function main() {
  const [, , rawName, rawEmail, rawPassword, rawContactNumber] = process.argv;

  // --- Validate inputs before ever touching the network/DB ---------------
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

    const institute = await User.create({
      name,
      email,
      passwordHash,
      contactNumber,
      role: 'institute',
    });

    console.log('✅ Institute account created:');
    console.log(`   id:      ${institute._id}`);
    console.log(`   name:    ${institute.name}`);
    console.log(`   email:   ${institute.email}`);
    console.log(`   contact: ${institute.contactNumber}`);
    console.log('They can now log in via POST /api/auth/login with this email and password.');
  } catch (err) {
    if (err.code === 11000) {
      console.error(`❌ A user with the email "${email}" already exists.`);
    } else if (err.name === 'ValidationError') {
      console.error('❌ Validation failed:', err.message);
    } else {
      console.error('❌ Failed to create institute:', err);
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
