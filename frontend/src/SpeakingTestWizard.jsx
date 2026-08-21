import { useState } from 'react';
import { authHeaders } from './apiAuth';
import { SPEAKING_CATEGORY_OPTIONS } from './speakingCategories';

// Flat list of the 16 allowed category strings — derived from
// SPEAKING_CATEGORY_OPTIONS (value === label for this list, see
// speakingCategories.js) so the AI prompt, the JSON import validator, and
// the dropdown all read from exactly one source of truth.
const SPEAKING_CATEGORY_VALUES = SPEAKING_CATEGORY_OPTIONS.map((o) => o.value);

/**
 * SpeakingTestWizard
 * ------------------
 * Step-by-step form for building (or editing) an IELTS Speaking test:
 *   Step 1 — Part 1: how many questions, then that many text fields.
 *   Step 2 — Part 2: the Cue Card TOPIC line, its "You should say:" bullet
 *            points (added/removed individually, not typed as one blob),
 *            and the standard IELTS Part 2 instruction text (always shown,
 *            not editable — it's the same wording for every cue card).
 *   Step 3 — Part 3: grouped discussion topics — a heading (e.g.
 *            "Competitions") plus its own set of questions, and teachers
 *            can add as many topic groups as the discussion needs.
 *   Step 4 — Review & Save: summary + "Save Speaking Test" (or
 *            "Save Changes" in edit mode), then an explicit "Publish Test"
 *            once the draft is saved, unless it was already published.
 *
 * Two modes, controlled by whether `initialTest` is passed:
 *   - Create (initialTest absent): POST /api/tests, starts from blank
 *     fields.
 *   - Edit (initialTest present, from "Edit Test" on the Question Preview
 *     page): fields are pre-filled from the existing test's parts, and
 *     saving PATCHes /api/tests/:id instead of creating a new test.
 *
 * The payload is shaped to match the existing Test schema's parts /
 * questionGroups / questions structure (backend/models/Test.js) rather than
 * inventing a Speaking-only shape — that's what lets the teacher/institute
 * "Preview Test" page (PracticeTests.jsx) render it with no extra
 * work. Part 2's cue card topic rides in `passageText`, its bullet points
 * ride in the dedicated `cueCardBullets` array (added to partSchema
 * alongside imageUrl/wordCountTarget for the other wizards), and Part 3's
 * topic headings ride in each questionGroup's `groupInstructions`, one
 * group per topic.
 *
 * AI JSON Import: a persistent "Import via JSON" button (fixed header,
 * reachable from any step) opens a modal where a teacher pastes AI-
 * generated JSON covering Part 1's questions, Part 2's topic + bullet
 * points, and Part 3's headed discussion groups. The standard Part 2
 * instruction text is never part of the JSON contract — it's fixed and
 * always applied automatically, same as manual entry.
 *
 * Speaking category: every Speaking test carries exactly ONE major
 * category at the test-document level (backend/models/Test.js's
 * testSchema.speakingCategory — see backend/utils/speakingCategories.js for
 * the fixed 16-value list), driven by Part 2's cue card theme. There is no
 * automatic classification anymore — the category dropdown below is a
 * REQUIRED field the teacher must pick explicitly (gates Next/Save the
 * same way an empty title does), and "Import via JSON" must supply its own
 * "category" field for the same reason (see MASTER_AI_PROMPT and
 * validateSpeakingImportJson below, which rejects a paste that's missing
 * one or picks something outside the fixed list).
 */

const STEPS = ['Part 1', 'Part 2 — Cue Card', 'Part 3', 'Review & Save'];
const MAX_QUESTIONS_PER_PART = 12;
const MAX_PART3_TOPICS = 6;
const MAX_CUE_CARD_BULLETS = 8;

// The standard Part 2 instruction every cue card carries — always shown
// alongside the cue card in both the builder and the preview (it rides
// into the saved test as Part 2's `instructions`, so the preview needs no
// special-casing to display it).
export const CUE_CARD_STANDARD_INSTRUCTIONS =
  'You will have to talk about the topic for 1 to 2 minutes. You have 1 minute to think about what you are going to say. You can make some notes to help you if you wish.';

// Shown inside the Import modal so teachers know exactly what to paste
// into an AI assistant to get compatible JSON back. Deliberately omits the
// standard instructions and question numbering — both are handled
// automatically by the platform, not by the AI.
const MASTER_AI_PROMPT = `You are generating IELTS Speaking test content as JSON for an online test platform. Output ONLY valid JSON — no markdown code fences, no commentary — matching exactly this structure:

{
  "title": "string, e.g. 'Speaking Practice Set A — Parts 1, 2 & 3'",
  "durationMinutes": 15,
  "category": "EXACTLY one of: ${SPEAKING_CATEGORY_VALUES.join(', ')}",
  "part1": {
    "questions": [
      "Do you work or are you a student?",
      "What do you like most about your hometown?"
    ]
  },
  "part2": {
    "topic": "Describe a book you recently read.",
    "bulletPoints": [
      "what the book was about",
      "when you read it",
      "why you read it",
      "and explain whether you would recommend it"
    ]
  },
  "part3": [
    {
      "heading": "Competitions",
      "questions": ["Do you think competitions are good for children?", "..."]
    },
    {
      "heading": "Being competitive in sports",
      "questions": ["Why do you think some people enjoy competitive sports?", "..."]
    }
  ]
}

Rules:
- Do NOT include the standard Part 2 rubric ("You will have to talk about the topic for 1 to 2 minutes...") — the platform adds it automatically.
- Do NOT include question numbers — the platform numbers everything automatically.
- "part1.questions" should be 3–5 short conversational interview questions on familiar topics.
- "part2.bulletPoints" should be 3–4 short prompts in the standard "You should say:" style, and the last one is usually phrased as "and explain..." or "and say...".
- "part3" must be an array of topic groups, each with a short "heading" (2–4 words, e.g. "Competitions") and 3–4 related discussion questions that go deeper into the Part 2 topic.
- "category" is REQUIRED. You MUST choose EXACTLY ONE value from this fixed list, copied verbatim (exact spelling, capitalization, spacing, and "&" — no synonyms, no new categories, no combining two): ${SPEAKING_CATEGORY_VALUES.join(', ')}.
- Base "category" on Part 2's cue-card theme (the topic + bulletPoints) — pick whichever single value in the list best fits that theme.
- Output raw JSON only.`;

function resizeQuestionArray(arr, size) {
  const n = Math.max(0, Math.min(MAX_QUESTIONS_PER_PART, Number(size) || 0));
  if (n === arr.length) return arr;
  if (n < arr.length) return arr.slice(0, n);
  return [...arr, ...Array(n - arr.length).fill('')];
}

function extractPart1Questions(test) {
  const part = (test?.parts || []).find((p) => p.partNumber === 1);
  if (!part) return [];
  return (part.questionGroups || []).flatMap((g) => (g.questions || []).map((q) => q.prompt));
}

// Edit mode only — pre-fills the category dropdown with whatever's already
// stored (including nothing/null, which lands the dropdown back on
// "Auto-detect"). New tests always start on Auto-detect.
function extractSpeakingCategory(test) {
  return test?.speakingCategory || '';
}

function extractPart2Topic(test) {
  const part = (test?.parts || []).find((p) => p.partNumber === 2);
  return part?.passageText || '';
}

// Older tests saved before cueCardBullets existed have the whole cue card
// (topic + "You should say:" + points) jammed into passageText as one
// blob, with no structured bullets at all — in that case there's nothing
// safe to auto-split, so this just returns a single empty bullet for the
// teacher to fill in (extractPart2Topic above still surfaces the original
// blob as-is in the Topic field so no content is silently lost).
function extractPart2Bullets(test) {
  const part = (test?.parts || []).find((p) => p.partNumber === 2);
  const bullets = Array.isArray(part?.cueCardBullets) ? part.cueCardBullets.filter((b) => typeof b === 'string') : [];
  return bullets.length ? bullets : [''];
}

function extractPart3Topics(test) {
  const part = (test?.parts || []).find((p) => p.partNumber === 3);
  const groups = part?.questionGroups || [];
  if (!groups.length) return [{ heading: '', questions: [''] }];
  return groups.map((g) => {
    const questions = (g.questions || []).map((q) => q.prompt);
    return { heading: g.groupInstructions || '', questions: questions.length ? questions : [''] };
  });
}

/**
 * Validates a parsed (already JSON.parse'd) import object against the
 * shape MASTER_AI_PROMPT asks the AI to produce. Returns every problem
 * found (not just the first) so a teacher can fix a bad paste in one pass.
 */
function validateSpeakingImportJson(parsed) {
  const errors = [];

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['The pasted JSON must be an object, e.g. { "title": ..., "part1": {...}, "part2": {...}, "part3": [...] }.'] };
  }

  if (typeof parsed.title !== 'string' || !parsed.title.trim()) {
    errors.push('Missing or empty "title" string.');
  }
  if (parsed.durationMinutes != null && typeof parsed.durationMinutes !== 'number') {
    errors.push('"durationMinutes" must be a number if included.');
  }
  if (typeof parsed.category !== 'string' || !parsed.category.trim()) {
    errors.push('Missing or empty "category" string.');
  } else if (!SPEAKING_CATEGORY_VALUES.includes(parsed.category.trim())) {
    errors.push(`"category" must be exactly one of: ${SPEAKING_CATEGORY_VALUES.join(', ')}.`);
  }

  if (!parsed.part1 || typeof parsed.part1 !== 'object' || Array.isArray(parsed.part1)) {
    errors.push('Missing "part1" object.');
  } else if (!Array.isArray(parsed.part1.questions) || parsed.part1.questions.length === 0) {
    errors.push('"part1.questions" must be a non-empty array of strings.');
  } else {
    parsed.part1.questions.forEach((q, i) => {
      if (typeof q !== 'string' || !q.trim()) errors.push(`"part1.questions[${i}]" is missing or empty.`);
    });
  }

  if (!parsed.part2 || typeof parsed.part2 !== 'object' || Array.isArray(parsed.part2)) {
    errors.push('Missing "part2" object.');
  } else {
    if (typeof parsed.part2.topic !== 'string' || !parsed.part2.topic.trim()) {
      errors.push('"part2.topic" is missing or empty.');
    }
    if (!Array.isArray(parsed.part2.bulletPoints) || parsed.part2.bulletPoints.length === 0) {
      errors.push('"part2.bulletPoints" must be a non-empty array of strings.');
    } else {
      parsed.part2.bulletPoints.forEach((b, i) => {
        if (typeof b !== 'string' || !b.trim()) errors.push(`"part2.bulletPoints[${i}]" is missing or empty.`);
      });
    }
  }

  if (!Array.isArray(parsed.part3) || parsed.part3.length === 0) {
    errors.push('"part3" must be a non-empty array of topic groups.');
  } else {
    parsed.part3.forEach((group, gi) => {
      const gLabel = `"part3[${gi}]"`;
      if (!group || typeof group !== 'object') {
        errors.push(`${gLabel} must be an object.`);
        return;
      }
      if (typeof group.heading !== 'string' || !group.heading.trim()) {
        errors.push(`${gLabel}.heading is missing or empty.`);
      }
      if (!Array.isArray(group.questions) || group.questions.length === 0) {
        errors.push(`${gLabel}.questions must be a non-empty array of strings.`);
      } else {
        group.questions.forEach((q, qi) => {
          if (typeof q !== 'string' || !q.trim()) errors.push(`${gLabel}.questions[${qi}] is missing or empty.`);
        });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/** Converts a validated import object into the wizard's field state. */
function mapImportJsonToSpeakingFields(parsed) {
  return {
    title: parsed.title.trim(),
    durationMinutes: typeof parsed.durationMinutes === 'number' ? parsed.durationMinutes : undefined,
    category: parsed.category.trim(),
    part1Questions: parsed.part1.questions.map((q) => q.trim()),
    part2Topic: parsed.part2.topic.trim(),
    part2Bullets: parsed.part2.bulletPoints.map((b) => b.trim()),
    part3Topics: parsed.part3.map((g) => ({
      heading: g.heading.trim(),
      questions: g.questions.map((q) => q.trim()),
    })),
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

    const result = validateSpeakingImportJson(parsed);
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
            title, Part 1 questions, Part 2 cue card, and Part 3 discussion topics. The standard Part 2 rubric is
            always applied automatically and isn't part of the import.
          </p>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={10}
            placeholder='{ "title": "...", "part1": {...}, "part2": {...}, "part3": [...] }'
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
              Paste this into ChatGPT, Claude, or similar to get JSON back in the exact format this importer expects.
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

export default function SpeakingTestWizard({ apiBase, onBack, initialTest, onSaved, backLabel = 'Back to Test Builder' }) {
  const isEditMode = Boolean(initialTest?._id);
  const [step, setStep] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);

  const [testTitle, setTestTitle] = useState(() => initialTest?.title || '');
  const [durationMinutes, setDurationMinutes] = useState(() => initialTest?.durationMinutes || 15);

  const [part1Questions, setPart1Questions] = useState(() => extractPart1Questions(initialTest));
  const [part1Count, setPart1Count] = useState(() => {
    const n = extractPart1Questions(initialTest).length;
    return n ? String(n) : '';
  });

  const [part2Topic, setPart2Topic] = useState(() => extractPart2Topic(initialTest));
  const [part2Bullets, setPart2Bullets] = useState(() => extractPart2Bullets(initialTest));

  // '' = not yet chosen (blocks Next/Save — see step1Valid below); any
  // other value must be one of the 16 fixed categories the teacher (or an
  // "Import via JSON" payload's own "category" field) picked explicitly —
  // there's no automatic classification to fall back on anymore.
  const [speakingCategory, setSpeakingCategory] = useState(() => extractSpeakingCategory(initialTest));

  const [part3Topics, setPart3Topics] = useState(() => extractPart3Topics(initialTest));

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedTest, setSavedTest] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(() => Boolean(initialTest?.isPublished));

  function handlePart1CountChange(value) {
    setPart1Count(value);
    setPart1Questions((prev) => resizeQuestionArray(prev, value));
  }

  function updatePart1Question(i, value) {
    setPart1Questions((prev) => prev.map((q, idx) => (idx === i ? value : q)));
  }

  // --- Part 2 cue card bullet helpers ---
  function addBullet() {
    setPart2Bullets((prev) => (prev.length >= MAX_CUE_CARD_BULLETS ? prev : [...prev, '']));
  }
  function removeBullet(bi) {
    setPart2Bullets((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== bi)));
  }
  function updateBullet(bi, value) {
    setPart2Bullets((prev) => prev.map((b, i) => (i === bi ? value : b)));
  }

  // --- Part 3 topic-group helpers ---
  function addTopic() {
    setPart3Topics((prev) => (prev.length >= MAX_PART3_TOPICS ? prev : [...prev, { heading: '', questions: [''] }]));
  }
  function removeTopic(ti) {
    setPart3Topics((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== ti)));
  }
  function updateTopicHeading(ti, value) {
    setPart3Topics((prev) => prev.map((t, i) => (i === ti ? { ...t, heading: value } : t)));
  }
  function addQuestionToTopic(ti) {
    setPart3Topics((prev) =>
      prev.map((t, i) => (i === ti ? { ...t, questions: [...t.questions, ''] } : t))
    );
  }
  function removeQuestionFromTopic(ti, qi) {
    setPart3Topics((prev) =>
      prev.map((t, i) =>
        i === ti ? { ...t, questions: t.questions.length <= 1 ? t.questions : t.questions.filter((_, j) => j !== qi) } : t
      )
    );
  }
  function updateTopicQuestion(ti, qi, value) {
    setPart3Topics((prev) =>
      prev.map((t, i) => (i === ti ? { ...t, questions: t.questions.map((q, j) => (j === qi ? value : q)) } : t))
    );
  }

  // Imports title/duration/Part 1/Part 2/Part 3 in one shot. The standard
  // Part 2 rubric is never touched — it's fixed regardless of import.
  function handleImportJson(parsedData) {
    const mapped = mapImportJsonToSpeakingFields(parsedData);
    setTestTitle(mapped.title);
    if (mapped.durationMinutes != null) setDurationMinutes(mapped.durationMinutes);
    setSpeakingCategory(mapped.category);
    setPart1Questions(mapped.part1Questions);
    setPart1Count(String(mapped.part1Questions.length));
    setPart2Topic(mapped.part2Topic);
    setPart2Bullets(mapped.part2Bullets);
    setPart3Topics(mapped.part3Topics);
    setShowImportModal(false);
    setStep(1); // land teachers back on Part 1 so they can review everything step by step
  }

  const categoryValid = SPEAKING_CATEGORY_VALUES.includes(speakingCategory);
  const step1Valid =
    testTitle.trim().length > 0 &&
    categoryValid &&
    part1Questions.length > 0 &&
    part1Questions.every((q) => q.trim());
  const step2Valid = part2Topic.trim().length > 0 && part2Bullets.length > 0 && part2Bullets.every((b) => b.trim());
  const step3Valid =
    part3Topics.length > 0 && part3Topics.every((t) => t.heading.trim() && t.questions.length > 0 && t.questions.every((q) => q.trim()));

  function goNext() {
    setStep((s) => Math.min(4, s + 1));
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  function buildPayload() {
    const part1Group = {
      groupInstructions: 'Part 1 — Introduction and Interview: answer each question conversationally.',
      questionType: 'speaking-prompt',
      startNumber: 1,
      endNumber: part1Questions.length,
      questions: part1Questions.map((q, i) => ({
        questionNumber: i + 1,
        type: 'speaking-prompt',
        prompt: q.trim(),
        options: [],
        correctAnswer: '',
      })),
    };

    let cursor = part1Questions.length;
    const part3Groups = part3Topics.map((topic) => {
      const start = cursor + 1;
      const questions = topic.questions.map((q, i) => ({
        questionNumber: cursor + i + 1,
        type: 'speaking-prompt',
        prompt: q.trim(),
        options: [],
        correctAnswer: '',
      }));
      cursor += topic.questions.length;
      return {
        groupInstructions: topic.heading.trim(),
        questionType: 'speaking-prompt',
        startNumber: start,
        endNumber: cursor,
        questions,
      };
    });

    const totalPart3Questions = part3Topics.reduce((sum, t) => sum + t.questions.length, 0);

    return {
      title: testTitle.trim(),
      module: 'speaking',
      durationMinutes: Number(durationMinutes) || 15,
      totalQuestions: part1Questions.length + totalPart3Questions,
      // Always one of the 16 fixed categories by the time this can be
      // called — step1Valid (categoryValid) blocks reaching Step 4/Save
      // otherwise. The backend still re-validates this itself (see
      // testUpload.js's resolveSpeakingCategory) rather than trusting the
      // client, but there's no more "leave blank to auto-classify" path.
      speakingCategory,
      parts: [
        {
          partNumber: 1,
          title: 'Part 1 — Introduction and Interview',
          instructions: 'The examiner will ask general questions about yourself and a range of familiar topics.',
          passageText: '',
          questionGroups: [part1Group],
        },
        {
          partNumber: 2,
          title: 'Part 2 — Cue Card',
          instructions: CUE_CARD_STANDARD_INSTRUCTIONS,
          passageText: part2Topic.trim(),
          cueCardBullets: part2Bullets.map((b) => b.trim()).filter(Boolean),
          questionGroups: [],
        },
        {
          partNumber: 3,
          title: 'Part 3 — Two-way Discussion',
          instructions: 'The examiner will ask further questions connected to the Part 2 topic.',
          passageText: '',
          questionGroups: part3Groups,
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
      // Reflect whatever the backend actually resolved/stored — if the
      // teacher left the dropdown on Auto-detect, this fills it in with the
      // category the platform's analysis just assigned, instead of leaving
      // it blank after a successful save.
      setSpeakingCategory(data.test.speakingCategory || '');
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

      {/* Scrollable content — the footer nav below is a real flex-shrink-0
          bar, not `sticky`, so "Next"/"Save"/"Publish" are always visible
          even when a step's content (e.g. many Part 3 questions) is taller
          than the viewport. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-6 pb-10">
          <h1 className="mb-1 text-xl font-semibold">{isEditMode ? 'Edit Speaking Test' : 'Create Speaking Test'}</h1>
          <p className="mb-6 text-sm text-neutral-500">
            {isEditMode
              ? 'Update the Part 1, Cue Card, and Part 3 content below, then save your changes.'
              : 'Build a Part 1 / Cue Card / Part 3 speaking test step by step, or paste AI-generated JSON to auto-populate everything.'}
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

          {/* Step 1 — Part 1 */}
          {step === 1 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              <label className="mb-1 block text-xs font-medium text-neutral-500">Test title</label>
              <input
                type="text"
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
                placeholder="e.g. Cambridge 21 Speaking Test 4"
                className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              <label className="mb-1 block text-xs font-medium text-neutral-500">Duration (min)</label>
              <input
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="mb-5 w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              <label className="mb-1 block text-xs font-medium text-neutral-500">
                Category (Part 2 cue-card theme) <span className="text-rose-500">*</span>
              </label>
              <select
                value={speakingCategory}
                onChange={(e) => setSpeakingCategory(e.target.value)}
                className="mb-1 w-full max-w-xs rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  Select a category…
                </option>
                {SPEAKING_CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="mb-5 text-xs text-neutral-500">
                One category is required for the whole test, based on Part 2's topic — pick the single best fit
                yourself, or use "Import via JSON" (top right) to have the AI pick one for you.
              </p>

              <h2 className="mb-1 text-sm font-semibold text-neutral-800">Part 1 — Introduction and Interview</h2>
              <label className="mb-1 block text-xs font-medium text-neutral-500">Number of questions in Part 1</label>
              <input
                type="number"
                min={1}
                max={MAX_QUESTIONS_PER_PART}
                value={part1Count}
                onChange={(e) => handlePart1CountChange(e.target.value)}
                placeholder="e.g. 4"
                className="mb-4 w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              {part1Questions.length > 0 && (
                <div className="space-y-3">
                  {part1Questions.map((q, i) => (
                    <div key={i}>
                      <label className="mb-1 block text-xs font-medium text-neutral-500">Question {i + 1}</label>
                      <textarea
                        value={q}
                        onChange={(e) => updatePart1Question(i, e.target.value)}
                        rows={2}
                        placeholder="Type or paste the question…"
                        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-4 text-xs text-neutral-500">
                Fill in Part 1, 2, and 3 manually, or use{' '}
                <button onClick={() => setShowImportModal(true)} className="font-medium text-rose-600 underline underline-offset-2">
                  Import via JSON
                </button>{' '}
                (top right) to auto-populate the whole test at once.
              </p>
            </div>
          )}

          {/* Step 2 — Part 2: Cue Card */}
          {step === 2 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-1 text-sm font-semibold text-neutral-800">Part 2 — Cue Card</h2>

              <div className="mb-4 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2.5 text-xs leading-relaxed text-sky-800">
                <span className="font-semibold">Standard instructions (shown automatically): </span>
                {CUE_CARD_STANDARD_INSTRUCTIONS}
              </div>

              <label className="mb-1 block text-xs font-medium text-neutral-500">Cue card topic</label>
              <textarea
                value={part2Topic}
                onChange={(e) => setPart2Topic(e.target.value)}
                rows={2}
                placeholder="Describe a book you recently read."
                className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm leading-relaxed"
              />

              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs font-medium text-neutral-500">You should say:</label>
              </div>
              <div className="space-y-2">
                {part2Bullets.map((b, bi) => (
                  <div key={bi} className="flex items-start gap-2">
                    <span className="mt-2.5 text-sm text-neutral-400">•</span>
                    <div className="flex-1">
                      <input
                        type="text"
                        value={b}
                        onChange={(e) => updateBullet(bi, e.target.value)}
                        placeholder="e.g. what the book was about"
                        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                      />
                    </div>
                    {part2Bullets.length > 1 && (
                      <button
                        onClick={() => removeBullet(bi)}
                        className="mt-0.5 rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={addBullet}
                disabled={part2Bullets.length >= MAX_CUE_CARD_BULLETS}
                className="mt-3 rounded border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
              >
                + Add bullet point
              </button>
            </div>
          )}

          {/* Step 3 — Part 3: grouped discussion topics */}
          {step === 3 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              <h2 className="mb-1 text-sm font-semibold text-neutral-800">Part 3 — Two-way Discussion</h2>
              <p className="mb-4 text-xs text-neutral-500">
                Group Part 3 questions under headings, e.g. "Competitions" with its questions, then another heading like
                "Being competitive in sports" with its own questions.
              </p>

              <div className="space-y-5">
                {part3Topics.map((topic, ti) => (
                  <div key={ti} className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                    <div className="mb-3 flex items-end gap-3">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-neutral-500">Heading</label>
                        <input
                          type="text"
                          value={topic.heading}
                          onChange={(e) => updateTopicHeading(ti, e.target.value)}
                          placeholder="e.g. Competitions"
                          className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      {part3Topics.length > 1 && (
                        <button
                          onClick={() => removeTopic(ti)}
                          className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
                        >
                          Remove topic
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {topic.questions.map((q, qi) => (
                        <div key={qi} className="flex items-start gap-2">
                          <div className="flex-1">
                            <label className="mb-1 block text-xs font-medium text-neutral-500">Question {qi + 1}</label>
                            <textarea
                              value={q}
                              onChange={(e) => updateTopicQuestion(ti, qi, e.target.value)}
                              rows={2}
                              placeholder="Type or paste the discussion question…"
                              className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
                            />
                          </div>
                          {topic.questions.length > 1 && (
                            <button
                              onClick={() => removeQuestionFromTopic(ti, qi)}
                              className="mt-5 rounded border border-neutral-300 bg-white px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={() => addQuestionToTopic(ti)}
                      disabled={topic.questions.length >= MAX_QUESTIONS_PER_PART}
                      className="mt-3 rounded border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 disabled:opacity-40"
                    >
                      + Add question
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={addTopic}
                disabled={part3Topics.length >= MAX_PART3_TOPICS}
                className="mt-4 rounded border border-dashed border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
              >
                + Add topic heading
              </button>
            </div>
          )}

          {/* Step 4 — Review & Save */}
          {step === 4 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              {!savedTest ? (
                <>
                  <h2 className="mb-4 text-sm font-semibold text-neutral-800">Review before saving</h2>

                  <div className="mb-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Title</p>
                    <p className="text-sm text-neutral-800">{testTitle || '—'}</p>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Category</p>
                    <p className="text-sm text-neutral-800">
                      {speakingCategory
                        ? SPEAKING_CATEGORY_OPTIONS.find((o) => o.value === speakingCategory)?.label || speakingCategory
                        : 'Not selected — go back to Step 1 to choose one'}
                    </p>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      Part 1 ({part1Questions.length} question{part1Questions.length === 1 ? '' : 's'})
                    </p>
                    <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
                      {part1Questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ol>
                  </div>

                  <div className="mb-4">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Part 2 — Cue Card</p>
                    <p className="mt-1 rounded bg-neutral-50 p-3 text-xs text-neutral-500">{CUE_CARD_STANDARD_INSTRUCTIONS}</p>
                    <div className="mt-1 rounded border border-neutral-200 bg-white p-3">
                      <p className="text-sm font-semibold text-neutral-800">{part2Topic}</p>
                      <p className="mt-2 text-xs font-medium text-neutral-500">You should say:</p>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-700">
                        {part2Bullets.map((b, bi) => (
                          <li key={bi}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mb-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Part 3 — Discussion Topics</p>
                    <div className="mt-1 space-y-3">
                      {part3Topics.map((topic, ti) => (
                        <div key={ti}>
                          <p className="text-sm font-semibold text-neutral-800">{topic.heading || '(untitled topic)'}</p>
                          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
                            {topic.questions.map((q, qi) => (
                              <li key={qi}>{q}</li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  </div>

                  {saveError && <p className="mt-3 text-sm text-rose-600">{saveError}</p>}
                </>
              ) : (
                <>
                  <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                    ✅ "{savedTest.title}" {isEditMode ? 'updated' : 'saved as a draft'} — category:{' '}
                    {SPEAKING_CATEGORY_OPTIONS.find((o) => o.value === savedTest.speakingCategory)?.label || 'Uncategorized'}.
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

          {step < 4 && (
            <button
              onClick={goNext}
              disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid) || (step === 3 && !step3Valid)}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Next
            </button>
          )}

          {step === 4 && !savedTest && (
            <button
              onClick={handleSave}
              disabled={isSaving || !step1Valid || !step2Valid || !step3Valid}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Save Speaking Test'}
            </button>
          )}

          {step === 4 && savedTest && !isPublished && (
            <button
              onClick={handlePublish}
              disabled={isPublishing}
              className="rounded bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {isPublishing ? 'Publishing…' : 'Publish Test'}
            </button>
          )}

          {step === 4 && isPublished && (
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
