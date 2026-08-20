import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Injected by the CLI's static server (src/server/staticServer.ts) before
// </head> when it serves index.html — either a real report or `null` when
// nothing's been scanned yet. Missing entirely (e.g. `vite dev` without the
// CLI server) is treated the same as null, which conveniently also lets the
// connect screen be exercised during frontend-only development.
const report = window.__INTUNEATLAS_REPORT__ ?? null;

// Who's looking at this instance — `{ name, email }`. The server always
// verifies a real Microsoft sign-in before this page is ever served (see
// staticServer.ts), so this is never null in practice; frontend-only dev
// (`vite dev`) never gets it injected at all, hence the fallback.
const session = window.__INTUNEATLAS_SESSION__ ?? null;

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App initialReport={report} session={session} />
  </StrictMode>,
);
