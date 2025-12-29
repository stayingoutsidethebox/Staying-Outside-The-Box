// thank heavens for chatGPT <3
// Active Starfield: owns physics, rendering, and pointer input.
// Requires Starfield Setup.js to have created window.STARFIELD and canvas state.

/*======================================================================
 *  MENU
 *----------------------------------------------------------------------
 *  0) PERF HELPERS
 *  1) PHYSICS
 *  2) RENDERING
 *  3) USER INPUT
 *====================================================================*/


/*======================================================================
 * #region 0) PERF HELPERS
 *====================================================================*/

/* GROUP: Shared state alias */
// Grab the shared STARFIELD state created by Starfield Setup.js.
var S = window.STARFIELD;

/* GROUP: Debug refs cached (NOT on STARFIELD) */
// Cache debug element references so we don't query the DOM every frame.
const DBG = {

  // Displays a sample value (frame ms) for quick sanity checks.
  misc: null,

  // Displays pointer ring timer.
  circle: null,

  // Displays pointer speed energy.
  speed: null,

  // Displays poke timer.
  poke: null
};

// Look up optional debug elements (they don't exist on most pages).
DBG.misc = document.getElementById("dbgMisc");       // Debug readout: misc
DBG.circle = document.getElementById("dbgCircle");   // Debug readout: ring timer
DBG.speed = document.getElementById("dbgSpeed");     // Debug readout: pointer speed
DBG.poke = document.getElementById("dbgPoke");       // Debug readout: poke timer

/* GROUP: Sprite stars (WebP) */
// Hold sprite loading state so rendering can bail until the image is ready.
const STAR_SPRITES = {

  // True once the star image is fully loaded.
  ready: false,

  // The Image() object used by drawImage().
  img: null
};

// Load the star sprite immediately so it is ready by the time rendering starts.
(function loadStarSpriteNow() {

  // Create a new image object for the star sprite.
  const IMG = new Image();

  // Hint: decode image off the main thread if possible.
  IMG.decoding = "async";

  // Hint: start loading immediately.
  IMG.loading = "eager";

  // Mark sprite as ready once the image loads successfully.
  IMG.onload = () => { STAR_SPRITES.ready = true; };

  // Mark sprite as not ready if the image fails to load.
  IMG.onerror = () => { STAR_SPRITES.ready = false; };

  // Provide the sprite URL (starts the network request).
  IMG.src = "/Resources/Star.webp";

  // Store the image object for later drawing.
  STAR_SPRITES.img = IMG;
})();

/* GROUP: Link throttle state */
// Count frames so we can rebuild link geometry every N frames.
let LINK_FRAME = 0;

// Flag used to force an immediate link rebuild (ex: fast pointer movement).
let LINKS_DIRTY = true;

/* GROUP: Links fade near the edges */
// Faster edge fade helper for links (keeps rendering logic light).
function getEdgeFadeFactorFast(STAR) {

  // Approximate star "radius" based on how large it draws on screen.
  const STAR_RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

  // Measure padded distance to each edge (radius avoids visible popping at wrap).
  const DIST_LEFT = STAR.x + STAR_RADIUS;
  const DIST_RIGHT = (S.canvasWidth + STAR_RADIUS) - STAR.x;
  const DIST_TOP = STAR.y + STAR_RADIUS;
  const DIST_BOTTOM = (S.canvasHeight + STAR_RADIUS) - STAR.y;

  // Find the closest edge distance (the "most at risk" direction).
  const MIN_EDGE_DISTANCE = Math.min(DIST_LEFT, DIST_RIGHT, DIST_TOP, DIST_BOTTOM);

  // Define fade band width (cap it so it stays cheap).
  const FADE_BAND = Math.min(90, S.screenPerimeter * 0.03) || 1;

  // Convert closest distance into 0..1 fade factor.
  const T =
    MIN_EDGE_DISTANCE <= 0 ? 0 :
    MIN_EDGE_DISTANCE >= FADE_BAND ? 1 :
    (MIN_EDGE_DISTANCE / FADE_BAND);

  // Square for quick easing (cheap “smooth-ish” curve).
  return T * T;
}

/* GROUP: Time scaling helpers */
// Define how many ms one 60fps frame represents (conversion constant).
const SIXTY_FPS_FRAME_MS = 1000 / 60;

// Clamp dt (ms) to prevent tab-sleep teleports and clock weirdness.
function clampDtMs(DT_MS) {

  // Prevent negative dt (clock weirdness) from producing inverted updates.
  if (DT_MS < 0) return 0;

  // Cap dt so tab sleep / lag spikes don't cause massive forces and teleports.
  if (DT_MS > 50) return 50; // ~3 frames at 60fps

  // Return dt unchanged when it is in a safe range.
  return DT_MS;
}

// Convert a per-frame decay constant into a time-based decay.
function decayPerFrameToDt(BASE_PER_FRAME, DT_FRAMES) {

  // Example: 0.98 per frame becomes 0.98^DT_FRAMES for variable FPS.
  return Math.pow(BASE_PER_FRAME, DT_FRAMES);
}

/* #endregion 0) PERF HELPERS */



/*======================================================================
 * #region 1) PHYSICS
 *====================================================================*/

/* GROUP: Physics entry point */
// Decide how each star should move.
S.updateStarPhysics = function updateStarPhysics() {

  // Bail early if we have no stars to simulate.
  if (!S.starList.length) return;

  // Sample time from Setup helper (performance.now when possible).
  const NOW_MS = S.getNowMs();

  // Mark start time for per-frame debug timing.
  const FRAME_START_MS = NOW_MS;

  // Use previous timestamp, or default to NOW on first frame.
  const LAST_PHYSICS_MS = S.lastPhysicsMs || NOW_MS;

  // Compute elapsed time and clamp to avoid huge simulation jumps.
  const DT_MS = clampDtMs(NOW_MS - LAST_PHYSICS_MS);

  // Store this frame's timestamp for next update.
  S.lastPhysicsMs = NOW_MS;

  // Normalize elapsed time into “60fps frames”.
  const DT_FRAMES = DT_MS / SIXTY_FPS_FRAME_MS;

  // Bail if dt is zero so we don't waste work.
  if (DT_FRAMES <= 0) return;

  /* GROUP: Ranges + settings */
  // Define maximum range where pointer forces can affect stars.
  const INFLUENCE_RANGE = S.screenPerimeter * 0.2;

  // Precompute squared range for cheap comparisons.
  const INFLUENCE_RANGE_SQ = INFLUENCE_RANGE * INFLUENCE_RANGE;

  // Local distance threshold for wrap vs bounce behavior.
  const WRAP_DISTANCE_SQ = 200 * 200;

  // Grab UI-tunable settings.
  const SETTINGS = S.interactionSettings;

  // Grab precomputed screen scaling powers.
  const SCALE = S.screenScalePowers;

  /* GROUP: Time-based decays */
  // Convert legacy “per frame” decays into time-based multipliers.
  const MOMENTUM_DECAY = decayPerFrameToDt(0.98, DT_FRAMES);
  const WHITE_DECAY = decayPerFrameToDt(0.98, DT_FRAMES);
  const POINTER_SPEED_DECAY = decayPerFrameToDt(0.5, DT_FRAMES);
  const RING_DECAY = decayPerFrameToDt(0.95, DT_FRAMES);
  const POKE_DECAY = decayPerFrameToDt(0.85, DT_FRAMES);

  /* GROUP: Update each star */
  for (const STAR of S.starList) {

    // Prevent paddle bounce and normal bounce from fighting each other.
    let DID_BOUNCE = false;

    // Compute pointer delta vector (pointer minus star).
    const POINTER_DELTA_X = S.pointerClientX - STAR.x;
    const POINTER_DELTA_Y = S.pointerClientY - STAR.y;

    // Compute squared distance for range checks.
    const DISTANCE_TO_POINTER_SQ =
      POINTER_DELTA_X * POINTER_DELTA_X + POINTER_DELTA_Y * POINTER_DELTA_Y;

    /* GROUP: Proximity-only forces */
    if (DISTANCE_TO_POINTER_SQ < INFLUENCE_RANGE_SQ) {

      // Compute true distance and add epsilon to prevent divide-by-zero.
      const DISTANCE_TO_POINTER = Math.sqrt(DISTANCE_TO_POINTER_SQ) + 0.0001;

      // Normalize delta into a unit vector toward pointer.
      const UNIT_TO_POINTER_X = POINTER_DELTA_X / DISTANCE_TO_POINTER;
      const UNIT_TO_POINTER_Y = POINTER_DELTA_Y / DISTANCE_TO_POINTER;

      /* GROUP: Attraction */
      // Convert distance into 0..1 gradient inside attraction radius.
      let ATTRACTION_GRADIENT =
        1 - (DISTANCE_TO_POINTER / (((SETTINGS.attractRadius * 5.2) * SCALE.attractionGradient) || 1));

      // Clamp so it never goes negative outside radius.
      ATTRACTION_GRADIENT = Math.max(0, ATTRACTION_GRADIENT);

      // Shape attraction falloff curve.
      const ATTRACTION_SHAPE = Math.pow(
        ATTRACTION_GRADIENT,
        Math.max(0.1, ((SETTINGS.attractScale * 0.48) * SCALE.attractionShape))
      );

      // Compute attraction force (settings + screen scale + pointer energy + shape).
      const ATTRACTION_FORCE =
        ((SETTINGS.attractStrength * 0.0044) * SCALE.attractionForce) *
        S.pointerSpeedUnits *
        ATTRACTION_SHAPE;

      /* GROUP: Repulsion */
      // Convert distance into 0..1 gradient inside repulsion radius.
      let REPULSION_GRADIENT =
        1 - (DISTANCE_TO_POINTER / (((SETTINGS.repelRadius * 2.8) * SCALE.repulsionGradient) || 1));

      // Clamp so it never goes negative outside radius.
      REPULSION_GRADIENT = Math.max(0, REPULSION_GRADIENT);

      // Shape repulsion falloff curve.
      const REPULSION_SHAPE = Math.pow(
        REPULSION_GRADIENT,
        Math.max(0.1, (SETTINGS.repelScale * 0.64))
      );

      // Compute repulsion force (settings + screen scale + pointer energy + shape).
      const REPULSION_FORCE =
        ((SETTINGS.repelStrength * 0.0182) * SCALE.repulsionForce) *
        S.pointerSpeedUnits *
        REPULSION_SHAPE;

      /* GROUP: Poke */
      // Define poke radius as a fraction of screen size.
      const POKE_RADIUS = S.screenPerimeter * 0.2;

      // Convert distance into 0..1 poke gradient inside poke radius.
      const POKE_GRADIENT = 1 - (DISTANCE_TO_POINTER / POKE_RADIUS);

      // Shape poke so it ramps sharply near pointer.
      const POKE_SHAPE = Math.pow(Math.max(0, POKE_GRADIENT), 2);

      // Compute poke force (settings + impulse timer + shape).
      const POKE_FORCE =
        (0.01 * SETTINGS.pokeStrength) *
        S.pokeImpulseTimer *
        POKE_SHAPE;

      /* GROUP: Apply proximity-only forces */
      STAR.momentumX += (ATTRACTION_FORCE * UNIT_TO_POINTER_X) * DT_FRAMES;
      STAR.momentumY += (ATTRACTION_FORCE * UNIT_TO_POINTER_Y) * DT_FRAMES;

      STAR.momentumX += (REPULSION_FORCE * -UNIT_TO_POINTER_X) * DT_FRAMES;
      STAR.momentumY += (REPULSION_FORCE * -UNIT_TO_POINTER_Y) * DT_FRAMES;

      STAR.momentumX += (POKE_FORCE * -UNIT_TO_POINTER_X) * DT_FRAMES;
      STAR.momentumY += (POKE_FORCE * -UNIT_TO_POINTER_Y) * DT_FRAMES;
    }

    /* GROUP: Global forces */
    const DRIFT_BOOST = Math.min(7, 0.01 * (S.pointerSpeedUnits + 0.0001));

    STAR.momentumX += (STAR.vx * DRIFT_BOOST) * DT_FRAMES;
    STAR.momentumY += (STAR.vy * DRIFT_BOOST) * DT_FRAMES;

    /* GROUP: Keyboard influence */
    STAR.momentumX += window.KEYBOARD.addX + (window.KEYBOARD.multX * STAR.vx * 0.05);
    STAR.momentumY += window.KEYBOARD.addY + (window.KEYBOARD.multY * STAR.vy * 0.05);

    STAR.momentumX *= window.KEYBOARD.multX;
    STAR.momentumY *= window.KEYBOARD.multY;

    /* GROUP: Magnet orbit */
    if (window.KEYBOARD.magnetY > 0 || window.KEYBOARD.magnetPointer) {

      const CANVAS = S.constellationCanvas;

      if (CANVAS) {

        const RECT = CANVAS.getBoundingClientRect();

        // Magnet target in CANVAS space.
        let MAGNET_X_CANVAS, MAGNET_Y_CANVAS;

        if (window.KEYBOARD.magnetPointer) {
          MAGNET_X_CANVAS = S.pointerClientX - RECT.left;
          MAGNET_Y_CANVAS = S.pointerClientY - RECT.top;
        } else {
          MAGNET_X_CANVAS = (window.KEYBOARD.magnetX / 100) * S.canvasWidth;
          MAGNET_Y_CANVAS = (window.KEYBOARD.magnetY / 100) * S.canvasHeight;
        }

        // Vector from star -> magnet.
        const DELTA_TO_MAGNET_X = MAGNET_X_CANVAS - STAR.x;
        const DELTA_TO_MAGNET_Y = MAGNET_Y_CANVAS - STAR.y;

        // Distance to magnet (epsilon prevents divide-by-zero).
        const DIST_TO_MAGNET = Math.sqrt(
          DELTA_TO_MAGNET_X * DELTA_TO_MAGNET_X + DELTA_TO_MAGNET_Y * DELTA_TO_MAGNET_Y
        ) + 0.0001;

        // Unit vector toward magnet (scaled up for “snappy” feel).
        const UNIT_TOWARD_MAGNET_X = (DELTA_TO_MAGNET_X / DIST_TO_MAGNET) * 5;
        const UNIT_TOWARD_MAGNET_Y = (DELTA_TO_MAGNET_Y / DIST_TO_MAGNET) * 5;

        // Orbit direction (default clockwise).
        const ORBIT_DIR = (window.KEYBOARD.magnetDir === -1) ? -1 : 1;

        // Perpendicular orbit vector (rotate 90 degrees).
        const UNIT_ORBIT_X = (-UNIT_TOWARD_MAGNET_Y) * ORBIT_DIR;
        const UNIT_ORBIT_Y = ( UNIT_TOWARD_MAGNET_X) * ORBIT_DIR;

        const MAGNET_STRENGTH = window.KEYBOARD.magnetStrength || 1;

        const FALLOFF = 0.35;

        const FALL_FACTOR =
          1 / (1 + FALLOFF * DIST_TO_MAGNET / (S.screenPerimeter || 1));

        const BASE_FORCE =
          (0.08 * SETTINGS.clamp * SCALE.forceClamp) * MAGNET_STRENGTH * FALL_FACTOR;

        const PULL_FORCE = BASE_FORCE * 0.55;
        const SPIN_FORCE = BASE_FORCE * 0.95;

        STAR.momentumX += (UNIT_TOWARD_MAGNET_X * PULL_FORCE + UNIT_ORBIT_X * SPIN_FORCE) * DT_FRAMES;
        STAR.momentumY += (UNIT_TOWARD_MAGNET_Y * PULL_FORCE + UNIT_ORBIT_Y * SPIN_FORCE) * DT_FRAMES;

        LINKS_DIRTY = true;
      }
    }

    /* GROUP: Momentum clamp */
    const MOMENTUM_LIMIT = 2 * SETTINGS.clamp * SCALE.forceClamp;

    const MOMENTUM_MAG = Math.sqrt(
      STAR.momentumX * STAR.momentumX + STAR.momentumY * STAR.momentumY
    );

    if (MOMENTUM_MAG > MOMENTUM_LIMIT) {
      const MOMENTUM_SCALE = MOMENTUM_LIMIT / MOMENTUM_MAG;
      STAR.momentumX *= MOMENTUM_SCALE;
      STAR.momentumY *= MOMENTUM_SCALE;
    }

    /* GROUP: Integration */
    STAR.x += (STAR.vx + STAR.momentumX) * DT_FRAMES;
    STAR.y += (STAR.vy + STAR.momentumY) * DT_FRAMES;

    /* GROUP: Momentum friction with floor */
    const MIN_MOM = 0.01;

    STAR.momentumX *= MOMENTUM_DECAY;
    STAR.momentumY *= MOMENTUM_DECAY;

    if (STAR.momentumX !== 0) {
      STAR.momentumX = Math.sign(STAR.momentumX) * Math.max(MIN_MOM, Math.abs(STAR.momentumX));
    }

    if (STAR.momentumY !== 0) {
      STAR.momentumY = Math.sign(STAR.momentumY) * Math.max(MIN_MOM, Math.abs(STAR.momentumY));
    }

    /* GROUP: Paddle star physics */
    if (window.KEYBOARD.paddlesTimer > 0 && STAR === S.starList[0]) {

      STAR.whiteValue = 1;
      STAR.opacity = 1;

      const CANVAS = S.constellationCanvas;

      if (CANVAS) {

        const RECT = CANVAS.getBoundingClientRect();

        const VIEW_LEFT = -RECT.left;
        const VIEW_TOP = -RECT.top;
        const VIEW_RIGHT = VIEW_LEFT + window.innerWidth;
        const VIEW_BOTTOM = VIEW_TOP + window.innerHeight;

        const PADDLE_CENTER_X =
          VIEW_LEFT + (window.KEYBOARD.paddlesX / 100) * window.innerWidth;
        const PADDLE_CENTER_Y =
          VIEW_TOP + (window.KEYBOARD.paddlesY / 100) * window.innerHeight;

        const PADDLE_W = window.innerWidth * 0.10;
        const PADDLE_H = window.innerHeight * 0.10;

        const HALF_PW = PADDLE_W * 0.5;
        const HALF_PH = PADDLE_H * 0.5;

        const PADDLE_THICKNESS = Math.max(
          2,
          Math.min(window.innerWidth, window.innerHeight) * 0.03
        );

        const HALF_T = PADDLE_THICKNESS * 0.5;

        const BALL_RADIUS = Math.max(2, (2 + STAR.size) || 2);

        const TOTAL_VEL_X = (STAR.vx || 0) + (STAR.momentumX || 0);
        const TOTAL_VEL_Y = (STAR.vy || 0) + (STAR.momentumY || 0);

        const BALL_SPEED = Math.sqrt(TOTAL_VEL_X * TOTAL_VEL_X + TOTAL_VEL_Y * TOTAL_VEL_Y);

        if (BALL_SPEED > 0.0001) {

          const clamp = (V, A, B) => (V < A ? A : V > B ? B : V);

          const MAX_ANGLE = 1.25;

          const PUSH_OUT_X = BALL_RADIUS + HALF_T + 0.5;
          const PUSH_OUT_Y = BALL_RADIUS + HALF_T + 0.5;

          const TOUCH_LEFT   = STAR.x <= VIEW_LEFT   + (BALL_RADIUS + HALF_T);
          const TOUCH_RIGHT  = STAR.x >= VIEW_RIGHT  - (BALL_RADIUS + HALF_T);
          const TOUCH_TOP    = STAR.y <= VIEW_TOP    + (BALL_RADIUS + HALF_T);
          const TOUCH_BOTTOM = STAR.y >= VIEW_BOTTOM - (BALL_RADIUS + HALF_T);

          const WITHIN_LR_PADDLE =
            (STAR.y >= (PADDLE_CENTER_Y - HALF_PH) && STAR.y <= (PADDLE_CENTER_Y + HALF_PH));

          const WITHIN_TB_PADDLE =
            (STAR.x >= (PADDLE_CENTER_X - HALF_PW) && STAR.x <= (PADDLE_CENTER_X + HALF_PW));

          const HIT_COOLDOWN_MS = 60;

          if (TOUCH_LEFT && WITHIN_LR_PADDLE && TOTAL_VEL_X < 0) {

            const OFFSET = clamp((STAR.y - PADDLE_CENTER_Y) / (HALF_PH || 1), -1, 1);
            const ANG = OFFSET * MAX_ANGLE;

            const OUT_VEL_X = +1 * BALL_SPEED * Math.cos(ANG);
            const OUT_VEL_Y = BALL_SPEED * Math.sin(ANG);

            DID_BOUNCE = bounceVertical(
              STAR, VIEW_LEFT, +1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_X, NOW_MS, HIT_COOLDOWN_MS
            ) || DID_BOUNCE;

          } else if (TOUCH_RIGHT && WITHIN_LR_PADDLE && TOTAL_VEL_X > 0) {

            const OFFSET = clamp((STAR.y - PADDLE_CENTER_Y) / (HALF_PH || 1), -1, 1);
            const ANG = OFFSET * MAX_ANGLE;

            const OUT_VEL_X = -1 * BALL_SPEED * Math.cos(ANG);
            const OUT_VEL_Y = BALL_SPEED * Math.sin(ANG);

            DID_BOUNCE = bounceVertical(
              STAR, VIEW_RIGHT, -1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_X, NOW_MS, HIT_COOLDOWN_MS
            ) || DID_BOUNCE;

          } else if (TOUCH_TOP && WITHIN_TB_PADDLE && TOTAL_VEL_Y < 0) {

            const OFFSET = clamp((STAR.x - PADDLE_CENTER_X) / (HALF_PW || 1), -1, 1);
            const ANG = OFFSET * MAX_ANGLE;

            const OUT_VEL_Y = +1 * BALL_SPEED * Math.cos(ANG);
            const OUT_VEL_X = BALL_SPEED * Math.sin(ANG);

            DID_BOUNCE = bounceHorizontal(
              STAR, VIEW_TOP, +1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_Y, NOW_MS, HIT_COOLDOWN_MS
            ) || DID_BOUNCE;

          } else if (TOUCH_BOTTOM && WITHIN_TB_PADDLE && TOTAL_VEL_Y > 0) {

            const OFFSET = clamp((STAR.x - PADDLE_CENTER_X) / (HALF_PW || 1), -1, 1);
            const ANG = OFFSET * MAX_ANGLE;

            const OUT_VEL_Y = -1 * BALL_SPEED * Math.cos(ANG);
            const OUT_VEL_X = BALL_SPEED * Math.sin(ANG);

            DID_BOUNCE = bounceHorizontal(
              STAR, VIEW_BOTTOM, -1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_Y, NOW_MS, HIT_COOLDOWN_MS
            ) || DID_BOUNCE;
          }
        }
      }
    }

    /* GROUP: Edge behavior (wrap vs bounce) */
    if (S.pointerRingTimer === 0 || DISTANCE_TO_POINTER_SQ > WRAP_DISTANCE_SQ || S.pokeImpulseTimer > 10) {

      const STAR_RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

      if (STAR.x < -STAR_RADIUS) STAR.x = S.canvasWidth + STAR_RADIUS;
      else if (STAR.x > S.canvasWidth + STAR_RADIUS) STAR.x = -STAR_RADIUS;

      if (STAR.y < -STAR_RADIUS) STAR.y = S.canvasHeight + STAR_RADIUS;
      else if (STAR.y > S.canvasHeight + STAR_RADIUS) STAR.y = -STAR_RADIUS;

    } else {

      if (!DID_BOUNCE) {

        const STAR_RADIUS = (STAR.whiteValue * 2 + STAR.size) || 0;

        const TOTAL_VEL_X = (STAR.vx || 0) + (STAR.momentumX || 0);
        const TOTAL_VEL_Y = (STAR.vy || 0) + (STAR.momentumY || 0);

        const PUSH_OUT_X = STAR_RADIUS + 0.5;
        const PUSH_OUT_Y = STAR_RADIUS + 0.5;

        if (STAR.x < STAR_RADIUS) {
          const OUT_VEL_X = Math.abs(TOTAL_VEL_X);
          const OUT_VEL_Y = TOTAL_VEL_Y;
          bounceVertical(STAR, STAR_RADIUS, +1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_X, NOW_MS, 0);
        } else if (STAR.x > S.canvasWidth - STAR_RADIUS) {
          const OUT_VEL_X = -Math.abs(TOTAL_VEL_X);
          const OUT_VEL_Y = TOTAL_VEL_Y;
          bounceVertical(STAR, S.canvasWidth - STAR_RADIUS, -1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_X, NOW_MS, 0);
        }

        if (STAR.y < STAR_RADIUS) {
          const OUT_VEL_X = TOTAL_VEL_X;
          const OUT_VEL_Y = Math.abs(TOTAL_VEL_Y);
          bounceHorizontal(STAR, STAR_RADIUS, +1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_Y, NOW_MS, 0);
        } else if (STAR.y > S.canvasHeight - STAR_RADIUS) {
          const OUT_VEL_X = TOTAL_VEL_X;
          const OUT_VEL_Y = -Math.abs(TOTAL_VEL_Y);
          bounceHorizontal(STAR, S.canvasHeight - STAR_RADIUS, -1, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT_Y, NOW_MS, 0);
        }
      }
    }

    /* GROUP: White flash decay */
    if (STAR.whiteValue > 0) {
      STAR.whiteValue *= WHITE_DECAY;
      if (STAR.whiteValue < 0.001) STAR.whiteValue = 0;
    }

    /* GROUP: Opacity / twinkle cycle */
    if (STAR.opacity <= 0.005) {
      STAR.opacity = 1;
      if (Math.random() < 0.07) STAR.whiteValue = 1;
    } else if (STAR.opacity > 0.02) {
      STAR.opacity -= (0.005 * STAR.fadeSpeed) * DT_FRAMES;
    } else {
      STAR.opacity -= 0.0001 * DT_FRAMES;
    }
  }

  /* GROUP: Reset keyboard impulses */
  window.KEYBOARD.multX = 1;
  window.KEYBOARD.multY = 1;
  window.KEYBOARD.addX = 0;
  window.KEYBOARD.addY = 0;
  window.KEYBOARD.magnetX = 0;
  window.KEYBOARD.magnetY = 0;
  window.KEYBOARD.magnetPointer = false;

  /* GROUP: Pointer energy decay */
  S.pointerSpeedUnits *= POINTER_SPEED_DECAY;
  if (S.pointerSpeedUnits < 0.001) S.pointerSpeedUnits = 0;

  /* GROUP: Ring timer decay */
  S.pointerRingTimer *= RING_DECAY;
  if (S.pointerRingTimer < 1) S.pointerRingTimer = 0;

  /* GROUP: Poke timer decay */
  S.pokeImpulseTimer *= POKE_DECAY;
  if (S.pokeImpulseTimer < 1) S.pokeImpulseTimer = 0;

  /* GROUP: Debug readouts (only when present) */
  if (DBG.misc || DBG.circle || DBG.speed || DBG.poke) {
    if (DBG.misc) DBG.misc.textContent = (S.getNowMs() - FRAME_START_MS).toFixed(3);
    if (DBG.circle) DBG.circle.textContent = S.pointerRingTimer.toFixed(3);
    if (DBG.speed) DBG.speed.textContent = S.pointerSpeedUnits.toFixed(3);
    if (DBG.poke) DBG.poke.textContent = S.pokeImpulseTimer.toFixed(1);
  }

  /* GROUP: Adaptive link-distance “lag buster” */
  const FRAME_TIME_MS = S.getNowMs() - FRAME_START_MS;

  const TARGET_MS = 3;
  const SHRINK = 0.95;
  const GROW = 1.05;

  const MIN_LINK_DISTANCE = S.goalLinkDistance * 0.3;
  const MAX_LINK_DISTANCE = S.goalLinkDistance;

  if (FRAME_TIME_MS > TARGET_MS) {
    S.maxLinkDistance *= SHRINK;
  } else {
    S.maxLinkDistance *= GROW;

    if (S.linkRebuildTimer > 0) {
      const T = 1 - (S.linkRebuildTimer / 300);
      S.maxLinkDistance = S.goalLinkDistance * T;
      LINKS_DIRTY = true;
    }
  }

  if (S.linkRebuildTimer > 0) S.linkRebuildTimer -= 0.1 * DT_MS;
  if (S.linkRebuildTimer < 0) S.linkRebuildTimer = 0;

  if (S.maxLinkDistance < MIN_LINK_DISTANCE) {
    S.maxLinkDistance = MIN_LINK_DISTANCE;
  } else if (S.maxLinkDistance > MAX_LINK_DISTANCE) {
    S.maxLinkDistance = MAX_LINK_DISTANCE;
  }
};

/* GROUP: Bounce helpers (momentum-only, no hard stop) */
function bounceVertical(STAR, WALL_X, WALL_SIGN, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT, NOW_MS, COOLDOWN_MS = 0) {
  if (COOLDOWN_MS > 0) {
    const LAST = STAR.lastBounceV_Ms || 0;
    if (NOW_MS - LAST < COOLDOWN_MS) return false;
    STAR.lastBounceV_Ms = NOW_MS;
  }

  const BASE_VX = STAR.vx || 0;
  const BASE_VY = STAR.vy || 0;

  STAR.momentumX = OUT_VEL_X - BASE_VX;
  STAR.momentumY = OUT_VEL_Y - BASE_VY;

  STAR.x = WALL_X + WALL_SIGN * PUSH_OUT;

  return true;
}

function bounceHorizontal(STAR, WALL_Y, WALL_SIGN, OUT_VEL_X, OUT_VEL_Y, PUSH_OUT, NOW_MS, COOLDOWN_MS = 0) {
  if (COOLDOWN_MS > 0) {
    const LAST = STAR.lastBounceH_Ms || 0;
    if (NOW_MS - LAST < COOLDOWN_MS) return false;
    STAR.lastBounceH_Ms = NOW_MS;
  }

  const BASE_VX = STAR.vx || 0;
  const BASE_VY = STAR.vy || 0;

  STAR.momentumX = OUT_VEL_X - BASE_VX;
  STAR.momentumY = OUT_VEL_Y - BASE_VY;

  STAR.y = WALL_Y + WALL_SIGN * PUSH_OUT;

  return true;
}

/* #endregion 1) PHYSICS */



/*======================================================================
 * #region 2) RENDERING
 *====================================================================*/

/* GROUP: Link bucket constants */
const LINK_BUCKET_COUNT = 18;

let LINK_PATHS_BY_BUCKET = Array.from({ length: LINK_BUCKET_COUNT }, () => new Path2D());

function resetLinkPaths() {
  for (let BUCKET_INDEX = 0; BUCKET_INDEX < LINK_BUCKET_COUNT; BUCKET_INDEX++) {
    LINK_PATHS_BY_BUCKET[BUCKET_INDEX] = new Path2D();
  }
}

/* GROUP: Render entry point */
S.renderStarsAndLinks = function renderStarsAndLinks() {

  const CONTEXT = S.drawingContext;

  CONTEXT.clearRect(0, 0, S.canvasWidth, S.canvasHeight);

  /* GROUP: Paddles overlay */
  if (window.KEYBOARD.paddlesTimer > 0) {

    window.KEYBOARD.paddlesX = Math.max(0, Math.min(100, window.KEYBOARD.paddlesX));
    window.KEYBOARD.paddlesY = Math.max(0, Math.min(100, window.KEYBOARD.paddlesY));

    const CANVAS = S.constellationCanvas;
    if (!CANVAS) return;

    const RECT = CANVAS.getBoundingClientRect();

    const VIEW_LEFT = -RECT.left;
    const VIEW_TOP = -RECT.top;
    const VIEW_RIGHT = VIEW_LEFT + window.innerWidth;
    const VIEW_BOTTOM = VIEW_TOP + window.innerHeight;

    const ALPHA = Math.min(1, Math.max(0, window.KEYBOARD.paddlesTimer));

    const PADDLE_CENTER_X =
      VIEW_LEFT + (window.KEYBOARD.paddlesX / 100) * window.innerWidth;
    const PADDLE_CENTER_Y =
      VIEW_TOP + (window.KEYBOARD.paddlesY / 100) * window.innerHeight;

    const PADDLE_W = window.innerWidth * 0.10;
    const PADDLE_H = window.innerHeight * 0.10;

    CONTEXT.save();
    CONTEXT.globalAlpha = ALPHA;
    CONTEXT.lineWidth = Math.max(2, Math.min(window.innerWidth, window.innerHeight) * 0.03);
    CONTEXT.lineCap = "round";
    CONTEXT.strokeStyle = "rgba(255,255,255,1)";

    CONTEXT.beginPath();

    CONTEXT.moveTo(VIEW_LEFT, Math.max(VIEW_TOP, PADDLE_CENTER_Y - PADDLE_H / 2));
    CONTEXT.lineTo(VIEW_LEFT, Math.min(VIEW_BOTTOM, PADDLE_CENTER_Y + PADDLE_H / 2));
    CONTEXT.moveTo(VIEW_RIGHT, Math.max(VIEW_TOP, PADDLE_CENTER_Y - PADDLE_H / 2));
    CONTEXT.lineTo(VIEW_RIGHT, Math.min(VIEW_BOTTOM, PADDLE_CENTER_Y + PADDLE_H / 2));

    CONTEXT.moveTo(Math.max(VIEW_LEFT, PADDLE_CENTER_X - PADDLE_W / 2), VIEW_TOP);
    CONTEXT.lineTo(Math.min(VIEW_RIGHT, PADDLE_CENTER_X + PADDLE_W / 2), VIEW_TOP);
    CONTEXT.moveTo(Math.max(VIEW_LEFT, PADDLE_CENTER_X - PADDLE_W / 2), VIEW_BOTTOM);
    CONTEXT.lineTo(Math.min(VIEW_RIGHT, PADDLE_CENTER_X + PADDLE_W / 2), VIEW_BOTTOM);

    CONTEXT.stroke();
    CONTEXT.restore();

    window.KEYBOARD.paddlesTimer -= 0.1;
  }

  /* GROUP: Links */
  CONTEXT.lineWidth = 1;

  const STAR_COUNT = S.starList.length;

  if (STAR_COUNT) {

    LINK_FRAME++;

    if (S.pointerSpeedUnits > 10) LINKS_DIRTY = true;

    const SHOULD_REBUILD_LINKS = LINKS_DIRTY || (LINK_FRAME % 2 === 0);

    if (SHOULD_REBUILD_LINKS) {

      LINKS_DIRTY = false;

      for (let I = 0; I < STAR_COUNT; I++) {
        S.starList[I].edge = getEdgeFadeFactorFast(S.starList[I]);
      }

      const LINK_DISTANCE_SCALE = S.screenPerimeter / 500;

      const RAW_LINK_CUTOFF = S.maxLinkDistance / LINK_DISTANCE_SCALE;
      const LINK_CUTOFF_SQ = RAW_LINK_CUTOFF * RAW_LINK_CUTOFF;

      resetLinkPaths();

      for (let A_INDEX = 0; A_INDEX < STAR_COUNT; A_INDEX++) {

        const STAR_A = S.starList[A_INDEX];

        const AX = STAR_A.x;
        const AY = STAR_A.y;

        const OPACITY_A = STAR_A.opacity;
        const EDGE_A = STAR_A.edge;

        for (let B_INDEX = A_INDEX + 1; B_INDEX < STAR_COUNT; B_INDEX++) {

          const STAR_B = S.starList[B_INDEX];

          const DELTA_X = AX - STAR_B.x;
          const DELTA_Y = AY - STAR_B.y;

          const DISTANCE_SQ = DELTA_X * DELTA_X + DELTA_Y * DELTA_Y;

          if (DISTANCE_SQ > LINK_CUTOFF_SQ) continue;

          const SCALED_DISTANCE = Math.sqrt(DISTANCE_SQ) * LINK_DISTANCE_SCALE;

          const MIN_OPACITY = OPACITY_A < STAR_B.opacity ? OPACITY_A : STAR_B.opacity;
          const MIN_EDGE = EDGE_A < STAR_B.edge ? EDGE_A : STAR_B.edge;

          const DISTANCE_FADE = 1 - (SCALED_DISTANCE / S.maxLinkDistance);
          const DISTANCE_CLAMP = DISTANCE_FADE > 0 ? DISTANCE_FADE : 0;

          let LINK_ALPHA = DISTANCE_CLAMP * MIN_OPACITY * MIN_EDGE;
          LINK_ALPHA = Math.min(1, (LINK_ALPHA * (LINK_ALPHA + 1)));

          if (LINK_ALPHA <= 0.002) continue;

          let BUCKET_INDEX = (LINK_ALPHA * (LINK_BUCKET_COUNT - 1)) | 0;
          if (BUCKET_INDEX < 0) BUCKET_INDEX = 0;
          if (BUCKET_INDEX >= LINK_BUCKET_COUNT) BUCKET_INDEX = LINK_BUCKET_COUNT - 1;

          LINK_PATHS_BY_BUCKET[BUCKET_INDEX].moveTo(AX, AY);
          LINK_PATHS_BY_BUCKET[BUCKET_INDEX].lineTo(STAR_B.x, STAR_B.y);
        }
      }
    }

    for (let I = 0; I < LINK_BUCKET_COUNT; I++) {
      const BUCKET_ALPHA = I / (LINK_BUCKET_COUNT - 1);
      if (BUCKET_ALPHA <= 0) continue;

      CONTEXT.strokeStyle = `rgba(100, 100, 100, ${BUCKET_ALPHA})`;
      CONTEXT.stroke(LINK_PATHS_BY_BUCKET[I]);
    }
  }

  /* GROUP: Stars */
  if (!STAR_SPRITES.ready) return;

  const IMG = STAR_SPRITES.img;

  for (const STAR of S.starList) {

    const BASE_RADIUS = (STAR.whiteValue * 2 + STAR.size) || 1;
    const SPRITE_SIZE = Math.max(2, BASE_RADIUS * 2.4);

    const STAR_CENTER_X = STAR.x;
    const STAR_CENTER_Y = STAR.y;

    const OVERLAY_RADIUS = SPRITE_SIZE * 0.48;

    let RED_T = (STAR.redValue - 50) / 150;
    if (RED_T < 0) RED_T = 0;
    if (RED_T > 1) RED_T = 1;

    const DARKNESS = 0.15 + 0.55 * (1 - RED_T);

    CONTEXT.save();

    CONTEXT.globalAlpha = STAR.opacity;

    CONTEXT.translate(STAR_CENTER_X, STAR_CENTER_Y);
    CONTEXT.rotate(STAR.rotation || 0);
    CONTEXT.drawImage(IMG, -SPRITE_SIZE / 2, -SPRITE_SIZE / 2, SPRITE_SIZE, SPRITE_SIZE);

    CONTEXT.globalCompositeOperation = "source-atop";
    CONTEXT.globalAlpha = STAR.opacity * DARKNESS;
    CONTEXT.fillStyle = "rgba(0, 0, 0, 1)";
    CONTEXT.beginPath();
    CONTEXT.arc(0, 0, OVERLAY_RADIUS, 0, Math.PI * 2);
    CONTEXT.fill();

    if (STAR.whiteValue > 0.01) {
      CONTEXT.globalCompositeOperation = "lighter";
      CONTEXT.globalAlpha = STAR.opacity * (STAR.whiteValue > 1 ? 1 : STAR.whiteValue);
      CONTEXT.fillStyle = "rgba(255, 255, 255, 1)";
      CONTEXT.beginPath();
      CONTEXT.arc(0, 0, OVERLAY_RADIUS, 0, Math.PI * 2);
      CONTEXT.fill();
    }

    CONTEXT.restore();
  }

  /* GROUP: User pointer ring */
  const TARGET_RING_RADIUS = Math.max(0, S.screenScaleUp * 100 - 40);

  let RING_RADIUS = TARGET_RING_RADIUS * (S.pointerRingTimer / 50);
  let RING_WIDTH = S.pointerRingTimer * 0.15;
  let RING_ALPHA = Math.min(S.pointerRingTimer * 0.07, 1);

  if (S.pointerSpeedUnits < 1) {

    const NORMALIZED_POKE = Math.min(1, Math.max(0, S.pokeImpulseTimer / 200));
    const INVERTED_POKE = 1 - NORMALIZED_POKE;

    RING_RADIUS = TARGET_RING_RADIUS * INVERTED_POKE;
    RING_WIDTH = NORMALIZED_POKE * 7;
    RING_ALPHA = NORMALIZED_POKE;
  }

  if (RING_ALPHA > 0.001) {
    CONTEXT.save();
    CONTEXT.lineWidth = RING_WIDTH;
    CONTEXT.strokeStyle = "rgba(189, 189, 189, 1)";
    CONTEXT.globalAlpha = RING_ALPHA;
    CONTEXT.beginPath();
    CONTEXT.arc(S.pointerClientX, S.pointerClientY, RING_RADIUS, 0, Math.PI * 2);
    CONTEXT.stroke();
    CONTEXT.restore();
  }
};

/* #endregion 2) RENDERING */



/*======================================================================
 * #region 3) USER INPUT
 *====================================================================*/

/* GROUP: Pointer speed energy */
S.updatePointerSpeed = function updatePointerSpeed(CURRENT_X, CURRENT_Y) {

  const NOW_MS = S.getNowMs();

  if (!S.lastPointerTimeMs) {

    S.pointerClientX = CURRENT_X;
    S.pointerClientY = CURRENT_Y;

    S.lastPointerTimeMs = NOW_MS;
    S.pointerSpeedUnits = 0;

    return;
  }

  const DT_MS = Math.max(1, NOW_MS - S.lastPointerTimeMs);

  const DELTA_X = CURRENT_X - S.pointerClientX;
  const DELTA_Y = CURRENT_Y - S.pointerClientY;

  const RAW_SPEED = Math.sqrt(DELTA_X * DELTA_X + DELTA_Y * DELTA_Y) / DT_MS;

  S.pointerSpeedUnits = S.screenScaleDown * Math.min(RAW_SPEED * 50, 50);

  S.pointerRingTimer = Math.max(S.pointerRingTimer, S.pointerSpeedUnits);

  if (S.pointerSpeedUnits > 10) LINKS_DIRTY = true;

  S.pointerClientX = CURRENT_X;
  S.pointerClientY = CURRENT_Y;

  S.lastPointerTimeMs = NOW_MS;
};

/* GROUP: Begin interaction */
S.beginPointerInteraction = function beginPointerInteraction(START_X, START_Y) {
  S.pokeImpulseTimer = 200;
  S.lastPointerTimeMs = 0;
  S.updatePointerSpeed(START_X, START_Y);
};

/* GROUP: Event listeners */
window.addEventListener("mousedown", (EVENT) =>
  S.beginPointerInteraction(EVENT.clientX, EVENT.clientY)
);

window.addEventListener("pointermove", (EVENT) => {
  if (EVENT.pointerType === "touch") return;
  S.updatePointerSpeed(EVENT.clientX, EVENT.clientY);
});

window.addEventListener(
  "touchstart",
  (EVENT) => {
    const TOUCH = EVENT.touches[0];
    if (!TOUCH) return;
    S.beginPointerInteraction(TOUCH.clientX, TOUCH.clientY);
  },
  { passive: true }
);

window.addEventListener(
  "touchmove",
  (EVENT) => {
    const TOUCH = EVENT.touches[0];
    if (!TOUCH) return;
    S.updatePointerSpeed(TOUCH.clientX, TOUCH.clientY);
  },
  { passive: true }
);

/* #endregion 3) USER INPUT */