import { PlannerSnapshot, PlannerTask } from './operations.mjs';
export function taskSnapshot(active: object[], archived: object[]): PlannerSnapshot;

export function effectiveArea(
  profile: import('./operations.mjs').PlannerProfile,
  area: import('./operations.mjs').PlannerArea,
): import('./operations.mjs').PlannerArea;

/** Pacing aid across whole civil dates; never marks an activity completed. */
export function goalPace(
  profile: import('./operations.mjs').PlannerProfile,
  snapshot: PlannerSnapshot,
  area: import('./operations.mjs').PlannerArea,
  day: string,
  goal?: { date?: string; hours?: number },
): {
  dueDate: string | null;
  remainingMinutes: number | null;
  daysRemaining: number | null;
  requiredMinutesPerDay: number | null;
  availableMinutes: number | null;
  partial: boolean;
  warnings: string[];
  status: 'unconfigured' | 'past' | 'unknown' | 'configured';
};
