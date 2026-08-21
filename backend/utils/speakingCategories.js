'use strict';

/**
 * speakingCategories.js
 * ---------------------
 * The 16 fixed IELTS Speaking Part 2 cue-card "major categories" a Speaking
 * Test DOCUMENT (not individual questions/parts) can be classified under —
 * see backend/models/Test.js's testSchema.speakingCategory. Deliberately
 * flat, no subcategories.
 *
 * Every Speaking test MUST carry an explicit category chosen from this
 * exact list of strings — there is no automatic keyword-based
 * classification anymore. The category comes from either the Test
 * Builder's dropdown or an "Import via JSON" payload's own "category"
 * field (see SpeakingTestWizard.jsx's MASTER_AI_PROMPT, which instructs
 * the AI to emit exactly one of these 16 strings verbatim, and
 * validateSpeakingImportJson, which rejects anything else before it's
 * even sent to the backend). routes/testUpload.js's resolveSpeakingCategory
 * validates the incoming value against this list before saving, and
 * backend/models/Test.js's testSchema.speakingCategory enum rejects
 * anything else at the schema level too — the two guardrails intentionally
 * overlap so a bad value can never slip through either path.
 *
 * This order is also the canonical display order, and is mirrored EXACTLY
 * (same strings, same order) in frontend/src/speakingCategories.js for the
 * Test Builder dropdown and the Practice Tests category filter. Keep both
 * lists in sync if this ever changes.
 */
const SPEAKING_CATEGORIES = [
  'People',
  'Places',
  'Experiences & Events',
  'Objects',
  'Media & Technology',
  'Health & Body',
  'Education & Learning',
  'Work & Business',
  'Nature & Environment',
  'Society & Culture',
  'Travel & Transport',
  'Food & Diet',
  'Hobbies & Leisure',
  'Feelings & Emotions',
  'Art & Design',
  'Sports & Competition',
];

module.exports = {
  SPEAKING_CATEGORIES,
};
