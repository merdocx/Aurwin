/**
 * Порт /tmp/aurwin-ds/ui_kits/observatory/PanZoom.jsx — пан/зум карты жестом мыши/тача
 * с зажимом масштаба и позиции, плюс кнопки +/-/сброс в углу.
 * Пан во время drag — императивный transform (без React reconcile).
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { IconButton } from "../ds/IconButton";

export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PanZoomHandle {
  focusOn(x: number, y: number): void;
}

interface Transform {
  scale: number;
  x: number;
  y: number;
}

interface Props {
  width: number;
  height: number;
  children: ReactNode;
  maxScale?: number;
  /** Троттлится — вызывается не чаще раза в ~400мс после того как пан/зум устаканился. */
  onViewportChange?: (mapRect: MapRect) => void;
  /** Вызывается при каждом изменении масштаба (LOD карты/спрайтов). */
  onScaleChange?: (scale: number) => void;
}

const VIEWPORT_REPORT_MS = 400;

function PlusIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M5 12h14" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export const PanZoom = forwardRef<PanZoomHandle, Props>(function PanZoom({ width, height, children, maxScale = 2.5, onViewportChange, onScaleChange }, ref) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ cw: 800, ch: 500 });
  const [fitScale, setFitScale] = useState(0.42);
  const [t, setT] = useState<Transform>({ scale: 0.42, x: 40, y: 40 });
  const drag = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);
  const inited = useRef(false);
  const transTimer = useRef<number | undefined>(undefined);
  const [transitioning, setTransitioning] = useState(false);
  const reportTimer = useRef<number | undefined>(undefined);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onScaleChangeRef = useRef(onScaleChange);
  onScaleChangeRef.current = onScaleChange;
  const tRef = useRef(t);
  tRef.current = t;
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  function clampScale(s: number): number {
    return Math.max(fitScaleRef.current, Math.min(maxScale, s));
  }

  function clampXY(scale: number, x: number, y: number): { x: number; y: number } {
    const { cw, ch } = sizeRef.current;
    const cw2 = width * scale;
    const ch2 = height * scale;
    return {
      x: Math.min(0, Math.max(cw - cw2, x)),
      y: Math.min(0, Math.max(ch - ch2, y)),
    };
  }

  function applyLayer(next: Transform, commitReact: boolean): Transform {
    const scale = clampScale(next.scale);
    const xy = clampXY(scale, next.x, next.y);
    const clamped = { scale, ...xy };
    tRef.current = clamped;
    if (layerRef.current) {
      layerRef.current.style.transform = `translate(${clamped.x}px,${clamped.y}px) scale(${clamped.scale})`;
    }
    if (commitReact) {
      setT(clamped);
      onScaleChangeRef.current?.(clamped.scale);
    }
    return clamped;
  }

  useEffect(() => {
    function measure(): void {
      const el = outerRef.current;
      if (!el) return;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const fit = Math.max(cw / width, ch / height);
      setSize({ cw, ch });
      setFitScale(fit);
      if (!inited.current) {
        inited.current = true;
        applyLayer({ scale: fit, x: (cw - width * fit) / 2, y: (ch - height * fit) / 2 }, true);
      }
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (outerRef.current) ro.observe(outerRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  function scheduleViewportReport(): void {
    if (!onViewportChangeRef.current) return;
    if (reportTimer.current !== undefined) window.clearTimeout(reportTimer.current);
    reportTimer.current = window.setTimeout(() => {
      reportTimer.current = undefined;
      const prev = tRef.current;
      const s = sizeRef.current;
      onViewportChangeRef.current?.({
        x: -prev.x / prev.scale,
        y: -prev.y / prev.scale,
        width: s.cw / prev.scale,
        height: s.ch / prev.scale,
      });
    }, VIEWPORT_REPORT_MS);
  }

  function onWheel(e: WheelEvent<HTMLDivElement>): void {
    e.preventDefault();
    const rect = outerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const prev = tRef.current;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextScale = clampScale(prev.scale * factor);
    const ratio = nextScale / prev.scale;
    applyLayer({ scale: nextScale, x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio }, true);
    scheduleViewportReport();
  }

  function onDoubleClick(e: MouseEvent<HTMLDivElement>): void {
    if ((e.target as HTMLElement).closest("button, [data-no-pan]")) return;
    const rect = outerRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setTransitioning(true);
    const prev = tRef.current;
    const nextScale = clampScale(prev.scale * 1.6);
    const ratio = nextScale / prev.scale;
    applyLayer({ scale: nextScale, x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio }, true);
    window.clearTimeout(transTimer.current);
    transTimer.current = window.setTimeout(() => setTransitioning(false), 320);
    scheduleViewportReport();
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>): void {
    if ((e.target as HTMLElement).closest("button, [data-no-pan]")) return;
    const prev = tRef.current;
    drag.current = { startX: e.clientX, startY: e.clientY, tx: prev.x, ty: prev.y };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>): void {
    const d = drag.current;
    if (!d) return;
    applyLayer(
      { scale: tRef.current.scale, x: d.tx + (e.clientX - d.startX), y: d.ty + (e.clientY - d.startY) },
      false,
    );
    scheduleViewportReport();
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>): void {
    if (drag.current) applyLayer(tRef.current, true);
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function zoomBy(factor: number): void {
    setTransitioning(true);
    const prev = tRef.current;
    const nextScale = clampScale(prev.scale * factor);
    const ratio = nextScale / prev.scale;
    const cx = sizeRef.current.cw / 2;
    const cy = sizeRef.current.ch / 2;
    applyLayer({ scale: nextScale, x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio }, true);
    window.clearTimeout(transTimer.current);
    transTimer.current = window.setTimeout(() => setTransitioning(false), 320);
    scheduleViewportReport();
  }

  function reset(): void {
    setTransitioning(true);
    const fit = fitScaleRef.current;
    const s = sizeRef.current;
    applyLayer({ scale: fit, x: (s.cw - width * fit) / 2, y: (s.ch - height * fit) / 2 }, true);
    window.clearTimeout(transTimer.current);
    transTimer.current = window.setTimeout(() => setTransitioning(false), 320);
    scheduleViewportReport();
  }

  useImperativeHandle(ref, () => ({
    focusOn(x: number, y: number) {
      setTransitioning(true);
      const prev = tRef.current;
      const s = sizeRef.current;
      const nextScale = clampScale(Math.max(prev.scale, 1));
      applyLayer({ scale: nextScale, x: s.cw / 2 - x * nextScale, y: s.ch / 2 - y * nextScale }, true);
      window.clearTimeout(transTimer.current);
      transTimer.current = window.setTimeout(() => setTransitioning(false), 320);
      scheduleViewportReport();
    },
  }));

  useEffect(() => {
    scheduleViewportReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.cw, size.ch]);

  const minScale = fitScale;
  const atFit = t.scale <= minScale + 0.001;

  return (
    <div
      ref={outerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        cursor: atFit ? "default" : drag.current ? "grabbing" : "grab",
        touchAction: "none",
        background: "var(--navy-700)",
      }}
    >
      <div
        ref={layerRef}
        style={{
          // Live pan/zoom — только el.style.transform (applyLayer). React style
          // здесь сбрасывал бы карту при setState родителя во время drag.
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height,
          transformOrigin: "0 0",
          transition: transitioning ? "transform 0.32s var(--ease-standard)" : "none",
          willChange: "transform",
        }}
      >
        {children}
      </div>
      <div style={{ position: "absolute", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 6, zIndex: 5 }}>
        <IconButton label="Приблизить" onClick={() => zoomBy(1.3)}>
          <PlusIcon />
        </IconButton>
        <IconButton label="Отдалить" onClick={() => zoomBy(1 / 1.3)}>
          <MinusIcon />
        </IconButton>
        <IconButton label="Сбросить масштаб" onClick={reset}>
          <MaximizeIcon />
        </IconButton>
      </div>
    </div>
  );
});
