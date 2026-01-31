(function boot(){
  "use strict";

  /* ===============================
   *  0) SITE VERSION (bump per deploy)
   * =============================== */
  const SITE_VERSION = "01.30.2026.O";
  window.SITE_VERSION = SITE_VERSION;
  //alert(SITE_VERSION);

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
  
    /* ===============================
   *  6) Add version badge
   * =============================== */

  const badgeHTML = `<div id="versionBadge">v${SITE_VERSION}</div>`;

  function addVersionBadge(){
    if (document.getElementById("versionBadge")) return; // prevent duplicates
    document.body.insertAdjacentHTML("beforeend", badgeHTML);
  }

    /* ===============================
   *  7) Init
   * =============================== */
  
  function onDOMReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }
  
  onDOMReady(() => {
    const HTML = document.documentElement;
    const BODY = document.body;
    const CONTAINER = document.getElementById("transitionContainer");

    HTML.style.overflowY = "hidden";
    BODY.style.overflowY = "hidden";
    CONTAINER.style.overflowY = "visible";
    loadPageScripts();
    addVersionBadge();
  });
})();