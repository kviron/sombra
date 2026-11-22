import "@/shared/api/diagnostics";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import "@/app/styles/index.css";
import { App } from "@/app/App";
import { ThemeProvider } from "@/app/theme";

// Let an app menu handle the event before suppressing the browser/WebView menu.
window.addEventListener("contextmenu", (event) => event.preventDefault());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
