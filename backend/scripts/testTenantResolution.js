/**
 * testTenantResolution.js
 * -------------------------
 * Pure unit tests for utils/resolveTenantFromHost.js's normalizeHostname/
 * classifyHostname — the hostname-parsing logic that every Phase 4
 * security property (no accidental partial-domain matches, BandUltra's own
 * hosts never resolving as an institute, port/www/case handled
 * consistently) actually depends on. Deliberately has ZERO dependencies —
 * no Mongo connection, no network — because classifyHostname/
 * normalizeHostname are pure functions (resolveInstituteFromHostname,
 * the DB-backed layer, requires Institute lazily specifically so this file
 * can require the module without pulling in Mongoose at all).
 *
 * This only tests the STRUCTURAL classification (is this the platform? a
 * subdomain? a candidate custom domain?) — NOT whether a given
 * subdomain/domain actually belongs to a real, active, verified institute
 * in the database. That half (the "unknown tenant" / "inactive tenant" /
 * "unverified custom domain" cases) needs a real MongoDB connection to
 * exercise and could not be run in this environment — see the delivery
 * notes for how to test those by hand once you have this running locally.
 *
 * Usage (run from the backend/ directory):
 *   node scripts/testTenantResolution.js
 */

const assert = require('assert');
const { normalizeHostname, classifyHostname } = require('../utils/resolveTenantFromHost');

const BASE = 'bandultra.com';

// [ input hostname, expected kind, expected subdomain/domain value (if any) ]
const CASES = [
  // --- BandUltra's own platform hosts — must NEVER resolve as an institute ---
  ['bandultra.com', 'platform', null],
  ['www.bandultra.com', 'platform', null],
  ['app.bandultra.com', 'platform', null],
  ['BANDULTRA.COM', 'platform', null], // case-insensitive
  ['bandultra.com:443', 'platform', null], // port stripped

  // --- Institute subdomains ---
  ['a2a.bandultra.com', 'subdomain', 'a2a'],
  ['abc.bandultra.com', 'subdomain', 'abc'],
  ['A2A.BANDULTRA.COM', 'subdomain', 'a2a'], // case-insensitive
  ['a2a.bandultra.com:5173', 'subdomain', 'a2a'], // port stripped

  // --- Verified custom domains (structural classification only — DB
  //     lookup decides whether they actually map to a real institute) ---
  ['a2aconsultants.com', 'customDomain', 'a2aconsultants.com'],
  ['abcacademy.com', 'customDomain', 'abcacademy.com'],
  ['www.a2aconsultants.com', 'customDomain', 'a2aconsultants.com'], // www normalized away
  ['a2aconsultants.com:5173', 'customDomain', 'a2aconsultants.com'], // port stripped

  // --- Unknown / not a real domain shape ---
  ['unknown.example.com', 'customDomain', 'unknown.example.com'], // structurally a custom-domain candidate; the DB step is what actually says "no institute" (untested here — needs Mongo)
  ['a2a.staging.bandultra.com', 'unknown', null], // multi-label subdomain — never a real Institute.subdomain
  ['bandultra.com.evil.com', 'customDomain', 'bandultra.com.evil.com'], // does NOT end with ".bandultra.com" — must not be mistaken for the platform or a subdomain
  ['.bandultra.com', 'unknown', null], // empty label
  ['', 'unknown', null],

  // --- Local dev — never a tenant ---
  ['localhost', 'unknown', null],
  ['localhost:5173', 'unknown', null],
  ['127.0.0.1', 'unknown', null],
];

let passed = 0;
for (const [input, expectedKind, expectedValue] of CASES) {
  const normalized = normalizeHostname(input);
  const result = classifyHostname(normalized, { baseDomain: BASE });

  assert.strictEqual(result.kind, expectedKind, `${JSON.stringify(input)}: expected kind "${expectedKind}", got "${result.kind}"`);
  if (expectedValue) {
    const actual = result.subdomain || result.domain;
    assert.strictEqual(actual, expectedValue, `${JSON.stringify(input)}: expected value "${expectedValue}", got "${actual}"`);
  }

  passed++;
  console.log(`OK  ${JSON.stringify(input).padEnd(30)} -> ${result.kind}${expectedValue ? ` (${expectedValue})` : ''}`);
}

console.log(`\n${passed}/${CASES.length} hostname classification tests passed.`);
