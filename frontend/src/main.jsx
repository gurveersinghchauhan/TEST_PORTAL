import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

// Top-level safety net: without this, ANY uncaught render error anywhere in
// the app (e.g. a submission/report render hitting an unexpected missing
// field) unmounts the whole React tree and leaves a blank white screen with
// no way to recover except a manual refresh. This catches that case and
// offers a reload button instead.
const rootFallback = (
  <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
    <h1 className="text-lg font-bold text-slate-800">Something went wrong.</h1>
    <p className="max-w-sm text-sm text-slate-500">
      This page ran into an unexpected error. Reloading usually fixes it — your test/report data is safely stored on
      the server either way.
    </p>
    <button
      onClick={() => window.location.reload()}
      className="mt-1 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
    >
      Reload page
    </button>
  </div>
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary fallback={rootFallback}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
