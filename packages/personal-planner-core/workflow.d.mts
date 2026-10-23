export type WorkflowColumn = 'inbox' | 'ready' | 'in_progress' | 'blocked' | 'done';
export type WorkflowPriority = 'low' | 'normal' | 'high' | 'urgent';
export interface WorkflowCriterion {
  id: string;
  text: string;
  isDone: boolean;
}
export interface WorkflowLink {
  provider: 'jira' | 'trello';
  externalId: string;
  url: string;
}
export interface WorkflowMetadata {
  column?: WorkflowColumn;
  columnId?: string;
  columnProjectId?: string;
  dependsOn?: string[];
  blockReason?: string;
  reviewOn?: string;
  reviewedOn?: string;
  criteria?: WorkflowCriterion[];
  priority?: WorkflowPriority;
  links?: WorkflowLink[];
}
export interface WorkflowTemplate {
  id: string;
  title: string;
  steps: { title: string; timeEstimate: number }[];
  criteria: WorkflowCriterion[];
}
export interface WorkflowBoardColumn {
  id: string;
  title: string;
  status: WorkflowColumn;
}
export interface WorkflowProjectBoard {
  columns: WorkflowBoardColumn[];
  wipLimit: number;
}
export interface WorkflowState {
  schemaVersion: 1;
  projectBoards?: Record<string, WorkflowProjectBoard>;
  wipLimit: number;
  tasks: Record<string, WorkflowMetadata>;
  templates: Record<string, WorkflowTemplate>;
}
export interface WorkflowTask {
  id: string;
  title: string;
  isDone?: boolean;
  projectId?: string | null;
  parentId?: string | null;
  subTaskIds?: string[];
  archived?: boolean;
  isArchived?: boolean;
  timeEstimate?: number;
  timeSpent?: number;
  dueDay?: string | null;
  deadlineDay?: string | null;
}
export interface WorkflowSnapshot {
  autoMarkParentDone?: boolean;
  tasks?: WorkflowTask[];
  byId?: Map<string, WorkflowTask>;
  projects?: { id: string; title?: string; isArchived?: boolean }[];
  currentTaskId?: string | null;
  scopeByTask?: Record<string, 'work' | 'personal'>;
  capacityByDay?: Record<
    string,
    {
      workMinutes: number;
      personalMinutes: number;
      partial?: boolean;
      warnings?: string[];
    }
  >;
  today?: string;
  plannedDay?: (task: WorkflowTask) => string | null;
}
export interface WorkflowBlocker {
  taskId?: string;
  reason: 'manual' | 'missing' | 'archived' | 'incomplete' | 'cycle';
  message?: string;
}
export interface WorkflowCard {
  taskId: string;
  title: string;
  projectId: string | null;
  parentId: string | null;
  isDone: boolean;
  timeEstimate: number;
  timeSpent: number;
  dueDay: string | null;
  deadlineDay: string | null;
  column: WorkflowColumn;
  columnId: string;
  dependsOn: string[];
  blockers: WorkflowBlocker[];
  criteria: WorkflowCriterion[];
  priority: WorkflowPriority;
  links: WorkflowLink[];
  blockReason: string | null;
  reviewOn: string | null;
  reviewedOn: string | null;
}
export interface WorkflowQuery {
  view?: 'board' | 'week' | 'review' | 'templates';
  projectId?: string;
  date?: string;
  from?: string;
  to?: string;
  taskIds?: string[];
  limit?: number;
  includeSubtasks?: boolean;
}
export interface WorkflowIssue {
  taskId?: string;
  code: string;
}
export interface WorkflowCapacity {
  capacityMinutes: number;
  plannedMinutes: number;
  remainingMinutes: number;
}
export interface WorkflowDay {
  date: string;
  work: WorkflowCapacity;
  personal: WorkflowCapacity;
  partial: boolean;
  warnings: string[];
}
export interface WorkflowAssignment {
  taskId: string;
  date: string;
}
export interface WorkflowView {
  view: 'board' | 'week' | 'review' | 'templates';
  cards: WorkflowCard[];
  columns: (WorkflowBoardColumn & {
    cards: WorkflowCard[];
    taskCount: number;
    fallback?: true;
  })[];
  wip: { count: number; limit: number; overLimit: boolean };
  issues: WorkflowIssue[];
  templates: WorkflowTemplate[];
  from?: string;
  to?: string;
  days?: WorkflowDay[];
  proposal?: {
    assignments: WorkflowAssignment[];
    partial: boolean;
    excluded: WorkflowIssue[];
  };
}
export type WorkflowCommand =
  | {
      type: 'task.move';
      payload: { taskId: string; column: WorkflowColumn; columnId?: string };
    }
  | { type: 'task.dependencies'; payload: { taskId: string; dependsOn: string[] } }
  | { type: 'task.block'; payload: { taskId: string; reason: string; reviewOn?: string } }
  | { type: 'task.unblock'; payload: { taskId: string } }
  | { type: 'task.criteria'; payload: { taskId: string; criteria: WorkflowCriterion[] } }
  | { type: 'task.priority'; payload: { taskId: string; priority: WorkflowPriority } }
  | { type: 'task.review'; payload: { taskId: string; date: string } }
  | {
      type: 'task.link';
      payload: {
        taskId: string;
        provider: 'jira' | 'trello';
        externalId: string;
        url: string;
      };
    }
  | {
      type: 'task.unlink';
      payload: { taskId: string; provider: 'jira' | 'trello'; url: string };
    }
  | { type: 'board.configure'; payload: { wipLimit: number; projectId?: string } }
  | {
      type: 'board.column.save';
      payload: { projectId: string; column: WorkflowBoardColumn };
    }
  | { type: 'board.column.reorder'; payload: { projectId: string; columnIds: string[] } }
  | {
      type: 'board.column.remove';
      payload: { projectId: string; columnId: string; targetColumnId?: string };
    }
  | { type: 'template.save'; payload: { template: WorkflowTemplate } }
  | { type: 'template.remove'; payload: { templateId: string } }
  | {
      type: 'template.apply';
      payload: { templateId: string; projectId: string; title?: string };
    }
  | {
      type: 'week.apply';
      payload: {
        assignments: WorkflowAssignment[];
        weekRevision: string;
        allowPartial?: boolean;
      };
    };
export type WorkflowNativeAction =
  | { type: 'task.update'; taskId: string; fields: { isDone?: boolean; dueDay?: string } }
  | {
      type: 'template.create';
      parent: { id: string; title: string; projectId: string };
      children: { id: string; title: string; timeEstimate: number }[];
    };
export type NativeWorkflowAction = WorkflowNativeAction;
export interface WorkflowResult {
  state: WorkflowState;
  nativeActions: WorkflowNativeAction[];
  result?: { parentId: string; taskIds: string[] };
}
export class WorkflowError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>);
}
export function emptyWorkflow(): WorkflowState;
export function validateWorkflow(state: unknown): WorkflowState;
export function workflowView(
  state: unknown,
  snapshot: WorkflowSnapshot,
  options?: WorkflowQuery,
): WorkflowView;
export function workflowBlockedTaskIds(
  state: unknown,
  snapshot: WorkflowSnapshot,
): string[];
export function applyWorkflowCommand(
  state: unknown,
  command: WorkflowCommand,
  snapshot: WorkflowSnapshot,
  options: { operationId: string; now?: number | string },
): WorkflowResult;
