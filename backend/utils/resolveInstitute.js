const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Resolves "which institute does this logged-in user act under."
 * An institute account IS its own institute id. A teacher's institute
 * comes from their own User document — the JWT only carries { id, role },
 * not the institute link, so this needs a DB lookup. Shared by
 * GET /api/batches and the student-creation batch check in routes/users.js.
 *
 * Returns a `User` id (the institute-role account's own _id) — NOT the
 * multi-tenant `Institute` document's id. See resolveTenantInstituteId
 * below for that.
 *
 * @param {{ id: string, role: string }} reqUser — req.user, set by requireAuth
 * @returns {Promise<string|null>}
 */
async function resolveInstituteId(reqUser) {
  if (reqUser.role === 'institute') return reqUser.id;

  if (reqUser.role === 'teacher') {
    const teacher = await User.findById(reqUser.id).select('institute');
    return teacher?.institute ? String(teacher.institute) : null;
  }

  return null;
}

/**
 * Resolves "which Institute TENANT (backend/models/Institute.js) does this
 * logged-in user's data belong to" — the id used to stamp `instituteId` on
 * Test/Submission/Batch/User documents for multi-tenant isolation.
 *
 * Every User document now carries its own `instituteId` directly (see
 * models/User.js — stamped at account-creation time, never re-derived),
 * and requireAuth puts that same value on req.user straight from the
 * verified JWT (see middleware/auth.js). So the common case here is free —
 * no DB round-trip at all. The DB fallback only matters for callers that
 * hand this a plain { id, role } built from unauthenticated input rather
 * than a real req.user (e.g. routes/submissions.js resolving a body-
 * supplied teacherId) — those are expected to validate `id` looks like a
 * real ObjectId first.
 *
 * @param {{ id: string, role: string, instituteId?: string|null }} reqUser
 * @returns {Promise<string|null>}
 */
async function resolveTenantInstituteId(reqUser) {
  if (!reqUser) return null;
  if (reqUser.instituteId) return String(reqUser.instituteId);

  if (!reqUser.id || !mongoose.Types.ObjectId.isValid(reqUser.id)) return null;
  const user = await User.findById(reqUser.id).select('instituteId');
  return user?.instituteId ? String(user.instituteId) : null;
}

module.exports = { resolveInstituteId, resolveTenantInstituteId };
