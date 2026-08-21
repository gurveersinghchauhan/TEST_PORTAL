/**
 * speakingCategories.js
 * ---------------------
 * The 16 fixed IELTS Speaking Part 2 cue-card "major categories" a Speaking
 * Test document can carry (backend/models/Test.js's testSchema.
 * speakingCategory) — one per test, driven by Part 2's cue card theme, no
 * subcategories. Values here MUST exactly match
 * backend/utils/speakingCategories.js's SPEAKING_CATEGORIES (same order,
 * same strings) — this file just adds the {value, label} shape the
 * dropdown/filter UI expects (value and label are deliberately identical:
 * the backend stores this exact display string directly, no internal
 * code). Used by SpeakingTestWizard.jsx's category dropdown (required —
 * every Speaking test must have one) and PracticeTests.jsx's Speaking
 * category filter.
 */
export const SPEAKING_CATEGORY_OPTIONS = [
  { value: 'People', label: 'People' },
  { value: 'Places', label: 'Places' },
  { value: 'Experiences & Events', label: 'Experiences & Events' },
  { value: 'Objects', label: 'Objects' },
  { value: 'Media & Technology', label: 'Media & Technology' },
  { value: 'Health & Body', label: 'Health & Body' },
  { value: 'Education & Learning', label: 'Education & Learning' },
  { value: 'Work & Business', label: 'Work & Business' },
  { value: 'Nature & Environment', label: 'Nature & Environment' },
  { value: 'Society & Culture', label: 'Society & Culture' },
  { value: 'Travel & Transport', label: 'Travel & Transport' },
  { value: 'Food & Diet', label: 'Food & Diet' },
  { value: 'Hobbies & Leisure', label: 'Hobbies & Leisure' },
  { value: 'Feelings & Emotions', label: 'Feelings & Emotions' },
  { value: 'Art & Design', label: 'Art & Design' },
  { value: 'Sports & Competition', label: 'Sports & Competition' },
];

// Sentinel used by the filter UI (never sent to the backend as a value) for
// Speaking tests with no speakingCategory yet — legacy tests saved before
// this feature existed (or before this category list replaced the old
// one), or any edge case where classification genuinely couldn't run.
// Mirrors how the backend treats a null/missing/unrecognized field.
export const UNCATEGORIZED = 'UNCATEGORIZED';

export function speakingCategoryLabel(value) {
  if (!value) return 'Uncategorized';
  const found = SPEAKING_CATEGORY_OPTIONS.find((o) => o.value === value);
  return found ? found.label : 'Uncategorized';
}
