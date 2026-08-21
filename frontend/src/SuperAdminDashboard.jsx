import { useEffect, useState } from 'react';
import { authHeaders } from './apiAuth';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

const EMPTY_FORM = {
  instituteName: '',
  ownerName: '',
  username: '',
  password: '',
  email: '',
  address: '',
  primaryContact: '',
  secondaryContact: '',
};

/**
 * SuperAdminDashboard
 * --------------------
 * Multi-tenant management console, reachable at /super-admin (see App.jsx —
 * there's no client-side router in this app, so that path is detected via
 * `window.location.pathname` and this component is rendered standalone,
 * completely outside the normal login/role flow).
 *
 * Two halves:
 *  - A registration form that POSTs to /api/super/register-institute.
 *  - A table of every registered institute (GET /api/super/institutes)
 *    with a status badge and an Active/Blocked toggle
 *    (PATCH /api/super/institutes/:id/status) — the "kill switch" that
 *    backend/routes/auth.js checks on every institute login attempt.
 *
 * Note: /api/super/* is now locked down server-side behind requireAuth +
 * requireRole('superadmin') (see backend/middleware/auth.js and
 * backend/routes/superAdmin.js), so every request below sends the existing
 * JWT via apiAuth.js's authHeaders() the same way the rest of the app does.
 *
 * Root-cause note: /super-admin is rendered standalone by App.jsx (see its
 * own comment there), completely outside AuthenticatedApp — which means
 * LoginPage.jsx, the app's only other sign-in form, is never reachable from
 * this URL, and there was previously no way for a superadmin to ever get a
 * token into localStorage from here. That's why localStorage.getItem
 * ('auth_token') came back null on this page even though LoginPage.jsx and
 * apiAuth.js already agree on the same 'auth_token' key. The login form
 * below closes that gap: it's the same POST /api/auth/login call and the
 * same localStorage keys LoginPage.jsx uses, just embedded on this page
 * too, so a superadmin never needs to pass through the normal
 * institute/teacher/student login flow (which has no role==='superadmin'
 * branch of its own) to reach this dashboard.
 */
export default function SuperAdminDashboard() {
  // Reachable via any of: a superadmin JWT already sitting in localStorage
  // from a previous visit to this page, or fresh via the login form
  // rendered below when there isn't one. Kept as state (not read fresh from
  // localStorage on every render) so successful login / logout / an
  // expired-token auto-logout (see loadInstitutes' 401 handling below) all
  // trigger a re-render that swaps the login form and dashboard in and out.
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('auth_token'));

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const [institutes, setInstitutes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Which institute id (if any) currently has its status PATCH in flight —
  // used to disable just that row's toggle button, not the whole table.
  const [togglingId, setTogglingId] = useState(null);

  // Same POST /api/auth/login LoginPage.jsx uses, and the same
  // 'auth_token'/'auth_user' localStorage keys apiAuth.js already reads —
  // this is not a second auth system, just this page's own entry point
  // into the one that already exists (see the file-level comment above).
  async function handleLogin(e) {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || (res.status === 401 ? 'Invalid email or password.' : `Login failed (HTTP ${res.status}).`)
        );
      }
      if (data.user?.role !== 'superadmin') {
        // Don't store the token at all in this case — a valid institute/
        // teacher/student login should never end up sitting in localStorage
        // as if it were a superadmin session just because someone typed
        // their credentials into this page by mistake.
        throw new Error('This account does not have Super Admin access.');
      }
      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      setLoginPassword('');
      setAuthToken(data.token);
    } catch (err) {
      setLoginError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setAuthToken(null);
    setInstitutes([]);
  }

  function loadInstitutes() {
    setLoading(true);
    setLoadError(null);
    return fetch(`${API_BASE}/super/institutes`, { headers: authHeaders() })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // A token that was valid earlier can stop being valid (expiry, or
          // logging out elsewhere) — rather than getting stuck on a
          // permanent error screen with no way back in, treat a 401 here
          // the same as never having logged in, so the login form below
          // reappears instead of a dead end.
          if (res.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('auth_user');
            setAuthToken(null);
            return;
          }
          throw new Error(data.error || `Failed to load institutes (HTTP ${res.status}).`);
        }
        setInstitutes(data.institutes || []);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (authToken) loadInstitutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken]);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/super/register-institute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to register institute (HTTP ${res.status}).`);

      setFormSuccess(`"${data.institute.instituteName}" registered successfully.`);
      setForm(EMPTY_FORM);
      loadInstitutes();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleStatus(institute) {
    const nextStatus = institute.status === 'active' ? 'blocked' : 'active';
    setTogglingId(institute._id);
    try {
      const res = await fetch(`${API_BASE}/super/institutes/${institute._id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to update status (HTTP ${res.status}).`);

      setInstitutes((prev) => prev.map((inst) => (inst._id === institute._id ? data.institute : inst)));
    } catch (err) {
      alert(err.message);
    } finally {
      setTogglingId(null);
    }
  }

  if (!authToken) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">Super Admin</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">Sign in</h1>
          <p className="mt-1 mb-6 text-sm text-slate-500">Sign in with a Super Admin account to continue.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                placeholder="admin@bandultra.com"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                placeholder="••••••••"
              />
            </div>

            {loginError && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              disabled={loggingIn}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/20 transition-all duration-200 hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loggingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-50">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">Super Admin</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Institute Management</h1>
            <p className="mt-1 text-sm text-slate-500">
              Register new institutes and control which ones can currently sign in to the portal.
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Log out
          </button>
        </div>

        {/* Registration form */}
        <div className="mb-10 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-base font-bold text-slate-800">Register a new institute</h2>
          <p className="mb-5 text-sm text-slate-500">
            Creates the institute's tenant record and provisions its login account in one step.
          </p>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Institute name
              </label>
              <input
                type="text"
                required
                value={form.instituteName}
                onChange={(e) => updateField('instituteName', e.target.value)}
                placeholder="e.g. Horizon IELTS Academy"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Owner name
              </label>
              <input
                type="text"
                required
                value={form.ownerName}
                onChange={(e) => updateField('ownerName', e.target.value)}
                placeholder="e.g. Priya Sharma"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Admin username
              </label>
              <input
                type="text"
                required
                value={form.username}
                onChange={(e) => updateField('username', e.target.value)}
                placeholder="e.g. horizon-admin"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Email ID
              </label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                placeholder="owner@institute.com"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Primary contact no.
              </label>
              <input
                type="tel"
                required
                value={form.primaryContact}
                onChange={(e) => updateField('primaryContact', e.target.value)}
                placeholder="e.g. +91 98765 43210"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Secondary contact no. <span className="font-normal normal-case text-slate-400">(optional)</span>
              </label>
              <input
                type="tel"
                value={form.secondaryContact}
                onChange={(e) => updateField('secondaryContact', e.target.value)}
                placeholder="e.g. +91 98765 43211"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Address
              </label>
              <textarea
                required
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
                rows={2}
                placeholder="Street, city, state, PIN"
                className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm leading-relaxed text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            {formError && (
              <p className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {formError}
              </p>
            )}
            {formSuccess && (
              <p className="sm:col-span-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                ✅ {formSuccess}
              </p>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-600/20 transition-all duration-200 hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Registering…' : 'Register institute'}
              </button>
            </div>
          </form>
        </div>

        {/* Institutes table */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-800">
              Registered institutes {!loading && `(${institutes.length})`}
            </h2>
            <button
              onClick={loadInstitutes}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-slate-400">Loading institutes…</p>
          ) : loadError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{loadError}</p>
          ) : institutes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 py-10 text-center">
              <p className="text-sm font-medium text-slate-600">No institutes registered yet.</p>
              <p className="mt-1 text-xs text-slate-400">Use the form above to onboard the first one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2">Institute</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2">Username</th>
                    <th className="px-3 py-2">Contact</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {institutes.map((inst) => (
                    <tr key={inst._id} className="border-b border-slate-100 align-top last:border-b-0">
                      <td className="px-3 py-3">
                        <p className="font-semibold text-slate-800">{inst.instituteName}</p>
                        <p className="mt-0.5 max-w-[220px] text-xs text-slate-400">{inst.address}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{inst.ownerName}</td>
                      <td className="px-3 py-3 text-slate-700">{inst.username}</td>
                      <td className="px-3 py-3 text-slate-700">
                        <p>{inst.primaryContact}</p>
                        {inst.secondaryContact && <p className="text-xs text-slate-400">{inst.secondaryContact}</p>}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{inst.email}</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                            inst.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          {inst.status === 'active' ? 'Active' : 'Blocked'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          onClick={() => handleToggleStatus(inst)}
                          disabled={togglingId === inst._id}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            inst.status === 'active'
                              ? 'border border-rose-300 text-rose-600 hover:bg-rose-50'
                              : 'border border-green-300 text-green-700 hover:bg-green-50'
                          }`}
                        >
                          {togglingId === inst._id
                            ? 'Updating…'
                            : inst.status === 'active'
                            ? 'Block institute'
                            : 'Activate institute'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
