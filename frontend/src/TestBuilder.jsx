import { useState } from 'react';
import ReadingTestWizard from './ReadingTestWizard';
import SpeakingTestWizard from './SpeakingTestWizard';
import WritingTestWizard from './WritingTestWizard';
import ListeningTestWizard from './ListeningTestWizard';
import { PRACTICE_MODULES } from './PracticeTests';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

/* -------------------------------------------------------------------------
 * Copyright disclaimer — shown once per Test Builder visit, before any
 * module selection. Gates the whole builder (module grid + every flow
 * below it) behind an explicit "Agree & Proceed" click.
 * ---------------------------------------------------------------------- */
function DisclaimerScreen({ onAgree }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      {/* Deliberately not vertically centered with `items-center` on the
          scrolling container — combining that with overflow can clip the
          top of the content on some browsers when it grows taller than the
          viewport (e.g. a long paste of copyright text). Plain top-down
          flow with generous padding avoids that entirely. */}
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <div className="w-full rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <path d="M12 9v4M12 16.5h.01" />
              <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
            </svg>
          </div>

          <h1 className="mb-2 text-lg font-bold text-neutral-900">Copyright &amp; Content Responsibility</h1>

          <p className="mb-3 text-sm leading-relaxed text-neutral-600">
            The Test Builder lets you upload, paste, or otherwise create test content — passages, audio, cue cards,
            and questions — for your students. Your institute or teacher account is solely responsible for ensuring
            that any material you publish on this portal does not infringe the copyright of its original publisher
            (for example Cambridge IELTS, British Council, IDP, or other test-preparation publishers).
          </p>
          <p className="mb-6 text-sm leading-relaxed text-neutral-600">
            This portal is a delivery tool only — it does not grant, and should not be treated as granting, any
            license to reproduce or distribute copyrighted material. Please make sure you hold the appropriate rights
            or permissions before publishing any test to your students.
          </p>

          <button
            onClick={onAgree}
            className="w-full rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            Agree &amp; Proceed
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Module selection grid — the Test Builder's home screen once the
 * disclaimer is accepted. All 4 modules have a working builder today.
 * ---------------------------------------------------------------------- */
function ModuleGrid({ onSelect }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="mb-1 text-xl font-semibold">Test Builder</h1>
        <p className="mb-6 text-sm text-neutral-500">Choose a module to start building a new test.</p>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {PRACTICE_MODULES.map((m) => (
            <button
              key={m.key}
              onClick={() => onSelect(m.key)}
              className="group flex items-start gap-4 rounded-2xl border border-neutral-200 bg-white p-6 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-neutral-300 hover:shadow-lg"
            >
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-110 ${m.accent}`}>
                <m.Icon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-neutral-900">Create {m.label} Test</h3>
                <p className="mt-1 text-sm text-neutral-500">{m.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * TestBuilder
 * -----------
 * Entry flow: copyright disclaimer → module selection → the builder for
 * whichever module the teacher picked.
 *
 *  - Reading: the multi-step wizard in ReadingTestWizard.jsx (manual
 *    passage/question editing, or "Import via JSON" to auto-populate from
 *    AI-generated content).
 *  - Listening: the multi-step wizard in ListeningTestWizard.jsx (4 fixed
 *    sections, manual entry or "Import via JSON").
 *  - Speaking: the multi-step wizard in SpeakingTestWizard.jsx.
 *  - Writing: the multi-step wizard in WritingTestWizard.jsx.
 *
 * All four modules now have a dedicated wizard, so the old PDF-upload flow
 * (PdfUploadZone + TestDraftEditor) is no longer reachable from here.
 *
 * Every screen here (and every wizard) uses the same `flex h-full flex-col`
 * + `overflow-y-auto` inner scroll region shell, so long content always
 * scrolls within its own container instead of getting clipped by App.jsx's
 * `overflow-hidden` tab wrapper.
 */
export default function TestBuilder() {
  const [hasAgreed, setHasAgreed] = useState(false);
  const [activeModule, setActiveModule] = useState(null); // null | 'reading' | 'listening' | 'speaking' | 'writing'

  function backToModules() {
    setActiveModule(null);
  }

  // --- Gate 1: copyright disclaimer ---
  if (!hasAgreed) {
    return <DisclaimerScreen onAgree={() => setHasAgreed(true)} />;
  }

  // --- Gate 2: module selection ---
  if (!activeModule) {
    return <ModuleGrid onSelect={setActiveModule} />;
  }

  if (activeModule === 'reading') {
    return <ReadingTestWizard apiBase={API_BASE} onBack={backToModules} />;
  }

  if (activeModule === 'speaking') {
    return <SpeakingTestWizard apiBase={API_BASE} onBack={backToModules} />;
  }

  if (activeModule === 'writing') {
    return <WritingTestWizard apiBase={API_BASE} onBack={backToModules} />;
  }

  if (activeModule === 'listening') {
    return <ListeningTestWizard apiBase={API_BASE} onBack={backToModules} />;
  }

  return null;
}
