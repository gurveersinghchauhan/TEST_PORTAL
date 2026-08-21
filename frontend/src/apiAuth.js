/**
 * apiAuth.js
 * ----------
 * Every protected API route now requires a valid JWT (backend/middleware/
 * auth.js's requireAuth, wired onto every tenant-scoped route as of this
 * multi-tenant isolation pass). App.jsx stores the token in localStorage
 * on login (`auth_token`) — this just reads it back out and shapes it into
 * a fetch-ready headers object, so every file that talks to a protected
 * route can do the same one-liner instead of re-implementing this.
 *
 * Usage:
 *   fetch(url, { headers: authHeaders() })
 *   fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body })
 *
 * Returns {} (no Authorization header at all) when there's no token yet,
 * rather than sending "Bearer null"/"Bearer undefined" — same end result
 * (the server replies 401) but a cleaner request either way.
 */
export function authHeaders() {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
