let USER_INPUT = 0;
const getForceX = (value) => (window.KEYBOARD_FORCE_X = value);
const getForceY = (value) => (window.KEYBOARD_FORCE_Y = value);

window.addEventListener("keydown", (event) => {
  // Ignore held-down repeats
  if (event.repeat) return;
});
