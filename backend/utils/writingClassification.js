'use strict';

/**
 * writingClassification.js
 * -------------------------
 * IELTS Writing question-level classification — QUESTION level (each Task 1
 * / Task 2 "question" carries its own `writingTask` / `writingQuestionType`
 * / `writingQuestionSubType`, not the Test document as a whole). See
 * backend/models/Test.js's questionSchema for where these fields live (the
 * same synthetic 'writing-task' question type WritingTestWizard.jsx saves
 * one of, per part, alongside the task prompt already stored on
 * partSchema.passageText).
 *
 * Task 1 and Task 2 have STRICTLY DISJOINT type lists — a Task 1 question
 * can never carry a Task 2 type and vice versa. `validateWritingClassification`
 * below is the single source of truth for that guardrail; both the API
 * routes (routes/testUpload.js, for a clean 400 before touching the DB) and
 * questionSchema's own pre('validate') hook (defense-in-depth for any other
 * write path) call into it.
 */

const WRITING_TASK1_TYPES = ['GRAPHS', 'MIXED_CHARTS', 'PROCESS', 'MAPS'];

const WRITING_TASK2_TYPES = [
  'OPINION',
  'DISCUSSION',
  'ADVANTAGES_DISADVANTAGES',
  'PROBLEMS_SOLUTIONS',
  'TWO_PART_QUESTION',
  'CAUSES_EFFECTS',
  'POSITIVE_NEGATIVE_DEVELOPMENT',
];

// Only GRAPHS carries a subtype — PROCESS, MAPS, MIXED_CHARTS and every
// Task 2 type never do (enforced by validateWritingClassification below).
const WRITING_GRAPH_SUBTYPES = ['LINE', 'BAR', 'PIE', 'TABLE'];

// Union used for the schema-level enum on questionSchema.writingQuestionType
// — deliberately just the flat union; the Task 1 vs Task 2 split is a
// cross-field rule, which a plain Mongoose `enum` can't express on its own.
const ALL_WRITING_QUESTION_TYPES = [...WRITING_TASK1_TYPES, ...WRITING_TASK2_TYPES];

/**
 * The single strict-guardrail check: is this (writingTask, writingQuestionType,
 * writingQuestionSubType) combination legal? Returns { valid, error }.
 * `error` is a human-readable message safe to show a teacher directly (used
 * both as an API 400 response and as the Mongoose ValidationError message).
 *
 * Deliberately permissive about "nothing set at all" — a Writing question
 * with no classification fields is valid (legacy/unclassified tests, or a
 * non-writing-task question that just happens to flow through here), so
 * existing tests keep working. Once ANY of the three fields is set,
 * everything must line up.
 */
function validateWritingClassification({ writingTask, writingQuestionType, writingQuestionSubType }) {
  const hasAny = writingTask != null || writingQuestionType != null || writingQuestionSubType != null;
  if (!hasAny) return { valid: true, error: null };

  if (writingTask !== 1 && writingTask !== 2) {
    return { valid: false, error: 'writingTask must be 1 or 2 when a Writing classification is set.' };
  }

  if (!writingQuestionType) {
    return { valid: false, error: `writingQuestionType is required when writingTask is set (Task ${writingTask}).` };
  }

  const allowedTypes = writingTask === 1 ? WRITING_TASK1_TYPES : WRITING_TASK2_TYPES;
  if (!allowedTypes.includes(writingQuestionType)) {
    const otherTask = writingTask === 1 ? 2 : 1;
    const belongsToOtherTask = (writingTask === 1 ? WRITING_TASK2_TYPES : WRITING_TASK1_TYPES).includes(writingQuestionType);
    return {
      valid: false,
      error: belongsToOtherTask
        ? `"${writingQuestionType}" is a Task ${otherTask} type and cannot be assigned to a Task ${writingTask} question.`
        : `"${writingQuestionType}" is not a valid Writing Task ${writingTask} type.`,
    };
  }

  if (writingQuestionSubType) {
    if (writingQuestionType !== 'GRAPHS') {
      return {
        valid: false,
        error: `writingQuestionSubType is only applicable to GRAPHS — not allowed for ${writingQuestionType}.`,
      };
    }
    if (!WRITING_GRAPH_SUBTYPES.includes(writingQuestionSubType)) {
      return { valid: false, error: `"${writingQuestionSubType}" is not a valid GRAPHS subtype.` };
    }
  }

  return { valid: true, error: null };
}

/* ---------------------------------------------------------------------- */
/* Auto-classification — simple keyword scoring over the task prompt text, */
/* same offline/synchronous approach as speakingCategories.js's classifier */
/* (no live AI call exists for Writing either — this is what makes JSON-   */
/* imported / manually-typed prompts "automatically" classified).         */
/* ---------------------------------------------------------------------- */

const TASK1_TYPE_KEYWORDS = {
  MAPS: ['map', 'maps', 'town plan', 'city plan', 'compass', 'geographical location', 'layout of the'],
  PROCESS: [
    'process', 'diagram', 'stages', 'stage', 'life cycle', 'steps involved',
    'manufactured', 'recycled', 'recycling', 'production process', 'natural process', 'how it is made',
  ],
  // Explicit combining phrases only — NOT "two charts"/"two graphs" on their
  // own, which just as often describes two charts of the SAME subtype
  // (e.g. "two pie charts below" is still GRAPHS/PIE, not mixed). The
  // stronger signal — 2+ distinct chart subtypes both present in the text —
  // is handled separately in classifyWritingTask1 below via
  // GRAPH_SUBTYPE_KEYWORDS, not here.
  MIXED_CHARTS: [
    'graph and a table', 'graph and table', 'chart and table', 'table and graph',
    'combination of charts', 'different charts', 'chart and a graph',
    'graphs and tables', 'charts and tables', 'chart and diagram',
  ],
  GRAPHS: ['graph', 'chart', 'percentage of', 'proportion of', 'trend', 'increase', 'decrease'],
};

const GRAPH_SUBTYPE_KEYWORDS = {
  LINE: ['line graph', 'line chart', 'line graphs', 'trend', 'trends over', 'over the period'],
  BAR: ['bar graph', 'bar chart', 'bar graphs', 'column graph', 'column chart'],
  PIE: ['pie chart', 'pie graph', 'pie charts', 'proportion of', 'percentage breakdown'],
  TABLE: ['table below', 'the table shows', 'table shows', 'in the table'],
};

const TASK2_TYPE_KEYWORDS = {
  OPINION: ['to what extent do you agree', 'do you agree or disagree', 'give your opinion', 'your own opinion', 'state your opinion', 'agree or disagree'],
  DISCUSSION: ['discuss both these views', 'discuss both views', 'some people think', 'other people believe', 'others believe', 'discuss both sides'],
  ADVANTAGES_DISADVANTAGES: ['advantages and disadvantages', 'advantages outweigh', 'benefits and drawbacks', 'pros and cons', 'advantages of this'],
  PROBLEMS_SOLUTIONS: ['what problems does this cause', 'what solutions', 'suggest some measures', 'suggest solutions', 'problems and solutions', 'measures can be taken', 'what problems'],
  CAUSES_EFFECTS: ['causes and effects', 'what are the causes', 'what are the effects', 'reasons and effects', 'causes of this', 'effects does this have'],
  POSITIVE_NEGATIVE_DEVELOPMENT: ['positive or negative development', 'positive or negative trend', 'positive or negative impact', 'is this a positive or negative'],
};

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bestKeywordMatch(text, keywordsByCategory, categoryOrder) {
  let best = null;
  let bestScore = 0;
  for (const category of categoryOrder) {
    const keywords = keywordsByCategory[category] || [];
    let score = 0;
    for (const kw of keywords) {
      const pattern = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i');
      if (pattern.test(text)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return { best, bestScore };
}

/**
 * Auto-classifies a Task 1 prompt. Always returns a writingQuestionType
 * (falls back to 'GRAPHS', the most common Task 1 shape, when nothing
 * matches), and a writingQuestionSubType ONLY when the type is GRAPHS
 * (falls back to 'BAR' when the type is GRAPHS but no subtype keyword
 * matched — never returned for PROCESS/MAPS/MIXED_CHARTS, per spec).
 *
 * MIXED_CHARTS is detected two ways: an explicit combining phrase (see
 * TASK1_TYPE_KEYWORDS.MIXED_CHARTS), or — the stronger signal — TWO OR MORE
 * distinct chart subtypes (line/bar/pie/table) both having keyword matches,
 * e.g. "bar chart" and "table below" both present. A prompt that just
 * mentions "two pie charts" only matches one subtype, so it correctly
 * stays GRAPHS/PIE rather than being flagged as mixed.
 */
function classifyWritingTask1(promptText) {
  const text = (promptText || '').toLowerCase();

  const subtypeScores = ['LINE', 'BAR', 'PIE', 'TABLE'].map((sub) => ({
    sub,
    score: (GRAPH_SUBTYPE_KEYWORDS[sub] || []).filter((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'i').test(text)).length,
  }));
  const distinctSubtypesMatched = subtypeScores.filter((s) => s.score > 0).length;

  // MAPS and PROCESS are checked with priority — "diagram"/"map" are
  // unambiguous signals that should win even if the prompt also happens to
  // mention "chart" in passing instructions.
  const { best, bestScore } = bestKeywordMatch(text, TASK1_TYPE_KEYWORDS, ['MAPS', 'PROCESS', 'MIXED_CHARTS', 'GRAPHS']);

  let writingQuestionType;
  if (bestScore > 0 && (best === 'MAPS' || best === 'PROCESS')) {
    writingQuestionType = best;
  } else if ((bestScore > 0 && best === 'MIXED_CHARTS') || distinctSubtypesMatched >= 2) {
    writingQuestionType = 'MIXED_CHARTS';
  } else {
    writingQuestionType = 'GRAPHS';
  }

  if (writingQuestionType !== 'GRAPHS') {
    return { writingQuestionType, writingQuestionSubType: null };
  }

  const topSubtype = subtypeScores.reduce((max, s) => (s.score > max.score ? s : max), { sub: null, score: 0 });
  return { writingQuestionType: 'GRAPHS', writingQuestionSubType: topSubtype.score > 0 ? topSubtype.sub : 'BAR' };
}

/**
 * Auto-classifies a Task 2 prompt. Always returns one of the 7 Task 2
 * types — falls back to 'TWO_PART_QUESTION' when the prompt structurally
 * looks like two distinct questions (2+ question marks) and nothing more
 * specific matched, otherwise falls back to 'OPINION' (the most common
 * Task 2 essay shape).
 */
function classifyWritingTask2(promptText) {
  const text = (promptText || '').toLowerCase();
  const categoryOrder = ['OPINION', 'DISCUSSION', 'ADVANTAGES_DISADVANTAGES', 'PROBLEMS_SOLUTIONS', 'CAUSES_EFFECTS', 'POSITIVE_NEGATIVE_DEVELOPMENT'];
  const { best, bestScore } = bestKeywordMatch(text, TASK2_TYPE_KEYWORDS, categoryOrder);
  if (bestScore > 0) return best;

  const questionMarks = (text.match(/\?/g) || []).length;
  if (questionMarks >= 2) return 'TWO_PART_QUESTION';

  return 'OPINION';
}

module.exports = {
  WRITING_TASK1_TYPES,
  WRITING_TASK2_TYPES,
  WRITING_GRAPH_SUBTYPES,
  ALL_WRITING_QUESTION_TYPES,
  validateWritingClassification,
  classifyWritingTask1,
  classifyWritingTask2,
};
