import { useEffect, useRef } from 'react';

/**
 * useBackNavigation
 * ------------------
 * This app has no client-side router (see App.jsx's top-of-file comment) —
 * every full-screen transition (test-taking, a dashboard's drill-down
 * pages, wizards, previews, ...) is just a conditional render driven by
 * useState. That means the browser never gets a new history entry for any
 * of them: there's only ever the ONE entry the page loaded with, so
 * pressing the physical Back button has nothing of the app's own to step
 * back through — it exits straight past the app entirely (closes the tab,
 * lands on whatever was open before it, or goes to the device's home
 * screen) instead of undoing the most recent in-app navigation.
 *
 * This hook fixes that without introducing a routing library. Call it from
 * any component that owns a "screen" — a piece of state that, when
 * truthy/active, fully replaces what's currently on screen. While `active`
 * is true, it holds exactly one browser history entry open on that
 * screen's behalf. Popping that entry — via the physical Back button —
 * calls `onExit`, which should be the very same setter the screen's own
 * on-screen Back/Cancel button already calls (e.g. `() =>
 * setSelectedTest(null)`); no other wiring is required at the call site
 * beyond this one hook call.
 *
 * For the on-screen Back/Cancel button itself, prefer calling
 * `window.history.back()` instead of the setter directly — that routes the
 * click through the exact same popstate handler a physical Back press
 * uses, which is what keeps the browser's real history depth in sync with
 * how many screens are actually stacked (see the "if a screen closes some
 * other way" note below for what happens when a call site can't do this,
 * e.g. a Save action).
 *
 * Nests correctly for screens stacked several deep (e.g. dashboard → a
 * module's test grid → a test's question preview → its editor): every
 * concurrently-active screen registers into ONE shared stack behind a
 * single shared `popstate` listener. A plain per-hook listener would fire
 * for every nested level at once on a single Back press, since popstate
 * carries no information about which pushState it's undoing — routing
 * every pop through one shared stack is what makes only the innermost
 * level respond, exactly like native page-to-page back navigation.
 *
 * If a screen closes some other way (Save, Logout, ...) rather than via
 * Back, its entry is still removed from the shared stack right away, but
 * the matching browser history entry is left in place — a later Back press
 * just harmlessly consumes it with no visible effect (every onExit this
 * hook is given is an idempotent "reset this piece of state" setter), so
 * at worst the user needs one extra press to fully back out; nothing ever
 * breaks or exits the app.
 */
const backStack = [];
let listenerAttached = false;

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener('popstate', () => {
    const handler = backStack.pop();
    if (handler) handler();
  });
}

export function useBackNavigation(active, onExit) {
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    if (!active) return undefined;

    ensureListener();
    const handler = () => onExitRef.current();
    backStack.push(handler);
    window.history.pushState({ __appScreen: true }, '');

    return () => {
      const idx = backStack.lastIndexOf(handler);
      if (idx !== -1) backStack.splice(idx, 1);
    };
  }, [active]);
}
