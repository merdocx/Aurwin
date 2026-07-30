import { getWorldConstants } from "./constants.js";
import { feedingZoneNames, type ZoneName } from "./zones.js";

const FISH_DENSITY_CAP = 1.0;
const FISH_DENSITY_FLOOR = 0;

/**
 * Плотность рыбы по кормовым зонам (А.10): "распределена по кормовым зонам
 * как плотность (0..1), не отдельными объектами". Респавн поднимает
 * плотность каждой зоны независимо до потолка 1.0; кормёжка расходует
 * плотность локально — в той зоне, где произошла, не затрагивая другие.
 */
export class FishField {
  private density = new Map<ZoneName, number>();

  constructor() {
    for (const zone of feedingZoneNames()) {
      this.density.set(zone, FISH_DENSITY_CAP);
    }
  }

  /** Текущая плотность зоны (без учёта ночной доступности). */
  getDensity(zone: ZoneName): number {
    return this.density.get(zone) ?? 0;
  }

  /**
   * Респавн за один тик (А.10: north_bay +0.04, south_shallows +0.015),
   * с насыщением на потолке 1.0. Респавн не замедляется ночью — ночной
   * множитель 0.6 относится только к доступности при кормёжке
   * (см. ops/DEVIATIONS.md, фаза 3, п.3).
   */
  tick(): void {
    const { fish_respawn_per_tick: respawnRates } = getWorldConstants().world;
    for (const [zone, current] of this.density) {
      const respawn = respawnRates[zone] ?? 0;
      this.density.set(zone, Math.min(FISH_DENSITY_CAP, current + respawn));
    }
  }

  /**
   * Приём пищи пингвином расходует 0.02 плотности локально (А.10). Возвращает
   * фактически потреблённое количество (может быть меньше запрошенного, если
   * зона почти истощена — плотность не уходит ниже нуля).
   */
  consume(zone: ZoneName, amount: number): number {
    const current = this.getDensity(zone);
    const consumed = Math.min(current, amount);
    this.density.set(zone, Math.max(FISH_DENSITY_FLOOR, current - consumed));
    return consumed;
  }

  /**
   * Доступность рыбы для кормёжки с учётом суточного цикла: ночью ×0.6
   * (А.10) — сама плотность (ресурс) при этом не меняется, снижается
   * только эффективно доступная для поедания доля.
   */
  availability(zone: ZoneName, isNight: boolean): number {
    const base = this.getDensity(zone);
    if (!isNight) return base;
    return base * getWorldConstants().day_night.night_fish_availability_multiplier;
  }
}
