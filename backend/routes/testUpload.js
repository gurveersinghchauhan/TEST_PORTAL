const express = require('express');
const mongoose = require('mongoose');
const { uploadPdf, uploadAudio, uploadImage } = require('../middleware/upload');
const { parseReadingTestPdf } = require('../services/pdfParserService');
const Test = require('../models/Test');
const { requireAuth, requireRole } = require('../middleware/auth');
const { SPEAKING_CATEGORIES } = require('../utils/speakingCategories');
const {
  WRITING_TASK1_TYPES,
  WRITING_TASK2_TYPES,
  validateWritingClassification,
  classifyWritingTask1,
  classifyWritingTask2,
} = require('../utils/writingClassification');

const router = express.Router();

/**
 * Resolves the speakingCategory to save for a Speaking test. Now driven
 * entirely by an EXPLICIT value — the Test Builder's dropdown, or an
 * "Import via JSON" payload's own "category" field (see
 * SpeakingTestWizard.jsx's MASTER_AI_PROMPT, which now REQUIRES the AI to
 * emit exactly one of the 16 fixed categories). There is no more
 * automatic keyword-based classification from Part 2's cue-card text —
 * every Speaking test must be saved with a real, valid category.
 *
 * Returns { value, error }:
 *   - value is the resolved category to save, or `undefined` when either
 *     this isn't a Speaking test, or (PATCH only, `required: false`) no
 *     category was included in this request at all — the caller should
 *     leave whatever is already stored untouched in that case.
 *   - error is set (and value is always undefined alongside it) when an
 *     explicit value was supplied but isn't one of the 16 fixed
 *     categories, or when `required: true` (POST/create) and no category
 *     was supplied at all — the caller should reject the whole request
 *     with a 400 rather than save anything.
 * Non-Speaking modules never get this field touched at all.
 */
function resolveSpeakingCategory(module, requestedCategory, { required = false } = {}) {
  if (module !== 'speaking') return { value: undefined, error: null };

  if (requestedCategory == null || requestedCategory === '') {
    if (required) {
      return {
        value: undefined,
        error: `speakingCategory is required for a Speaking test — choose exactly one of: ${SPEAKING_CATEGORIES.join(', ')}.`,
      };
    }
    return { value: undefined, error: null };
  }

  if (!SPEAKING_CATEGORIES.includes(requestedCategory)) {
    return {
      value: undefined,
      error: `speakingCategory must be exactly one of: ${SPEAKING_CATEGORIES.join(', ')}.`,
    };
  }

  return { value: requestedCategory, error: null };
}

/**
 * Resolves (and, on success, mutates in place) the writing classification
 * fields — writingTask/writingQuestionType/writingQuestionSubType — on
 * every 'writing-task' question nested inside ONE Writing part (Task 1's
 * part, or Task 2's part; see WritingTestWizard.jsx's buildPayload, which
 * saves exactly one such question per part alongside the task prompt
 * already on part.passageText). Classification lives at the QUESTION
 * level, per the product requirement — never on the test document.
 *
 * Priority, mirroring resolveSpeakingCategory's shape:
 *   1. An explicit writingQuestionType (from the Test Builder's dropdown,
 *      or an "Import via JSON" payload that included one) is validated
 *      AS-IS via validateWritingClassification and used verbatim on
 *      success — this is what makes cross-assignment (e.g. a Task 1
 *      question explicitly set to "OPINION") a hard, immediate rejection
 *      rather than something silently auto-corrected away.
 *   2. Otherwise (dropdown left on "Auto-detect", or JSON import didn't
 *      include a type) the Task 1/Task 2 prompt text (part.passageText) is
 *      analyzed and the best-matching type — and, for GRAPHS, subtype — is
 *      assigned automatically.
 * Returns { error } — non-null only when an EXPLICIT value was invalid;
 * the caller should reject the whole request with a 400 in that case
 * rather than partially saving.
 */
function resolveWritingPartClassification(part) {
  if (!part || (part.partNumber !== 1 && part.partNumber !== 2)) return { error: null };
  const taskNum = part.partNumber;
  const groups = Array.isArray(part.questionGroups) ? part.questionGroups : [];

  for (const group of groups) {
    const questions = Array.isArray(group.questions) ? group.questions : [];
    for (const q of questions) {
      if (!q || q.type !== 'writing-task') continue;

      // A question's writingTask must always match the Task (part) it's
      // nested under — the "which part is this in" half of the never-cross
      // guardrail; validateWritingClassification below covers the other
      // half (the TYPE must belong to that task).
      if (q.writingTask != null && q.writingTask !== taskNum) {
        return { error: `This question is inside the Task ${taskNum} part but is classified as writingTask ${q.writingTask}.` };
      }

      const explicitType = q.writingQuestionType || null;
      const explicitSubType = q.writingQuestionSubType || null;

      if (explicitType) {
        // Something was picked explicitly — validate exactly as given and
        // reject outright on any mismatch. Never silently auto-correct a
        // value a teacher (or imported JSON) actually chose.
        const check = validateWritingClassification({
          writingTask: taskNum,
          writingQuestionType: explicitType,
          writingQuestionSubType: explicitSubType,
        });
        if (!check.valid) return { error: check.error };

        q.writingTask = taskNum;
        q.writingQuestionType = explicitType;
        q.writingQuestionSubType =
          explicitType === 'GRAPHS' ? explicitSubType || classifyWritingTask1(part.passageText).writingQuestionSubType : null;
        continue;
      }

      // Nothing explicit — auto-classify from the task prompt text.
      if (taskNum === 1) {
        const auto = classifyWritingTask1(part.passageText);
        q.writingTask = 1;
        q.writingQuestionType = auto.writingQuestionType;
        q.writingQuestionSubType = auto.writingQuestionSubType;
      } else {
        q.writingTask = 2;
        q.writingQuestionType = classifyWritingTask2(part.passageText);
        q.writingQuestionSubType = null;
      }
    }
  }
  return { error: null };
}

/**
 * Runs resolveWritingPartClassification over every part of a Writing
 * test's `parts` array. Returns the first error encountered (or null) so
 * the route can return a clean 400 before ever touching the database.
 * No-op (returns null immediately) for every other module.
 */
function resolveWritingClassification(module, parts) {
  if (module !== 'writing' || !Array.isArray(parts)) return null;
  for (const part of parts) {
    const { error } = resolveWritingPartClassification(part);
    if (error) return error;
  }
  return null;
}

/**
 * GET /api/tests
 * Fetches every test belonging to the caller's own institute tenant — an
 * institute/teacher sees their own drafts and published tests, a student
 * sees the same set (nothing here filters by isPublished; that's an
 * existing, separate gap unrelated to tenant isolation). requireAuth
 * guarantees req.user.instituteId is always present for any authenticated
 * caller, so this is a strict filter, not a fallback: no instituteId means
 * no tests, never "show everything."
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    if (!req.user.instituteId) {
      return res.json([]);
    }

    const tests = await Test.find({ instituteId: req.user.instituteId }).sort({ createdAt: -1 });
    res.json(tests);
  } catch (err) {
    console.error('Failed to fetch tests:', err);
    res.status(500).json({ error: 'Failed to fetch tests.' });
  }
});

/**
 * GET /api/tests/:id
 * Fetches ONE full test document (parts, question groups, everything) by
 * id — added for the LIVE TEST flow: a student who taps "Join" on an
 * incoming_live_test prompt only has { testId, testTitle, module } from
 * that socket payload, not the full document TestInterface.jsx needs, and
 * re-fetching/filtering the whole GET /api/tests list just to find one
 * test by id would be wasteful. Same tenant scoping as the list route
 * above — a valid-looking id from another institute simply 404s, same as
 * it not existing.
 */
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ error: 'Test not found.' });
    }
    if (!req.user.instituteId) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    const test = await Test.findOne({ _id: req.params.id, instituteId: req.user.instituteId });
    if (!test) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    res.json(test);
  } catch (err) {
    console.error('Failed to fetch test:', err);
    res.status(500).json({ error: 'Failed to fetch test.' });
  }
});

/**
 * POST /api/tests
 * ----------------
 * Manual (non-PDF) draft creation — used by builders that collect their
 * content through a form instead of parsing a document, e.g. the Speaking
 * Test wizard (Part 1 / Cue Card / Part 3). Saves as an UNPUBLISHED draft,
 * same as upload-pdf, so the teacher still explicitly publishes it via
 * POST /api/tests/:id/publish before students can see it.
 */
router.post('/', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const { title, module, durationMinutes, totalQuestions, parts, speakingCategory, masterAudioUrl } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'title is required.' });
    }
    if (!module) {
      return res.status(400).json({ error: 'module is required.' });
    }
    if (!req.user.instituteId) {
      return res.status(400).json({
        error: 'Your account is not linked to an institute tenant. Please log out and back in, then try again.',
      });
    }

    // Speaking-only: a category is REQUIRED to create a Speaking test now
    // (no more auto-classification fallback) — reject before anything is
    // saved rather than creating a draft with no category at all.
    const { value: resolvedSpeakingCategory, error: speakingCategoryError } = resolveSpeakingCategory(
      module,
      speakingCategory,
      { required: true }
    );
    if (speakingCategoryError) {
      return res.status(400).json({ error: speakingCategoryError });
    }

    // Writing-only: classify (or validate an explicit pick for) every
    // 'writing-task' question's Task 1/Task 2 type before anything is
    // saved — a bad explicit cross-assignment (e.g. Task 1 + "OPINION")
    // must reject the whole request, not save a half-broken test.
    const writingClassificationError = resolveWritingClassification(module, parts);
    if (writingClassificationError) {
      return res.status(400).json({ error: writingClassificationError });
    }

    const draft = await Test.create({
      title: String(title).trim(),
      module,
      durationMinutes: durationMinutes || 60,
      totalQuestions: totalQuestions ?? 0,
      parts: parts || [],
      ...(resolvedSpeakingCategory !== undefined ? { speakingCategory: resolvedSpeakingCategory } : {}),
      // Only Listening ever sends this (see ListeningTestWizard.jsx's
      // buildPayload) — harmless default '' for every other module, same
      // pattern as speakingCategory above being Speaking-only.
      masterAudioUrl: masterAudioUrl || '',
      createdBy: req.user.id,
      instituteId: req.user.instituteId,
      isPublished: false,
    });

    res.status(201).json({ testId: draft._id, test: draft });
  } catch (err) {
    console.error('Manual test create failed:', err);
    res.status(500).json({ error: err.message || 'Failed to create test.' });
  }
});

/**
 * POST /api/tests/upload-pdf
 * ---------------------------
 * Accepts a single PDF ('file'), parses it into the Test schema shape,
 * and saves it as an UNPUBLISHED draft. Returns the full draft so the
 * frontend can render the review/edit screen — nothing is visible to
 * students until the teacher explicitly hits "Publish Test"
 * (POST /api/tests/:id/publish).
 */
router.post(
  '/upload-pdf',
  requireAuth,
  requireRole('teacher', 'institute'),
  uploadPdf.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Expected a "file" field with a PDF.' });
      }
      if (!req.user.instituteId) {
        return res.status(400).json({
          error: 'Your account is not linked to an institute tenant. Please log out and back in, then try again.',
        });
      }

      const parsed = await parseReadingTestPdf(req.file.buffer);

      const draft = await Test.create({
        title: parsed.title,
        module: parsed.module,
        durationMinutes: parsed.durationMinutes,
        totalQuestions: parsed.totalQuestions,
        parts: parsed.parts,
        createdBy: req.user.id,
        instituteId: req.user.instituteId,
        isPublished: false,
      });

      res.status(201).json({
        testId: draft._id,
        test: draft,
        warnings: parsed.unmatchedAnswerNumbers.length
          ? [`Answer key had entries for questions [${parsed.unmatchedAnswerNumbers.join(', ')}] that couldn't be matched to extracted questions — please check these manually.`]
          : [],
      });
    } catch (err) {
      console.error('PDF parse/upload failed:', err);
      // GEMINI_API_KEY is optional (see server.js / pdfParserService.js) —
      // when it's unset, parseReadingTestPdf() fails fast with this specific
      // code so the frontend gets a clear, actionable message instead of a
      // generic parse-failure one. Teachers can still create tests by
      // pasting JSON directly (POST /api/tests), which is unaffected.
      if (err.code === 'GEMINI_UNAVAILABLE') {
        return res.status(503).json({ error: err.message });
      }
      res.status(500).json({ error: 'Failed to parse PDF. You can still build this test manually.' });
    }
  }
);

/**
 * POST /api/tests/upload-audio
 * ------------------------------
 * Accepts a single master Listening audio file ('audio', .mp3 only — see
 * middleware/upload.js's uploadAudio) and simply saves it to disk, handing
 * back the URL a teacher's ListeningTestWizard.jsx save can include as
 * `masterAudioUrl` on the actual POST /api/tests or PATCH /api/tests/:id
 * request. Deliberately does NOT touch the Test collection itself — a
 * teacher may re-upload/replace the audio several times while still
 * drafting a test (or before a test even exists yet, on first creation),
 * so "store the file" and "attach it to a test document" stay two separate
 * steps, same shape as upload-pdf handing back parsed content for the
 * wizard to review before anything is saved.
 */
router.post(
  '/upload-audio',
  requireAuth,
  requireRole('teacher', 'institute'),
  uploadAudio.single('audio'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Expected an "audio" field with an .mp3 file.' });
      }

      const url = `${req.protocol}://${req.get('host')}/uploads/audio/${req.file.filename}`;
      res.status(201).json({ url });
    } catch (err) {
      console.error('Audio upload failed:', err);
      res.status(500).json({ error: 'Failed to upload audio file.' });
    }
  }
);

/**
 * POST /api/tests/upload-image
 * ------------------------------
 * Accepts a single question-group image ('image', .png/.jpg/.jpeg only —
 * see middleware/upload.js's uploadImage) and simply saves it to disk,
 * handing back the URL a teacher's Test Builder can save into a matrix-
 * matching group's mapImageUrl field. Same "store the file, hand back the
 * URL, let the caller decide where it goes" shape as upload-audio above —
 * this route never touches the Test collection itself, so a teacher can
 * freely re-upload/replace a diagram while still drafting a question group
 * (or before the test itself has been saved at all).
 */
router.post(
  '/upload-image',
  requireAuth,
  requireRole('teacher', 'institute'),
  (req, res, next) => {
    uploadImage.single('image')(req, res, (err) => {
      // Surfaces multer's own rejection reasons (wrong file type, file too
      // large) as a clean 400 with the actual message, instead of falling
      // through to Express's default error handler (which would render an
      // HTML stack trace for what's really just a bad request).
      if (err) return res.status(400).json({ error: err.message || 'Failed to upload image.' });
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded. Expected an "image" field with a .png/.jpg/.jpeg file.' });
      }

      const url = `${req.protocol}://${req.get('host')}/uploads/images/${req.file.filename}`;
      res.status(201).json({ url });
    } catch (err) {
      console.error('Image upload failed:', err);
      res.status(500).json({ error: 'Failed to upload image file.' });
    }
  }
);

/**
 * PATCH /api/tests/:id
 * Saves teacher edits made in the review screen (still a draft). Scoped to
 * the caller's own tenant — fetched first so a teacher/institute can never
 * edit (or even discover, via a 404 vs. some other error) another
 * institute's test by guessing its id.
 */
router.patch('/:id', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const existing = await Test.findById(req.params.id).select('instituteId module');
    if (!existing || String(existing.instituteId) !== String(req.user.instituteId)) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    const updates = { ...req.body }; // { title?, durationMinutes?, parts?, speakingCategory? }
    // Tenant/ownership fields must never be reassignable through a body
    // spread — instituteId is always derived server-side from req.user
    // (see POST / and POST /upload-pdf above), never accepted from the
    // client; stripping them here closes the same trust boundary for edits,
    // not just creation. No existing caller sends either field on PATCH, so
    // this is a no-op for real traffic — pure defense in depth.
    delete updates.instituteId;
    delete updates.createdBy;

    // speakingCategory only ever applies to Speaking tests, and is only
    // ever accepted here after validation — never trusted verbatim from
    // the client — so Reading/Listening/Writing saves can never
    // accidentally pick up a stray value, and a Speaking edit that
    // doesn't touch the category dropdown leaves whatever is already
    // stored alone. Not required here (unlike POST/create): a PATCH that
    // only touches the title shouldn't be forced to re-supply a category.
    const { value: resolvedSpeakingCategory, error: speakingCategoryError } = resolveSpeakingCategory(
      existing.module,
      req.body.speakingCategory
    );
    if (speakingCategoryError) {
      return res.status(400).json({ error: speakingCategoryError });
    }
    if (resolvedSpeakingCategory !== undefined) {
      updates.speakingCategory = resolvedSpeakingCategory;
    } else {
      delete updates.speakingCategory;
    }

    // Writing-only, same guardrail as POST above — only runs when this
    // edit actually touches `parts` (e.g. WritingTestWizard always sends
    // the full parts array on save); an edit that only changes the title
    // leaves whatever classification is already stored untouched.
    const writingClassificationError = resolveWritingClassification(existing.module, req.body.parts);
    if (writingClassificationError) {
      return res.status(400).json({ error: writingClassificationError });
    }

    const updated = await Test.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { returnDocument: 'after', runValidators: true }
    );
    res.json({ test: updated });
  } catch (err) {
    console.error('Test update failed:', err);
    res.status(500).json({ error: err.message || 'Failed to save changes.' });
  }
});

/**
 * POST /api/tests/:id/publish
 * Flips isPublished — the moment students can actually see this test.
 * Same tenant-ownership check as PATCH above.
 */
router.post('/:id/publish', requireAuth, requireRole('teacher', 'institute'), async (req, res) => {
  try {
    const existing = await Test.findById(req.params.id).select('instituteId');
    if (!existing || String(existing.instituteId) !== String(req.user.instituteId)) {
      return res.status(404).json({ error: 'Test not found.' });
    }

    const test = await Test.findByIdAndUpdate(req.params.id, { isPublished: true }, { returnDocument: 'after' });
    res.json({ test });
  } catch (err) {
    console.error('Publish failed:', err);
    res.status(500).json({ error: 'Failed to publish test.' });
  }
});

module.exports = router;
