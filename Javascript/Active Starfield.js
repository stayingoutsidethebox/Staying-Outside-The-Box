// thank heavens for chatGPT <3

/*==============================================================*
 *                      STARFIELD SETUP
 *==============================================================*
 *  This file owns:
 *   1) STARFIELD namespace + canvas wiring
 *   2) Storage (save/restore)
 *   3) Utilities (time normalization, edge fade, random)
 *   4) Init/create stars
 *   5) UI controls (sliders + steppers)
 *   6) Resize + animation loop
 *   7) Bootstrap
 *
 *  Active S.js owns:
 *    Physics (updateStarPhysics)
 *    Rendering (renderStarsAndLinks)
 *    Pointer input (updatePointerSpeed + listeners)
 *==============================================================*/

//alert("Debug can");

/*========================================*
//#region 1) STARFIELD NAMESPACE + CANVAS
 *========================================*/

window.STARFIELD = {};
window.KEYBOARD = { multX: 1, multY: 1, addX: 0, addY: 0 };
var S = window.STARFIELD;

S.constellationCanvas = document.getElementById("constellations");

S.drawingContext =
  S.constellationCanvas && S.constellationCanvas.getContext
    ? S.constellationCanvas.getContext("2d")
    : null;

S.isCanvasReady = !!(S.constellationCanvas && S.drawingContext);

if (!S.isCanvasReady) {
  console.warn("Constellation canvas not found or unsupported; starfield disabled.");
}

S.isFrozen = false;

S.pointerClientX = 0;
S.pointerClientY = 0;
S.lastPointerTimeMs = 0;
S.pointerSpeedUnits = 0;

S.pokeImpulseTimer = 0;
S.pointerRingTimer = 0;

S.canvasWidth = 0;
S.canvasHeight = 0;
S.screenPerimeter = 0;
S.screenScaleUp = 0;
S.screenScaleDown = 0;
S.starCountLimit = 0;
S.maxLinkDistance = 0;

S.screenScalePowers = {
  attractionGradient: 1,
  repulsionGradient: 1,
  attractionShape: 1,
  attractionForce: 1,
  repulsionForce: 1,
  forceClamp: 1
};

S.starList = [];

S.hasAnimationLoopStarted = false;
S.hasResizeListenerWired = false;
S.hasStarsInitialized = false;

/* #endregion 1) STARFIELD NAMESPACE + CANVAS */



/*========================================*
//#region 2) STORAGE (localStorage)
 *========================================*/

S.saveStarfieldToStorage = function saveStarfieldToStorage() {
  if (!S.isCanvasReady) return;

  try {
    localStorage.setItem("constellationStars", JSON.stringify(S.starList));

    localStorage.setItem(
      "constellationMeta",
      JSON.stringify({
        width: S.canvasWidth,
        height: S.canvasHeight,

        pokeTimer: S.pokeImpulseTimer,
        userSpeed: S.pointerSpeedUnits,
        userX: S.pointerClientX,
        userY: S.pointerClientY,
        userTime: S.lastPointerTimeMs,
        ringTimer: S.pointerRingTimer,

        attractStrength: S.interactionSettings.attractStrength,
        attractRadius: S.interactionSettings.attractRadius,
        attractScale: S.interactionSettings.attractScale,
        clamp: S.interactionSettings.clamp,
        repelStrength: S.interactionSettings.repelStrength,
        repelRadius: S.interactionSettings.repelRadius,
        repelScale: S.interactionSettings.repelScale,
        pokeStrength: S.interactionSettings.pokeStrength
      })
    );
  } catch (ERROR) {
    console.warn("Could not save stars:", ERROR);
  }
};

/* #endregion 2) STORAGE */



/*========================================*
//#region 3) UTILITIES
 *========================================*/

S.getNowMs = function getNowMs() {
  return window.performance && performance.now ? performance.now() : Date.now();
};

/**
 * Safari timestamp normalization:
 */
S.normalizePointerTimestampMs = function normalizePointerTimestampMs(RAW_TIMESTAMP) {
  if (!Number.isFinite(RAW_TIMESTAMP) || RAW_TIMESTAMP <= 0) return S.getNowMs();

  if (RAW_TIMESTAMP > 1e12) {
    if (performance && Number.isFinite(performance.timeOrigin)) {
      return RAW_TIMESTAMP - performance.timeOrigin;
    }
    return S.getNowMs();
  }

  return RAW_TIMESTAMP;
};

S.randomBetween = (MIN_VALUE, MAX_VALUE) =>
  Math.random() * (MAX_VALUE - MIN_VALUE) + MIN_VALUE;

/** Original edge fade retained for compatibility (Active now uses a faster inline version). */
S.getEdgeFadeFactor = function getEdgeFadeFactor(STAR) {
  const STAR_RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

  const DIST_LEFT = STAR.x + STAR_RADIUS;
  const DIST_RIGHT = S.canvasWidth + STAR_RADIUS - STAR.x;
  const DIST_TOP = STAR.y + STAR_RADIUS;
  const DIST_BOTTOM = S.canvasHeight + STAR_RADIUS - STAR.y;

  const MIN_EDGE_DISTANCE = Math.min(DIST_LEFT, DIST_RIGHT, DIST_TOP, DIST_BOTTOM);

  const FADE_BAND = Math.min(90, S.screenPerimeter * 0.03);

  let T = MIN_EDGE_DISTANCE / FADE_BAND;
  if (T < 0) T = 0;
  if (T > 1) T = 1;

  return T * T * (3 - 2 * T);
};

/* #endregion 3) UTILITIES */



/*========================================*
//#region 4) INIT: RESTORE OR CREATE STARS
 *========================================*/

S.restoreOrCreateStars = function restoreOrCreateStars() {
  if (!S.isCanvasReady) return;

  let RAW_STARS_JSON = null;
  try { RAW_STARS_JSON = localStorage.getItem("constellationStars"); } catch {}

  if (!RAW_STARS_JSON) {
    S.createNewStars();
    return;
  }

  try {
    const PARSED_STARS = JSON.parse(RAW_STARS_JSON);
    if (!Array.isArray(PARSED_STARS) || !PARSED_STARS.length) {
      S.createNewStars();
      return;
    }

    S.starList = PARSED_STARS;

    let RAW_META_JSON = null;
    try { RAW_META_JSON = localStorage.getItem("constellationMeta"); } catch {}

    if (!RAW_META_JSON) return;

    try {
      const META = JSON.parse(RAW_META_JSON);

      if (META.width > 0 && META.height > 0) {
        const SCALE_X = S.canvasWidth / META.width;
        const SCALE_Y = S.canvasHeight / META.height;
        const SIZE_SCALE = (S.canvasWidth + S.canvasHeight) / (META.width + META.height);

        for (const STAR of S.starList) {
          STAR.x *= SCALE_X;
          STAR.y *= SCALE_Y;
          STAR.size *= SIZE_SCALE;
        }
      }

      S.pokeImpulseTimer = META.pokeTimer ?? 0;
      S.pointerSpeedUnits = META.userSpeed ?? 0;
      S.pointerRingTimer = META.ringTimer ?? 0;

      S.interactionSettings.attractStrength = META.attractStrength ?? S.interactionSettings.attractStrength;
      S.interactionSettings.attractRadius   = META.attractRadius   ?? S.interactionSettings.attractRadius;
      S.interactionSettings.attractScale    = META.attractScale    ?? S.interactionSettings.attractScale;
      S.interactionSettings.clamp           = META.clamp           ?? S.interactionSettings.clamp;

      S.interactionSettings.repelStrength   = META.repelStrength   ?? S.interactionSettings.repelStrength;
      S.interactionSettings.repelRadius     = META.repelRadius     ?? S.interactionSettings.repelRadius;
      S.interactionSettings.repelScale      = META.repelScale      ?? S.interactionSettings.repelScale;

      S.interactionSettings.pokeStrength    = META.pokeStrength    ?? S.interactionSettings.pokeStrength;

      if (typeof META.userX === "number") S.pointerClientX = META.userX;
      if (typeof META.userY === "number") S.pointerClientY = META.userY;

      S.lastPointerTimeMs = S.getNowMs();
    } catch (ERROR) {
      console.warn("Could not parse constellationMeta; skipping meta restore.", ERROR);
    }
  } catch (ERROR) {
    console.warn("Could not parse constellationStars; recreating.", ERROR);
    S.createNewStars();
  }
};

S.createNewStars = function createNewStars() {
  if (!S.isCanvasReady) return;

  S.starList = [];

  const MIN_SIZE = 3;
  const MAX_SIZE = S.screenPerimeter / 400 || 3;

  for (let STAR_INDEX = 0; STAR_INDEX < S.starCountLimit; STAR_INDEX++) {
    S.starList.push({
      x: Math.random() * S.canvasWidth,
      y: Math.random() * S.canvasHeight,
      vx: S.randomBetween(-0.25, 0.25),
      vy: S.randomBetween(-0.25, 0.25),
      size: S.randomBetween(Math.min(MIN_SIZE, MAX_SIZE), Math.max(MIN_SIZE, MAX_SIZE)),
      opacity: S.randomBetween(0.005, 1.8),
      fadeSpeed: S.randomBetween(1, 2.1),
      redValue: S.randomBetween(50, 200),
      whiteValue: 0,
      momentumX: 0,
      momentumY: 0,
      edge: 1,
      keyboardForceX: 0,
      keyboardForceY: 0
    });
  }
};

/* #endregion 4) INIT */



/*========================================*
//#region 5) UI CONTROLS (STEPPERS + BINDINGS)
 *========================================*/

S.interactionSettings = {
  attractStrength: 50,
  attractRadius: 50,
  attractScale: 5,
  clamp: 5,

  repelStrength: 50,
  repelRadius: 50,
  repelScale: 5,

  pokeStrength: 5
};

S.enableHoldToRepeat = function enableHoldToRepeat(BUTTON, onStep) {
  let HOLD_DELAY_TIMER = null;
  let REPEAT_INTERVAL_TIMER = null;

  const INITIAL_DELAY_MS = 350;
  const START_INTERVAL_MS = 120;
  const MIN_INTERVAL_MS = 40;
  const ACCELERATION = 0.88;

  const startHold = () => {
    let CURRENT_INTERVAL_MS = START_INTERVAL_MS;

    onStep();

    HOLD_DELAY_TIMER = setTimeout(() => {
      REPEAT_INTERVAL_TIMER = setInterval(() => {
        onStep();

        CURRENT_INTERVAL_MS = Math.max(MIN_INTERVAL_MS, CURRENT_INTERVAL_MS * ACCELERATION);

        clearInterval(REPEAT_INTERVAL_TIMER);
        REPEAT_INTERVAL_TIMER = setInterval(onStep, CURRENT_INTERVAL_MS);
      }, CURRENT_INTERVAL_MS);
    }, INITIAL_DELAY_MS);
  };

  const stopHold = () => {
    clearTimeout(HOLD_DELAY_TIMER);
    clearInterval(REPEAT_INTERVAL_TIMER);
    HOLD_DELAY_TIMER = null;
    REPEAT_INTERVAL_TIMER = null;
  };

  BUTTON.addEventListener("mousedown", (EVENT) => { EVENT.preventDefault(); startHold(); });
  BUTTON.addEventListener("mouseup", stopHold);
  BUTTON.addEventListener("mouseleave", stopHold);

  BUTTON.addEventListener("touchstart", (EVENT) => { EVENT.preventDefault(); startHold(); }, { passive: false });
  BUTTON.addEventListener("touchend", stopHold);
  BUTTON.addEventListener("touchcancel", stopHold);
};

S.bindSliderAndNumberInput = function bindSliderAndNumberInput(CONTROL_ID, applySettingValue, INITIAL_VALUE) {
  const SLIDER = document.getElementById(CONTROL_ID);
  if (!SLIDER) return false;

  const NUMBER_INPUT = document.getElementById(CONTROL_ID + "_num");

  const CONTROL_BLOCK = SLIDER.closest(".controlBlock");
  const STEP_BUTTONS = CONTROL_BLOCK ? CONTROL_BLOCK.querySelectorAll(".stepBtn[data-step]") : [];

  const MIN_VALUE = Number(SLIDER.min || (NUMBER_INPUT && NUMBER_INPUT.min) || 0);
  const MAX_VALUE = Number(SLIDER.max || (NUMBER_INPUT && NUMBER_INPUT.max) || 10);

  const RAW_STEP = Number(SLIDER.step || (NUMBER_INPUT && NUMBER_INPUT.step) || 1);
  const STEP_SIZE = Number.isFinite(RAW_STEP) && RAW_STEP > 0 ? RAW_STEP : 1;

  const clampValue = (VALUE) => Math.min(MAX_VALUE, Math.max(MIN_VALUE, VALUE));

  const snapToStep = (VALUE) => {
    const SNAPPED = MIN_VALUE + Math.round((VALUE - MIN_VALUE) / STEP_SIZE) * STEP_SIZE;
    const DECIMAL_PLACES = (String(STEP_SIZE).split(".")[1] || "").length;
    return Number(SNAPPED.toFixed(DECIMAL_PLACES));
  };

  const applyValue = (VALUE) => {
    VALUE = Number(VALUE);
    if (!Number.isFinite(VALUE)) return;

    VALUE = snapToStep(clampValue(VALUE));

    SLIDER.value = String(VALUE);
    if (NUMBER_INPUT) NUMBER_INPUT.value = String(VALUE);

    applySettingValue(VALUE);

    // NOTE: This re-dispatch can be noisy if other listeners exist, but we’re leaving it as-is for behavior parity.
    SLIDER.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const nudgeByStep = (DIRECTION) => applyValue(Number(SLIDER.value) + DIRECTION * STEP_SIZE);

  applyValue(INITIAL_VALUE ?? SLIDER.value);

  SLIDER.addEventListener("input", () => applyValue(SLIDER.value));

  if (NUMBER_INPUT) {
    NUMBER_INPUT.addEventListener("input", () => applyValue(NUMBER_INPUT.value));
    NUMBER_INPUT.addEventListener("change", () => applyValue(NUMBER_INPUT.value));
  }

  STEP_BUTTONS.forEach((BUTTON) => {
    const DIRECTION = Number(BUTTON.dataset.step) || 0;
    if (!DIRECTION) return;
    S.enableHoldToRepeat(BUTTON, () => nudgeByStep(DIRECTION));
  });

  return true;
};

S.initializeGravityControlsIfPresent = function initializeGravityControlsIfPresent() {
  if (
    !document.getElementById("ATTRACT_STRENGTH") &&
    !document.getElementById("REPEL_STRENGTH")
  ) {
    return;
  }

  S.bindSliderAndNumberInput("ATTRACT_STRENGTH", (VALUE) => (S.interactionSettings.attractStrength = VALUE), S.interactionSettings.attractStrength);
  S.bindSliderAndNumberInput("ATTRACT_RADIUS",   (VALUE) => (S.interactionSettings.attractRadius   = VALUE), S.interactionSettings.attractRadius);
  S.bindSliderAndNumberInput("ATTRACT_SCALE",    (VALUE) => (S.interactionSettings.attractScale    = VALUE), S.interactionSettings.attractScale);

  S.bindSliderAndNumberInput("CLAMP",            (VALUE) => (S.interactionSettings.clamp           = VALUE), S.interactionSettings.clamp);

  S.bindSliderAndNumberInput("REPEL_STRENGTH",   (VALUE) => (S.interactionSettings.repelStrength   = VALUE), S.interactionSettings.repelStrength);
  S.bindSliderAndNumberInput("REPEL_RADIUS",     (VALUE) => (S.interactionSettings.repelRadius     = VALUE), S.interactionSettings.repelRadius);
  S.bindSliderAndNumberInput("REPEL_SCALE",      (VALUE) => (S.interactionSettings.repelScale      = VALUE), S.interactionSettings.repelScale);

  S.bindSliderAndNumberInput("POKE_STRENGTH",    (VALUE) => (S.interactionSettings.pokeStrength    = VALUE), S.interactionSettings.pokeStrength);
};

document.addEventListener("DOMContentLoaded", S.initializeGravityControlsIfPresent);

/* #endregion 5) UI CONTROLS */



/*========================================*
//#region 6) RESIZE + ANIMATION
 *========================================*/

S.resizeStarfieldCanvas = function resizeStarfieldCanvas() {
  if (!S.isCanvasReady) return;

  const OLD_WIDTH = S.canvasWidth;
  const OLD_HEIGHT = S.canvasHeight;
  const OLD_SCREEN_PERIMETER = S.screenPerimeter || 1;

  S.canvasWidth = window.innerWidth || 0;
  S.canvasHeight = window.innerHeight || 0;

  S.constellationCanvas.width = S.canvasWidth;
  S.constellationCanvas.height = S.canvasHeight;

  S.screenPerimeter = S.canvasWidth + S.canvasHeight;
  S.screenScaleUp = Math.pow(S.screenPerimeter / 1200, 0.35);
  S.screenScaleDown = Math.pow(1200 / S.screenPerimeter, 0.35);

  // 1a) OPTION B: lower star count everywhere
  S.starCountLimit = Math.min(350, S.screenScaleDown * 105);

  S.maxLinkDistance = S.screenScaleUp * 246;

  S.screenScalePowers.attractionGradient = S.screenScaleUp ** 1.11; // LAGGY-ish: pow
  S.screenScalePowers.repulsionGradient  = S.screenScaleUp ** 0.66; // LAGGY-ish: pow
  S.screenScalePowers.attractionShape    = S.screenScaleUp ** -8.89; // LAGGY-ish: pow
  S.screenScalePowers.attractionForce    = S.screenScaleUp ** -8.46; // LAGGY-ish: pow
  S.screenScalePowers.repulsionForce     = S.screenScaleUp ** -0.89; // LAGGY-ish: pow
  S.screenScalePowers.forceClamp         = S.screenScaleUp ** 1.8; // LAGGY-ish: pow

  if (OLD_WIDTH !== 0 && OLD_HEIGHT !== 0 && S.starList.length) {
    const SCALE_X = S.canvasWidth / OLD_WIDTH;
    const SCALE_Y = S.canvasHeight / OLD_HEIGHT;
    const SIZE_SCALE = S.screenPerimeter / OLD_SCREEN_PERIMETER;

    for (const STAR of S.starList) {
      STAR.x *= SCALE_X;
      STAR.y *= SCALE_Y;
      STAR.size *= SIZE_SCALE;
    }
  }
};

function runAnimationLoop() {
  if (!S.isCanvasReady) return;

  if (!S.isFrozen && typeof S.updateStarPhysics === "function") {
    S.updateStarPhysics();
  }

  if (typeof S.renderStarsAndLinks === "function") {
    S.renderStarsAndLinks();
  }

  requestAnimationFrame(runAnimationLoop);
}

S._runAnimationLoop = runAnimationLoop;

/* #endregion 6) RESIZE + ANIMATION */



/*========================================*
//#region 7) BOOTSTRAP
 *========================================*/

function isCanvasSizeUsable() {
  return (
    Number.isFinite(S.canvasWidth) &&
    Number.isFinite(S.canvasHeight) &&
    S.canvasWidth > 50 &&
    S.canvasHeight > 50
  );
}

function startStarfield() {
  S.resizeStarfieldCanvas();

  if (!isCanvasSizeUsable()) {
    requestAnimationFrame(startStarfield);
    return;
  }

  if (!S.hasStarsInitialized) {
    S.hasStarsInitialized = true;
    S.restoreOrCreateStars();
  }

  if (!S.hasAnimationLoopStarted) {
    S.hasAnimationLoopStarted = true;
    S._runAnimationLoop();
  }

  if (!S.hasResizeListenerWired) {
    S.hasResizeListenerWired = true;
    window.addEventListener("resize", S.resizeStarfieldCanvas);
  }
}

try {
  startStarfield();
} catch (ERROR) {
  console.error("Initialization error in Starfield Setup:", ERROR);
}

/* #endregion 7) BOOTSTRAP */