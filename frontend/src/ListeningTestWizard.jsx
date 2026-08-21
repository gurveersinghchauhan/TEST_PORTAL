import { useRef, useState } from 'react';
import { authHeaders } from './apiAuth';
import ImageUploadDropzone from './components/common/ImageUploadDropzone';

/**
 * ListeningTestWizard
 * ---------------------
 * Step-by-step form for building (or editing) an IELTS Listening test —
 * same create/edit dual-mode shape as Reading/Speaking/Writing wizards
 * (initialTest present → PATCH, absent → POST) and the same scroll-safe
 * layout (scrollable content, fixed header/footer bars, never `sticky`).
 *
 * Listening always has exactly 4 fixed sections (Part 1–4), each paired
 * with its own question groups but NOT its own audio anymore — the whole
 * test shares ONE pre-merged master audio file (all 4 sections back-to-
 * back), uploaded once at the top of Step 1 (see MasterAudioDropzone
 * below) rather than 4 separate per-section audio links. This replaced an
 * older 4-file-upload system; see testSchema.masterAudioUrl in
 * backend/models/Test.js. Unlike ReadingTestWizard, which reuses PartEditor
 * because a passage's shape already fits it exactly, this wizard uses its
 * own bespoke section/question-group editor: PartEditor doesn't fit
 * Listening's needs, and Listening's groups need per-question add/remove +
 * an options editor that the existing QuestionGroupEditor doesn't support
 * either. The 4 sections are shown as tabs within one "Sections" step
 * rather than 4 separate wizard steps, so the whole test stays one
 * Next-click away from Review at all times.
 *
 * Internal `sections` state IS the backend `parts` shape (module:
 * 'listening', partNumber 1–4, instructions, questionGroups) minus audio,
 * which now lives entirely in its own `masterAudioUrl` state (mirrored 1:1
 * onto the test document's top-level masterAudioUrl field, not onto any
 * part) — except questions don't carry questionNumber/startNumber/
 * endNumber while being edited — those are assigned sequentially across
 * all 4 sections at save time (buildPayload), so reordering/adding/
 * removing questions never requires the teacher to renumber anything by
 * hand.
 *
 * "Import via JSON" works the same way as Reading's: a teacher pastes
 * AI-generated JSON using a friendlier schema (no numbering, no audio — an
 * AI can't produce a real audio file) and it's validated then mapped into
 * the 4 section slots; the master audio file is always uploaded separately
 * through the dropzone, never imported.
 */

const STEPS = ['Test Details', 'Sections', 'Review & Save'];
const SECTION_COUNT = 4;
const DEFAULT_SECTION_INSTRUCTIONS = 'Listen to the recording and answer the questions.';

const QUESTION_TYPE_OPTIONS = [
  { value: 'multiple-choice', label: 'Multiple choice' },
  { value: 'fill-in-the-blank', label: 'Fill in the blank / form completion' },
  { value: 'short-answer', label: 'Short answer' },
  { value: 'matching-information', label: 'Matching' },
  { value: 'note-completion', label: 'Note completion (rich text / cloze)' },
  { value: 'summary-completion', label: 'Summary completion (rich text / cloze)' },
  // Map/plan/diagram labeling — "Where are the following located? Choose
  // the correct letter, A-H" (Cambridge Section 2/3). Same backend type and
  // same TestInterface.jsx renderer (MatrixMatchingGroup) as Reading's own
  // matrix_matching import type — one shared option grid, radio button per
  // row, NOT the drag-and-drop "options box" (matching-information above).
  // Before this option existed, teachers had no way to author this type for
  // Listening at all and would reach for "Matching" instead, which stores
  // each grid letter as a wordBank entry and renders it through
  // BoxMatchingRenderer — the source of the reported "A A"/"B B" duplicate
  // label bug, since that component then adds its OWN auto-lettered badge
  // right next to an option whose text is already just that same letter.
  { value: 'matrix-matching', label: 'Map / diagram / plan labeling (matrix grid)' },
];

// Group types that use the layoutText rich-text/cloze note block (see
// NoteCompletionGroup in TestInterface.jsx) — note-completion and
// summary-completion render identically, just different Cambridge task
// names, so they share the exact same authoring textarea below.
const NOTE_LAYOUT_QUESTION_TYPES = ['note-completion', 'summary-completion'];

// Shown to teachers above the "Note layout" textarea (QuestionGroupBuilder,
// note-completion groups only) — this is the only place the {{n}} inline
// placeholder syntax is documented, since TestInterface.jsx's renderer
// (parseNoteLayout/GROUP_BLANK_MARKER) just silently expects authors to
// already know it.
//
// {{n}} here is GROUP-RELATIVE, not the question's real absolute number:
// {{1}} is always this group's first question, {{2}} its second, and so
// on, no matter where this group actually lands once the whole test is
// numbered. Reason: while a teacher is still adding/reordering sections and
// questions, there's no stable absolute number to type yet — it can shift
// on every edit. toAbsoluteLayoutText() (see buildPayload) rewrites these
// relative markers to the real absolute numbers automatically at save
// time, the same moment every other question in the test gets numbered
// (see the cursor logic in buildPayload) — so nothing here needs to match
// the group's real position in the test, only its OWN question order.
const NOTE_LAYOUT_HELP =
  '# Main title (centered)\n' +
  '## Sub-heading (bold, left-aligned)\n' +
  "- Top-level bullet point with a blank: the tour starts at {{1}} o'clock\n" +
  '  - Nested sub-point (indent with 2 spaces) mentioning {{2}}\n' +
  '\n' +
  'Plain paragraph line, also with a blank like {{3}} inline.\n\n' +
  "Blank lines separate blocks. Always start at {{1}} for this group's first question below, {{2}} for its second, and so on — never this group's real test-wide question number.";

// The JSON import schema uses underscore names (matching the Reading
// importer's convention) and maps onto the backend's existing
// questionSchema.type enum (backend/models/Test.js). note_completion/
// summary_completion questions are still graded as plain fill-in-the-blank
// (see mapImportJsonToSections) — what's different for them is the GROUP's
// own questionType label (IMPORT_TYPE_TO_GROUP_LABEL below), which tells
// TestInterface.jsx to render the rich-text note/summary layout instead of
// one isolated line per question. This mirrors ReadingTestWizard.jsx's
// note_completion/table_completion handling exactly, so an AI-generated
// Listening test can produce the same rich-text blocks Reading already
// could — previously this importer had no way to produce layoutText at
// all, which is why imported Listening note-completion content always
// rendered as a flat list regardless of any renderer fix.
const IMPORT_TYPE_TO_BACKEND_TYPE = {
  multiple_choice: 'multiple-choice',
  fill_in_blanks: 'fill-in-the-blank',
  short_answer: 'short-answer',
  matching_information: 'matching-information',
  note_completion: 'fill-in-the-blank',
  summary_completion: 'fill-in-the-blank',
  // Map/plan/diagram labeling radio grid — its own backend type (mirrors
  // ReadingTestWizard.jsx's identical mapping), rendered by
  // TestInterface.jsx's MatrixMatchingGroup as an image beside a
  // question-rows × option-columns table, NOT the drag-and-drop word bank.
  matrix_matching: 'matrix-matching',
};
const VALID_IMPORT_TYPES = Object.keys(IMPORT_TYPE_TO_BACKEND_TYPE);
// Only note_completion/summary_completion need a group-level label distinct
// from their (shared, fill-in-the-blank) question type — everything else
// falls back to IMPORT_TYPE_TO_BACKEND_TYPE's mapping, which already
// matches 1:1 at the group level.
const IMPORT_TYPE_TO_GROUP_LABEL = {
  note_completion: 'note-completion',
  summary_completion: 'summary-completion',
};
const NOTE_LAYOUT_IMPORT_TYPES = Object.keys(IMPORT_TYPE_TO_GROUP_LABEL);

// Extracts every inline blank marker number ("{{3}}", or the older
// "[[3]]") from a note/summary-completion group's layout text, in the
// order they appear — used both by validateListeningImportJson (to check
// the set is exactly {1..questionCount}, no gaps/dupes/out-of-range) and by
// toAbsoluteLayoutText/toRelativeLayoutText below (see GROUP_BLANK_MARKER
// in TestInterface.jsx for the matching render-side pattern).
function extractBlankMarkerNumbers(text) {
  return Array.from((text || '').matchAll(/\{\{(\d+)\}\}|\[\[(\d+)\]\]/g), (m) => Number(m[1] ?? m[2]));
}

// Rewrites every "{{k}}"/"[[k]]" marker in layoutText from GROUP-RELATIVE
// (k = 1 is this group's first question, per NOTE_LAYOUT_HELP above) to the
// real absolute question number, using this group's computed startNumber —
// e.g. startNumber 31: {{1}} → {{31}}, {{2}} → {{32}}. Called once per
// group in buildPayload, the same place every other question in a
// Listening test gets its final absolute number assigned.
function toAbsoluteLayoutText(layoutText, startNumber) {
  if (!layoutText) return layoutText;
  return layoutText.replace(/\{\{(\d+)\}\}|\[\[(\d+)\]\]/g, (match, curly, square) => {
    const relative = Number(curly ?? square);
    return `{{${startNumber + relative - 1}}}`;
  });
}

// The inverse of toAbsoluteLayoutText — rewrites absolute markers back to
// group-relative ones using the group's saved startNumber, so re-opening an
// existing test for editing shows the same relative numbering teachers
// author with (see extractSectionsFromTest), regardless of where this
// group's questions actually landed in the saved test.
function toRelativeLayoutText(layoutText, startNumber) {
  if (!layoutText || !Number.isFinite(startNumber)) return layoutText;
  return layoutText.replace(/\{\{(\d+)\}\}|\[\[(\d+)\]\]/g, (match, curly, square) => {
    const absolute = Number(curly ?? square);
    return `{{${absolute - startNumber + 1}}}`;
  });
}

const MASTER_AI_PROMPT = `You are generating IELTS Listening test content as JSON for an online test platform. Based on the topic/context I give you (or a realistic IELTS Listening scenario if I don't give you one), output ONLY valid JSON — no markdown code fences, no commentary — matching exactly this structure:

{
  "title": "string, e.g. 'Cambridge 21 Test 4 — Listening'",
  "durationMinutes": 30,
  "sections": [
    {
      "sectionNumber": 1,
      "title": "string, e.g. 'Part 1 — Accommodation Booking'",
      "instructions": "e.g. 'Listen and answer questions 1-10.'",
      "questionGroups": [
        {
          "groupInstructions": "e.g. 'Questions 1-5: Complete the form below. Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.'",
          "questionType": "note_completion",
          "layoutLines": [
            "# Booking Form",
            "- Name: {{1}}",
            "- Contact number: {{2}}",
            "- Preferred date: {{3}}",
            "- Number of guests: {{4}}",
            "- Special requests: {{5}}"
          ],
          "questions": [
            { "prompt": "Name", "correctAnswer": "Sarah Johnson" },
            { "prompt": "Contact number", "correctAnswer": "07911 234567" },
            { "prompt": "Preferred date", "correctAnswer": "14 March" },
            { "prompt": "Number of guests", "correctAnswer": "4" },
            { "prompt": "Special requests", "correctAnswer": "vegetarian meal" }
          ]
        },
        {
          "groupInstructions": "e.g. 'Questions 6-10: Choose the correct letter, A, B or C.'",
          "questionType": "multiple_choice",
          "questions": [
            { "prompt": "question text", "options": ["option A", "option B", "option C"], "correctAnswer": "must exactly match one of the options" }
          ]
        },
        {
          "groupInstructions": "e.g. 'Questions 11-16: What does the speaker say about each facility? Choose SIX answers from the box and write the correct letter, A-I, next to questions 11-16.'",
          "questionType": "matching_information",
          "wordBank": ["Library", "Gymnasium", "Car park", "Cafeteria", "Reception", "Meeting rooms", "Print shop", "Bike storage", "Staff lounge"],
          "questions": [
            { "prompt": "Building A", "correctAnswer": "Library" },
            { "prompt": "Building B", "correctAnswer": "Gymnasium" },
            { "prompt": "Building C", "correctAnswer": "Car park" },
            { "prompt": "Building D", "correctAnswer": "Cafeteria" },
            { "prompt": "Building E", "correctAnswer": "Reception" },
            { "prompt": "Building F", "correctAnswer": "Meeting rooms" }
          ]
        },
        {
          "groupInstructions": "e.g. 'Questions 17-20: Label the map below. Write the correct letter, A-G, next to questions 17-20.'",
          "questionType": "matrix_matching",
          "mapImageUrl": "OPTIONAL: a data URL or hosted URL for the map/plan/diagram image being labeled — omit or leave '' if no image is available; the source material should describe one even if you can't embed the actual pixels",
          "matrixOptions": ["A", "B", "C", "D", "E", "F", "G"],
          "questions": [
            { "prompt": "bridge foundations", "correctAnswer": "must exactly match one entry in matrixOptions, e.g. 'C'" },
            { "prompt": "rubbish pit", "correctAnswer": "must exactly match one entry in matrixOptions, e.g. 'F'" }
          ]
        }
      ]
    },
    {
      "sectionNumber": 4,
      "title": "string, e.g. 'Part 4 — Lecture on Urban Beekeeping'",
      "instructions": "e.g. 'Listen and answer questions 31-40.'",
      "questionGroups": [
        {
          "groupInstructions": "e.g. 'Questions 31-40: Complete the notes below. Write ONE WORD ONLY for each answer.'",
          "questionType": "note_completion",
          "layoutLines": [
            "# Urban Beekeeping",
            "## Benefits",
            "- Improves {{1}} in city gardens",
            "  - Especially important for {{2}} plants",
            "- Produces local {{3}} as a by-product",
            "## Challenges",
            "- Hives need protection from {{4}}",
            "- Councils require a {{5}} before installation"
          ],
          "questions": [
            { "prompt": "What hives improve", "correctAnswer": "pollination" },
            { "prompt": "Type of plants that benefit most", "correctAnswer": "flowering" },
            { "prompt": "Local by-product", "correctAnswer": "honey" },
            { "prompt": "What hives need protection from", "correctAnswer": "wind" },
            { "prompt": "What councils require first", "correctAnswer": "permit" }
          ]
        }
      ]
    }
  ]
}

Rules:
- "questionType" must be exactly one of: multiple_choice, fill_in_blanks, short_answer, matching_information, note_completion, summary_completion, matrix_matching.
- Do NOT include questionNumber, startNumber, or endNumber for any question or group — the platform numbers questions automatically in the order you list them.
- Do NOT include "audioUrl" or any audio field — the teacher uploads one master audio file for the whole test separately, in the platform itself.
- Include up to 4 sections (Part 1 through Part 4), each with its own questionGroups. Section 1 (a form/note completion, e.g. a booking or registration form) and Section 4 (a lecture note-completion) are the two sections that almost always need "note_completion" or "summary_completion" — do not force them into "fill_in_blanks" instead.
- For multiple_choice, correctAnswer must exactly match one of that question's options.
- For matching_information, "wordBank" is REQUIRED — the shared box of options every question in the group picks ONE answer from (Cambridge's "Choose the correct letter, A-I, from the box" task). List every option once, in the order they should appear in the box (the platform assigns letters A, B, C... automatically in that order — do not include letters yourself). Every question's "correctAnswer" must exactly match one entry in "wordBank" (same spelling/case). Set "allowRepeatWordBankOptions": true only if the source material explicitly allows using the same option for more than one question; omit it (defaults to false) for the usual "each option once" rule.
- For matrix_matching (map/plan/diagram labeling — "Where are the following located? Choose the correct letter, A-H", common in Section 2/3), "matrixOptions" is REQUIRED — the shared list of column letters/labels, in left-to-right order (do NOT include the letters as part of any question's "prompt" — the platform renders them as its own column headers). Every question's "correctAnswer" must exactly match one entry in "matrixOptions". Unlike matching_information above, this is answered with a grid of radio buttons (one option per row), so the SAME letter may correctly be reused as the answer for more than one row — do not treat matrixOptions as a pool that shrinks, and do NOT use "wordBank" for this type. "mapImageUrl" is optional (omit/leave blank if you have no real image to provide); still write each "prompt" as if there IS a diagram being labeled, describing the location in words (e.g. "bridge foundations", "rubbish pit").
- For note_completion and summary_completion, "layoutLines" is the note/summary/form text EXACTLY as it should be shown to the student, one array entry per line: a line starting with "# " renders as a centered bold main title, "## " as a left-aligned bold sub-heading, "- " as a bullet point (indent it two spaces, e.g. "  - ", for a nested sub-bullet), and anything else as a plain paragraph line.
- CRITICAL — how to mark blanks: every blank in "layoutLines" (whatever it looks like in your source notes — an underscore run like "___", a gap, or nothing at all) MUST be written inline, in place, as "{{n}}" (double curly braces). These numbers are GROUP-RELATIVE, always starting at {{1}} for this group's FIRST question, {{2}} for its second, and so on — never the question's real position in the whole test (so a Section 4 group's markers still start at {{1}}, even though those questions might really be numbered 31-40). Before you output your answer, COUNT the "{{n}}" markers you wrote in "layoutLines" and COUNT the entries in that group's "questions" array — these two counts MUST be identical, and the marker numbers used MUST be exactly 1, 2, 3, ... up to that count, each appearing exactly once (no skipped numbers, no repeats, nothing out of range). Still include the normal flat "questions" array (one entry per blank, in the same {{1}},{{2}},{{3}}... order as the markers) exactly like fill_in_blanks — this is what stores the answer key; "prompt" there can be a short label for that blank (e.g. "Opening hour") since the real question text is the note/summary layout above, not this field.
- Output raw JSON only.`;

// Maps a GROUP's questionType to the type each of its individual questions
// must actually be saved with (questionSchema.type in
// backend/models/Test.js). note-completion/summary-completion are
// layout-only group labels — presentation, not grading — so every question
// underneath is still graded as a plain typed blank, same as
// fill-in-the-blank (this mirrors ReadingTestWizard.jsx's
// IMPORT_TYPE_TO_BACKEND_TYPE convention and the doc comment on
// questionGroupSchema.questionType in Test.js). Every other group type
// already matches a real questionSchema.type enum value, so it passes
// through unchanged. Getting this wrong is exactly what makes Mongoose
// reject the save: questionSchema.type has a strict enum that (correctly)
// doesn't include 'note-completion'/'summary-completion' — those aren't
// real grading behaviors, only NoteCompletionGroup's rendering trigger.
function questionGradingType(groupQuestionType) {
  return NOTE_LAYOUT_QUESTION_TYPES.includes(groupQuestionType) ? 'fill-in-the-blank' : groupQuestionType;
}

function emptyQuestion() {
  return { type: 'multiple-choice', prompt: '', options: ['', ''], correctAnswer: '', wordLimit: null };
}

function emptyGroup() {
  return {
    groupInstructions: '',
    questionType: 'multiple-choice',
    layoutText: '',
    wordBank: [],
    allowRepeatWordBankOptions: false,
    // Matrix radio grid (map/plan/diagram labeling) — see
    // TestInterface.jsx's MatrixMatchingGroup and Test.js's
    // questionGroupSchema.mapImageUrl/matrixOptions. Harmless empty
    // defaults for every other group type, same as wordBank above.
    mapImageUrl: '',
    matrixOptions: [],
    questions: [emptyQuestion()],
  };
}

function emptySection(partNumber) {
  return {
    partNumber,
    title: `Part ${partNumber}`,
    instructions: DEFAULT_SECTION_INSTRUCTIONS,
    questionGroups: [],
  };
}

function emptySections() {
  return Array.from({ length: SECTION_COUNT }, (_, i) => emptySection(i + 1));
}

function countSectionQuestions(section) {
  return (section.questionGroups || []).reduce((sum, g) => sum + (g.questions || []).length, 0);
}

function countAllQuestions(sections) {
  return sections.reduce((sum, s) => sum + countSectionQuestions(s), 0);
}

/** Pulls the 4 fixed sections back out of a saved test's `parts` array. */
function extractSectionsFromTest(test) {
  const base = emptySections();
  (test?.parts || []).forEach((part) => {
    const idx = (part.partNumber || 1) - 1;
    if (idx < 0 || idx >= SECTION_COUNT) return;
    base[idx] = {
      partNumber: idx + 1,
      title: part.title || `Part ${idx + 1}`,
      instructions: part.instructions || DEFAULT_SECTION_INSTRUCTIONS,
      questionGroups: (part.questionGroups || []).map((g) => ({
        groupInstructions: g.groupInstructions || '',
        questionType: g.questionType || 'multiple-choice',
        // Saved layoutText holds real absolute question numbers (see
        // toAbsoluteLayoutText in buildPayload) — converted back to the
        // group-relative {{1}}, {{2}}, ... numbering the "Note layout"
        // textarea authors with (NOTE_LAYOUT_HELP) so re-opening this test
        // for editing shows the same convention as authoring a new one.
        layoutText: toRelativeLayoutText(g.layoutText || '', g.startNumber),
        // "Choose your answer from the box" matching groups — see
        // BoxMatchingRenderer.jsx. Empty for every other group type, same
        // as layoutText above.
        wordBank: Array.isArray(g.wordBank) ? g.wordBank : [],
        allowRepeatWordBankOptions: Boolean(g.allowRepeatWordBankOptions),
        // Matrix radio grid (map/plan/diagram labeling) — empty for every
        // other group type, same as wordBank above.
        mapImageUrl: g.mapImageUrl || '',
        matrixOptions: Array.isArray(g.matrixOptions) ? g.matrixOptions : [],
        questions: (g.questions || []).map((q) => ({
          type: q.type,
          prompt: q.prompt || '',
          options: Array.isArray(q.options) && q.options.length ? q.options : ['', ''],
          correctAnswer: Array.isArray(q.correctAnswer) ? q.correctAnswer.join(', ') : q.correctAnswer || '',
          wordLimit: q.wordLimit || null,
        })),
      })),
    };
  });
  return base;
}

/**
 * Validates a parsed (already JSON.parse'd) import object against the
 * shape MASTER_AI_PROMPT asks the AI to produce. Returns every problem
 * found, not just the first, so a bad paste can be fixed in one pass.
 */
function validateListeningImportJson(parsed) {
  const errors = [];

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, errors: ['The pasted JSON must be an object, e.g. { "title": ..., "sections": [...] }.'] };
  }

  if (typeof parsed.title !== 'string' || !parsed.title.trim()) {
    errors.push('Missing or empty "title" string.');
  }

  if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    errors.push('Missing "sections" array (must contain at least one section).');
    return { valid: false, errors };
  }
  if (parsed.sections.length > SECTION_COUNT) {
    errors.push(`"sections" has ${parsed.sections.length} entries — Listening tests support at most ${SECTION_COUNT} (Part 1–4). Extra sections will be ignored.`);
  }

  parsed.sections.forEach((section, si) => {
    const sLabel = `Section ${si + 1}`;

    if (!section || typeof section !== 'object') {
      errors.push(`${sLabel}: must be an object.`);
      return;
    }

    if (!Array.isArray(section.questionGroups) || section.questionGroups.length === 0) {
      errors.push(`${sLabel}: missing "questionGroups" array.`);
      return;
    }

    section.questionGroups.forEach((group, gi) => {
      const gLabel = `${sLabel}, question group ${gi + 1}`;

      if (!group || typeof group !== 'object') {
        errors.push(`${gLabel}: must be an object.`);
        return;
      }
      if (!VALID_IMPORT_TYPES.includes(group.questionType)) {
        errors.push(`${gLabel}: invalid question type "${group.questionType}". Expected one of ${VALID_IMPORT_TYPES.join(', ')}.`);
      }
      if (!group.groupInstructions || typeof group.groupInstructions !== 'string') {
        errors.push(`${gLabel}: missing "groupInstructions".`);
      }
      if (!Array.isArray(group.questions) || group.questions.length === 0) {
        errors.push(`${gLabel}: missing "questions" array.`);
        return;
      }

      // "Choose your answer from the box" matching — the shared pool every
      // question in the group picks one answer from (see
      // BoxMatchingRenderer.jsx). Checked before the per-question loop
      // below so hasWordBank/wordBankSet are ready for the correctAnswer
      // cross-check inside it.
      const hasWordBank = group.questionType === 'matching_information';
      let wordBankSet = null;
      if (hasWordBank) {
        if (!Array.isArray(group.wordBank) || group.wordBank.length === 0) {
          errors.push(`${gLabel}: matching_information needs a non-empty "wordBank" array.`);
        } else if (group.wordBank.some((o) => typeof o !== 'string' || !o.trim())) {
          errors.push(`${gLabel}: every "wordBank" entry must be a non-empty string.`);
        } else {
          wordBankSet = new Set(group.wordBank);
        }
        if (group.allowRepeatWordBankOptions != null && typeof group.allowRepeatWordBankOptions !== 'boolean') {
          errors.push(`${gLabel}: "allowRepeatWordBankOptions" must be a boolean.`);
        }
      }

      // Map/plan/diagram labeling radio grid — its own group-level image +
      // option-column fields (mirrors matching_information's wordBank check
      // above), NOT a shrinking drag-and-drop pool: the same letter may
      // legitimately be the correct answer for more than one row.
      const hasMatrixOptions = group.questionType === 'matrix_matching';
      let matrixOptionsSet = null;
      if (hasMatrixOptions) {
        if (!Array.isArray(group.matrixOptions) || group.matrixOptions.length === 0) {
          errors.push(`${gLabel}: matrix_matching needs a non-empty "matrixOptions" array (the column letters/labels, e.g. ["A","B","C","D"]).`);
        } else if (group.matrixOptions.some((o) => typeof o !== 'string' || !o.trim())) {
          errors.push(`${gLabel}: every "matrixOptions" entry must be a non-empty string.`);
        } else {
          matrixOptionsSet = new Set(group.matrixOptions);
        }
        if (group.mapImageUrl != null && typeof group.mapImageUrl !== 'string') {
          errors.push(`${gLabel}: "mapImageUrl" must be a string when present.`);
        }
      }

      group.questions.forEach((q, qi) => {
        const qLabel = `${gLabel}, question ${qi + 1}`;
        if (!q || typeof q.prompt !== 'string' || !q.prompt.trim()) errors.push(`${qLabel}: missing "prompt".`);
        if (!q || q.correctAnswer == null || q.correctAnswer === '') errors.push(`${qLabel}: missing "correctAnswer".`);
        if (group.questionType === 'multiple_choice' && (!Array.isArray(q.options) || q.options.length < 2)) {
          errors.push(`${qLabel}: multiple_choice questions need an "options" array with at least 2 choices.`);
        }
        if (wordBankSet && q && typeof q.correctAnswer === 'string' && !wordBankSet.has(q.correctAnswer)) {
          errors.push(`${qLabel}: "correctAnswer" must exactly match one entry in the group's "wordBank".`);
        }
        if (matrixOptionsSet && q && typeof q.correctAnswer === 'string' && !matrixOptionsSet.has(q.correctAnswer)) {
          errors.push(`${qLabel}: "correctAnswer" must exactly match one entry in the group's "matrixOptions".`);
        }
      });

      if (NOTE_LAYOUT_IMPORT_TYPES.includes(group.questionType)) {
        if (!Array.isArray(group.layoutLines) || group.layoutLines.length === 0) {
          errors.push(`${gLabel}: ${group.questionType} needs a non-empty "layoutLines" array.`);
        } else if (group.layoutLines.some((l) => typeof l !== 'string')) {
          errors.push(`${gLabel}: every "layoutLines" entry must be a string.`);
        } else {
          // No explicit questionNumber/startNumber exists yet at import time
          // (this wizard auto-numbers sequentially once saved — see
          // buildPayload/toAbsoluteLayoutText) so markers here are always
          // GROUP-RELATIVE (1 = this group's first question, per
          // NOTE_LAYOUT_HELP/MASTER_AI_PROMPT). The strongest check
          // available at this stage isn't just a count match — it's that
          // the markers used are EXACTLY the set {1, 2, ..., questionCount},
          // each appearing once: catches the AI forgetting a blank (a
          // missing number), duplicating one (two blanks would fight over
          // the same input), or drifting into absolute numbering by mistake
          // (e.g. writing {{31}} for a group whose first question is really
          // #31 — that must still be written as {{1}} here).
          const questionCount = Array.isArray(group.questions) ? group.questions.length : 0;
          const markers = extractBlankMarkerNumbers(group.layoutLines.join('\n'));
          if (markers.length !== questionCount) {
            errors.push(
              `${gLabel}: found ${markers.length} blank marker(s) in "layoutLines" but ${questionCount} question(s) — these must match, one marker per question.`
            );
          } else {
            const seen = new Set();
            const problems = [];
            markers.forEach((n) => {
              if (seen.has(n)) problems.push(`{{${n}}} is used more than once`);
              seen.add(n);
            });
            for (let n = 1; n <= questionCount; n++) {
              if (!seen.has(n)) problems.push(`{{${n}}} is missing`);
            }
            Array.from(seen)
              .filter((n) => n < 1 || n > questionCount)
              .forEach((n) => problems.push(`{{${n}}} is out of range — markers must start at {{1}} and go up to {{${questionCount}}} (relative to this group, not the test's real numbering)`));
            if (problems.length > 0) {
              errors.push(`${gLabel}: ${problems.join('; ')}.`);
            }
          }
        }
      }
    });
  });

  // Only structural warnings (like the >4 sections note) survive alongside
  // otherwise-valid content — anything else pushed above is fatal.
  const fatal = errors.filter((e) => !e.includes('Extra sections will be ignored'));
  return { valid: fatal.length === 0, errors };
}

/** Converts a validated import object into the wizard's 4-slot sections state. */
function mapImportJsonToSections(parsed) {
  const base = emptySections();
  parsed.sections.slice(0, SECTION_COUNT).forEach((section, i) => {
    // Places this section at its declared "sectionNumber" (Part 1-4) when
    // that's a valid slot, falling back to array position for older/looser
    // imports that omit it — important once a teacher regenerates just one
    // or two sections at a time (e.g. "give me Section 1 and Section 4
    // only"), which the array-position-only version of this used to
    // silently place into the wrong parts (Section 4's content landing in
    // Part 2, since it was only the 2nd array entry).
    const slot =
      Number.isInteger(section.sectionNumber) && section.sectionNumber >= 1 && section.sectionNumber <= SECTION_COUNT
        ? section.sectionNumber - 1
        : i;
    const questionGroups = (section.questionGroups || []).map((group) => {
      const backendType = IMPORT_TYPE_TO_BACKEND_TYPE[group.questionType] || 'multiple-choice';
      // note_completion/summary_completion get their own layout-only group
      // label (IMPORT_TYPE_TO_GROUP_LABEL) so TestInterface.jsx renders the
      // rich-text note/summary block below instead of one line per
      // question; every other type's group label matches its (shared)
      // backend type, same as before.
      const groupType = IMPORT_TYPE_TO_GROUP_LABEL[group.questionType] || backendType;
      const hasWordBank = group.questionType === 'matching_information' && Array.isArray(group.wordBank) && group.wordBank.length > 0;
      // Map/plan/diagram labeling radio grid — its own group-level image +
      // option-column fields, NOT the drag-and-drop wordBank above (see
      // TestInterface.jsx's MatrixMatchingGroup).
      const hasMatrixOptions = group.questionType === 'matrix_matching' && Array.isArray(group.matrixOptions) && group.matrixOptions.length > 0;
      return {
        groupInstructions: group.groupInstructions,
        questionType: groupType,
        layoutText: NOTE_LAYOUT_IMPORT_TYPES.includes(group.questionType) ? (group.layoutLines || []).join('\n') : '',
        // "Choose your answer from the box" matching — see
        // BoxMatchingRenderer.jsx. Only set when the AI's JSON actually
        // included one; an ordinary typed blank carries no wordBank at all.
        ...(hasWordBank ? { wordBank: group.wordBank, allowRepeatWordBankOptions: Boolean(group.allowRepeatWordBankOptions) } : {}),
        ...(hasMatrixOptions ? { matrixOptions: group.matrixOptions, mapImageUrl: group.mapImageUrl || '' } : {}),
        questions: (group.questions || []).map((q) => ({
          type: backendType,
          prompt: q.prompt,
          options: backendType === 'multiple-choice' && Array.isArray(q.options) && q.options.length ? q.options : ['', ''],
          correctAnswer: q.correctAnswer,
          wordLimit: group.wordLimit || q.wordLimit || null,
        })),
      };
    });

    base[slot] = {
      partNumber: slot + 1,
      title: section.title || `Part ${slot + 1}`,
      instructions: section.instructions || DEFAULT_SECTION_INSTRUCTIONS,
      questionGroups,
    };
  });
  return base;
}

/* -------------------------------------------------------------------------
 * One question's prompt / options / correct-answer fields, inside a group.
 * ---------------------------------------------------------------------- */
function QuestionEditor({ question, questionType, onChange, onRemove, canRemove, index }) {
  function updateOption(oi, value) {
    onChange({ ...question, options: question.options.map((o, i) => (i === oi ? value : o)) });
  }
  function addOption() {
    onChange({ ...question, options: [...question.options, ''] });
  }
  function removeOption(oi) {
    if (question.options.length <= 2) return;
    onChange({ ...question, options: question.options.filter((_, i) => i !== oi) });
  }

  return (
    <div className="mb-2 rounded border border-neutral-200 bg-white p-3">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-1.5 w-5 shrink-0 text-xs font-semibold text-neutral-400">{index + 1}.</span>
        <div className="flex-1">
          <textarea
            value={question.prompt}
            onChange={(e) => onChange({ ...question, prompt: e.target.value })}
            rows={2}
            placeholder="Question prompt…"
            className="mb-2 w-full rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />

          {questionType === 'multiple-choice' && (
            <div className="mb-2 space-y-1.5">
              {question.options.map((opt, oi) => (
                <div key={oi} className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={opt}
                    onChange={(e) => updateOption(oi, e.target.value)}
                    placeholder={`Option ${oi + 1}`}
                    className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                  />
                  {question.options.length > 2 && (
                    <button onClick={() => removeOption(oi)} className="text-xs text-neutral-400 hover:text-neutral-600">
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addOption} className="text-xs font-medium text-rose-600 hover:text-rose-700">
                + Add option
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">Correct answer:</span>
            <input
              type="text"
              value={question.correctAnswer}
              onChange={(e) => onChange({ ...question, correctAnswer: e.target.value })}
              className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
            />
          </div>
        </div>
        {canRemove && (
          <button onClick={onRemove} className="mt-1 text-xs text-neutral-400 hover:text-neutral-600" title="Remove question">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * One question group ("Questions N–M") within a section: instructions,
 * type, and its questions — with add/remove for both groups and questions,
 * which the existing QuestionGroupEditor.jsx doesn't support.
 * ---------------------------------------------------------------------- */
function QuestionGroupBuilder({ group, onChange, onRemove, apiBase }) {
  function updateField(field, value) {
    onChange({ ...group, [field]: value });
  }
  function changeType(newType) {
    onChange({
      ...group,
      questionType: newType,
      questions: group.questions.map((q) => ({ ...q, type: questionGradingType(newType) })),
    });
  }
  function addQuestion() {
    onChange({ ...group, questions: [...group.questions, { ...emptyQuestion(), type: questionGradingType(group.questionType) }] });
  }
  function updateQuestion(qi, updated) {
    onChange({ ...group, questions: group.questions.map((q, i) => (i === qi ? updated : q)) });
  }
  function removeQuestion(qi) {
    if (group.questions.length <= 1) return;
    onChange({ ...group, questions: group.questions.filter((_, i) => i !== qi) });
  }

  return (
    <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <div className="mb-3 flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-neutral-500">Group instructions</label>
          <input
            type="text"
            value={group.groupInstructions}
            onChange={(e) => updateField('groupInstructions', e.target.value)}
            placeholder="e.g. Questions 1–5: Complete the form below."
            className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div className="w-56">
          <label className="mb-1 block text-xs font-medium text-neutral-500">Question type</label>
          <select
            value={group.questionType}
            onChange={(e) => changeType(e.target.value)}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-2 text-sm"
          >
            {QUESTION_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={onRemove}
          className="rounded border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
        >
          Remove group
        </button>
      </div>

      {NOTE_LAYOUT_QUESTION_TYPES.includes(group.questionType) && (
        <div className="mb-3 rounded border border-neutral-200 bg-white p-3">
          <label className="mb-1 block text-xs font-medium text-neutral-500">
            Note/summary layout (rich text — this is what students actually see, not the question prompts below)
          </label>
          <p className="mb-2 text-xs text-neutral-400">
            One line each: <code className="rounded bg-neutral-100 px-1">{'# Main title'}</code> (centered), <code className="rounded bg-neutral-100 px-1">{'## Sub-heading'}</code>,{' '}
            <code className="rounded bg-neutral-100 px-1">{'- bullet'}</code>, a 2-space-indented <code className="rounded bg-neutral-100 px-1">{'  - nested bullet'}</code>, or plain text — drop{' '}
            <code className="rounded bg-neutral-100 px-1">{'{{1}}'}</code>, <code className="rounded bg-neutral-100 px-1">{'{{2}}'}</code>… inline wherever a blank belongs. These numbers are
            relative to THIS group only — {'{{1}}'} is always its first question below, {'{{2}}'} its second, and so on, never the question's real number in the test (the platform converts
            these automatically when you save).
          </p>
          <textarea
            value={group.layoutText || ''}
            onChange={(e) => updateField('layoutText', e.target.value)}
            rows={10}
            placeholder={NOTE_LAYOUT_HELP}
            spellCheck={false}
            className="w-full rounded border border-neutral-300 px-3 py-2 font-mono text-xs leading-relaxed"
          />
        </div>
      )}

      {group.questionType === 'matching-information' && (
        <div className="mb-3 rounded border border-neutral-200 bg-white p-3">
          <div className="mb-1 flex items-start justify-between gap-3">
            <label className="block text-xs font-medium text-neutral-500">
              Options box — the shared pool every question below picks ONE answer from (Cambridge's "Choose the
              correct letter, A-I" box). One option per line; each question's Answer must exactly match one line
              here. Leave empty for an ordinary typed answer instead of a dropdown/box.
            </label>
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={Boolean(group.allowRepeatWordBankOptions)}
                onChange={(e) => updateField('allowRepeatWordBankOptions', e.target.checked)}
                className="h-3.5 w-3.5 rounded border-neutral-400"
              />
              Allow reusing an option
            </label>
          </div>
          <textarea
            value={(group.wordBank || []).join('\n')}
            onChange={(e) => updateField('wordBank', e.target.value.split('\n'))}
            rows={5}
            placeholder={'Library\nGymnasium\nCar park'}
            spellCheck={false}
            className="w-full resize-y rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
          />
        </div>
      )}

      {group.questionType === 'matrix-matching' && (
        <div className="mb-3 rounded border border-neutral-200 bg-white p-3">
          <div className="mb-3">
            <ImageUploadDropzone
              apiBase={apiBase}
              imageUrl={group.mapImageUrl}
              onUploaded={(url) => updateField('mapImageUrl', url)}
              label="Map / plan / diagram image (optional) — shown above the answer grid. Leave empty if you don't have one ready yet."
            />
          </div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">
            Answer grid columns — the shared set of letters every question below picks ONE from (Cambridge's "Choose
            the correct letter, A-H"). One per line, left-to-right order. Each question's Answer below must exactly
            match one line here — the same letter may correctly be reused across more than one row.
          </label>
          <textarea
            value={(group.matrixOptions || []).join('\n')}
            onChange={(e) => updateField('matrixOptions', e.target.value.split('\n'))}
            rows={4}
            placeholder={'A\nB\nC\nD\nE\nF\nG'}
            spellCheck={false}
            className="w-full resize-y rounded border border-neutral-300 px-2 py-1.5 font-mono text-xs"
          />
          <p className="mt-2 text-xs italic text-neutral-400">
            Each question's "Prompt" below is the row label (e.g. "bridge foundations") and "Correct answer" is the
            grid letter (e.g. "C") — not free text.
          </p>
        </div>
      )}

      {group.questions.map((q, qi) => (
        <QuestionEditor
          key={qi}
          index={qi}
          question={q}
          questionType={group.questionType}
          onChange={(updated) => updateQuestion(qi, updated)}
          onRemove={() => removeQuestion(qi)}
          canRemove={group.questions.length > 1}
        />
      ))}

      <button
        onClick={addQuestion}
        className="mt-1 rounded border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
      >
        + Add question
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Import via JSON — same shell as ReadingTestWizard's modal: its own
 * scrollable region so a long error list or the prompt text never gets
 * clipped by the viewport.
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

    const result = validateListeningImportJson(parsed);
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
      // Clipboard API unavailable — the prompt is still visible/selectable below.
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
            title and sections. Audio URLs aren't imported — paste those into each section yourself afterward.
          </p>

          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={10}
            placeholder='{ "title": "...", "durationMinutes": 30, "sections": [...] }'
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

/* -------------------------------------------------------------------------
 * MasterAudioDropzone — the single, prominent upload control that replaced
 * the old 4 separate per-section "Audio URL" text inputs. Plain HTML5
 * drag-and-drop (no extra dependency, same technique as PdfUploadZone.jsx)
 * plus a click-to-browse fallback; only ever hands one file at a time to
 * `onFileSelected`, which the wizard immediately uploads via
 * POST /api/tests/upload-audio (see handleAudioFileSelected below) — this
 * component itself never talks to the network, it just picks the file.
 * ---------------------------------------------------------------------- */
function MasterAudioDropzone({ audioUrl, isUploading, error, onFileSelected, onClear }) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const inputRef = useRef(null);

  function handleFiles(fileList) {
    const file = fileList?.[0];
    if (!file) return;
    const isMp3 = file.type === 'audio/mpeg' || file.type === 'audio/mp3' || /\.mp3$/i.test(file.name);
    if (!isMp3) {
      alert('Please upload an .mp3 audio file.');
      return;
    }
    onFileSelected(file);
  }

  const fileName = audioUrl ? decodeURIComponent(audioUrl.split('/').pop() || audioUrl) : '';

  return (
    <div className="mb-4">
      <label className="mb-1 block text-xs font-medium text-neutral-500">Upload Master Audio File (.mp3)</label>

      {audioUrl && !isUploading ? (
        // Uploaded state — the file's already saved server-side, so this is
        // a compact confirmation + a real player to spot-check it, with a
        // clear way to swap it for a different recording.
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-lg">🎧</span>
              <span className="truncate text-sm font-medium text-emerald-800">{fileName}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={onClear}
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-50"
              >
                Remove
              </button>
            </div>
          </div>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="w-full" />
          <input
            ref={inputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => !isUploading && inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            isDraggingOver ? 'border-rose-400 bg-rose-50' : 'border-neutral-300 bg-neutral-50 hover:bg-neutral-100'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="audio/mpeg,audio/mp3,.mp3"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />

          {isUploading ? (
            <>
              <div className="mb-3 h-6 w-6 animate-spin rounded-full border-2 border-rose-600 border-t-transparent" />
              <p className="text-sm text-neutral-600">Uploading master audio file…</p>
            </>
          ) : (
            <>
              <div className="mb-3 text-3xl">🎧</div>
              <p className="mb-1 font-medium text-neutral-800">Drop the master audio file here</p>
              <p className="text-sm text-neutral-500">
                or click to browse — one .mp3 covering all 4 sections back-to-back
              </p>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
    </div>
  );
}

export default function ListeningTestWizard({ apiBase, onBack, initialTest, onSaved, backLabel = 'Back to Test Builder' }) {
  const isEditMode = Boolean(initialTest?._id);
  const [step, setStep] = useState(1);
  const [showImportModal, setShowImportModal] = useState(false);
  const [activeSectionTab, setActiveSectionTab] = useState(0);

  const [testTitle, setTestTitle] = useState(() => initialTest?.title || '');
  const [durationMinutes, setDurationMinutes] = useState(() => initialTest?.durationMinutes || 30);
  const [sections, setSections] = useState(() => (initialTest ? extractSectionsFromTest(initialTest) : emptySections()));

  // The single master audio file for the whole test — replaces the old 4
  // per-section audioUrl fields (see MasterAudioDropzone above). Mirrors
  // straight onto the test document's own masterAudioUrl field on save
  // (buildPayload below), never nested inside `parts`.
  const [masterAudioUrl, setMasterAudioUrl] = useState(() => initialTest?.masterAudioUrl || '');
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedTest, setSavedTest] = useState(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isPublished, setIsPublished] = useState(() => Boolean(initialTest?.isPublished));

  // Uploads the file immediately on selection (before the rest of the test
  // is even saved) — same "upload now, attach the returned URL to the real
  // save payload later" flow as PdfUploadZone's parse-on-select, so a
  // teacher can freely re-upload while still drafting without needing a
  // test document to exist yet.
  async function handleAudioFileSelected(file) {
    setAudioUploading(true);
    setAudioUploadError(null);
    try {
      const formData = new FormData();
      formData.append('audio', file);
      const res = await fetch(`${apiBase}/tests/upload-audio`, {
        method: 'POST',
        headers: authHeaders(), // no Content-Type — the browser sets the multipart boundary itself
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload audio file.');
      setMasterAudioUrl(data.url);
    } catch (err) {
      setAudioUploadError(
        err.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : err.message
      );
    } finally {
      setAudioUploading(false);
    }
  }

  function updateSection(index, updated) {
    setSections((prev) => prev.map((s, i) => (i === index ? updated : s)));
  }
  function updateSectionField(index, field, value) {
    updateSection(index, { ...sections[index], [field]: value });
  }
  function addGroup(sectionIndex) {
    const section = sections[sectionIndex];
    updateSection(sectionIndex, { ...section, questionGroups: [...section.questionGroups, emptyGroup()] });
  }
  function updateGroup(sectionIndex, groupIndex, updatedGroup) {
    const section = sections[sectionIndex];
    updateSection(sectionIndex, {
      ...section,
      questionGroups: section.questionGroups.map((g, i) => (i === groupIndex ? updatedGroup : g)),
    });
  }
  function removeGroup(sectionIndex, groupIndex) {
    const section = sections[sectionIndex];
    updateSection(sectionIndex, {
      ...section,
      questionGroups: section.questionGroups.filter((_, i) => i !== groupIndex),
    });
  }

  function handleImportJson(parsedData) {
    if (parsedData.title) setTestTitle(parsedData.title);
    if (parsedData.durationMinutes) setDurationMinutes(parsedData.durationMinutes);
    setSections(mapImportJsonToSections(parsedData));
    setShowImportModal(false);
    setActiveSectionTab(0);
    setStep(2); // land teachers on the sections review right after import
  }

  const step1Valid = testTitle.trim().length > 0;
  const step2Valid = sections.some((s) => countSectionQuestions(s) > 0);

  function goNext() {
    setStep((s) => Math.min(3, s + 1));
  }
  function goBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  function buildPayload() {
    let cursor = 0;
    const parts = sections.map((section, si) => {
      const questionGroups = (section.questionGroups || []).map((group) => {
        const start = cursor + 1;
        const questions = (group.questions || []).map((q, qi) => ({
          questionNumber: cursor + qi + 1,
          // Not group.questionType directly — see questionGradingType's
          // doc comment: 'note-completion'/'summary-completion' are
          // layout-only group labels that questionSchema.type's enum
          // (backend/models/Test.js) correctly rejects; every question
          // still grades as a plain typed blank underneath.
          type: questionGradingType(group.questionType),
          prompt: q.prompt.trim(),
          options: group.questionType === 'multiple-choice' ? q.options.filter((o) => o.trim()) : [],
          correctAnswer: q.correctAnswer,
          wordLimit: q.wordLimit || null,
        }));
        cursor += (group.questions || []).length;
        return {
          groupInstructions: group.groupInstructions,
          questionType: group.questionType,
          // Only meaningful for note-completion/summary-completion groups
          // (see NoteCompletionGroup in TestInterface.jsx) — harmless empty
          // string for every other question type. group.layoutText is
          // authored/edited with GROUP-RELATIVE {{1}}, {{2}}, ... markers
          // (NOTE_LAYOUT_HELP) since `start` isn't known until right here —
          // toAbsoluteLayoutText rewrites them to this group's real
          // absolute numbers (start, start+1, ...) for saving, the same
          // moment every question in the test gets its final number.
          layoutText: toAbsoluteLayoutText(group.layoutText || '', start),
          // "Choose your answer from the box" matching groups — see
          // BoxMatchingRenderer.jsx/TestInterface.jsx's useBoxMatching.
          // Harmless empty array for every other question type, same
          // reasoning as layoutText above.
          wordBank: (group.wordBank || []).filter((o) => o && o.trim()),
          allowRepeatWordBankOptions: Boolean(group.allowRepeatWordBankOptions),
          // Matrix radio grid (map/plan/diagram labeling) — see
          // TestInterface.jsx's MatrixMatchingGroup. Harmless empty
          // string/array for every other question type, same reasoning as
          // wordBank above.
          mapImageUrl: group.mapImageUrl || '',
          matrixOptions: (group.matrixOptions || []).filter((o) => o && o.trim()),
          startNumber: start,
          endNumber: cursor,
          questions,
        };
      });

      return {
        partNumber: si + 1,
        title: section.title || `Part ${si + 1}`,
        instructions: section.instructions || DEFAULT_SECTION_INSTRUCTIONS,
        passageText: '',
        questionGroups,
      };
    });

    return {
      title: testTitle.trim(),
      module: 'listening',
      durationMinutes: Number(durationMinutes) || 30,
      totalQuestions: countAllQuestions(sections),
      // One shared master file for the whole test — see MasterAudioDropzone
      // above, replacing the old per-part audioUrl.
      masterAudioUrl: masterAudioUrl || '',
      parts,
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

  const activeSection = sections[activeSectionTab];

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
          not `sticky`, so it always stays visible. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-6 pb-10">
          <h1 className="mb-1 text-xl font-semibold">{isEditMode ? 'Edit Listening Test' : 'Create Listening Test'}</h1>
          <p className="mb-6 text-sm text-neutral-500">
            {isEditMode
              ? 'Update the master audio file, sections, and questions below, then save your changes.'
              : 'Build a 4-section listening test step by step, or paste AI-generated JSON to auto-populate the questions.'}
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

          {/* Step 1 — Test Details */}
          {step === 1 && (
            <div className="rounded-lg border border-neutral-200 p-5">
              {/* The single, prominent master audio upload — sits above
                  everything else in this step (per the pre-merged-audio
                  architecture: one file for the whole test, uploaded once,
                  never per section) rather than being buried per-section on
                  the Sections step the way the old 4-file system was. */}
              <MasterAudioDropzone
                audioUrl={masterAudioUrl}
                isUploading={audioUploading}
                error={audioUploadError}
                onFileSelected={handleAudioFileSelected}
                onClear={() => setMasterAudioUrl('')}
              />

              <label className="mb-1 block text-xs font-medium text-neutral-500">Test title</label>
              <input
                type="text"
                value={testTitle}
                onChange={(e) => setTestTitle(e.target.value)}
                placeholder="e.g. Cambridge 21 Test 4 — Listening"
                className="mb-4 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              <label className="mb-1 block text-xs font-medium text-neutral-500">Duration (min)</label>
              <input
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
              />

              <p className="mt-4 text-xs text-neutral-500">
                Every Listening test has 4 fixed sections (Part 1–4), all sharing the one master audio file above. Fill
                each section's questions in manually on the next step, or use{' '}
                <button onClick={() => setShowImportModal(true)} className="font-medium text-rose-600 underline underline-offset-2">
                  Import via JSON
                </button>{' '}
                (top right) to auto-populate them.
              </p>
            </div>
          )}

          {/* Step 2 — Sections (tabbed) */}
          {step === 2 && (
            <div>
              <div className="mb-4 flex gap-2">
                {sections.map((s, i) => {
                  const hasContent = countSectionQuestions(s) > 0;
                  return (
                    <button
                      key={i}
                      onClick={() => setActiveSectionTab(i)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                        activeSectionTab === i
                          ? 'border-rose-600 bg-rose-50 text-rose-700'
                          : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
                      }`}
                    >
                      Part {i + 1}
                      {hasContent && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                    </button>
                  );
                })}
              </div>

              <div className="rounded-lg border border-neutral-200 p-5">
                <div className="mb-4 flex gap-4">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-neutral-500">Section title</label>
                    <input
                      type="text"
                      value={activeSection.title}
                      onChange={(e) => updateSectionField(activeSectionTab, 'title', e.target.value)}
                      placeholder={`e.g. Part ${activeSectionTab + 1} — Accommodation Booking`}
                      className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <label className="mb-1 block text-xs font-medium text-neutral-500">Section instructions</label>
                <textarea
                  value={activeSection.instructions}
                  onChange={(e) => updateSectionField(activeSectionTab, 'instructions', e.target.value)}
                  rows={2}
                  className="mb-5 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
                />

                <h3 className="mb-3 text-sm font-semibold text-neutral-800">Question groups</h3>
                {activeSection.questionGroups.length === 0 && (
                  <p className="mb-3 text-xs text-neutral-400">No question groups yet — add one below.</p>
                )}
                {activeSection.questionGroups.map((group, gi) => (
                  <QuestionGroupBuilder
                    key={gi}
                    group={group}
                    onChange={(updated) => updateGroup(activeSectionTab, gi, updated)}
                    onRemove={() => removeGroup(activeSectionTab, gi)}
                    apiBase={apiBase}
                  />
                ))}

                <button
                  onClick={() => addGroup(activeSectionTab)}
                  className="rounded border border-dashed border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
                >
                  + Add question group
                </button>
              </div>
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
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">Master audio</p>
                    <p className="text-sm text-neutral-800">
                      {masterAudioUrl ? (
                        '🎧 Uploaded'
                      ) : (
                        <span className="text-amber-600">Not uploaded yet — go back to Test Details to add it.</span>
                      )}
                    </p>
                  </div>

                  <div className="mb-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                      {countAllQuestions(sections)} question{countAllQuestions(sections) === 1 ? '' : 's'} across{' '}
                      {sections.filter((s) => countSectionQuestions(s) > 0).length} of {SECTION_COUNT} sections
                    </p>
                    <ul className="mt-1 space-y-1 text-sm text-neutral-700">
                      {sections.map((s, i) => (
                        <li key={i}>
                          <span className="font-medium">{s.title || `Part ${i + 1}`}</span>
                          {' — '}
                          {countSectionQuestions(s)} question{countSectionQuestions(s) === 1 ? '' : 's'}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {!step2Valid && (
                    <p className="mt-3 text-sm text-amber-600">Add at least one question before saving.</p>
                  )}
                  {saveError && <p className="mt-3 text-sm text-rose-600">{saveError}</p>}
                </>
              ) : (
                <>
                  <div className="mb-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                    ✅ "{savedTest.title}" {isEditMode ? 'updated' : 'saved as a draft'}.
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
              disabled={step === 1 && !step1Valid}
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
              {isSaving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Save Listening Test'}
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
