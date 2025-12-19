// thank heavens for chatGPT <3

/*==============================================================*
 *                         STARFIELD SCRIPT
 *==============================================================*
 *  What this file does:
 *   1) Canvas setup + runtime guards
 *   2) Star persistence (localStorage) + restore/rescale
 *   3) Star creation + physics (attract / repel / poke)
 *   4) Drawing (stars + links + optional pointer ring)
 *   5) Pointer input (mouse/touch) -> speed + timers
 *   6) Animation loop + resize handling
 *
 *  Performance upgrades added (keeps same visual behavior):
 *   - Link drawing: squared-distance cutoff + bucketed Path2D strokes
 *   - Edge fade: computed once per star per frame (not per pair)
 *   - Debug: still in moveStars, same outputs, but kept lightweight
 *==============================================================*/

//#region 1) CANVAS + GLOBAL STATE
/*========================================*
 *  CANVAS + RUNTIME FLAGS
 *========================================*/

const CANVAS = document.getElementById('constellations');
const BRUSH = CANVAS && CANVAS.getContext ? CANVAS.getContext('2d') : null;
const HAS_CANVAS = !!(CANVAS && BRUSH);

if (!HAS_CANVAS) {
  console.warn('Constellation canvas not found or unsupported; starfield disabled.');
}

// Prevent repeats/loops (useful if scripts get reloaded)
let FREEZE_CONSTELLATION = false;
let ANIMATION_STARTED = false;
let RESIZE_WIRED = false;
let STARS_INITIALIZED = false;

// Pointer state + timers
let USER_X = 0;
let USER_Y = 0;
let USER_TIME = 0;   // also acts as “pointer exists” flag
let USER_SPEED = 0;
let POKE_TIMER = 0;
let CIRCLE_TIMER = 0;

// Cross-script flag (preserved across pages if set earlier)
window.REMOVE_CIRCLE = window.REMOVE_CIRCLE ?? false;

// Canvas sizing + scaling
let WIDTH = 0;
let HEIGHT = 0;
let SCREEN_SIZE = 0;       // WIDTH + HEIGHT
let SCALE_TO_SCREEN = 0;   // your main scale factor
let MAX_STAR_COUNT = 0;
let MAX_LINK_DISTANCE = 0;

// Starfield data
let STARS = [];
//#endregion



//#region 2) STORAGE (localStorage)
/*========================================*
 *  STORAGE
 *========================================*
 *  Saves:
 *   - constellationStars: full star array
 *   - constellationMeta: canvas size + pointer/timers + UI params
 *========================================*/

function saveStarsToStorage() {
  if (!HAS_CANVAS) return;

  try {
    localStorage.setItem('constellationStars', JSON.stringify(STARS));

    localStorage.setItem(
      'constellationMeta',
      JSON.stringify({
        width: WIDTH,
        height: HEIGHT,

        // pointer + timers
        pokeTimer: POKE_TIMER,
        userSpeed: USER_SPEED,
        userX: USER_X,
        userY: USER_Y,
        userTime: USER_TIME,

        // UI params
        attractStrength: ATTRACT_STRENGTH,
        attractRadius: ATTRACT_RADIUS,
        attractScale: ATTRACT_SCALE,
        clamp: CLAMP,
        repelStrength: REPEL_STRENGTH,
        repelRadius: REPEL_RADIUS,
        repelScale: REPEL_SCALE,
        pokeStrength: POKE_STRENGTH
      })
    );
  } catch (ERR) {
    console.warn('Could not save stars:', ERR);
  }
}

window.addEventListener('beforeunload', saveStarsToStorage);
//#endregion



//#region 3) UTILITIES
/*========================================*
 *  UTILITIES
 *========================================*/

function nowMs() {
  return (window.performance && performance.now) ? performance.now() : Date.now();
}

const randomBetween = (MIN, MAX) => Math.random() * (MAX - MIN) + MIN;

// 0 at/beyond wrap threshold, 1 when safely away from edges
function edgeFactor(STAR) {
  const RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

  // Distance from the “fully off-screen” threshold on each side
  const LEFT = STAR.x + RADIUS;               // 0 when x == -R
  const RIGHT = WIDTH + RADIUS - STAR.x;      // 0 when x == WIDTH + R
  const TOP = STAR.y + RADIUS;                // 0 when y == -R
  const BOTTOM = HEIGHT + RADIUS - STAR.y;    // 0 when y == HEIGHT + R

  const MIN_DIST = Math.min(LEFT, RIGHT, TOP, BOTTOM);

  // Fade band width (gentle)
  const FADE_BAND = Math.min(90, SCREEN_SIZE * 0.03);

  let T = MIN_DIST / FADE_BAND;
  if (T < 0) T = 0;
  if (T > 1) T = 1;

  // Smoothstep
  return T * T * (3 - 2 * T);
}
//#endregion



//#region 4) INIT: RESTORE OR CREATE STARS
/*========================================*
 *  INIT STARS
 *========================================*/

function initStars() {
  if (!HAS_CANVAS) return;

  let SAVED_STARS_RAW = null;

  try {
    SAVED_STARS_RAW = localStorage.getItem('constellationStars');
  } catch (ERR) {
    console.warn('Could not read constellationStars from storage:', ERR);
    createStars();
    return;
  }

  if (!SAVED_STARS_RAW) {
    createStars();
    return;
  }

  try {
    const PARSED_STARS = JSON.parse(SAVED_STARS_RAW);

    if (Array.isArray(PARSED_STARS) && PARSED_STARS.length) {
      STARS = PARSED_STARS;

      // Optional meta restore
      let META_RAW = null;
      try {
        META_RAW = localStorage.getItem('constellationMeta');
      } catch (ERR) {
        console.warn('Could not read constellationMeta from storage:', ERR);
      }

      if (META_RAW) {
        try {
          const META = JSON.parse(META_RAW);

          // Rescale coordinates from old canvas size to current
          if (META.width > 0 && META.height > 0) {
            const SCALE_X = WIDTH / META.width;
            const SCALE_Y = HEIGHT / META.height;
            const SIZE_SCALE = (WIDTH + HEIGHT) / (META.width + META.height);

            for (const STAR of STARS) {
              STAR.x *= SCALE_X;
              STAR.y *= SCALE_Y;
              STAR.size *= SIZE_SCALE;
            }
          }

          // Restore timers + pointer state + gravity control values
          POKE_TIMER = META.pokeTimer ?? 0;
          USER_SPEED = META.userSpeed ?? 0;

          ATTRACT_STRENGTH = META.attractStrength ?? ATTRACT_STRENGTH;
          ATTRACT_RADIUS   = META.attractRadius   ?? ATTRACT_RADIUS;
          ATTRACT_SCALE    = META.attractScale    ?? ATTRACT_SCALE;
          CLAMP            = META.clamp           ?? CLAMP;
          REPEL_STRENGTH   = META.repelStrength   ?? REPEL_STRENGTH;
          REPEL_RADIUS     = META.repelRadius     ?? REPEL_RADIUS;
          REPEL_SCALE      = META.repelScale      ?? REPEL_SCALE;
          POKE_STRENGTH    = META.pokeStrength    ?? POKE_STRENGTH;

          if (typeof META.userX === 'number') USER_X = META.userX;
          if (typeof META.userY === 'number') USER_Y = META.userY;

          // USER_TIME acts as a “pointer exists” flag in drawing
          if (typeof META.userTime === 'number' && META.userTime > 0) {
            USER_TIME = META.userTime;
          } else {
            USER_TIME = nowMs();
          }
        } catch (ERR) {
          console.warn('Could not parse constellationMeta, skipping meta restore.', ERR);
        }
      }

      return;
    }

    // Empty or invalid star array
    createStars();
  } catch (ERR) {
    console.error('Could not parse saved stars, recreating.', ERR);
    createStars();
  }
}

function createStars() {
  if (!HAS_CANVAS) return;

  STARS = [];

  // Keep size range valid even on very small screens
  const MIN_STAR_SIZE = 3;
  const MAX_STAR_SIZE = SCREEN_SIZE / 400 || 3;

  for (let STAR_INDEX = 0; STAR_INDEX < MAX_STAR_COUNT; STAR_INDEX++) {
    STARS.push({
      x: Math.random() * WIDTH,
      y: Math.random() * HEIGHT,
      vx: randomBetween(-0.25, 0.25),
      vy: randomBetween(-0.25, 0.25),
      size: randomBetween(
        Math.min(MIN_STAR_SIZE, MAX_STAR_SIZE),
        Math.max(MIN_STAR_SIZE, MAX_STAR_SIZE)
      ),
      opacity: randomBetween(0.005, 1.8),
      fadeSpeed: randomBetween(1, 2.1),
      redValue: randomBetween(0, 200),
      whiteValue: 0,
      momentumX: 0,
      momentumY: 0,

      // PERF: we cache edge factor per frame for link drawing
      edge: 1
    });
  }
}
//#endregion



//#region 5) UI CONTROLS (STEPPERS + BINDINGS)
/*========================================*
 *  HOLD-TO-REPEAT STEPPERS
 *========================================*/

function enableStepperHold(BUTTON, onStep) {
  let HOLD_TIMER = null;
  let REPEAT_TIMER = null;

  const INITIAL_DELAY_MS = 350;
  const START_INTERVAL_MS = 120;
  const MIN_INTERVAL_MS = 40;
  const ACCELERATION = 0.88;

  const startHold = () => {
    let INTERVAL = START_INTERVAL_MS;

    // Immediate first step
    onStep();

    HOLD_TIMER = setTimeout(() => {
      REPEAT_TIMER = setInterval(() => {
        onStep();
        INTERVAL = Math.max(MIN_INTERVAL_MS, INTERVAL * ACCELERATION);

        // Restart interval to apply acceleration
        clearInterval(REPEAT_TIMER);
        REPEAT_TIMER = setInterval(onStep, INTERVAL);
      }, INTERVAL);
    }, INITIAL_DELAY_MS);
  };

  const stopHold = () => {
    clearTimeout(HOLD_TIMER);
    clearInterval(REPEAT_TIMER);
    HOLD_TIMER = null;
    REPEAT_TIMER = null;
  };

  // Mouse
  BUTTON.addEventListener('mousedown', (E) => {
    E.preventDefault();
    startHold();
  });
  BUTTON.addEventListener('mouseup', stopHold);
  BUTTON.addEventListener('mouseleave', stopHold);

  // Touch
  BUTTON.addEventListener(
    'touchstart',
    (E) => {
      E.preventDefault();
      startHold();
    },
    { passive: false }
  );

  BUTTON.addEventListener('touchend', stopHold);
  BUTTON.addEventListener('touchcancel', stopHold);
}

/*========================================*
 *  GRAVITY PARAMS (bound to UI)
 *========================================*/

let ATTRACT_STRENGTH = 50;
let ATTRACT_RADIUS = 50;
let ATTRACT_SCALE = 5;
let CLAMP = 5;
let REPEL_STRENGTH = 50;
let REPEL_RADIUS = 50;
let REPEL_SCALE = 5;
let POKE_STRENGTH = 5;

function bindControl(ID, setter, INITIAL_VALUE) {
  const SLIDER = document.getElementById(ID);
  if (!SLIDER) return false;

  const NUMBER_INPUT = document.getElementById(ID + '_num');

  const CONTROL_BLOCK = SLIDER.closest('.controlBlock');
  const STEP_BUTTONS = CONTROL_BLOCK
    ? CONTROL_BLOCK.querySelectorAll('.stepBtn[data-step]')
    : [];

  const MIN = Number(SLIDER.min || (NUMBER_INPUT && NUMBER_INPUT.min) || 0);
  const MAX = Number(SLIDER.max || (NUMBER_INPUT && NUMBER_INPUT.max) || 10);

  // Step size: prefer slider.step, else number.step, else 1
  const RAW_STEP = Number(SLIDER.step || (NUMBER_INPUT && NUMBER_INPUT.step) || 1);
  const STEP = Number.isFinite(RAW_STEP) && RAW_STEP > 0 ? RAW_STEP : 1;

  const clampValue = (V) => Math.min(MAX, Math.max(MIN, V));

  const snapToStep = (V) => {
    if (!Number.isFinite(STEP) || STEP <= 0) return V;

    const SNAPPED = MIN + Math.round((V - MIN) / STEP) * STEP;
    const DECIMALS = (String(STEP).split('.')[1] || '').length;

    return Number(SNAPPED.toFixed(DECIMALS));
  };

  const applyValue = (V) => {
    V = Number(V);
    if (!Number.isFinite(V)) return;

    V = clampValue(V);
    V = snapToStep(V);

    SLIDER.value = String(V);
    if (NUMBER_INPUT) NUMBER_INPUT.value = String(V);

    setter(V);

    // Keeps any slider fill-gradient logic in sync (if present)
    SLIDER.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const nudge = (DIR) => {
    const CURRENT = Number(SLIDER.value);
    applyValue(CURRENT + DIR * STEP);
  };

  // Initialize from JS value (restored state wins)
  applyValue(INITIAL_VALUE ?? SLIDER.value);

  SLIDER.addEventListener('input', () => applyValue(SLIDER.value));

  if (NUMBER_INPUT) {
    NUMBER_INPUT.addEventListener('input', () => applyValue(NUMBER_INPUT.value));
    NUMBER_INPUT.addEventListener('change', () => applyValue(NUMBER_INPUT.value));
  }

  STEP_BUTTONS.forEach((BTN) => {
    const DIR = Number(BTN.dataset.step) || 0;
    if (!DIR) return;
    enableStepperHold(BTN, () => nudge(DIR));
  });

  return true;
}

function initGravityControlsIfPresent() {
  // Bail quickly if page has none
  if (!document.getElementById('ATTRACT_STRENGTH') &&
      !document.getElementById('REPEL_STRENGTH')) {
    return;
  }

  // Attract
  bindControl('ATTRACT_STRENGTH', (V) => (ATTRACT_STRENGTH = V), ATTRACT_STRENGTH);
  bindControl('ATTRACT_RADIUS',   (V) => (ATTRACT_RADIUS   = V), ATTRACT_RADIUS);
  bindControl('ATTRACT_SCALE',    (V) => (ATTRACT_SCALE    = V), ATTRACT_SCALE);

  // Clamp
  bindControl('CLAMP',            (V) => (CLAMP            = V), CLAMP);

  // Repel
  bindControl('REPEL_STRENGTH',   (V) => (REPEL_STRENGTH   = V), REPEL_STRENGTH);
  bindControl('REPEL_RADIUS',     (V) => (REPEL_RADIUS     = V), REPEL_RADIUS);
  bindControl('REPEL_SCALE',      (V) => (REPEL_SCALE      = V), REPEL_SCALE);

  // Poke
  bindControl('POKE_STRENGTH',    (V) => (POKE_STRENGTH    = V), POKE_STRENGTH);
}

document.addEventListener('DOMContentLoaded', initGravityControlsIfPresent);
//#endregion



//#region 6) PHYSICS (MOVE STARS)
/*========================================*
 *  MOVE STARS
 *========================================*
 *  Same behavior as your working version:
 *   - influence range = SCREEN_SIZE * 0.2
 *   - attraction + repulsion gradients
 *   - poke adds an extra kick away
 *   - momentum decays
 *   - wrap vs bounce logic preserved
 *========================================*/

function moveStars() {
  if (!HAS_CANVAS || !STARS.length) return;

  const RANGE = SCREEN_SIZE * 0.2;

  for (const STAR of STARS) {
    const X_DISTANCE = USER_X - STAR.x;
    const Y_DISTANCE = USER_Y - STAR.y;

    const DISTANCE = Math.hypot(X_DISTANCE, Y_DISTANCE) + 0.0001;
    const TO_USER_X = X_DISTANCE / DISTANCE;
    const TO_USER_Y = Y_DISTANCE / DISTANCE;

    // Apply ring forces only within influence range
    if (DISTANCE < RANGE) {
      // Linear gradients (0..1)
      let ATTR_GRADIENT =
        1 - (DISTANCE / (((ATTRACT_RADIUS * 5.2) * (SCALE_TO_SCREEN ** 1.11)) || 1));

      let REPEL_GRADIENT =
        1 - (DISTANCE / (((REPEL_RADIUS * 2.8) * (SCALE_TO_SCREEN ** 0.66)) || 1));

      // Clamp gradients to [0, +inf) then shapes handle the curve
      ATTR_GRADIENT = Math.max(0, ATTR_GRADIENT);
      REPEL_GRADIENT = Math.max(0, REPEL_GRADIENT);

      const ATTR_SHAPE = Math.pow(
        ATTR_GRADIENT,
        Math.max(0.1, ((ATTRACT_SCALE * 0.48) * (SCALE_TO_SCREEN ** -8.89)))
      );

      const REPEL_SHAPE = Math.pow(
        REPEL_GRADIENT,
        Math.max(0.1, (REPEL_SCALE * 0.64))
      );

      // Attraction
      const ATTRACT =
        ((ATTRACT_STRENGTH * 0.006) * (SCALE_TO_SCREEN ** -8.46)) *
        USER_SPEED *
        ATTR_SHAPE;

      // Repulsion
      const REPEL =
        ((REPEL_STRENGTH * 0.0182) * (SCALE_TO_SCREEN ** -0.89)) *
        USER_SPEED *
        REPEL_SHAPE;

      STAR.momentumX += ATTRACT * TO_USER_X;
      STAR.momentumY += ATTRACT * TO_USER_Y;

      STAR.momentumX += REPEL * -TO_USER_X;
      STAR.momentumY += REPEL * -TO_USER_Y;

      // Poke: extra kick away (also respects repel shape)
      const POKE = (0.01 * POKE_STRENGTH) * POKE_TIMER * REPEL_SHAPE;
      STAR.momentumX += POKE * -TO_USER_X;
      STAR.momentumY += POKE * -TO_USER_Y;
    }

    // Global boost: user interaction increases baseline drift speed
    STAR.momentumX += STAR.vx * Math.min(10, 0.05 * USER_SPEED);
    STAR.momentumY += STAR.vy * Math.min(10, 0.05 * USER_SPEED);

    // Clamp force magnitude (same intent as original)
    let FORCE_X = STAR.momentumX;
    let FORCE_Y = STAR.momentumY;

    const LIMIT = CLAMP * (SCALE_TO_SCREEN ** 2);
    const FORCE_MAG = Math.hypot(FORCE_X, FORCE_Y);

    if (FORCE_MAG > LIMIT) {
      const SCALE = LIMIT / FORCE_MAG;
      FORCE_X *= SCALE;
      FORCE_Y *= SCALE;
    }

    // Apply motion
    STAR.x += STAR.vx + FORCE_X;
    STAR.y += STAR.vy + FORCE_Y;

    // Momentum decay
    STAR.momentumX *= 0.98;
    STAR.momentumY *= 0.98;

    // Wrap when passive OR far OR heavy poke
    // (Preserved: same thresholds, just kept readable)
    if (CIRCLE_TIMER == 0 || DISTANCE > 200 || POKE_TIMER > 1000) {
      const RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

      if (STAR.x < -RADIUS) STAR.x = WIDTH + RADIUS;
      else if (STAR.x > WIDTH + RADIUS) STAR.x = -RADIUS;

      if (STAR.y < -RADIUS) STAR.y = HEIGHT + RADIUS;
      else if (STAR.y > HEIGHT + RADIUS) STAR.y = -RADIUS;
    } else {
      // Bounce in interactive mode
      const RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

      if (STAR.x < RADIUS) {
        STAR.x = 2 * RADIUS - STAR.x;
        STAR.momentumX = -STAR.momentumX;
      } else if (STAR.x > WIDTH - RADIUS) {
        STAR.x = 2 * (WIDTH - RADIUS) - STAR.x;
        STAR.momentumX = -STAR.momentumX;
      }

      if (STAR.y < RADIUS) {
        STAR.y = 2 * RADIUS - STAR.y;
        STAR.momentumY = -STAR.momentumY;
      } else if (STAR.y > HEIGHT - RADIUS) {
        STAR.y = 2 * (HEIGHT - RADIUS) - STAR.y;
        STAR.momentumY = -STAR.momentumY;
      }
    }

    // White flash decay
    if (STAR.whiteValue > 0) {
      STAR.whiteValue *= 0.98;
      if (STAR.whiteValue < 0.001) STAR.whiteValue = 0;
    }

    // Opacity cycle
    if (STAR.opacity <= 0.005) {
      STAR.opacity = 1;
      if (Math.random() < 0.07) STAR.whiteValue = 1;
    } else if (STAR.opacity > 0.02) {
      STAR.opacity -= 0.005 * STAR.fadeSpeed;
    } else {
      STAR.opacity -= 0.0001;
    }
  }

  // Global decay (timers + interaction energy)
  USER_SPEED *= 0.5;
  if (USER_SPEED < 0.001) USER_SPEED = 0;

  CIRCLE_TIMER *= 0.9;
  if (CIRCLE_TIMER < 0.1) CIRCLE_TIMER = 0;

  POKE_TIMER *= 0.85;
  if (POKE_TIMER < 1) POKE_TIMER = 0;

  // Debug readouts (same behavior as original)
  const MISC_DEBUG = 0; // <-- Change this to any variable to see live updates
  const DBG_MISC = document.getElementById('miscDbg');
  if (DBG_MISC) DBG_MISC.textContent = MISC_DEBUG.toFixed(3);

  const DBG_CIRCLE = document.getElementById('dbgCircle');
  if (DBG_CIRCLE) DBG_CIRCLE.textContent = CIRCLE_TIMER.toFixed(3);

  const DBG_SPEED = document.getElementById('dbgSpeed');
  if (DBG_SPEED) DBG_SPEED.textContent = USER_SPEED.toFixed(3);

  const DBG_POKE = document.getElementById('dbgPoke');
  if (DBG_POKE) DBG_POKE.textContent = POKE_TIMER.toFixed(1);
}
//#endregion



//#region 7) RENDERING (STARS + LINKS + RING)
/*========================================*
 *  DRAWING
 *========================================*
 *  Keeps the same look:
 *   - pointer ring is unchanged
 *   - star bodies unchanged
 *   - links: same alpha logic, but drawn faster
 *
 *  Performance upgrades:
 *   - edgeFactor cached per star (STAR.edge)
 *   - squared-distance cutoff before sqrt
 *   - Path2D buckets: many lines, few strokes
 *========================================*/

const LINK_BUCKET_COUNT = 18;
let LINK_PATHS = Array.from({ length: LINK_BUCKET_COUNT }, () => new Path2D());

function resetLinkPaths() {
  for (let i = 0; i < LINK_BUCKET_COUNT; i++) LINK_PATHS[i] = new Path2D();
}

function drawStarsWithLines() {
  if (!HAS_CANVAS || !BRUSH) return;

  BRUSH.clearRect(0, 0, WIDTH, HEIGHT);

  // Optional ring around pointer
  if (!window.REMOVE_CIRCLE) {
    const RING_RADIUS = SCALE_TO_SCREEN * 100 - 40;
    const RING_WIDTH = CIRCLE_TIMER * 0.15 + 1.5;
    const RING_ALPHA = Math.min(CIRCLE_TIMER * 0.07, 1);

    if (USER_TIME > 0 && RING_ALPHA > 0.001) {
      BRUSH.save();
      BRUSH.lineWidth = RING_WIDTH;
      BRUSH.strokeStyle = 'rgba(0, 0, 0, 1)';
      BRUSH.globalAlpha = RING_ALPHA;

      BRUSH.beginPath();
      BRUSH.arc(USER_X, USER_Y, RING_RADIUS, 0, Math.PI * 2);
      BRUSH.stroke();

      BRUSH.restore();
    }
  }

  // Lines between nearby stars (optimized)
  BRUSH.lineWidth = 1;

  const STAR_COUNT = STARS.length;
  if (STAR_COUNT) {
    // Cache edge fade once per star per frame (same logic, fewer calls)
    for (let i = 0; i < STAR_COUNT; i++) {
      STARS[i].edge = edgeFactor(STARS[i]);
    }

    // Match original scaling: hypot(dx,dy)/1100*SCREEN_SIZE
    // => dist = sqrt(d2) * (SCREEN_SIZE / 1100)
    const DIST_SCALE = SCREEN_SIZE / 1100;

    // Squared cutoff in raw canvas pixels (avoid sqrt unless needed)
    const CUTOFF_RAW = MAX_LINK_DISTANCE / DIST_SCALE;
    const CUTOFF2 = CUTOFF_RAW * CUTOFF_RAW;

    resetLinkPaths();

    for (let i = 0; i < STAR_COUNT; i++) {
      const A = STARS[i];
      const Ax = A.x, Ay = A.y;
      const Aop = A.opacity;
      const Aedge = A.edge;

      for (let j = i + 1; j < STAR_COUNT; j++) {
        const B = STARS[j];

        const dx = Ax - B.x;
        const dy = Ay - B.y;
        const d2 = dx * dx + dy * dy;

        if (d2 > CUTOFF2) continue;

        const DISTANCE = Math.sqrt(d2) * DIST_SCALE;

        // Same alpha logic as original
        let ALPHA = (1 - DISTANCE / MAX_LINK_DISTANCE) * ((Aop + B.opacity) / 2);
        ALPHA *= Math.min(Aedge, B.edge);

        if (ALPHA <= 0.002) continue;

        // Bucket alpha (0..1) into a small set of stroke calls
        let BUCKET = (ALPHA * (LINK_BUCKET_COUNT - 1)) | 0;
        if (BUCKET < 0) BUCKET = 0;
        if (BUCKET >= LINK_BUCKET_COUNT) BUCKET = LINK_BUCKET_COUNT - 1;

        LINK_PATHS[BUCKET].moveTo(Ax, Ay);
        LINK_PATHS[BUCKET].lineTo(B.x, B.y);
      }
    }

    // Stroke from faint to strong
    for (let b = 0; b < LINK_BUCKET_COUNT; b++) {
      const BUCKET_ALPHA = (b + 1) / LINK_BUCKET_COUNT;
      BRUSH.strokeStyle = `rgba(0, 0, 0, ${BUCKET_ALPHA})`;
      BRUSH.stroke(LINK_PATHS[b]);
    }
  }

  // Star bodies (unchanged)
  for (const STAR of STARS) {
    let TEMP_RED = 255 * STAR.whiteValue + STAR.redValue;
    if (TEMP_RED > 255) TEMP_RED = 255;

    BRUSH.beginPath();
    BRUSH.fillStyle = `rgba(${TEMP_RED}, ${255 * STAR.whiteValue}, ${255 * STAR.whiteValue}, ${STAR.opacity})`;
    BRUSH.arc(STAR.x, STAR.y, STAR.whiteValue * 2 + STAR.size, 0, Math.PI * 2);
    BRUSH.fill();
  }
}

// External redraw hook (used by other scripts)
window.forceStarfieldRedraw = () => {
  if (!BRUSH || !CANVAS) return;
  drawStarsWithLines();
};
//#endregion



//#region 8) RESIZE + ANIMATION
/*========================================*
 *  RESIZE
 *========================================*/

function resizeCanvas() {
  if (!HAS_CANVAS) return;

  const OLD_WIDTH = WIDTH;
  const OLD_HEIGHT = HEIGHT;
  const OLD_SCREEN_SIZE = SCREEN_SIZE || 1;

  WIDTH = window.innerWidth || 0;
  HEIGHT = window.innerHeight || 0;

  CANVAS.width = WIDTH;
  CANVAS.height = HEIGHT;

  SCREEN_SIZE = WIDTH + HEIGHT;
  SCALE_TO_SCREEN = Math.pow(SCREEN_SIZE / 1200, 0.35);
  MAX_STAR_COUNT = Math.min(450, SCREEN_SIZE / 10);
  MAX_LINK_DISTANCE = SCREEN_SIZE / 10;

  // Rescale existing stars to new canvas
  if (OLD_WIDTH !== 0 && OLD_HEIGHT !== 0) {
    const SCALE_X = WIDTH / OLD_WIDTH;
    const SCALE_Y = HEIGHT / OLD_HEIGHT;
    const SIZE_SCALE = SCREEN_SIZE / OLD_SCREEN_SIZE;

    for (const STAR of STARS) {
      STAR.x *= SCALE_X;
      STAR.y *= SCALE_Y;
      STAR.size *= SIZE_SCALE;
    }
  }
}

function animate() {
  if (!HAS_CANVAS) return;

  if (!FREEZE_CONSTELLATION) moveStars();
  drawStarsWithLines();

  requestAnimationFrame(animate);
}
//#endregion



//#region 9) POINTER INPUT (SPEED UPDATES)
/*========================================*
 *  POINTER INPUT
 *========================================*
 *  “Speed updates” applied:
 *   - Uses event timeStamp when available (more consistent)
 *   - Single pipeline for mouse + touch
 *   - Preserves original scaling/behavior:
 *       USER_SPEED = min(raw * 50, 50)
 *       CIRCLE_TIMER = max(CIRCLE_TIMER, USER_SPEED)
 *       POKE_TIMER set to 2500 on start interaction
 *========================================*/

function updateSpeed(X, Y, TIME) {
  if (!Number.isFinite(TIME)) TIME = nowMs();

  const DT = Math.max(1, TIME - USER_TIME);
  const DX = X - USER_X;
  const DY = Y - USER_Y;

  const RAW_USER_SPEED = Math.hypot(DX, DY) / DT;

  USER_SPEED = Math.min(RAW_USER_SPEED * 50, 50);
  CIRCLE_TIMER = Math.max(CIRCLE_TIMER, USER_SPEED);

  USER_X = X;
  USER_Y = Y;
  USER_TIME = TIME;
}

function startPointerInteraction(X, Y, TIME) {
  POKE_TIMER = 2500; // Repel on click/touch
  updateSpeed(X, Y, TIME);
}

// Mouse move
window.addEventListener('mousemove', (E) =>
  updateSpeed(E.clientX, E.clientY, E.timeStamp)
);

// Mouse down
window.addEventListener('mousedown', (E) =>
  startPointerInteraction(E.clientX, E.clientY, E.timeStamp)
);

// Touch start
window.addEventListener('touchstart', (E) => {
  const TOUCH_POINT = E.touches[0];
  if (!TOUCH_POINT) return;
  startPointerInteraction(TOUCH_POINT.clientX, TOUCH_POINT.clientY, E.timeStamp);
});

// Touch move
window.addEventListener('touchmove', (E) => {
  const TOUCH_POINT = E.touches[0];
  if (!TOUCH_POINT) return;
  updateSpeed(TOUCH_POINT.clientX, TOUCH_POINT.clientY, E.timeStamp);
});
//#endregion



//#region 10) BOOTSTRAP
/*========================================*
 *  STARTUP
 *========================================*/

function sizesReady() {
  return (
    Number.isFinite(WIDTH) &&
    Number.isFinite(HEIGHT) &&
    WIDTH > 50 &&
    HEIGHT > 50
  );
}

function startStarfield() {
  resizeCanvas();

  // First-load guard: wait for real viewport sizes
  if (!sizesReady()) {
    requestAnimationFrame(startStarfield);
    return;
  }

  if (!STARS_INITIALIZED) {
    STARS_INITIALIZED = true;
    initStars();
  }

  if (!ANIMATION_STARTED) {
    ANIMATION_STARTED = true;
    animate();
  }

  if (!RESIZE_WIRED) {
    RESIZE_WIRED = true;
    window.addEventListener('resize', resizeCanvas);
  }
}

try {
  startStarfield();
} catch (ERR) {
  console.error('Initialization error in starfield script:', ERR);
}
//#endregion


// Joke: we reduced the number of “stroke()” calls so your GPU can stop writing tiny sad poems in its diary. ✍️🖥️