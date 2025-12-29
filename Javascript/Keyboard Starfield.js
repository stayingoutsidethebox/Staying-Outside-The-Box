// thank heavens for chatGPT <3
// Keyboard-driven impulse controller for the Starfield engine.
// This file translates discrete key presses into one-frame forces
// written onto window.KEYBOARD for Active Starfield to consume.

/*======================================================================
 *  MENU
 *----------------------------------------------------------------------
 *  1) SETUP
 *     - Keyboard alias
 *     - Keydown listener
 *     - Key → action dispatch table
 *
 *  2) GLOBAL MOVEMENT
 *     - Directional impulse nudges (WASD + diagonals)
 *
 *  3) QUADRANT MAGNETISM
 *     - Screen-space magnetic attractors (3×3 grid)
 *
 *  4) PONG
 *     - Paddle movement + visibility timer
 *
 *  5) OTHERS
 *     - Speed scaling
 *     - Orbit mode
 *     - Passive inversion
 *     - Link rebuild trigger
 *====================================================================*/


/*======================================================================
 * #region 1) SETUP
 *====================================================================*/

/* GROUP: Keyboard state alias */
// Create a short alias to the shared KEYBOARD impulse object.
// This object is read and cleared every frame by Active Starfield.
var K = window.KEYBOARD;

/* GROUP: Keydown listener */
// Listen globally so keyboard input works regardless of focus,
// unless the browser explicitly suppresses it.
window.addEventListener("keydown", (event) => {

  // Ignore held-down repeat events.
  // We want single, intentional impulses, not OS-level auto-repeat.
  if (event.repeat) return;

  // Ignore IME composition events (important for non-Latin keyboards).
  // Prevents accidental impulses while typing.
  if (event.isComposing) return;

  // Normalize key to lowercase and dispatch if mapped.
  // Optional chaining keeps unknown keys harmless.
  KEY_FUNCTIONS[event.key.toLowerCase()]?.();
});

/* GROUP: Key → action dispatch table */
// Maps physical keys to semantic actions.
// Each action writes impulses into window.KEYBOARD,
// which are then applied exactly once in the physics step.
const KEY_FUNCTIONS = {

  /* GROUP: GLOBAL MOVEMENT */
  // Cardinal directions
  w: () => runW(), // Up
  a: () => runA(), // Left
  s: () => runS(), // Down
  d: () => runD(), // Right

  // Diagonals
  q: () => runQ(), // Up-left
  e: () => runE(), // Up-right
  z: () => runZ(), // Down-left
  x: () => runX(), // Down-right

  /* GROUP: QUADRANT MAGNETISM */
  // 3×3 screen grid magnets (percent-based)
  y: () => runY(), // Top-left
  u: () => runU(), // Top-center
  i: () => runI(), // Top-right

  h: () => runH(), // Middle-left
  j: () => runJ(), // Middle-center
  k: () => runK(), // Middle-right

  b: () => runB(), // Bottom-left
  n: () => runN(), // Bottom-center
  m: () => runM(), // Bottom-right

  /* GROUP: PONG */
  r: () => runR(), // Paddle left
  t: () => runT(), // Paddle right
  f: () => runF(), // Paddle up
  c: () => runC(), // Paddle down

  /* GROUP: OTHERS */
  v: () => runV(), // Reduce velocity
  g: () => runG(), // Increase velocity
  o: () => runO(), // Orbit mode
  p: () => runP(), // Passive drift inversion
  l: () => runL()  // Link rebuild / shatter
};

/* #endregion 1) SETUP */


/*======================================================================
 * #region 2) GLOBAL MOVEMENT
 *====================================================================*/

/* GROUP: Cardinal impulses */
// These functions apply small additive impulses.
// They do NOT move stars directly.
// Active Starfield consumes and clears them next frame.

// W = Up
function runW() {
  // Apply upward impulse in screen space.
  K.addY = -1;
}

// A = Left
function runA() {
  // Apply leftward impulse in screen space.
  K.addX = -1;
}

// S = Down
function runS() {
  // Apply downward impulse in screen space.
  K.addY = 1;
}

// D = Right
function runD() {
  // Apply rightward impulse in screen space.
  K.addX = 1;
}

/* GROUP: Diagonal impulses */
// Diagonals are intentionally weaker to preserve total impulse magnitude.

// Q = Up-left
function runQ() {
  K.addX = -0.5; // Left component
  K.addY = -0.5; // Up component
}

// E = Up-right
function runE() {
  K.addX = 0.5;  // Right component
  K.addY = -0.5; // Up component
}

// Z = Down-left
function runZ() {
  K.addX = -0.5; // Left component
  K.addY = 0.5;  // Down component
}

// X = Down-right
function runX() {
  K.addX = 0.5;  // Right component
  K.addY = 0.5;  // Down component
}

/* #endregion 2) GLOBAL MOVEMENT */


/*======================================================================
 * #region 3) QUADRANT MAGNETISM
 *====================================================================*/

/* GROUP: Screen-space magnetic targets */
// These set magnetX / magnetY in percent-of-screen space.
// Active Starfield converts these into canvas coordinates
// and applies attraction + orbit forces.

// Y = Top-left
function runY() {
  K.magnetX = 16.5; // ~1/6 from left
  K.magnetY = 16.5; // ~1/6 from top
}

// U = Top-center
function runU() {
  K.magnetX = 50;   // Center horizontally
  K.magnetY = 16.5; // Near top
}

// I = Top-right
function runI() {
  K.magnetX = 83.5; // ~5/6 from left
  K.magnetY = 16.5;
}

// H = Middle-left
function runH() {
  K.magnetX = 16.5;
  K.magnetY = 50;
}

// J = Middle-center
function runJ() {
  K.magnetX = 50;
  K.magnetY = 50;
}

// K = Middle-right
function runK() {
  K.magnetX = 83.5;
  K.magnetY = 50;
}

// B = Bottom-left
function runB() {
  K.magnetX = 16.5;
  K.magnetY = 83.5;
}

// N = Bottom-center
function runN() {
  K.magnetX = 50;
  K.magnetY = 83.5;
}

// M = Bottom-right
function runM() {
  K.magnetX = 83.5;
  K.magnetY = 83.5;
}

/* #endregion 3) QUADRANT MAGNETISM */


/*======================================================================
 * #region 4) PONG
 *====================================================================*/

/* GROUP: Paddle impulses */
// These control the paddle overlay and the special “ball star”.
// paddlesTimer controls visibility fade-out.

// R = Paddle left
function runR() {
  K.paddlesTimer = 50; // Make paddles visible
  K.paddlesX -= 5;    // Shift paddle center left
}

// T = Paddle right
function runT() {
  K.paddlesTimer = 50;
  K.paddlesX += 5;
}

// F = Paddle up
function runF() {
  K.paddlesTimer = 50;
  K.paddlesY -= 5;
}

// C = Paddle down
function runC() {
  K.paddlesTimer = 50;
  K.paddlesY += 5;
}

/* #endregion 4) PONG */


/*======================================================================
 * #region 5) OTHERS
 *====================================================================*/

/* GROUP: Velocity scaling */
// These multiply implied velocity during the next physics step.

// V = Reduce speed
function runV() {
  K.multX = 0.6; // Horizontal slowdown
  K.multY = 0.6; // Vertical slowdown
}

// G = Increase speed
function runG() {
  K.multX = 1.7; // Horizontal boost
  K.multY = 1.7; // Vertical boost
}

/* GROUP: Orbit mode */
// Enables pointer-centered magnetism.
// Active Starfield reads this and clears it every frame.
function runO() {
  K.magnetPointer = true;
}

/* GROUP: Passive drift inversion */
// Immediately flips base drift velocity for every star.
// This is a permanent change, not an impulse.
function runP() {
  for (const STAR of window.STARFIELD.starList) {
    STAR.vx = -STAR.vx; // Invert X drift
    STAR.vy = -STAR.vy; // Invert Y drift
  }
}

/* GROUP: Link rebuild trigger */
// Forces links to fade back in over time.
function runL() {
  window.STARFIELD.linkRebuildTimer = 300;
}

/* #endregion 5) OTHERS */