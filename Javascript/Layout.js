// thank heavens for chatGPT <3
// Layout.js
// Layout + page transitions controller for StayingOutsideTheBox.
// Owns:
//  - Slide-in/out navigation animations
//  - Scroll locking/unlocking during transitions
//  - bfcache hygiene (pageshow/pagehide safety)
//  - Touch-safe tap handling (tap navigates, swipe scrolls)
//  - Optional shared footer injection (skips homepage)

/*======================================================================
 *  MENU
 *----------------------------------------------------------------------
 *  1) GLOBAL STATE + UTILITIES
 *     - Transition guard
 *     - Timer handles (bfcache-safe)
 *     - Starfield freeze/save hook
 *     - DOM helpers
 *     - Page type helpers
 *     - Navigation type detection
 *     - Referrer analysis (homepage back button)
 *
 *  2) SCROLL OWNERSHIP
 *     - Lock scroll during transitions
 *     - Restore scroll after load / restore
 *
 *  3) PAGE LOAD (SLIDE-IN + BACK BUTTON)
 *     - Publish --SLIDE_DURATION
 *     - Add .ready
 *     - Decide homepage back button rules
 *
 *  4) BACK/FORWARD CACHE (PAGESHOW)
 *     - Clear timers resurrected by bfcache
 *     - Reset transition classes/flags
 *     - Restore scroll + footer
 *
 *  5) TRANSITION NAVIGATION
 *     - Compute slide distance
 *     - Add .slide-out
 *     - Freeze/save near end
 *     - Navigate after duration
 *
 *  6) TOUCH NAV FIXES (POINTER TAP VS SWIPE)
 *     - Touch tap triggers transitionTo(href)
 *     - Swipe preserves native scrolling
 *
 *  7) FOOTER INJECTION (GLOBAL FOOTER)
 *     - Inject shared footer into #transitionContainer
 *     - Prevent duplicates (bfcache-safe)
 *====================================================================*/


/*======================================================================
 * #region 1) GLOBAL STATE + UTILITIES
 *====================================================================*/

/* GROUP: Transition guard */
// True while slide-out is in progress, prevents double navigations.
let IS_TRANSITION_ACTIVE = false;

/* GROUP: Starfield alias */
// Local pointer to global STARFIELD (may be undefined on some pages).
let S = window.STARFIELD;

/* GROUP: Pending transition timers */
// bfcache can resurrect timers, so keep handles to cancel them.
let SAVE_BEFORE_LEAVE_TIMEOUT_ID = null;
let NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = null;

/* GROUP: DOM helpers */
// Central place to fetch the transition container (never cache it at top-level).
const getContainer = () => document.getElementById("transitionContainer");

/* GROUP: Page type helpers */
// Heuristic: homepage has the menu button in the header nav.
const isHomepage = () => !!document.querySelector("#menuButton");

/* GROUP: Slide duration */
// Homepage gets a longer slide. Inner pages are snappier.
const getSlideDurationSeconds = () => (isHomepage() ? 1.2 : 0.6);

/* GROUP: Timer hygiene */
// Cancel any pending transition timers and reset handles.
function clearPendingTransitionTimers() {
  if (SAVE_BEFORE_LEAVE_TIMEOUT_ID) clearTimeout(SAVE_BEFORE_LEAVE_TIMEOUT_ID);
  if (NAVIGATE_AFTER_SLIDE_TIMEOUT_ID) clearTimeout(NAVIGATE_AFTER_SLIDE_TIMEOUT_ID);

  SAVE_BEFORE_LEAVE_TIMEOUT_ID = null;
  NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = null;
}

/* GROUP: Starfield freeze + save */
// Freeze starfield motion and persist state (if storage hook exists).
function freezeAndSaveStarfield() {
  S = window.STARFIELD;
  if (!S) return;

  S.isFrozen = true;

  if (typeof S.saveStarfieldToStorage === "function") {
    S.saveStarfieldToStorage();
  }
}

/* GROUP: Leave lifecycle */
// pagehide fires for real navigations and bfcache entries.
// Best "we are leaving" hook across browsers.
window.addEventListener("pagehide", () => {
  clearPendingTransitionTimers();
  freezeAndSaveStarfield();
});

/* GROUP: Backgrounding */
// Helps on mobile where pagehide may not fire immediately.
document.addEventListener("visibilitychange", () => {
  S = window.STARFIELD;
  if (!S) return;

  if (document.visibilityState === "hidden") {
    freezeAndSaveStarfield();
  } else if (document.visibilityState === "visible") {
    S.isFrozen = false;
  }
});

/* GROUP: Navigation type detection */
// True if page came from back/forward navigation (often bfcache).
function isBackForwardNavigation(EVENT) {
  if (EVENT?.persisted) return true;

  try {
    return performance?.getEntriesByType?.("navigation")?.[0]?.type === "back_forward";
  } catch {
    return false;
  }
}

/* GROUP: Referrer analysis */
// Determines whether referrer is internal and whether it was /menu.
function getReferrerInfo() {
  const REFERRER = document.referrer;

  let IS_INTERNAL_REFERRER = false;
  let CAME_FROM_MENU_PAGE = false;

  if (!REFERRER) return { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE };

  try {
    const REFERRER_URL = new URL(REFERRER);
    IS_INTERNAL_REFERRER = REFERRER_URL.origin === location.origin;

    const PATH = REFERRER_URL.pathname.toLowerCase();
    CAME_FROM_MENU_PAGE =
      PATH === "/menu" ||
      PATH === "/menu/" ||
      PATH.endsWith("/menu/index.html");
  } catch {}

  return { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE };
}

/* #endregion 1) GLOBAL STATE + UTILITIES */



/*======================================================================
 * #region 2) SCROLL OWNERSHIP
 *====================================================================*/

/* GROUP: Lock scroll during transitions */
// We lock both html and body for maximum cross-browser reliability.
function disableDocumentScroll() {
  const HTML = document.documentElement;
  const BODY = document.body;
  const CONTAINER = getContainer();

  HTML.style.overflowY = "hidden";
  BODY.style.overflow = "hidden";

  // Optional: allow container overflow if you want internal effects while locked.
  if (CONTAINER) CONTAINER.style.overflow = "visible";
}

/* GROUP: Restore scroll after transitions/load */
// Put scroll back on the document.
function enableDocumentScroll() {
  const HTML = document.documentElement;
  const BODY = document.body;
  const CONTAINER = getContainer();

  HTML.style.overflowY = "auto";
  BODY.style.overflow = "visible";

  // Optional: prevent container from becoming the scroller.
  if (CONTAINER) CONTAINER.style.overflow = "hidden";
}

/* #endregion 2) SCROLL OWNERSHIP */



/*======================================================================
 * #region 3) PAGE LOAD (SLIDE-IN + BACK BUTTON)
 *====================================================================*/

window.addEventListener("load", () => {
  const CONTAINER = getContainer();
  if (!CONTAINER) return;

  // Start locked so user cannot scroll mid-slide-in.
  disableDocumentScroll();

  // Publish slide duration to CSS variable used in transitions.
  document.documentElement.style.setProperty(
    "--SLIDE_DURATION",
    `${getSlideDurationSeconds()}s`
  );

  // Trigger slide-in on next frame so the transition actually animates.
  requestAnimationFrame(() => {
    CONTAINER.classList.add("ready");
  });

  // Homepage back button rules (only if element exists on this page).
  const BACK_LINK = document.getElementById("homepageBack");
  if (BACK_LINK) {
    const { REFERRER, IS_INTERNAL_REFERRER, CAME_FROM_MENU_PAGE } = getReferrerInfo();

    if (CAME_FROM_MENU_PAGE) {
      BACK_LINK.style.display = "none";
      localStorage.removeItem("homepageBackUrl");
    } else if (IS_INTERNAL_REFERRER && REFERRER) {
      BACK_LINK.style.display = "block";
      localStorage.setItem("homepageBackUrl", REFERRER);
    } else {
      BACK_LINK.style.display = "none";
      localStorage.removeItem("homepageBackUrl");
    }
  }

  // Now that the page is in a stable "ready" state, allow user scroll.
  enableDocumentScroll();
});

/* #endregion 3) PAGE LOAD (SLIDE-IN + BACK BUTTON) */



/*======================================================================
 * #region 4) BACK/FORWARD CACHE (PAGESHOW)
 *====================================================================*/

window.addEventListener("pageshow", (EVENT) => {
  const CONTAINER = getContainer();
  if (!CONTAINER) return;

  // Always clear timers resurrected by bfcache.
  clearPendingTransitionTimers();

  // Unfreeze starfield if present.
  S = window.STARFIELD;
  if (S) S.isFrozen = false;

  // Always restore scroll in case the page returned while locked.
  enableDocumentScroll();

  // Footer can be missing on bfcache restores (DOMContentLoaded does not fire).
  injectGlobalFooter();

  // Only do the deep class/flag repair for actual back_forward restores.
  if (!isBackForwardNavigation(EVENT)) return;

  CONTAINER.classList.remove("slide-out");
  CONTAINER.classList.add("ready");

  IS_TRANSITION_ACTIVE = false;

  // If container was ever used as a scroller, neutralize it.
  try { CONTAINER.scrollTop = 0; } catch {}
});

/* #endregion 4) BACK/FORWARD CACHE (PAGESHOW) */



/*======================================================================
 * #region 5) TRANSITION NAVIGATION
 *====================================================================*/

/* GROUP: Transition navigation entry point */
// Animate out, freeze/save near the end, then navigate.
// URL may be a real href or the special keyword "back".
function transitionTo(URL) {
  if (IS_TRANSITION_ACTIVE) return;
  if (!URL) return;

  clearPendingTransitionTimers();
  IS_TRANSITION_ACTIVE = true;

  // Lock scroll immediately so the page does not drift mid-animation.
  disableDocumentScroll();

  // Support a stored internal back URL for the homepage back button.
  if (URL === "back") {
    const STORED_BACK_URL = localStorage.getItem("homepageBackUrl");
    if (!STORED_BACK_URL) {
      IS_TRANSITION_ACTIVE = false;
      enableDocumentScroll();
      return;
    }
    URL = STORED_BACK_URL;
  }

  const CONTAINER = getContainer();
  if (!CONTAINER) {
    location.href = URL;
    return;
  }

  // Compute slide distance so the page fully clears even if scrolled.
  const SLIDE_DISTANCE_PX = (window.innerHeight * 1.1) + (window.scrollY ?? 0);

  document.documentElement.style.setProperty(
    "--SLIDE_DISTANCE",
    `${SLIDE_DISTANCE_PX}px`
  );

  // Start slide-out animation.
  CONTAINER.classList.add("slide-out");

  const DURATION_MS = getSlideDurationSeconds() * 1000;

  // Freeze/save very near the end of the animation to avoid visible "jump".
  SAVE_BEFORE_LEAVE_TIMEOUT_ID = setTimeout(
    freezeAndSaveStarfield,
    Math.max(0, DURATION_MS - 50)
  );

  // Navigate when the animation should be complete.
  NAVIGATE_AFTER_SLIDE_TIMEOUT_ID = setTimeout(() => {
    location.href = URL;
  }, DURATION_MS);
}

/* #endregion 5) TRANSITION NAVIGATION */



/*======================================================================
 * #region 6) TOUCH NAV FIXES (POINTER TAP VS SWIPE)
 *====================================================================*/

/* GROUP: Tap-to-navigate without breaking scroll */
// Converts touch taps into animated navigation while preserving swipe scroll.
function wirePointerNavigation(SELECTOR = "a") {
  const NAV_ITEMS = document.querySelectorAll(SELECTOR);
  if (!NAV_ITEMS.length) return;

  NAV_ITEMS.forEach((ELEMENT) => {
    let START_X = 0;
    let START_Y = 0;
    let DID_MOVE = false;
    let ACTIVE_POINTER_ID = null;

    // Touch begins
    ELEMENT.addEventListener("pointerdown", (EVENT) => {
      if (EVENT.pointerType !== "touch") return;

      ACTIVE_POINTER_ID = EVENT.pointerId;
      DID_MOVE = false;

      START_X = EVENT.clientX;
      START_Y = EVENT.clientY;

      try { ELEMENT.setPointerCapture(ACTIVE_POINTER_ID); } catch {}
    }, { passive: true });

    // Touch moves (detect swipe)
    ELEMENT.addEventListener("pointermove", (EVENT) => {
      if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

      if (Math.hypot(EVENT.clientX - START_X, EVENT.clientY - START_Y) > 10) {
        DID_MOVE = true;
      }
    }, { passive: true });

    // Touch ends (tap)
    ELEMENT.addEventListener("pointerup", (EVENT) => {
      if (EVENT.pointerId !== ACTIVE_POINTER_ID) return;

      try { ELEMENT.releasePointerCapture(ACTIVE_POINTER_ID); } catch {}
      ACTIVE_POINTER_ID = null;

      // Swipe: do nothing, let native scrolling win.
      if (DID_MOVE) {
        try { ELEMENT.blur(); } catch {}
        return;
      }

      const HREF = ELEMENT.getAttribute("href");
      if (!HREF) return;

      // Let special links behave normally (no slide-out).
      if (
        HREF.startsWith("mailto:") ||
        HREF.startsWith("tel:") ||
        HREF.startsWith("sms:") ||
        HREF.startsWith("javascript:")
      ) {
        return;
      }

      // Intercept tap navigation so we can animate.
      EVENT.preventDefault();

      // Special case: homepage back button uses stored back URL.
      if (ELEMENT.id === "homepageBack") {
        transitionTo("back");
        return;
      }

      transitionTo(HREF);
    }, { passive: false });

    // Gesture canceled (system interruption, etc.)
    ELEMENT.addEventListener("pointercancel", () => {
      ACTIVE_POINTER_ID = null;
      try { ELEMENT.blur(); } catch {}
    }, { passive: true });
  });
}

/* #endregion 6) TOUCH NAV FIXES (POINTER TAP VS SWIPE) */



/*======================================================================
 * #region 7) FOOTER INJECTION (GLOBAL FOOTER)
 *====================================================================*/

/* GROUP: Inject shared footer into the transition container */
// - Skips homepage (you already have a custom footer there if you want)
// - Prevents duplicates (important for bfcache restores)
function injectGlobalFooter() {
  if (isHomepage()) return;

  const CONTAINER = getContainer();
  if (!CONTAINER) return;

  // Prevent duplicate footers (bfcache/pageshow safe).
  if (CONTAINER.querySelector("footer[data-global-footer]")) return;

  const FOOTER = document.createElement("footer");
  FOOTER.setAttribute("data-global-footer", "true");

  // Note: the contact email uses zero-width spaces so it can wrap nicely.
  FOOTER.innerHTML = `
    <hr>
    <p>I Can’t Stop Dying™ and The I Collection™ are trademarks of Staying Outside The Box™ LLC</p>
    <p>
      All trademarks, logos, and brands are property of their respective owners.<br>
      This site uses these logos only to link to official profiles.<br>
      No endorsement is implied.
    </p>
    <p>
      <strong>Contact: </strong>
      <a href="mailto:admin@stayingoutsidethebox.com">
        admin@&#8203;stayingoutsidethebox&#8203;.com
      </a>
    </p>
    <a href="/privacy and terms.html" onclick="transitionTo(this.href); return false;">
      Privacy Policy &amp; Terms of Use
    </a>
  `;

  CONTAINER.appendChild(FOOTER);
}

/* #endregion 7) FOOTER INJECTION (GLOBAL FOOTER) */



/*======================================================================
 * BOOTSTRAP (DOM READY)
 *====================================================================*/

// Wire behaviors once the DOM exists.
document.addEventListener("DOMContentLoaded", () => {
  injectGlobalFooter();
  wirePointerNavigation();
});

// Tiny joke: this file is basically a stage manager.
// It whispers “places” to your DOM, then drops the curtain at exactly 0.6 seconds. 🎭