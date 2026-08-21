/**
 * deleteUser.js
 * -------------
 * Small CLI utility to remove a User account by email — e.g. for cleaning
 * up a record created before a schema change (like the contactNumber field)
 * that would otherwise sit there permanently missing the new field.
 *
 * Usage (run from the backend/ directory, so dotenv finds .env):
 *   node scripts/deleteUser.js bad@email.com
 */

require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');

function printUsageAndExit() {
  console.error('Usage: node scripts/deleteUser.js <email>');
  console.error('Example: node scripts/deleteUser.js bad@email.com');
  process.exit(1);
}

async function main() {
  const [, , rawEmail] = process.argv;

  if (!rawEmail) {
    printUsageAndExit();
  }

  const email = rawEmail.trim().toLowerCase();

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not set. Copy backend/.env.example to backend/.env and fill it in.');
    process.exit(1);
  }

  let exitCode = 0;

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    const deleted = await User.findOneAndDelete({ email });

    if (!deleted) {
      console.log(`ℹ️  No user found with email "${email}" — nothing to delete.`);
      exitCode = 1; // nothing happened, so the process signals "no-op" like `rm` on a missing file
    } else {
      console.log('✅ User deleted:');
      console.log(`   id:    ${deleted._id}`);
      console.log(`   name:  ${deleted.name}`);
      console.log(`   email: ${deleted.email}`);
      console.log(`   role:  ${deleted.role}`);
    }
  } catch (err) {
    console.error('❌ Failed to delete user:', err);
    exitCode = 1;
  } finally {
    // Crucial: without this the script hangs forever on the open Mongo
    // connection instead of returning control to the terminal.
    await mongoose.disconnect();
    process.exit(exitCode);
  }
}

main();
