// thank heavens for chatGPT <3

/*==============================================================*
 *                  LAYOUT & TRANSITIONS SCRIPT
 *==============================================================*
 *  What this file does:
 *   1) Global state + helpers
 *   2) Scroll ownership helper (document is the scroller)
 *   3) Page load: set slide duration + slide-in + back button logic
 *   4) bfcache restore handling (pageshow)
 *   5) Transition navigation (slide-out then location change)
 *   6) Touch navigation fixes (pointer-based tap vs swipe)
 *==============================================================*/

//alert("Debug gum"); // Optional debug tripwire: confirms this file loaded

/*========================================*
//#region 1) GLOBAL STATE + HELPERS
 *========================================*/

/* TRANSITION STATE */
// Track whether a slide transition is currently running (prevents double navigation)
let IS_TRANSITION_ACTIVE = false;

/* STARFIELD SHORTCUT */
// Create a short alias for the STARFIELD namespace (if it exists)
var S = window.STARFIELD;

/*
/* OPTIONAL AUDIO (commented out) */
//const CRUNCH_SOUND = new Audio("/Resources/Crunch.mp3");
//CRUNCH_SOUND.preload = "auto";
//CRUNCH_SOUND.load();
//CRUNCH_SOUND.volume = 0.25;
*/

/* PENDING TIMER HANDLES (bfcache can resurrect these unless we cancel them) */
// Track the timeout that saves state right before navigation
let SAVE_BEFORE_LEAVE_TIMEOUT_ID = null;

// Track the timeout that actually navigates after slide-out
let NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = null;

// Cancel any scheduled transition timers and reset their handles
function clearPendingTransitionTimers() {
  // Cancel the pending "save before leave" timeout if it exists
  if (SAVE_BEFORE_LEAVE_TIMEOUT_ID) clearTimeout(SAVE_BEFORE_LEAVE_TIMEOUT_ID);

  // Cancel the pending "navigate after slide" timeout if it exists
  if (NAVIGATE_AFTER_SLIDE_TIMEOUT_ID) clearTimeout(NAVIGATE_AFTER_SLIDE_TIMEOUT_ID);

  // Clear handles so we know nothing is pending
  SAVE_BEFORE_LEAVE_TIMEOUT_ID = null;

  // Clear handles so we know nothing is pending
  NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = null;
}

// Freeze starfield motion and persist state when leaving the page
function freezeAndSaveStarfield() {
  // Bail if STARFIELD namespace is missing (page may not include starfield)
  if (!S) return;

  // Freeze physics updates so the sim stops moving while leaving
  S.isFrozen = true;

  // Persist current star state if Setup exposed the save function
  if (typeof S.saveStarfieldToStorage === "function") {
    S.saveStarfieldToStorage();
  }
}

/* LEAVE/RETURN EVENTS */
// Save + freeze on real navigations and bfcache exits (best cross-browser “we’re leaving” signal)
window.addEventListener("pagehide", () => {
  // Kill any scheduled timers so bfcache restore can't re-run them later
  clearPendingTransitionTimers();

  // Freeze and save starfield state right before we leave
  freezeAndSaveStarfield();
});

// Backup save/freeze for tab switching and mobile backgrounding
document.addEventListener("visibilitychange", () => {
  // Bail if STARFIELD namespace is missing
  if (!S) return;

  // When hidden, freeze + save so state doesn't drift in the background
  if (document.visibilityState === "hidden") {
    freezeAndSaveStarfield();
  }
  // When visible again, allow physics to run
  else if (document.visibilityState === "visible") {
    S.isFrozen = false;
  }
});

/* DOM LOOKUPS */
// Return the main transition container used for slide-in/slide-out
const getTransitionContainer = () => document.getElementById("transitionContainer");

// Return true when this page looks like the homepage (menu button exists)
const isHomepage = () => !!document.querySelector("#menuButton");

/* TIMING */
// Match CSS: homepage anim is longer than inner pages
const getSlideDurationSeconds = () => (isHomepage() ? 1.2 : 0.6);

/* NAV TYPE DETECTION */
/** Return true when navigation was back/forward (often via bfcache) */
function isBackForwardNavigation(EVENT) {
  // Some browsers mark bfcache restore on the pageshow event
  if (EVENT?.persisted) return true;

  // Use Navigation Timing API when available to detect back/forward
  try {
    return performance?.getEntriesByType?.("navigation")?.[0]?.type === "back_forward";
  } catch {
    // Fallback: treat unknown as not back/forward
    return false;
  }
}

/* REFERRER PARSING */
/** Determine whether the referrer is internal and whether it was the Menu page */
function getReferrerInfo() {
  // Read the browser referrer string (may be empty)
  const REFERRER = document.referrer;

  // Track whether the referrer is same-origin
  let IS_INTERNAL_REFERRER = false;

  // Track whether we came specifically from the Menu page
  let CAME_FROM_MENU_PAGE = false;

  // Return early when no referrer exists
  if (!REFERRER) return { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE };

  try {
    // Parse the referrer into a URL object
    const REFERRER_URL = new URL(REFERRER);

    // Mark internal when origins match
    IS_INTERNAL_REFERRER = REFERRER_URL.origin === location.origin;

    // Normalize the path for robust comparisons
    const REFERRER_PATH = REFERRER_URL.pathname.toLowerCase();

    // Mark menu origins using common menu URL shapes
    CAME_FROM_MENU_PAGE =
      REFERRER_PATH === "/menu" ||
      REFERRER_PATH === "/menu/" ||
      REFERRER_PATH.endsWith("/menu/index.html");
  } catch {
    // If parsing fails, treat as external/unknown
  }

  // Return computed referrer info for callers
  return { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE };
}

/* #endregion 1) GLOBAL STATE + HELPERS */



/*========================================*
//#region 2) SCROLL OWNERSHIP (DOCUMENT IS SCROLLER)
 *========================================*/

// Switch the page to "document scroll" mode instead of container scroll mode
function enableDocumentScroll(CONTAINER = getTransitionContainer()) {
  // Cache <html> for style changes
  const HTML = document.documentElement;

  // Cache <body> for style changes
  const BODY = document.body;

  /* PRESERVE SCROLL */
  // Preserve current scroll position from the container or window
  const SAVED_SCROLL_Y = CONTAINER?.scrollTop ?? window.scrollY ?? 0;

  /* MAKE DOCUMENT SCROLL */
  // Allow vertical scrolling on the document element
  HTML.style.overflowY = "auto";

  // Ensure the body is not acting like a scroll container
  BODY.style.overflow = "visible";

  // Allow body height to expand naturally
  BODY.style.height = "auto";

  /* DISABLE CONTAINER SCROLL */
  // Ensure the transition container is not scrollable
  if (CONTAINER) {
    // Disable container scrolling
    CONTAINER.style.overflow = "visible";

    // Allow container height to expand naturally
    CONTAINER.style.height = "auto";
  }

  /* SYNC STARFIELD */
  // Resize starfield canvas so it matches the new scroll ownership layout
  if (S && typeof S.resizeStarfieldCanvas === "function") {
    S.resizeStarfieldCanvas();
  }

  /* RESTORE SCROLL */
  // Restore scroll next frame so layout has applied first
  requestAnimationFrame(() => {
    try { window.scrollTo(0, SAVED_SCROLL_Y); } catch {}
  });
}

/* #endregion 2) SCROLL OWNERSHIP (DOCUMENT IS SCROLLER) */



/*========================================*
//#region 3) PAGE LOAD (SLIDE-IN + BACK BUTTON)
 *========================================*/

// Run initial slide-in and back-button logic when the page finishes loading
window.addEventListener("load", () => {
  // Find the transition container that receives slide classes
  const CONTAINER = getTransitionContainer();

  // Bail if no container exists on this page
  if (!CONTAINER) return;

  /* SLIDE DURATION */
  // Set slide duration CSS variable for this page type
  document.documentElement.style.setProperty("--SLIDE_DURATION", `${getSlideDurationSeconds()}s`);

  /* SLIDE-IN */
  // Trigger slide-in on the next frame to ensure the class change animates
  requestAnimationFrame(() => {
    CONTAINER.classList.add("ready");
  });

  /* BACK BUTTON */
  // Compute referrer info for back button visibility and storage
  const { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE } = getReferrerInfo();

  // Find the back link element (only exists on some pages)
  const BACK_LINK = document.getElementById("homepageBack");

  // Bail if there's no back link on this page
  if (!BACK_LINK) return;

  // Hide back button when we came from the Menu page
  if (CAME_FROM_MENU_PAGE) {
    BACK_LINK.style.display = "none";
    return;
  }

  // Show back button when referrer is internal, and store the referrer URL
  if (IS_INTERNAL_REFERRER && REFERRER) {
    BACK_LINK.style.display = "block";
    localStorage.setItem("homepageBackUrl", REFERRER);
    return;
  }

  // Hide back button when referrer is external or unknown
  BACK_LINK.style.display = "none";

  // Remove stored back URL when we can't trust referrer
  localStorage.removeItem("homepageBackUrl");
});

/* #endregion 3) PAGE LOAD (SLIDE-IN + BACK BUTTON) */



/*========================================*
//#region 4) BACK/FORWARD CACHE (PAGESHOW)
 *========================================*/

// Fix state when returning via back/forward or bfcache restore
window.addEventListener("pageshow", (EVENT) => {
  // Find the transition container that receives slide classes
  const CONTAINER = getTransitionContainer();

  // Bail if no container exists on this page
  if (!CONTAINER) return;

  /* CANCEL RESURRECTED TIMERS */
  // bfcache restore can re-run old timeouts, so cancel them immediately
  clearPendingTransitionTimers();

  /* UNFREEZE STARFIELD */
  // Allow starfield to resume when returning to this page
  if (S) S.isFrozen = false;

  /* HANDLE TRUE BACK/FORWARD ONLY */
  // Skip work when this wasn't a back/forward restore
  if (!isBackForwardNavigation(EVENT)) return;

  /* RESET SLIDE STATE */
  // Remove slide-out class in case it was left behind
  CONTAINER.classList.remove("slide-out");

  // Ensure the container is in a ready (slid-in) state
  CONTAINER.classList.add("ready");

  /* RESET TRANSITION FLAGS */
  // Allow new transitions now that we're stable again
  IS_TRANSITION_ACTIVE = false;

  // Reset container scroll position (safe default on restore)
  CONTAINER.scrollTop = 0;
});

/* #endregion 4) BACK/FORWARD CACHE (PAGESHOW) */



/*========================================*
//#region 5) TRANSITION NAVIGATION (SLIDE-OUT THEN LEAVE)
 *========================================*/

// Slide the page out, then navigate to the target URL after the animation finishes
function transitionTo(URL) {
  /* DOUBLE-TRIGGER GUARD */
  // Prevent starting a second transition while one is active
  if (IS_TRANSITION_ACTIVE) return;

  // Bail if URL is missing or empty
  if (!URL) return;

  //CRUNCH_SOUND.pause(), CRUNCH_SOUND.play().catch(() => {});

  /* CLEAN UP OLD TIMERS */
  // Cancel any existing scheduled navigation timers
  clearPendingTransitionTimers();

  // Mark transition as active so other triggers are ignored
  IS_TRANSITION_ACTIVE = true;

  // Find the transition container that receives slide classes
  const CONTAINER = getTransitionContainer();

  /* SPECIAL: "back" KEYWORD */
  // Replace "back" with a stored referrer URL when available
  if (URL === "back") {
    // Read stored back URL from localStorage
    const STORED_BACK_URL = localStorage.getItem("homepageBackUrl");

    // Abort transition if there's no stored back URL
    if (!STORED_BACK_URL) {
      IS_TRANSITION_ACTIVE = false;
      return;
    }

    // Use the stored URL as the actual navigation target
    URL = STORED_BACK_URL;
  }

  /* NO CONTAINER FALLBACK */
  // If no container exists, navigate immediately without animation
  if (!CONTAINER) {
    location.href = URL;
    return;
  }

  /* SLIDE DISTANCE */
  // Compute slide distance as viewport height plus current scroll offset
  const SLIDE_DISTANCE_PX = (window.innerHeight * 1.1) + (window.scrollY ?? 0);

  // Write slide distance CSS variable so CSS can animate the correct amount
  document.documentElement.style.setProperty("--SLIDE_DISTANCE", `${SLIDE_DISTANCE_PX}px`);

  /* START SLIDE-OUT */
  // Add the slide-out class to trigger the outgoing animation
  CONTAINER.classList.add("slide-out");

  /* DURATION */
  // Convert slide duration from seconds into milliseconds for timers
  const DURATION_MS = getSlideDurationSeconds() * 1000;

  /* SAVE NEAR THE END */
  // Freeze+save right before leaving (keeps motion during slide, captures final)
  SAVE_BEFORE_LEAVE_TIMEOUT_ID = setTimeout(
    freezeAndSaveStarfield,
    Math.max(0, DURATION_MS - 50)
  );

  /* NAVIGATE AFTER ANIM */
  // Navigate to the target URL after the animation duration elapses
  NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = setTimeout(() => {
    location.href = URL;
  }, DURATION_MS);
}

/* #endregion 5) TRANSITION NAVIGATION (SLIDE-OUT THEN LEAVE) */



/*========================================*
//#region 6) TOUCH NAV FIXES (POINTER TAP VS SWIPE)
 *========================================*/

// Toggle the hidden state of an element by id (simple debug helper)
function toggleElement(ELEMENT_ID) {
  // Bail if no id was provided
  if (!ELEMENT_ID) return;

  // Look up the element by id
  const ELEMENT = document.getElementById(ELEMENT_ID);

  // Flip hidden state when the element exists
  if (ELEMENT) ELEMENT.hidden = !ELEMENT.hidden;
}

// Replace normal anchor navigation with slide transitions on touch taps
function wirePointerNavigation(SELECTOR = "a") {
  // Collect candidate navigation elements (defaults to all anchors)
  const NAV_ITEMS = document.querySelectorAll(SELECTOR);

  // Bail if no matching elements exist
  if (!NAV_ITEMS.length) return;

  // Wire touch pointer handlers for each nav element
  NAV_ITEMS.forEach((ELEMENT) => {
    // Track the starting X position of the gesture
    let START_X = 0;

    // Track the starting Y position of the gesture
    let START_Y = 0;

    // Track whether the pointer moved far enough to count as a swipe/drag
    let DID_MOVE = false;

    // Track which pointer id is currently active on this element
    let ACTIVE_POINTER_ID = null;

    /* POINTER DOWN */
    ELEMENT.addEventListener(
      "pointerdown",
      (EVENT) => {
        // Ignore non-touch pointers so mouse clicks behave normally
        if (EVENT.pointerType !== "touch") return;

        // Store the active pointer id so move/up match the same finger
        ACTIVE_POINTER_ID = EVENT.pointerId;

        // Reset movement flag at the start of the gesture
        DID_MOVE = false;

        // Store the starting X position for swipe detection
        START_X = EVENT.clientX;

        // Store the starting Y position for swipe detection
        START_Y = EVENT.clientY;

        // Capture the pointer so we keep receiving move/up events
        try { ELEMENT.setPointerCapture(ACTIVE_POINTER_ID); } catch {}
      },
      { passive: true }
    );

    /* POINTER MOVE */
    ELEMENT.addEventListener(
      "pointermove",
      (EVENT) => {
        // Ignore moves from other pointers
        if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

        // Mark as moved when gesture exceeds the tap threshold
        if (Math.hypot(EVENT.clientX - START_X, EVENT.clientY - START_Y) > 10) {
          DID_MOVE = true;
        }
      },
      { passive: true }
    );

    /* POINTER UP */
    ELEMENT.addEventListener(
      "pointerup",
      (EVENT) => {
        // Ignore ups from other pointers
        if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

        // Release pointer capture now that gesture ended
        try { ELEMENT.releasePointerCapture(ACTIVE_POINTER_ID); } catch {}

        // Clear active pointer id so future gestures start fresh
        ACTIVE_POINTER_ID = null;

        // Treat swipes/drags as normal scrolling and do not navigate
        if (DID_MOVE) {
          try { ELEMENT.blur(); } catch {}
          return;
        }

        // Prevent default so we can take over navigation with animation
        EVENT.preventDefault();

        // Route homepage back button through stored back behavior
        if (ELEMENT.id === "homepageBack") {
          transitionTo("back");
          return;
        }

        // Read the href attribute for the navigation target
        const HREF = ELEMENT.getAttribute("href");

        // Bail if element has no href
        if (!HREF) return;

        // Trigger animated transition navigation
        transitionTo(HREF);
      },
      { passive: false }
    );

    /* POINTER CANCEL */
    ELEMENT.addEventListener(
      "pointercancel",
      () => {
        // Clear active pointer id so we don't get stuck
        ACTIVE_POINTER_ID = null;

        // Clear focus styles to avoid sticky :focus on iOS
        try { ELEMENT.blur(); } catch {}
      },
      { passive: true }
    );
  });
}

// Wire pointer navigation after the DOM is ready
document.addEventListener("DOMContentLoaded", () => wirePointerNavigation());

/* #endregion 6) TOUCH NAV FIXES (POINTER TAP VS SWIPE) */