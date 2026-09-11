import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WorkspaceProgressOverlay } from "./WorkspaceProgressOverlay";
import "./Editing.css";
import "./ProjectSourceDialog.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WorkspaceProgressOverlay />
    <App />
  </React.StrictMode>,
);
