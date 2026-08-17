import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

/**
 * TestInterface
 * -------------
 * Mimics a computer-based exam layout:
 *  - Sticky top navbar (branding, timer slot, accessibility settings)
 *  - Sticky "Part" instruction banner
 *  - Split body: passage (left) / questions (right), each with its OWN
 *    independent vertical scrollbar, separated by a draggable divider
 *  - Sticky bottom pagination bar (part tabs + question number jump list)
 *
 * Props:
 *  - test: { title, module, parts: [{ partNumber, instructions, passageText, questionGroups }] }
 *  - activePartIndex, onChangePart(index)
 *  - answeredQuestionNumbers: Set<number> — drives the "answered" dot on pagination
 *  - timer: { label, status } — status: 'running'|'paused'|'time_up'|'overtime'|'submitted'.
 *    Comes straight from useExamTimer; TestInterface renders based on it but owns no timing logic itself.
 *  - onSubmitTest()
 */
export default function TestInterface({
  test,
  activePartIndex = 0,
  onChangePart = () => {},
  answeredQuestionNumbers = new Set(),
  timer = { label: '00:00', status: 'running' },
  onSubmitTest = () => {},
}) {
  const [leftWidthPct, setLeftWidthPct] = useState(50);
  const [contrast, setContrast] = useState('black-on-white'); // 'black-on-white' | 'white-on-black' | 'yellow-on-black'
  const [textSize, setTextSize] = useState('regular'); // 'regular' | 'large' | 'extra-large'
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ---- Matching-heading drag & drop state -----------------------------
  // Map<dropSlotNumber, headingId>. A "slot" is a droppable target that sits
  // above a paragraph in the left pane; a "heading" is a draggable pill that
  // starts out in the right-pane heading bank.
  const [placements, setPlacements] = useState({});
  const [activeDragHeading, setActiveDragHeading] = useState(null); // heading object currently being dragged, for the overlay

  const part = test.parts[activePartIndex];

  const headingBank = part.headingBank || [];
  const placedHeadingIds = useMemo(() => new Set(Object.values(placements)), [placements]);
  const availableHeadings = headingBank.filter((h) => !placedHeadingIds.has(h.id));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragStart = useCallback(
    (event) => {
      const heading = headingBank.find((h) => h.id === event.active.id);
      setActiveDragHeading(heading || null);
    },
    [headingBank]
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setActiveDragHeading(null);
    if (!over) return; // dropped outside any target — leave heading in the bank

    const slotNumber = Number(String(over.id).replace('slot-', ''));
    setPlacements((prev) => {
      const next = { ...prev };
      // A slot holds one heading — dropping a new one replaces the old.
      next[slotNumber] = active.id;
      return next;
    });
  }, []);

  const clearSlot = useCallback((slotNumber) => {
    setPlacements((prev) => {
      const next = { ...prev };
      delete next[slotNumber];
      return next;
    });
  }, []);

  // Feed placed slots into the pagination bar's "answered" count alongside
  // whatever the parent is tracking for radio/checkbox/text questions.
  const combinedAnsweredNumbers = useMemo(() => {
    const set = new Set(answeredQuestionNumbers);
    Object.keys(placements).forEach((n) => set.add(Number(n)));
    return set;
  }, [answeredQuestionNumbers, placements]);

  const contrastClasses = {
    'black-on-white': 'bg-white text-neutral-900',
    'white-on-black': 'bg-black text-white',
    'yellow-on-black': 'bg-black text-yellow-300',
  }[contrast];

  const textSizeClasses = {
    regular: 'text-base',
    large: 'text-lg',
    'extra-large': 'text-xl',
  }[textSize];

  return (
    <div className={`flex h-screen w-screen flex-col ${contrastClasses}`}>
      <TopNavbar
        testTitle={test.title}
        timer={timer}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        contrast={contrast}
        setContrast={setContrast}
        textSize={textSize}
        setTextSize={setTextSize}
      />

      {timer.status !== 'time_up' && (
        <PartBanner partNumber={part.partNumber} instructions={part.instructions} />
      )}

      {/*
        Crucial UI update: once the server reports 'time_up', the student
        must not be able to see the passage or questions at all — so we
        render the lockout overlay INSTEAD OF the split pane / footer,
        not on top of them. Nothing exam-content-bearing stays mounted
        visibly underneath.
      */}
      {timer.status === 'time_up' ? (
        <TimeUpOverlay />
      ) : (
        <>
          {/*
            DndContext wraps BOTH panes so a drag can start in the right pane's
            scrollable heading bank and end in the left pane's scrollable
            passage — dnd-kit tracks pointer position against droppable rects
            regardless of which scroll container each lives in, and
            auto-scrolls either container when the pointer nears its edge.
          */}
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            autoScroll
          >
            <SplitPane
              leftWidthPct={leftWidthPct}
              onResize={setLeftWidthPct}
              textSizeClasses={textSizeClasses}
              left={
                <PassagePane
                  part={part}
                  placements={placements}
                  headingBank={headingBank}
                  onClearSlot={clearSlot}
                />
              }
              right={
                <QuestionsPane
                  questionGroups={part.questionGroups}
                  headingBank={headingBank}
                  availableHeadings={availableHeadings}
                />
              }
            />

            <DragOverlay dropAnimation={{ duration: 150 }}>
              {activeDragHeading ? <HeadingPill heading={activeDragHeading} isOverlay /> : null}
            </DragOverlay>
          </DndContext>

          <BottomPagination
            parts={test.parts}
            activePartIndex={activePartIndex}
            onChangePart={onChangePart}
            answeredQuestionNumbers={combinedAnsweredNumbers}
            onSubmitTest={onSubmitTest}
          />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Time-up lockout                                                     */
/* ------------------------------------------------------------------ */

/**
 * Replaces the entire body + footer while status === 'time_up'. Deliberately
 * NOT an absolutely-positioned overlay on top of the passage/questions —
 * they're simply not rendered at all during lockout, so there's no DOM
 * for a curious student to inspect their way around.
 */
function TimeUpOverlay() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-neutral-50 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-2xl text-rose-600">
        ⏰
      </div>
      <h2 className="text-xl font-semibold text-neutral-900">Time's up!</h2>
      <p className="max-w-sm text-sm text-neutral-600">
        Please wait for your teacher. They'll either add more time, allow overtime, or submit your test
        for you — this screen will update automatically.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Top navbar                                                          */
/* ------------------------------------------------------------------ */

function TopNavbar({
  testTitle,
  timer,
  settingsOpen,
  setSettingsOpen,
  contrast,
  setContrast,
  textSize,
  setTextSize,
}) {
  return (
    <header className="relative flex h-16 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6">
      <div className="flex items-center gap-3">
        <span className="text-xl font-bold tracking-tight text-rose-600">Prep Portal</span>
        <span className="text-sm text-neutral-500">{testTitle}</span>
      </div>

      <div className="flex items-center gap-6">
        <div
          className={`rounded border px-3 py-1 font-mono text-sm tabular-nums ${
            timer.status === 'overtime'
              ? 'border-red-300 bg-red-50 text-red-600'
              : 'border-neutral-300'
          }`}
        >
          {timer.label}
          {timer.status === 'paused' && <span className="ml-2 text-xs text-neutral-400">(paused)</span>}
        </div>

        <button
          type="button"
          aria-label="Accessibility settings"
          onClick={() => setSettingsOpen((v) => !v)}
          className="rounded p-2 hover:bg-neutral-100"
        >
          <MenuIcon />
        </button>
      </div>

      {settingsOpen && (
        <SettingsPanel
          contrast={contrast}
          setContrast={setContrast}
          textSize={textSize}
          setTextSize={setTextSize}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </header>
  );
}

function SettingsPanel({ contrast, setContrast, textSize, setTextSize, onClose }) {
  const contrastOptions = [
    { id: 'black-on-white', label: 'Black on white' },
    { id: 'white-on-black', label: 'White on black' },
    { id: 'yellow-on-black', label: 'Yellow on black' },
  ];
  const textSizeOptions = [
    { id: 'regular', label: 'Regular' },
    { id: 'large', label: 'Large' },
    { id: 'extra-large', label: 'Extra large' },
  ];

  return (
    <div className="absolute right-6 top-16 z-20 w-80 rounded-md border border-neutral-200 bg-white shadow-lg">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <span className="font-medium">Options</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-800">
          ✕
        </button>
      </div>

      <div className="px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase text-neutral-500">Contrast</p>
        {contrastOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setContrast(opt.id)}
            className="flex w-full items-center justify-between rounded px-2 py-2 text-left hover:bg-neutral-50"
          >
            <span>{opt.label}</span>
            {contrast === opt.id && <CheckIcon />}
          </button>
        ))}
      </div>

      <div className="border-t border-neutral-200 px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase text-neutral-500">Text size</p>
        {textSizeOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setTextSize(opt.id)}
            className="flex w-full items-center justify-between rounded px-2 py-2 text-left hover:bg-neutral-50"
          >
            <span>{opt.label}</span>
            {textSize === opt.id && <CheckIcon />}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Part instruction banner                                             */
/* ------------------------------------------------------------------ */

function PartBanner({ partNumber, instructions }) {
  return (
    <div className="shrink-0 border-b border-neutral-200 bg-neutral-50 px-6 py-3">
      <p className="font-semibold">Part {partNumber}</p>
      <p className="text-sm text-neutral-700">{instructions}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Split pane: independent scroll + draggable divider                  */
/* ------------------------------------------------------------------ */

function SplitPane({ left, right, leftWidthPct, onResize }) {
  const containerRef = useRef(null);
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback(() => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function handleMouseMove(e) {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      onResize(Math.min(75, Math.max(25, pct))); // clamp 25%–75%
    }
    function handleMouseUp() {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onResize]);

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left pane — own scroll container, own scrollbar */}
      <div className="min-h-0 overflow-y-auto" style={{ width: `${leftWidthPct}%` }}>
        {left}
      </div>

      {/* Divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleMouseDown}
        className="group flex w-3 shrink-0 cursor-col-resize items-center justify-center bg-neutral-100 hover:bg-neutral-200"
      >
        <div className="flex h-8 w-5 items-center justify-center rounded border border-neutral-300 bg-white text-neutral-500 group-hover:text-neutral-800">
          ↔
        </div>
      </div>

      {/* Right pane — own scroll container, own scrollbar */}
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ width: `${100 - leftWidthPct}%` }}>
        {right}
      </div>
    </div>
  );
}

/**
 * PassagePane
 * -----------
 * `part.paragraphs` (new, optional) is an array of
 *   { id, text, dropSlotNumber? }
 * A paragraph with a `dropSlotNumber` gets a dashed droppable box rendered
 * above it — this is the "Match Headings" gap, mirroring the reference
 * screenshot's numbered dashed boxes above each paragraph.
 *
 * Falls back to plain `part.passageText` (no drop zones) for parts that
 * don't use matching-heading questions, so Task 1's original prop shape
 * keeps working unchanged.
 */
function PassagePane({ part, placements, headingBank, onClearSlot }) {
  if (part.paragraphs && part.paragraphs.length) {
    return (
      <article className="mx-auto max-w-2xl px-8 py-6 leading-relaxed">
        {part.paragraphs.map((para) => (
          <div key={para.id}>
            {para.dropSlotNumber != null && (
              <HeadingDropZone
                slotNumber={para.dropSlotNumber}
                placedHeadingId={placements[para.dropSlotNumber]}
                headingBank={headingBank}
                onClear={() => onClearSlot(para.dropSlotNumber)}
              />
            )}
            <p className="mb-4">{para.text}</p>
          </div>
        ))}
      </article>
    );
  }

  return (
    <article className="mx-auto max-w-2xl px-8 py-6 leading-relaxed">
      {part.passageText.split('\n\n').map((para, i) => (
        <p key={i} className="mb-4">
          {para}
        </p>
      ))}
    </article>
  );
}

/**
 * A single droppable gap in the passage. Empty state shows a dashed box
 * with the question number; once a heading is dropped, it shows the
 * heading text with a small remove control so the student can re-drag or
 * clear their answer.
 */
function HeadingDropZone({ slotNumber, placedHeadingId, headingBank, onClear }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slotNumber}` });
  const placedHeading = headingBank.find((h) => h.id === placedHeadingId);

  return (
    <div
      id={`question-${slotNumber}`}
      ref={setNodeRef}
      className={`mb-3 flex min-h-[44px] items-center justify-between rounded border-2 border-dashed px-3 py-2 text-sm transition-colors ${
        isOver
          ? 'border-rose-400 bg-rose-50'
          : placedHeading
          ? 'border-rose-300 bg-rose-50'
          : 'border-neutral-300 bg-neutral-50'
      }`}
    >
      {placedHeading ? (
        <>
          <span className="font-medium text-rose-700">
            <span className="mr-2 font-semibold">{slotNumber}</span>
            {placedHeading.text}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove heading from question ${slotNumber}`}
            className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-xs text-rose-600 hover:bg-rose-100"
          >
            ✕
          </button>
        </>
      ) : (
        <span className="text-neutral-400">
          <span className="mr-2 font-semibold text-neutral-500">{slotNumber}</span>
          Drag a heading here
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Questions pane                                                       */
/* ------------------------------------------------------------------ */

function QuestionsPane({ questionGroups, headingBank, availableHeadings }) {
  return (
    <div className="px-8 py-6">
      {headingBank.length > 0 && (
        <section className="mb-8">
          <p className="mb-1 font-semibold">List of Headings</p>
          <p className="mb-3 text-sm text-neutral-700">
            Drag each heading onto the matching gap in the passage on the left. Drag it back out, or
            press the ✕ on a placed heading, to change your answer.
          </p>
          <div className="space-y-2 rounded border border-neutral-200 bg-neutral-50 p-3">
            {availableHeadings.length === 0 ? (
              <p className="text-sm italic text-neutral-400">All headings placed.</p>
            ) : (
              availableHeadings.map((heading) => <HeadingPill key={heading.id} heading={heading} draggable />)
            )}
          </div>
        </section>
      )}

      {questionGroups.map((group, gi) => (
        <section key={gi} className="mb-8">
          <p className="mb-1 font-semibold">
            Questions {group.startNumber}
            {group.endNumber !== group.startNumber ? `–${group.endNumber}` : ''}
          </p>
          <p className="mb-4 text-sm text-neutral-700">{group.groupInstructions}</p>

          {group.questions.map((q) => (
            <QuestionItem key={q.questionNumber} question={q} />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * HeadingPill
 * -----------
 * Used in three places: as a draggable item in the bank (`draggable`),
 * as the item following the cursor in <DragOverlay> (`isOverlay`), and
 * implicitly as static text once rendered inside a HeadingDropZone.
 */
function HeadingPill({ heading, draggable = false, isOverlay = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: heading.id,
    disabled: !draggable,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      style={style}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      className={`rounded border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm ${
        draggable ? 'cursor-grab active:cursor-grabbing' : ''
      } ${isDragging ? 'opacity-30' : ''} ${isOverlay ? 'cursor-grabbing shadow-lg ring-2 ring-rose-300' : ''}`}
    >
      {heading.text}
    </div>
  );
}

function QuestionItem({ question }) {
  const { questionNumber, prompt, type, options } = question;

  return (
    <div id={`question-${questionNumber}`} className="mb-6">
      <p className="mb-2">
        <span className="mr-2 font-semibold">{questionNumber}</span>
        {prompt}
      </p>

      {['true-false-not-given', 'yes-no-not-given', 'multiple-choice'].includes(type) && (
        <div className="ml-6 space-y-1">
          {(options.length ? options : ['TRUE', 'FALSE', 'NOT GIVEN']).map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input type="radio" name={`q-${questionNumber}`} className="h-4 w-4" />
              {opt}
            </label>
          ))}
        </div>
      )}

      {type === 'multiple-select' && (
        <div className="ml-6 space-y-1">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4" />
              {opt}
            </label>
          ))}
        </div>
      )}

      {['fill-in-the-blank', 'short-answer'].includes(type) && (
        <input
          type="text"
          className="ml-6 w-56 rounded border border-neutral-300 px-2 py-1"
          placeholder={question.wordLimit || ''}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom pagination bar                                               */
/* ------------------------------------------------------------------ */

function BottomPagination({ parts, activePartIndex, onChangePart, answeredQuestionNumbers, onSubmitTest }) {
  return (
    <footer className="flex shrink-0 items-center justify-between border-t border-neutral-200 bg-white px-6 py-3">
      <div className="flex items-center gap-6">
        {parts.map((part, i) => {
          const groupNums = part.questionGroups.flatMap((g) =>
            Array.from({ length: g.endNumber - g.startNumber + 1 }, (_, k) => g.startNumber + k)
          );
          // Matching-heading gaps live on part.paragraphs rather than in a
          // questionGroups block, so fold their drop-slot numbers in too.
          const headingNums = (part.paragraphs || [])
            .map((p) => p.dropSlotNumber)
            .filter((n) => n != null);
          const nums = [...groupNums, ...headingNums].sort((a, b) => a - b);
          const answeredCount = nums.filter((n) => answeredQuestionNumbers.has(n)).length;

          return (
            <div key={part.partNumber} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChangePart(i)}
                className={`text-sm font-medium ${
                  i === activePartIndex ? 'text-rose-600' : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Part {part.partNumber}
              </button>
              <span className="text-xs text-neutral-400">
                {answeredCount} of {nums.length}
              </span>

              {i === activePartIndex && (
                <div className="ml-2 flex gap-1">
                  {nums.map((n) => (
                    <a
                      key={n}
                      href={`#question-${n}`}
                      className={`flex h-7 w-7 items-center justify-center rounded border text-xs ${
                        answeredQuestionNumbers.has(n)
                          ? 'border-rose-600 bg-rose-50 text-rose-700'
                          : 'border-neutral-300 text-neutral-600 hover:bg-neutral-50'
                      }`}
                    >
                      {n}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChangePart(Math.max(0, activePartIndex - 1))}
          className="rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-40"
          disabled={activePartIndex === 0}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => onChangePart(Math.min(parts.length - 1, activePartIndex + 1))}
          className="rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-40"
          disabled={activePartIndex === parts.length - 1}
        >
          →
        </button>
        <button
          type="button"
          onClick={onSubmitTest}
          className="ml-2 rounded bg-rose-600 px-4 py-2 font-medium text-white hover:bg-rose-700"
        >
          Submit test
        </button>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Tiny inline icons (avoids adding an icon-library dependency here)   */
/* ------------------------------------------------------------------ */

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}