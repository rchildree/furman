const key = "editor:" + new URLSearchParams(location.search).get("id");
window.acquireVsCodeApi = () => ({
  getState() {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  setState(value) {
    localStorage.setItem(key, JSON.stringify(value));
  },
  postMessage(message) {
    parent.postMessage({ channel: "schedule", message }, location.origin);
  },
});
