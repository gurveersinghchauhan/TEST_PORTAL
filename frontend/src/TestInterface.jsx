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
import { SpeakingPart2Pane, SpeakingPromptsPane } from './SpeakingTestView';
import BoxMatchingRenderer from './components/common/BoxMatchingRenderer';

/* -------------------------------------------------------------------------
 * Accessibility contrast theming — Inspera's "Black on white" / "White on
 * black" / "Yellow on black" exam-display modes.
 *
 * Every color-bearing className in this file is meant to come from one of
 * these three token sets rather than being hardcoded, because hardcoding is
 * exactly what broke this before: setting `bg-black text-white` ONLY on the
 * outermost wrapper did nothing for any descendant that hardcodes its own
 * opaque background (the header, footer, dropdown panel, every input) —
 * worse, elements with NO explicit text color of their own (like the old
 * settings-dropdown option labels) silently inherited the wrapper's
 * text-yellow-300 through ordinary CSS color inheritance and rendered on
 * top of that same element's hardcoded bg-white, which is precisely how you
 * get invisible yellow-on-white text. Explicit tokens on every element —
 * background AND text AND border together, every time — is what prevents
 * that class of bug instead of papering over one instance of it.
 *
 * Semi-transparent white/yellow (white/10, yellow-400/40, etc.) is used
 * deliberately for subtle chrome (dividers, hover states, muted panel
 * backgrounds) so those surfaces read as "the same black page, slightly
 * lifted" rather than a jarring flat gray box — closer to how Inspera's own
 * dark modes look than a literal gray would be.
 * ---------------------------------------------------------------------- */
// Exported so other screens that reuse Speaking's panes outside a real
// TestInterface mount (e.g. PracticeTests.jsx's teacher "Start Test
// Simulation" console — see QuestionPreviewView) can hand SpeakingPart2Pane/
// SpeakingPromptsPane a real theme object too, instead of duplicating this
// token table.
export const THEME = {
  'black-on-white': {
    pageBg: 'bg-white',
    pageText: 'text-neutral-900',
    headerBg: 'bg-white',
    headerBorder: 'border-neutral-300',
    headerMuted: 'text-neutral-600',
    headerDivider: 'bg-neutral-300',
    iconMuted: 'text-neutral-500',
    iconHover: 'hover:bg-neutral-100 hover:text-neutral-800',
    panelBg: 'bg-white',
    panelBorder: 'border-neutral-300',
    subtleBg: 'bg-neutral-50',
    subtleBorder: 'border-neutral-200',
    mutedText: 'text-neutral-700',
    faintText: 'text-neutral-400',
    strongText: 'text-neutral-900',
    dividerBg: 'bg-neutral-300',
    inputBg: 'bg-white',
    inputText: 'text-neutral-900',
    inputBorder: 'border-[#0078D4]',
    inputDisabledBg: 'bg-neutral-50',
    inputDisabledText: 'text-neutral-500',
    numberBadgeBorder: 'border-neutral-400',
    numberBadgeText: 'text-neutral-900',
    optionHoverBg: 'hover:bg-neutral-50',
    optionSelectedBg: 'bg-blue-200',
    optionSelectedText: 'text-neutral-900',
    accentText: 'text-[#0078D4]',
    accentBg: 'bg-[#eaf3fb]',
    accentBorder: 'border-[#0078D4]',
    tableHeaderBg: 'bg-neutral-100',
    tableBorder: 'border-neutral-800',
    dropdownBg: 'bg-white',
    dropdownBorder: 'border-neutral-200',
    dropdownText: 'text-neutral-900',
    dropdownMuted: 'text-neutral-500',
    dropdownHoverBg: 'hover:bg-neutral-50',
    dropdownDivider: 'border-neutral-200',
    footerBg: 'bg-white',
    footerBorder: 'border-neutral-300',
    footerText: 'text-neutral-700',
    footerMuted: 'text-neutral-400',
    chipBg: 'bg-white',
    chipBorder: 'border-neutral-800',
    chipText: 'text-neutral-800',
  },
  'white-on-black': {
    pageBg: 'bg-black',
    pageText: 'text-white',
    headerBg: 'bg-black',
    headerBorder: 'border-white/30',
    headerMuted: 'text-white/70',
    headerDivider: 'bg-white/30',
    iconMuted: 'text-white/70',
    iconHover: 'hover:bg-white/10 hover:text-white',
    panelBg: 'bg-black',
    panelBorder: 'border-white/30',
    subtleBg: 'bg-white/10',
    subtleBorder: 'border-white/20',
    mutedText: 'text-white/80',
    faintText: 'text-white/50',
    strongText: 'text-white',
    dividerBg: 'bg-white/30',
    inputBg: 'bg-black',
    inputText: 'text-white',
    inputBorder: 'border-white',
    inputDisabledBg: 'bg-white/10',
    inputDisabledText: 'text-white/50',
    numberBadgeBorder: 'border-white',
    numberBadgeText: 'text-white',
    optionHoverBg: 'hover:bg-white/10',
    optionSelectedBg: 'bg-white/20',
    optionSelectedText: 'text-white',
    accentText: 'text-white',
    accentBg: 'bg-white/10',
    accentBorder: 'border-white',
    tableHeaderBg: 'bg-white/10',
    tableBorder: 'border-white',
    dropdownBg: 'bg-black',
    dropdownBorder: 'border-white/40',
    dropdownText: 'text-white',
    dropdownMuted: 'text-white/60',
    dropdownHoverBg: 'hover:bg-white/10',
    dropdownDivider: 'border-white/30',
    footerBg: 'bg-black',
    footerBorder: 'border-white/30',
    footerText: 'text-white/90',
    footerMuted: 'text-white/50',
    chipBg: 'bg-black',
    chipBorder: 'border-white',
    chipText: 'text-white',
  },
  'yellow-on-black': {
    pageBg: 'bg-black',
    pageText: 'text-[#FFFF00]',
    headerBg: 'bg-black',
    headerBorder: 'border-yellow-400/40',
    headerMuted: 'text-yellow-300/80',
    headerDivider: 'bg-yellow-400/40',
    iconMuted: 'text-yellow-300/80',
    iconHover: 'hover:bg-yellow-400/10 hover:text-[#FFFF00]',
    panelBg: 'bg-black',
    panelBorder: 'border-yellow-400/40',
    subtleBg: 'bg-yellow-400/10',
    subtleBorder: 'border-yellow-400/30',
    mutedText: 'text-yellow-300/90',
    faintText: 'text-yellow-300/50',
    strongText: 'text-[#FFFF00]',
    dividerBg: 'bg-yellow-400/40',
    inputBg: 'bg-black',
    inputText: 'text-[#FFFF00]',
    inputBorder: 'border-[#FFFF00]',
    inputDisabledBg: 'bg-yellow-400/10',
    inputDisabledText: 'text-yellow-300/50',
    numberBadgeBorder: 'border-[#FFFF00]',
    numberBadgeText: 'text-[#FFFF00]',
    optionHoverBg: 'hover:bg-yellow-400/10',
    optionSelectedBg: 'bg-yellow-400/20',
    optionSelectedText: 'text-[#FFFF00]',
    accentText: 'text-[#FFFF00]',
    accentBg: 'bg-yellow-400/10',
    accentBorder: 'border-[#FFFF00]',
    tableHeaderBg: 'bg-yellow-400/10',
    tableBorder: 'border-yellow-400/60',
    dropdownBg: 'bg-black',
    dropdownBorder: 'border-yellow-400/50',
    dropdownText: 'text-[#FFFF00]',
    dropdownMuted: 'text-yellow-300/70',
    dropdownHoverBg: 'hover:bg-yellow-400/10',
    dropdownDivider: 'border-yellow-400/40',
    footerBg: 'bg-black',
    footerBorder: 'border-yellow-400/40',
    footerText: 'text-[#FFFF00]',
    footerMuted: 'text-yellow-300/50',
    chipBg: 'bg-black',
    chipBorder: 'border-[#FFFF00]',
    chipText: 'text-[#FFFF00]',
  },
};

// All answerable question numbers for one part (fill-blank/choice questions plus
// any heading-matching drop slots embedded in the passage), sorted ascending.
function getPartQuestionNums(part) {
  const groupNums = part.questionGroups.flatMap((g) =>
    Array.from({ length: g.endNumber - g.startNumber + 1 }, (_, k) => g.startNumber + k)
  );
  const headingNums = (part.paragraphs || [])
    .map((p) => p.dropSlotNumber)
    .filter((n) => n != null);
  return [...groupNums, ...headingNums].sort((a, b) => a - b);
}

export default function TestInterface({
  test,
  activePartIndex = 0,
  onChangePart = () => {},
  answeredQuestionNumbers = new Set(),
  timer: timerProp = { label: '00:00', status: 'running' },
  // Teacher-Controlled Centralized Audio Player (Listening LIVE TEST only)
  // — see useExamTimer.js/StudentTestPage.jsx for where these come from.
  // Both null for a standalone practice attempt AND for preview/attempt
  // mode (TestInterfaceSession.jsx never passes either), which is exactly
  // what keeps ListeningPane rendering the normal, unlocked native
  // <audio controls> everywhere except a real live-test attempt.
  liveSessionId = null,
  audioState = null,
  onSubmitTest = () => {},
  onAnswersChange = () => {},
  // 'student' (default, a real test-taking session — StudentTestPage.jsx
  // never passes this) | 'preview' | 'attempt' | 'review'. 'preview'/
  // 'attempt' are teacher-only, reached exclusively through
  // TestInterfaceSession.jsx (see PracticeTests.jsx's "Preview Test"/
  // "Attempt Test" buttons). 'review' is the student-facing counterpart —
  // StudentTestPage.jsx renders this instead of its old flat results table
  // once a standalone practice attempt comes back graded, so the student
  // reviews their OWN answers inline, in the exact same split-screen layout
  // they just took the test in, rather than being dropped onto a separate
  // summary page. All three non-default modes reuse this SAME component a
  // real student sits their test in, so nothing about the review UI can
  // drift out of sync with the real thing.
  mode = 'student',
  // review-only — see the mode doc above. `initialAnswers` is the flat
  // { questionNumber: value } map of what the student actually answered
  // (matches the internal `answers` state's own shape exactly, including
  // arrays for multi-select), used to seed `answers` below so every input
  // renders pre-filled with their real answer instead of starting blank.
  // `scoreSummary` ({ score, totalQuestions, percentage, bandScore }) feeds
  // TopNavbar's score display in place of the countdown. `onExit` is what
  // the footer's "Close Review" button calls — see BottomPagination below.
  initialAnswers = null,
  scoreSummary = null,
  onExit = () => {},
}) {
  const isPreview = mode === 'preview';
  const isAttempt = mode === 'attempt';
  const isReview = mode === 'review';

  // Preview freezes the timer completely, regardless of whatever `timer`
  // the caller passed in — a teacher reviewing questions should never see
  // a ticking countdown or risk landing on the time_up/blocked overlays
  // below. Attempt mode keeps whatever real countdown
  // TestInterfaceSession.jsx's local timer supplies (unlike preview, an
  // attempt is a genuine timed dry-run). Review has no countdown either —
  // the test is already over — but must still resolve to a 'running'-like
  // status so the main render below doesn't fall into the time_up/blocked
  // overlay branches instead of showing the reviewable split-pane content.
  const timer = isPreview ? { label: 'Preview', status: 'running' } : isReview ? { label: 'Reviewed', status: 'running' } : timerProp;

  const [leftWidthPct, setLeftWidthPct] = useState(50);
  const [contrast, setContrast] = useState('black-on-white');
  const [textSize, setTextSize] = useState('regular');
  const [settingsOpen, setSettingsOpen] = useState(false);

  // `placements` is shared by TWO drag-and-drop features on one DndContext:
  // legacy heading-into-passage slots (id "slot-N", N = a paragraph's
  // dropSlotNumber) and the newer word-bank drop-slots (id "wbslot-N", N =
  // a questionNumber) used for summary-completion word banks and
  // heading/sentence matching (see WordBankChip/WordBankDropSlot below).
  // One shared context (rather than a second nested DndContext around the
  // QuestionsPane) avoids dnd-kit's nested-context edge cases; the two
  // droppable id prefixes never collide, and a heading id can never equal
  // a chip id (see itemRegistry below), so the two features can't cross-talk.
  const [placements, setPlacements] = useState({});
  const [activeDragItem, setActiveDragItem] = useState(null); // { kind: 'heading' | 'chip', id, text }
  // Click-to-select fallback for the word-bank drag interaction (also
  // covers touch/keyboard users who can't drag): click an available chip
  // to select it, then click an empty drop-slot to place it there. Only
  // used by the new word-bank slots, not the legacy heading-in-passage ones.
  const [selectedItemId, setSelectedItemId] = useState(null);

  const part = test.parts[activePartIndex];
  // Listening renders full-width (no passage pane — there's no passage, just
  // audio) with an Inspera-style banner above every question group, instead
  // of the split-screen passage/questions layout every other module uses.
  // See ListeningPane below.
  const moduleType = test.module;

  const headingBank = part.headingBank || [];

  // Review-only: every question across every group in this part (including
  // heading/sentence-matching questions, whose answer is entered on the
  // PASSAGE side via HeadingDropZone rather than through QuestionsPane),
  // flattened into one { questionNumber: question } lookup so a review
  // annotation anywhere in the UI — including the passage's drop zones,
  // which otherwise never see a `question` object at all — can find its own
  // correctAnswer/explanation without threading the whole part down.
  const questionLookup = useMemo(() => {
    const map = {};
    part.questionGroups.forEach((group) => {
      (group.questions || []).forEach((q) => {
        map[q.questionNumber] = q;
      });
    });
    return map;
  }, [part.questionGroups]);

  // Every word-bank chip across every group in this part, keyed by a
  // stable id namespaced with the group index so it can never collide
  // with a headingBank id (whatever format that legacy data happens to use).
  const chipRegistry = useMemo(() => {
    const registry = {};
    part.questionGroups.forEach((group, gi) => {
      // Skip blank lines — the group editor's word-bank textarea stores
      // exactly what the teacher typed (including a stray blank line
      // mid-edit) so it never fights their cursor; those blanks aren't real
      // options and shouldn't become an empty draggable chip.
      (group.wordBank || []).forEach((text, oi) => {
        if (!text || !text.trim()) return;
        const id = `wb-chip-${gi}-${oi}`;
        registry[id] = { id, text, groupIndex: gi };
      });
    });
    return registry;
  }, [part.questionGroups]);

  // Combined lookup so a placed item's id (heading OR chip) resolves back
  // to its display/answer text in one place.
  const itemRegistry = useMemo(() => {
    const registry = { ...chipRegistry };
    headingBank.forEach((h) => {
      registry[h.id] = h;
    });
    return registry;
  }, [chipRegistry, headingBank]);

  const placedItemIds = useMemo(() => new Set(Object.values(placements)), [placements]);
  const availableHeadings = headingBank.filter((h) => !placedItemIds.has(h.id));

  // Available (not-yet-placed) chips per group index, respecting each
  // group's own allowRepeatWordBankOptions flag.
  const wordBankChipsByGroup = useMemo(() => {
    const map = {};
    part.questionGroups.forEach((group, gi) => {
      if (!group.wordBank || !group.wordBank.length) return;
      const allowRepeat = Boolean(group.allowRepeatWordBankOptions);
      map[gi] = group.wordBank
        .map((text, oi) => chipRegistry[`wb-chip-${gi}-${oi}`])
        .filter((chip) => chip && (allowRepeat || !placedItemIds.has(chip.id)));
    });
    return map;
  }, [part.questionGroups, chipRegistry, placedItemIds]);

  // placements resolved to actual TEXT (never the internal drag id) — this
  // is what actually gets graded, so a placed heading/chip's id must never
  // leak into the answers snapshot sent to the parent/backend.
  const resolvedPlacements = useMemo(
    () => Object.fromEntries(Object.entries(placements).map(([slot, itemId]) => [slot, itemRegistry[itemId]?.text ?? ''])),
    [placements, itemRegistry]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );

  const handleDragStart = useCallback(
    (event) => {
      const heading = headingBank.find((h) => h.id === event.active.id);
      if (heading) {
        setActiveDragItem({ kind: 'heading', ...heading });
        return;
      }
      const chip = chipRegistry[event.active.id];
      setActiveDragItem(chip ? { kind: 'chip', ...chip } : null);
    },
    [headingBank, chipRegistry]
  );

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setActiveDragItem(null);
    if (!over) return;

    const overId = String(over.id);
    const slotNumber = overId.startsWith('wbslot-')
      ? Number(overId.slice('wbslot-'.length))
      : Number(overId.replace('slot-', ''));
    setPlacements((prev) => ({ ...prev, [slotNumber]: active.id }));
    setSelectedItemId(null);
  }, []);

  const clearSlot = useCallback((slotNumber) => {
    setPlacements((prev) => {
      const next = { ...prev };
      delete next[slotNumber];
      return next;
    });
  }, []);

  // Click-to-select fallback: click a chip to select/deselect it; click an
  // empty word-bank slot to drop the selected chip in; click a filled slot
  // to clear it (a quick way to "swap" — clear, then place a different chip).
  const handleChipClick = useCallback((itemId) => {
    setSelectedItemId((prev) => (prev === itemId ? null : itemId));
  }, []);

  const handleSlotClick = useCallback(
    (questionNumber) => {
      setPlacements((prev) => {
        if (prev[questionNumber] != null) {
          const next = { ...prev };
          delete next[questionNumber];
          return next;
        }
        if (selectedItemId) {
          return { ...prev, [questionNumber]: selectedItemId };
        }
        return prev;
      });
      setSelectedItemId(null);
    },
    [selectedItemId]
  );

  // Answers for every radio/checkbox/text question, keyed by question number.
  // Radio + text store the raw value; checkbox (multi-select) stores an
  // array. Review mode seeds this from `initialAnswers` (the student's real
  // submitted answers) via the lazy initializer — a fresh TestInterface
  // mount every time StudentTestPage swaps into review, so this only ever
  // needs to run once, not re-sync on every render. Every question type
  // that reads its value straight out of `answers` (InlineBlankInput,
  // QuestionItem's radio/checkbox, MatrixMatchingGroup's radio) therefore
  // renders pre-filled with the student's real answer for free, with no
  // extra plumbing — only the word-bank drag-and-drop slots need a separate
  // fallback (see WordBankDropSlot's placedText below) since their live
  // state is keyed by internal drag ids, not by plain answer text.
  const [answers, setAnswers] = useState(() => (mode === 'review' && initialAnswers ? initialAnswers : {}));

  const setAnswer = useCallback((questionNumber, value) => {
    setAnswers((prev) => ({ ...prev, [questionNumber]: value }));
  }, []);

  const toggleMultiAnswer = useCallback((questionNumber, option) => {
    setAnswers((prev) => {
      const current = Array.isArray(prev[questionNumber]) ? prev[questionNumber] : [];
      const next = current.includes(option) ? current.filter((o) => o !== option) : [...current, option];
      return { ...prev, [questionNumber]: next };
    });
  }, []);

  const combinedAnsweredNumbers = useMemo(() => {
    const set = new Set(answeredQuestionNumbers);
    Object.keys(placements).forEach((n) => set.add(Number(n)));
    Object.entries(answers).forEach(([num, value]) => {
      const hasValue = Array.isArray(value)
        ? value.length > 0
        : typeof value === 'string'
        ? value.trim().length > 0
        : Boolean(value);
      if (hasValue) set.add(Number(num));
    });
    return set;
  }, [answeredQuestionNumbers, placements, answers]);

  // Mirror a live snapshot of every answer (regular answers + heading-matching
  // placements, merged into one { questionNumber: value } map) up to the parent
  // on every change. This lets the parent submit whatever's currently answered
  // even when submission is triggered from outside this component (a teacher's
  // force-submit), not just from the in-UI Submit button below. The callback is
  // read through a ref so an unmemoized inline prop from the parent can't turn
  // this into a render loop.
  const onAnswersChangeRef = useRef(onAnswersChange);
  useEffect(() => {
    onAnswersChangeRef.current = onAnswersChange;
  });
  useEffect(() => {
    onAnswersChangeRef.current({ ...answers, ...resolvedPlacements });
  }, [answers, resolvedPlacements]);

  // "Ghost session" fix — if this component goes away (unmounts, tab
  // closes, browser back button, hard refresh) BEFORE the student
  // submitted, tell the server so a live-test teacher's monitor can flip
  // that student to 'disconnected' instead of silently showing them as
  // still 'active'/'joined' forever. Read through a ref (same pattern as
  // onAnswersChangeRef above) so the listener is only ever registered
  // once, but always calls the LATEST timer.notifyExited — which itself is
  // a no-op if the student already legitimately submitted (see
  // useExamTimer.js's own hasSubmittedRef guard), so a normal Submit ->
  // "Test submitted" transition never gets misreported as an exit.
  const timerRef = useRef(timer);
  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);
  useEffect(() => {
    // Preview/attempt sessions (see TestInterfaceSession.jsx) have no real
    // LiveSession or useExamTimer socket behind them — there is nothing
    // for a teacher's unmount/tab-close to report, and calling
    // notifyExited on whatever plain timer object those modes pass in
    // would be a silent no-op anyway (it has no notifyExited method), so
    // skip registering the listener at all rather than relying on that.
    if (mode !== 'student') return undefined;
    function handleBeforeUnload() {
      timerRef.current?.notifyExited?.();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      timerRef.current?.notifyExited?.();
    };
  }, [mode]);

  // Exam integrity — right-click protection. Disables the browser's native
  // context menu for as long as a real student test is mounted, so a
  // right-click can't be used to Copy/Inspect/Search-the-web mid-exam.
  // Registered on `window` (not a specific ref) so it also covers
  // absolutely-positioned overlays this component renders outside its own
  // DOM subtree (FloatingQuestionNav, the DragOverlay portal, etc.) —
  // anywhere on the page counts while the test is up. Scoped to
  // mode === 'student' only: a teacher using Preview/Attempt mode
  // (TestInterfaceSession.jsx) is reviewing their own content, not sitting
  // a proctored exam, and shouldn't lose their normal right-click there.
  useEffect(() => {
    if (mode !== 'student') return undefined;
    function blockContextMenu(e) {
      e.preventDefault();
    }
    window.addEventListener('contextmenu', blockContextMenu);
    return () => window.removeEventListener('contextmenu', blockContextMenu);
  }, [mode]);

  // Flattened, ordered list of every question in the whole test (across all parts),
  // each tagged with which part it lives in — this is what the footer's arrow
  // buttons step through and what a footer number-chip click jumps to.
  const allQuestions = useMemo(
    () => test.parts.flatMap((p, partIdx) => getPartQuestionNums(p).map((num) => ({ num, partIdx }))),
    [test.parts]
  );

  const [focusedQuestionNumber, setFocusedQuestionNumber] = useState(null);

  // Whenever the active part changes (via a Part tab, or via jumpToQuestion below),
  // make sure the focused question actually belongs to it — default to the part's
  // first question if not. If jumpToQuestion already set the right number, this is a no-op.
  useEffect(() => {
    const partNums = getPartQuestionNums(part);
    setFocusedQuestionNumber((current) => (current != null && partNums.includes(current) ? current : partNums[0] ?? null));
  }, [activePartIndex, part]);

  // Smoothly scroll the focused question into view (works for both the passage pane
  // and the questions pane — scrollIntoView walks up through nested scroll containers).
  useEffect(() => {
    if (focusedQuestionNumber == null) return;
    const el = document.getElementById(`question-${focusedQuestionNumber}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusedQuestionNumber, activePartIndex]);

  const jumpToQuestion = useCallback(
    (num) => {
      const target = allQuestions.find((q) => q.num === num);
      if (!target) return;
      setFocusedQuestionNumber(num);
      if (target.partIdx !== activePartIndex) {
        onChangePart(target.partIdx);
      }
    },
    [allQuestions, activePartIndex, onChangePart]
  );

  const focusedIndex = allQuestions.findIndex((q) => q.num === focusedQuestionNumber);
  const goToAdjacentQuestion = useCallback(
    (direction) => {
      if (focusedIndex === -1) return;
      const nextIdx = Math.min(allQuestions.length - 1, Math.max(0, focusedIndex + direction));
      const next = allQuestions[nextIdx];
      if (next) jumpToQuestion(next.num);
    },
    [allQuestions, focusedIndex, jumpToQuestion]
  );

  // Every color used anywhere in this file is looked up through this one
  // object — see THEME's own doc comment above for why. `theme` is threaded
  // as a single prop down every render path that used to carry
  // previewMode/reviewMode (ListeningPane, QuestionsPane, PassagePane,
  // QuestionGroupBody and everything below it) plus directly to TopNavbar/
  // SettingsPanel and BottomPagination, which sit outside that chain.
  const theme = THEME[contrast] || THEME['black-on-white'];

  const textSizeClasses = {
    regular: 'text-base',
    large: 'text-lg',
    'extra-large': 'text-xl',
  }[textSize];

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden ${
        mode === 'student' ? 'select-none' : ''
      } ${theme.pageBg} ${theme.pageText}`}
      data-theme={contrast}
      onContextMenu={(e) => {
        // Belt-and-suspenders with the window-level 'contextmenu' listener
        // registered above — that one already covers the whole page
        // including portaled overlays (FloatingQuestionNav, DragOverlay);
        // this one additionally blocks it right at the test wrapper.
        // Same mode === 'student' scoping as that listener and the
        // select-none above: a teacher in Preview/Attempt mode
        // (TestInterfaceSession) is reviewing their own content, not
        // sitting a proctored exam, and keeps normal right-click/text
        // selection there.
        if (mode === 'student') e.preventDefault();
      }}
    >
      <TopNavbar
        testTitle={test.title}
        timer={timer}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        contrast={contrast}
        setContrast={setContrast}
        textSize={textSize}
        setTextSize={setTextSize}
        theme={theme}
        modeLabel={isPreview ? 'Preview' : isAttempt ? 'Attempt · not saved' : isReview ? 'Review' : null}
        // Only set in review mode — see TopNavbar's own doc comment for how
        // this replaces the countdown clock with the student's actual
        // score/percentage/band, right where the timer used to sit.
        scoreSummary={isReview ? scoreSummary : null}
      />

      {timer.status !== 'time_up' && timer.status !== 'blocked' && moduleType !== 'listening' && (
        <PartBanner partNumber={part.partNumber} instructions={part.instructions} theme={theme} />
      )}

      {timer.status === 'time_up' ? (
        <TimeUpOverlay theme={theme} />
      ) : timer.status === 'blocked' ? (
        <BlockedOverlay theme={theme} />
      ) : (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="relative flex flex-1 min-h-0 overflow-hidden">
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              autoScroll
            >
              {moduleType === 'listening' ? (
                <ListeningPane
                  part={part}
                  masterAudioUrl={test.masterAudioUrl}
                  answers={answers}
                  onAnswerChange={setAnswer}
                  onToggleMultiAnswer={toggleMultiAnswer}
                  wordBankChipsByGroup={wordBankChipsByGroup}
                  resolvedPlacements={resolvedPlacements}
                  selectedItemId={selectedItemId}
                  onChipClick={handleChipClick}
                  onSlotClick={handleSlotClick}
                  previewMode={isPreview || isReview}
                  reviewMode={isReview}
                  liveSessionId={liveSessionId}
                  audioState={audioState}
                  theme={theme}
                />
              ) : moduleType === 'speaking' ? (
                // Speaking has no passage/split-pane layout at all — Part 2
                // is the official cue-card + prep/speak timer flow (see
                // SpeakingTestView.jsx); Parts 1 & 3 are a plain read-only
                // interview/discussion prompt list (nothing to type, no
                // timing rules of their own).
                part.partNumber === 2 ? (
                  <SpeakingPart2Pane part={part} theme={theme} />
                ) : (
                  <SpeakingPromptsPane part={part} theme={theme} />
                )
              ) : (
                <SplitPane
                  leftWidthPct={leftWidthPct}
                  onResize={setLeftWidthPct}
                  textSizeClasses={textSizeClasses}
                  theme={theme}
                  left={
                    <PassagePane
                      part={part}
                      placements={placements}
                      headingBank={headingBank}
                      onClearSlot={clearSlot}
                      reviewMode={isReview}
                      answers={answers}
                      questionLookup={questionLookup}
                      theme={theme}
                    />
                  }
                  right={
                    <QuestionsPane
                      questionGroups={part.questionGroups}
                      headingBank={headingBank}
                      availableHeadings={availableHeadings}
                      answers={answers}
                      onAnswerChange={setAnswer}
                      onToggleMultiAnswer={toggleMultiAnswer}
                      wordBankChipsByGroup={wordBankChipsByGroup}
                      resolvedPlacements={resolvedPlacements}
                      selectedItemId={selectedItemId}
                      onChipClick={handleChipClick}
                      onSlotClick={handleSlotClick}
                      previewMode={isPreview || isReview}
                      reviewMode={isReview}
                      theme={theme}
                    />
                  }
                />
              )}

              <DragOverlay dropAnimation={{ duration: 150 }}>
                {activeDragItem?.kind === 'heading' && <HeadingPill heading={activeDragItem} isOverlay theme={theme} />}
                {activeDragItem?.kind === 'chip' && <WordBankChip chip={activeDragItem} isOverlay theme={theme} />}
              </DragOverlay>
            </DndContext>

            {/* Anchored to the bottom-right corner of the content area, just above the
                footer — fixed in place regardless of scroll, matching the Inspera reference
                (it does NOT float mid-screen). */}
            <FloatingQuestionNav
              onPrev={() => goToAdjacentQuestion(-1)}
              onNext={() => goToAdjacentQuestion(1)}
              hasPrev={focusedIndex > 0}
              hasNext={focusedIndex !== -1 && focusedIndex < allQuestions.length - 1}
            />
          </div>

          <BottomPagination
            parts={test.parts}
            activePartIndex={activePartIndex}
            onChangePart={onChangePart}
            answeredQuestionNumbers={combinedAnsweredNumbers}
            theme={theme}
            // Review mode already has a final, graded result — there's
            // nothing left to submit, so its labeled button below calls
            // onExit (back to the dashboard) instead of re-submitting.
            onSubmitTest={() => (isReview ? onExit() : onSubmitTest({ ...answers, ...resolvedPlacements }))}
            focusedQuestionNumber={focusedQuestionNumber}
            onJumpToQuestion={jumpToQuestion}
            // Only set for preview/attempt/review — see BottomPagination's
            // own comment for how this swaps the icon-only student Submit
            // button for a labeled one and skips the confirm() dialog
            // (nothing a teacher does in preview/attempt is ever saved, and
            // review has nothing left to submit either way, so there's
            // nothing for a confirmation to protect against in any of the
            // three).
            submitLabel={isPreview ? 'Exit Preview' : isAttempt ? 'End Attempt' : isReview ? 'Close Review' : undefined}
          />
        </div>
      )}
    </div>
  );
}

function TimeUpOverlay({ theme }) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center ${theme.pageBg}`}>
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-100 text-2xl text-rose-600">
        ⏰
      </div>
      <h2 className={`text-xl font-semibold ${theme.strongText}`}>Time's up!</h2>
      <p className={`max-w-sm text-sm ${theme.mutedText}`}>
        Please wait for your teacher. They'll either add more time, allow overtime, or submit your test
        for you — this screen will update automatically.
      </p>
    </div>
  );
}

// Rendered INSTEAD of the split-pane content when the teacher blocks this student —
// the passage, questions, footer, and floating nav are simply not mounted while this
// is showing, so there is nothing in the DOM to read or interact with. Always dark
// regardless of theme (matches the "locked" tone across every contrast mode) —
// the rose lock icon/ring stays as-is since it's a status color, not chrome.
function BlockedOverlay({ theme }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-neutral-950 px-6 text-center">
      <div className="flex h-24 w-24 animate-pulse items-center justify-center rounded-full bg-rose-600/20 ring-4 ring-rose-500/50">
        <LockIcon />
      </div>
      <h2 className="text-4xl font-black tracking-[0.2em] text-white">BLOCKED</h2>
      <p className="max-w-sm text-sm text-neutral-300">
        Your teacher has blocked your test. The passage and questions are hidden and your timer is
        paused — this screen will update automatically once they unblock you.
      </p>
    </div>
  );
}

function TopNavbar({
  testTitle,
  timer,
  settingsOpen,
  setSettingsOpen,
  contrast,
  setContrast,
  textSize,
  setTextSize,
  // Only set for preview/attempt/review (see TestInterface's own modeLabel
  // prop above) — a small explicit tag so nobody mistakes any of the three
  // for a real, in-progress student session, even though everything else on
  // this screen is deliberately pixel-identical to one.
  modeLabel = null,
  // Review-only ({ score, totalQuestions, percentage, bandScore }) — see
  // TestInterface's own scoreSummary prop. When set, this REPLACES the
  // countdown clock below with the student's actual result, right where the
  // timer used to sit: there's nothing left to count down to once the test
  // is graded, and putting the score exactly there (rather than bolting it
  // on somewhere else) is what "mirrors the clean layout of professional
  // testing platforms" the way the countdown itself already did.
  scoreSummary = null,
  theme,
}) {
  return (
    <header
      className={`relative flex h-16 shrink-0 items-center justify-between border-b px-6 z-30 ${theme.headerBg} ${theme.headerBorder}`}
    >
      <div className="flex items-center gap-4">
        <span className="text-2xl font-black tracking-tight text-rose-600">
          Prep<span className={theme.strongText}>Portal</span>
        </span>
        <span className={`hidden h-6 w-px sm:block ${theme.headerDivider}`} />
        <span className={`hidden text-sm font-medium sm:block ${theme.headerMuted}`}>{testTitle}</span>
        {modeLabel && (
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${theme.accentBorder} ${theme.accentBg} ${theme.accentText}`}>
            {modeLabel}
          </span>
        )}
      </div>

      <div className="flex items-center gap-5">
        {scoreSummary ? (
          <div className="flex items-center divide-x divide-emerald-700/30 overflow-hidden rounded border border-emerald-500/60 bg-emerald-500/10 text-emerald-500">
            <span className="px-3 py-1 text-sm font-bold tabular-nums">
              {scoreSummary.score}/{scoreSummary.totalQuestions}
            </span>
            <span className="px-3 py-1 text-sm font-bold tabular-nums">{scoreSummary.percentage}%</span>
            {scoreSummary.bandScore != null && (
              <span className="px-3 py-1 text-sm font-bold tabular-nums">Band {scoreSummary.bandScore}</span>
            )}
          </div>
        ) : (
          <div
            className={`rounded border px-3 py-1 font-mono text-sm tabular-nums ${
              timer.status === 'overtime' || timer.status === 'blocked'
                ? 'border-red-400 bg-red-500/10 text-red-500'
                : `${theme.headerBorder} ${theme.headerMuted}`
            }`}
          >
            {timer.label}
            {timer.status === 'paused' && <span className={`ml-2 text-xs ${theme.faintText}`}>(paused)</span>}
            {timer.status === 'blocked' && <span className="ml-2 text-xs text-red-500">(blocked)</span>}
          </div>
        )}

        <div className={`flex items-center gap-3 ${theme.iconMuted}`}>
          <span className="hidden sm:inline-flex" title="Connection status">
            <WifiIcon />
          </span>
          <span className="hidden sm:inline-flex" title="Notifications">
            <BellIcon />
          </span>
          <button
            type="button"
            aria-label="Accessibility settings"
            title="Accessibility settings"
            onClick={() => setSettingsOpen((v) => !v)}
            className={`rounded p-1.5 ${theme.iconHover}`}
          >
            <MenuIcon />
          </button>
          <span className="hidden sm:inline-flex" title="Highlighter / notes">
            <EditIcon />
          </span>
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          contrast={contrast}
          setContrast={setContrast}
          textSize={textSize}
          setTextSize={setTextSize}
          onClose={() => setSettingsOpen(false)}
          theme={theme}
        />
      )}
    </header>
  );
}

function SettingsPanel({ contrast, setContrast, textSize, setTextSize, onClose, theme }) {
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

  // Every row below sets its OWN background + text color explicitly, even
  // rows that aren't selected — this is the fix for the dropdown's actual
  // bug (see THEME's doc comment): a row with no explicit text color
  // inherits whatever color the page wrapper is currently using (e.g.
  // text-yellow-300 in Yellow on black), and if that lands on top of an
  // unrelated hardcoded light background, the label becomes unreadable.
  // Explicit colors on every row means this panel is correct regardless of
  // what's rendered around it.
  return (
    <div className={`absolute right-6 top-16 z-40 w-80 rounded-md border shadow-lg ${theme.dropdownBg} ${theme.dropdownBorder}`}>
      <div className={`flex items-center justify-between border-b px-4 py-3 ${theme.dropdownDivider}`}>
        <span className={`font-medium ${theme.dropdownText}`}>Options</span>
        <button type="button" onClick={onClose} aria-label="Close" className={`${theme.dropdownMuted} hover:opacity-70`}>
          ✕
        </button>
      </div>

      <div className="px-4 py-3">
        <p className={`mb-2 text-xs font-semibold uppercase ${theme.dropdownMuted}`}>Contrast</p>
        {contrastOptions.map((opt) => {
          const isSelected = contrast === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setContrast(opt.id)}
              className={`flex w-full items-center justify-between rounded px-2 py-2 text-left ${
                isSelected ? `${theme.optionSelectedBg} ${theme.optionSelectedText}` : `${theme.dropdownText} ${theme.dropdownHoverBg}`
              }`}
            >
              <span>{opt.label}</span>
              {isSelected && <span className={theme.accentText}><CheckIcon /></span>}
            </button>
          );
        })}
      </div>

      <div className={`border-t px-4 py-3 ${theme.dropdownDivider}`}>
        <p className={`mb-2 text-xs font-semibold uppercase ${theme.dropdownMuted}`}>Text size</p>
        {textSizeOptions.map((opt) => {
          const isSelected = textSize === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTextSize(opt.id)}
              className={`flex w-full items-center justify-between rounded px-2 py-2 text-left ${
                isSelected ? `${theme.optionSelectedBg} ${theme.optionSelectedText}` : `${theme.dropdownText} ${theme.dropdownHoverBg}`
              }`}
            >
              <span>{opt.label}</span>
              {isSelected && <span className={theme.accentText}><CheckIcon /></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PartBanner({ partNumber, instructions, theme }) {
  return (
    <div className={`mx-6 mt-4 mb-1 shrink-0 rounded-lg border px-6 py-4 ${theme.subtleBorder} ${theme.subtleBg}`}>
      <p className={`font-bold ${theme.strongText}`}>Part {partNumber}</p>
      <p className={`mt-0.5 text-sm ${theme.mutedText}`}>{instructions}</p>
    </div>
  );
}

function SplitPane({ left, right, leftWidthPct, onResize, theme }) {
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
      onResize(Math.min(75, Math.max(25, pct)));
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
    <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden pt-3">
      <div className="min-h-0 overflow-y-auto" style={{ width: `${leftWidthPct}%` }}>
        {left}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        onMouseDown={handleMouseDown}
        className={`group relative flex w-4 shrink-0 cursor-col-resize items-center justify-center ${theme.subtleBg}`}
      >
        <div className={`pointer-events-none absolute inset-y-3 w-1.5 rounded-full ${theme.dividerBg}`} />
        <div className={`relative z-10 flex h-9 w-6 items-center justify-center rounded border shadow-sm ${theme.panelBorder} ${theme.panelBg} ${theme.mutedText}`}>
          ↔
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ width: `${100 - leftWidthPct}%` }}>
        {right}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Listening — full-width layout (no split screen: there's no passage to show
 * side-by-side, just audio), replicating the official computer-delivered
 * (Inspera) interface: one continuous column, with a light gray "Part
 * Header" banner above every question group rather than a single banner for
 * the whole part. Reuses QuestionGroupBody as-is so every question-group
 * renderer (note/table-completion, word-bank, matrix-matching, plain) works
 * identically here and in Reading — only the outer layout differs.
 * ---------------------------------------------------------------------- */
function ListeningPane({
  part,
  masterAudioUrl,
  answers,
  onAnswerChange,
  onToggleMultiAnswer,
  wordBankChipsByGroup,
  resolvedPlacements,
  selectedItemId,
  onChipClick,
  onSlotClick,
  previewMode = false,
  reviewMode = false,
  liveSessionId = null,
  audioState = null,
  theme,
}) {
  const wb = { chipsByGroupIndex: wordBankChipsByGroup, resolvedPlacements, selectedItemId, onChipClick, onSlotClick };

  return (
    <div className="min-h-0 w-full flex-1 overflow-y-auto pt-3">
      <div className="mx-auto max-w-4xl px-6 pb-10">
        {masterAudioUrl && (
          liveSessionId ? (
            // A real LIVE TEST attempt — the teacher's centralized player
            // (LiveTestMonitor.jsx) is the only thing that can play/pause/
            // seek this audio now. See LockedAudioPlayer's own doc comment.
            <LockedAudioPlayer audioUrl={masterAudioUrl} audioState={audioState} theme={theme} />
          ) : (
            <div className={`mb-6 rounded border p-3 ${theme.panelBorder} ${theme.panelBg}`}>
              <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${theme.faintText}`}>Audio</p>
              {/* One continuous master track for the whole test (all 4
                  sections back-to-back) — shown once here regardless of
                  which part's questions are currently on screen, never
                  re-fetched or restarted on a part-tab switch.
                  eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls src={masterAudioUrl} className="w-full" />
            </div>
          )
        )}

        {part.questionGroups.map((group, gi) => (
          <section key={gi} className="mb-8">
            <ListeningGroupHeader partNumber={part.partNumber} instructions={group.groupInstructions} theme={theme} />
            <div className="mt-4">
              <QuestionGroupBody
                group={group}
                gi={gi}
                answers={answers}
                onAnswerChange={onAnswerChange}
                onToggleMultiAnswer={onToggleMultiAnswer}
                wb={wb}
                previewMode={previewMode}
                reviewMode={reviewMode}
                theme={theme}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function formatAudioTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * LockedAudioPlayer
 * ------------------
 * Replaces the normal native <audio controls> a practice/preview attempt
 * gets (see ListeningPane above) with a read-only display for a real LIVE
 * TEST attempt: no play/pause button, no scrub bar the student can drag —
 * playback is entirely driven by whatever the teacher's centralized player
 * (LiveTestMonitor.jsx) broadcasts. This component has no socket of its
 * own — `audioState` arrives as a plain prop all the way from
 * useExamTimer.js, the one place that actually owns the socket connection,
 * consistent with TestInterface never touching a socket directly anywhere
 * else in this file.
 *
 * `audioState` is a position ANCHOR ({isPlaying, currentTime, updatedAt:
 * epoch ms}), not a per-second tick. This component derives "where the
 * audio should be right now" itself:
 *   isPlaying ? currentTime + (Date.now() - updatedAt) / 1000 : currentTime
 * and only reaches into the real <audio> element to correct drift beyond a
 * small threshold, rather than fighting the element's own playback clock on
 * every broadcast (that would sound choppy).
 *
 * A Listening test now has exactly ONE pre-merged master audio file
 * (`audioUrl`, always test.masterAudioUrl) covering all 4 sections
 * back-to-back — there is no more per-part file, no "which part is live"
 * selector, and nothing here tracks a part number at all. The element
 * either has a broadcast anchor to follow (`audioState` non-null — the
 * teacher has pressed Play at least once) or shows a plain "waiting for the
 * instructor" placeholder; it's the exact same one continuous stream
 * regardless of which part's questions the student currently has open.
 */
function LockedAudioPlayer({ audioUrl, audioState, theme }) {
  const audioRef = useRef(null);
  const [displayTime, setDisplayTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Browser autoplay policy can block a programmatic .play() call that
  // didn't originate from a user gesture on THIS page load — which is
  // exactly what every play the teacher broadcasts is, from this student's
  // point of view. When that happens, surface a one-tap "enable audio"
  // button; once tapped, every future broadcast plays normally for the
  // rest of this session (the tap itself is the gesture the browser wants).
  const [needsUnlock, setNeedsUnlock] = useState(false);

  const hasBroadcastAnchor = Boolean(audioState);
  const isPlaying = hasBroadcastAnchor && Boolean(audioState?.isPlaying);

  // Snap/steer the real element toward the teacher's true position whenever
  // a new play/pause/seek broadcast arrives.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioState) return;

    const target = audioState.isPlaying
      ? audioState.currentTime + (Date.now() - audioState.updatedAt) / 1000
      : audioState.currentTime;

    // Only hard-snap on a meaningful gap (a real seek, or the first sync
    // after mount/reconnect) — small gaps are left to the drift-correction
    // interval below so playback doesn't visibly jump on every broadcast.
    if (Number.isFinite(target) && Math.abs(audio.currentTime - target) > 1.5) {
      audio.currentTime = Math.max(0, target);
    }

    if (audioState.isPlaying && audio.paused) {
      audio.play().catch(() => setNeedsUnlock(true));
    } else if (!audioState.isPlaying && !audio.paused) {
      audio.pause();
    }
    // audioState.currentTime/updatedAt intentionally included — a fresh
    // seek at the SAME isPlaying value (e.g. paused -> seek -> still
    // paused) still needs to re-run this snap logic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioState?.isPlaying, audioState?.currentTime, audioState?.updatedAt]);

  // Continuous gentle drift correction while playing — network jitter or a
  // slightly-off local clock can let the element wander from the teacher's
  // true position over a long track; this nudges it back periodically
  // rather than only correcting on the next explicit teacher action.
  useEffect(() => {
    if (!isPlaying || !audioState) return undefined;
    const id = setInterval(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const target = audioState.currentTime + (Date.now() - audioState.updatedAt) / 1000;
      if (Math.abs(audio.currentTime - target) > 1.5) {
        audio.currentTime = Math.max(0, target);
      }
    }, 4000);
    return () => clearInterval(id);
  }, [isPlaying, audioState]);

  return (
    <div className={`mb-6 rounded border p-3 ${theme.panelBorder} ${theme.panelBg}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs font-semibold uppercase tracking-wide ${theme.faintText}`}>Audio</p>
        <span className="flex items-center gap-1 rounded-full bg-neutral-800 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
          🔒 Audio is controlled by the instructor
        </span>
      </div>

      {hasBroadcastAnchor ? (
        <>
          {/* No `controls` attribute — this element is driven entirely by
              the effects above, never by direct student interaction.
              eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio
            ref={audioRef}
            src={audioUrl}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setDisplayTime(e.currentTarget.currentTime || 0)}
            className="hidden"
          />

          {/* Read-only progress display — informational only, not a scrub
              bar; there is no onClick/onChange handler here. */}
          <div className={`h-1.5 w-full overflow-hidden rounded-full ${theme.subtleBg}`}>
            <div
              className="h-full rounded-full bg-neutral-800 transition-all duration-1000 ease-linear"
              style={{ width: duration > 0 ? `${Math.min(100, (displayTime / duration) * 100)}%` : '0%' }}
            />
          </div>
          <div className={`mt-1.5 flex items-center justify-between text-[11px] ${theme.faintText}`}>
            <span>{formatAudioTime(displayTime)}</span>
            <span>{isPlaying ? 'Playing…' : 'Paused'}</span>
            <span>{formatAudioTime(duration)}</span>
          </div>

          {needsUnlock && (
            <button
              type="button"
              onClick={() => {
                audioRef.current
                  ?.play()
                  .then(() => setNeedsUnlock(false))
                  .catch(() => {});
              }}
              className="mt-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
            >
              Tap to enable audio for this test
            </button>
          )}
        </>
      ) : (
        <p className={`rounded-lg border border-dashed py-4 text-center text-xs ${theme.subtleBorder} ${theme.faintText}`}>
          Not currently playing — waiting for the instructor.
        </p>
      )}
    </div>
  );
}

// The Inspera "Part Header" banner: full-width, light gray, plain sans-serif
// text — shown above EACH question group (not once per part), since the
// official interface introduces every new question-type block within a
// part with its own instruction banner.
function ListeningGroupHeader({ partNumber, instructions, theme }) {
  return (
    <div className={`w-full rounded px-4 py-3 ${theme.subtleBg}`}>
      <p className={`font-sans text-sm font-bold ${theme.strongText}`}>Part {partNumber}</p>
      {instructions && <p className={`mt-0.5 font-sans text-sm ${theme.mutedText}`}>{instructions}</p>}
    </div>
  );
}

function PassagePane({
  part,
  placements,
  headingBank,
  onClearSlot,
  reviewMode = false,
  answers = {},
  questionLookup = {},
  theme,
}) {
  if (part.paragraphs && part.paragraphs.length) {
    return (
      <article className="max-w-none px-8 py-6 leading-relaxed">
        {part.paragraphs.map((para) => (
          <div key={para.id}>
            {para.dropSlotNumber != null && (
              <HeadingDropZone
                slotNumber={para.dropSlotNumber}
                placedHeadingId={placements[para.dropSlotNumber]}
                headingBank={headingBank}
                onClear={() => onClearSlot(para.dropSlotNumber)}
                reviewMode={reviewMode}
                // A heading-matching question is answered here on the
                // passage side, not through QuestionsPane — `answers` was
                // still seeded from the student's real submission for
                // every question number (see TestInterface's own `answers`
                // useState), so it already holds the raw text they matched
                // to this paragraph, same as any other question type.
                studentAnswer={reviewMode ? answers[para.dropSlotNumber] : undefined}
                question={questionLookup[para.dropSlotNumber]}
                theme={theme}
              />
            )}
            <p className="mb-4">{para.text}</p>
          </div>
        ))}
      </article>
    );
  }

  return (
    <article className="max-w-none px-8 py-6 leading-relaxed">
      {part.passageText.split('\n\n').map((para, i) => (
        <p key={i} className="mb-4">
          {para}
        </p>
      ))}
    </article>
  );
}

function HeadingDropZone({
  slotNumber,
  placedHeadingId,
  headingBank,
  onClear,
  reviewMode = false,
  studentAnswer,
  question,
  theme,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${slotNumber}`, disabled: reviewMode });
  const placedHeading = headingBank.find((h) => h.id === placedHeadingId);
  // Review mode never has a real drag-id placement — nothing was dragged,
  // the student's answer only exists as plain text on their submission —
  // so it renders `studentAnswer` directly instead of resolving through
  // the id lookup above (which `placements` deliberately isn't seeded for;
  // see TestInterface's own `answers` useState doc comment).
  const displayText = reviewMode ? formatCorrectAnswer(studentAnswer) : placedHeading?.text;
  const hasAnswer = reviewMode ? Boolean(displayText) : Boolean(placedHeading);

  return (
    <div className="mb-3">
      <div
        id={`question-${slotNumber}`}
        ref={setNodeRef}
        className={`flex min-h-[52px] items-center justify-between rounded-md border-2 px-4 py-3 text-sm transition-colors ${
          isOver
            ? 'border-dashed border-blue-600 bg-blue-50 text-neutral-900'
            : hasAnswer
            ? `border-solid ${theme.inputBorder} ${theme.inputBg} ${theme.inputText}`
            : 'border-dashed border-blue-600 bg-transparent'
        }`}
      >
        {hasAnswer ? (
          <span className={`flex items-center gap-3 font-medium ${theme.inputText}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-bold ${theme.numberBadgeBorder} ${theme.accentBg} ${theme.accentText}`}>
              {slotNumber}
            </span>
            {displayText}
          </span>
        ) : (
          <span className="flex items-center gap-3 text-blue-600/70">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-blue-600 text-xs font-bold text-blue-600">
              {slotNumber}
            </span>
            {reviewMode ? 'No answer given' : 'Drag a heading here'}
          </span>
        )}

        {!reviewMode && placedHeading && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove heading from question ${slotNumber}`}
            className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-xs ${theme.faintText} ${theme.iconHover}`}
          >
            ✕
          </button>
        )}
      </div>

      {reviewMode && (
        <PreviewAnswerBox
          correctAnswer={question?.correctAnswer}
          explanation={question?.explanation}
          studentAnswer={studentAnswer}
        />
      )}
    </div>
  );
}

function QuestionsPane({
  questionGroups,
  headingBank,
  availableHeadings,
  answers,
  onAnswerChange,
  onToggleMultiAnswer,
  wordBankChipsByGroup,
  resolvedPlacements,
  selectedItemId,
  onChipClick,
  onSlotClick,
  previewMode = false,
  reviewMode = false,
  theme,
}) {
  // Bundled once here and threaded down through QuestionGroupBody to every
  // word-bank-aware sub-component, rather than passing each of these 5
  // props individually at every level.
  const wb = { chipsByGroupIndex: wordBankChipsByGroup, resolvedPlacements, selectedItemId, onChipClick, onSlotClick };

  return (
    <div className="px-8 py-6">
      {/* Review mode never seeds `placements` (see TestInterface's own
          `answers` useState doc comment) — a heading was never actually
          re-placed via drag-id, only its resolved text is known — so every
          heading would show here as "available" even though the student's
          own answer is shown over on PassagePane's drop zones. Hiding this
          list entirely in review avoids that contradiction; it was only
          ever the drag SOURCE anyway, and there's nothing left to drag. */}
      {headingBank.length > 0 && !reviewMode && (
        <section className="mb-8">
          <p className={`mb-1 font-semibold ${theme.strongText}`}>List of Headings</p>
          <p className={`mb-3 text-sm ${theme.mutedText}`}>
            Drag each heading onto the matching gap in the passage on the left. Drag it back out, or
            press the ✕ on a placed heading, to change your answer.
          </p>
          <div className="space-y-2">
            {availableHeadings.length === 0 ? (
              <p className={`text-sm italic ${theme.faintText}`}>All headings placed.</p>
            ) : (
              availableHeadings.map((heading) => (
                <HeadingPill key={heading.id} heading={heading} draggable theme={theme} />
              ))
            )}
          </div>
        </section>
      )}

      {questionGroups.map((group, gi) => (
        <section key={gi} className="mb-8">
          <p className={`mb-1 font-semibold ${theme.strongText}`}>
            Questions {group.startNumber}
            {group.endNumber !== group.startNumber ? `–${group.endNumber}` : ''}
          </p>
          <p className={`mb-4 text-sm ${theme.mutedText}`}>{group.groupInstructions}</p>

          <QuestionGroupBody
            group={group}
            gi={gi}
            answers={answers}
            onAnswerChange={onAnswerChange}
            onToggleMultiAnswer={onToggleMultiAnswer}
            wb={wb}
            previewMode={previewMode}
            reviewMode={reviewMode}
            theme={theme}
          />
        </section>
      ))}
    </div>
  );
}

function HeadingPill({ heading, draggable = false, isOverlay = false, theme }) {
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
      className={`flex w-full items-center rounded-md border px-4 py-3 text-sm font-medium shadow-sm transition ${theme.chipBorder} ${theme.chipBg} ${theme.chipText} ${
        draggable ? 'cursor-grab hover:shadow active:cursor-grabbing' : ''
      } ${isDragging ? 'opacity-30' : ''} ${isOverlay ? 'cursor-grabbing shadow-lg ring-2 ring-blue-300' : ''}`}
    >
      {heading.text}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Word-bank drag-and-drop — Cambridge/PTE-style "choose from the box"
 * completion and matching. A chip is draggable OR click-to-select
 * (accessible fallback: click a chip, then click an empty slot); a slot is
 * droppable, shows the placed chip's text once filled, and clicking a
 * filled slot clears it (drag a new chip onto a filled slot to swap it in
 * one step). See TestInterface's placements/chipRegistry/handleDragEnd
 * for the shared state this reads and writes.
 * ---------------------------------------------------------------------- */

function WordBankChip({ chip, draggable = false, isOverlay = false, isSelected = false, onClick, theme }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: chip.id,
    disabled: !draggable,
  });

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <button
      type="button"
      ref={draggable ? setNodeRef : undefined}
      style={style}
      onClick={() => onClick?.(chip.id)}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium shadow-sm transition ${
        isSelected
          ? 'border-blue-500 bg-blue-100 text-blue-900 ring-2 ring-blue-300'
          : `${theme.chipBorder} ${theme.chipBg} ${theme.chipText} hover:shadow`
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-30' : ''} ${
        isOverlay ? 'cursor-grabbing shadow-lg ring-2 ring-blue-300' : ''
      }`}
    >
      {chip.text}
    </button>
  );
}

// The small bordered box holding a blank's question number — shared by
// InlineBlankInput (typed) and WordBankDropSlot (drag-drop) so both read as
// the same "number chip + answer box" unit, per the official IELTS
// computer-delivered (Inspera) blue-bordered look.
function BlankNumberBox({ questionNumber, theme }) {
  return (
    <span className={`flex h-8 min-w-[1.85rem] shrink-0 items-center justify-center rounded-l border border-r px-1.5 text-xs font-bold ${theme.numberBadgeBorder} ${theme.accentBg} ${theme.accentText}`}>
      {questionNumber}
    </span>
  );
}

function WordBankDropSlot({ questionNumber, placedText, hasSelection, onClick, domId, disabled = false, theme }) {
  const { setNodeRef, isOver } = useDroppable({ id: `wbslot-${questionNumber}`, disabled });
  const filled = placedText != null && placedText !== '';

  // Number box matches InlineBlankInput's solid blue box; the drop target
  // itself uses a dashed blue border with a transparent background while
  // empty (an explicit "drop here" invitation), switching to a solid blue
  // border once an option has been placed.
  return (
    <span id={domId} className="mx-1 inline-flex items-stretch align-middle">
      <BlankNumberBox questionNumber={questionNumber} theme={theme} />
      <button
        type="button"
        ref={setNodeRef}
        disabled={disabled}
        onClick={() => onClick(questionNumber)}
        title={
          disabled
            ? undefined
            : filled
            ? 'Click to remove'
            : hasSelection
            ? 'Click to place the selected option here'
            : 'Drag an option here, or click a chip then click here'
        }
        className={`inline-flex h-8 min-w-[7rem] max-w-full items-center justify-center gap-1.5 rounded-r border-2 px-2 text-sm font-medium transition ${
          disabled ? `cursor-default ${theme.inputDisabledBg} ${theme.inputDisabledText} ${theme.inputBorder}` : ''
        } ${
          isOver
            ? 'border-dashed border-blue-600 bg-blue-50 text-neutral-900'
            : filled
            ? disabled
              ? ''
              : `border-solid ${theme.inputBorder} ${theme.inputBg} ${theme.inputText}`
            : 'border-dashed border-blue-600 bg-transparent text-blue-600/70'
        }`}
      >
        {filled ? (
          <>
            <span className="truncate">{placedText}</span>
            {!disabled && <span className={`ml-0.5 shrink-0 ${theme.faintText}`}>✕</span>}
          </>
        ) : (
          <span className="italic">{disabled ? 'no answer' : 'answer'}</span>
        )}
      </button>
    </span>
  );
}

/** The draggable/selectable pool of not-yet-placed options for one group. */
function WordBankChipTray({ chips, selectedItemId, onChipClick, theme }) {
  return (
    <div className={`mt-4 rounded-lg border p-3 ${theme.subtleBorder} ${theme.subtleBg}`}>
      <p className={`mb-2 text-xs font-medium uppercase tracking-wide ${theme.faintText}`}>Word bank</p>
      {chips.length === 0 ? (
        <p className={`text-xs italic ${theme.faintText}`}>All options placed — click a filled answer to swap it.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <WordBankChip
              key={chip.id}
              chip={chip}
              draggable
              isSelected={selectedItemId === chip.id}
              onClick={onChipClick}
              theme={theme}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One question answered entirely via a word-bank drop-slot (no free text,
 * no radio options) — used for matching-heading/matching-information/plain
 * fill-in-the-blank groups that carry a wordBank but no note/table layout. */
function WordBankQuestionItem({ question, wb, previewMode = false, reviewMode = false, studentAnswer, theme }) {
  const { questionNumber, prompt } = question;
  const renderBlank = (key) => (
    <WordBankDropSlot
      key={key}
      questionNumber={questionNumber}
      domId={`question-${questionNumber}`}
      // Review mode never has a real drag-id placement (see
      // TestInterface's own `answers` useState doc comment) — fall back to
      // the student's actual submitted text so the slot still shows what
      // they answered instead of looking permanently empty.
      placedText={wb.resolvedPlacements[questionNumber] ?? (reviewMode ? studentAnswer : undefined)}
      hasSelection={wb.selectedItemId != null}
      onClick={wb.onSlotClick}
      disabled={reviewMode}
      theme={theme}
    />
  );
  return (
    <div className={`mb-5 leading-loose ${theme.pageText}`}>
      {renderPromptWithBlank(prompt, renderBlank)}
      {previewMode && (
        <PreviewAnswerBox
          correctAnswer={question.correctAnswer}
          explanation={question.explanation}
          studentAnswer={reviewMode ? studentAnswer : undefined}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Answer-key UI shared by the teacher's "Preview Test" (see
 * TestInterfaceSession.jsx / PracticeTests.jsx) AND the student's post-
 * submission review (see TestInterface's own `mode === 'review'` /
 * StudentTestPage.jsx) — gated behind every call site's
 * `previewMode`/`mode === 'preview'||'review'` check, never rendered for a
 * real in-progress student test. Two shapes: PreviewAnswerBox sits directly
 * below one self-contained question (a standalone QuestionItem/
 * WordBankQuestionItem row); GroupAnswerKeyPanel is used instead for
 * note-completion/table-completion groups WITH a real layoutText/table —
 * injecting a box after every single inline blank there would fragment the
 * note's prose or a table cell's fixed grid (the "doesn't break table/note
 * layouts" requirement), so those groups get one consolidated key, in
 * question-number order, directly below the whole note/table block instead
 * — still "immediately below," just below the structure as a unit rather
 * than mid-sentence/mid-cell.
 *
 * Both accept an optional `studentAnswer`/per-question student value — left
 * undefined for teacher preview (nothing was ever answered, so only the
 * correct answer/explanation show); set to the student's own submitted
 * value for review, which additionally shows "Your answer" graded against
 * `correctAnswer` right there, exactly like a teacher's answer key but
 * annotated with what THIS student actually got right or wrong.
 * ---------------------------------------------------------------------- */
function formatCorrectAnswer(correctAnswer) {
  if (Array.isArray(correctAnswer)) return correctAnswer.filter((v) => v != null && v !== '').join(', ');
  return correctAnswer == null ? '' : String(correctAnswer);
}

// Same normalize-and-compare semantics as TestInterfaceSession.jsx's own
// scoreAttempt (case/whitespace-insensitive; array answers compare as sets)
// — kept as a local copy rather than a shared import since the two files
// have no existing shared-utility module and this is a small, self-
// contained comparison with no other state to coordinate.
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

function PreviewAnswerBox({ correctAnswer, explanation, studentAnswer }) {
  const answerText = formatCorrectAnswer(correctAnswer);
  const isReview = studentAnswer !== undefined;
  const isCorrect = isReview ? isAnswerCorrect(studentAnswer, correctAnswer) : null;
  const studentText = formatCorrectAnswer(studentAnswer);

  if (!answerText && !explanation && !isReview) return null;

  const toneClasses = isReview
    ? isCorrect
      ? 'border-emerald-200 bg-emerald-50'
      : 'border-rose-200 bg-rose-50'
    : 'border-sky-200 bg-sky-50';
  const headingTone = isReview ? (isCorrect ? 'text-emerald-800' : 'text-rose-800') : 'text-sky-800';
  const bodyTone = isReview ? (isCorrect ? 'text-emerald-700' : 'text-rose-700') : 'text-sky-700';

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-sm not-italic ${toneClasses}`}>
      {isReview && (
        <p className={`font-semibold ${headingTone}`}>
          Your answer: <span className="font-normal">{studentText || '(no answer given)'}</span>
          <span className="ml-2 text-xs font-bold uppercase tracking-wide">
            {isCorrect ? '✓ Correct' : '✕ Incorrect'}
          </span>
        </p>
      )}
      {/* In review, the correct answer is only worth repeating when the
          student actually got it wrong — showing it either way would just
          be noise on every question they already got right. */}
      {answerText && (!isReview || !isCorrect) && (
        <p className={`font-semibold ${isReview ? 'mt-1 text-rose-800' : headingTone}`}>
          Correct answer: <span className="font-normal">{answerText}</span>
        </p>
      )}
      {explanation && (
        <p className={`mt-1 ${bodyTone}`}>
          <span className="font-semibold">Explanation: </span>
          {explanation}
        </p>
      )}
    </div>
  );
}

function GroupAnswerKeyPanel({ questions, studentAnswers }) {
  const isReview = studentAnswers != null;
  const keyed = (questions || [])
    .slice()
    .sort((a, b) => a.questionNumber - b.questionNumber)
    .filter((q) => formatCorrectAnswer(q.correctAnswer) || q.explanation || isReview);
  if (!keyed.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-sky-600">
        {isReview ? 'Your answers' : 'Answer key'}
      </p>
      <div className="space-y-1.5">
        {keyed.map((q) => {
          const answerText = formatCorrectAnswer(q.correctAnswer);
          const given = isReview ? studentAnswers[q.questionNumber] : undefined;
          const isCorrect = isReview ? isAnswerCorrect(given, q.correctAnswer) : null;
          return (
            <p key={q.questionNumber} className="leading-relaxed text-sky-800">
              <span className="font-semibold">{q.questionNumber}.</span>{' '}
              {isReview && (
                <span className={isCorrect ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-700'}>
                  {formatCorrectAnswer(given) || '(no answer given)'} {isCorrect ? '✓' : '✕'}
                  {!isCorrect && answerText ? ` — correct: ${answerText}` : ''}
                </span>
              )}
              {!isReview && answerText && <span>{answerText}</span>}
              {q.explanation && (
                <span className="text-sky-700">{answerText || isReview ? ' — ' : ''}{q.explanation}</span>
              )}
            </p>
          );
        })}
      </div>
    </div>
  );
}

// Matches an explicit bracketed blank marker like "[8]" or "[ 8 ]" — the
// format this app's parsed question prompts actually use for the gap.
const BRACKETED_BLANK_PATTERN = /\[\s*\d+\s*\]/;
// Fallback markers some prompts might use instead (underscores, "[blank]", ellipsis-style dots).
const GENERIC_BLANK_PATTERN = /_{3,}|\[blank\]|\.{4,}/i;

// `renderBlank(key)` builds whichever control belongs at the blank — a free
// text InlineBlankInput or a WordBankDropSlot — so this splitting logic
// stays identical for both; only the caller's renderBlank differs.
function splitOnBlank(prompt, pattern, renderBlank) {
  const segments = prompt.split(pattern);
  return segments.reduce((acc, segment, i) => {
    acc.push(<span key={`t-${i}`}>{segment}</span>);
    if (i < segments.length - 1) {
      acc.push(renderBlank(`b-${i}`));
    }
    return acc;
  }, []);
}

function renderPromptWithBlank(prompt, renderBlank) {
  if (!prompt) return null;

  if (BRACKETED_BLANK_PATTERN.test(prompt)) {
    return splitOnBlank(prompt, BRACKETED_BLANK_PATTERN, renderBlank);
  }

  if (GENERIC_BLANK_PATTERN.test(prompt)) {
    return splitOnBlank(prompt, GENERIC_BLANK_PATTERN, renderBlank);
  }

  // No marker in the prompt at all — fall back to appending the blank at the end.
  return (
    <>
      {prompt} {renderBlank('b-end')}
    </>
  );
}

// Official IELTS computer-delivered (Inspera) blue-bordered digital blank:
// the question number sits in its own small bordered box (distinct light
// blue background, blue right-border divider), immediately adjacent to a
// separately-bordered input box in the same IELTS blue (#0078D4) — two
// clearly bounded rectangles rather than a plain underlined field.
// WordBankDropSlot above mirrors the same shape via BlankNumberBox so a
// word-bank blank and a typed blank read as the same visual language.
function InlineBlankInput({ questionNumber, wordLimit, value, onChange, domId, disabled = false, theme }) {
  return (
    <span id={domId} className="mx-1 inline-flex items-stretch align-middle">
      <BlankNumberBox questionNumber={questionNumber} theme={theme} />
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(questionNumber, e.target.value)}
        disabled={disabled}
        aria-label={`Answer for question ${questionNumber}`}
        title={wordLimit || ''}
        // select-text overrides the select-none the test wrapper puts on
        // everything else — students still need to select/retype what
        // they've typed in their own answer, only the static passage/
        // question text around it is locked down. Review mode additionally
        // disables the field (it's a past answer now, not editable) and
        // dims it so a locked field reads as locked at a glance.
        className={`h-8 w-28 select-text rounded-r border border-l-0 px-2 text-center text-sm focus:z-10 focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40 ${theme.inputBorder} ${
          disabled ? `cursor-default ${theme.inputDisabledBg} ${theme.inputDisabledText}` : `${theme.inputBg} ${theme.inputText}`
        }`}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Note-completion / table-completion — Cambridge-authentic layouts.
 *
 * Instead of flattening every blank into its own isolated numbered line
 * (the old behavior for every fill-in-the-blank group), a group whose
 * questionType is 'note-completion' or 'table-completion' carries its own
 * layoutText / tableColumns+tableRows (see backend/models/Test.js) — the
 * original note/table structure, with each blank marked inline as "{{n}}"
 * (or the older "[[n]]" — both are accepted, see GROUP_BLANK_MARKER below).
 * These components parse that structure once per group and interleave real
 * InlineBlankInputs exactly where the markers sit, rather than one input
 * per question rendered on its own line.
 *
 * Older/manually-entered groups that don't have layoutText or table data
 * yet fall back to the original one-question-per-line rendering below, so
 * nothing existing regresses.
 * ---------------------------------------------------------------------- */

// Matches an inline blank placeholder inside layoutText/table cells. Accepts
// both "{{31}}" (the Cambridge-cloze-style syntax teachers are asked to use
// going forward — see the "Note layout" textarea in ListeningTestWizard.jsx)
// and the original "[[31]]" double-bracket form, so nothing authored before
// this syntax was introduced breaks. Deliberately never collides with the
// single-bracket "[3]" pattern a question's own `prompt` field might use
// (BRACKETED_BLANK_PATTERN above) — a note/table-completion question still
// has a normal `prompt` (used for the teacher-facing answer key), separate
// from where the blank actually renders for the student.
const GROUP_BLANK_MARKER = /\{\{(\d+)\}\}|\[\[(\d+)\]\]/g;

// `renderBlank(questionNumber, wordLimit, key)` builds whichever control
// belongs at this marker — a free-text InlineBlankInput or a
// WordBankDropSlot — so this marker-parsing logic stays identical for both
// note-completion and table-completion, word-bank or not; only the
// caller's renderBlank differs (see NoteCompletionGroup/TableCompletionGroup).
function renderTextWithBlankMarkers(text, questionsByNumber, renderBlank) {
  if (!text) return null;
  const nodes = [];
  let lastIndex = 0;
  let key = 0;
  GROUP_BLANK_MARKER.lastIndex = 0;
  let match;
  while ((match = GROUP_BLANK_MARKER.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={`t-${key++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    // match[1] is set for "{{n}}", match[2] for the legacy "[[n]]".
    const questionNumber = Number(match[1] ?? match[2]);
    const q = questionsByNumber[questionNumber];
    nodes.push(renderBlank(questionNumber, q?.wordLimit, `b-${key++}`));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<span key={`t-${key++}`}>{text.slice(lastIndex)}</span>);
  }
  return nodes;
}

// Splits layoutText into renderable blocks, mirroring the Cambridge IELTS
// printed note-completion layout:
//   "# "  → the note's main title — one centered, bold headline block.
//   "## " → a left-aligned bold sub-heading within the note.
//   "- "/"• "/"* " → a bullet point, grouped with any immediately
//                    surrounding bullets into one <ul>. A line indented by
//                    2+ leading spaces (or a tab) before the bullet marker
//                    is a nested sub-point (e.g. "  - Detail" under a
//                    top-level "- Main point") and renders more deeply
//                    indented than its parent.
//   blank line → ends the current list/paragraph run.
//   anything else → a plain paragraph line.
// A light markdown-ish convention, not a full parser.
function parseNoteLayout(layoutText) {
  const blocks = [];
  let currentList = null;
  layoutText.split('\n').forEach((rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      currentList = null;
      return;
    }
    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'subheading', text: trimmed.slice(3).trim() });
      currentList = null;
      return;
    }
    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'heading', text: trimmed.slice(2).trim() });
      currentList = null;
      return;
    }
    const bulletMatch = trimmed.match(/^[-•*]\s+(.*)$/);
    if (bulletMatch) {
      const indent = rawLine.match(/^(\s*)/)[1];
      // A tab or 2+ spaces of indentation before the marker reads as a
      // nested sub-bullet; anything less is a top-level point.
      const level = indent.includes('\t') || indent.length >= 2 ? 2 : 1;
      if (!currentList) {
        currentList = { type: 'list', items: [] };
        blocks.push(currentList);
      }
      currentList.items.push({ text: bulletMatch[1], level });
    } else {
      currentList = null;
      blocks.push({ type: 'para', text: trimmed });
    }
  });
  return blocks;
}

function questionsByNumberOf(group) {
  return Object.fromEntries((group.questions || []).map((q) => [q.questionNumber, q]));
}

// Builds the renderBlank(questionNumber, wordLimit, key) callback shared by
// NoteCompletionGroup/TableCompletionGroup/their no-layout fallbacks: a
// WordBankDropSlot when this group carries a word bank, otherwise a plain
// free-text InlineBlankInput. `chips` (from wb.chipsByGroupIndex[gi]) being
// non-undefined is what marks a group as word-bank-driven — see
// wordBankChipsByGroup in TestInterface.
function makeBlankRenderer(useWordBank, wb, answers, onAnswerChange, reviewMode = false, theme) {
  if (useWordBank) {
    return (questionNumber, wordLimit, key) => (
      <WordBankDropSlot
        key={key}
        questionNumber={questionNumber}
        domId={`question-${questionNumber}`}
        // Review mode never has a real drag-id placement — `answers` was
        // seeded from the student's actual submission for every question
        // number regardless of type (see TestInterface's own `answers`
        // useState), so it's the fallback here same as everywhere else.
        placedText={wb.resolvedPlacements[questionNumber] ?? (reviewMode ? answers[questionNumber] : undefined)}
        hasSelection={wb.selectedItemId != null}
        onClick={wb.onSlotClick}
        disabled={reviewMode}
        theme={theme}
      />
    );
  }
  return (questionNumber, wordLimit, key) => (
    <InlineBlankInput
      key={key}
      questionNumber={questionNumber}
      wordLimit={wordLimit}
      value={answers[questionNumber]}
      onChange={onAnswerChange}
      domId={`question-${questionNumber}`}
      disabled={reviewMode}
      theme={theme}
    />
  );
}

function NoteCompletionGroup({
  group,
  gi,
  answers,
  onAnswerChange,
  onToggleMultiAnswer,
  wb,
  previewMode = false,
  reviewMode = false,
  theme,
}) {
  const questionsByNumber = useMemo(() => questionsByNumberOf(group), [group]);
  const useWordBank = Boolean(wb) && wb.chipsByGroupIndex[gi] !== undefined;
  const renderBlank = makeBlankRenderer(useWordBank, wb, answers, onAnswerChange, reviewMode, theme);

  if (!group.layoutText || !group.layoutText.trim()) {
    // No structured layout saved for this group (older/manually-entered
    // data) — fall back to the original per-question rendering rather than
    // rendering nothing.
    return (
      <>
        {group.questions.map((q) =>
          useWordBank ? (
            <WordBankQuestionItem
              key={q.questionNumber}
              question={q}
              wb={wb}
              previewMode={previewMode}
              reviewMode={reviewMode}
              studentAnswer={reviewMode ? answers[q.questionNumber] : undefined}
              theme={theme}
            />
          ) : (
            <QuestionItem
              key={q.questionNumber}
              question={q}
              value={answers[q.questionNumber]}
              onAnswerChange={onAnswerChange}
              onToggleMultiAnswer={onToggleMultiAnswer}
              previewMode={previewMode}
              reviewMode={reviewMode}
              theme={theme}
            />
          )
        )}
        {useWordBank && !reviewMode && (
          <WordBankChipTray chips={wb.chipsByGroupIndex[gi]} selectedItemId={wb.selectedItemId} onChipClick={wb.onChipClick} theme={theme} />
        )}
      </>
    );
  }

  const blocks = parseNoteLayout(group.layoutText);

  return (
    // Sharp (non-rounded), heavier 2px outer frame + generous padding —
    // matches the boxed note/summary panel Cambridge prints the completion
    // task inside on the actual exam paper, rather than letting the note
    // float loose in the page like plain body text. Border/text colors
    // still route through `theme` (never a hardcoded Tailwind color) so
    // the panel stays correct in every contrast mode; only the *weight*
    // (border-2) and spacing (p-6) are the fixed Cambridge-fidelity values.
    <div className={`border-2 p-6 ${theme.tableBorder}`}>
      <div className={`space-y-3 leading-loose ${theme.pageText}`}>
        {blocks.map((block, bi) => {
          if (block.type === 'heading') {
            // The note's main title — centered and unmistakably the
            // heading of the whole block, echoing the bolded, centered
            // title Cambridge prints above a note-completion summary.
            return (
              <p key={bi} className={`text-xl font-bold text-center ${theme.strongText}`}>
                {block.text}
              </p>
            );
          }
          if (block.type === 'subheading') {
            return (
              <p key={bi} className={`mt-4 mb-2 font-bold ${theme.strongText}`}>
                {block.text}
              </p>
            );
          }
          if (block.type === 'list') {
            return (
              // list-outside + pl-5 (rather than ml-5 with the default
              // inside marker) gives a proper hanging indent: the bullet
              // sits in the margin and every wrapped continuation line
              // lines up with the first line's text, not with the bullet.
              // Nested sub-points (level 2, authored with 2+ leading spaces
              // before the "-") get an extra ml-8 on top of that so they
              // read as clearly subordinate to their parent bullet.
              <ul key={bi} className="list-disc list-outside space-y-2 pl-5">
                {block.items.map((item, ii) => (
                  <li key={ii} className={`pl-1 ${item.level === 2 ? 'ml-8' : 'ml-4'}`}>
                    {renderTextWithBlankMarkers(item.text, questionsByNumber, renderBlank)}
                  </li>
                ))}
              </ul>
            );
          }
          return <p key={bi}>{renderTextWithBlankMarkers(block.text, questionsByNumber, renderBlank)}</p>;
        })}
      </div>
      {useWordBank && !reviewMode && (
        <WordBankChipTray chips={wb.chipsByGroupIndex[gi]} selectedItemId={wb.selectedItemId} onChipClick={wb.onChipClick} theme={theme} />
      )}
      {/* One consolidated key for the whole note, immediately below it —
          see the doc comment above PreviewAnswerBox for why this doesn't
          inject a box after each individual "[[n]]" marker instead. */}
      {previewMode && (
        <GroupAnswerKeyPanel questions={group.questions} studentAnswers={reviewMode ? answers : undefined} />
      )}
    </div>
  );
}

function TableCompletionGroup({
  group,
  gi,
  answers,
  onAnswerChange,
  onToggleMultiAnswer,
  wb,
  previewMode = false,
  reviewMode = false,
  theme,
}) {
  const questionsByNumber = useMemo(() => questionsByNumberOf(group), [group]);
  const useWordBank = Boolean(wb) && wb.chipsByGroupIndex[gi] !== undefined;
  const renderBlank = makeBlankRenderer(useWordBank, wb, answers, onAnswerChange, reviewMode, theme);

  const hasTable = (group.tableColumns && group.tableColumns.length > 0) || (group.tableRows && group.tableRows.length > 0);
  if (!hasTable) {
    // No structured table saved for this group yet — same fallback as
    // NoteCompletionGroup above.
    return (
      <>
        {group.questions.map((q) =>
          useWordBank ? (
            <WordBankQuestionItem
              key={q.questionNumber}
              question={q}
              wb={wb}
              previewMode={previewMode}
              reviewMode={reviewMode}
              studentAnswer={reviewMode ? answers[q.questionNumber] : undefined}
              theme={theme}
            />
          ) : (
            <QuestionItem
              key={q.questionNumber}
              question={q}
              value={answers[q.questionNumber]}
              onAnswerChange={onAnswerChange}
              onToggleMultiAnswer={onToggleMultiAnswer}
              previewMode={previewMode}
              reviewMode={reviewMode}
              theme={theme}
            />
          )
        )}
        {useWordBank && !reviewMode && (
          <WordBankChipTray chips={wb.chipsByGroupIndex[gi]} selectedItemId={wb.selectedItemId} onChipClick={wb.onChipClick} theme={theme} />
        )}
      </>
    );
  }

  return (
    <div>
      {/* A strict, printed-grid <table>: border-collapse so every cell's 1px
         border merges into a single shared line with its neighbors, plus an
         explicit border on the <table> itself so the OUTER edge of the grid
         is drawn too (border-collapse alone only draws the shared internal
         lines from the th/td borders meeting at the edge). */}
      <div className="overflow-x-auto">
        <table className={`w-full border border-collapse ${theme.tableBorder} ${theme.pageText}`}>
          {group.tableColumns?.length > 0 && (
            <thead>
              <tr>
                {group.tableColumns.map((col, ci) => (
                  <th
                    key={ci}
                    className={`border px-3 py-2 text-left font-semibold ${theme.tableBorder} ${theme.tableHeaderBg} ${theme.strongText}`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {(group.tableRows || []).map((row, ri) => (
              <tr key={ri}>
                {(row || []).map((cell, ci) => (
                  <td key={ci} className={`border px-3 py-2 align-top ${theme.tableBorder}`}>
                    {renderTextWithBlankMarkers(String(cell ?? ''), questionsByNumber, renderBlank)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {useWordBank && !reviewMode && (
        <WordBankChipTray chips={wb.chipsByGroupIndex[gi]} selectedItemId={wb.selectedItemId} onChipClick={wb.onChipClick} theme={theme} />
      )}
      {/* Same reasoning as NoteCompletionGroup's panel above — one
          consolidated key below the whole table rather than a box wedged
          into individual cells, which would blow out fixed column widths. */}
      {previewMode && (
        <GroupAnswerKeyPanel questions={group.questions} studentAnswers={reviewMode ? answers : undefined} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Matrix radio grid — Listening's "label the map/plan" task (e.g. "Where
 * are the following located? Choose the correct letter, A-H"). The map/plan
 * image sits beside a table: one column per shared option letter
 * (group.matrixOptions), one row per question, and a radio button in each
 * cell — plain single-choice-per-row, not drag-and-drop, so the same option
 * letter can be reused across rows (no "each letter once" constraint).
 * ---------------------------------------------------------------------- */
function MatrixMatchingGroup({ group, answers, onAnswerChange, previewMode = false, reviewMode = false, theme }) {
  const options = group.matrixOptions || [];
  // group.mapImageUrl is always a real HTTP(S) URL when set — see
  // ImageUploadDropzone.jsx/backend routes/testUpload.js's upload-image,
  // which returns an absolute URL built from the request's own
  // protocol+host, never a relative path or a file:// path — so a plain
  // <img src> here loads it exactly like any other image on the page, no
  // special CORS/relative-path handling needed. imageFailedToLoad only
  // covers the rarer case of a URL that WAS valid at authoring time but no
  // longer resolves (the file was moved/deleted server-side, or an older
  // test still carries a hand-typed URL from before this was a real
  // upload), so a student sees a clear message instead of a broken-image
  // icon.
  const [imageFailedToLoad, setImageFailedToLoad] = useState(false);

  // Proportional column widths (percentages that always sum to exactly
  // 100%) instead of fixed rem widths (the old w-56/w-10 approach) — fixed
  // px-equivalent widths are what forced the table wider than its column
  // whenever there were more than a handful of options, which is what
  // triggered the "unnecessary" horizontal scrollbar. Expressing every
  // column as a % of the table's own width means table-fixed + w-full
  // ALWAYS exactly fills the right column, however many option letters
  // there are, with zero overflow. The Question column and (when present)
  // the Answer-key column get a fixed, generous share since they hold real
  // text; every option-letter column splits the remainder evenly, since
  // they only ever hold a single letter.
  const questionColPct = previewMode ? 30 : 38;
  const answerKeyColPct = previewMode ? 22 : 0;
  const optionColPct = options.length > 0 ? (100 - questionColPct - answerKeyColPct) / options.length : 0;

  // The answer grid itself — identical whether it ends up in the right
  // column of a side-by-side split (an image is present) or full-width on
  // its own (no image at all). No overflow-x-auto here: the % -based
  // colgroup widths above are what actually keep this from ever needing a
  // horizontal scrollbar, at any normal column width.
  const answerGrid = (
    <div className="w-full">
      <table className={`w-full table-fixed border border-collapse text-sm ${theme.tableBorder} ${theme.pageText}`}>
          <colgroup>
            <col style={{ width: `${questionColPct}%` }} />
            {options.map((opt) => (
              <col key={opt} style={{ width: `${optionColPct}%` }} />
            ))}
            {previewMode && <col style={{ width: `${answerKeyColPct}%` }} />}
          </colgroup>
          <thead>
            <tr>
              {/* Width now comes entirely from the colgroup above, not a
                  fixed w-56/w-10 class here — see questionColPct/
                  optionColPct. */}
              <th className={`border px-3 py-2 text-left font-semibold ${theme.tableBorder} ${theme.tableHeaderBg} ${theme.strongText}`}>
                Question
              </th>
              {options.map((opt) => (
                <th
                  key={opt}
                  className={`border px-2 py-2 text-center font-semibold ${theme.tableBorder} ${theme.tableHeaderBg} ${theme.strongText}`}
                >
                  {opt}
                </th>
              ))}
              {/* Extends the same grid with one more column rather than
                  injecting a box per row — an answer key column keeps this
                  a single table, never breaking its fixed row/column
                  structure (same reasoning as GroupAnswerKeyPanel above). */}
              {previewMode && (
                <th className="border border-sky-300 bg-sky-50 px-3 py-2 text-center font-semibold text-sky-700">
                  {reviewMode ? 'Your answer' : 'Answer key'}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {group.questions.map((q) => {
              const given = answers[q.questionNumber];
              const isCorrect = reviewMode ? isAnswerCorrect(given, q.correctAnswer) : null;
              return (
                <tr key={q.questionNumber}>
                  {/* Number badge (same IELTS blue used by
                     InlineBlankInput/WordBankDropSlot's number box) PLUS the
                     question's own prompt text right beside it — e.g. "17.
                     bridge foundations" — so a student can actually read
                     what each row refers to instead of just seeing a bare
                     number with no label. */}
                  <td className={`border px-3 py-2 text-left align-top ${theme.tableBorder}`}>
                    <span
                      className={`mr-2 inline-flex h-5 min-w-[1.4rem] shrink-0 items-center justify-center rounded border-2 px-1 align-middle text-xs font-bold ${theme.numberBadgeBorder} ${theme.accentBg} ${theme.accentText}`}
                    >
                      {q.questionNumber}
                    </span>
                    <span className={`break-words align-middle ${theme.pageText}`}>{q.prompt}</span>
                  </td>
                  {options.map((opt) => (
                    <td key={opt} className={`border px-2 py-2 text-center ${theme.tableBorder}`}>
                      <input
                        type="radio"
                        name={`matrix-${q.questionNumber}`}
                        checked={given === opt}
                        onChange={() => onAnswerChange(q.questionNumber, opt)}
                        disabled={reviewMode}
                        aria-label={`Question ${q.questionNumber}, option ${opt}`}
                        className="h-4 w-4 accent-[#0078D4]"
                      />
                    </td>
                  ))}
                  {previewMode && (
                    <td
                      className={`break-words border px-3 py-2 text-center align-top ${
                        reviewMode
                          ? isCorrect
                            ? 'border-emerald-200 bg-emerald-50'
                            : 'border-rose-200 bg-rose-50'
                          : 'border-sky-200 bg-sky-50'
                      }`}
                    >
                      {reviewMode && (
                        <p className={`font-semibold ${isCorrect ? 'text-emerald-800' : 'text-rose-800'}`}>
                          {formatCorrectAnswer(given) || '(none)'} {isCorrect ? '✓' : '✕'}
                        </p>
                      )}
                      {(!reviewMode || !isCorrect) && (
                        <p className={`font-semibold ${reviewMode ? 'mt-1 text-rose-800' : 'text-sky-800'}`}>
                          {reviewMode ? 'Correct: ' : ''}
                          {formatCorrectAnswer(q.correctAnswer)}
                        </p>
                      )}
                      {q.explanation && (
                        <p className={`mt-1 text-xs leading-snug ${reviewMode ? (isCorrect ? 'text-emerald-700' : 'text-rose-700') : 'text-sky-700'}`}>
                          {q.explanation}
                        </p>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
    </div>
  );

  // No image at all — full-width single column, same shape this renderer
  // always had before an image existed to split against. Still shows a
  // compact fallback notice (never a blank gap) so a student never has to
  // wonder whether a map was supposed to be here.
  if (!group.mapImageUrl) {
    return (
      <div className="flex flex-col gap-6">
        <div className={`flex items-center justify-center rounded border border-dashed p-6 text-center text-xs italic ${theme.panelBorder} ${theme.faintText}`}>
          No map/plan/diagram image was provided for this question group.
        </div>
        {answerGrid}
      </div>
    );
  }

  // Engnovate-style side-by-side split: map/plan on the left, its answer
  // grid on the right, so a student can look at the image and click radio
  // buttons in the SAME viewport without scrolling past a stacked image
  // first (the old flex-col layout this replaced). A 12-col grid (rather
  // than a plain 2-up split) lets the image column carry a bit more weight
  // than the table — col-span-7/5 instead of an even 6/6 — since the image
  // is what needs the room to stay legible, while the table's own %-based
  // colgroup widths (above) already guarantee it never overflows however
  // narrow its column gets. Single column below the xl breakpoint — a real
  // side-by-side split at narrower/tablet widths would squeeze both the
  // image and the grid too tight to read either one.
  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
      <div className={`flex items-center justify-center rounded border p-2 xl:col-span-7 ${theme.panelBorder} ${theme.panelBg}`}>
        {imageFailedToLoad ? (
          <div className={`flex w-full items-center justify-center rounded border border-dashed p-6 text-center text-xs italic ${theme.panelBorder} ${theme.faintText}`}>
            Couldn't load this image — it may have been moved or deleted. Ask your teacher to re-upload it.
          </div>
        ) : (
          // max-h-[700px] + w-full keeps the map/plan large and prominent —
          // every lettered location clearly legible at a glance, no
          // vertical scrolling needed — while object-contain still
          // preserves its real aspect ratio instead of stretching it, and
          // still caps out at max-h-[700px] so a very tall image never
          // pushes the whole panel out of the viewport.
          <img
            src={group.mapImageUrl}
            alt="Map or plan for this question group"
            className="max-h-[700px] w-full rounded object-contain"
            onError={() => setImageFailedToLoad(true)}
          />
        )}
      </div>
      <div className="xl:col-span-5">{answerGrid}</div>
    </div>
  );
}

// True when a group carries real, renderable note-layout content — i.e. a
// non-empty `layoutText` with at least one blank marker in it (see
// GROUP_BLANK_MARKER above; accepts both "{{n}}" and legacy "[[n]]"). This
// is deliberately independent of `questionType`/module: whatever authored
// this group (manual entry, JSON/AI import, a PDF extractor, Reading or
// Listening) sometimes saves layoutText under a mismatched or stale
// questionType label ('fill-in-the-blank', 'short-answer', etc.) — the
// presence of real layout content, not the label, is what should decide
// whether the rich-text/cloze renderer applies. See QuestionGroupBody below.
function groupHasLayoutText(group) {
  if (!group || typeof group.layoutText !== 'string' || !group.layoutText.trim()) return false;
  GROUP_BLANK_MARKER.lastIndex = 0;
  return GROUP_BLANK_MARKER.test(group.layoutText);
}

// Group types that render as BoxMatchingRenderer's "choose your answer from
// the box" layout when they actually carry wordBank options — see
// QuestionGroupBody's useBoxMatching below. 'matching' / 'box-selection'
// are accepted as forward-compatible synonyms alongside the real
// questionType this app's own wizards save ('matching-information').
// Deliberately excludes 'matching-heading': that type's real answer
// surface is the passage-side drop zones (part.headingBank/PassagePane),
// not this group-level wordBank, even though a matching-heading group may
// also happen to carry one (Reading's headingsPool import path sets both).
const MATCHING_BOX_TYPES = ['matching-information', 'matching', 'box-selection'];

/** Dispatches a question group to its Cambridge-style renderer, if it has one. */
function QuestionGroupBody({
  group,
  gi,
  answers,
  onAnswerChange,
  onToggleMultiAnswer,
  wb,
  previewMode = false,
  reviewMode = false,
  theme,
}) {
  // Rich-text/cloze note block — the SAME component and code path for every
  // module (reading, listening, ...), no module check anywhere in this
  // function. Two ways in: an explicit 'note-completion'/'summary-completion'
  // questionType (Cambridge's two note/summary-style layouts render
  // identically — a bordered block of prose+bullets with inline blanks), OR
  // — regardless of questionType — a group that actually has layoutText
  // content (groupHasLayoutText), so a mislabeled group still renders
  // correctly instead of silently falling back to a flat list of inputs.
  if (
    group.questionType === 'note-completion' ||
    group.questionType === 'summary-completion' ||
    groupHasLayoutText(group)
  ) {
    return (
      <NoteCompletionGroup
        group={group}
        gi={gi}
        answers={answers}
        onAnswerChange={onAnswerChange}
        onToggleMultiAnswer={onToggleMultiAnswer}
        wb={wb}
        previewMode={previewMode}
        reviewMode={reviewMode}
        theme={theme}
      />
    );
  }
  if (group.questionType === 'matrix-matching') {
    return (
      <MatrixMatchingGroup
        group={group}
        answers={answers}
        onAnswerChange={onAnswerChange}
        previewMode={previewMode}
        reviewMode={reviewMode}
        theme={theme}
      />
    );
  }
  if (group.questionType === 'table-completion') {
    return (
      <TableCompletionGroup
        group={group}
        gi={gi}
        answers={answers}
        onAnswerChange={onAnswerChange}
        onToggleMultiAnswer={onToggleMultiAnswer}
        wb={wb}
        previewMode={previewMode}
        reviewMode={reviewMode}
        theme={theme}
      />
    );
  }

  // Cambridge/Engnovate-style two-column drag-and-drop matching — a sticky
  // shared options box a student drags (or clicks) options out of, onto a
  // dashed drop target next to each statement (see
  // components/common/BoxMatchingRenderer.jsx's doc comment). It plugs
  // straight into the SAME wb (chipRegistry/placements/DndContext) every
  // other word-bank renderer here uses, so it needs `wb`+`gi`, not
  // `onAnswerChange` — `answers` is only its reviewMode fallback (see
  // WordBankQuestionItem's identical fallback below for why). Deliberately
  // separate from matching-heading below: heading-matching's real answer
  // surface is the passage-side drop zones (part.headingBank/PassagePane),
  // not this group-level wordBank, so it stays on the drag-and-drop path
  // further down. Same module-agnostic reasoning as groupHasLayoutText
  // above: this is gated on the group actually carrying wordBank options,
  // not just the label, so Reading and Listening render identically from
  // the same data shape with no module check anywhere here.
  const useBoxMatching = MATCHING_BOX_TYPES.includes(group.questionType) && Array.isArray(group.wordBank) && group.wordBank.some((o) => o && o.trim());
  if (useBoxMatching) {
    return (
      <BoxMatchingRenderer
        group={group}
        gi={gi}
        wb={wb}
        answers={answers}
        previewMode={previewMode}
        reviewMode={reviewMode}
        theme={theme}
      />
    );
  }

  const useWordBank = Boolean(wb) && wb.chipsByGroupIndex[gi] !== undefined;
  if (useWordBank) {
    return (
      <>
        {group.questions.map((q) => (
          <WordBankQuestionItem
            key={q.questionNumber}
            question={q}
            wb={wb}
            previewMode={previewMode}
            reviewMode={reviewMode}
            studentAnswer={reviewMode ? answers[q.questionNumber] : undefined}
            theme={theme}
          />
        ))}
        {!reviewMode && (
          <WordBankChipTray chips={wb.chipsByGroupIndex[gi]} selectedItemId={wb.selectedItemId} onChipClick={wb.onChipClick} theme={theme} />
        )}
      </>
    );
  }

  return (
    <>
      {group.questions.map((q) => (
        <QuestionItem
          key={q.questionNumber}
          question={q}
          value={answers[q.questionNumber]}
          onAnswerChange={onAnswerChange}
          onToggleMultiAnswer={onToggleMultiAnswer}
          previewMode={previewMode}
          reviewMode={reviewMode}
          theme={theme}
        />
      ))}
    </>
  );
}

function QuestionItem({
  question,
  value,
  onAnswerChange,
  onToggleMultiAnswer,
  previewMode = false,
  reviewMode = false,
  theme,
}) {
  const { questionNumber, prompt, type, options } = question;
  const isChoice = ['true-false-not-given', 'yes-no-not-given', 'multiple-choice'].includes(type);
  const isMulti = type === 'multiple-select';
  const isInput = ['fill-in-the-blank', 'short-answer'].includes(type);
  const selectedMulti = isMulti && Array.isArray(value) ? value : [];

  const numberBadge = (
    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-bold ${theme.numberBadgeBorder} ${theme.numberBadgeText}`}>
      {questionNumber}
    </span>
  );

  return (
    <div id={`question-${questionNumber}`} className="mb-7">
      {isInput ? (
        <>
          <p className={`leading-loose ${theme.pageText}`}>
            {/* InlineBlankInput renders its own number box, so no separate
               badge is needed here — see InlineBlankInput above. */}
            {renderPromptWithBlank(prompt, (key) => (
              <InlineBlankInput
                key={key}
                questionNumber={questionNumber}
                wordLimit={question.wordLimit}
                value={value}
                onChange={onAnswerChange}
                disabled={reviewMode}
                theme={theme}
              />
            ))}
          </p>
          {/* Sibling to the <p>, not nested inside it — PreviewAnswerBox
              renders a <div>, and a block element inside a <p> is invalid
              HTML/React nesting. */}
          {previewMode && (
            <PreviewAnswerBox
              correctAnswer={question.correctAnswer}
              explanation={question.explanation}
              studentAnswer={reviewMode ? value : undefined}
            />
          )}
        </>
      ) : (
        <>
          <p className={`mb-3 flex items-start gap-3 font-medium ${theme.strongText}`}>
            {numberBadge}
            <span>{prompt}</span>
          </p>

          {isChoice && (
            <div className="ml-9 flex flex-col gap-1">
              {(options.length ? options : ['TRUE', 'FALSE', 'NOT GIVEN']).map((opt) => {
                const isSelected = value === opt;
                return (
                  <label
                    key={opt}
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                      isSelected ? `${theme.optionSelectedBg} ${theme.optionSelectedText}` : `${theme.pageText} ${theme.optionHoverBg}`
                    } ${reviewMode ? 'cursor-default' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`q-${questionNumber}`}
                      checked={isSelected}
                      onChange={() => onAnswerChange(questionNumber, opt)}
                      disabled={reviewMode}
                      className="h-4 w-4 accent-[#0078D4] focus:ring-blue-400"
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          )}

          {isMulti && (
            <div className="ml-9 flex flex-col gap-1">
              {options.map((opt) => {
                const isSelected = selectedMulti.includes(opt);
                return (
                  <label
                    key={opt}
                    className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                      isSelected ? `${theme.optionSelectedBg} ${theme.optionSelectedText}` : `${theme.pageText} ${theme.optionHoverBg}`
                    } ${reviewMode ? 'cursor-default' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleMultiAnswer(questionNumber, opt)}
                      disabled={reviewMode}
                      className="h-4 w-4 rounded accent-[#0078D4] focus:ring-blue-400"
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          )}

          {previewMode && (
            <PreviewAnswerBox
              correctAnswer={question.correctAnswer}
              explanation={question.explanation}
              studentAnswer={reviewMode ? (isMulti ? selectedMulti : value) : undefined}
            />
          )}
        </>
      )}
    </div>
  );
}

function BottomPagination({
  parts,
  activePartIndex,
  onChangePart,
  answeredQuestionNumbers,
  onSubmitTest,
  focusedQuestionNumber,
  onJumpToQuestion,
  // Set only for preview/attempt (see TestInterface's own submitLabel prop
  // above) — swaps the real student's icon-only Submit button for a
  // labeled one ("Exit Preview" / "End Attempt") and skips the confirm()
  // dialog below, since neither mode ever saves anything a confirmation
  // would need to protect.
  submitLabel,
  theme,
}) {
  const partStats = useMemo(
    () =>
      parts.map((p) => {
        const nums = getPartQuestionNums(p);
        const answeredCount = nums.filter((n) => answeredQuestionNumbers.has(n)).length;
        return { nums, answeredCount };
      }),
    [parts, answeredQuestionNumbers]
  );

  // Inspera scales its pill size down as a test carries more questions
  // overall (a 40-question Listening/Reading test needs noticeably smaller
  // pills than a short practice set) rather than resizing per-part — every
  // part uses the SAME pill size so the row reads as one consistent grid
  // as a student tabs between parts, not one that visibly resizes. Two
  // compact tiers only (never the old h-7 "chunky" size once a test carries
  // a real IELTS-scale question count) — h-7 is reserved for genuinely
  // short practice sets where there's no clipping risk at all.
  const totalQuestions = useMemo(() => parts.reduce((sum, p) => sum + getPartQuestionNums(p).length, 0), [parts]);
  const pillSizeClass = totalQuestions > 20 ? 'h-6 w-6 text-[10px] leading-none' : 'h-7 w-7 text-xs leading-none';

  return (
    // Strict single-row layout, matching the real Inspera footer: nowrap +
    // overflow-hidden everywhere, no overflow-x-auto scrollbar and no
    // wrap-to-a-second-line fallback either — if a row's content ever
    // genuinely can't fit, it clips rather than reflowing, exactly like the
    // real product (which relies on the same assumption this is calibrated
    // for: a standard IELTS test of 4 parts x 10 questions — see
    // totalQuestions/pillSizeClass above). Every pixel of spare width goes
    // to the ACTIVE part's pill row (min-w-0 flex-1) rather than every part
    // claiming an equal, wasteful 1/N slice — inactive parts are shrink-0
    // (their natural, compact "Part N · X of Y" width only).
    //
    // Spacing is deliberately owned by exactly ONE mechanism per gap — a
    // part's own leading `border-l pl-3` (skipped on the very first part)
    // — rather than ALSO putting a `gap-x-*` on the parent flex row, which
    // would silently double every gap (parent gap + child's own padding)
    // and was the main thing stealing width from the active part's pills.
    // Same reasoning for the submit button: its own `border-l pl-3` is the
    // only separator, no extra gap on the outer footer row beside it.
    <footer className={`flex shrink-0 flex-nowrap items-center justify-between overflow-hidden border-t px-4 py-2.5 ${theme.footerBorder} ${theme.footerBg}`}>
      <div className="flex min-w-0 flex-1 flex-nowrap items-center overflow-hidden">
        {parts.map((p, i) => {
          const isActive = i === activePartIndex;
          const stats = partStats[i];
          return (
            <div
              key={p.partNumber}
              className={`flex items-center gap-2 overflow-hidden ${isActive ? 'min-w-0 flex-1' : 'shrink-0'} ${
                i > 0 ? `border-l pl-3 ${theme.footerBorder}` : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onChangePart(i)}
                className={`shrink-0 whitespace-nowrap text-sm font-bold transition ${
                  isActive ? theme.strongText : `${theme.footerText} ${theme.iconHover}`
                }`}
              >
                Part {p.partNumber}
              </button>

              {isActive ? (
                <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden">
                  {stats.nums.map((n) => {
                    const isAnswered = answeredQuestionNumbers.has(n);
                    const isFocused = n === focusedQuestionNumber;
                    return (
                      <div key={n} className="flex shrink-0 flex-col items-center gap-1">
                        <span className={`h-1 w-full rounded-full ${isAnswered ? 'bg-blue-500' : 'bg-transparent'}`} />
                        <button
                          type="button"
                          onClick={() => onJumpToQuestion(n)}
                          aria-current={isFocused ? 'true' : undefined}
                          className={`flex shrink-0 items-center justify-center rounded font-semibold transition ${pillSizeClass} ${
                            isFocused
                              ? `border-2 border-blue-500 ${theme.strongText}`
                              : `border ${theme.footerBorder} ${theme.footerText} ${theme.optionHoverBg}`
                          }`}
                        >
                          {n}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <span className={`shrink-0 whitespace-nowrap text-xs font-medium ${theme.footerMuted}`}>
                  {stats.answeredCount} of {stats.nums.length}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* One unified minimalist square icon button for every mode (real
          student submit, teacher preview, attempt, review) — matching the
          plain checkmark-only Inspera submit control exactly, rather than
          a bulky labeled button ("End Attempt"/"Exit Preview"/"Close
          Review") in the non-student cases. The distinct wording survives
          as the button's title/aria-label (a native tooltip on hover)
          instead of visible text, and only the real student-submit path
          keeps the confirm() dialog — preview/attempt/review never save
          anything a confirmation would need to protect, same as before. */}
      <div className={`flex shrink-0 items-center border-l pl-3 ${theme.footerBorder}`}>
        <button
          type="button"
          onClick={() => {
            if (submitLabel) {
              onSubmitTest();
              return;
            }
            if (window.confirm('Submit your test now? You will not be able to change your answers after submitting.')) {
              onSubmitTest();
            }
          }}
          aria-label={submitLabel || 'Submit test'}
          title={submitLabel || 'Submit test'}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border shadow-sm transition ${theme.footerBorder} ${theme.footerBg} ${theme.footerText} ${theme.iconHover}`}
        >
          <CheckIcon size={16} />
        </button>
      </div>
    </footer>
  );
}

function FloatingQuestionNav({ onPrev, onNext, hasPrev, hasNext }) {
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-20">
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={!hasPrev}
          aria-label="Previous question"
          title="Previous question"
          className="flex h-10 w-10 items-center justify-center rounded-md bg-neutral-900 text-white shadow-md transition hover:bg-neutral-800 disabled:opacity-40"
        >
          ←
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!hasNext}
          aria-label="Next question"
          title="Next question"
          className="flex h-10 w-10 items-center justify-center rounded-md bg-neutral-900 text-white shadow-md transition hover:bg-neutral-800 disabled:opacity-40"
        >
          →
        </button>
      </div>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CheckIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function WifiIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 8.5c5.5-5 14.5-5 20 0" strokeLinecap="round" />
      <path d="M5.5 12.5c3.7-3.3 9.3-3.3 13 0" strokeLinecap="round" />
      <path d="M9 16.5c1.8-1.6 4.2-1.6 6 0" strokeLinecap="round" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 10a6 6 0 1 1 12 0c0 4.5 1.5 6 1.5 6h-15S6 14.5 6 10Z" strokeLinejoin="round" />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M14.5 8.5l1 1-5 5-1.5.5.5-1.5 5-5Z" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fb7185" strokeWidth="2">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" strokeLinejoin="round" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" strokeLinecap="round" />
      <circle cx="12" cy="15" r="1.4" fill="#fb7185" stroke="none" />
    </svg>
  );
}
