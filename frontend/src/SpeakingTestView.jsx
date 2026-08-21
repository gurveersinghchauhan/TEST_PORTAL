import { useEffect, useState } from 'react';

/**
 * SpeakingTestView
 * ----------------
 * Student-facing rendering for the IELTS Speaking module inside
 * TestInterface.jsx (see its `moduleType === 'speaking'` branch). Two
 * exports:
 *
 *   - SpeakingPart2Pane — the real deliverable: the official Part 2
 *     structured timing + full-screen cue card flow (prep countdown,
 *     then a speaking count-up). This is the only part of a Speaking
 *     test with actual timing rules, so it's the only one that gets a
 *     dedicated, bespoke UI.
 *   - SpeakingPromptsPane — a plain read-only prompt list for Parts 1 & 3
 *     (a spoken interview/discussion — nothing to type, nothing to time
 *     against a rubric), so switching part tabs on a Speaking test never
 *     falls through to the Reading/Listening split-pane layout, which
 *     assumes a passage and answerable questions neither part has.
 *
 * Reads the same Part 2 shape SpeakingTestWizard.jsx writes and
 * PracticeTests.jsx's SpeakingPreviewParts already renders for the
 * teacher-facing preview (backend/models/Test.js's partSchema): the cue
 * card TOPIC lives in `passageText`, its "You should say:" bullets in
 * `cueCardBullets`, and the standard rubric in `instructions`.
 */

const PREP_SECONDS = 60;
const SPEAK_SECONDS = 120;

function formatMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * SpeakingPart2Pane
 * ------------------
 * Renders Part 2 as the boxed cue card itself (topic + "You should say:"
 * bullets, always visible — never hidden behind a click) plus a Full
 * Screen / Expand icon button in its corner and a prominent text button
 * below it. Either one is what actually starts Part 2 (matches the real
 * exam: the examiner hands over the cue card and starts the clock
 * together) and opens the distraction-free full-screen cue card overlay.
 * Inside that overlay:
 *
 *   Phase 1 — "prep": a 1-minute countdown (60 -> 00:00) for reading the
 *   card and making notes. Hits zero and auto-advances to Phase 2 with no
 *   action needed from the student.
 *
 *   Phase 2 — "speaking": a count-up timer from 00:00 to 02:00 for the
 *   actual 2-minute response. Hits 02:00 and auto-advances to "finished" —
 *   the overlay stays open (rather than yanking the student out mid-
 *   sentence) with a clear "time's up" indicator and an explicit button to
 *   close it and return to the test.
 *
 * Timers are driven by a simple 1-second setInterval tick (same pattern
 * TestInterfaceSession.jsx uses for its own local countdown) rather than a
 * wall-clock timestamp diff — this is a short, foreground, per-part
 * practice timer, not something that needs to survive a backgrounded tab
 * with drift-correction.
 *
 * @param {{ part: object, theme: object }} props
 */
export function SpeakingPart2Pane({ part, theme }) {
  const topic = part?.passageText || '';
  const bullets = Array.isArray(part?.cueCardBullets) ? part.cueCardBullets.filter((b) => b && b.trim()) : [];
  const rubric = part?.instructions || '';

  // 'idle' (not yet opened) -> 'prep' (Phase 1) -> 'speaking' (Phase 2) ->
  // 'finished' (2:00 reached, overlay still open until the student closes it).
  const [phase, setPhase] = useState('idle');
  const [prepSecondsLeft, setPrepSecondsLeft] = useState(PREP_SECONDS);
  const [speakSecondsElapsed, setSpeakSecondsElapsed] = useState(0);
  const [hasCompletedOnce, setHasCompletedOnce] = useState(false);

  const overlayOpen = phase !== 'idle';

  function startPart2() {
    setPrepSecondsLeft(PREP_SECONDS);
    setSpeakSecondsElapsed(0);
    setPhase('prep');
  }

  function closeOverlay() {
    setPhase('idle');
  }

  // Phase 1 — 1-minute prep countdown; hits zero -> auto-advance to Phase 2.
  useEffect(() => {
    if (phase !== 'prep') return undefined;
    const id = setInterval(() => {
      setPrepSecondsLeft((s) => {
        if (s <= 1) {
          setPhase('speaking');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Phase 2 — 2-minute speaking count-up; hits 2:00 -> auto-advance to 'finished'.
  useEffect(() => {
    if (phase !== 'speaking') return undefined;
    const id = setInterval(() => {
      setSpeakSecondsElapsed((s) => {
        if (s + 1 >= SPEAK_SECONDS) {
          setPhase('finished');
          setHasCompletedOnce(true);
          return SPEAK_SECONDS;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center gap-5 px-6 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <MicIcon className="h-7 w-7" />
        </div>
        <div>
          <h2 className={`text-lg font-bold ${theme.strongText}`}>
            {hasCompletedOnce ? 'Part 2 complete' : 'Ready for Part 2?'}
          </h2>
          <p className={`mx-auto mt-2 max-w-md text-sm leading-relaxed ${theme.mutedText}`}>
            {hasCompletedOnce
              ? 'You can review the cue card again, or move on to Part 3 using the tabs below.'
              : "You'll get 1 minute to read the cue card and make notes, then you'll speak for up to 2 minutes on the topic."}
          </p>
        </div>
      </div>

      {/* The cue card itself, always visible here (not hidden behind the
          button) — same boxed topic + "You should say:" bullets format
          used elsewhere (PracticeTests.jsx's SpeakingPreviewParts). The
          Full Screen / Expand icon in its corner is what actually starts
          Part 2: the exam clock and the distraction-free full-screen
          presentation always start together, matching the real exam (the
          examiner hands over the card and starts the clock at the same
          moment) — there's no way to see the fullscreen presenter without
          also starting the timed sequence. */}
      <div className={`relative rounded-2xl border-2 p-6 text-left shadow-sm ${theme.panelBorder} ${theme.panelBg}`}>
        <button
          type="button"
          onClick={startPart2}
          aria-label="Expand cue card to full screen and start Part 2"
          title="Full screen"
          className={`absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg border shadow-sm transition ${theme.panelBorder} ${theme.panelBg} ${theme.iconMuted} ${theme.iconHover}`}
        >
          <ExpandIcon className="h-4 w-4" />
        </button>

        <p className={`pr-12 text-base font-bold leading-relaxed ${theme.strongText}`}>{topic}</p>

        {bullets.length > 0 && (
          <>
            <p className={`mt-4 text-xs font-semibold uppercase tracking-wide ${theme.faintText}`}>You should say:</p>
            <ul className="mt-2 space-y-1.5">
              {bullets.map((b, bi) => (
                <li key={bi} className={`flex items-start gap-2 text-sm leading-relaxed ${theme.mutedText}`}>
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                  {b}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={startPart2}
        className="mx-auto flex items-center gap-2 rounded-lg bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800"
      >
        <CueCardIcon className="h-4 w-4" />
        {hasCompletedOnce ? 'View Cue Card Again' : 'View Cue Card & Start Part 2'}
      </button>

      {overlayOpen && (
        <CueCardOverlay
          topic={topic}
          bullets={bullets}
          rubric={rubric}
          phase={phase}
          prepSecondsLeft={prepSecondsLeft}
          speakSecondsElapsed={speakSecondsElapsed}
          onClose={closeOverlay}
        />
      )}
    </div>
  );
}

/**
 * CueCardOverlay
 * --------------
 * The full-screen, distraction-free overlay itself. Covers the entire
 * viewport (fixed inset-0, high z-index) so the split-pane chrome, part
 * tabs, and everything else in TestInterface disappear behind it — only
 * the cue card and the current phase's timer are visible. Color-codes the
 * two phases (amber while reading/preparing, emerald once speaking has
 * started) so the student can tell which phase they're in at a glance,
 * even before reading the text label.
 *
 * Deliberately NOT theme-driven — like BlockedOverlay in TestInterface.jsx,
 * this is a distraction-free full-screen takeover with its own fixed dark
 * backdrop and a physical white "cue card" in the middle, always rendered
 * the same way regardless of the active contrast mode (a genuine card
 * always has dark text on a light/white background in real life).
 */
function CueCardOverlay({ topic, bullets, rubric, phase, prepSecondsLeft, speakSecondsElapsed, onClose }) {
  const isPrep = phase === 'prep';
  const isSpeaking = phase === 'speaking';
  const isFinished = phase === 'finished';

  const phaseAccent = isPrep
    ? { ring: 'ring-amber-400', bg: 'bg-amber-500', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-700 border-amber-200' }
    : isSpeaking
    ? { ring: 'ring-emerald-400', bg: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    : { ring: 'ring-neutral-300', bg: 'bg-neutral-500', text: 'text-neutral-700', chip: 'bg-neutral-100 text-neutral-700 border-neutral-200' };

  const timerLabel = isPrep ? formatMMSS(prepSecondsLeft) : formatMMSS(speakSecondsElapsed);
  const progressPct = isPrep
    ? ((PREP_SECONDS - prepSecondsLeft) / PREP_SECONDS) * 100
    : (Math.min(speakSecondsElapsed, SPEAK_SECONDS) / SPEAK_SECONDS) * 100;

  // Phase chip + big circular countdown + progress bar + status line,
  // factored out so it can be dropped into two different slots below: a
  // dedicated right-hand rail on lg+ screens, and a compact stacked block
  // above the card on narrower screens where there's no room for a true
  // side panel.
  const timerModule = (
    <div className="flex flex-col items-center gap-3 text-center">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${phaseAccent.chip}`}
      >
        {isPrep && 'Preparation Time'}
        {isSpeaking && 'Speaking Time'}
        {isFinished && "Time's Up"}
      </span>

      <div
        className={`flex h-24 w-24 items-center justify-center rounded-full bg-neutral-900 font-mono text-2xl font-bold text-white ring-4 ${phaseAccent.ring} lg:h-28 lg:w-28 lg:text-3xl`}
      >
        {timerLabel}
      </div>

      <div className="h-1.5 w-full max-w-[10rem] overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-linear ${phaseAccent.bg}`}
          style={{ width: `${Math.min(100, progressPct)}%` }}
        />
      </div>

      <p className="max-w-[11rem] text-xs font-medium leading-snug text-neutral-200">
        {isPrep && 'Read the cue card and make notes.'}
        {isSpeaking && 'Speak about the topic now — aim to keep going for up to 2 minutes.'}
        {isFinished && 'Please stop speaking. Close this card when you and the examiner are ready to continue.'}
      </p>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="IELTS Speaking Part 2 cue card"
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-neutral-950/95 px-4 py-8 backdrop-blur-sm sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            IELTS Speaking · Part 2
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cue card"
            title="Close"
            className="rounded-full p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Three-track layout at lg+: an empty spacer column, the cue card,
            then the timer rail — spacer and rail are both `1fr`, so they
            stay equal width and the card column between them lands exactly
            on the viewport's horizontal center regardless of how wide the
            timer panel itself is. The whole row is a single grid track that
            stretches to fill all the leftover vertical space below the
            header, so `lg:self-center` on the card centers it vertically
            too, while the timer rail (default `items-start`) stays pinned
            near the top — i.e. the "top-right corner" module the timer used
            to occupy, just no longer stacked on top of the card. Below lg
            there's no room for a real side rail, so it falls back to the
            original stacked layout (timer block above the card). */}
        <div className="mt-6 flex flex-1 flex-col gap-6 lg:grid lg:grid-cols-[1fr_minmax(0,42rem)_1fr] lg:items-start lg:gap-8">
          <div className="hidden lg:block" aria-hidden="true" />

          <div className="order-2 flex justify-center lg:order-none lg:col-start-2 lg:block lg:self-center">
            {/* Cue card itself — the boxed topic + "You should say:"
                bullets, same authentic format as PracticeTests.jsx's
                teacher-facing SpeakingPreviewParts, just scaled up for a
                full-screen read. With the timer module moved out of this
                column, the card is free to take true center stage. */}
            <div className="w-full max-w-2xl rounded-2xl border-2 border-white bg-white p-6 text-left shadow-2xl sm:p-8">
              <p className="text-lg font-bold leading-relaxed text-neutral-900 sm:text-xl">{topic}</p>

              {bullets.length > 0 && (
                <>
                  <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-neutral-500">You should say:</p>
                  <ul className="mt-3 space-y-2.5">
                    {bullets.map((b, bi) => (
                      <li key={bi} className="flex items-start gap-2.5 text-base leading-relaxed text-neutral-800">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {rubric && (
                // Bolder + darker than before (was text-xs text-neutral-500,
                // easy to skim past) — this line tells the student how long
                // they need to speak for, so it should read as an
                // instruction, not a footnote.
                <p className="mt-6 border-t border-neutral-200 pt-4 text-sm font-semibold leading-relaxed text-gray-800">
                  {rubric}
                </p>
              )}
            </div>
          </div>

          <div className="order-1 flex justify-center lg:order-none lg:col-start-3 lg:block lg:justify-self-end lg:pt-1">
            {timerModule}
          </div>
        </div>

        {isFinished && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-100"
            >
              Close &amp; Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * SpeakingPromptsPane
 * --------------------
 * Read-only interview/discussion prompt list for Parts 1 & 3 — plain
 * numbered questions with no answer input (spoken responses aren't typed)
 * and no timing UI of their own (only Part 2's cue card is a timed,
 * structured phase). Full-width, since there's no passage to split
 * against.
 *
 * @param {{ part: object, theme: object }} props
 */
export function SpeakingPromptsPane({ part, theme }) {
  const groups = part?.questionGroups || [];
  const allPrompts = groups.flatMap((g) => g.questions || []);

  return (
    <div className="min-h-0 w-full flex-1 overflow-y-auto pt-3">
      <div className="mx-auto max-w-3xl px-6 pb-10">
        {allPrompts.length === 0 ? (
          <p className={`mt-10 text-center text-sm italic ${theme.faintText}`}>No prompts have been added for this part yet.</p>
        ) : (
          groups.map((group, gi) => (
            <section key={gi} className="mb-8">
              {group.groupInstructions && (
                <h3 className={`mb-3 text-sm font-bold ${theme.strongText}`}>{group.groupInstructions}</h3>
              )}
              <ol className="space-y-3">
                {(group.questions || []).map((q) => (
                  <li key={q.questionNumber} id={`question-${q.questionNumber}`} className="flex items-start gap-3">
                    <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border text-xs font-bold ${theme.numberBadgeBorder} ${theme.numberBadgeText}`}>
                      {q.questionNumber}
                    </span>
                    <p className={`leading-relaxed ${theme.pageText}`}>{q.prompt}</p>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function MicIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  );
}

function CueCardIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </svg>
  );
}

function CloseIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ExpandIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 3H3v6M15 3h6v6M21 15v6h-6M3 15v6h6" />
    </svg>
  );
}
