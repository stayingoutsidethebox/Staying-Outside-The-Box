// Runs ASAP (no defer) so the correct CSS state applies before first paint.

(function () {
  const html = document.documentElement;

  // Homescreen CSS if homescreen
  html.classList.remove("otherJs");
  html.classList.add("homeJs");
})();