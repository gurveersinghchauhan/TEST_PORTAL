/**
 * resolveTenantFromHost.js
 * -------------------------
 * Phase 4: the single reusable place hostname -> Institute resolution
 * happens. Nothing else in the codebase should re-implement this logic —
 * routes/middleware that need "which institute does this request's
 * hostname belong to" should go through resolveTenantMiddleware (below,
 * wired globally in server.js as req.tenant) rather than querying
 * Institute directly by host.
 *
 * Two layers, deliberately kept separate:
 *   - normalizeHostname / classifyHostname are PURE functions — no DB, no
 *     I/O — so the tricky part (parsing/normalizing/categorizing a
 *     hostname correctly) is fully unit-testable without a database. See
 *     scripts/testTenantResolution.js.
 *   - resolveInstituteFromHostname / resolveTenantMiddleware are the
 *     async, DB-backed layer built on top of them.
 *
 * BASE_DOMAIN (env var, defaults to 'bandultra.com') is the platform's own
 * domain — the thing institute subdomains live under (<label>.BASE_DOMAIN).
 */

const PLATFORM_LABELS = new Set(['www', 'app']); // reserved — never treated as an institute subdomain, even though they're structurally single labels under BASE_DOMAIN just like a real one
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Strips whitespace, lowercases, and removes a trailing port — the one
 * normalization step Express's own `req.hostname` already does for us in
 * practice, but this function is written to be safe to call on a raw Host
 * header value too (e.g. from a test, or any future non-Express caller),
 * not just an already-parsed req.hostname.
 */
function normalizeHostname(rawHost) {
  if (!rawHost || typeof rawHost !== 'string') return '';
  let host = rawHost.trim().toLowerCase();
  // IPv6 literals ("[::1]:4000") carry colons that aren't a port separator
  // — leave them alone rather than mis-splitting on the first ':'. Not a
  // real-world tenant hostname case, just don't corrupt it.
  if (!host.startsWith('[')) {
    host = host.split(':')[0];
  }
  return host;
}

/**
 * Pure classification: given an already-normalized hostname, decides
 * whether it's the BandUltra platform itself, a "<label>.BASE_DOMAIN"
 * institute subdomain, or a candidate custom domain. Does NOT check
 * whether that subdomain/domain actually belongs to a real institute —
 * that's resolveInstituteFromHostname's job. Kept pure and side-effect
 * free specifically so it's testable without a database (see
 * scripts/testTenantResolution.js).
 *
 * @returns {{ kind: 'platform' } | { kind: 'subdomain', subdomain: string } | { kind: 'customDomain', domain: string } | { kind: 'unknown' }}
 */
function classifyHostname(host, { baseDomain } = {}) {
  const base = (baseDomain || process.env.BASE_DOMAIN || 'bandultra.com').toLowerCase();

  if (!host) return { kind: 'unknown' };

  // Local dev has no real hostname to resolve a tenant from at all — never
  // an institute, and not worth even calling it "the platform" (there's
  // nothing to render differently for it). Treated as "no tenant", the
  // same as every other unrecognized host, so every existing route keeps
  // behaving exactly as it does today when accessed via localhost.
  if (LOOPBACK_HOSTS.has(host)) {
    return { kind: 'unknown' };
  }

  // The BandUltra platform's own hosts — apex, www, and the app subdomain
  // — are explicitly NEVER treated as an institute, even though "app" and
  // "www" are structurally single-label subdomains of BASE_DOMAIN exactly
  // like a real institute's. This is what satisfies "do not accidentally
  // treat the main BandUltra platform as an institute" — it's an explicit
  // allow-list, not something that falls out of the subdomain branch below
  // by accident.
  if (host === base || host === `www.${base}` || host === `app.${base}`) {
    return { kind: 'platform' };
  }

  if (host.endsWith(`.${base}`)) {
    const label = host.slice(0, -(base.length + 1));
    // A single label only ("a2a"), never a deeper chain ("a2a.staging") or
    // an empty one ("" from a literal ".bandultra.com") — Institute.subdomain
    // is always exactly one segment, so anything else doesn't correspond to
    // any real subdomain and falls through to "unknown" (fail closed)
    // rather than being misread as a partial/accidental match.
    if (label && !label.includes('.') && !PLATFORM_LABELS.has(label)) {
      return { kind: 'subdomain', subdomain: label };
    }
    return { kind: 'unknown' };
  }

  // Anything else is a candidate custom domain. `www.` is stripped so
  // "www.a2aconsultants.com" and "a2aconsultants.com" resolve identically
  // — matching how an institute would actually point DNS at both the apex
  // and the www host of their own domain. A bare, dot-less label ("intranet")
  // can never be a real registrable domain, so it's rejected rather than
  // treated as a custom-domain candidate.
  const withoutWww = host.startsWith('www.') ? host.slice(4) : host;
  if (!withoutWww || !withoutWww.includes('.')) {
    return { kind: 'unknown' };
  }
  return { kind: 'customDomain', domain: withoutWww };
}

/**
 * The DB-backed resolution step. Institute is required lazily (inside the
 * function body, not at module load) purely so classifyHostname/
 * normalizeHostname stay requirable — and unit-testable — without pulling
 * in Mongoose at all; see scripts/testTenantResolution.js.
 *
 * Security notes (see this module's own doc comment and the Institute
 * schema's comment on its two unique indexes):
 *   - A subdomain/custom domain on a `status: 'blocked'` institute never
 *     resolves — reuses the exact same kill-switch routes/auth.js's login
 *     already checks, applied consistently here too.
 *   - An unverified custom domain never resolves (`verified: true` is part
 *     of the query itself, not a filter applied after the fact).
 *   - If a hostname somehow matches more than one institute (should be
 *     impossible given the unique indexes, but pre-existing/inconsistent
 *     data is never assumed to be safe), this refuses to guess and treats
 *     it as unknown, logging loudly — "exactly one Institute, or none",
 *     never "whichever one happened to sort first".
 *
 * @param {string} rawHost
 * @returns {Promise<{ kind: 'platform'|'subdomain'|'customDomain'|'unknown', institute: import('mongoose').Document|null, host: string }>}
 */
async function resolveInstituteFromHostname(rawHost) {
  const Institute = require('../models/Institute');

  const host = normalizeHostname(rawHost);
  const classification = classifyHostname(host);

  if (classification.kind === 'platform' || classification.kind === 'unknown') {
    return { kind: classification.kind, institute: null, host };
  }

  if (classification.kind === 'subdomain') {
    const matches = await Institute.find({ subdomain: classification.subdomain, status: 'active' }).limit(2);
    if (matches.length === 0) return { kind: 'unknown', institute: null, host };
    if (matches.length > 1) {
      console.error(
        `[tenant-resolve] SECURITY: subdomain "${classification.subdomain}" matched ${matches.length} institutes — refusing to pick one.`
      );
      return { kind: 'unknown', institute: null, host };
    }
    return { kind: 'subdomain', subdomain: classification.subdomain, institute: matches[0], host };
  }

  // customDomain
  const matches = await Institute.find({
    customDomains: { $elemMatch: { domain: classification.domain, verified: true } },
    status: 'active',
  }).limit(2);
  if (matches.length === 0) return { kind: 'unknown', institute: null, host };
  if (matches.length > 1) {
    console.error(
      `[tenant-resolve] SECURITY: custom domain "${classification.domain}" matched ${matches.length} institutes — refusing to pick one.`
    );
    return { kind: 'unknown', institute: null, host };
  }
  return { kind: 'customDomain', domain: classification.domain, institute: matches[0], host };
}

/**
 * Express middleware — sets req.tenant and ALWAYS calls next(), never
 * blocks a request on its own. Wired globally in server.js (before any
 * route is mounted) so req.tenant is available to every route, including
 * ones that don't otherwise need auth (see routes/tenant.js's public
 * GET /config). Purely additive: nothing reads req.tenant except that new
 * route and middleware/auth.js's requireAuth (Phase 4's hostname/JWT
 * reconciliation) — every other existing route is completely unaffected.
 */
async function resolveTenantMiddleware(req, res, next) {
  try {
    req.tenant = await resolveInstituteFromHostname(req.hostname);
  } catch (err) {
    console.error('[tenant-resolve] failed to resolve tenant from hostname:', err);
    req.tenant = { kind: 'unknown', institute: null, host: req.hostname };
  }
  next();
}

module.exports = {
  normalizeHostname,
  classifyHostname,
  resolveInstituteFromHostname,
  resolveTenantMiddleware,
};
