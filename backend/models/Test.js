const mongoose = require('mongoose');
const { Schema } = mongoose;

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
        'short-answer',
      ],
      required: true,
    },
    prompt: { type: String, required: true }, // the statement/question text
    options: [{ type: String }], // choice text, empty for fill-in-the-blank/short-answer
    correctAnswer: { type: Schema.Types.Mixed, required: true }, // String | String[]
    wordLimit: { type: String, default: null }, // e.g. "ONE WORD ONLY", "NO MORE THAN TWO WORDS"
  },
  { _id: false }
);

/**
 * A question group shares one instruction block on the right pane,
 * e.g. "Questions 1–6: Choose TRUE/FALSE/NOT GIVEN".
 */
const questionGroupSchema = new Schema(
  {
    groupInstructions: { type: String, required: true },
    questionType: { type: String, required: true }, // mirrors questionSchema.type, shown once per group
    startNumber: { type: Number, required: true },
    endNumber: { type: Number, required: true },
    questions: [questionSchema],
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
    passageText: { type: String, default: '' },

    // Listening: audio source, transcript kept hidden from students.
    audioUrl: { type: String, default: '' },
    transcript: { type: String, default: '' },

    questionGroups: [questionGroupSchema],
  },
  { _id: false }
);

const testSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    module: { type: String, enum: ['reading', 'listening'], required: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    durationMinutes: { type: Number, required: true, default: 60 },
    totalQuestions: { type: Number, required: true, default: 40 },

    parts: [partSchema],

    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true }
);

testSchema.index({ createdBy: 1, module: 1 });

module.exports = mongoose.model('Test', testSchema);
