// This script runs only in the sandboxed website preview, never in the app.
addEventListener("message", (event) => {
  if (event.source !== parent || event.data?.type !== "theme-preview") return;
  document
    .querySelectorAll("[data-theme-layer]")
    .forEach((node) => node.remove());
  for (const scope of ["global", "course"]) {
    let style = document.getElementById("draft-" + scope);
    if (!style) {
      style = document.createElement("style");
      style.id = "draft-" + scope;
    }
    style.textContent = event.data[scope] || "";
    document.head.append(style);
  }
});
document.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (link && /^https?:/.test(link.href)) {
    event.preventDefault();
    parent.postMessage({ type: "external-link", url: link.href }, "*");
  }
});
parent.postMessage({ type: "preview-ready" }, "*");
