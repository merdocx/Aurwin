import { useEffect, useRef, useState } from "react";
import { WorldStore } from "./WorldStore";
import type { ServerMessage } from "./types";

export type ConnectionStatus = "connecting" | "open" | "closed" | "rejected";

function resolveWsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit;
  // По умолчанию — api-gateway на том же хосте, порт 3000 (docker-compose:
  // 127.0.0.1:3000). VITE_WS_URL переопределяет для иных деплоев.
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:3000/ws`;
}

/** Троттлинг отправки viewport — навигация может слаться на каждый кадр пана/зума, серверу это не нужно чаще пары раз в секунду. */
const VIEWPORT_SEND_INTERVAL_MS = 400;

export function useWorldSocket() {
  const storeRef = useRef(new WorldStore());
  const wsRef = useRef<WebSocket | null>(null);
  const lastViewportSentAt = useRef(0);
  const pendingViewport = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const flushTimer = useRef<number | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<"day" | "night">("day");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | undefined;

    function connect(): void {
      if (cancelled) return;
      const socket = new WebSocket(resolveWsUrl());
      ws = socket;
      wsRef.current = socket;
      setStatus("connecting");

      socket.onopen = () => setStatus("open");

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMessage;
          if (msg.type === "error") {
            setErrorMessage(msg.message);
            setStatus("rejected");
            return;
          }
          storeRef.current.handleMessage(msg);
          setTick(storeRef.current.tick);
          setPhase(storeRef.current.phase);
        } catch {
          // Некорректное сообщение с сервера молча игнорируется.
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        setStatus("closed");
        // Мир живёт без наблюдателя (6.1) — переподключение не критично для
        // симуляции, но наблюдателю нужно восстановить поток без перезагрузки страницы.
        setTimeout(connect, 2000);
      };

      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, []);

  function setViewport(vp: { x: number; y: number; width: number; height: number }): void {
    pendingViewport.current = vp;
    const now = Date.now();
    const elapsed = now - lastViewportSentAt.current;
    if (elapsed >= VIEWPORT_SEND_INTERVAL_MS) {
      flushViewport();
      return;
    }
    if (flushTimer.current === null) {
      flushTimer.current = window.setTimeout(() => {
        flushTimer.current = null;
        flushViewport();
      }, VIEWPORT_SEND_INTERVAL_MS - elapsed);
    }
  }

  function flushViewport(): void {
    const vp = pendingViewport.current;
    const socket = wsRef.current;
    if (!vp || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "viewport", ...vp }));
    lastViewportSentAt.current = Date.now();
    pendingViewport.current = null;
  }

  return { store: storeRef.current, status, tick, phase, errorMessage, setViewport };
}
