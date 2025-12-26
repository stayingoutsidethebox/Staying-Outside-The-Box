// thank heavens for chatGPT <3

//alert("Debug man");

/*========================================*
//#region 1) SETUP
 *========================================*/

/* Event listener */
window.addEventListener("keydown", (event) => {
  
  
  // Ignore held-down repeats
  if (event.repeat) return;

  // Ignore IME composition
  if (event.isComposing) return;

  // Run the user command
  KEY_FUNCTIONS[event.key.toLowerCase()]?.();
});

/* Assign keys to functions */
const KEY_FUNCTIONS = {

  /* 2) GLOBAL MOVEMENT */
  // Up
  w: () => runW(),
  // Left
  a: () => runA(),
  // Down
  s: () => runS(),
  // Right
  d: () => runD(),

  // Up-left
  q: () => runQ(),
  // Up-right
  e: () => runE(),
  // Down-left
  z: () => runZ(),
  // Down-right
  x: () => runX(),

  /* 3) QUADRANT MAGNETISM */
  // Top-left
  y: () => runY(),
  // Top-center
  u: () => runU(),
  // Top-right
  i: () => runI(),

  // Middle-left
  h: () => runH(),
  // Middle-center
  j: () => runJ(),
  // Middle-right
  k: () => runK(),

  // Bottom-left
  b: () => runB(),
  // Bottom-center
  n: () => runN(),
  // Bottom-right
  m: () => runM(),

  /* 4) PONG */
  // Paddle left
  r: () => runR(),
  // Paddle right
  t: () => runT(),
  // Paddle up
  f: () => runF(),
  // Paddle down
  c: () => runC(),

  /* 5) OTHERS */
  // Velocity invert
  v: () => runV(),
  // Grumble
  g: () => runG(),
  // Orbit
  o: () => runO(),
  // Poke burst
  p: () => runP(),
  // Link shatter
  l: () => runL()
};

/* Function constants */
const STRENGTH = 0.8;
const MULTIPLY = 1 + STRENGTH;
const DIVIDE = 1 - STRENGTH;
const POSITIVE = STRENGTH;
const NEGATIVE = -STRENGTH;

/* #endregion 1) SETUP */

/*========================================*
//#region 2) GLOBAL MOVEMENT
 *========================================*/

// W = Up
function runW() {
  // X
  window.KEYBOARD.addY = NEGATIVE;
}

// A = Left
function runA() {
  window.KEYBOARD.addX = NEGATIVE;
  // Y
}

// S = Down
function runS() {
  // X
  window.KEYBOARD.addY = POSITIVE;
}

// D = Right
function runD() {
  window.KEYBOARD.addX = POSITIVE;
  // Y
}

// Q = Left up
function runQ() {
  window.KEYBOARD.addX = NEGATIVE / 2;
  window.KEYBOARD.addY = NEGATIVE / 2;
}

// E = Right up
function runE() {
  window.KEYBOARD.addX = POSITIVE / 2;
  window.KEYBOARD.addY = NEGATIVE / 2;
}

// Z = Left down
function runZ() {
  window.KEYBOARD.addX = NEGATIVE / 2;
  window.KEYBOARD.addY = POSITIVE / 2;
}

// X = Right down
function runX() {
  window.KEYBOARD.addX = POSITIVE / 2;
  window.KEYBOARD.addY = POSITIVE / 2;
}
/* #endregion 2) GLOBAL MOVEMENT */

/*========================================*
//#region 3) QUADRANT MAGNETISM
 *========================================*/
// Y = Top left
function runY() {
  
}

// U = Top center
function runU() {
  
}

// I = Top right
function runI() {
  
}

// H = Middle left
function runH() {
  
}

// J = Middle center
function runJ() {
  
}

// K = Middle right
function runK() {
  
}

// B = Bottom left
function runB() {
  
}

// N = Bottom center
function runN() {
  
}

// M = Bottom right
function runM() {
  
}
/* #endregion 3) QUADRANT MAGNETISM */

/*========================================*
//#region 4) PONG
 *========================================*/
// R = Paddles left
function runR() {
  
}

// T = Paddles right
function runT() {
  
}

// F = Paddles up
function runF() {
  
}

// C = Paddles down
function runC() {
  
}
/* #endregion 4) PONG */

/*========================================*
//#region 5) OTHERS
 *========================================*/

// V = Less (v) speed
function runV() {
  window.KEYBOARD.multX = DIVIDE;
  window.KEYBOARD.multY = DIVIDE;
}

// G = Greater (^) speed
function runG() {
  window.KEYBOARD.multX = MULTIPLY;
  window.KEYBOARD.multY = MULTIPLY;
}

// O = Orbit
function runO() {
  
}

// P = Passive movement inversion
function runP() {
  for (const STAR of window.STARFIELD.starList) {
    STAR.vx = -STAR.vx;
    STAR.vy = -STAR.vy;
  }
}

// L = Link shatter
function runL() {
  
}
/* #endregion 5) OTHERS */
