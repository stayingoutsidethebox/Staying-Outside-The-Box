// thank heavens for chatGPT <3

/*==============================================================*
 *                         STARFIELD SCRIPT
 *==============================================================*
 *  Responsibilities:
 *   - Canvas + drawing context setup
 *   - Star storage (localStorage) + restore
 *   - Star creation + motion + wrap/bounce
 *   - Pointer input (mouse/touch) -> speed + poke + ring timers
 *   - Animation loop + resize handling
 *
 *  Design notes:
 *   - USER_TIME is intentionally a “pointer exists” flag:
 *       0 = never interacted (ring stays hidden)
 *       >0 = pointer has been seen (ring allowed)
 *==============================================================*/


//#region 1) CANVAS + GLOBAL STATE
/*========================================*
 *  CANVAS + GLOBAL STATE
 *========================================*/

const CANVAS = document.getElementById('constellations');
const BRUSH = CANVAS && CANVAS.getContext ? CANVAS.getContext('2d') : null;
const HAS_CANVAS = !!(CANVAS && BRUSH);

if (!HAS_CANVAS) {
  console.warn('Constellation canvas not found or unsupported; starfield disabled.');
}

// Runtime guards
let FREEZE_CONSTELLATION = false;
let ANIMATION_STARTED = false;
let RESIZE_WIRED = false;
let STARS_INITIALIZED = false;

// Pointer state + timers
let USER_X = 0;
let USER_Y = 0;
let USER_TIME = 0;     // IMPORTANT: “pointer exists” flag (see header)
let USER_SPEED = 0;

let POKE_TIMER = 0;
let CIRCLE_TIMER = 0;

// Cross-script flag (preserved across pages if set earlier)
window.REMOVE_CIRCLE = window.REMOVE_CIRCLE ?? false;

// Canvas size + scaling
let CANVAS_WIDTH = 0;
let CANVAS_HEIGHT = 0;
let SCREEN_SIZE = 0;          // width + height
let SCALE_TO_SCREEN = 0;
let MAX_STAR_COUNT = 0;
let MAX_LINK_DISTANCE = 0;

// Starfield data
let STARS = [];

//#endregion



//#region 2) GRAVITY PARAMS + PRECOMPUTED SCALE FACTORS
/*========================================*
 *  GRAVITY PARAMS + PRECOMPUTED SCALE FACTORS
 *========================================*/

let ATTRACT_STRENGTH = 50;
let ATTRACT_RADIUS = 50;
let ATTRACT_SCALE = 5;

let CLAMP = 5;

let REPEL_STRENGTH = 50;
let REPEL_RADIUS = 50;
let REPEL_SCALE = 5;

let POKE_STRENGTH = 5;

// Precomputed on resize (matches your working math)
let SCALED_ATT_GRA = 0;  // SCALE_TO_SCREEN ** 1.11
let SCALED_REP_GRA = 0;  // SCALE_TO_SCREEN ** 0.66
let SCALED_ATT_SHA = 0;  // SCALE_TO_SCREEN ** -8.89
let SCALED_ATT = 0;      // SCALE_TO_SCREEN ** -8.46
let SCALED_REP = 0;      // SCALE_TO_SCREEN ** -0.89

//#endregion



//#region 3) STORAGE (localStorage)
/*========================================*
 *  STORAGE (localStorage)
 *========================================*/

function SAVE_STARS_TO_STORAGE() {
  if (!HAS_CANVAS) return;

  try {
    localStorage.setItem('constellationStars', JSON.stringify(STARS));
    localStorage.setItem(
      'constellationMeta',
      JSON.stringify({
        width: CANVAS_WIDTH,
        height: CANVAS_HEIGHT,

        pokeTimer: POKE_TIMER,
        userSpeed: USER_SPEED,
        userX: USER_X,
        userY: USER_Y,
        userTime: USER_TIME,

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

window.addEventListener('beforeunload', SAVE_STARS_TO_STORAGE);

//#endregion



//#region 4) STAR CREATION + RESTORE
/*========================================*
 *  STAR CREATION + RESTORE
 *========================================*/

const RAND_BETWEEN = (MIN, MAX) => Math.random() * (MAX - MIN) + MIN;

function CREATE_STARS() {
  if (!HAS_CANVAS) return;

  STARS = [];

  // Keep size range valid even on very small screens
  const MIN_STAR_SIZE = 3;
  const MAX_STAR_SIZE = SCREEN_SIZE / 400 || 3;

  const SIZE_LO = Math.min(MIN_STAR_SIZE, MAX_STAR_SIZE);
  const SIZE_HI = Math.max(MIN_STAR_SIZE, MAX_STAR_SIZE);

  for (let STAR_INDEX = 0; STAR_INDEX < MAX_STAR_COUNT; STAR_INDEX++) {
    STARS.push({
      x: Math.random() * CANVAS_WIDTH,
      y: Math.random() * CANVAS_HEIGHT,

      vx: RAND_BETWEEN(-0.25, 0.25),
      vy: RAND_BETWEEN(-0.25, 0.25),

      size: RAND_BETWEEN(SIZE_LO, SIZE_HI),
      opacity: RAND_BETWEEN(0.005, 1.8),
      fadeSpeed: RAND_BETWEEN(1, 2.1),

      redValue: RAND_BETWEEN(0, 200),
      whiteValue: 0,

      momentumX: 0,
      momentumY: 0
    });
  }
}

function INIT_STARS() {
  if (!HAS_CANVAS) return;

  let SAVED_STARS_RAW = null;
  try {
    SAVED_STARS_RAW = localStorage.getItem('constellationStars');
  } catch (ERR) {
    console.warn('Could not read constellationStars from storage:', ERR);
    CREATE_STARS();
    return;
  }

  if (!SAVED_STARS_RAW) {
    CREATE_STARS();
    return;
  }

  try {
    const PARSED_STARS = JSON.parse(SAVED_STARS_RAW);

    if (!Array.isArray(PARSED_STARS) || !PARSED_STARS.length) {
      CREATE_STARS();
      return;
    }

    STARS = PARSED_STARS;

    let META_RAW = null;
    try {
      META_RAW = localStorage.getItem('constellationMeta');
    } catch (ERR) {
      console.warn('Could not read constellationMeta from storage:', ERR);
    }

    if (!META_RAW) return;

    try {
      const META = JSON.parse(META_RAW);

      // Rescale coordinates from old canvas size to current
      if (META.width > 0 && META.height > 0) {
        const SCALE_X = CANVAS_WIDTH / META.width;
        const SCALE_Y = CANVAS_HEIGHT / META.height;
        const SIZE_SCALE = (CANVAS_WIDTH + CANVAS_HEIGHT) / (META.width + META.height);

        for (const STAR of STARS) {
          STAR.x *= SCALE_X;
          STAR.y *= SCALE_Y;
          STAR.size *= SIZE_SCALE;
        }
      }

      // Restore timers + pointer state + gravity values
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

      // IMPORTANT: USER_TIME is a “pointer exists” flag
      if (typeof META.userTime === 'number' && META.userTime > 0) {
        USER_TIME = META.userTime;
      } else {
        USER_TIME = 0;
      }
    } catch (ERR) {
      console.warn('Could not parse constellationMeta, skipping restore.', ERR);
    }
  } catch (ERR) {
    console.error('Could not parse saved stars, recreating.', ERR);
    CREATE_STARS();
  }
}

//#endregion



//#region 5) UI BINDING (SLIDERS + STEPPERS)
/*========================================*
 *  UI BINDING (SLIDERS + STEPPERS)
 *========================================*/

function ENABLE_STEPPER_HOLD(BUTTON, ON_STEP) {
  let HOLD_TIMER = null;
  let REPEAT_TIMER = null;

  const INITIAL_DELAY = 350;
  const START_INTERVAL = 120;
  const MIN_INTERVAL = 40;
  const ACCELERATION = 0.88;

  const START_HOLD = () => {
    let INTERVAL = START_INTERVAL;

    ON_STEP();

    HOLD_TIMER = setTimeout(() => {
      REPEAT_TIMER = setInterval(() => {
        ON_STEP();
        INTERVAL = Math.max(MIN_INTERVAL, INTERVAL * ACCELERATION);

        clearInterval(REPEAT_TIMER);
        REPEAT_TIMER = setInterval(ON_STEP, INTERVAL);
      }, INTERVAL);
    }, INITIAL_DELAY);
  };

  const STOP_HOLD = () => {
    clearTimeout(HOLD_TIMER);
    clearInterval(REPEAT_TIMER);
    HOLD_TIMER = null;
    REPEAT_TIMER = null;
  };

  BUTTON.addEventListener('mousedown', (E) => {
    E.preventDefault();
    START_HOLD();
  });
  BUTTON.addEventListener('mouseup', STOP_HOLD);
  BUTTON.addEventListener('mouseleave', STOP_HOLD);

  BUTTON.addEventListener('touchstart', (E) => {
    E.preventDefault();
    START_HOLD();
  }, { passive: false });

  BUTTON.addEventListener('touchend', STOP_HOLD);
  BUTTON.addEventListener('touchcancel', STOP_HOLD);
}

function BIND_CONTROL(CONTROL_ID, SETTER, INITIAL_VALUE) {
  const SLIDER_EL = document.getElementById(CONTROL_ID);
  if (!SLIDER_EL) return false;

  const NUMBER_EL = document.getElementById(CONTROL_ID + '_num');

  const CONTROL_BLOCK = SLIDER_EL.closest('.controlBlock');
  const STEP_BUTTONS = CONTROL_BLOCK
    ? CONTROL_BLOCK.querySelectorAll('.stepBtn[data-step]')
    : [];

  const MIN_VAL = Number(SLIDER_EL.min || (NUMBER_EL && NUMBER_EL.min) || 0);
  const MAX_VAL = Number(SLIDER_EL.max || (NUMBER_EL && NUMBER_EL.max) || 10);

  const RAW_STEP = Number(SLIDER_EL.step || (NUMBER_EL && NUMBER_EL.step) || 1);
  const STEP_VAL = Number.isFinite(RAW_STEP) && RAW_STEP > 0 ? RAW_STEP : 1;

  const CLAMP_VAL = (V) => Math.min(MAX_VAL, Math.max(MIN_VAL, V));

  const SNAP_TO_STEP = (V) => {
    if (!Number.isFinite(STEP_VAL) || STEP_VAL <= 0) return V;
    const SNAPPED = MIN_VAL + Math.round((V - MIN_VAL) / STEP_VAL) * STEP_VAL;
    const DECIMALS = (String(STEP_VAL).split('.')[1] || '').length;
    return Number(SNAPPED.toFixed(DECIMALS));
  };

  const APPLY = (V) => {
    let NEXT = Number(V);
    if (!Number.isFinite(NEXT)) return;

    NEXT = CLAMP_VAL(NEXT);
    NEXT = SNAP_TO_STEP(NEXT);

    SLIDER_EL.value = String(NEXT);
    if (NUMBER_EL) NUMBER_EL.value = String(NEXT);

    SETTER(NEXT);

    // Keep slider visual fill in sync (if present)
    SLIDER_EL.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const NUDGE = (DIR) => APPLY(Number(SLIDER_EL.value) + DIR * STEP_VAL);

  APPLY(INITIAL_VALUE ?? SLIDER_EL.value);

  SLIDER_EL.addEventListener('input', () => APPLY(SLIDER_EL.value));

  if (NUMBER_EL) {
    NUMBER_EL.addEventListener('input', () => APPLY(NUMBER_EL.value));
    NUMBER_EL.addEventListener('change', () => APPLY(NUMBER_EL.value));
  }

  STEP_BUTTONS.forEach((BTN) => {
    const DIR = Number(BTN.dataset.step) || 0;
    if (!DIR) return;
    ENABLE_STEPPER_HOLD(BTN, () => NUDGE(DIR));
  });

  return true;
}

function INIT_GRAVITY_CONTROLS_IF_PRESENT() {
  if (!document.getElementById('ATTRACT_STRENGTH') &&
      !document.getElementById('REPEL_STRENGTH')) {
    return;
  }

  BIND_CONTROL('ATTRACT_STRENGTH', (V) => { ATTRACT_STRENGTH = V; }, ATTRACT_STRENGTH);
  BIND_CONTROL('ATTRACT_RADIUS',   (V) => { ATTRACT_RADIUS = V; },   ATTRACT_RADIUS);
  BIND_CONTROL('ATTRACT_SCALE',    (V) => { ATTRACT_SCALE = V; },    ATTRACT_SCALE);

  BIND_CONTROL('CLAMP',            (V) => { CLAMP = V; },            CLAMP);

  BIND_CONTROL('REPEL_STRENGTH',   (V) => { REPEL_STRENGTH = V; },   REPEL_STRENGTH);
  BIND_CONTROL('REPEL_RADIUS',     (V) => { REPEL_RADIUS = V; },     REPEL_RADIUS);
  BIND_CONTROL('REPEL_SCALE',      (V) => { REPEL_SCALE = V; },      REPEL_SCALE);

  BIND_CONTROL('POKE_STRENGTH',    (V) => { POKE_STRENGTH = V; },    POKE_STRENGTH);
}

document.addEventListener('DOMContentLoaded', INIT_GRAVITY_CONTROLS_IF_PRESENT);

//#endregion



//#region 6) MOTION (PHYSICS)
/*========================================*
 *  MOTION (PHYSICS)
 *========================================*/

function MOVE_STARS() {
  if (!HAS_CANVAS || !STARS.length) return;

  const RANGE = SCREEN_SIZE * 0.2;

  for (const STAR of STARS) {
    const X_DISTANCE = USER_X - STAR.x;
    const Y_DISTANCE = USER_Y - STAR.y;

    const DISTANCE = Math.hypot(X_DISTANCE, Y_DISTANCE) + 0.0001;
    const TO_USER_X = X_DISTANCE / DISTANCE;
    const TO_USER_Y = Y_DISTANCE / DISTANCE;

    if (DISTANCE < RANGE) {
      // Linear gradients (uses precomputed scale powers exactly like your working code)
      let ATTR_GRADIENT =
        1 - (DISTANCE / (((ATTRACT_RADIUS * 5.2) * SCALED_ATT_GRA) || 1));

      let REPEL_GRADIENT =
        1 - (DISTANCE / (((REPEL_RADIUS * 2.8) * SCALED_REP_GRA) || 1));

      ATTR_GRADIENT = Math.max(0, ATTR_GRADIENT);
      REPEL_GRADIENT = Math.max(0, REPEL_GRADIENT);

      const ATTR_SHAPE = Math.pow(
        ATTR_GRADIENT,
        Math.max(0.1, ((ATTRACT_SCALE * 0.48) * SCALED_ATT_SHA))
      );

      const REPEL_SHAPE = Math.pow(
        REPEL_GRADIENT,
        Math.max(0.1, (REPEL_SCALE * 0.64))
      );

      const ATTRACT =
        ((ATTRACT_STRENGTH * 0.006) * SCALED_ATT) *
        USER_SPEED *
        ATTR_SHAPE;

      const REPEL =
        ((REPEL_STRENGTH * 0.0182) * SCALED_REP) *
        USER_SPEED *
        REPEL_SHAPE;

      STAR.momentumX += ATTRACT * TO_USER_X;
      STAR.momentumY += ATTRACT * TO_USER_Y;

      STAR.momentumX += REPEL * -TO_USER_X;
      STAR.momentumY += REPEL * -TO_USER_Y;

      // Poke kick away
      const POKE =
        (0.01 * POKE_STRENGTH) * POKE_TIMER * REPEL_SHAPE;

      STAR.momentumX += POKE * -TO_USER_X;
      STAR.momentumY += POKE * -TO_USER_Y;
    }

    // Global boost: interaction increases drift
    STAR.momentumX += STAR.vx * Math.min(10, 0.05 * USER_SPEED);
    STAR.momentumY += STAR.vy * Math.min(10, 0.05 * USER_SPEED);

    let FORCE_X = STAR.momentumX;
    let FORCE_Y = STAR.momentumY;

    // Clamp force magnitude (MATCHES your working file)
    const LIMIT = CLAMP * (SCALE_TO_SCREEN ** 2);
    const HYPOT = Math.hypot(FORCE_X, FORCE_Y);
    if (HYPOT > LIMIT) {
      FORCE_X *= LIMIT / HYPOT;
      FORCE_Y *= LIMIT / HYPOT;
    }

    STAR.x += STAR.vx + FORCE_X;
    STAR.y += STAR.vy + FORCE_Y;

    STAR.momentumX *= 0.98;
    STAR.momentumY *= 0.98;

    // Wrap vs bounce (matches working thresholds)
    if (CIRCLE_TIMER === 0 || DISTANCE > 200 || POKE_TIMER > 1000) {
      const R = (STAR.whiteValue * 2 + STAR.size) || 0;

      if (STAR.x < -R) STAR.x = CANVAS_WIDTH + R;
      else if (STAR.x > CANVAS_WIDTH + R) STAR.x = -R;

      if (STAR.y < -R) STAR.y = CANVAS_HEIGHT + R;
      else if (STAR.y > CANVAS_HEIGHT + R) STAR.y = -R;
    } else {
      const R = (STAR.whiteValue * 2 + STAR.size) || 0;

      if (STAR.x < R) {
        STAR.x = 2 * R - STAR.x;
        STAR.momentumX = -STAR.momentumX;
      } else if (STAR.x > CANVAS_WIDTH - R) {
        STAR.x = 2 * (CANVAS_WIDTH - R) - STAR.x;
        STAR.momentumX = -STAR.momentumX;
      }

      if (STAR.y < R) {
        STAR.y = 2 * R - STAR.y;
        STAR.momentumY = -STAR.momentumY;
      } else if (STAR.y > CANVAS_HEIGHT - R) {
        STAR.y = 2 * (CANVAS_HEIGHT - R) - STAR.y;
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

  // Global decay
  USER_SPEED *= 0.5;
  if (USER_SPEED < 0.001) USER_SPEED = 0;

  CIRCLE_TIMER *= 0.9;
  if (CIRCLE_TIMER < 0.1) CIRCLE_TIMER = 0;

  POKE_TIMER *= 0.85;
  if (POKE_TIMER < 1) POKE_TIMER = 0;

  UPDATE_DEBUG_READOUTS();
}

//#endregion



//#region 7) DEBUG READOUTS
/*========================================*
 *  DEBUG READOUTS
 *========================================*/

const DEBUG = {
  LAST_MS: 0,
  RATE_MS: 100
};

function UPDATE_DEBUG_READOUTS() {
  const NOW = (performance && performance.now) ? performance.now() : Date.now();
  if (NOW - DEBUG.LAST_MS < DEBUG.RATE_MS) return;
  DEBUG.LAST_MS = NOW;

  const MISC_DEBUG = 0; // Change this to any variable to watch

  const DBG_MISC = document.getElementById('miscDbg');
  if (DBG_MISC) DBG_MISC.textContent = Number(MISC_DEBUG).toFixed(3);

  const DBG_CIRCLE = document.getElementById('dbgCircle');
  if (DBG_CIRCLE) DBG_CIRCLE.textContent = CIRCLE_TIMER.toFixed(3);

  const DBG_SPEED = document.getElementById('dbgSpeed');
  if (DBG_SPEED) DBG_SPEED.textContent = USER_SPEED.toFixed(3);

  const DBG_POKE = document.getElementById('dbgPoke');
  if (DBG_POKE) DBG_POKE.textContent = POKE_TIMER.toFixed(1);
}

//#endregion



//#region 8) RENDERING (LINES + STARS + OPTIONAL RING)
/*========================================*
 *  RENDERING HELPERS
 *========================================*/

function EDGE_FACTOR(STAR) {
  const R = (STAR.whiteValue * 2 + STAR.size) || 0;

  const LEFT = STAR.x + R;
  const RIGHT = CANVAS_WIDTH + R - STAR.x;
  const TOP = STAR.y + R;
  const BOTTOM = CANVAS_HEIGHT + R - STAR.y;

  const D = Math.min(LEFT, RIGHT, TOP, BOTTOM);

  const FADE_BAND = Math.min(90, SCREEN_SIZE * 0.03);

  let T = D / FADE_BAND;
  if (T < 0) T = 0;
  if (T > 1) T = 1;

  return T * T * (3 - 2 * T);
}

/*========================================*
 *  DRAW STARS + LINES
 *========================================*/

function DRAW_STARS_WITH_LINES() {
  if (!HAS_CANVAS || !BRUSH) return;

  BRUSH.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

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

  // Lines between nearby stars (matches your working algorithm)
  BRUSH.lineWidth = 1;
  const COUNT = STARS.length;

  for (let I = 0; I < COUNT; I++) {
    for (let J = I + 1; J < COUNT; J++) {
      const STAR_A = STARS[I];
      const STAR_B = STARS[J];

      const DX = STAR_A.x - STAR_B.x;
      const DY = STAR_A.y - STAR_B.y;

      const DISTANCE = Math.hypot(DX, DY) / 1100 * SCREEN_SIZE;

      if (DISTANCE < MAX_LINK_DISTANCE) {
        let ALPHA =
          (1 - DISTANCE / MAX_LINK_DISTANCE) *
          ((STAR_A.opacity + STAR_B.opacity) / 2);

        ALPHA *= Math.min(EDGE_FACTOR(STAR_A), EDGE_FACTOR(STAR_B));

        BRUSH.strokeStyle = `rgba(0, 0, 0, ${ALPHA})`;
        BRUSH.beginPath();
        BRUSH.moveTo(STAR_A.x, STAR_A.y);
        BRUSH.lineTo(STAR_B.x, STAR_B.y);
        BRUSH.stroke();
      }
    }
  }

  // Star bodies
  for (const STAR of STARS) {
    let TEMP_RED = 255 * STAR.whiteValue + STAR.redValue;
    if (TEMP_RED > 255) TEMP_RED = 255;

    BRUSH.beginPath();
    BRUSH.fillStyle = `rgba(${TEMP_RED}, ${255 * STAR.whiteValue}, ${255 * STAR.whiteValue}, ${STAR.opacity})`;
    BRUSH.arc(
      STAR.x,
      STAR.y,
      STAR.whiteValue * 2 + STAR.size,
      0,
      Math.PI * 2
    );
    BRUSH.fill();
  }
}

// External redraw hook (used by other scripts)
window.forceStarfieldRedraw = () => {
  if (!BRUSH || !CANVAS) return;
  DRAW_STARS_WITH_LINES();
};

//#endregion



//#region 9) RESIZE + ANIMATION
/*========================================*
 *  RESIZE
 *========================================*/

function RESIZE_CANVAS() {
  if (!HAS_CANVAS) return;

  const OLD_W = CANVAS_WIDTH;
  const OLD_H = CANVAS_HEIGHT;
  const OLD_SCREEN = SCREEN_SIZE || 1;

  CANVAS_WIDTH = window.innerWidth || 0;
  CANVAS_HEIGHT = window.innerHeight || 0;

  CANVAS.width = CANVAS_WIDTH;
  CANVAS.height = CANVAS_HEIGHT;

  SCREEN_SIZE = CANVAS_WIDTH + CANVAS_HEIGHT;

  SCALE_TO_SCREEN = Math.pow(SCREEN_SIZE / 1200, 0.35);
  MAX_STAR_COUNT = Math.min(450, SCREEN_SIZE / 10);
  MAX_LINK_DISTANCE = SCREEN_SIZE / 10;

  // Precompute scale powers (exactly matching your working file)
  SCALED_ATT_GRA = SCALE_TO_SCREEN ** 1.11;
  SCALED_REP_GRA = SCALE_TO_SCREEN ** 0.66;
  SCALED_ATT_SHA = SCALE_TO_SCREEN ** -8.89;
  SCALED_ATT = SCALE_TO_SCREEN ** -8.46;
  SCALED_REP = SCALE_TO_SCREEN ** -0.89;

  // Rescale existing stars to new canvas
  if (OLD_W !== 0 && OLD_H !== 0) {
    const SCALE_X = CANVAS_WIDTH / OLD_W;
    const SCALE_Y = CANVAS_HEIGHT / OLD_H;
    const SCALE_SIZE = SCREEN_SIZE / OLD_SCREEN;

    for (const STAR of STARS) {
      STAR.x *= SCALE_X;
      STAR.y *= SCALE_Y;
      STAR.size *= SCALE_SIZE;
    }
  }
}

/*========================================*
 *  ANIMATION LOOP
 *========================================*/

function ANIMATE() {
  if (!HAS_CANVAS) return;
  if (!FREEZE_CONSTELLATION) MOVE_STARS();
  DRAW_STARS_WITH_LINES();
  requestAnimationFrame(ANIMATE);
}

//#endregion



//#region 10) POINTER INPUT (USES EVENT.TIMESTAMP)
/*========================================*
 *  POINTER INPUT
 *========================================*
 *  IMPORTANT:
 *   - Uses E.timeStamp when available to match your working behavior.
 *========================================*/

function UPDATE_SPEED(NEW_X, NEW_Y, TIME) {
  if (!Number.isFinite(TIME)) {
    TIME = (performance && performance.now) ? performance.now() : Date.now();
  }

  const DT = Math.max(1, TIME - USER_TIME);
  const DX = NEW_X - USER_X;
  const DY = NEW_Y - USER_Y;

  const RAW_SPEED = Math.hypot(DX, DY) / DT;

  USER_SPEED = Math.min(RAW_SPEED * 50, 50);
  CIRCLE_TIMER = Math.max(CIRCLE_TIMER, USER_SPEED);

  USER_X = NEW_X;
  USER_Y = NEW_Y;
  USER_TIME = TIME; // also flips “pointer exists” from 0 to >0
}

function START_POINTER_INTERACTION(NEW_X, NEW_Y, TIME) {
  POKE_TIMER = 2500;
  UPDATE_SPEED(NEW_X, NEW_Y, TIME);
}

// Mouse
window.addEventListener('mousemove', (E) =>
  UPDATE_SPEED(E.clientX, E.clientY, E.timeStamp)
);

window.addEventListener('mousedown', (E) =>
  START_POINTER_INTERACTION(E.clientX, E.clientY, E.timeStamp)
);

// Touch
window.addEventListener('touchstart', (E) => {
  const TOUCH = E.touches[0];
  if (!TOUCH) return;
  START_POINTER_INTERACTION(TOUCH.clientX, TOUCH.clientY, E.timeStamp);
});

window.addEventListener('touchmove', (E) => {
  const TOUCH = E.touches[0];
  if (!TOUCH) return;
  UPDATE_SPEED(TOUCH.clientX, TOUCH.clientY, E.timeStamp);
});

//#endregion



//#region 11) BOOTSTRAP
/*========================================*
 *  BOOTSTRAP
 *========================================*/

function SIZES_READY() {
  return (
    Number.isFinite(CANVAS_WIDTH) &&
    Number.isFinite(CANVAS_HEIGHT) &&
    CANVAS_WIDTH > 50 &&
    CANVAS_HEIGHT > 50
  );
}

function START_STARFIELD() {
  RESIZE_CANVAS();

  // First-load guard
  if (!SIZES_READY()) {
    requestAnimationFrame(START_STARFIELD);
    return;
  }

  if (!STARS_INITIALIZED) {
    STARS_INITIALIZED = true;
    INIT_STARS();
  }

  if (!ANIMATION_STARTED) {
    ANIMATION_STARTED = true;
    ANIMATE();
  }

  if (!RESIZE_WIRED) {
    RESIZE_WIRED = true;
    window.addEventListener('resize', RESIZE_CANVAS);
  }
}

try {
  START_STARFIELD();
} catch (ERR) {
  console.error('Initialization error in starfield script:', ERR);
}

//#endregion

// Joke: stars are just pixels with commitment issues. They drift, they glow, they refuse to settle down. ✨