import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Фаза 1 «Каркас»: минимальный конфиг Vite. Ключей Anthropic здесь и не
// должно быть — все LLM-вызовы идут строго с сервера (CLAUDE.md, п.2; ТЗ А.7).
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Vite 5.4+/6 отклоняет запросы с чужим заголовком Host по умолчанию
    // (защита от DNS rebinding) — без явного разрешения домен за
    // reverse-прокси (ops/caddy/Caddyfile) получал бы "Blocked request.
    // This host is not allowed".
    allowedHosts: ["aurwin.ru"],
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ["aurwin.ru"],
  },
});
