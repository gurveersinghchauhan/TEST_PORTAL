require('dotenv').config();

const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const { initSocketHandler } = require('./socketHandler');
const { resolveTenantMiddleware } = require('./utils/resolveTenantFromHost');

if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.error('❌ Missing required environment variables. Copy backend/.env.example to backend/.env and fill in MONGO_URI and JWT_SECRET.');
  process.exit(1);
}

// GEMINI_API_KEY is intentionally OPTIONAL — it only powers the AI PDF-import
// path (services/pdfParserService.js, POST /api/tests/upload-pdf). Teachers
// currently use an external AI workflow and paste the resulting JSON in
// directly (POST /api/tests), which needs no Gemini key at all, so the rest
// of the app must work normally without one. If it's unset, upload-pdf fails
// gracefully with a clear "AI PDF import is currently unavailable." error
// instead of the server refusing to start.
if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY is not set — AI PDF import (POST /api/tests/upload-pdf) will be unavailable. Everything else works normally.');
}

const app = express();

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// Phase 4: resolves req.tenant from the request's own hostname (see
// utils/resolveTenantFromHost.js) — attached globally, before any route,
// so both the public tenant-config route and middleware/auth.js's
// requireAuth can read it. Never blocks a request on its own; every route
// that doesn't look at req.tenant is completely unaffected.
app.use(resolveTenantMiddleware);

// Serves uploaded master Listening audio files back out (see
// middleware/upload.js's uploadAudio) — e.g. a file saved to
// uploads/audio/169...-master-audio.mp3 becomes reachable at
// /uploads/audio/169...-master-audio.mp3, which is exactly the path
// routes/testUpload.js's POST /upload-audio returns as the test's
// masterAudioUrl. Plain static file serving is all a local <audio src>
// needs; no auth gate here since a hosted test's audio is already treated
// as a shareable link the same way every other *Url field in this app is.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/tests', require('./routes/testUpload'));
app.use('/api/submissions', require('./routes/submissions'));
app.use('/api/live-sessions', require('./routes/liveSessions'));
app.use('/api/full-mocks', require('./routes/fullMockSessions'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/batches', require('./routes/batches'));
app.use('/api/super', require('./routes/superAdmin'));
app.use('/api/tenant', require('./routes/tenant'));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' },
});

// Lets any REST route reach the same socket server via req.app.get('io') —
// e.g. routes/liveSessions.js's PATCH /:id/end (the REST counterpart to
// socketHandler.js's end_live_session) and routes/submissions.js's DB-save
// failure notice both need to push a live event to a teacher's dashboard
// from inside an HTTP handler, not just from a socket event handler. Safe
// to set before server.listen() — Express only reads this once an actual
// request comes in, by which point io is fully constructed either way.
app.set('io', io);

initSocketHandler(io);

// Some local Windows dev setups hit ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR (SSL
// alert 80) during the TLS handshake to Atlas. Note for whoever debugs this
// next: alert 80 is the *server* reporting an internal error mid-negotiation,
// not a certificate-trust failure — tlsAllowInvalidCertificates only relaxes
// certificate validation, so in most reports it does NOT fix this specific
// alert. The actual fix is almost always an outdated Node.js/OpenSSL build;
// upgrading to a current Node LTS resolves it in the majority of cases. This
// flag is kept as an explicit, opt-in escape hatch (off by default) for the
// cases where it does help, or as a stopgap while sorting out the Node
// version — hard-gated to non-production so it can never silently weaken a
// deployed environment.
// Node 17+ prefers IPv6 during DNS resolution (Happy Eyeballs), which on
// Windows dev machines commonly races/falls back in a way that breaks the
// TLS handshake against Atlas's SRV-resolved shard endpoints — reported as
// this same ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR (or ECONNREFUSED) on Node 22+
// (confirmed happening on Node 24 too). Forcing IPv4 sidesteps that race
// entirely and carries no security trade-off, unlike MONGO_TLS_INSECURE
// below — so it's applied unconditionally rather than gated.
const mongoConnectOptions = { family: 4 };
if (process.env.MONGO_TLS_INSECURE === 'true') {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ MONGO_TLS_INSECURE is set but NODE_ENV=production — refusing to bypass TLS certificate validation in production. Unset MONGO_TLS_INSECURE or fix NODE_ENV.');
    process.exit(1);
  }
  console.warn('⚠️  MONGO_TLS_INSECURE=true — bypassing MongoDB TLS certificate validation. Development only; if this does not resolve ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR, check your Node.js version (upgrade to the current LTS).');
  mongoConnectOptions.tlsAllowInvalidCertificates = true;
}

mongoose.connect(process.env.MONGO_URI, mongoConnectOptions)
  .then(() => console.log('✅ MongoDB Cloud (Atlas) connected successfully!'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Socket server listening on :${PORT}`));