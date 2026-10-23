import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { createWorkflowOperations } from '../../../../packages/personal-planner-core/workflow-operations.mjs';
import {
  revision,
  PlannerError,
  PlannerProfile,
  PlannerSnapshot,
} from '../../../../packages/personal-planner-core/operations.mjs';
import {
  NativeWorkflowAction,
  WorkflowSnapshot,
} from '../../../../packages/personal-planner-core/workflow.mjs';
import {
  migrateProfile,
  emptyProfile,
} from '../../../../packages/personal-planner-core/model.mjs';
import {
  availability,
  localDay,
  addDays,
} from '../../../../packages/personal-planner-core/schedule.mjs';
import { TaskService } from '../../features/tasks/task.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { selectAllProjects } from '../../features/project/store/project.selectors';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { addSubTask } from '../../features/tasks/store/task.actions';
import { PlannerActions } from '../../features/planner/store/planner.actions';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { PluginUserPersistenceService } from '../plugin-user-persistence.service';
import { composeId } from '../util/plugin-persistence-key.util';
import { flushPluginWrites } from '../plugin-persistence-api';
import { selectPluginUserDataFeatureState } from '../store/plugin-user-data.reducer';
import { PlannerCalendarService } from './planner-calendar.service';
import { WorkflowIntegrationService } from './workflow-integration.service';

const OWNER = 'personal-planner';
const structuralTask = (task: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    [
      'id',
      'title',
      'projectId',
      'tagIds',
      'parentId',
      'subTaskIds',
      'isDone',
      'dueDay',
      'dueWithTime',
      'remindAt',
      'timeEstimate',
      'deadlineDay',
      'deadlineWithTime',
      'issueId',
      'issueProviderId',
      'issueType',
    ].map((k) => [k, task[k]]),
  );

/** Native state owns tasks/time; this service coordinates optional synced workflow metadata. */
@Injectable({ providedIn: 'root' })
export class PlannerWorkflowService {
  private readonly _store = inject(Store);
  private readonly _tasks = this._store.selectSignal(selectTaskFeatureState);
  private readonly _projects = this._store.selectSignal(selectAllProjects);
  private readonly _data = this._store.selectSignal(selectPluginUserDataFeatureState);
  private readonly _persistence = inject(PluginUserPersistenceService);
  private readonly _taskService = inject(TaskService);
  private readonly _config = inject(GlobalConfigService);
  private readonly _hydration = inject(HydrationStateService);
  private readonly _capture = inject(OperationCaptureService);
  private readonly _archive = inject(ArchiveStoreService);
  private readonly _calendar = inject(PlannerCalendarService);
  private readonly _injector = inject(Injector);
  private _chain: Promise<unknown> = Promise.resolve();

  private _ready(): void {
    if (this._hydration.isApplyingRemoteOps() || this._archive.mutationPending)
      throw new PlannerError('APP_BUSY', 'La sincronización está aplicando cambios.');
    if (this._capture.hasUnrecoveredPersistFailure())
      throw new PlannerError(
        'PERSIST_DEGRADED',
        'Hay escrituras pendientes de confirmar.',
      );
  }
  private _structural(): string {
    return JSON.stringify({
      tasks: Object.values(this._tasks().entities)
        .filter((t) => !!t)
        .map((t) => structuralTask(t as unknown as Record<string, unknown>))
        .sort((a, b) => String(a['id']).localeCompare(String(b['id']))),
      currentTaskId: this._tasks().currentTaskId,
      projects: this._projects().map((p) => ({
        id: p.id,
        title: p.title,
        isArchived: p.isArchived,
      })),
      profile: this._data().find((v) => v.id === composeId(OWNER, 'profile-v1'))?.data,
      archive: this._archive.mutationVersion,
      autoMarkParentDone: !!this._config.cfg()?.tasks?.isAutoMarkParentAsDone,
    });
  }
  private _times(): string {
    return JSON.stringify(
      Object.values(this._tasks().entities)
        .filter((t) => !!t)
        .map((t) => [t!.id, t!.timeSpent])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  }

  run(
    action: string,
    params: Record<string, unknown>,
    authorize: (action: string) => Promise<void>,
    snapshotProvider: (profile: PlannerProfile) => Promise<PlannerSnapshot>,
  ): Promise<Record<string, unknown>> {
    let expectedStructure: string | undefined;
    const fence = (): void => {
      this._ready();
      if (expectedStructure !== undefined && this._structural() !== expectedStructure)
        throw new PlannerError(
          'STALE_DATA',
          'Las tareas cambiaron durante la operación.',
        );
    };
    const didMutate = (): void => {
      expectedStructure = this._structural();
    };
    const api = createWorkflowOperations({
      read: (key) => this._persistence.loadPluginUserData(composeId(OWNER, key)),
      cas: (key, expected, next, guard, required) =>
        this._persistence.compareAndSwapPluginUserData(
          composeId(OWNER, key),
          expected,
          next,
          () => authorize(required ?? action),
          guard,
        ),
      authorize,
      ready: fence,
      snapshot: async (options) => {
        const snapshot = await this._snapshot(options, snapshotProvider);
        expectedStructure = this._structural();
        return snapshot;
      },
      native: (native, before) => this._native(native, before, fence, didMutate),
      integrations: (taskId, check) =>
        this._injector
          .get(WorkflowIntegrationService)
          .query(taskId as string | undefined, check),
      integrationCommand: async (command, options) => {
        const result = await this._injector
          .get(WorkflowIntegrationService)
          .execute(command, { ...options, atMutation: fence, didMutate });
        await flushPluginWrites(this._injector);
        return result;
      },
    });
    if (action === 'workflow_query') return api.query(params);
    const next = this._chain.catch(() => undefined).then(() => api.command(params));
    this._chain = next;
    return next;
  }

  private async _snapshot(
    options: Record<string, unknown>,
    provider: (profile: PlannerProfile) => Promise<PlannerSnapshot>,
  ): Promise<
    WorkflowSnapshot & {
      nativeRevision: string;
      weekRevision: string;
      assertCurrent: () => void;
    }
  > {
    this._ready();
    const raw = await this._persistence.loadPluginUserData(
      composeId(OWNER, 'profile-v1'),
    );
    const profile = (
      raw === null ? emptyProfile() : migrateProfile(JSON.parse(raw))
    ) as PlannerProfile;
    const native = await provider(profile),
      structure = this._structural(),
      times = this._times(),
      calendar = this._calendar.fingerprint();
    const plannedDay = native['plannedDay'] as
      | ((
          task: typeof native.byId extends Map<string, infer V> ? V : never,
        ) => string | null)
      | undefined;
    const tasks = [...native.byId.values()].map((t) => ({
      ...t,
      title: t.title ?? '',
      dueDay: plannedDay?.(t) ?? (t['dueDay'] as string | undefined),
      deadlineDay:
        typeof t['deadlineWithTime'] === 'number'
          ? localDay(t['deadlineWithTime'], profile.timezone)
          : t['deadlineDay'],
    }));
    const today = localDay(Date.now(), profile.timezone);
    const validDay = (value: unknown): value is string =>
      typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
      new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
    const assignments = options['assignments'];
    if (
      assignments !== undefined &&
      (!Array.isArray(assignments) ||
        assignments.length > 500 ||
        assignments.some((row) => !row || typeof row !== 'object' || !validDay(row.date)))
    )
      throw new PlannerError('INVALID_ARGUMENTS', 'Fechas de asignación inválidas.');
    const dates = Array.isArray(assignments)
      ? assignments.map((row) => row.date as string).sort()
      : [];
    const from = options['from'] ?? options['date'] ?? dates[0] ?? today;
    if (!validDay(from))
      throw new PlannerError('INVALID_ARGUMENTS', 'Fecha de consulta inválida.');
    const to =
      options['to'] ?? (dates.length ? dates[dates.length - 1] : addDays(from, 6));
    if (!validDay(to))
      throw new PlannerError('INVALID_ARGUMENTS', 'Fecha final inválida.');
    const capacityByDay: Record<
      string,
      {
        workMinutes: number;
        personalMinutes: number;
        partial: boolean;
        warnings: string[];
      }
    > = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      const count =
        (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000;
      if (!Number.isFinite(count) || count < 0 || count > 92)
        throw new PlannerError('INVALID_ARGUMENTS', 'Rango de fechas inválido.');
      for (let i = 0; i <= count; i++) {
        const date = addDays(from, i),
          available = availability(profile, date, native);
        capacityByDay[date] = {
          workMinutes: available.workMinutes,
          personalMinutes: available.personalMinutes,
          partial: available.partial,
          warnings: available.warnings,
        };
      }
    }
    const scopeByTask: Record<string, 'work' | 'personal'> = Object.fromEntries(
      tasks.map((task) => [
        task.id,
        profile.areas.some((area) => area.workTime && native.matches(task, area))
          ? 'work'
          : 'personal',
      ]),
    );
    const assertCurrent = (): void => {
      this._ready();
      if (
        this._structural() !== structure ||
        (options['command'] === 'week.apply' &&
          (this._times() !== times || this._calendar.fingerprint() !== calendar))
      )
        throw new PlannerError('STALE_DATA', 'Las tareas o la disponibilidad cambiaron.');
    };
    const nativeRevision = await revision(structure),
      weekRevision = await revision({ structure, times, calendar });
    assertCurrent();
    return {
      tasks,
      projects: this._projects().map((p) => ({
        id: p.id,
        title: p.title,
        isArchived: p.isArchived,
      })),
      currentTaskId: this._tasks().currentTaskId,
      scopeByTask,
      capacityByDay,
      today,
      autoMarkParentDone: !!native['autoMarkParentDone'],
      nativeRevision,
      weekRevision,
      assertCurrent,
    };
  }

  private async _native(
    action: NativeWorkflowAction,
    before: () => Promise<void>,
    fence: () => void,
    didMutate: () => void,
  ): Promise<void> {
    // Reauthorize after all async work, then fence health and structural freshness
    // synchronously immediately before dispatch. Every action stays in native state.
    await before();
    fence();
    if (action.type === 'task.update') {
      const task = this._tasks().entities[action.taskId];
      if (!task) throw new PlannerError('TASK_NOT_FOUND', 'Tarea activa no encontrada.');
      if (action.fields.dueDay !== undefined)
        this._store.dispatch(
          PlannerActions.planTaskForDay({
            task,
            day: action.fields.dueDay!,
            isShowSnack: false,
          }),
        );
      if (action.fields.isDone !== undefined)
        this._taskService.update(task.id, {
          isDone: action.fields.isDone,
          ...(action.fields.isDone ? { doneOn: Date.now() } : {}),
        });
    } else {
      const { parent, children } = action;
      if (
        !this._projects().some((p) => p.id === parent.projectId && !p.isArchived) ||
        [parent, ...children].some((t) => !!this._tasks().entities[t.id])
      )
        throw new PlannerError(
          'CONFLICT',
          'Proyecto o identidad de plantilla no disponible.',
        );
      const task = this._taskService.createNewTaskWithDefaults({
        title: parent.title,
        id: parent.id,
        additional: { id: parent.id, timeEstimate: 0 },
        workContextType: WorkContextType.PROJECT,
        workContextId: parent.projectId,
      });
      this._store.dispatch(
        TaskSharedActions.addTask({
          task,
          workContextId: parent.projectId,
          workContextType: WorkContextType.PROJECT,
          isAddToBacklog: true,
          isAddToBottom: true,
          isIgnoreShortSyntax: true,
        }),
      );
      // Native creation effects assign configured defaults to zero estimates.
      // Templates explicitly own their estimates; reset before first-child inheritance.
      this._taskService.update(parent.id, { timeEstimate: 0 });
      for (const child of children) {
        const subTask = this._taskService.createNewTaskWithDefaults({
          title: child.title,
          id: child.id,
          additional: { timeEstimate: child.timeEstimate },
          workContextType: WorkContextType.PROJECT,
          workContextId: parent.projectId,
        });
        this._store.dispatch(
          addSubTask({ task: subTask, parentId: parent.id, isIgnoreShortSyntax: true }),
        );
        this._taskService.update(child.id, { timeEstimate: child.timeEstimate });
      }
    }
    didMutate();
    await flushPluginWrites(this._injector);
  }
}
