import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

/**
 * Registers the runtime cache so repeat visits can reuse fetched assets and headshots.
 */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}serviceworker.js`)
      .catch((error) => {
        console.error("Service worker registration failed:", error);
      });
  });
}

registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
