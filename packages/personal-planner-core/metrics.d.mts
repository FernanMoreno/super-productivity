import { PlannerSnapshot, PlannerTask } from './operations.mjs';
export function taskSnapshot(active: object[], archived: object[]): PlannerSnapshot;

export function effectiveArea(
  profile: import('./operations.mjs').PlannerProfile,
  area: import('./operations.mjs').PlannerArea,
): import('./operations.mjs').PlannerArea;
