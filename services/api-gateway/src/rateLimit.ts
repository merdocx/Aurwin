/**
 * Защита публичного API (А.6): эндпоинты открыты без авторизации.
 * In-memory лимитеры на процесс — достаточно для одного экземпляра
 * api-gateway (масштабирование на несколько инстансов — вне рамок MVP,
 * 7.5 "не жёсткое требование").
 */

/** Скользящее окно 1 минута на IP: не более N REST-запросов (А.6). */
export class RestRateLimiter {
  private readonly windows = new Map<string, { count: number; windowStart: number }>();

  constructor(private readonly limitPerMinute: number) {}

  /** true — запрос разрешён; false — превышен лимит (429). */
  tryAcquire(ip: string, now = Date.now()): boolean {
    const windowMs = 60_000;
    const entry = this.windows.get(ip);
    if (!entry || now - entry.windowStart >= windowMs) {
      this.windows.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= this.limitPerMinute) return false;
    entry.count += 1;
    return true;
  }

  /** Периодическая уборка старых записей — иначе Map растёт на каждый уникальный IP навсегда. */
  sweep(now = Date.now()): void {
    const windowMs = 60_000;
    for (const [ip, entry] of this.windows) {
      if (now - entry.windowStart >= windowMs) this.windows.delete(ip);
    }
  }
}

/**
 * Лимит одновременных WS-соединений с IP + graceful-отказ при перегрузке
 * общим числом соединений сервера, вместо падения процесса.
 */
export class WsConnectionLimiter {
  private readonly perIp = new Map<string, number>();
  private total = 0;

  constructor(
    private readonly maxPerIp: number,
    private readonly maxTotal: number,
  ) {}

  tryAcquire(ip: string): boolean {
    if (this.total >= this.maxTotal) return false;
    const current = this.perIp.get(ip) ?? 0;
    if (current >= this.maxPerIp) return false;
    this.perIp.set(ip, current + 1);
    this.total += 1;
    return true;
  }

  /** Есть ли запас по IP (без общего потолка) — для решения «вытеснить старое». */
  wouldExceedPerIp(ip: string): boolean {
    return (this.perIp.get(ip) ?? 0) >= this.maxPerIp;
  }

  isTotalFull(): boolean {
    return this.total >= this.maxTotal;
  }

  release(ip: string): void {
    const current = this.perIp.get(ip) ?? 0;
    if (current <= 0) return;
    if (current === 1) this.perIp.delete(ip);
    else this.perIp.set(ip, current - 1);
    this.total = Math.max(0, this.total - 1);
  }

  /** Диагностика для логов при отказе. */
  debugState(): string {
    const per = [...this.perIp.entries()].map(([ip, n]) => `${ip}:${n}`).join(",");
    return `total=${this.total}/${this.maxTotal} perIp=[${per}] maxPerIp=${this.maxPerIp}`;
  }
}

/** Скользящее окно 1 секунда: не более N входящих WS-сообщений от клиента (viewport spam). */
export class WsMessageRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(private readonly maxPerSecond: number) {}

  /** true — сообщение можно обработать; false — превышен лимит, игнорируем. */
  tryAcquire(now = Date.now()): boolean {
    const windowMs = 1000;
    while (this.timestamps.length > 0 && now - this.timestamps[0]! >= windowMs) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.maxPerSecond) return false;
    this.timestamps.push(now);
    return true;
  }
}
