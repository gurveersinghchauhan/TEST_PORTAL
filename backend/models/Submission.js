const mongoose = require('mongoose');
const { Schema } = mongoose;

const answerSchema = new Schema(
  {
    questionNumber: { type: Number, required: true },
    studentAnswer: { type: Schema.Types.Mixed, default: null }, // String | String[] | null (unanswered)
    correctAnswer: { type: Schema.Types.Mixed, required: true },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: false }
);

const submissionSchema = new Schema(
  {
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalized so a teacher's dashboard can query submissions directly
    // without joining through the student record.
    teacher: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    test: { type: Schema.Types.ObjectId, ref: 'Test', required: true },
    module: { type: String, enum: ['reading', 'listening'], required: true },

    answers: [answerSchema],

    score: { type: Number, default: 0 }, // raw correct count
    totalQuestions: { type: Number, required: true },
    bandScore: { type: Number, default: null }, // optional, filled in if using a raw->band conversion table

    status: {
      type: String,
      enum: ['in-progress', 'submitted', 'graded'],
      default: 'in-progress',
    },

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    timeTakenSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

submissionSchema.index({ student: 1, test: 1 });
submissionSchema.index({ teacher: 1, module: 1 });

module.exports = mongoose.model('Submission', submissionSchema);
