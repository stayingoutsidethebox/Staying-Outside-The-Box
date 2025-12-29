// thank heavens for chatGPT <3
// Layout + page transitions controller for StayingOutsideTheBox.
// This file owns navigation animations, bfcache hygiene, and touch-safe tap handling.
// Starfield is treated as a “passenger” that we freeze/save during transitions.

/*======================================================================
 *  MENU
 *----------------------------------------------------------------------
 *  1) GLOBAL STATE + HELPERS
 *     - Transition guard flags
 *     - Timer hygiene for bfcache
 *     - Starfield freeze/save hooks
 *     - DOM helpers
 *     - Navigation type detection
 *     - Referrer analysis for back button behavior
 *
 *  2) SCROLL OWNERSHIP (DOCUMENT IS SCROLLER)
 *     - Restore default scrolling to the document
 *
 *  3) PAGE LOAD (SLIDE-IN + BACK BUTTON)
 *     - Apply slide duration
 *     - Trigger slide-in
 *     - Decide back button visibility + stored back URL
 *
 *  4) BACK/FORWARD CACHE (PAGESHOW)
 *     - Repair state after bfcache restores
 *
 *  5) TRANSITION NAVIGATION (SLIDE-OUT THEN LEAVE)
 *     - Animate out
 *     - Freeze+save near the end
 *     - Navigate on timer
 *
 *  6) TOUCH NAV FIXES (POINTER TAP VS SWIPE)
 *     - Tap-to-navigate with animation
 *     - Swipe-to-scroll remains native
 *====================================================================*/


/*======================================================================
 * #region 1) GLOBAL STATE + HELPERS
 *====================================================================*/

/* GROUP: Transition guard flag */
// Track whether a transition is currently running.
// This prevents double clicks/taps from stacking multiple navigations.
let IS_TRANSITION_ACTIVE = false;

/* GROUP: Starfield alias */
// Create a short alias to the STARFIELD namespace.
// Used only for freeze/save/resizing helpers.
var S = window.STARFIELD;

/* GROUP: Audio (disabled) */
// Optional “crunch” sound. Left disabled for now.
//const CRUNCH_SOUND = new Audio("/Resources/Crunch.mp3");
//CRUNCH_SOUND.preload = "auto";
//CRUNCH_SOUND.load();
//CRUNCH_SOUND.volume = 0.25;

/* GROUP: Pending transition timers */
// bfcache can resurrect timers if they were scheduled before leaving.
// We store handles so we can cancel them safely on pagehide/pageshow.
let SAVE_BEFORE_LEAVE_TIMEOUT_ID = null;     // Fires shortly before navigation
let NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = null;  // Fires when slide-out should finish

/* GROUP: Timer hygiene */
// Cancel any pending transition timers and reset handles.
// Prevents “ghost navigations” after bfcache restores.
function clearPendingTransitionTimers() {
  // Cancel the “save before leave” timeout if it exists.
  if (SAVE_BEFORE_LEAVE_TIMEOUT_ID) clearTimeout(SAVE_BEFORE_LEAVE_TIMEOUT_ID);

  // Cancel the “navigate after slide” timeout if it exists.
  if (NAVIGATE_AFTER_SLIDE_TIMEOUT_ID) clearTimeout(NAVIGATE_AFTER_SLIDE_TIMEOUT_ID);

  // Reset handles so we know nothing is scheduled.
  SAVE_BEFORE_LEAVE_TIMEOUT_ID = null;

  // Reset handles so we know nothing is scheduled.
  NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = null;
}

/* GROUP: Starfield freeze + save */
// Freeze starfield motion and persist the latest state.
// Called when leaving or backgrounding so the canvas doesn’t drift while hidden.
function freezeAndSaveStarfield() {
  // Bail if STARFIELD is not present on this page.
  // Some pages may not load the starfield bundle.
  if (!STARFIELD) return;

  // Freeze physics so nothing updates while we are transitioning away.
  S.isFrozen = true;

  // Persist current star state if the save function exists.
  // This is optional so pages without Setup storage can still work.
  if (typeof S.saveStarfieldToStorage === "function") {
    S.saveStarfieldToStorage();
  }
}

/* GROUP: Leave/return lifecycle */
// pagehide fires for real navigations and for bfcache entries.
// This is the most reliable “we are leaving” hook across browsers.
window.addEventListener("pagehide", () => {

  // Cancel any old timers so they cannot fire after a bfcache restore.
  clearPendingTransitionTimers();

  // Freeze + save right before leaving.
  freezeAndSaveStarfield();
});

/* GROUP: Backgrounding + tab switching */
// visibilitychange helps on mobile where pagehide may not fire immediately.
document.addEventListener("visibilitychange", () => {

  // Bail if STARFIELD is not present on this page.
  if (!STARFIELD) return;

  // When hidden, freeze + save so state doesn’t drift offscreen.
  if (document.visibilityState === "hidden") {
    freezeAndSaveStarfield();
  }
  // When visible again, allow the simulation to resume.
  else if (document.visibilityState === "visible") {
    S.isFrozen = false;
  }
});

/* GROUP: DOM helpers */
// Get the transition wrapper element.
// This container receives slide-in/out classes in CSS.
const getTransitionContainer = () => document.getElementById("transitionContainer");

// Determine whether this page appears to be the homepage.
// Used to decide longer animation timing.
const isHomepage = () => !!document.querySelector("#menuButton");

// Match CSS expectations: homepage is a longer slide than inner pages.
const getSlideDurationSeconds = () => (isHomepage() ? 1.2 : 0.6);

/* GROUP: Navigation type detection */
// Detect whether this page was restored via back/forward (often bfcache).
// We use this to repair state when a user returns without a full reload.
function isBackForwardNavigation(EVENT) {

  // Some browsers explicitly mark bfcache restores on pageshow.
  if (EVENT?.persisted) return true;

  // Prefer Navigation Timing API when available.
  try {
    return performance?.getEntriesByType?.("navigation")?.[0]?.type === "back_forward";
  } catch {
    // If the API fails or is unsupported, treat as not back/forward.
    return false;
  }
}

/* GROUP: Referrer analysis */
// Determine whether the referrer is internal and whether it was the Menu page.
// This controls whether the homepage back button should appear.
function getReferrerInfo() {

  // Read the browser-provided referrer string (may be empty).
  const REFERRER = document.referrer;

  // Track whether the referrer is same-origin.
  let IS_INTERNAL_REFERRER = false;

  // Track whether the referrer was the Menu page.
  let CAME_FROM_MENU_PAGE = false;

  // If there is no referrer, return default flags immediately.
  if (!REFERRER) return { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE };

  try {
    // Parse the referrer so we can reliably read origin and pathname.
    const REFERRER_URL = new URL(REFERRER);

    // Internal if the referrer origin matches the current site origin.
    IS_INTERNAL_REFERRER = REFERRER_URL.origin === location.origin;

    // Normalize the path for stable comparisons.
    const REFERRER_PATH = REFERRER_URL.pathname.toLowerCase();

    // Recognize common Menu URL forms.
    CAME_FROM_MENU_PAGE =
      REFERRER_PATH === "/menu" ||
      REFERRER_PATH === "/menu/" ||
      REFERRER_PATH.endsWith("/menu/index.html");
  } catch {
    // If parsing fails, treat referrer as external/unknown.
  }

  // Return raw referrer and computed flags.
  return { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE };
}

/* #endregion 1) GLOBAL STATE + HELPERS */



/*======================================================================
 * #region 2) SCROLL OWNERSHIP (DOCUMENT IS SCROLLER)
 *====================================================================*/

/* GROUP: Restore document scrolling */
// Switch scrolling responsibility back to the document.
// Some layouts temporarily make the container the scroller,
// but this function restores “normal” page flow.
function enableDocumentScroll(CONTAINER = getTransitionContainer()) {

  // Cache <html> so we can change overflow behavior.
  const HTML = document.documentElement;

  // Cache <body> so we can change overflow/height behavior.
  const BODY = document.body;

  // Save current scroll position from container (if used) or window (fallback).
  const SAVED_SCROLL_Y = CONTAINER?.scrollTop ?? window.scrollY ?? 0;

  // Make the document the scroller again.
  HTML.style.overflowY = "auto";

  // Allow body to flow naturally.
  BODY.style.overflow = "visible";

  // Restore body height to natural sizing.
  BODY.style.height = "auto";

  // Ensure the container does not trap scroll.
  if (CONTAINER) {
    CONTAINER.style.overflow = "visible";
    CONTAINER.style.height = "auto";
  }

  // Keep starfield canvas synced after layout changes (if available).
  if (STARFIELD && typeof S.resizeStarfieldCanvas === "function") {
    S.resizeStarfieldCanvas();
  }

  // Restore scroll on the next frame so style changes have applied.
  requestAnimationFrame(() => {
    try { window.scrollTo(0, SAVED_SCROLL_Y); } catch {}
  });
}

/* #endregion 2) SCROLL OWNERSHIP (DOCUMENT IS SCROLLER) */



/*======================================================================
 * #region 3) PAGE LOAD (SLIDE-IN + BACK BUTTON)
 *====================================================================*/

/* GROUP: Load-time animation setup */
// Run slide-in setup and back-button logic after all resources finish loading.
// Using "load" ensures fonts/images/layout are settled before slide-in begins.
window.addEventListener("load", () => {

  // Grab the transition container used for slide-in/out classes.
  const CONTAINER = getTransitionContainer();

  // Bail if there is no transition container on this page.
  if (!CONTAINER) return;

  // Publish slide duration for this page type into CSS.
  document.documentElement.style.setProperty(
    "--SLIDE_DURATION",
    `${getSlideDurationSeconds()}s`
  );

  // Trigger slide-in on the next frame so the class change animates.
  requestAnimationFrame(() => {
    CONTAINER.classList.add("ready");
  });

  /* GROUP: Back button logic */
  // Decide whether the homepage back button should be visible,
  // and store the correct URL for “back” when appropriate.
  const { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE } = getReferrerInfo();

  // Find the back link element if it exists on this page.
  const BACK_LINK = document.getElementById("homepageBack");

  // Bail if there is no back link element on this page.
  if (!BACK_LINK) return;

  // If we came from Menu, hide the back button.
  // The Menu is a deliberate navigation hub, not a “back trail.”
  if (CAME_FROM_MENU_PAGE) {
    BACK_LINK.style.display = "none";
    return;
  }

  // If the referrer is internal, show back and remember where we came from.
  if (IS_INTERNAL_REFERRER && REFERRER) {
    BACK_LINK.style.display = "block";
    localStorage.setItem("homepageBackUrl", REFERRER);
    return;
  }

  // External or unknown referrer: hide back and clear stored back URL.
  BACK_LINK.style.display = "none";
  localStorage.removeItem("homepageBackUrl");
});

/* #endregion 3) PAGE LOAD (SLIDE-IN + BACK BUTTON) */



/*======================================================================
 * #region 4) BACK/FORWARD CACHE (PAGESHOW)
 *====================================================================*/

/* GROUP: Repair state after bfcache restore */
// pageshow fires when a page is shown, including bfcache restores.
// We repair timers, transition flags, and CSS classes so the UI is stable.
window.addEventListener("pageshow", (EVENT) => {

  // Grab the transition container used for slide state.
  const CONTAINER = getTransitionContainer();

  // Bail if there is no transition container on this page.
  if (!CONTAINER) return;

  // Cancel revived timers immediately.
  clearPendingTransitionTimers();

  // Unfreeze starfield when returning (if present).
  if (STARFIELD) S.isFrozen = false;

  // Only apply the rest of this block for true back/forward restores.
  if (!isBackForwardNavigation(EVENT)) return;

  // Ensure we are in a stable “ready” state (not mid-slide).
  CONTAINER.classList.remove("slide-out");
  CONTAINER.classList.add("ready");

  // Reset guard flag so navigation works again.
  IS_TRANSITION_ACTIVE = false;

  // Reset container scroll position to a safe baseline.
  CONTAINER.scrollTop = 0;
});

/* #endregion 4) BACK/FORWARD CACHE (PAGESHOW) */



/*======================================================================
 * #region 5) TRANSITION NAVIGATION (SLIDE-OUT THEN LEAVE)
 *====================================================================*/

/* GROUP: Transition navigation entry point */
// Animate slide-out, then navigate after the animation duration.
// URL may be a real href or the special keyword "back".
function transitionTo(URL) {

  // Guard against double-triggering transitions.
  if (IS_TRANSITION_ACTIVE) return;

  // Guard against empty or invalid URLs.
  if (!URL) return;

  //CRUNCH_SOUND.pause(), CRUNCH_SOUND.play().catch(() => {});

  // Cancel any leftover timers from a previous transition.
  clearPendingTransitionTimers();

  // Mark that a transition is now running.
  IS_TRANSITION_ACTIVE = true;

  // Grab the transition container used for slide-out class.
  const CONTAINER = getTransitionContainer();

  /* GROUP: "back" keyword support */
  // Replace "back" with a stored internal referrer URL.
  if (URL === "back") {

    // Read stored back destination from localStorage.
    const STORED_BACK_URL = localStorage.getItem("homepageBackUrl");

    // If missing, abort and re-enable transitions.
    if (!STORED_BACK_URL) {
      IS_TRANSITION_ACTIVE = false;
      return;
    }

    // Replace keyword with actual destination URL.
    URL = STORED_BACK_URL;
  }

  /* GROUP: No container fallback */
  // If transition container is missing, navigate immediately without animation.
  if (!CONTAINER) {
    location.href = URL;
    return;
  }

  /* GROUP: Slide distance computation */
  // Slide distance is the viewport height (slightly padded) plus current scroll.
  // This ensures the page fully clears even if the user has scrolled.
  const SLIDE_DISTANCE_PX = (window.innerHeight * 1.1) + (window.scrollY ?? 0);

  // Publish slide distance to CSS for the slide-out transform.
  document.documentElement.style.setProperty("--SLIDE_DISTANCE", `${SLIDE_DISTANCE_PX}px`);

  /* GROUP: Start slide-out */
  // Add class that triggers the CSS slide-out animation.
  CONTAINER.classList.add("slide-out");

  /* GROUP: Timer scheduling */
  // Convert slide duration to milliseconds for setTimeout scheduling.
  const DURATION_MS = getSlideDurationSeconds() * 1000;

  // Freeze+save shortly before navigation so the starfield persists cleanly.
  SAVE_BEFORE_LEAVE_TIMEOUT_ID = setTimeout(
    freezeAndSaveStarfield,
    Math.max(0, DURATION_MS - 50)
  );

  // Navigate when the slide-out animation should be finished.
  NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = setTimeout(() => {
    location.href = URL;
  }, DURATION_MS);
}

/* #endregion 5) TRANSITION NAVIGATION (SLIDE-OUT THEN LEAVE) */



/*======================================================================
 * #region 6) TOUCH NAV FIXES (POINTER TAP VS SWIPE)
 *====================================================================*/

/* GROUP: Small DOM utility */
// Toggle an element’s hidden state by id.
function toggleElement(ELEMENT_ID) {

  // Bail if no id was provided.
  if (!ELEMENT_ID) return;

  // Find the element by id.
  const ELEMENT = document.getElementById(ELEMENT_ID);

  // Flip hidden state if the element exists.
  if (ELEMENT) ELEMENT.hidden = !ELEMENT.hidden;
}

/* GROUP: Tap-to-navigate without breaking scroll */
// Converts touch taps into animated navigation,
// while preserving swipe gestures for native scrolling.
function wirePointerNavigation(SELECTOR = "a") {

  // Collect all navigable elements matching the selector.
  const NAV_ITEMS = document.querySelectorAll(SELECTOR);

  // Bail if there are no matching elements.
  if (!NAV_ITEMS.length) return;

  // Wire gesture logic for each navigable element.
  NAV_ITEMS.forEach((ELEMENT) => {

    // Store gesture starting X coordinate.
    let START_X = 0;

    // Store gesture starting Y coordinate.
    let START_Y = 0;

    // Track whether the user moved enough to count as a swipe.
    let DID_MOVE = false;

    // Track the active pointer id so we only respond to the same finger.
    let ACTIVE_POINTER_ID = null;

    /* GROUP: Pointer down */
    // Begin tracking a touch gesture on this element.
    ELEMENT.addEventListener(
      "pointerdown",
      (EVENT) => {

        // Ignore non-touch pointers so mouse clicks behave normally.
        if (EVENT.pointerType !== "touch") return;

        // Store the pointer id for later move/up matching.
        ACTIVE_POINTER_ID = EVENT.pointerId;

        // Reset swipe detection for this new gesture.
        DID_MOVE = false;

        // Record the starting position of this gesture.
        START_X = EVENT.clientX;
        START_Y = EVENT.clientY;

        // Capture the pointer so we keep receiving events even if the finger drifts.
        try { ELEMENT.setPointerCapture(ACTIVE_POINTER_ID); } catch {}
      },
      { passive: true }
    );

    /* GROUP: Pointer move */
    // Track movement to decide whether this is a tap or swipe.
    ELEMENT.addEventListener(
      "pointermove",
      (EVENT) => {

        // Ignore move events from other pointers.
        if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

        // If finger moved beyond threshold, classify as swipe/drag.
        if (Math.hypot(EVENT.clientX - START_X, EVENT.clientY - START_Y) > 10) {
          DID_MOVE = true;
        }
      },
      { passive: true }
    );

    /* GROUP: Pointer up */
    // Decide whether to navigate (tap) or do nothing (swipe).
    ELEMENT.addEventListener(
      "pointerup",
      (EVENT) => {

        // Ignore up events from other pointers.
        if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

        // Release capture now that the gesture has ended.
        try { ELEMENT.releasePointerCapture(ACTIVE_POINTER_ID); } catch {}

        // Clear pointer id so the next gesture starts fresh.
        ACTIVE_POINTER_ID = null;

        // If user swiped/dragged, do nothing and remove sticky focus.
        if (DID_MOVE) {
          try { ELEMENT.blur(); } catch {}
          return;
        }

        // Tap: prevent default so we can run animated navigation instead.
        EVENT.preventDefault();

        // Special case: homepage back button navigates via stored referrer.
        if (ELEMENT.id === "homepageBack") {
          transitionTo("back");
          return;
        }

        // Read the element’s href attribute.
        const HREF = ELEMENT.getAttribute("href");

        // Bail if there is no href.
        if (!HREF) return;

        // Trigger slide-out transition and navigate.
        transitionTo(HREF);
      },
      { passive: false }
    );

    /* GROUP: Pointer cancel */
    // Clean up if the browser cancels the gesture.
    ELEMENT.addEventListener(
      "pointercancel",
      () => {

        // Clear pointer id so the next gesture starts fresh.
        ACTIVE_POINTER_ID = null;

        // Clear focus to avoid sticky outlines on iOS.
        try { ELEMENT.blur(); } catch {}
      },
      { passive: true }
    );
  });
}

/* GROUP: Wire after DOM is ready */
// Attach touch navigation overrides once elements exist in the DOM.
document.addEventListener("DOMContentLoaded", () => wirePointerNavigation());

/* #endregion 6) TOUCH NAV FIXES (POINTER TAP VS SWIPE) */