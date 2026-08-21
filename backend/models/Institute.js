const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Institute
 * ---------
 * The tenant registry for the Super Admin multi-tenant management system
 * (see backend/routes/superAdmin.js). Each document is one institute/client
 * onboarded by the super admin — separate from the existing `User` model
 * (backend/models/User.js), which still holds the actual login accounts
 * (institute/teacher/student) used by the day-to-day app.
 *
 * `status` is the "kill switch": flipping it to 'blocked' (via
 * PATCH /api/super/institutes/:id/status) is checked by the login route
 * (backend/routes/auth.js) so a blocked institute's own login is rejected
 * immediately — see auth.js for how it's cross-referenced by email.
 */
const instituteSchema = new Schema({
  instituteName: { type: String, required: true, trim: true },
  ownerName: { type: String, required: true, trim: true },
  username: { type: String, required: true, unique: true, trim: true },
  passwordHash: { type: String, required: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  address: { type: String, required: true, trim: true },
  primaryContact: { type: String, required: true, trim: true },
  secondaryContact: { type: String, trim: true },
  status: { type: String, enum: ['active', 'blocked'], default: 'active' },
  createdAt: { type: Date, default: Date.now },

  // --- Phase 4: hostname-based tenant resolution (below) --------------------
  // See utils/resolveTenantFromHost.js for how these are actually matched
  // against an incoming request's Host header. `status` above already
  // covers the institute-wide kill switch, so it's reused as-is here (an
  // otherwise-matching subdomain/custom domain on a 'blocked' institute
  // must not resolve to a tenant — enforced in that utility, not here).

  // The "a2a" in a2a.bandultra.com — platform-issued, always a single
  // label under BASE_DOMAIN (see resolveTenantFromHost.js). Deliberately
  // has NO default value (not even null): a sparse unique index only
  // skips a field that's genuinely absent from the document, and Mongoose
  // would otherwise persist an explicit `null` on every institute that
  // doesn't have one yet, which a sparse index does NOT skip — that would
  // make the second-ever institute without a subdomain fail to save with
  // a false "duplicate key" error.
  subdomain: { type: String, trim: true, lowercase: true },

  // A customer-owned domain (e.g. "a2aconsultants.com") pointing at this
  // same deployment. `verified` gates whether it's actually allowed to
  // resolve to a tenant — DNS/TLS verification itself is a later phase;
  // for now this defaults to false so simply adding a row here is never,
  // on its own, enough to start routing that domain's traffic to this
  // institute (see resolveTenantFromHost.js's "unverified must not
  // resolve" rule). `www.<domain>` is treated as the same domain by that
  // same utility, so it's deliberately NOT stored as a second row here.
  customDomains: [
    {
      _id: false,
      domain: { type: String, required: true, trim: true, lowercase: true },
      verified: { type: Boolean, default: false },
    },
  ],
});

// Enforces "a hostname must resolve to exactly one Institute" at the DB
// layer for the common case — MongoDB skips a document from a unique
// index entirely when the indexed field is absent (subdomain) or the
// indexed array is empty (customDomains), so institutes with neither set
// yet are completely unaffected. resolveTenantFromHost.js additionally
// guards against this defensively at query time (belt-and-suspenders for
// any pre-existing data these indexes wouldn't retroactively fix).
instituteSchema.index({ subdomain: 1 }, { unique: true, sparse: true });
instituteSchema.index({ 'customDomains.domain': 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Institute', instituteSchema);
