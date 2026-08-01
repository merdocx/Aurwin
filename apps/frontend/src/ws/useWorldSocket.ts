import { useEffect, useRef, useState } from "react";
import { WorldStore } from "./WorldStore";
import type { ServerMessage } from "./types";

export type ConnectionStatus = "connecting" | "open" | "closed" | "rejected";

function resolveWsUrl(): string {
  const explicit = import.meta.env.VITE_WS_URL as string | undefined;
  if (explicit) return explicit;
  // За reverse-прокси (Caddy) WebSocket на том же origin: /ws.
  // Прямой :3000 — только для локальной разработки без прокси.
  if (window.location.port === "5173" || window.location.hostname === "localhost") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:3000/ws`;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

/** Троттлинг отправки viewport — навигация может слаться на каждый кадр пана/зума, серверу это не нужно чаще пары раз в секунду. */
const VIEWPORT_SEND_INTERVAL_MS = 400;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_REJECTED_MS = 15_000;

function reconnectDelayMs(attempt: number, rejected: boolean): number {
  if (rejected) return RECONNECT_REJECTED_MS;
  const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
  const jitter = Math.random() * exp * 0.1;
  return exp + jitter;
}

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
    let reconnectTimer: number | null = null;
    let rejected = false;
    let reconnectAttempt = 0;

    function scheduleReconnect(delayMs: number): void {
      if (cancelled) return;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delayMs);
    }

    function connect(): void {
      if (cancelled) return;
      const socket = new WebSocket(resolveWsUrl());
      ws = socket;
      wsRef.current = socket;
      setStatus("connecting");

      socket.onopen = () => {
        rejected = false;
        reconnectAttempt = 0;
        setErrorMessage(null);
        setStatus("open");
      };

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as ServerMessage;
          if (msg.type === "error") {
            // Отказ по ёмкости (А.6) — не долбим сервер каждые 2 сек.
            rejected = true;
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
        setStatus(rejected ? "rejected" : "closed");
        // Мир живёт без наблюдателя (6.1) — переподключение не критично для
        // симуляции, но наблюдателю нужно восстановить поток без перезагрузки страницы.
        const delay = reconnectDelayMs(reconnectAttempt, rejected);
        if (!rejected) reconnectAttempt += 1;
        scheduleReconnect(delay);
      };

      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
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
