/**
 * writingClassification.js
 * -------------------------
 * IELTS Writing question-level classification options for the Test
 * Builder's dependent dropdowns (WritingTestWizard.jsx). Values here MUST
 * exactly match backend/utils/writingClassification.js's
 * WRITING_TASK1_TYPES / WRITING_TASK2_TYPES / WRITING_GRAPH_SUBTYPES (same
 * strings) — this file just adds the human-readable labels. Task 1 and
 * Task 2 type lists are strictly separate on purpose: the dropdown for one
 * task must never be able to show the other task's options.
 */

// Task 1 is strictly exclusive to these 4 types. Only GRAPHS has a
// subtype dropdown (see WRITING_GRAPH_SUBTYPE_OPTIONS below) — PROCESS and
// MAPS never prompt for a subcategory, by design.
export const WRITING_TASK1_TYPE_OPTIONS = [
  { value: 'GRAPHS', label: 'Graph(s)' },
  { value: 'MIXED_CHARTS', label: 'Mixed Charts' },
  { value: 'PROCESS', label: 'Process' },
  { value: 'MAPS', label: 'Maps' },
];

export const WRITING_GRAPH_SUBTYPE_OPTIONS = [
  { value: 'LINE', label: 'Line Graph' },
  { value: 'BAR', label: 'Bar Chart' },
  { value: 'PIE', label: 'Pie Chart' },
  { value: 'TABLE', label: 'Table' },
];

// Task 2 is strictly exclusive to these 7 types — never shown for Task 1,
// and a Task 1 type (GRAPHS/MIXED_CHARTS/PROCESS/MAPS) is never valid here.
export const WRITING_TASK2_TYPE_OPTIONS = [
  { value: 'OPINION', label: 'Opinion (Agree/Disagree)' },
  { value: 'DISCUSSION', label: 'Discussion (Both Views)' },
  { value: 'ADVANTAGES_DISADVANTAGES', label: 'Advantages & Disadvantages' },
  { value: 'PROBLEMS_SOLUTIONS', label: 'Problems & Solutions' },
  { value: 'TWO_PART_QUESTION', label: 'Two-Part Question' },
  { value: 'CAUSES_EFFECTS', label: 'Causes & Effects' },
  { value: 'POSITIVE_NEGATIVE_DEVELOPMENT', label: 'Positive or Negative Development' },
];

export function writingTypeLabel(task, value) {
  if (!value) return 'Uncategorized';
  const options = task === 1 ? WRITING_TASK1_TYPE_OPTIONS : WRITING_TASK2_TYPE_OPTIONS;
  return options.find((o) => o.value === value)?.label || value;
}

export function writingSubTypeLabel(value) {
  if (!value) return '';
  return WRITING_GRAPH_SUBTYPE_OPTIONS.find((o) => o.value === value)?.label || value;
}
