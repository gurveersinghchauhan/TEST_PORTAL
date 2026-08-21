const mongoose = require('mongoose');
const { Schema } = mongoose;
const { SPEAKING_CATEGORIES } = require('../utils/speakingCategories');
const { ALL_WRITING_QUESTION_TYPES, WRITING_GRAPH_SUBTYPES, validateWritingClassification } = require('../utils/writingClassification');

/**
 * A single question. `options` is only used by choice-based types.
 * `correctAnswer` is a string for single-answer types and an array
 * of strings for multi-select / multi-blank-per-question types.
 */
const questionSchema = new Schema(
  {
    questionNumber: { type: Number, required: true }, // global number, e.g. 1–40
    type: {
      type: String,
      enum: [
        'true-false-not-given',
        'yes-no-not-given',
        'multiple-choice',      // single correct option
        'multiple-select',      // choose TWO/THREE correct options
        'fill-in-the-blank',
        'matching-heading',
        'matching-information',
        'matrix-matching',      // Listening map/plan labeling: one shared option grid, radio per row
        'short-answer',
        'speaking-prompt',      // Speaking Part 1/3: spoken response, no correct answer
        'writing-task',         // Writing Task 1/2: essay/report response, no correct answer — see writingTask* below
        // 'note-completion' / 'summary-completion' are the GROUP-level
        // rendering labels (questionGroupSchema.questionType below) that
        // trigger TestInterface.jsx's rich-text/cloze NoteCompletionGroup
        // instead of one isolated line per question. The individual
        // QUESTIONS inside such a group are graded exactly like a plain
        // typed blank, so ListeningTestWizard.jsx/ReadingTestWizard.jsx
        // always save each one with type: 'fill-in-the-blank' — this field
        // should never actually hold 'note-completion'/'summary-completion'
        // in practice. They're listed here anyway as a defensive allow-list
        // entry (not the primary path) so a group-level label accidentally
        // propagated onto a question — as ListeningTestWizard.jsx's
        // QuestionGroupBuilder used to do before that bug was fixed — still
        // saves instead of the whole test failing Mongoose validation; no
        // grading logic anywhere switches on this value, so allowing it
        // here carries no grading-correctness risk.
        'note-completion',
        'summary-completion',
      ],
      required: true,
    },
    prompt: { type: String, required: true }, // the statement/question text
    options: [{ type: String }], // choice text, empty for fill-in-the-blank/short-answer/speaking-prompt
    // String | String[] for scored question types; left as '' for speaking-prompt,
    // which has no single correct answer to grade against.
    correctAnswer: { type: Schema.Types.Mixed, required: true, default: '' },
    wordLimit: { type: String, default: null }, // e.g. "ONE WORD ONLY", "NO MORE THAN TWO WORDS"
    // Plain-text answer key + explanation for teacher review. Distinct from
    // correctAnswer (used for grading, may be an array) — these are
    // free-text fields a teacher fills in/edits and that are only ever
    // displayed to teacher/institute viewers (see QuestionGroupEditor.jsx
    // and PracticeTests.jsx's QuestionPreviewView), never to students.
    answer: { type: String, default: '' },
    explanation: { type: String, default: '' },

    // --- Writing classification (QUESTION level, type === 'writing-task' only) ---
    // See backend/utils/writingClassification.js for the fixed Task 1 /
    // Task 2 type lists and the keyword classifier that auto-assigns these.
    // Deliberately QUESTION-level, not test-level — WritingTestWizard.jsx
    // saves one 'writing-task' question per part (Task 1's part, Task 2's
    // part), each carrying its own classification here. `default: null`
    // on all three is what keeps Reading/Listening/Speaking questions and
    // any Writing test saved before this feature existed completely
    // unaffected. Task 1 and Task 2 type lists are STRICTLY DISJOINT — the
    // enum below only expresses the flat union (Mongoose enums can't do
    // cross-field logic); the actual "Task 1 type can never be assigned to
    // a Task 2 question" guardrail is enforced by the pre('validate') hook
    // further down, backed by the same validateWritingClassification used
    // by routes/testUpload.js for a clean 400 before it ever reaches here.
    writingTask: { type: Number, enum: [1, 2], default: null }, // 1 or 2, mirrors the part it lives on
    writingQuestionType: { type: String, enum: ALL_WRITING_QUESTION_TYPES, default: null },
    // Applicable ONLY when writingQuestionType is 'GRAPHS' — always
    // null/omitted for PROCESS, MAPS, MIXED_CHARTS, and every Task 2 type.
    writingQuestionSubType: { type: String, enum: WRITING_GRAPH_SUBTYPES, default: null },
  },
  { _id: false }
);

// Cross-field Writing classification guardrail — runs for EVERY question
// subdocument (Reading/Listening/Speaking questions simply have all three
// writing* fields null, so hasAny is false and this is a no-op for them).
// This is the schema-level safety net; routes/testUpload.js also calls
// validateWritingClassification directly so a bad request gets a clean 400
// instead of surfacing as a raw Mongoose ValidationError.
//
// No `next` callback parameter — Mongoose 7+ removed callback-style
// middleware entirely (a hook either runs synchronously or returns a
// Promise; a declared-but-unsupplied `next` param is simply `undefined`
// at call time). Declaring one here used to throw "next is not a
// function" for every single question subdocument that ran this hook
// (i.e. every question in every part), which Mongoose then surfaced as a
// validation failure on the *array* field itself — a Speaking test's
// `parts.0.questionGroups.0.questions`, for example — even though no
// question actually had an invalid writing classification. Signaling
// failure is now just `this.invalidate(...)` + a synchronous `throw`.
questionSchema.pre('validate', function writingClassificationGuardrail() {
  const { valid, error } = validateWritingClassification({
    writingTask: this.writingTask,
    writingQuestionType: this.writingQuestionType,
    writingQuestionSubType: this.writingQuestionSubType,
  });
  if (!valid) {
    this.invalidate('writingQuestionType', error);
    throw new Error(error);
  }
});

/**
 * A question group shares one instruction block on the right pane,
 * e.g. "Questions 1–6: Choose TRUE/FALSE/NOT GIVEN".
 */
const questionGroupSchema = new Schema(
  {
    groupInstructions: { type: String, required: true },
    // Mirrors questionSchema.type for most groups, but also carries three
    // layout-only values — 'note-completion', 'summary-completion', and
    // 'table-completion' — that don't correspond to a questionSchema.type
    // on their own (each individual question underneath is still plain
    // 'fill-in-the-blank' for grading purposes — see questionSchema.type's
    // enum above). These tell the student interface (TestInterface.jsx) to
    // render layoutText/tableColumns/tableRows below instead of one
    // isolated numbered line per question. Deliberately a free string, not
    // an enum, here — unlike questionSchema.type, this field doesn't drive
    // any grading behavior, only which renderer TestInterface.jsx picks, so
    // there's nothing for the database to validate beyond "is a string".
    questionType: { type: String, required: true },
    startNumber: { type: Number, required: true },
    endNumber: { type: Number, required: true },
    questions: [questionSchema],

    // --- Note-completion / table-completion layout (below) -----------------
    // Optional; only populated when questionType is 'note-completion' or
    // 'table-completion'. These preserve the ORIGINAL note/table structure
    // from the source passage so the student interface can render it
    // authentically instead of flattening every blank into its own
    // isolated numbered line. Each blank is marked inline as "[[n]]" (n =
    // that blank's questionNumber, matching an entry in `questions` above)
    // wherever it falls within the text/cell — see TestInterface.jsx's
    // NoteCompletionGroup / TableCompletionGroup and renderTextWithBlankMarkers.

    // note-completion: the full note text, one line per paragraph or
    // bullet point. A line starting with "- " renders as a bullet; a line
    // starting with "# " renders as a bold sub-heading; anything else is a
    // plain paragraph line.
    layoutText: { type: String, default: '' },
    // table-completion: column headers, left-to-right.
    tableColumns: { type: [String], default: [] },
    // table-completion: row data — each row is an array of cell strings in
    // tableColumns order. Mixed (rather than a nested array schema type)
    // to avoid Mongoose's nested-array casting quirks.
    tableRows: { type: Schema.Types.Mixed, default: [] },

    // --- Drag-and-drop word bank (below) ------------------------------------
    // Optional shared bank of options (words/phrases/letters) for this
    // group — a Cambridge-style "Choose the correct answer from the box,
    // A-J" summary completion, or a sentence/heading matching task where
    // every question in the group is answered by dragging ONE shared
    // option into its slot, rather than typing free text or picking from
    // its own separate per-question options. When non-empty,
    // TestInterface.jsx renders every blank in this group (whether inline
    // within layoutText/tableRows above, or as a standalone question) as a
    // drag-and-drop drop-slot bound to these chips instead of a text input
    // — see WordBankChip / WordBankDropSlot there. Each question's own
    // `options` field is ignored when wordBank is set; the bank IS the
    // shared option set, and each question's `correctAnswer` must exactly
    // match one entry here.
    wordBank: { type: [String], default: [] },
    // If true, the same chip can be dragged into more than one blank (some
    // tasks explicitly allow reusing an option); if false (default), a
    // chip disappears from the bank once placed, matching Cambridge's
    // usual "each letter/word once" rule.
    allowRepeatWordBankOptions: { type: Boolean, default: false },

    // --- Matrix radio grid (below) ------------------------------------------
    // Optional; only populated when questionType is 'matrix-matching' — a
    // Listening "label the map/plan" task ("Where are the following
    // located? Choose the correct letter, A-H"). Deliberately separate
    // fields from wordBank above: this grid is answered with ONE radio
    // button per row (any row may reuse the same option — there's no
    // "each letter once" pool to draw down), not by dragging a chip out of
    // a shrinking bank, so it needs its own image + option-list fields
    // rather than reusing the drag-and-drop wordBank mechanism. See
    // TestInterface.jsx's MatrixMatchingGroup.

    // The map/plan image shown beside the grid (data URL today, same as
    // partSchema.imageUrl — no dedicated file storage/CDN wired up yet).
    mapImageUrl: { type: String, default: '' },
    // Column labels/options, left-to-right (e.g. ["A", "B", "C", "D"]).
    // Each question's correctAnswer must exactly match one entry here.
    matrixOptions: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * A "part" is one scrollable passage (Reading) or one audio track (Listening)
 * paired with its own set of question groups.
 */
const partSchema = new Schema(
  {
    partNumber: { type: Number, required: true },
    title: { type: String, default: '' },
    instructions: { type: String, default: 'Read the text and answer the questions.' },

    // Reading: the passage body (plain text or simple HTML paragraphs).
    // Speaking Part 2: the cue card TOPIC line only (e.g. "Describe a book
    // you recently read.") — see cueCardBullets below for the "You should
    // say:" points. Writing: the task prompt text.
    passageText: { type: String, default: '' },

    // Speaking Part 2 only: the "You should say:" bullet points, kept
    // separate from the topic line (passageText) so the builder and the
    // Cambridge-style preview can render the cue card as a proper boxed
    // topic + bullet list instead of one free-text blob.
    cueCardBullets: { type: [String], default: [] },

    // Listening: transcript kept hidden from students. The audio source
    // itself is NOT per-part anymore — see testSchema's masterAudioUrl
    // below for why (a single pre-merged file replaced the old 4
    // section-audio-file system).
    transcript: { type: String, default: '' },

    // Writing Task 1: the uploaded chart/graph/diagram (data URL today —
    // no dedicated file storage/CDN wired up yet, see SpeakingTestWizard.jsx's
    // sibling WritingTestWizard.jsx).
    imageUrl: { type: String, default: '' },
    // Writing: minimum word count for this task (0 = not applicable).
    wordCountTarget: { type: Number, default: 0 },

    questionGroups: [questionGroupSchema],
  },
  { _id: false }
);

const testSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    // 'speaking'/'writing' added so those Test Builder wizards can save
    // their payloads — see SpeakingTestWizard.jsx / WritingTestWizard.jsx.
    module: { type: String, enum: ['reading', 'listening', 'speaking', 'writing'], required: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // Multi-tenant isolation: which Institute (coaching center) owns this
    // test — resolved server-side from the creating user's own institute
    // link (req.user.instituteId, straight off the verified JWT — see
    // routes/testUpload.js), never taken from client input. Required as of
    // the Phase 2 schema-hardening pass — every creation route already
    // stamps this from req.user.instituteId, so making it required just
    // turns a theoretical silent-null gap into a loud validation error.
    // Any pre-existing document missing this must go through
    // scripts/migrateInstituteId.js FIRST — see that script for how.
    instituteId: { type: Schema.Types.ObjectId, ref: 'Institute', required: true, index: true },

    durationMinutes: { type: Number, required: true, default: 60 },
    totalQuestions: { type: Number, required: true, default: 40 },

    // Speaking tests only: ONE major category for the whole test document,
    // driven by Part 2's cue card theme — never per-question/per-part (see
    // utils/speakingCategories.js for the fixed 16-value list and the
    // keyword classifier that auto-assigns it). Deliberately restricted to
    // exactly those 16 values here (no extra "UNCATEGORIZED" enum member) so
    // this stays a strict allow-list at the schema level; `default: null`
    // is what lets Reading/Listening/Writing tests and any Speaking test
    // saved before this field existed keep working untouched — routes and
    // the frontend treat a null/missing value as "Uncategorized" rather
    // than the schema ever needing to accept it as a real value.
    speakingCategory: { type: String, enum: SPEAKING_CATEGORIES, default: null },

    // Listening tests only: ONE pre-merged master audio file (mp3) covering
    // all 4 sections back-to-back, replacing the old per-part audioUrl
    // system (see partSchema above — it no longer has an audioUrl field at
    // all). Storing this at the test level rather than on parts[0] keeps
    // the "one file per test" architecture explicit in the schema itself,
    // the same way speakingCategory is a test-level field that only
    // Speaking tests populate. `default: ''` keeps every non-Listening
    // module, and any Listening test saved before this field existed,
    // working untouched.
    masterAudioUrl: { type: String, default: '' },

    parts: [partSchema],

    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true }
);

testSchema.index({ createdBy: 1, module: 1 });
// Backs the Speaking "filter by category" UI (PracticeTests.jsx) — cheap to
// add, and never touched by Reading/Listening/Writing queries.
testSchema.index({ module: 1, speakingCategory: 1 });

module.exports = mongoose.model('Test', testSchema);
