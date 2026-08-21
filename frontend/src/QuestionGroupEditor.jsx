import ImageUploadDropzone from './components/common/ImageUploadDropzone';

const QUESTION_TYPES = [
  'true-false-not-given',
  'yes-no-not-given',
  'multiple-choice',
  'multiple-select',
  'fill-in-the-blank',
  'matching-heading',
  'matching-information',
  'short-answer',
  // Layout-only group types — every question underneath is still a plain
  // fill-in-the-blank for grading; what differs is how TestInterface.jsx
  // renders the group (see NoteCompletionGroup / TableCompletionGroup
  // there): the original note/table structure instead of one line per
  // question. layoutText / tableColumns+tableRows are edited below.
  'note-completion',
  'summary-completion',
  'table-completion',
  // Map/plan/diagram labeling — "Label the map/plan/diagram below. Choose
  // the correct letter, A-H." Its own backend type (matrix-matching, a real
  // grading type unlike the layout-only ones above), rendered by
  // TestInterface.jsx's MatrixMatchingGroup as an image beside a
  // question-rows × option-columns radio grid. matrixOptions/mapImageUrl
  // are edited below, same as this file already does for layoutText and
  // wordBank.
  'matrix-matching',
];

// note-completion and summary-completion are the same rich-text/cloze note
// block in TestInterface.jsx (NoteCompletionGroup) — different Cambridge
// task names, identical layoutText+{{n}}-marker authoring UI below.
const NOTE_LAYOUT_TYPES = ['note-completion', 'summary-completion'];

// Group types where a shared drag-and-drop word bank (backend
// questionGroupSchema.wordBank) makes sense — TestInterface.jsx renders
// every blank in the group as a drop-slot instead of free text/radios when
// this group's wordBank is non-empty. See WordBankChip/WordBankDropSlot
// there.
const WORD_BANK_TYPES = [
  'fill-in-the-blank',
  'matching-heading',
  'matching-information',
  'note-completion',
  'summary-completion',
  'table-completion',
];

/**
 * QuestionGroupEditor
 * --------------------
 * One "Questions N–M" block. Renders every extracted question with its
 * auto-detected prompt and answer key value, all editable — this is the
 * safety net for whatever the regex-based parser got slightly wrong.
 */
export default function QuestionGroupEditor({ group, onChange, apiBase }) {
  function updateGroupField(field, value) {
    onChange({ ...group, [field]: value });
  }

  function updateQuestion(qIndex, updatedQuestion) {
    const questions = group.questions.map((q, i) => (i === qIndex ? updatedQuestion : q));
    onChange({ ...group, questions });
  }

  // --- table-completion helpers --------------------------------------
  const tableColumns = group.tableColumns || [];
  const tableRows = group.tableRows || [];

  function updateColumnLabel(ci, value) {
    updateGroupField('tableColumns', tableColumns.map((c, i) => (i === ci ? value : c)));
  }
  function addColumn() {
    updateGroupField('tableColumns', [...tableColumns, `Column ${tableColumns.length + 1}`]);
    updateGroupField('tableRows', tableRows.map((row) => [...row, '']));
  }
  function removeColumn(ci) {
    updateGroupField('tableColumns', tableColumns.filter((_, i) => i !== ci));
    updateGroupField('tableRows', tableRows.map((row) => row.filter((_, i) => i !== ci)));
  }
  function updateCell(ri, ci, value) {
    updateGroupField(
      'tableRows',
      tableRows.map((row, i) => (i === ri ? row.map((c, j) => (j === ci ? value : c)) : row))
    );
  }
  function addRow() {
    updateGroupField('tableRows', [...tableRows, tableColumns.map(() => '')]);
  }
  function removeRow(ri) {
    updateGroupField('tableRows', tableRows.filter((_, i) => i !== ri));
  }

  // --- word bank helpers ------------------------------------------------
  const showWordBank = WORD_BANK_TYPES.includes(group.questionType);
  function updateWordBankText(text) {
    // Keep exactly what the teacher typed (including a blank line while
    // they're mid-edit) so the textarea never fights their cursor; blank
    // lines are harmless here and get skipped wherever wordBank chips are
    // actually built (TestInterface.jsx's chipRegistry).
    updateGroupField('wordBank', text.split('\n'));
  }

  return (
    <div className="mb-4 rounded border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-3 py-2">
        <span className="text-xs font-semibold text-neutral-700">
          Questions {group.startNumber}
          {group.endNumber !== group.startNumber ? `–${group.endNumber}` : ''}
        </span>
        <select
          value={group.questionType}
          onChange={(e) => updateGroupField('questionType', e.target.value)}
          className="ml-auto rounded border border-neutral-300 px-2 py-1 text-xs"
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/-/g, ' ')}
            </option>
          ))}
        </select>
      </div>

      <div className="px-3 py-2">
        <label className="mb-1 block text-xs font-medium text-neutral-500">Group instructions</label>
        <input
          type="text"
          value={group.groupInstructions}
          onChange={(e) => updateGroupField('groupInstructions', e.target.value)}
          className="mb-3 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
        />

        {NOTE_LAYOUT_TYPES.includes(group.questionType) && (
          <div className="mb-3 rounded border border-neutral-200 bg-neutral-50 p-2">
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Note layout — shown to students exactly as written. Mark each blank inline as{' '}
              <code className="rounded bg-neutral-200 px-1">{'{{n}}'}</code> (e.g. "Founded in {'{{15}}'} by..." —
              the older <code className="rounded bg-neutral-200 px-1">[[n]]</code> form still works too, for
              anything written before this syntax). A line starting with{' '}
              <code className="rounded bg-neutral-200 px-1"># </code> renders as a centered, bold main title, one
              starting with <code className="rounded bg-neutral-200 px-1">## </code> as a left-aligned bold
              sub-heading, and one starting with <code className="rounded bg-neutral-200 px-1">- </code> as a
              bullet (indent it 2 spaces, e.g. <code className="rounded bg-neutral-200 px-1">{'  - '}</code>, for a
              nested sub-point).
            </label>
            <textarea
              rows={6}
              value={group.layoutText || ''}
              onChange={(e) => updateGroupField('layoutText', e.target.value)}
              placeholder={'# Section heading\n## Sub-heading\n- Note line with a blank: {{' + group.startNumber + '}}\n  - Nested detail'}
              className="w-full resize-y rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
            />
          </div>
        )}

        {group.questionType === 'table-completion' && (
          <div className="mb-3 rounded border border-neutral-200 bg-neutral-50 p-2">
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Table layout — mark each blank cell as <code className="rounded bg-neutral-200 px-1">{'{{n}}'}</code>{' '}
              (the older <code className="rounded bg-neutral-200 px-1">[[n]]</code> form still works too).
            </label>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {tableColumns.map((col, ci) => (
                      <th key={ci} className="border border-neutral-300 p-1">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={col}
                            onChange={(e) => updateColumnLabel(ci, e.target.value)}
                            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs font-semibold"
                          />
                          <button
                            type="button"
                            onClick={() => removeColumn(ci)}
                            title="Remove column"
                            className="shrink-0 rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-rose-600"
                          >
                            ✕
                          </button>
                        </div>
                      </th>
                    ))}
                    <th className="border border-neutral-300 p-1">
                      <button
                        type="button"
                        onClick={addColumn}
                        className="w-full rounded border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                      >
                        + Column
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri}>
                      {tableColumns.map((_, ci) => (
                        <td key={ci} className="border border-neutral-300 p-1">
                          <input
                            type="text"
                            value={row[ci] || ''}
                            onChange={(e) => updateCell(ri, ci, e.target.value)}
                            className="w-full rounded border border-neutral-300 px-1.5 py-1 text-xs"
                          />
                        </td>
                      ))}
                      <td className="border border-neutral-300 p-1 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(ri)}
                          title="Remove row"
                          className="rounded px-1 text-neutral-400 hover:bg-neutral-200 hover:text-rose-600"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addRow}
              className="mt-2 w-full rounded border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
            >
              + Row
            </button>
          </div>
        )}

        {group.questionType === 'matrix-matching' && (
          <div className="mb-3 rounded border border-neutral-200 bg-neutral-50 p-2">
            <div className="mb-3">
              <ImageUploadDropzone
                apiBase={apiBase}
                imageUrl={group.mapImageUrl}
                onUploaded={(url) => updateGroupField('mapImageUrl', url)}
                label="Map / plan / diagram image (optional) — shown above the answer grid."
              />
            </div>
            <label className="mb-1 block text-xs font-medium text-neutral-500">
              Answer grid columns — the shared set of letters every question below picks ONE from (e.g. "Choose the
              correct letter, A-H"). One per line, left-to-right order. Each question's Answer below must exactly
              match one line here — the same letter may correctly be reused across more than one row.
            </label>
            <textarea
              rows={4}
              value={(group.matrixOptions || []).join('\n')}
              onChange={(e) => updateGroupField('matrixOptions', e.target.value.split('\n'))}
              placeholder={'A\nB\nC\nD\nE\nF\nG'}
              className="w-full resize-y rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
            />
          </div>
        )}

        {showWordBank && (
          <div className="mb-3 rounded border border-neutral-200 bg-neutral-50 p-2">
            <div className="mb-1 flex items-start justify-between gap-3">
              <label className="block text-xs font-medium text-neutral-500">
                Word bank (optional) — drag-and-drop options students choose from instead of typing, one per line
                (e.g. Cambridge's "choose from the box, A-J"). Each affected question's Answer below must exactly
                match one line here. Leave empty for a normal typed answer.
              </label>
              <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-neutral-600">
                <input
                  type="checkbox"
                  checked={Boolean(group.allowRepeatWordBankOptions)}
                  onChange={(e) => updateGroupField('allowRepeatWordBankOptions', e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-neutral-400"
                />
                Allow reusing an option
              </label>
            </div>
            <textarea
              rows={4}
              value={(group.wordBank || []).join('\n')}
              onChange={(e) => updateWordBankText(e.target.value)}
              placeholder={'funding\ntrees\nmoral standards'}
              className="w-full resize-y rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
            />
          </div>
        )}

        {(NOTE_LAYOUT_TYPES.includes(group.questionType) || group.questionType === 'table-completion') && (
          <p className="mb-2 text-xs italic text-neutral-400">
            "Prompt" below is just a short label for each blank (e.g. "Founding year") — the actual question text is
            the note/table layout above. Answer and explanation still apply per blank.
          </p>
        )}

        {group.questionType === 'matrix-matching' && (
          <p className="mb-2 text-xs italic text-neutral-400">
            "Prompt" below is the row label shown on the answer grid (e.g. "bridge foundations") and "Answer" is the
            grid letter (e.g. "C") — it must exactly match one line in "Answer grid columns" above.
          </p>
        )}

        {group.questions.map((q, qi) => (
          <div key={q.questionNumber} className="mb-2 flex items-start gap-2 rounded border border-neutral-100 p-2">
            <span className="mt-1.5 w-6 shrink-0 text-xs font-semibold text-neutral-500">{q.questionNumber}</span>
            <div className="flex-1">
              <input
                type="text"
                value={q.prompt}
                onChange={(e) => updateQuestion(qi, { ...q, prompt: e.target.value })}
                className={`mb-1 w-full rounded border px-2 py-1 text-sm ${
                  q.prompt.startsWith('[Could not auto-extract')
                    ? 'border-amber-300 bg-amber-50'
                    : 'border-neutral-300'
                }`}
              />
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">Answer:</span>
                <input
                  type="text"
                  value={Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer || ''}
                  onChange={(e) => updateQuestion(qi, { ...q, correctAnswer: e.target.value })}
                  placeholder={q.correctAnswer == null ? 'not found in answer key — enter manually' : ''}
                  className={`rounded border px-2 py-0.5 text-xs ${
                    q.correctAnswer == null ? 'border-amber-300 bg-amber-50' : 'border-neutral-300'
                  }`}
                />
              </div>
              <div className="mt-1.5 flex items-start gap-2">
                <span className="mt-1 shrink-0 text-xs text-neutral-400">Explanation:</span>
                <textarea
                  rows={2}
                  value={q.explanation || ''}
                  onChange={(e) => updateQuestion(qi, { ...q, explanation: e.target.value })}
                  placeholder="Why this is correct (shown to teachers only)"
                  className="w-full resize-y rounded border border-neutral-300 px-2 py-1 text-xs"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
