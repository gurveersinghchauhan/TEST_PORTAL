import { useState } from 'react';
import { authHeaders } from './apiAuth';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function IconX({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const fieldClass =
  'w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm outline-none transition focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100';

/**
 * ManualEvaluationModal
 * ----------------------
 * "Manual Grading" form for one student's Writing + Speaking bands on a
 * Full Mock Test bundle — the only way either module ever gets scored,
 * since neither has an auto-checker (see backend/routes/fullMockSessions.js
 * and models/Submission.js's module enum, which only ever covers
 * 'reading'/'listening'). Saves via PUT /api/full-mocks/:id/results/:studentId
 * and hands the server's recomputed row back to the caller through
 * `onSaved` — FullMockTests.jsx uses that to refresh the unified scorecard
 * without a full page re-fetch feeling necessary, though it re-fetches
 * anyway to keep the Reading/Listening side of the row perfectly live too.
 *
 * @param {{
 *   fullMockId: string,
 *   student: { studentId, studentName, writingBand, writingFeedback, speakingBand, speakingFeedback },
 *   onClose: () => void,
 *   onSaved: (result: object) => void,
 * }} props
 */
export default function ManualEvaluationModal({ fullMockId, student, onClose, onSaved }) {
  const [writingBand, setWritingBand] = useState(student.writingBand ?? '');
  const [writingFeedback, setWritingFeedback] = useState(student.writingFeedback || '');
  const [speakingBand, setSpeakingBand] = useState(student.speakingBand ?? '');
  const [speakingFeedback, setSpeakingFeedback] = useState(student.speakingFeedback || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/full-mocks/${fullMockId}/results/${student.studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          // Sent as-typed (a string, possibly empty) — the backend is what
          // actually parses/clamps/validates this (see routes/
          // fullMockSessions.js's clampBand), so an invalid value comes
          // back as a clear 400 rather than being silently coerced here.
          writingBand,
          writingFeedback,
          speakingBand,
          speakingFeedback,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Failed to save this grading (HTTP ${res.status}).`);
      onSaved(data.result);
      onClose();
    } catch (err) {
      setError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-800">Manual grading — {student.studentName}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="Close"
          >
            <IconX className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-neutral-500">
          Writing and Speaking have no automatic checker — enter the band and any notes for the student's record.
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="writing-band" className="mb-1 block text-xs font-medium text-neutral-600">
                Writing band (0–9)
              </label>
              <input
                id="writing-band"
                type="number"
                min={0}
                max={9}
                step={0.5}
                value={writingBand}
                onChange={(e) => setWritingBand(e.target.value)}
                placeholder="e.g. 6.5"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="speaking-band" className="mb-1 block text-xs font-medium text-neutral-600">
                Speaking band (0–9)
              </label>
              <input
                id="speaking-band"
                type="number"
                min={0}
                max={9}
                step={0.5}
                value={speakingBand}
                onChange={(e) => setSpeakingBand(e.target.value)}
                placeholder="e.g. 7"
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label htmlFor="writing-feedback" className="mb-1 block text-xs font-medium text-neutral-600">
              Writing feedback
            </label>
            <textarea
              id="writing-feedback"
              rows={3}
              value={writingFeedback}
              onChange={(e) => setWritingFeedback(e.target.value)}
              placeholder="Task achievement, coherence & cohesion, lexical resource, grammar…"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor="speaking-feedback" className="mb-1 block text-xs font-medium text-neutral-600">
              Speaking feedback
            </label>
            <textarea
              id="speaking-feedback"
              rows={3}
              value={speakingFeedback}
              onChange={(e) => setSpeakingFeedback(e.target.value)}
              placeholder="Fluency & coherence, pronunciation, grammar, vocabulary…"
              className={fieldClass}
            />
          </div>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save grading'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
