export { getWorldConstants, resetWorldConstantsCache } from "./constants.js";
export type { WorldConstants } from "./constants.js";

export { buildZoneLayout, zoneAt, feedingZoneNames, resetZoneLayoutCache } from "./zones.js";
export type { Zone, ZoneName, ZoneType } from "./zones.js";
export {
  isLandSim,
  mediumAtSim,
  ecoZoneAtSim,
  ecoZoneCenterSim,
  isLandMap,
  toMap,
  toSim,
} from "./landMask.js";


export { FishField } from "./fish.js";

export { DayNightCycle, perceptionRadius } from "./dayNight.js";
export type { Phase, Species } from "./dayNight.js";

export { baseSpeed, speedForAgeStage, stepAndReflect } from "./movement.js";
export type { Vector2, Bounds, Medium, AgeStage } from "./movement.js";

export { SpatialGrid } from "./spatialIndex.js";
export type { IndexedPoint } from "./spatialIndex.js";

export { World } from "./world.js";
