import QuestionGroupEditor from './QuestionGroupEditor';

/**
 * PartEditor
 * ----------
 * Renders one parsed "Reading Passage N" as an editable card: title,
 * body text, and every question group beneath it. All edits flow back
 * up through onChange(updatedPart) so TestBuilder holds the single
 * source of truth for the draft.
 */
export default function PartEditor({ part, onChange, apiBase }) {
  function updateField(field, value) {
    onChange({ ...part, [field]: value });
  }

  function updateGroup(groupIndex, updatedGroup) {
    const questionGroups = part.questionGroups.map((g, i) => (i === groupIndex ? updatedGroup : g));
    onChange({ ...part, questionGroups });
  }

  return (
    <div className="mb-6 rounded-lg border border-neutral-200">
      <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2">
        <span className="text-sm font-semibold">Passage {part.partNumber}</span>
      </div>

      <div className="p-4">
        <label className="mb-1 block text-xs font-medium text-neutral-500">Title</label>
        <input
          type="text"
          value={part.title}
          onChange={(e) => updateField('title', e.target.value)}
          className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          placeholder="e.g. The History of Marie Curie"
        />

        <label className="mb-1 block text-xs font-medium text-neutral-500">
          Passage text — check paragraph breaks carried over correctly
        </label>
        <textarea
          value={part.passageText}
          onChange={(e) => updateField('passageText', e.target.value)}
          rows={10}
          className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-sm leading-relaxed"
        />

        {part.questionGroups.map((group, gi) => (
          <QuestionGroupEditor key={gi} group={group} onChange={(updated) => updateGroup(gi, updated)} apiBase={apiBase} />
        ))}
      </div>
    </div>
  );
}
