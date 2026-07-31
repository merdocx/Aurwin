import { getWorldConstants } from "./constants.js";
import { buildZoneLayout, zoneAt, type Zone } from "./zones.js";
import { FishField } from "./fish.js";
import { DayNightCycle, perceptionRadius, type Species } from "./dayNight.js";

/**
 * Мир Aurwin (ТЗ, раздел 6.2 и Приложение А.10): карта, зоны, рыба,
 * суточный цикл. Существа и их поведение (фаза 4) строятся поверх этого
 * состояния, но сами по себе в мир не входят — World описывает только
 * среду, а не популяцию.
 */
export class World {
  readonly width: number;
  readonly height: number;
  readonly zones: Zone[];
  readonly fish: FishField;
  readonly dayNight: DayNightCycle;

  constructor() {
    const constants = getWorldConstants();
    this.width = constants.world.map.width;
    this.height = constants.world.map.height;
    this.zones = buildZoneLayout();
    this.fish = new FishField();
    this.dayNight = new DayNightCycle();
  }

  zoneAt(x: number, y: number): Zone {
    return zoneAt(x, y);
  }

  perceptionRadiusFor(species: Species, isAsleep: boolean): number {
    return perceptionRadius(species, this.dayNight.phase(), isAsleep);
  }

  /** Один тик мира: суточный цикл вперёд, респавн/истощение рыбы. Движение и жизнь существ — вне World (фаза 4). */
  tick(): void {
    this.dayNight.tick();
    this.fish.tick();
  }

  /**
   * Восстановление после рестарта sim-engine (фаза 5, ops/DEVIATIONS.md):
   * переносит суточный цикл на уже прожитый тик мира, чтобы день/ночь не
   * дёргались обратно к тику 0 при каждом рестарте процесса. Плотность
   * рыбы НЕ восстанавливается (не персистентится — известный, осознанный
   * пробел, см. ops/DEVIATIONS.md): она заново сходится к своему профилю
   * за счёт обычного респавна, это не влияет на корректность, только на
   * несколько первых минут доступности корма после рестарта.
   */
  fastForwardTo(tick: number): void {
    this.dayNight.fastForwardTo(tick);
  }
}
