import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Injected by the CLI's static server (src/server/staticServer.ts) before
// </head> when it serves index.html. Falls back to an empty report so
// `vite dev` still renders something during frontend-only development.
const report = window.__INTUNEATLAS_REPORT__ ?? {
  scannedAt: null,
  flow: null,
  policyCount: 0,
  settingCount: 0,
  conflictCount: 0,
  settings: [],
  compliancePolicies: [],
  enrollmentConfigurations: [],
};

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App report={report} />
  </StrictMode>,
);
