import { Injectable, inject, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  PlannerError,
  PlannerProfile,
} from '../../../../packages/personal-planner-core/operations.mjs';
import {
  taskSnapshot,
  effectiveArea,
} from '../../../../packages/personal-planner-core/metrics.mjs';
import { TaskService } from '../../features/tasks/task.service';
import { TaskMoveToProjectService } from '../../features/tasks/task-move-to-project.service';
import { Task, TaskState } from '../../features/tasks/task.model';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { ProjectService } from '../../features/project/project.service';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TagService } from '../../features/tag/tag.service';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { DateService } from '../../core/date/date.service';
import { parseTimeSpentBody } from '../../core/electron/local-rest-api-task-time';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { flushPluginWrites } from '../plugin-persistence-api';
import { PlannerAccessService } from './planner-access.service';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const ensure = (ok: unknown, message: string): void => {
  if (!ok) throw new PlannerError('INVALID_ARGUMENTS', message);
};

/** Native task/tracking commands. No planner-owned copy of tasks or time data. */
@Injectable({ providedIn: 'root' })
export class PlannerNativeService {
  private readonly _store = inject(Store);
  private readonly _tasks = this._store.selectSignal(selectTaskFeatureState);
  private readonly _taskService = inject(TaskService);
  private readonly _move = inject(TaskMoveToProjectService);
  private readonly _projects = inject(ProjectService);
  private readonly _tags = inject(TagService);
  private readonly _date = inject(DateService);
  private readonly _config = inject(GlobalConfigService);
  private readonly _hydration = inject(HydrationStateService);
  private readonly _capture = inject(OperationCaptureService);
  private readonly _access = inject(PlannerAccessService);
  private readonly _injector = inject(Injector);

  private _ready(): void {
    if (this._hydration.isApplyingRemoteOps())
      throw new PlannerError(
        'APP_BUSY',
        'Se están aplicando cambios sincronizados. Reintenta después.',
      );
    if (this._capture.hasUnrecoveredPersistFailure())
      throw new PlannerError(
        'PERSIST_DEGRADED',
        'Hay escrituras sin confirmar; revisa la aplicación antes de continuar.',
      );
  }
  private _task(id: unknown, state: TaskState = this._tasks()): Task {
    const task =
      typeof id === 'string'
        ? Object.values(state.entities).find((t) => t?.id === id)
        : undefined;
    ensure(task, 'Tarea activa no encontrada.');
    return task!;
  }
  private _fields(input: unknown): Partial<Task> {
    ensure(object(input), 'Campos de tarea inválidos.');
    const fields = input as Record<string, unknown>;
    ensure(
      Object.keys(fields).length &&
        Object.keys(fields).every((key) =>
          ['title', 'isDone', 'timeEstimate', 'projectId', 'tagIds', 'dueDay'].includes(
            key,
          ),
        ),
      'Campo de tarea no soportado.',
    );
    if ('title' in fields)
      ensure(
        typeof fields['title'] === 'string' &&
          !!fields['title'].trim() &&
          fields['title'].length <= 500,
        'Título inválido.',
      );
    if ('isDone' in fields)
      ensure(typeof fields['isDone'] === 'boolean', 'Estado de tarea inválido.');
    if ('timeEstimate' in fields)
      ensure(
        typeof fields['timeEstimate'] === 'number' &&
          Number.isSafeInteger(fields['timeEstimate']) &&
          fields['timeEstimate'] >= 0 &&
          fields['timeEstimate'] <= 365 * 86400000,
        'Estimación inválida.',
      );
    if ('projectId' in fields)
      ensure(
        typeof fields['projectId'] === 'string' &&
          this._projects
            .list()
            .some((p) => p.id === fields['projectId'] && !p.isArchived),
        'Proyecto no disponible.',
      );
    if ('tagIds' in fields)
      ensure(
        Array.isArray(fields['tagIds']) &&
          fields['tagIds'].length <= 200 &&
          new Set(fields['tagIds']).size === fields['tagIds'].length &&
          fields['tagIds'].every(
            (id) =>
              typeof id === 'string' &&
              id !== 'TODAY' &&
              this._tags.tags().some((t) => t.id === id),
          ),
        'Etiqueta no disponible.',
      );
    if ('dueDay' in fields && fields['dueDay'] !== null) {
      const value = fields['dueDay'];
      ensure(
        typeof value === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
          new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value,
        'Fecha prevista inválida.',
      );
    }
    return { ...fields } as Partial<Task>;
  }

  async execute(
    action: string,
    args: Record<string, unknown>,
    profile: PlannerProfile,
  ): Promise<Record<string, unknown>> {
    await this._access.authorize(action);
    this._ready();
    if (action === 'log_time') return this._logTime(args, profile);
    ensure(action === 'task', 'Acción nativa no soportada.');
    const fields = this._fields(args['fields']);
    const original =
      args['taskId'] === undefined ? undefined : this._task(args['taskId']);
    if (!original)
      ensure(
        typeof fields.title === 'string' && !!fields.title.trim(),
        'Crear una tarea requiere título.',
      );
    if (original?.parentId && fields.projectId && fields.projectId !== original.projectId)
      throw new PlannerError(
        'INVALID_ARGUMENTS',
        'Mueve la tarea superior para cambiar de proyecto.',
      );
    if (
      original?.repeatCfgId &&
      fields.projectId &&
      fields.projectId !== original.projectId
    )
      throw new PlannerError(
        'UNSUPPORTED_OPERATION',
        'La serie recurrente debe modificarse desde la interfaz; MCP no dispone de alcance fechado para mover una serie.',
      );
    if (original?.dueWithTime && Object.hasOwn(fields, 'dueDay'))
      throw new PlannerError(
        'UNSUPPORTED_OPERATION',
        'Las tareas con hora deben reprogramarse desde el calendario nativo; cambiar solo la fecha sin hora no modifica su horario.',
      );
    await this._access.authorize(action);
    this._ready();
    this._fields(args['fields']);
    if (original && this._task(original.id) !== original)
      throw new PlannerError('STALE_DATA', 'La tarea cambió; revisa antes de guardar.');
    let taskId: string;
    // From the first native dispatch onwards the outcome is uncertain on error.
    // The durable pending journal prevents retries from running these actions twice.
    try {
      if (!original) {
        const projectId = fields.projectId || INBOX_PROJECT.id;
        const task = this._taskService.createNewTaskWithDefaults({
          title: fields.title!,
          additional: {
            ...fields,
            timeEstimate:
              fields.timeEstimate ??
              this._config.cfg()?.timeTracking.defaultEstimate ??
              0,
          },
          workContextType: WorkContextType.PROJECT,
          workContextId: projectId,
        });
        taskId = task.id;
        this._store.dispatch(
          TaskSharedActions.addTask({
            task,
            workContextId: projectId,
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: false,
            isIgnoreShortSyntax: true,
          }),
        );
      } else {
        taskId = original.id;
        const { projectId, ...updates } = fields;
        if (projectId && projectId !== original.projectId) {
          const state = this._tasks();
          const subTasks = original.subTaskIds
            .map((id) => state.entities[id])
            .filter((t): t is Task => !!t);
          await this._move.moveToProject({ ...original, subTasks }, projectId, {
            isSkipConfirm: true,
          });
        }
        if (original.isDone && updates.isDone === true) delete updates.isDone;
        if (Object.keys(updates).length) {
          // The native REST path uses this same title-only exception. Mixed
          // updates do not trigger short syntax and retain TaskService invariants.
          if (Object.keys(updates).length === 1 && Object.hasOwn(updates, 'title')) {
            this._store.dispatch(
              TaskSharedActions.updateTask({
                task: { id: taskId, changes: updates },
                isIgnoreShortSyntax: true,
              }),
            );
          } else {
            this._taskService.update(taskId, updates);
          }
        }
      }
      await flushPluginWrites(this._injector);
      return { status: 'applied', taskId };
    } catch {
      return {
        status: 'uncertain',
        code: 'OUTCOME_UNKNOWN',
        message:
          'La tarea puede haberse modificado. Comprueba la aplicación; no repitas con otro operationId.',
      };
    }
  }

  private async _logTime(
    args: Record<string, unknown>,
    profile: PlannerProfile,
  ): Promise<Record<string, unknown>> {
    const misc = this._config.cfg()?.misc;
    const boundary =
      misc?.startOfNextDayTime ??
      (typeof misc?.startOfNextDay === 'number'
        ? `${String(misc.startOfNextDay).padStart(2, '0')}:00`
        : null);
    ensure(
      Intl.DateTimeFormat().resolvedOptions().timeZone === profile.timezone &&
        boundary === '00:00',
      'La zona del dispositivo y del perfil deben coincidir y el inicio del día lógico debe ser 00:00 para registrar por fecha civil.',
    );
    const task = this._task(args['taskId']);
    ensure(
      !task.subTaskIds?.length,
      'El tiempo de una tarea superior es la suma de sus subtareas; registra en una subtarea.',
    );
    const parsed = parseTimeSpentBody(
      { date: args['date'], duration: args['durationMs'] },
      this._date.todayStr(),
      'POST',
    );
    if ('error' in parsed) throw new PlannerError('INVALID_ARGUMENTS', parsed.error);
    ensure(
      (task.timeSpentOnDay?.[parsed.date] || 0) + parsed.duration <= 86400000,
      'El total registrado de un día no puede superar 24 horas.',
    );
    const area = profile.areas.find((a) => a.id === args['activityId']);
    ensure(area, 'Actividad no disponible.');
    const effective = effectiveArea(profile, area!);
    const snapshot = taskSnapshot(
      Object.values(this._tasks().entities).filter(Boolean) as Task[],
      [],
    );
    ensure(
      snapshot.matches(snapshot.byId.get(task.id)!, effective),
      'La tarea no está asociada a esa actividad.',
    );
    await this._access.authorize('log_time');
    this._ready();
    if (this._task(task.id) !== task)
      throw new PlannerError(
        'STALE_DATA',
        'La tarea cambió antes de registrar el tiempo.',
      );
    try {
      this._taskService.addTimeSpentAndSync(task, parsed.duration, parsed.date);
      await flushPluginWrites(this._injector);
      return {
        status: 'applied',
        taskId: task.id,
        date: parsed.date,
        durationMs: parsed.duration,
      };
    } catch {
      return {
        status: 'uncertain',
        code: 'OUTCOME_UNKNOWN',
        message:
          'El tiempo puede haberse registrado. Comprueba la aplicación; no repitas con otro operationId.',
      };
    }
  }
}
