/**
 * listSuperAdmins.js
 * -------------------
 * Strictly read-only. Lists every existing 'superadmin' account (see
 * models/User.js) so a Super Admin's own email can be recovered when it's
 * been forgotten — without ever touching or exposing passwordHash.
 *
 * Companion to scripts/resetSuperAdminPassword.js: run this first to find
 * the right email, then pass that email to the reset script.
 *
 * Prints ONLY name, email, and createdAt for each superadmin account.
 * Never prints passwordHash, a token, or any other secret — and this
 * script issues a single .find().select(...) query and nothing else, so
 * there is no code path in it that could modify any document.
 *
 * Usage (run from the backend/ directory, so dotenv finds .env):
 *   node scripts/listSuperAdmins.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not set. Copy backend/.env.example to backend/.env and fill it in.');
    process.exit(1);
  }

  let exitCode = 0;

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    // select() here is the whole safety guarantee: passwordHash (and every
    // other field) is left out at the query layer, so it never even reaches
    // this process's memory, let alone the terminal.
    const superAdmins = await User.find({ role: 'superadmin' })
      .select('name email createdAt')
      .sort({ createdAt: 1 })
      .lean();

    if (superAdmins.length === 0) {
      console.log('No superadmin accounts exist yet. Create one with scripts/createSuperAdmin.js.');
      return;
    }

    console.log(`\nFound ${superAdmins.length} superadmin account${superAdmins.length === 1 ? '' : 's'}:\n`);
    for (const admin of superAdmins) {
      console.log(`  name:      ${admin.name}`);
      console.log(`  email:     ${admin.email}`);
      console.log(`  createdAt: ${admin.createdAt ? admin.createdAt.toISOString() : 'unknown'}`);
      console.log('');
    }
    console.log('To reset a password for one of these accounts:');
    console.log('  node scripts/resetSuperAdminPassword.js "<email>" "<NewPassword>"');
  } catch (err) {
    console.error('❌ Failed to list superadmin accounts:', err);
    exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit(exitCode);
  }
}

main();
