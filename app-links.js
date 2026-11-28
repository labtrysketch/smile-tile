/* Sister-app links in the header. Opens the sketchpad and pattern checker in a new tab. */
(() => {
  const LINKS = [
    { href: "https://cosy-vector-sketchpad.vercel.app", label: "Sketchpad", title: "Open Cosy Vector Sketchpad in a new tab" },
    { href: "https://cosy-pattern-checker.vercel.app", label: "Pattern checker", title: "Open Cosy Pattern Checker in a new tab" }
  ];
  function mount() {
    const header = document.querySelector("header");
    if (!header || header.querySelector(".app-links")) return;
    const nav = document.createElement("nav");
    nav.className = "app-links";
    nav.setAttribute("aria-label", "Sister apps");
    for (const L of LINKS) {
      const a = document.createElement("a");
      a.href = L.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = L.label;
      a.title = L.title;
      nav.appendChild(a);
    }
    const h1 = header.querySelector("h1");
    if (h1 && h1.nextSibling) header.insertBefore(nav, h1.nextSibling);
    else header.appendChild(nav);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
