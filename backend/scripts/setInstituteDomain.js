/**
 * setInstituteDomain.js
 * ----------------------
 * Phase 4 companion CLI: manually assigns a subdomain or a (optionally
 * pre-verified) custom domain to an existing Institute, so hostname-based
 * tenant resolution (see utils/resolveTenantFromHost.js) has something real
 * to resolve. There is deliberately no self-serve route for this yet — same
 * reasoning as scripts/createSuperAdmin.js: an institute's own hostname
 * identity is not something the current Super Admin dashboard UI can set,
 * so this script is the only way to configure one for now.
 *
 * This script does NOT touch DNS, Cloudflare, or any external service — it
 * only writes to the Institute document's own subdomain/customDomains
 * fields (models/Institute.js). Whoever runs it is still responsible for
 * actually pointing real DNS at this deployment before a domain configured
 * here will receive any traffic.
 *
 * Usage (run from the backend/ directory, so dotenv finds .env):
 *   node scripts/setInstituteDomain.js <instituteEmail> --subdomain <label>
 *   node scripts/setInstituteDomain.js <instituteEmail> --custom-domain <domain> [--verified]
 *
 * Examples:
 *   node scripts/setInstituteDomain.js contact@a2a.com --subdomain a2a
 *   node scripts/setInstituteDomain.js contact@a2a.com --custom-domain a2aconsultants.com --verified
 *
 * <instituteEmail> is matched against Institute.email (the same field
 * routes/auth.js already uses to look up an institute at login) — NOT the
 * unique `username` field, since the operator running this script is more
 * likely to have the institute's contact email on hand.
 *
 * --custom-domain without --verified adds the domain in an unverified
 * state (mirrors the model's own default: { type: Boolean, default: false }
 * on customDomains.domain — see models/Institute.js) — resolveTenantFromHost.js
 * will not resolve it to this institute until it's verified. Run the script
 * again with the same domain and --verified to flip it once you've actually
 * confirmed the operator controls that domain (verification itself, e.g. a
 * DNS TXT record challenge, is out of scope for this phase).
 */

require('dotenv').config();

const mongoose = require('mongoose');
const Institute = require('../models/Institute');
const { normalizeHostname, classifyHostname } = require('../utils/resolveTenantFromHost');

function printUsageAndExit() {
  console.error('Usage:');
  console.error('  node scripts/setInstituteDomain.js <instituteEmail> --subdomain <label>');
  console.error('  node scripts/setInstituteDomain.js <instituteEmail> --custom-domain <domain> [--verified]');
  process.exit(1);
}

async function main() {
  const [, , rawEmail, ...rest] = process.argv;

  if (!rawEmail || rest.length === 0) {
    printUsageAndExit();
  }

  const email = rawEmail.trim().toLowerCase();

  const subFlagIndex = rest.indexOf('--subdomain');
  const domainFlagIndex = rest.indexOf('--custom-domain');

  if (subFlagIndex === -1 && domainFlagIndex === -1) {
    printUsageAndExit();
  }
  if (subFlagIndex !== -1 && domainFlagIndex !== -1) {
    console.error('❌ Pass only one of --subdomain or --custom-domain, not both.');
    process.exit(1);
  }

  let mode; // 'subdomain' | 'customDomain'
  let subdomain = null;
  let customDomain = null;
  let markVerified = rest.includes('--verified');

  if (subFlagIndex !== -1) {
    mode = 'subdomain';
    subdomain = rest[subFlagIndex + 1];
    if (!subdomain || subdomain.startsWith('--')) {
      console.error('❌ --subdomain requires a value, e.g. --subdomain a2a');
      process.exit(1);
    }
    subdomain = normalizeHostname(subdomain);
    // A subdomain label must be a single DNS label — reuse the same
    // classification logic the resolver itself relies on so this script
    // can never write a value the resolver would then refuse to match
    // (e.g. something containing a dot, or a reserved platform label like
    // "www"/"app" — see PLATFORM_LABELS in resolveTenantFromHost.js).
    const check = classifyHostname(`${subdomain}.bandultra.invalid-check`, { baseDomain: 'bandultra.invalid-check' });
    if (check.kind !== 'subdomain' || check.subdomain !== subdomain) {
      console.error(`❌ "${subdomain}" is not a valid single-label subdomain (no dots, not a reserved label like "www"/"app").`);
      process.exit(1);
    }
  } else {
    mode = 'customDomain';
    customDomain = rest[domainFlagIndex + 1];
    if (!customDomain || customDomain.startsWith('--')) {
      console.error('❌ --custom-domain requires a value, e.g. --custom-domain a2aconsultants.com');
      process.exit(1);
    }
    customDomain = normalizeHostname(customDomain);
    if (customDomain.startsWith('www.')) {
      // resolveTenantFromHost.js treats www.<domain> as the same domain —
      // storing the www-prefixed form would just be redundant, and could
      // confuse a future duplicate-domain check that compares raw strings.
      customDomain = customDomain.slice(4);
    }
    if (!customDomain.includes('.')) {
      console.error(`❌ "${customDomain}" doesn't look like a valid domain.`);
      process.exit(1);
    }
  }

  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not set. Copy backend/.env.example to backend/.env and fill it in.');
    process.exit(1);
  }

  let exitCode = 0;

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB.');

    const institute = await Institute.findOne({ email });
    if (!institute) {
      console.error(`❌ No institute found with email "${email}".`);
      exitCode = 1;
      return;
    }

    if (mode === 'subdomain') {
      // Explicit duplicate check with a clear message before letting the
      // unique index (models/Institute.js) be the last line of defense —
      // a raw E11000 error is a worse experience for whoever runs this.
      const clash = await Institute.findOne({ subdomain, _id: { $ne: institute._id } });
      if (clash) {
        console.error(`❌ Subdomain "${subdomain}" is already assigned to another institute (${clash.instituteName}).`);
        exitCode = 1;
        return;
      }
      institute.subdomain = subdomain;
      await institute.save();
      console.log(`✅ ${institute.instituteName} is now reachable at ${subdomain}.${process.env.BASE_DOMAIN || 'bandultra.com'}`);
    } else {
      const clash = await Institute.findOne({
        'customDomains.domain': customDomain,
        _id: { $ne: institute._id },
      });
      if (clash) {
        console.error(`❌ Domain "${customDomain}" is already assigned to another institute (${clash.instituteName}).`);
        exitCode = 1;
        return;
      }

      const existing = institute.customDomains.find((d) => d.domain === customDomain);
      if (existing) {
        existing.verified = markVerified;
      } else {
        institute.customDomains.push({ domain: customDomain, verified: markVerified });
      }
      await institute.save();
      console.log(
        `✅ ${institute.instituteName} now has custom domain "${customDomain}" (${markVerified ? 'verified' : 'unverified — will not resolve as a tenant yet'}).`
      );
      if (!markVerified) {
        console.log('   Re-run this command with --verified once you have confirmed the operator controls this domain.');
      }
    }
  } catch (err) {
    if (err.code === 11000) {
      console.error('❌ That subdomain/custom domain is already in use by another institute.');
    } else if (err.name === 'ValidationError') {
      console.error('❌ Validation failed:', err.message);
    } else {
      console.error('❌ Failed to set institute domain:', err);
    }
    exitCode = 1;
  } finally {
    await mongoose.disconnect();
    process.exit(exitCode);
  }
}

main();
