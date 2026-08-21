import { useMemo } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';

/**
 * BoxMatchingRenderer
 * --------------------
 * Cambridge/Engnovate-style matching task: a two-column, side-by-side
 * layout. LEFT column lists each numbered statement paired with a dashed
 * rectangular drop target; RIGHT column is a sticky box holding every
 * lettered option (A, B, C, ...), draggable onto any target, with a
 * click-to-assign fallback (click an option, then click a target — or vice
 * versa) for touch/mobile. Options stay visible in the box the whole time;
 * a placed one shows a small "In use" badge instead of disappearing, so a
 * student can always see the full option list while deciding.
 *
 * Shared by BOTH modules identically: TestInterface.jsx's QuestionGroupBody
 * routes any group whose questionType is a matching/box-selection type AND
 * that actually carries wordBank options here, for Reading and Listening
 * alike — no module check anywhere in this file or in that routing.
 *
 * This reuses TestInterface.jsx's EXISTING drag-and-drop machinery rather
 * than inventing a parallel one: `wb` (passed down from the top-level
 * TestInterface component — see its placements/chipRegistry/handleDragEnd)
 * already generically supports any group-level renderer that wants
 * draggable "chips" dropped into numbered "slots"; NoteCompletionGroup and
 * TableCompletionGroup already lean on the exact same object for their
 * inline blanks. Concretely:
 *   - Every option here is draggable with id `wb-chip-${gi}-${oi}` (oi =
 *     this option's RAW index in group.wordBank, matching exactly how
 *     TestInterface's own chipRegistry indexes it — see the comment on
 *     optionEntries below for why that index can't just be the option's
 *     on-screen position).
 *   - Every drop target is droppable with id `wbslot-${questionNumber}`,
 *     the same convention TestInterface.jsx's handleDragEnd already
 *     recognizes for ANY word-bank slot, regardless of which component
 *     rendered it.
 * Because of that, TestInterface.jsx needs zero changes to its state logic
 * for this component to fully participate in the same DndContext (dnd-kit
 * hooks work through React context, not module boundaries) — only
 * QuestionGroupBody's routing needed to hand this component `wb`/`gi`
 * instead of `answers`/`onAnswerChange`.
 *
 * Grading is untouched: the value stored per question (wb.resolvedPlacements
 * resolves a placement back to plain TEXT, never a drag id or letter) still
 * has to exactly match one entry in wordBank, exactly as before.
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function letterFor(index) {
  return LETTERS[index] || `#${index + 1}`;
}

// Same normalize-and-compare semantics as TestInterface.jsx's own
// formatCorrectAnswer/isAnswerCorrect (case/whitespace-insensitive; array
// answers compare as sets) — kept as a local copy rather than a shared
// import so this component has no dependency on TestInterface.jsx's own
// module (only on the real @dnd-kit/core package) and stays genuinely
// portable, per the file doc comment above.
function formatCorrectAnswer(correctAnswer) {
  if (Array.isArray(correctAnswer)) return correctAnswer.filter((v) => v != null && v !== '').join(', ');
  return correctAnswer == null ? '' : String(correctAnswer);
}
function isAnswerCorrect(given, expected) {
  if (expected == null || (Array.isArray(expected) && expected.length === 0)) return null;
  const norm = (v) => (v == null ? '' : String(v).trim().toLowerCase());
  if (Array.isArray(expected)) {
    const givenArr = Array.isArray(given) ? given : given != null && given !== '' ? [given] : [];
    const expectedSet = new Set(expected.map(norm));
    const givenSet = new Set(givenArr.map(norm));
    return expectedSet.size === givenSet.size && [...expectedSet].every((v) => givenSet.has(v));
  }
  return norm(given) === norm(expected);
}

/** One draggable/clickable option card in the right-hand options box. */
function MatchingOptionCard({ id, letter, text, isPlaced, isSelected, disabled, onClick, theme }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  // Some groups get mislabeled/misauthored as this "options box" type when
  // what they actually are is a plain letter-grid (map/diagram labeling —
  // TestInterface.jsx's MatrixMatchingGroup is the correct renderer for
  // those). When that happens, group.wordBank ends up holding bare letters
  // ("A", "B", "C"...) as its option TEXT, and this card would then show
  // the auto-assigned letter badge right next to that same letter as the
  // option text — a redundant "A A", "B B". Guard against it here so this
  // component degrades gracefully even on legacy/mislabeled data, rather
  // than fixing the authoring gap being the only thing standing between a
  // teacher and a visibly broken option list.
  const isRedundantLetterText = text && text.trim().toUpperCase() === String(letter).toUpperCase();

  return (
    <button
      type="button"
      ref={disabled ? undefined : setNodeRef}
      style={style}
      onClick={() => !disabled && onClick?.(id)}
      disabled={disabled}
      {...(disabled ? {} : { ...listeners, ...attributes })}
      title={disabled ? undefined : isSelected ? 'Click to deselect' : 'Drag onto a question, or click then click a question'}
      className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm shadow-sm transition ${
        isSelected
          ? 'border-blue-500 bg-blue-50 text-blue-900 ring-2 ring-blue-300'
          : isPlaced
          ? `${theme.subtleBorder} ${theme.subtleBg} ${theme.mutedText}`
          : `${theme.chipBorder} ${theme.chipBg} ${theme.chipText} hover:shadow`
      } ${disabled ? 'cursor-default opacity-70' : 'cursor-grab active:cursor-grabbing'} ${isDragging ? 'opacity-30' : ''}`}
    >
      <span className={`shrink-0 font-bold ${isSelected ? 'text-blue-700' : theme.strongText}`}>{letter}</span>
      {!isRedundantLetterText && <span className="min-w-0 flex-1 break-words">{text}</span>}
      {isPlaced && (
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${theme.subtleBorder} ${theme.faintText}`}>
          In use
        </span>
      )}
    </button>
  );
}

/** One dashed drop-target box in the left column, next to its statement. */
function MatchingDropTarget({ questionNumber, placedText, hasSelection, onClick, disabled, theme }) {
  const { setNodeRef, isOver } = useDroppable({ id: `wbslot-${questionNumber}`, disabled });
  const filled = placedText != null && placedText !== '';

  return (
    <button
      type="button"
      ref={setNodeRef}
      disabled={disabled}
      onClick={() => onClick?.(questionNumber)}
      title={
        disabled
          ? undefined
          : filled
          ? 'Click to remove'
          : hasSelection
          ? 'Click to place the selected option here'
          : 'Drag an option here, or click an option then click here'
      }
      className={`flex h-10 w-full min-w-[9rem] shrink-0 items-center justify-between gap-2 rounded-md border-2 px-3 text-sm font-medium transition sm:w-44 ${
        disabled
          ? `cursor-default border-dashed ${theme.inputDisabledBg} ${theme.inputDisabledText} ${theme.inputBorder}`
          : isOver
          ? 'border-solid border-blue-600 bg-blue-50 text-neutral-900'
          : filled
          ? `border-solid ${theme.inputBorder} ${theme.inputBg} ${theme.inputText}`
          : 'border-dashed border-blue-600 bg-transparent text-blue-600/70'
      }`}
    >
      {filled ? (
        <>
          <span className="truncate">{placedText}</span>
          {!disabled && <span className={`shrink-0 ${theme.faintText}`}>✕</span>}
        </>
      ) : (
        <span className="italic">{disabled ? 'no answer' : 'Drop answer here'}</span>
      )}
    </button>
  );
}

export default function BoxMatchingRenderer({ group, gi, wb, answers, previewMode = false, reviewMode = false, theme }) {
  // group.wordBank may contain a stray blank line mid-edit (the teacher
  // textarea stores exactly what was typed) — skipped from display/lettering,
  // but `oi` below is still each option's RAW index in the ORIGINAL array,
  // because that's what TestInterface.jsx's own chipRegistry indexes by
  // (see backend/models/Test.js's wordBank + TestInterface's
  // wordBankChipsByGroup) — using a compacted index here instead would
  // generate drag ids that don't match the ids chipRegistry actually
  // registered, silently breaking every drag/click placement.
  const optionEntries = useMemo(
    () => (group.wordBank || []).map((text, oi) => ({ text, oi })).filter((o) => o.text && o.text.trim()),
    [group.wordBank]
  );

  const questionNumbers = useMemo(() => (group.questions || []).map((q) => q.questionNumber), [group.questions]);

  // Which option TEXT is currently placed somewhere in THIS group (for the
  // right-hand box's "In use" badge) — resolvedPlacements is part-wide, so
  // this is scoped to just this group's own question numbers.
  const placedTexts = useMemo(() => {
    const set = new Set();
    questionNumbers.forEach((qn) => {
      const text = wb?.resolvedPlacements?.[qn];
      if (text) set.add(text);
    });
    return set;
  }, [wb?.resolvedPlacements, questionNumbers]);

  const allowRepeat = Boolean(group.allowRepeatWordBankOptions);

  return (
    <div className="md:flex md:items-start md:gap-6">
      {/* LEFT — statements + dashed drop targets. order-2 on mobile so the
          options box (order-1) is seen first, before scrolling into the
          statement list. */}
      <div className="order-2 min-w-0 space-y-3 md:order-1 md:flex-1">
        {(group.questions || []).map((q) => {
          const placedText = wb?.resolvedPlacements?.[q.questionNumber] ?? (reviewMode ? answers?.[q.questionNumber] : undefined);
          const isCorrect = reviewMode ? isAnswerCorrect(placedText, q.correctAnswer) : null;
          return (
            <div key={q.questionNumber} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
                <span
                  className={`flex h-6 min-w-[1.6rem] shrink-0 items-center justify-center rounded border text-xs font-bold ${theme.numberBadgeBorder} ${theme.accentBg} ${theme.accentText}`}
                >
                  {q.questionNumber}
                </span>
                <span className={`min-w-0 flex-1 text-sm leading-relaxed ${theme.pageText}`}>{q.prompt}</span>
                <MatchingDropTarget
                  questionNumber={q.questionNumber}
                  placedText={placedText}
                  hasSelection={wb?.selectedItemId != null}
                  onClick={wb?.onSlotClick}
                  disabled={reviewMode}
                  theme={theme}
                />
              </div>
              {reviewMode && (
                <p className={`ml-9 text-xs font-semibold ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {placedText || '(no answer given)'} {isCorrect ? '✓' : '✕'}
                  {!isCorrect ? ` — correct: ${formatCorrectAnswer(q.correctAnswer)}` : ''}
                </p>
              )}
              {previewMode && !reviewMode && formatCorrectAnswer(q.correctAnswer) && (
                <p className="ml-9 text-xs font-semibold text-sky-700">
                  Correct answer: <span className="font-normal">{formatCorrectAnswer(q.correctAnswer)}</span>
                </p>
              )}
              {previewMode && q.explanation && (
                <p className="ml-9 text-xs leading-snug text-sky-700">
                  <span className="font-semibold">Explanation: </span>
                  {q.explanation}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* RIGHT — sticky options box. Full width on mobile (order-1, above
          the statements); a fixed-width sticky rail on desktop. */}
      <div className="order-1 mb-4 md:order-2 md:mb-0 md:w-64 md:shrink-0 md:sticky md:top-4">
        <div className={`rounded-lg border-2 p-3 ${theme.tableBorder} ${theme.panelBg}`}>
          <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${theme.faintText}`}>Options</p>
          <div className="space-y-1.5">
            {optionEntries.map(({ text, oi }, i) => {
              const isPlaced = placedTexts.has(text);
              const disabled = reviewMode || (isPlaced && !allowRepeat);
              const id = `wb-chip-${gi}-${oi}`;
              return (
                <MatchingOptionCard
                  key={id}
                  id={id}
                  letter={letterFor(i)}
                  text={text}
                  isPlaced={isPlaced}
                  isSelected={wb?.selectedItemId === id}
                  disabled={disabled}
                  onClick={wb?.onChipClick}
                  theme={theme}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
