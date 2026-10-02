import "@fontsource-variable/roboto";
import "@fontsource-variable/roboto-mono";
import "./popup.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AxiomProvider } from "@optiaxiom/react";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AxiomProvider>
        <App />
      </AxiomProvider>
    </StrictMode>,
  );
}
