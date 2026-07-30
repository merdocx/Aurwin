import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// Фаза 1 «Каркас»: заготовка фронтенда. Рендер мира на PixiJS появится в
// следующих фазах (ТЗ А.1, 7.1) — фронтенд только визуализирует поток
// состояний с api-gateway, никогда не пишет игровое состояние.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
