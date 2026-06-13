import React from "react";
import ReactDOM from "react-dom/client";
// Self-hosted prose face for the editor body (iA Writer Quattro). UI chrome
// stays on the system sans — see --font-prose vs --font-ui in App.css.
import "@fontsource/ia-writer-quattro/400.css";
import "@fontsource/ia-writer-quattro/400-italic.css";
import "@fontsource/ia-writer-quattro/700.css";
import "@fontsource/ia-writer-quattro/700-italic.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
