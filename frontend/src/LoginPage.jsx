import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

// Phrases the left panel's headline typewriter loops through, per spec.
const HEADLINE_PHRASES = [
  'ACCESS TO ABROAD',
  'GIVE WINGS TO YOUR OVERSEAS DREAMS',
  'YOUR GATEWAY TO GLOBAL EDUCATION',
];

/**
 * Small, dependency-free typewriter: types out each phrase, holds, deletes
 * it, pauses, then moves to the next phrase — looping forever. Timers are
 * chained via setTimeout (not setInterval) so typing/deleting/holding can
 * each have their own speed, and every timer is cleaned up on unmount/
 * re-render so nothing leaks once the login page goes away.
 */
function useTypewriter(phrases, { typingSpeed = 55, deletingSpeed = 30, holdMs = 1700, pauseMs = 450 } = {}) {
  const [text, setText] = useState('');
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = phrases[phraseIndex % phrases.length];
    let timeoutId;

    if (!deleting && text === current) {
      timeoutId = setTimeout(() => setDeleting(true), holdMs);
    } else if (deleting && text === '') {
      timeoutId = setTimeout(() => {
        setDeleting(false);
        setPhraseIndex((i) => (i + 1) % phrases.length);
      }, pauseMs);
    } else {
      const next = deleting ? current.slice(0, text.length - 1) : current.slice(0, text.length + 1);
      timeoutId = setTimeout(() => setText(next), deleting ? deletingSpeed : typingSpeed);
    }

    return () => clearTimeout(timeoutId);
  }, [text, deleting, phraseIndex, phrases, typingSpeed, deletingSpeed, holdMs, pauseMs]);

  return text;
}

/**
 * Simple line-art globe/passport-style mark for the left panel's
 * institutional badge — flat, monochrome (currentColor), no fills/glow.
 * Deliberately generic-but-fitting for a study-abroad/visa consultancy
 * rather than a literal reproduction of any external logo.
 */
function BrandMarkIcon({ className = 'h-6 w-6' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.7 9.5h16.6M3.7 14.5h16.6" />
      <path d="M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5Z" />
    </svg>
  );
}

/**
 * LoginPage
 * ---------
 * Universal login for all 3 roles — institute, teacher, student. The form
 * doesn't ask which kind of account is logging in; the server decides and
 * sends the role back inside the JWT/user object.
 *
 * Premium-but-sober enterprise split-screen layout: a dark-gradient
 * institutional identity panel on the left (badge, a looping typewriter
 * headline — see useTypewriter/HEADLINE_PHRASES above, divider, descriptive
 * text), and a sign-in card that is perfectly centered — both axes — inside
 * a clean light panel on the right. Stacks vertically on small screens.
 * All auth logic below (fetch,
 * localStorage, error handling, onLogin callback that App.jsx uses for
 * role-based redirects) is unchanged from earlier versions of this page —
 * only the visual design has been reworked.
 */
export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const typedHeadline = useTypewriter(HEADLINE_PHRASES);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data.error || (res.status === 401 ? 'Invalid email or password.' : `Login failed (HTTP ${res.status}).`)
        );
      }

      localStorage.setItem('auth_token', data.token);
      localStorage.setItem('auth_user', JSON.stringify(data.user));
      onLogin({ token: data.token, user: data.user });
    } catch (err) {
      setError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      {/* Left column — institutional identity panel: subtle dark gradient,
          badge, looping typewriter headline, divider, descriptive text. */}
      <div className="flex w-full shrink-0 flex-col justify-between bg-gradient-to-b from-slate-950 via-slate-900 to-indigo-950 px-8 py-12 md:w-1/2 md:px-16 md:py-16 lg:px-24">
        <div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white">
            <BrandMarkIcon className="h-7 w-7" />
          </div>

          <span className="mt-8 block text-lg font-bold uppercase tracking-[0.2em] text-rose-500 md:text-xl">
            A2A Consultants
          </span>

          {/* Reserves vertical space for the typewriter heading — sized for
              the worst case (the longest phrase wrapping to 3 lines) at
              each breakpoint's font-size/line-height (text-3xl/4xl/5xl at
              leading-tight = 1.25), so the divider and static text below
              never shift as the typed/deleted text grows and shrinks:
                3xl: 1.875rem × 1.25 × 3 lines ≈ 7.03rem → 7.25rem
                4xl: 2.25rem  × 1.25 × 3 lines ≈ 8.44rem → 8.75rem
                5xl: 3rem     × 1.25 × 3 lines = 11.25rem → 11.5rem
              This wrapper (not the <h1> itself) owns the min-height, so
              typography and layout-stability concerns stay separate. */}
          <div className="mt-3 flex min-h-[7.25rem] items-start sm:min-h-[8.75rem] lg:min-h-[11.5rem]">
            <h1 className="text-3xl font-bold uppercase leading-tight tracking-wide text-white sm:text-4xl lg:text-5xl">
              {typedHeadline}
              <span aria-hidden="true" className="animate-pulse font-normal text-white">
                |
              </span>
            </h1>
          </div>
          <span className="sr-only">Access to Abroad</span>

          <div className="mt-6 h-px w-16 bg-slate-600" />

          <p className="mt-6 max-w-sm text-sm font-medium text-slate-300 sm:text-base">
            Official Student &amp; Faculty Portal
          </p>

          <p className="mt-3 max-w-sm text-sm leading-relaxed text-slate-400">
            Sign in to manage and take IELTS practice tests, review results, and coordinate with your institute —
            all in one place.
          </p>
        </div>

        <p className="mt-12 text-xs text-slate-500 md:mt-0">
          © {new Date().getFullYear()} Access to Abroad Consultants. All rights reserved.
        </p>
      </div>

      {/* Right column — sign-in card, perfectly centered both axes. A soft
          gradient (rather than flat white/slate-50) gives the white card
          above it a subtle sense of depth without competing for attention. */}
      <div className="flex h-full w-full flex-1 items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100/50 to-slate-100 px-4 py-12 md:w-1/2">
        <div className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-8 shadow-xl">
          <div className="mb-7">
            <h2 className="text-xl font-bold text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">Enter your credentials to access your account.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border-2 border-slate-300 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border-2 border-slate-300 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:bg-rose-700 focus:outline-none focus:ring-4 focus:ring-rose-500/25 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
