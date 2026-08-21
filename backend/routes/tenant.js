const express = require('express');

const router = express.Router();

/**
 * GET /api/tenant/config
 * -----------------------
 * Public, unauthenticated — resolves the tenant from the REQUEST'S OWN
 * hostname (req.tenant, set globally by utils/resolveTenantFromHost.js's
 * resolveTenantMiddleware in server.js) and returns only the public,
 * branding-level information the frontend would need to render itself for
 * that institute. Deliberately returns nothing else off the Institute
 * document — no owner/contact/address fields, no username, and certainly
 * no passwordHash — same "never leak more than the client needs" posture
 * routes/superAdmin.js's own PUBLIC_FIELDS projection already follows for
 * the (authenticated, Super-Admin-only) institute listing.
 *
 * Resolves to `{ tenant: null, platform: true }` for the BandUltra
 * platform's own hosts (apex/www/app) and for ANY host that doesn't
 * resolve to a real, active institute — unknown domain, unverified custom
 * domain, or a blocked institute all collapse to this same shape, so a
 * caller can't distinguish "doesn't exist" from "blocked" from "not
 * verified yet" (nothing here should tell an anonymous caller which one it
 * is). The current frontend has no hostname-tenant awareness at all yet —
 * this route is purely additive, nothing existing calls it.
 */
router.get('/config', (req, res) => {
  const institute = req.tenant && req.tenant.institute;

  if (!institute) {
    return res.json({ tenant: null, platform: true });
  }

  // Only instituteName exists on the model today (see models/Institute.js)
  // — logo/brand-color/favicon fields are intentionally NOT added this
  // phase (there's no Super Admin UI yet to ever set them, and adding
  // unused schema fields was explicitly out of scope). This response
  // shape can grow additively later without being a breaking change, since
  // it's a brand new endpoint with no existing caller to break.
  res.json({
    tenant: {
      instituteName: institute.instituteName,
    },
    platform: false,
  });
});

module.exports = router;
