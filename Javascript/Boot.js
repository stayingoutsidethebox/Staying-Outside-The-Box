(function boot(){
  "use strict";

  /* ===============================
   *  0) SITE VERSION (bump per deploy)
   * =============================== */
  const SITE_VERSION = "tomato";
  window.SITE_VERSION = SITE_VERSION;
  alert(SITE_VERSION);

  function v(url){
    const joiner = url.includes("?") ? "&" : "?";
    return `${url}${joiner}v=${encodeURIComponent(SITE_VERSION)}`;
  }

  /* ===============================
   *  1) PAGE DETECTION
   * =============================== */
  function getPageKey(){
    let p = location.pathname.toLowerCase();

    if (p.endsWith("/")) p = p.slice(0, -1);
    if (p.endsWith(".html")) p = p.slice(0, -5);
    if (p === "") p = "/";

    if (p === "/" || p === "/index") return "home";
    if (p === "/404") return "notfound";

    return "generic";
  }

  const PAGE = getPageKey();

  /* ===============================
   *  2) CSP-safe GA init (no inline)
   * =============================== */
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };

  const ga = document.createElement("script");
  ga.async = true;
  ga.src = "https://www.googletagmanager.com/gtag/js?id=G-LXE5T2K4ZT";
  document.head.appendChild(ga);

  window.gtag("js", new Date());
  window.gtag("config", "G-LXE5T2K4ZT");

  /* ===============================
   *  3) CSS mode flip
   * =============================== */
  const html = document.documentElement;
  html.classList.remove("noJs");

  if (PAGE === "home") {
    html.classList.add("homeJs");
  } else {
    html.classList.add("otherJs");
  }

  /* ===============================
   *  4) Inject versioned CSS
   * =============================== */
  document.write(`<link rel="stylesheet" href="${v("/stylesheet.css")}">`);

  /* ===============================
   *  5) Append page scripts at END
   * =============================== */
  const GLOBAL_SCRIPTS = [
    "/Javascript/Starfield Setup.js",
    "/Javascript/Active Starfield.js",
    "/Javascript/Layout.js",
    "/Javascript/Keyboard Starfield.js"
  ];

  function appendScript(src){
    const s = document.createElement("script");
    s.src = v(src);
    s.async = false; // preserve order
    document.body.appendChild(s);
  }

  function loadPageScripts(){
    GLOBAL_SCRIPTS.forEach(appendScript);

    if (PAGE === "notfound") {
      appendScript("/Javascript/Debug.js");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadPageScripts, { once: true });
  } else {
    loadPageScripts();
  }
})();