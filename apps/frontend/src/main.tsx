import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Фаза 5 «Наблюдение»: фронтенд визуализирует поток состояний с
// api-gateway (WebSocket + REST) — read-only, без регистрации и действий,
// кроме навигации/приближения (ТЗ А.1, 6.1, 7.1). Никогда не пишет игровое
// состояние и никогда не хранит ключ Anthropic (CLAUDE.md, п.2).
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
