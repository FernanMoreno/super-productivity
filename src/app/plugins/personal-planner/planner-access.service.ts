import { Injectable } from '@angular/core';
import { AssistantAccessScope } from '../../../../electron/shared-with-frontend/assistant-access.model';
import { PlannerError } from '../../../../packages/personal-planner-core/operations.mjs';

export const PLANNER_SCOPES: Record<string, readonly AssistantAccessScope[]> = {
  activities: ['planner:read'],
  operation_status: ['planner:read'],
  schedule: [
    'planner:read',
    'planner:write',
    'tasks:read',
    'tasks:read_history',
    'tasks:write',
  ],
  query: ['planner:read', 'tasks:read', 'tasks:read_history'],
  prepare: ['planner:read', 'tasks:read', 'tasks:read_history'],
  edit: ['planner:read', 'planner:write'],
  task: ['tasks:read', 'tasks:write'],
  log_time: ['planner:read', 'tasks:read', 'tasks:read_history', 'time:write'],
  apply: ['planner:read', 'tasks:read', 'tasks:read_history', 'planner:write'],
};

/** Device-local grants are owned by Electron main, never by synced profile data. */
@Injectable({ providedIn: 'root' })
export class PlannerAccessService {
  async authorize(action: string): Promise<void> {
    const required = PLANNER_SCOPES[action];
    const state = await window.ea?.getAssistantAccessState?.();
    if (
      !required ||
      !state?.isEnabled ||
      !required.every((scope) => state.scopes.includes(scope))
    ) {
      throw new PlannerError(
        'NOT_PERMITTED',
        'Permisos del asistente ausentes o revocados.',
      );
    }
  }
}
