import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export interface WorkspaceDraftContext {
  section: string;
  projectId?: string;
  taskId?: string;
}
export interface WorkspaceDraftState {
  dirty: boolean;
  workflowDirty?: boolean;
  workflowContext?: WorkspaceDraftContext;
}

/** Presentation drafts belong to the mounted plugin, never native task persistence. */
@Injectable({ providedIn: 'root' })
export class WorkspaceDraftService {
  private readonly _translate = inject(TranslateService);
  private _dirty = false;
  private _workflowState?: WorkspaceDraftState;
  private _discard?: (scope: 'workflow' | 'all') => void;

  bind(discard: (scope: 'workflow' | 'all') => void): void {
    this._discard = discard;
  }
  setDirty(dirty: boolean): void {
    this._dirty = dirty;
  }
  setState(state: WorkspaceDraftState): void {
    this._dirty = state.dirty;
    this._workflowState = state;
  }
  canNavigate(next: WorkspaceDraftContext): boolean {
    const state = this._workflowState;
    const prior = state?.workflowContext;
    const workflowSections = [
      'workflow',
      'templates',
      'workflow-week',
      'workflow-review',
      'integrations',
    ];
    if (!state?.workflowDirty || !workflowSections.includes(next.section)) {
      return true;
    }
    if (
      prior &&
      prior.section === next.section &&
      (prior.projectId || '') === (next.projectId || '') &&
      (!next.taskId || prior.taskId === next.taskId)
    ) {
      return true;
    }
    return this.canLeave('workflow');
  }
  clear(): void {
    this._dirty = false;
    this._workflowState = undefined;
    this._discard = undefined;
  }

  canLeave(scope: 'workflow' | 'all' = 'all'): boolean {
    if (!this._dirty) {
      return true;
    }
    if (!window.confirm(this._translate.instant('AW.DISCARD_DRAFT'))) {
      return false;
    }
    this._discard?.(scope);
    if (scope === 'all') {
      this._dirty = false;
      this._workflowState = undefined;
    } else if (this._workflowState) {
      this._workflowState = { ...this._workflowState, workflowDirty: false };
    }
    return true;
  }
}
