/**
 * migrateInstituteId.js
 * ----------------------
 * Phase 2 data-integrity migration: backfills `instituteId` on every
 * existing Test / Submission / LiveSession / FullMockSession document
 * BEFORE that field becomes `required: true` on those models (see
 * models/Test.js, models/Submission.js, models/LiveSession.js,
 * models/FullMockSession.js — all four already carry the `required: true`
 * change; this script is what makes existing data safe to load and save
 * under that new constraint).
 *
 * SAFETY MODEL
 * ------------
 *  - DRY-RUN BY DEFAULT. Nothing in the database is ever modified unless
 *    you pass --execute explicitly.
 *  - NEVER GUESSES. A document only gets an instituteId written if it can
 *    be traced back to exactly one, unambiguous, real Institute through
 *    its own existing relationships (see "How each collection is resolved"
 *    below). Anything that can't be traced this way — or that traces to
 *    more than one disagreeing answer — is left completely untouched and
 *    reported instead, every time, dry-run or not.
 *  - NEVER DELETES. This script only ever runs $set on the single
 *    `instituteId` field of documents it has already proven are safe to
 *    fix. No document is ever removed, and no other field is ever touched.
 *  - An instituteId that's already present is left alone even if it looks
 *    inconsistent with what this script would have derived — that's a
 *    genuine data conflict for a human to look at, not something safe to
 *    silently overwrite. It's still reported.
 *
 * How each collection is resolved
 * --------------------------------
 *   Test              <- createdBy (User)                 .instituteId
 *   LiveSession       <- teacherId (User)                  .instituteId
 *   FullMockSession   <- teacherId (User)                  .instituteId
 *   Submission        <- test (Test.instituteId), AND/OR
 *                        teacher / student, WHEN they happen to already be
 *                        real User ObjectIds (this app's Submission.student/
 *                        teacher are plain strings — see models/Submission.js
 *                        — so older documents may hold legacy non-ObjectId
 *                        values like "student_123"; those simply can't be
 *                        used as a User lookup and are skipped as a
 *                        candidate, not treated as an error).
 *                        If more than one candidate source resolves and
 *                        they disagree, the document is AMBIGUOUS and is
 *                        reported, never guessed. Submission resolution
 *                        reuses whatever this same run just resolved for
 *                        Test (even in --dry-run) so a Submission whose
 *                        Test also needed backfilling still gets an
 *                        accurate preview, without this script ever
 *                        actually writing to Test out of order.
 *
 * Usage (run from the backend/ directory, so dotenv finds .env):
 *   node scripts/migrateInstituteId.js                 # dry-run (default)
 *   node scripts/migrateInstituteId.js --dry-run        # same, explicit
 *   node scripts/migrateInstituteId.js --execute         # actually writes
 *
 * Always run without --execute first and read the full report before ever
 * passing --execute. Take a MongoDB Atlas backup (Atlas UI -> your cluster
 * -> Backup, or `mongodump --uri="$MONGO_URI"`) before your first --execute
 * run on real data, same as you would before any schema-tightening
 * migration.
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Test = require('../models/Test');
const Submission = require('../models/Submission');
const LiveSession = require('../models/LiveSession');
const FullMockSession = require('../models/FullMockSession');
const User = require('../models/User');
const Institute = require('../models/Institute');

const EXECUTE = process.argv.includes('--execute');

function isValidId(v) {
  return v != null && mongoose.Types.ObjectId.isValid(String(v));
}

/**
 * Fetches every document from `Model` with only the fields the resolver
 * needs (keeps this cheap even on large collections), plus a Set of every
 * real Institute _id (string form) so "has an instituteId" can mean
 * "has one that actually points at a real Institute", not just "the field
 * is non-null".
 */
async function loadInstituteIdSet() {
  const institutes = await Institute.find().select('_id');
  return new Set(institutes.map((i) => String(i._id)));
}

/**
 * Generic report shape every collection's migrate() returns, so the final
 * summary print is uniform.
 */
function newReport(name) {
  return {
    name,
    total: 0,
    alreadyValid: 0,
    alreadyValidButInconsistent: [], // { id, stored, derived }
    missingOrInvalid: 0,
    resolved: [], // { id, instituteId }
    ambiguous: [], // { id, candidates: {source: instituteId} }
    unresolvable: [], // { id, reason }
  };
}

async function resolveUserInstituteId(userId, userCache) {
  if (!isValidId(userId)) return null;
  const key = String(userId);
  if (userCache.has(key)) return userCache.get(key);
  const user = await User.findById(key).select('instituteId');
  const result = user && isValidId(user.instituteId) ? String(user.instituteId) : null;
  userCache.set(key, result);
  return result;
}

/**
 * Test <- createdBy
 */
async function migrateTest(validInstituteIds, userCache) {
  const report = newReport('Test');
  const docs = await Test.find().select('_id createdBy instituteId');
  report.total = docs.length;

  const resolvedMap = new Map(); // testId (string) -> resolved instituteId (string|null), for Submission's benefit

  for (const doc of docs) {
    const currentValid = isValidId(doc.instituteId) && validInstituteIds.has(String(doc.instituteId));
    const derived = await resolveUserInstituteId(doc.createdBy, userCache);

    if (currentValid) {
      report.alreadyValid++;
      resolvedMap.set(String(doc._id), String(doc.instituteId));
      if (derived && derived !== String(doc.instituteId)) {
        report.alreadyValidButInconsistent.push({ id: String(doc._id), stored: String(doc.instituteId), derived });
      }
      continue;
    }

    report.missingOrInvalid++;
    if (derived) {
      report.resolved.push({ id: String(doc._id), instituteId: derived });
      resolvedMap.set(String(doc._id), derived);
      if (EXECUTE) {
        await Test.updateOne({ _id: doc._id }, { $set: { instituteId: derived } });
      }
    } else {
      report.unresolvable.push({ id: String(doc._id), reason: 'createdBy user not found, or that user has no instituteId of their own.' });
      resolvedMap.set(String(doc._id), null);
    }
  }

  return { report, resolvedMap };
}

/**
 * LiveSession / FullMockSession <- teacherId (identical shape for both)
 */
async function migrateTeacherOwned(Model, name, validInstituteIds, userCache) {
  const report = newReport(name);
  const docs = await Model.find().select('_id teacherId instituteId');
  report.total = docs.length;

  for (const doc of docs) {
    const currentValid = isValidId(doc.instituteId) && validInstituteIds.has(String(doc.instituteId));
    const derived = await resolveUserInstituteId(doc.teacherId, userCache);

    if (currentValid) {
      report.alreadyValid++;
      if (derived && derived !== String(doc.instituteId)) {
        report.alreadyValidButInconsistent.push({ id: String(doc._id), stored: String(doc.instituteId), derived });
      }
      continue;
    }

    report.missingOrInvalid++;
    if (derived) {
      report.resolved.push({ id: String(doc._id), instituteId: derived });
      if (EXECUTE) {
        await Model.updateOne({ _id: doc._id }, { $set: { instituteId: derived } });
      }
    } else {
      report.unresolvable.push({ id: String(doc._id), reason: 'teacherId user not found, or that user has no instituteId of their own.' });
    }
  }

  return report;
}

/**
 * Submission <- test (via testResolvedMap from migrateTest, above), AND/OR
 * teacher / student WHEN those happen to already be real User ObjectIds.
 */
async function migrateSubmission(validInstituteIds, userCache, testResolvedMap) {
  const report = newReport('Submission');
  const docs = await Submission.find().select('_id test teacher student instituteId');
  report.total = docs.length;

  for (const doc of docs) {
    const currentValid = isValidId(doc.instituteId) && validInstituteIds.has(String(doc.instituteId));

    const candidates = {};

    const viaTest = doc.test ? testResolvedMap.get(String(doc.test)) : null;
    if (viaTest) candidates.test = viaTest;

    const viaTeacher = await resolveUserInstituteId(doc.teacher, userCache);
    if (viaTeacher) candidates.teacher = viaTeacher;

    const viaStudent = await resolveUserInstituteId(doc.student, userCache);
    if (viaStudent) candidates.student = viaStudent;

    const uniqueValues = [...new Set(Object.values(candidates))];

    if (currentValid) {
      report.alreadyValid++;
      if (uniqueValues.length === 1 && uniqueValues[0] !== String(doc.instituteId)) {
        report.alreadyValidButInconsistent.push({ id: String(doc._id), stored: String(doc.instituteId), derived: uniqueValues[0] });
      }
      continue;
    }

    report.missingOrInvalid++;

    if (uniqueValues.length === 1) {
      const resolved = uniqueValues[0];
      report.resolved.push({ id: String(doc._id), instituteId: resolved, via: Object.keys(candidates) });
      if (EXECUTE) {
        await Submission.updateOne({ _id: doc._id }, { $set: { instituteId: resolved } });
      }
    } else if (uniqueValues.length > 1) {
      report.ambiguous.push({ id: String(doc._id), candidates });
    } else {
      report.unresolvable.push({
        id: String(doc._id),
        reason: 'Neither the linked test, nor teacher, nor student could be traced to a real institute (test missing/unresolved, and teacher/student are not real User ObjectIds — likely a legacy pre-auth record).',
      });
    }
  }

  return report;
}

function printReport(report) {
  console.log(`\n=== ${report.name} ===`);
  console.log(`  total documents:                  ${report.total}`);
  console.log(`  already has a valid instituteId:  ${report.alreadyValid}`);
  if (report.alreadyValidButInconsistent.length > 0) {
    console.log(`    ⚠️  of those, inconsistent with derived owner (NOT changed — needs manual review): ${report.alreadyValidButInconsistent.length}`);
    report.alreadyValidButInconsistent.slice(0, 10).forEach((d) => {
      console.log(`      - ${d.id}: stored=${d.stored} derived=${d.derived}`);
    });
    if (report.alreadyValidButInconsistent.length > 10) console.log(`      ... and ${report.alreadyValidButInconsistent.length - 10} more`);
  }
  console.log(`  missing / null / invalid instituteId: ${report.missingOrInvalid}`);
  console.log(`    safely resolvable:  ${report.resolved.length}${EXECUTE ? ' (written)' : ' (would be written with --execute)'}`);
  console.log(`    ambiguous:          ${report.ambiguous.length}`);
  if (report.ambiguous.length > 0) {
    report.ambiguous.slice(0, 10).forEach((d) => {
      console.log(`      - ${d.id}: ${JSON.stringify(d.candidates)}`);
    });
    if (report.ambiguous.length > 10) console.log(`      ... and ${report.ambiguous.length - 10} more`);
  }
  console.log(`    unresolvable:       ${report.unresolvable.length}`);
  if (report.unresolvable.length > 0) {
    report.unresolvable.slice(0, 10).forEach((d) => {
      console.log(`      - ${d.id}: ${d.reason}`);
    });
    if (report.unresolvable.length > 10) console.log(`      ... and ${report.unresolvable.length - 10} more`);
  }
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not set. Copy backend/.env.example to backend/.env and fill it in.');
    process.exit(1);
  }

  console.log(EXECUTE ? '⚠️  RUNNING IN --execute MODE — matching documents WILL be written.' : 'ℹ️  Dry run (default) — no data will be modified. Pass --execute to actually write.');
  if (EXECUTE) {
    console.log('   Make sure you have a backup (Atlas Backup, or `mongodump --uri="$MONGO_URI"`) before continuing.');
  }

  let exitCode = 0;
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    const validInstituteIds = await loadInstituteIdSet();
    const userCache = new Map();

    const { report: testReport, resolvedMap: testResolvedMap } = await migrateTest(validInstituteIds, userCache);
    const liveSessionReport = await migrateTeacherOwned(LiveSession, 'LiveSession', validInstituteIds, userCache);
    const fullMockReport = await migrateTeacherOwned(FullMockSession, 'FullMockSession', validInstituteIds, userCache);
    const submissionReport = await migrateSubmission(validInstituteIds, userCache, testResolvedMap);

    [testReport, submissionReport, liveSessionReport, fullMockReport].forEach(printReport);

    const totalUnresolvable =
      testReport.unresolvable.length +
      submissionReport.unresolvable.length +
      liveSessionReport.unresolvable.length +
      fullMockReport.unresolvable.length;
    const totalAmbiguous =
      testReport.ambiguous.length +
      submissionReport.ambiguous.length +
      liveSessionReport.ambiguous.length +
      fullMockReport.ambiguous.length;

    console.log('\n=== SUMMARY ===');
    console.log(`  Mode: ${EXECUTE ? 'EXECUTE (data written)' : 'DRY RUN (no data written)'}`);
    console.log(`  Documents needing manual review (ambiguous + unresolvable): ${totalAmbiguous + totalUnresolvable}`);
    if (totalAmbiguous + totalUnresolvable > 0) {
      console.log('  These are listed above by collection with their _id and reason — they were NOT modified.');
      console.log('  Making instituteId required will make these specific documents fail to load/save until they are');
      console.log('  fixed by hand (or intentionally excluded/archived) — resolve them before flipping that switch in production.');
    }
    if (!EXECUTE) {
      console.log('\n  This was a dry run — nothing was written. Re-run with --execute to apply the resolvable fixes above.');
    }
  } catch (err) {
    console.error('❌ Migration failed:', err);
    exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit(exitCode);
  }
}

main();
