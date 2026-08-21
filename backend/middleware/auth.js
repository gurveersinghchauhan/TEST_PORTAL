const jwt = require('jsonwebtoken');

/**
 * requireAuth
 * -----------
 * Verifies the JWT sent as `Authorization: Bearer <token>` (issued by
 * POST /api/auth/login) and attaches the decoded payload to req.user as
 * { id, role, instituteId }. Every route that needs to know who's calling
 * — Tier 2/3 creation, tenant-scoped queries, and anything else added
 * later — sits behind this.
 *
 * instituteId rides in the token itself (see routes/auth.js's login),
 * so every protected route gets it for free with zero extra DB lookups —
 * that's what makes tenant filtering "strict everywhere" actually cheap.
 * It'll be undefined on tokens issued before this field existed; those
 * users just need to log out and back in to pick up a fresh token.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: decoded.id, role: decoded.role, instituteId: decoded.instituteId || null };

    // Phase 4: hostname/tenant reconciliation. req.tenant is set by
    // resolveTenantMiddleware (see utils/resolveTenantFromHost.js), wired
    // globally in server.js — it only resolves to a real institute once
    // that institute actually has a subdomain or a verified custom domain
    // configured, and DNS is pointed at one (neither exists yet — this
    // phase deliberately doesn't touch DNS/Cloudflare). So req.tenant.institute
    // is null for every request today, making this a true no-op for the
    // current deployment; it only starts mattering once a real tenant
    // hostname goes live. 'superadmin' is exempt — it's deliberately
    // cross-tenant (see routes/superAdmin.js) and always has
    // instituteId: null, so there's nothing meaningful to compare.
    if (req.tenant && req.tenant.institute && req.user.role !== 'superadmin') {
      if (String(req.tenant.institute._id) !== String(req.user.instituteId)) {
        console.warn(
          `[tenant-auth] rejected: user=${req.user.id} instituteId=${req.user.instituteId} used a token against hostname="${req.tenant.host}" (resolves to institute=${req.tenant.institute._id}).`
        );
        return res.status(403).json({ error: 'This account cannot be used on this domain.' });
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

/**
 * requireRole(...roles)
 * ----------------------
 * Must run AFTER requireAuth — it reads req.user, which only requireAuth
 * sets. Usage:
 *   router.post('/add-teacher', requireAuth, requireRole('institute'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: requires role ${allowedRoles.join(' or ')}.` });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
