// Keyboard state (global so any script can read it)
window.KEY_LEFT = window.KEY_RIGHT = window.KEY_UP = window.KEY_DOWN = false;

// Key down: turn flags ON
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;

  const KEY = event.key;

  if (KEY === "ArrowLeft" || KEY === "a") window.KEY_LEFT = true;
  if (KEY === "ArrowRight" || KEY === "d") window.KEY_RIGHT = true;
  if (KEY === "ArrowUp" || KEY === "w") window.KEY_UP = true;
  if (KEY === "ArrowDown" || KEY === "s") window.KEY_DOWN = true;
});

// Key up: turn flags OFF
window.addEventListener("keyup", (event) => {
  const KEY = event.key;

  if (KEY === "ArrowLeft" || KEY === "a") window.KEY_LEFT = false;
  if (KEY === "ArrowRight" || KEY === "d") window.KEY_RIGHT = false;
  if (KEY === "ArrowUp" || KEY === "w") window.KEY_UP = false;
  if (KEY === "ArrowDown" || KEY === "s") window.KEY_DOWN = false;
});

// Called once per frame (you already do this in updateStarPhysics)
window.updateKeyboardForces = function updateKeyboardForces() {
  const STARFIELD = window.STARFIELD;
  if (!STARFIELD?.starList?.length) return;

  // Convert key flags into a direction (-1, 0, 1)
  const INPUT_X = (window.KEY_RIGHT ? 1 : 0) - (window.KEY_LEFT ? 1 : 0);
  const INPUT_Y = (window.KEY_DOWN ? 1 : 0) - (window.KEY_UP ? 1 : 0);

  // Strength (tweak this)
  const FORCE_SCALE = 0.6;

  // Apply per-star (same for all stars right now)
  for (const STAR of STARFIELD.starList) {
    let FORCE_X = INPUT_X * FORCE_SCALE;
    let FORCE_Y = INPUT_Y * FORCE_SCALE;

    // TODO: add per-star math here (based on STAR.x/y/etc)

    STAR.keyboardForceX = FORCE_X;
    STAR.keyboardForceY = FORCE_Y;
  }
};