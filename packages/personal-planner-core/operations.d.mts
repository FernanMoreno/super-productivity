export interface PlannerArea {
  id: string;
  name: string;
  projectIds: string[];
  tagIds: string[];
  workTime?: boolean;
  [key: string]: unknown;
}
export interface PlannerProfile {
  schemaVersion: number;
  timezone: string;
  weekStartsOn: number;
  areas: PlannerArea[];
  commitments: Record<string, unknown>[];
  [key: string]: unknown;
}
export interface PlannerTask {
  id: string;
  title?: string;
  projectId?: string;
  tagIds?: string[];
  parentId?: string;
  subTaskIds?: string[];
  timeSpent?: number;
  timeSpentOnDay?: Record<string, number>;
  [key: string]: unknown;
}
export interface PlannerSnapshot {
  byId: Map<string, PlannerTask>;
  leaves: PlannerTask[];
  matches(task: PlannerTask, area: PlannerArea): boolean;
  civilDaysReliable?: boolean;
  assertCurrent?: () => void;
  [key: string]: unknown;
}
export interface PlannerPorts {
  read(key: string): Promise<string | null>;
  cas(
    key: string,
    expected: string | null,
    next: string,
    atDispatch?: () => void,
    action?: string,
  ): Promise<boolean>;
  snapshot(profile: PlannerProfile): Promise<PlannerSnapshot>;
  authorize?(action: string): Promise<void>;
  native?(
    action: string,
    args: Record<string, unknown>,
    profile: PlannerProfile,
  ): Promise<Record<string, unknown>>;
}
export interface PlannerOperations {
  operationStatus(args: {
    action: 'edit' | 'task' | 'log_time' | 'apply' | 'review_advance' | 'correct_time';
    operationId: string;
  }): Promise<Record<string, unknown>>;
  activities(): Promise<{ profile: PlannerProfile; revision: string }>;
  edit(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  task(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  logTime(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  query(args: { from: string; to: string }): Promise<Record<string, unknown>>;
  prepare(args: { from: string; to: string }): Promise<Record<string, unknown>>;
  apply(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  adjustProposal(args: {
    proposalId: string;
    changes: Array<{ itemId: string; start: number; end?: number }>;
  }): Promise<Record<string, unknown>>;
  history(args?: {
    historyId?: string;
    limit?: number;
  }): Promise<Record<string, unknown>>;
  prepareUndo(args: {
    historyId: string;
    selection?: string[];
  }): Promise<Record<string, unknown>>;
  next(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  review(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  reviewAdvance(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  correctTime(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  captureBaseline(args: { from: string; to: string }): Promise<Record<string, unknown>>;
  contextRevision(): Promise<string>;
}
export class PlannerError extends Error {
  code: string;
  constructor(code: string, message: string);
}
export function createPlannerOperations(ports: PlannerPorts): PlannerOperations;
export function contextRevision(
  profile: PlannerProfile,
  snapshot: PlannerSnapshot,
): Promise<string>;
export function revision(value: unknown): Promise<string>;
export function range(from: string, to: string): string[];
