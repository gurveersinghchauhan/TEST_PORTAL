import { useState } from 'react';
import { authHeaders } from './apiAuth';
import {
  WRITING_TASK1_TYPE_OPTIONS,
  WRITING_TASK2_TYPE_OPTIONS,
  WRITING_GRAPH_SUBTYPE_OPTIONS,
  writingTypeLabel,
  writingSubTypeLabel,
} from './writingClassification';

/**
 * WritingTestWizard
 * ------------------
 * Step-by-step form for building (or editing) an IELTS Writing test:
 *   Step 1 — Task 1 (Visual / Report): prompt instructions, an optional
 *            chart/graph/diagram image upload with preview, and a target
 *            word count (default 150).
 *   Step 2 — Task 2 (Essay): essay prompt/topic and a target word count
 *            (default 250).
 *   Step 3 — Review & Save: summary + "Save Writing Test" (or
 *            "Save Changes" in edit mode), then an explicit "Publish Test"
 *            once the draft is saved, unless it was already published.
 *
 * Same two-mode shape as SpeakingTestWizard.jsx — controlled by whether
 * `initialTest` is passed (create vs. edit, POST vs. PATCH) — and the same
 * "reuse the existing parts/questionGroups schema" approach: each task
 * becomes one part, with the prompt text in `passageText` (the same field
 * Speaking's cue card and Reading's passage use), the uploaded image in
 * `imageUrl`, and the target word count in `wordCountTarget`.
 *
 * The uploaded image is read client-side into a data URL and saved as-is
 * on `imageUrl` — there's no dedicated file storage/CDN wired up on the
 * backend yet, so this keeps things working end-to-end without adding
 * upload infrastructure. Large images are capped client-side (see
 * MAX_IMAGE_BYTES) to avoid bloating the test document.
 *
 * Hybrid AI Import: a persistent "Import via JSON" button (fixed header,
 * reachable from any step) opens a modal where a teacher pastes AI-generated
 * JSON covering the TEXT content only — title, duration, Task 1 prompt/word
 * count, Task 2 prompt/word count. It's "hybrid" because the Task 1 image
 * is deliberately NOT part of the JSON contract (no AI assistant can hand
 * back a real chart/graph image inline) — that stays on the manual file
 * uploader below, and importing JSON never touches whatever image is
 * already attached.
 *
 * Writing classification: each task's question is classified at the
 * QUESTION level (backend/models/Test.js's questionSchema.writingTask /
 * writingQuestionType / writingQuestionSubType — see
 * backend/utils/writingClassification.js for the fixed, task-exclusive
 * type lists), never on the test document. Task 1 and Task 2 have
 * completely separate type dropdowns below (Task 1: Graphs/Mixed
 * Charts/Process/Maps; Task 2: Opinion/Discussion/etc.) — a Task 1 type can
 * never be picked for Task 2 or vice versa, both in the UI (separate
 * dropdowns per step) and on the backend (hard-rejected if it ever were).
 * A "Graphs" subtype dropdown (Line/Bar/Pie/Table) only appears for Task 1
 * + Graphs — Process and Maps never prompt for a subcategory. Leaving a
 * type dropdown on "Auto-detect" (the default) lets the backend analyze
 * the task prompt itself and classify it automatically, same pattern as
 * SpeakingTestWizard.jsx's category dropdown.
 */

const STEPS = ['Task 1 — Visual/Report', 'Task 2 — Essay', 'Review & Save'];
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB — keeps the saved document well under Mongo's 16MB doc cap

// Shown inside the Import modal so teachers know exactly what to paste
// into an AI assistant to get compatible JSON back. Note the image is
// explicitly excluded from the contract — it's called out so teachers
// don't waste a prompt cycle asking the AI to "attach" a chart.
const MASTER_AI_PROMPT = `You are generating IELTS Academic Writing test content as JSON for an online test platform. Output ONLY valid JSON — no markdown code fences, no commentary — matching exactly this structure:

{
  "title": "string, e.g. 'Cambridge 21 Academic Writing Test 4'",
  "durationMinutes": 60,
  "task1": {
    "prompt": "The chart below shows... Summarize the information by selecting and reporting the main features, and make comparisons where relevant.",
    "wordCountTarget": 150
  },
  "task2": {
    "prompt": "Some people believe that... Discuss both these views and give your own opinion.",
    "wordCountTarget": 250
  }
}

Rules:
- "title" must be a short, descriptive string.
- "task1.prompt" should describe a chart, graph, table, map, or process diagram in the standard IELTS Task 1 style, and should explicitly instruct the candidate to summarize/compare the information — but do NOT attempt to describe or embed an actual image; the teacher will attach the real chart/graph image separately.
- "task2.prompt" should be a standard IELTS Task 2 essay question (opinion, discussion, problem/solution, or advantages/disadvantages style).
- "wordCountTarget" fields are optional numbers — omit them to use the platform defaults (150 for Task 1, 250 for Task 2).
- Do NOT include a "type" or "category" field for either task — the platform automatically analyzes each prompt and assigns its Task 1 type (Graphs/Mixed Charts/Process/Maps, with a Line/Bar/Pie/Table subtype for Graphs) or Task 2 type (Opinion, Discussion, Advantages & Disadvantages, Problems & Solutions, Two-Part Question, Causes & Effects, or Positive/Negative Development) for you.
- Output raw JSON only.`;

function extractTaskPart(test, partNumber) {
  return (test?.parts || []).find((p) => p.partNumber === partNumber) || null;
}

// Edit mode only — pulls the classification off the part's single
// 'writing-task' question (see buildPayload below for how it's saved).
// Returns '' for both when there's nothing stored yet (new test, or a
// Writing test saved before this feature existed) so the dropdowns land
// back on "Auto-detect".
function extractWritingClassification(part) {
  const question = (part?.questionGroups || [])
    .flatMap((g) => g.questions || [])
    .find((q) => q.type === 'writing-task');
  return {
    type: question?.writingQuestionType || '',
    subType: question?.writingQuestionSubType || '',
  };
}

/**
 * Validates a parsed (already JSON.parse'd) import object against the
 * shape MASTER_AI_PROMPT asks the AI to produce. Returns every problem
 * found (not just the first) so a teacher can fix a bad paste in one pass.
 * Deliberately says nothing about images — those are out of scope for the
 * JSON contract and handled entirely by the manual uploader.
 */
function validateWritingImportJson(parsed) {
  const errors = [];

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['The pasted JSON must be an object, e.g. { "title": ..., "task1": {...}, "task2": {...} }.'] };
  }

  if (typeof parsed.title !== 'string' || !parsed.title.trim()) {
    errors.push('Missing or empty "title" string.');
  }

  if (parsed.durationMinutes != null && typeof parsed.durationMinutes !== 'number') {
    errors.push('"durationMinutes" must be a number if included.');
  }

  if (!parsed.task1 || typeof parsed.task1 !== 'object' || Array.isArray(parsed.task1)) {
    errors.push('Missing "task1" object.');
  } else {
    if (typeof parsed.task1.prompt !== 'string' || !parsed.task1.prompt.trim()) {
      errors.push('"task1.prompt" is missing or empty.');
    }
    if (parsed.task1.wordCountTarget != null && (typeof parsed.task1.wordCountTarget !== 'number' || parsed.task1.wordCountTarget <= 0)) {
      errors.push('"task1.wordCountTarget" must be a positive number if included.');
    }
  }

  if (!parsed.task2 || typeof parsed.task2 !== 'object' || Array.isArray(parsed.task2)) {
    errors.push('Missing "task2" object.');
  } else {
    if (typeof parsed.task2.prompt !== 'string' || !parsed.task2.prompt.trim()) {
      errors.push('"task2.prompt" is missing or empty.');
    }
    if (parsed.task2.wordCountTarget != null && (typeof parsed.task2.wordCountTarget !== 'number' || parsed.task2.wordCountTarget <= 0)) {
      errors.push('"task2.wordCountTarget" must be a positive number if included.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Converts a validated import object into the wizard's text-field state.
 * Returns only the text fields — the caller is responsible for leaving
 * any already-uploaded Task 1 image untouched, since images are never
 * part of the JSON contract.
 */
function mapImportJsonToWritingFields(parsed) {
  return {
    title: parsed.title.trim(),
    durationMinutes: typeof parsed.durationMinutes === 'number' ? parsed.durationMinutes : undefined,
    task1Prompt: parsed.task1.prompt.trim(),
    task1WordCount: typeof parsed.task1.wordCountTarget === 'number' ? parsed.task1.wordCountTarget : 150,
    task2Prompt: parsed.task2.prompt.trim(),
    task2WordCount: typeof parsed.task2.wordCountTarget === 'number' ? parsed.task2.wordCountTarget : 250,
  };
}

/* -------------------------------------------------------------------------
 * Import via JSON — modal with the paste box, validation errors, and the
 * Master AI Prompt teachers copy into ChatGPT/Claude to get compatible
 * JSON back. Scrolls internally (own flex-1/overflow-y-auto region) so a
 * long error list or the prompt text never gets clipped by the viewport.
 * ---------------------------------------------------------------------- */
function ImportJsonModal({ onClose, onImport }) {
  const [jsonText, setJsonText] = useState('');
  const [errors, setErrors] = useState([]);
  const [copied, setCopied] = useState(false);

  function handleParse() {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      setErrors([`Invalid JSON: ${err.message}`]);
      return;
    }

    const result = validateWritingImportJson(parsed);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }

    setErrors([]);
    onImport(parsed);
  }

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(MASTER_AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the prompt is
      // still fully visible and selectable below, so this is a soft no-op.
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-8">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-6 py-4">
          <h2 className="text-base font-bold text-neutral-900">Import via JSON</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="mb-3 text-sm text-neutral-600">
            Paste JSON generated by an AI assistant (see the Master AI Prompt below) to auto-populate this test's
            title, duration, Task 1 prompt, and Task 2 prompt. The Task 1 chart/graph image is not part of this
            import — attach it separately using the file uploader on Step 1. Each task's type is analyzed and
            assigned automatically after import (leave the type dropdowns on Auto-detect, or override them yourself).
          </p>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={10}
            placeholder='{ "title": "...", "durationMinutes": 60, "task1": {...}, "task2": {...} }'
            className="mb-3 w-full rounded border border-neutral-300 px-3 py-2 font-mono text-xs leading-relaxed"
          />

          {errors.length > 0 && (
            <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
              <p className="mb-1 font-semibold">This JSON doesn't match the expected structure:</p>
              <ul className="list-disc space-y-0.5 pl-4">
                {errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleParse}
            disabled={!jsonText.trim()}
            className="mb-6 rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          >
            Parse &amp; Preview
          </button>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-800">Master AI Prompt</h3>
              <button
                onClick={handleCopyPrompt}
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
              >
                {copied ? 'Copied!' : 'Copy prompt'}
              </button>
            </div>
            <p className="mb-2 text-xs text-neutral-500">
              Paste this into ChatGPT, Claude, or similar to get JSON back in the exact format this importer
              expects. It only covers Task 1/Task 2 text — attach the chart or graph image yourself afterward.
            </p>
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-neutral-200 bg-white p-3 text-[11px] leading-relaxed text-neutral-700">
              {MASTER_AI_PROMPT}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WritingTestWizard({ apiBase, onBack, initialTest, onSaved, backLabel = 'Back to Test Builder' }) {
  const isEditMode = Boolean(initialTest?._id);
  const [step, setStep] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);

  const [testTitle, setTestTitle] = useState(() => initialTest?.title || '');
  const [durationMinutes, setDurationMinutes] = useState(() => initialTest?.durationMinutes || 60);

  const task1Part = extractTaskPart(initialTest, 1);
  const task2Part = extractTaskPart(initialTest, 2);

  const [task1Prompt, setTask1Prompt] = useState(() => task1Part?.passageText || '');
  const [task1Image, setTask1Image] = useState(() => task1Part?.imageUrl || '');
  const [task1ImageError, setTask1ImageError] = useState(null);
  const [task1WordCount, setTask1WordCount] = useState(() => task1Part?.wordCountTarget || 150);
  // '' = "Auto-detect from the prompt" (the backend classifies it on save);
  // any other value is one of the 4 fixed Task 1 types, picked explicitly.
  const [task1Type, setTask1Type] = useState(() => extractWritingClassification(task1Part).type);
  // Only meaningful when task1Type === 'GRAPHS' — '' there also means
  // Auto-detect. Always ignored/cleared for Process/Maps/Mixed Charts.
  const [task1SubType, setTask1SubType] = useState(() => extractWritingClassification(task1Part).subType);

  const [task2Prompt, setTask2Prompt] = useState(() => task2Part?.passageText || '');
  const [task2WordCount, setTask2WordCount] = useState(() => task2Part?.wordCountTarget || 250);
  // '' = Auto-detect; any other value is one of the 7 fixed Task 2 types.
  const [task2Type, setTask2Type] = useState(() => extractWritingClassification(task2Part).type);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedTest, setSavedTest] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(() => Boolean(initialTest?.isPublished));

  function handleImageSelected(file) {
    setTask1ImageError(null);
    if (!file) return;

    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setTask1ImageError('Please upload a PNG or JPG image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setTask1ImageError('Image is too large — please keep it under 4MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setTask1Image(reader.result);
    reader.onerror = () => setTask1ImageError('Could not read that image — please try another file.');
    reader.readAsDataURL(file);
  }

  // Imports the TEXT fields only — title, duration, both prompts, both word
  // counts. `task1Image` is intentionally left alone: importing JSON never
  // clears or replaces an image that's already been uploaded (or, in edit
  // mode, one already saved on the test).
  function handleImportJson(parsedData) {
    const mapped = mapImportJsonToWritingFields(parsedData);
    setTestTitle(mapped.title);
    if (mapped.durationMinutes != null) setDurationMinutes(mapped.durationMinutes);
    setTask1Prompt(mapped.task1Prompt);
    setTask1WordCount(mapped.task1WordCount);
    setTask2Prompt(mapped.task2Prompt);
    setTask2WordCount(mapped.task2WordCount);
    setShowImportModal(false);
    setStep(1); // land teachers back on Task 1 so they can see the imported prompt and attach an image
  }

  const step1Valid = testTitle.trim().length > 0 && task1Prompt.trim().length > 0 && Number(task1WordCount) > 0;
  const step2Valid = task2Prompt.trim().length > 0 && Number(task2WordCount) > 0;

  function goNext() {
    setStep((s) => Math.min(3, s + 1));
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  // Wraps a task's classification into the single 'writing-task' question
  // its part carries — same "reuse the existing questionSchema" approach
  // SpeakingTestWizard.jsx uses for Part 1/3's 'speaking-prompt' questions.
  // The question's `prompt` is a short label, not the essay prompt itself —
  // the real prompt text lives on the part's own passageText above (and is
  // what students/preview actually read); this question exists purely to
  // carry the classification fields at the QUESTION level.
  function buildWritingTaskQuestionGroup(taskNum, type, subType) {
    return [
      {
        groupInstructions: `Task ${taskNum} classification`,
        questionType: 'writing-task',
        startNumber: 1,
        endNumber: 1,
        questions: [
          {
            questionNumber: 1,
            type: 'writing-task',
            prompt: `Task ${taskNum}`,
            options: [],
            correctAnswer: '',
            // '' (Auto-detect) is sent as-is — the backend treats a blank
            // value as "please classify this task's prompt yourself" (see
            // testUpload.js's resolveWritingPartClassification).
            writingTask: taskNum,
            writingQuestionType: type || '',
            writingQuestionSubType: type === 'GRAPHS' ? subType || '' : '',
          },
        ],
      },
    ];
  }

  function buildPayload() {
    return {
      title: testTitle.trim(),
      module: 'writing',
      durationMinutes: Number(durationMinutes) || 60,
      totalQuestions: 2, // Task 1 + Task 2
      parts: [
        {
          partNumber: 1,
          title: 'Task 1 — Visual / Report',
          instructions: `Write a report of at least ${Number(task1WordCount) || 150} words based on the information below.`,
          passageText: task1Prompt.trim(),
          imageUrl: task1Image || '',
          wordCountTarget: Number(task1WordCount) || 150,
          questionGroups: buildWritingTaskQuestionGroup(1, task1Type, task1SubType),
        },
        {
          partNumber: 2,
          title: 'Task 2 — Essay',
          instructions: `Write an essay of at least ${Number(task2WordCount) || 250} words in response to the prompt below.`,
          passageText: task2Prompt.trim(),
          imageUrl: '',
          wordCountTarget: Number(task2WordCount) || 250,
          questionGroups: buildWritingTaskQuestionGroup(2, task2Type, null),
        },
      ],
    };
  }

  async function handleSave() {
    setIsSaving(true);
    setSaveError(null);
    try {
      const payload = buildPayload();
      const url = isEditMode ? `${apiBase}/tests/${initialTest._id}` : `${apiBase}/tests`;
      const method = isEditMode ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save test.');

      setSavedTest(data.test);
      setIsPublished(Boolean(data.test.isPublished));
      // Reflect whatever the backend actually resolved/stored — if either
      // dropdown was left on Auto-detect, this fills it in with the type
      // (and subtype) the platform's analysis just assigned.
      const savedTask1 = extractWritingClassification((data.test.parts || []).find((p) => p.partNumber === 1));
      const savedTask2 = extractWritingClassification((data.test.parts || []).find((p) => p.partNumber === 2));
      setTask1Type(savedTask1.type);
      setTask1SubType(savedTask1.subType);
      setTask2Type(savedTask2.type);
      if (onSaved) onSaved(data.test);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish() {
    setIsPublishing(true);
    try {
      const res = await fetch(`${apiBase}/tests/${savedTest._id}/publish`, { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to publish test.');
      setSavedTest(data.test);
      setIsPublished(true);
      if (onSaved) onSaved(data.test);
    } catch (err) {
      alert(err.message);
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Fixed header — "Import via JSON" lives here (not in the scrollable
          content) so it's reachable from any step. */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-6 py-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition hover:text-neutral-800"
        >
          ← {backLabel}
        </button>
        <button
          onClick={() => setShowImportModal(true)}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
            <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          </svg>
          Import via JSON
        </button>
      </div>

      {/* Scrollable content — footer nav below is a real flex-shrink-0 bar,
          not `sticky`, so "Next"/"Save"/"Publish" stay visible even when a
          step's content (e.g. a tall image preview) exceeds the viewport. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-6 pb-10">
          <h1 className="mb-1 text-xl font-semibold">{isEditMode ? 'Edit Writing Test' : 'Create Writing Test'}</h1>
          <p className="mb-6 text-sm text-neutral-500">
            {isEditMode
              ? 'Update Task 1 and Task 2 content below, then save your changes.'
              : 'Build a Task 1 / Task 2 writing test step by step, or paste AI-generated JSON to auto-populate the text (attach the chart/graph image yourself).'}
          </p>

          {/* Progress steps */}
          <div className="mb-8 flex items-center gap-2">
            {STEPS.map((label, i) => {
              const n = i + 1;
              const isActive = step === n;
              const isDone = step > n;
              return (
                <div key={label} className="flex flex-1 items-center gap-2">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isActive
                        ? 'bg-rose-600 text-white'
                        : isDone
                        ? 'bg-rose-100 text-rose-600'
                        : 'bg-neutral-100 text-neutral-400'
                    }`}
                  >
                    {isDone ? '✓' : n}
                  </div>
                  <span className={`hidden text-xs font-medium sm:inline ${isActive ? 'text-neutral-800' : 'text-neutral-400'}`}>
                    {label}
                  </span>
                  {n < STEPS.length && <div className={`h-px flex-1 ${isDone ? 'bg-rose-200' : 'bg-neutral-200'}`} />}
                </div>
              );
            })}
          </div>

          {/* Step 1 — Task 1 */}
          {step === 1 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Test title</label>
              <input
                type="text"
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
                placeholder="e.g. Cambridge 21 Academic Writing Test 4"
                className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              <label className="mb-1 block text-xs font-medium text-neutral-500">Duration (min)</label>
              <input
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="mb-5 w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              <h2 className="mb-1 text-sm font-semibold text-neutral-800">Task 1 — Visual / Report</h2>

              <label className="mb-1 block text-xs font-medium text-neutral-500">Task 1 type</label>
              <select
                value={task1Type}
                onChange={(e) => {
                  const value = e.target.value;
                  setTask1Type(value);
                  // Dependent dropdown: Process/Maps/Mixed Charts (and
                  // Auto-detect) never prompt for a subcategory — only
                  // Graphs does, so clear any leftover subtype immediately.
                  if (value !== 'GRAPHS') setTask1SubType('');
                }}
                className="mb-3 w-full max-w-xs rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Auto-detect from prompt (recommended)</option>
                {WRITING_TASK1_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {task1Type === 'GRAPHS' && (
                <>
                  <label className="mb-1 block text-xs font-medium text-neutral-500">Graph subtype</label>
                  <select
                    value={task1SubType}
                    onChange={(e) => setTask1SubType(e.target.value)}
                    className="mb-3 w-full max-w-xs rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Auto-detect from prompt (recommended)</option>
                    {WRITING_GRAPH_SUBTYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <p className="mb-4 text-xs text-neutral-500">
                One type is stored for this task's question. Process and Maps never have a subtype.
              </p>

              <label className="mb-1 block text-xs font-medium text-neutral-500">Prompt / instructions</label>
              <textarea
                value={task1Prompt}
                onChange={(e) => setTask1Prompt(e.target.value)}
                rows={6}
                placeholder="The chart below shows… Summarize the information by selecting and reporting the main features…"
                className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm leading-relaxed"
              />

              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Chart / graph / diagram (PNG or JPG, optional)
              </label>
              <input
                type="file"
                accept="image/png, image/jpeg"
                onChange={(e) => handleImageSelected(e.target.files?.[0])}
                className="mb-2 block w-full text-sm text-neutral-600 file:mr-3 file:rounded file:border file:border-neutral-300 file:bg-neutral-50 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-neutral-100"
              />
              {task1ImageError && <p className="mb-2 text-xs text-rose-600">{task1ImageError}</p>}

              {task1Image && (
                <div className="mb-4">
                  <div className="relative inline-block">
                    <img
                      src={task1Image}
                      alt="Task 1 visual preview"
                      className="max-h-64 w-auto rounded-lg border border-neutral-200 object-contain"
                    />
                    <button
                      onClick={() => setTask1Image('')}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-xs font-semibold text-white shadow hover:bg-neutral-900"
                      title="Remove image"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}

              <label className="mb-1 block text-xs font-medium text-neutral-500">Target word count</label>
              <input
                type="number"
                min={1}
                value={task1WordCount}
                onChange={(e) => setTask1WordCount(e.target.value)}
                className="w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              <p className="mt-4 text-xs text-neutral-500">
                Fill in Task 1 and Task 2 manually, or use{' '}
                <button onClick={() => setShowImportModal(true)} className="font-medium text-rose-600 underline underline-offset-2">
                  Import via JSON
                </button>{' '}
                (top right) to auto-populate both prompts — you'll still attach the chart/graph image here yourself.
              </p>
            </div>
          )}

          {/* Step 2 — Task 2 */}
          {step === 2 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-1 text-sm font-semibold text-neutral-800">Task 2 — Essay</h2>

              <label className="mb-1 block text-xs font-medium text-neutral-500">Task 2 type</label>
              <select
                value={task2Type}
                onChange={(e) => setTask2Type(e.target.value)}
                className="mb-4 w-full max-w-xs rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Auto-detect from prompt (recommended)</option>
                {WRITING_TASK2_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <label className="mb-1 block text-xs font-medium text-neutral-500">Essay prompt / topic</label>
              <textarea
                value={task2Prompt}
                onChange={(e) => setTask2Prompt(e.target.value)}
                rows={8}
                placeholder="Some people believe that… Discuss both these views and give your own opinion…"
                className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm leading-relaxed"
              />

              <label className="mb-1 block text-xs font-medium text-neutral-500">Target word count</label>
              <input
                type="number"
                min={1}
                value={task2WordCount}
                onChange={(e) => setTask2WordCount(e.target.value)}
                className="w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          {/* Step 3 — Review & Save */}
          {step === 3 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              {!savedTest ? (
                <>
                  <h2 className="mb-4 text-sm font-semibold text-neutral-800">Review before saving</h2>

                  <div className="mb-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Title</p>
                    <p className="text-sm text-neutral-800">{testTitle || '—'}</p>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      Task 1 — Visual / Report (target {task1WordCount || 150} words)
                    </p>
                    <p className="text-xs text-neutral-500">
                      Type: {task1Type ? writingTypeLabel(1, task1Type) : 'Auto-detect from prompt (assigned on save)'}
                      {task1Type === 'GRAPHS' &&
                        ` — ${task1SubType ? writingSubTypeLabel(task1SubType) : 'subtype auto-detected on save'}`}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-3 text-sm text-neutral-700">
                      {task1Prompt}
                    </p>
                    {task1Image && (
                      <img
                        src={task1Image}
                        alt="Task 1 visual"
                        className="mt-2 max-h-48 w-auto rounded-lg border border-neutral-200 object-contain"
                      />
                    )}
                  </div>

                  <div className="mb-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      Task 2 — Essay (target {task2WordCount || 250} words)
                    </p>
                    <p className="text-xs text-neutral-500">
                      Type: {task2Type ? writingTypeLabel(2, task2Type) : 'Auto-detect from prompt (assigned on save)'}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap rounded bg-neutral-50 p-3 text-sm text-neutral-700">
                      {task2Prompt}
                    </p>
                  </div>

                  {saveError && <p className="mt-3 text-sm text-rose-600">{saveError}</p>}
                </>
              ) : (
                <>
                  <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                    ✅ "{savedTest.title}" {isEditMode ? 'updated' : 'saved as a draft'} — Task 1:{' '}
                    {task1Type ? writingTypeLabel(1, task1Type) : 'Uncategorized'}
                    {task1Type === 'GRAPHS' && task1SubType ? ` (${writingSubTypeLabel(task1SubType)})` : ''}, Task 2:{' '}
                    {task2Type ? writingTypeLabel(2, task2Type) : 'Uncategorized'}.
                    {isPublished && ' It is now published and visible to students.'}
                  </div>
                  {!isPublished && (
                    <p className="text-sm text-neutral-500">
                      It's saved but not visible to students yet — hit "Publish Test" when you're ready to go live.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer nav — fixed height bar, not sticky, so it always stays
          visible regardless of scroll position or ancestor overflow. */}
      <div className="shrink-0 border-t border-neutral-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-3xl justify-between gap-3">
          <button
            onClick={goBack}
            disabled={step === 1}
            className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-40"
          >
            Previous
          </button>

          {step < 3 && (
            <button
              onClick={goNext}
              disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Next
            </button>
          )}

          {step === 3 && !savedTest && (
            <button
              onClick={handleSave}
              disabled={isSaving || !step1Valid || !step2Valid}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Save Writing Test'}
            </button>
          )}

          {step === 3 && savedTest && !isPublished && (
            <button
              onClick={handlePublish}
              disabled={isPublishing}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {isPublishing ? 'Publishing…' : 'Publish Test'}
            </button>
          )}

          {step === 3 && isPublished && (
            <button
              onClick={onBack}
              className="rounded bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-900"
            >
              {backLabel}
            </button>
          )}
        </div>
      </div>

      {showImportModal && <ImportJsonModal onClose={() => setShowImportModal(false)} onImport={handleImportJson} />}
    </div>
  );
}
