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
  if (SAVE_BEFORE_LEAVE_TIMEOUT_ID) clearTimeout(SAVE_BEFORE_LEAVE_TIMEOUT_ID);
  if (NAVIGATE_AFTER_SLIDE_TIMEOUT_ID) clearTimeout(NAVIGATE_AFTER_SLIDE_TIMEOUT_ID);

  SAVE_BEFORE_LEAVE_TIMEOUT_ID = null;
  NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = null;
}

/* GROUP: Starfield freeze + save */
// Freeze starfield motion and persist the latest state.
// Called when leaving or backgrounding so the canvas doesn’t drift while hidden.
function freezeAndSaveStarfield() {

  // Re-alias in case this file loads before Setup on some pages.
  S = window.STARFIELD;

  // Bail if STARFIELD is not present on this page.
  // Some pages may not load the starfield bundle.
  if (!S) return;

  // Freeze physics so nothing updates while we are transitioning away.
  S.isFrozen = true;

  // Persist current star state if the save function exists.
  if (typeof S.saveStarfieldToStorage === "function") {
    S.saveStarfieldToStorage();
  }
}

/* GROUP: Leave/return lifecycle */
// pagehide fires for real navigations and for bfcache entries.
// This is the most reliable “we are leaving” hook across browsers.
window.addEventListener("pagehide", () => {
  clearPendingTransitionTimers();
  freezeAndSaveStarfield();
});

/* GROUP: Backgrounding + tab switching */
// visibilitychange helps on mobile where pagehide may not fire immediately.
document.addEventListener("visibilitychange", () => {

  // Re-alias in case this file loads before Setup on some pages.
  S = window.STARFIELD;

  // Bail if STARFIELD is not present on this page.
  if (!S) return;

  if (document.visibilityState === "hidden") {
    freezeAndSaveStarfield();
  } else if (document.visibilityState === "visible") {
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

  if (EVENT?.persisted) return true;

  try {
    return performance?.getEntriesByType?.("navigation")?.[0]?.type === "back_forward";
  } catch {
    return false;
  }
}

/* GROUP: Referrer analysis */
// Determine whether the referrer is internal and whether it was the Menu page.
// This controls whether the homepage back button should appear.
function getReferrerInfo() {

  const REFERRER = document.referrer;

  let IS_INTERNAL_REFERRER = false;
  let CAME_FROM_MENU_PAGE = false;

  if (!REFERRER) return { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE };

  try {
    const REFERRER_URL = new URL(REFERRER);
    IS_INTERNAL_REFERRER = REFERRER_URL.origin === location.origin;

    const REFERRER_PATH = REFERRER_URL.pathname.toLowerCase();

    CAME_FROM_MENU_PAGE =
      REFERRER_PATH === "/menu" ||
      REFERRER_PATH === "/menu/" ||
      REFERRER_PATH.endsWith("/menu/index.html");
  } catch {}

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

  const HTML = document.documentElement;
  const BODY = document.body;

  const SAVED_SCROLL_Y = CONTAINER?.scrollTop ?? window.scrollY ?? 0;

  HTML.style.overflowY = "auto";
  BODY.style.overflow = "visible";
  BODY.style.height = "auto";

  if (CONTAINER) {
    CONTAINER.style.overflow = "visible";
    CONTAINER.style.height = "auto";
  }

  // Keep starfield canvas synced after layout changes (if available).
  S = window.STARFIELD;
  if (S && typeof S.resizeStarfieldCanvas === "function") {
    S.resizeStarfieldCanvas();
  }

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

  const CONTAINER = getTransitionContainer();
  if (!CONTAINER) return;

  document.documentElement.style.setProperty(
    "--SLIDE_DURATION",
    `${getSlideDurationSeconds()}s`
  );

  requestAnimationFrame(() => {
    CONTAINER.classList.add("ready");
  });

  /* GROUP: Back button logic */
  const { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE } = getReferrerInfo();

  const BACK_LINK = document.getElementById("homepageBack");
  if (!BACK_LINK) return;

  if (CAME_FROM_MENU_PAGE) {
    BACK_LINK.style.display = "none";
    return;
  }

  if (IS_INTERNAL_REFERRER && REFERRER) {
    BACK_LINK.style.display = "block";
    localStorage.setItem("homepageBackUrl", REFERRER);
    return;
  }

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

  const CONTAINER = getTransitionContainer();
  if (!CONTAINER) return;

  clearPendingTransitionTimers();

  // Unfreeze starfield when returning (if present).
  S = window.STARFIELD;
  if (S) S.isFrozen = false;

  if (!isBackForwardNavigation(EVENT)) return;

  CONTAINER.classList.remove("slide-out");
  CONTAINER.classList.add("ready");

  IS_TRANSITION_ACTIVE = false;

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

  if (IS_TRANSITION_ACTIVE) return;
  if (!URL) return;

  //CRUNCH_SOUND.pause(), CRUNCH_SOUND.play().catch(() => {});

  clearPendingTransitionTimers();
  IS_TRANSITION_ACTIVE = true;

  const CONTAINER = getTransitionContainer();

  /* GROUP: "back" keyword support */
  if (URL === "back") {

    const STORED_BACK_URL = localStorage.getItem("homepageBackUrl");

    if (!STORED_BACK_URL) {
      IS_TRANSITION_ACTIVE = false;
      return;
    }

    URL = STORED_BACK_URL;
  }

  /* GROUP: No container fallback */
  if (!CONTAINER) {
    location.href = URL;
    return;
  }

  /* GROUP: Slide distance computation */
  const SLIDE_DISTANCE_PX = (window.innerHeight * 1.1) + (window.scrollY ?? 0);

  document.documentElement.style.setProperty("--SLIDE_DISTANCE", `${SLIDE_DISTANCE_PX}px`);

  /* GROUP: Start slide-out */
  CONTAINER.classList.add("slide-out");

  /* GROUP: Timer scheduling */
  const DURATION_MS = getSlideDurationSeconds() * 1000;

  SAVE_BEFORE_LEAVE_TIMEOUT_ID = setTimeout(
    freezeAndSaveStarfield,
    Math.max(0, DURATION_MS - 50)
  );

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
  if (!ELEMENT_ID) return;

  const ELEMENT = document.getElementById(ELEMENT_ID);
  if (ELEMENT) ELEMENT.hidden = !ELEMENT.hidden;
}

/* GROUP: Tap-to-navigate without breaking scroll */
// Converts touch taps into animated navigation,
// while preserving swipe gestures for native scrolling.
function wirePointerNavigation(SELECTOR = "a") {

  const NAV_ITEMS = document.querySelectorAll(SELECTOR);
  if (!NAV_ITEMS.length) return;

  NAV_ITEMS.forEach((ELEMENT) => {

    let START_X = 0;
    let START_Y = 0;
    let DID_MOVE = false;
    let ACTIVE_POINTER_ID = null;

    /* GROUP: Pointer down */
    ELEMENT.addEventListener(
      "pointerdown",
      (EVENT) => {

        if (EVENT.pointerType !== "touch") return;

        ACTIVE_POINTER_ID = EVENT.pointerId;

        DID_MOVE = false;

        START_X = EVENT.clientX;
        START_Y = EVENT.clientY;

        try { ELEMENT.setPointerCapture(ACTIVE_POINTER_ID); } catch {}
      },
      { passive: true }
    );

    /* GROUP: Pointer move */
    ELEMENT.addEventListener(
      "pointermove",
      (EVENT) => {

        if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

        if (Math.hypot(EVENT.clientX - START_X, EVENT.clientY - START_Y) > 10) {
          DID_MOVE = true;
        }
      },
      { passive: true }
    );

    /* GROUP: Pointer up */
    ELEMENT.addEventListener(
      "pointerup",
      (EVENT) => {

        if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

        try { ELEMENT.releasePointerCapture(ACTIVE_POINTER_ID); } catch {}
        ACTIVE_POINTER_ID = null;

        if (DID_MOVE) {
          try { ELEMENT.blur(); } catch {}
          return;
        }

        EVENT.preventDefault();

        if (ELEMENT.id === "homepageBack") {
          transitionTo("back");
          return;
        }

        const HREF = ELEMENT.getAttribute("href");
        if (!HREF) return;

        transitionTo(HREF);
      },
      { passive: false }
    );

    /* GROUP: Pointer cancel */
    ELEMENT.addEventListener(
      "pointercancel",
      () => {
        ACTIVE_POINTER_ID = null;
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


// Tiny joke: this script doesn’t *transition* into new variable names, it commits to them. 😄