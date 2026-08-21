import { useEffect, useState } from 'react';
import { PracticeTestsSection, PracticeTestsGridView } from './PracticeTests';
import { useBackNavigation } from './useBackNavigation';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

/**
 * InstituteDashboard
 * ------------------
 * Home for the 'institute' role: create teacher accounts under itself
 * (Tier 2 — POST /api/users/add-teacher) and see who's already been added
 * (GET /api/users/teachers). Both calls carry the institute's own JWT from
 * localStorage, so the backend always scopes to "teachers belonging to me."
 */
export default function InstituteDashboard({ auth, onLogout }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', contactNumber: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

  const [teachers, setTeachers] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [batchName, setBatchName] = useState('');
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchFormError, setBatchFormError] = useState(null);
  const [batchFormSuccess, setBatchFormSuccess] = useState(null);
  const [batches, setBatches] = useState([]);
  const [batchListLoading, setBatchListLoading] = useState(true);
  const [batchListError, setBatchListError] = useState(null);

  const [selectedPracticeModule, setSelectedPracticeModule] = useState(null);
  // See useBackNavigation.js — without this, browsing into a module's test
  // grid and then pressing the physical Back button exits the app instead
  // of returning to this dashboard.
  useBackNavigation(Boolean(selectedPracticeModule), () => setSelectedPracticeModule(null));

  function authHeaders() {
    const token = localStorage.getItem('auth_token') || auth?.token;
    return { Authorization: `Bearer ${token}` };
  }

  async function loadTeachers() {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch(`${API_BASE}/users/teachers`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load teachers (HTTP ${res.status}).`);
      setTeachers(data.teachers || []);
    } catch (err) {
      setListError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setListLoading(false);
    }
  }

  async function loadBatches() {
    setBatchListLoading(true);
    setBatchListError(null);
    try {
      const res = await fetch(`${API_BASE}/batches`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to load batches (HTTP ${res.status}).`);
      setBatches(data.batches || []);
    } catch (err) {
      setBatchListError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setBatchListLoading(false);
    }
  }

  useEffect(() => {
    loadTeachers();
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleBatchSubmit(e) {
    e.preventDefault();
    setBatchFormError(null);
    setBatchFormSuccess(null);
    setBatchSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: batchName }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Failed to create batch (HTTP ${res.status}).`);
      }

      setBatchFormSuccess(`Batch "${data.batch.name}" was created successfully.`);
      setBatchName('');
      loadBatches(); // refresh the list below
    } catch (err) {
      setBatchFormError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setBatchSubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/users/add-teacher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Failed to create teacher (HTTP ${res.status}).`);
      }

      setFormSuccess(`Teacher "${data.user.name}" was created successfully.`);
      setForm({ name: '', email: '', password: '', contactNumber: '' });
      loadTeachers(); // refresh the list below
    } catch (err) {
      setFormError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (selectedPracticeModule) {
    return (
      <PracticeTestsGridView
        module={selectedPracticeModule}
        onBack={() => window.history.back()}
        testsEndpoint={`${API_BASE}/tests`}
        canPreview
        viewerRole="institute"
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-50">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-500">Institute</p>
          <h1 className="text-lg font-bold text-slate-800">{auth.user.name}</h1>
        </div>
        <button
          onClick={onLogout}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          Log out
        </button>
      </div>

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <PracticeTestsSection onSelectModule={setSelectedPracticeModule} />

        {/* Add Teacher form */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800">Add a teacher</h2>
          <p className="mt-1 text-sm text-slate-500">Creates a login for a teacher under your institute.</p>

          <form onSubmit={handleSubmit} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" id="teacher-name">
              <input
                id="teacher-name"
                type="text"
                required
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                className={inputClass}
                placeholder="Jane Doe"
              />
            </Field>

            <Field label="Email" id="teacher-email">
              <input
                id="teacher-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => updateField('email', e.target.value)}
                className={inputClass}
                placeholder="jane@example.com"
              />
            </Field>

            <Field label="Password" id="teacher-password">
              <input
                id="teacher-password"
                type="password"
                required
                minLength={8}
                value={form.password}
                onChange={(e) => updateField('password', e.target.value)}
                className={inputClass}
                placeholder="At least 8 characters"
              />
            </Field>

            <Field label="Contact Number" id="teacher-contact">
              <input
                id="teacher-contact"
                type="tel"
                required
                value={form.contactNumber}
                onChange={(e) => updateField('contactNumber', e.target.value)}
                className={inputClass}
                placeholder="9876543210"
              />
            </Field>

            {formError && (
              <p className="sm:col-span-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {formError}
              </p>
            )}
            {formSuccess && (
              <p className="sm:col-span-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {formSuccess}
              </p>
            )}

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white shadow-lg shadow-rose-600/20 transition-all duration-200 hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                {submitting ? 'Creating…' : 'Create teacher'}
              </button>
            </div>
          </form>
        </div>

        {/* Manage Batches */}
        <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-800">Manage batches</h2>
          <p className="mt-1 text-sm text-slate-500">
            Batches teachers can assign students to when creating a student account.
          </p>

          <form onSubmit={handleBatchSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="batch-name" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Batch name
              </label>
              <input
                id="batch-name"
                type="text"
                required
                value={batchName}
                onChange={(e) => setBatchName(e.target.value)}
                className={inputClass}
                placeholder="Morning Batch"
              />
            </div>
            <button
              type="submit"
              disabled={batchSubmitting}
              className="flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 font-semibold text-white shadow-lg shadow-rose-600/20 transition-all duration-200 hover:bg-rose-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {batchSubmitting ? 'Creating…' : 'Create batch'}
            </button>
          </form>

          {batchFormError && (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {batchFormError}
            </p>
          )}
          {batchFormSuccess && (
            <p className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              {batchFormSuccess}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Existing batches</h3>
            <button
              onClick={loadBatches}
              className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Refresh
            </button>
          </div>

          {batchListLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading batches…</p>
          ) : batchListError ? (
            <p className="py-6 text-center text-sm text-rose-600">{batchListError}</p>
          ) : batches.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No batches yet — create one above.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200">
              {batches.map((b) => (
                <li key={b._id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="font-medium text-slate-800">{b.name}</span>
                  <span className="text-slate-400">
                    {b.createdAt ? new Date(b.createdAt).toLocaleDateString() : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Existing teachers */}
        <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">Your teachers</h2>
            <button
              onClick={loadTeachers}
              className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            >
              Refresh
            </button>
          </div>

          {listLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Loading teachers…</p>
          ) : listError ? (
            <p className="py-8 text-center text-sm text-rose-600">{listError}</p>
          ) : teachers.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">
              No teachers yet — add one using the form above.
            </p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Email</th>
                    <th className="px-4 py-2 font-medium">Contact</th>
                    <th className="px-4 py-2 font-medium">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((t) => (
                    <tr key={t._id} className="border-t border-slate-200">
                      <td className="px-4 py-2 font-medium text-slate-800">{t.name}</td>
                      <td className="px-4 py-2 text-slate-600">{t.email}</td>
                      <td className="px-4 py-2 text-slate-600">{t.contactNumber}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}
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

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-100';

function Field({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}
