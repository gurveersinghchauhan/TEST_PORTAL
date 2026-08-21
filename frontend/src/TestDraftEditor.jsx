import { useState } from 'react';
import PartEditor from './PartEditor';
import { authHeaders } from './apiAuth';

/**
 * TestDraftEditor
 * ----------------
 * The review/edit screen for a Reading or Listening test: title, duration,
 * and every passage/track + question group, backed by PATCH /api/tests/:id
 * and POST /api/tests/:id/publish.
 *
 * Used in two places:
 *  - Right after a PDF upload in TestBuilder.jsx (a brand-new, unpublished
 *    draft).
 *  - From the "Edit Test" button on the Question Preview page
 *    (PracticeTests.jsx), on an existing test that may already be
 *    published — same editor either way, just seeded from a different
 *    starting point.
 */
export default function TestDraftEditor({ test, apiBase, onBack, onSaved, backLabel = 'Back', warnings = [] }) {
  const [draft, setDraft] = useState(test);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublished, setIsPublished] = useState(Boolean(test.isPublished));
  const [error, setError] = useState(null);

  function updatePart(partIndex, updatedPart) {
    setDraft((prev) => ({
      ...prev,
      parts: prev.parts.map((p, i) => (i === partIndex ? updatedPart : p)),
    }));
  }

  async function saveDraft() {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/tests/${draft._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ title: draft.title, durationMinutes: draft.durationMinutes, parts: draft.parts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed.');
      setDraft(data.test);
      if (onSaved) onSaved(data.test);
      return data.test;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsSaving(false);
    }
  }

  async function publishTest() {
    try {
      await saveDraft(); // make sure the latest edits are persisted first
      const res = await fetch(`${apiBase}/tests/${draft._id}/publish`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Publish failed.');
      setDraft(data.test);
      setIsPublished(true);
      if (onSaved) onSaved(data.test);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Scrollable content — the footer nav below is a real flex-shrink-0
          bar, not `sticky`, so it never depends on (or gets clipped by) an
          ancestor's overflow-hidden. See SpeakingTestWizard.jsx for the
          same fix applied to the other builder wizards. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-8 pb-10">
          <button
            onClick={onBack}
            className="mb-6 flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-neutral-800"
          >
            ← {backLabel}
          </button>

          {isPublished && (
            <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              ✅ Published — this test is live for your students.
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {warnings.map((w, i) => (
                <p key={i}>⚠️ {w}</p>
              ))}
            </div>
          )}

          {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

          <div className="mb-6 flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Test title</label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-32">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Duration (min)</label>
              <input
                type="number"
                value={draft.durationMinutes}
                onChange={(e) => setDraft((prev) => ({ ...prev, durationMinutes: Number(e.target.value) }))}
                className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          {(draft.parts || []).map((part, i) => (
            <PartEditor key={i} part={part} onChange={(updated) => updatePart(i, updated)} apiBase={apiBase} />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-neutral-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl justify-end gap-3">
          <button
            onClick={saveDraft}
            disabled={isSaving}
            className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            onClick={publishTest}
            disabled={isPublished}
            className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {isPublished ? 'Published' : 'Publish test'}
          </button>
        </div>
      </div>
    </div>
  );
}
