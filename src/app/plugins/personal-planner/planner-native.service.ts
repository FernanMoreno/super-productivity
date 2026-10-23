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
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { TaskMoveToProjectService } from '../../features/tasks/task-move-to-project.service';
import { PlannerActions } from '../../features/planner/store/planner.actions';
import { Task, TaskState } from '../../features/tasks/task.model';
import { selectTaskFeatureState } from '../../features/tasks/store/task.selectors';
import { addSubTask } from '../../features/tasks/store/task.actions';
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
  private readonly _root = this._store.selectSignal((state) => state);
  private readonly _tasks = this._store.selectSignal(selectTaskFeatureState);
  private readonly _taskService = inject(TaskService);
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
          [
            'title',
            'isDone',
            'timeEstimate',
            'projectId',
            'tagIds',
            'dueDay',
            'dueWithTime',
          ].includes(key),
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
    ensure(
      !(Object.hasOwn(fields, 'dueDay') && Object.hasOwn(fields, 'dueWithTime')),
      'Indica fecha o fecha y hora, nunca ambas.',
    );
    if ('dueWithTime' in fields && fields['dueWithTime'] !== null)
      ensure(this._timestamp(fields['dueWithTime']), 'Fecha y hora inválidas.');
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
    authorize?: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const check = authorize ?? (() => this._access.authorize(action));
    await check();
    this._ready();
    if (action === 'log_time') return this._logTime(args, profile, check);
    if (action === 'schedule') return this._schedule(args, check);
    if (action === 'restore_schedule') return this._restoreSchedule(args, check);
    if (action === 'correct_time') return this._correctTime(args, profile, check);
    ensure(action === 'task', 'Acción nativa no soportada.');
    if (args['command'] !== undefined) return this._taskCommand(args, check);
    let fields = this._fields(args['fields']);
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
    ensure(
      args['moveScope'] === undefined ||
        ['occurrence', 'series'].includes(args['moveScope'] as string),
      'Alcance de movimiento inválido.',
    );
    if (
      original?.repeatCfgId &&
      fields.projectId &&
      fields.projectId !== original.projectId
    ) {
      ensure(args['moveScope'], 'Elige explícitamente una ocurrencia o la serie.');
    }
    if (args['moveScope'] === 'series')
      ensure(
        original?.repeatCfgId &&
          fields.projectId &&
          fields.projectId !== original.projectId,
        'El alcance serie requiere un cambio de proyecto de una tarea recurrente.',
      );
    const schedule =
      Object.hasOwn(fields, 'dueDay') || Object.hasOwn(fields, 'dueWithTime');
    if (typeof fields.dueWithTime === 'number')
      this._reminder(original, fields.dueWithTime);
    await check();
    this._ready();
    this._fields(args['fields']);
    if (original && this._task(original.id) !== original)
      throw new PlannerError('STALE_DATA', 'La tarea cambió; revisa antes de guardar.');
    // The local reducer and persisted operation must share the completion instant.
    if (fields.isDone === true && !original?.isDone)
      fields = { ...fields, doneOn: Date.now() };
    let taskId: string;
    let nativeTransitionStarted = false;
    // From the first native dispatch onwards the outcome is uncertain on error.
    // The durable pending journal prevents retries from running these actions twice.
    try {
      if (!original) {
        const projectId = fields.projectId || INBOX_PROJECT.id;
        const task = this._taskService.createNewTaskWithDefaults({
          title: fields.title!,
          additional: {
            ...Object.fromEntries(
              Object.entries(fields).filter(
                ([key]) => !['dueDay', 'dueWithTime'].includes(key),
              ),
            ),
            timeEstimate:
              fields.timeEstimate ??
              this._config.cfg()?.timeTracking.defaultEstimate ??
              0,
          },
          workContextType: WorkContextType.PROJECT,
          workContextId: projectId,
        });
        taskId = task.id;
        nativeTransitionStarted = true;
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
        delete updates.dueDay;
        delete updates.dueWithTime;
        if (projectId && projectId !== original.projectId) {
          const state = this._tasks();
          const subTasks = original.subTaskIds
            .map((id) => state.entities[id])
            .filter((t): t is Task => !!t);
          if (args['moveScope'] === 'series') {
            const archiveStore = this._injector.get(ArchiveStoreService);
            const root = this._root(),
              version = archiveStore.mutationVersion;
            const guard = (): void => {
              this._ready();
              if (
                this._root() !== root ||
                archiveStore.mutationVersion !== version ||
                archiveStore.mutationPending
              )
                throw new PlannerError('STALE_DATA', 'La serie cambió antes de moverla.');
            };
            guard();
            await this._injector
              .get(TaskMoveToProjectService)
              .moveToProject({ ...original, subTasks }, projectId, {
                isSkipConfirm: true,
                beforeMove: async (hasRepeatConfig) => {
                  ensure(hasRepeatConfig, 'La configuración recurrente ya no existe.');
                  await check();
                },
                atMove: () => {
                  guard();
                  nativeTransitionStarted = true;
                },
              });
          } else {
            nativeTransitionStarted = true;
            this._taskService.moveToProject({ ...original, subTasks }, projectId);
          }
        }
        if (original.isDone && updates.isDone === true) delete updates.isDone;
        if (Object.keys(updates).length) {
          nativeTransitionStarted = true;
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
      if (schedule) {
        const task = this._task(taskId);
        nativeTransitionStarted = true;
        this._dispatchSchedule(task, fields);
      }
      await flushPluginWrites(this._injector);
      return { status: 'applied', taskId };
    } catch (error) {
      if (!nativeTransitionStarted) {
        if (error instanceof PlannerError) throw error;
        throw new PlannerError(
          'DATA_UNAVAILABLE',
          'No se pudieron comprobar los datos antes de modificar la tarea.',
        );
      }
      return {
        status: 'uncertain',
        code: 'OUTCOME_UNKNOWN',
        message:
          'La tarea puede haberse modificado. Comprueba la aplicación; no repitas con otro operationId.',
      };
    }
  }

  private _timestamp(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value > 0 &&
      !Number.isNaN(new Date(value).getTime())
    );
  }

  private _reminder(task: Task | undefined, dueWithTime: number): number | undefined {
    if (typeof task?.remindAt !== 'number' || typeof task.dueWithTime !== 'number')
      return undefined;
    const reminder = dueWithTime - (task.dueWithTime - task.remindAt);
    ensure(this._timestamp(reminder), 'El recordatorio resultante no es válido.');
    return reminder;
  }

  private _dispatchSchedule(
    task: Task,
    fields: Partial<Task>,
    exactReminder?: { remindAt: number | undefined },
  ): void {
    if (fields.dueDay === null || fields.dueWithTime === null) {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({ id: task.id, isSkipToast: true }),
      );
    } else if (typeof fields.dueDay === 'string') {
      this._store.dispatch(
        PlannerActions.planTaskForDay({ task, day: fields.dueDay, isShowSnack: false }),
      );
    } else if (typeof fields.dueWithTime === 'number') {
      const props = {
        task,
        dueWithTime: fields.dueWithTime,
        remindAt: exactReminder
          ? exactReminder.remindAt
          : this._reminder(task, fields.dueWithTime),
        isMoveToBacklog: false,
      };
      this._store.dispatch(
        task.dueWithTime
          ? TaskSharedActions.reScheduleTaskWithTime(props)
          : TaskSharedActions.scheduleTaskWithTime(props),
      );
    }
  }

  private async _schedule(
    args: Record<string, unknown>,
    authorize: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    ensure(
      Array.isArray(args['entries']) &&
        args['entries'].length > 0 &&
        args['entries'].length <= 500,
      'Propuesta de calendario inválida.',
    );
    const entries = args['entries'] as Array<Record<string, unknown>>;
    const keys = ['dueDay', 'dueWithTime', 'remindAt', 'timeEstimate', 'timeSpent'];
    const seen = new Set<string>();
    const validate = (): Task[] =>
      entries.map((entry) => {
        ensure(
          object(entry) &&
            this._timestamp(entry['dueWithTime']) &&
            object(entry['expected']),
          'Entrada de calendario inválida.',
        );
        const task = this._task(entry['taskId']);
        ensure(
          !task.subTaskIds.length && !task.isDone,
          'Solo pueden programarse tareas pendientes sin subtareas.',
        );
        const expected = entry['expected'] as Record<string, unknown>;
        ensure(
          Object.keys(expected).length === keys.length &&
            keys.every((key) => Object.hasOwn(expected, key)),
          'Instantánea de tarea incompleta.',
        );
        if (
          !keys.every((key) =>
            Object.is((task as unknown as Record<string, unknown>)[key], expected[key]),
          )
        )
          throw new PlannerError('STALE_DATA', 'La tarea cambió desde la propuesta.');
        this._reminder(task, entry['dueWithTime'] as number);
        return task;
      });
    const tasks = validate();
    for (const task of tasks) {
      ensure(!seen.has(task.id), 'Tarea duplicada en la propuesta.');
      seen.add(task.id);
    }
    ensure(
      args['assertCurrent'] === undefined || typeof args['assertCurrent'] === 'function',
      'Contexto de propuesta inválido.',
    );
    await authorize();
    this._ready();
    const current = validate();
    if (current.some((task, index) => task !== tasks[index]))
      throw new PlannerError('STALE_DATA', 'La tarea cambió antes de aplicar.');
    (args['assertCurrent'] as (() => void) | undefined)?.();
    const taskIds = tasks.map((task) => task.id);
    try {
      tasks.forEach((task, index) =>
        this._dispatchSchedule(task, {
          dueWithTime: entries[index]['dueWithTime'] as number,
        }),
      );
      await flushPluginWrites(this._injector);
      return { status: 'applied', taskIds };
    } catch {
      return {
        status: 'uncertain',
        code: 'OUTCOME_UNKNOWN',
        taskIds,
        message:
          'El calendario puede haberse modificado. Comprueba la aplicación y consulta el recibo; no repitas con otro operationId.',
      };
    }
  }

  private _assertContext(args: Record<string, unknown>): void {
    ensure(
      args['assertCurrent'] === undefined || typeof args['assertCurrent'] === 'function',
      'Contexto nativo inválido.',
    );
    (args['assertCurrent'] as (() => void) | undefined)?.();
  }

  private _association(task: Task, profile: PlannerProfile, activityId: unknown): void {
    const area = profile.areas.find((value) => value.id === activityId);
    ensure(area, 'Actividad no disponible.');
    const snapshot = taskSnapshot(
      Object.values(this._tasks().entities).filter(Boolean) as Task[],
      [],
    );
    ensure(
      snapshot.matches(snapshot.byId.get(task.id)!, effectiveArea(profile, area!)),
      'La tarea no está asociada a esa actividad.',
    );
  }

  private async _correctTime(
    args: Record<string, unknown>,
    profile: PlannerProfile,
    authorize: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    this._civilDays(profile);
    const task = Object.values(this._tasks().entities).find(
      (value) => value?.id === args['taskId'],
    );
    if (!task)
      throw new PlannerError(
        'UNSUPPORTED_OPERATION',
        'Esta corrección admite tareas activas. Para una tarea archivada, usa el registro nativo.',
      );
    ensure(
      !task.subTaskIds.length,
      'Corrige la duración de una subtarea, no el agregado superior. Las tareas archivadas deben corregirse desde el registro nativo.',
    );
    const date = args['date'],
      duration = args['durationMs'],
      expected = args['expectedDurationMs'];
    ensure(
      typeof date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        !Number.isNaN(Date.parse(date + 'T12:00:00Z')) &&
        new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date &&
        date <= this._date.todayStr(),
      'Fecha de registro inválida o futura.',
    );
    for (const value of [duration, expected])
      ensure(
        typeof value === 'number' &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= 86400000,
        'La duración debe estar entre cero y 24 horas.',
      );
    this._association(task, profile, args['activityId']);
    if ((task.timeSpentOnDay?.[date as string] || 0) !== expected)
      throw new PlannerError(
        'STALE_DATA',
        'La duración registrada cambió; revisa el valor actual.',
      );
    await authorize();
    this._ready();
    this._civilDays(profile);
    if (this._task(task.id) !== task)
      throw new PlannerError(
        'STALE_DATA',
        'La tarea cambió antes de corregir el registro.',
      );
    this._assertContext(args);
    try {
      // Same supported native update used by Worklog/History. Its reducer
      // recalculates task and parent totals, without creating session intervals.
      this._taskService.update(task.id, {
        timeSpentOnDay: { ...task.timeSpentOnDay, [date as string]: duration as number },
      });
      await flushPluginWrites(this._injector);
      return { status: 'applied', taskId: task.id, date, durationMs: duration };
    } catch {
      return {
        status: 'uncertain',
        code: 'OUTCOME_UNKNOWN',
        message:
          'El registro puede haberse corregido. Consulta el recibo antes de repetir.',
      };
    }
  }

  private _planningFields(value: unknown): {
    dueDay: string | null;
    dueWithTime: number | null;
    remindAt: number | null;
  } {
    ensure(object(value), 'Campos de planificación inválidos.');
    const fields = value as Record<string, unknown>;
    ensure(
      Object.keys(fields).length === 3 &&
        ['dueDay', 'dueWithTime', 'remindAt'].every((key) => Object.hasOwn(fields, key)),
      'Solo se permiten los tres campos de planificación.',
    );
    ensure(
      !(fields['dueDay'] !== null && fields['dueWithTime'] !== null),
      'La planificación no puede tener fecha y hora simultáneamente.',
    );
    if (fields['dueDay'] !== null) this._fields({ dueDay: fields['dueDay'] });
    if (fields['dueWithTime'] !== null)
      ensure(this._timestamp(fields['dueWithTime']), 'Hora de planificación inválida.');
    if (fields['remindAt'] !== null)
      ensure(
        fields['dueWithTime'] !== null && this._timestamp(fields['remindAt']),
        'Recordatorio de planificación inválido.',
      );
    return fields as {
      dueDay: string | null;
      dueWithTime: number | null;
      remindAt: number | null;
    };
  }

  private async _restoreSchedule(
    args: Record<string, unknown>,
    authorize: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    ensure(
      Array.isArray(args['entries']) &&
        args['entries'].length > 0 &&
        args['entries'].length <= 500,
      'Selección de restauración inválida.',
    );
    const entries = (args['entries'] as unknown[]).map((value) => {
      ensure(object(value), 'Entrada de restauración inválida.');
      const entry = value as Record<string, unknown>;
      ensure(typeof entry['taskId'] === 'string', 'Identificador de tarea inválido.');
      return {
        taskId: entry['taskId'] as string,
        before: this._planningFields(entry['before']),
        expectedAfter: this._planningFields(entry['expectedAfter']),
      };
    });
    ensure(
      new Set(entries.map((entry) => entry.taskId)).size === entries.length,
      'Tareas duplicadas en restauración.',
    );
    const validate = (): Task[] =>
      entries.map((entry) => {
        const task = Object.values(this._tasks().entities).find(
          (value) => value?.id === entry.taskId,
        );
        if (!task)
          throw new PlannerError(
            'STALE_DATA',
            'La tarea ya no está activa; no se restaura desde el archivo.',
          );
        if (
          ['dueDay', 'dueWithTime', 'remindAt'].some(
            (key) =>
              ((task as unknown as Record<string, unknown>)[key] ?? null) !==
              entry.expectedAfter[key as keyof typeof entry.expectedAfter],
          )
        )
          throw new PlannerError(
            'STALE_DATA',
            'La planificación cambió después de la propuesta.',
          );
        return task;
      });
    validate();
    await authorize();
    this._ready();
    const tasks = validate();
    this._assertContext(args);
    try {
      tasks.forEach((task, index) => {
        const before = entries[index].before;
        const fields: Partial<Task> =
          before.dueWithTime !== null
            ? { dueWithTime: before.dueWithTime }
            : { dueDay: before.dueDay };
        this._dispatchSchedule(task, fields, { remindAt: before.remindAt ?? undefined });
      });
      await flushPluginWrites(this._injector);
      return { status: 'applied', taskIds: tasks.map((task) => task.id) };
    } catch {
      return {
        status: 'uncertain',
        code: 'OUTCOME_UNKNOWN',
        message:
          'La planificación puede haberse restaurado parcialmente. Consulta el recibo antes de repetir.',
      };
    }
  }

  private async _taskCommand(
    args: Record<string, unknown>,
    authorize: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    const command = args['command'];
    ensure(
      command === 'split' || command === 'archive',
      'Comando de tarea no soportado.',
    );
    ensure(
      args['fields'] === undefined && args['moveScope'] === undefined,
      'El comando no admite cambios de campos adicionales.',
    );
    const task = this._task(args['taskId']);
    ensure(!task.parentId, 'Esta acción requiere una tarea superior.');
    const state = this._tasks();
    const subTasks = task.subTaskIds.map((id) => this._task(id, state));
    const validateExpected = (): void => {
      if (args['expected'] === undefined) return;
      ensure(object(args['expected']), 'Instantánea de tarea inválida.');
      const expected = args['expected'] as Record<string, unknown>;
      ensure(
        Object.keys(expected).every((key) =>
          [
            'isDone',
            'dueDay',
            'dueWithTime',
            'timeSpent',
            'timeEstimate',
            'subTaskIds',
          ].includes(key),
        ),
        'Campo de instantánea no soportado.',
      );
      if (
        Object.entries(expected).some(
          ([key, value]) =>
            JSON.stringify((task as unknown as Record<string, unknown>)[key] ?? null) !==
            JSON.stringify(value),
        )
      )
        throw new PlannerError('STALE_DATA', 'La tarea cambió desde la revisión.');
    };
    validateExpected();
    let children: Task[] = [];
    if (command === 'split') {
      ensure(
        !task.isDone && !task.subTaskIds.length,
        'Divide una tarea pendiente que todavía no tenga subtareas.',
      );
      if (task.repeatCfgId)
        throw new PlannerError(
          'UNSUPPORTED_OPERATION',
          'Dividir esta tarea recurrente puede cambiar las plantillas futuras; revísala desde la interfaz nativa.',
        );
      ensure(
        Array.isArray(args['children']) &&
          args['children'].length >= 2 &&
          args['children'].length <= 50,
        'Indica entre dos y 50 subtareas.',
      );
      children = (args['children'] as unknown[]).map((value) => {
        ensure(
          object(value) &&
            Object.keys(value).every((key) => ['title', 'timeEstimate'].includes(key)),
          'Campos de subtarea inválidos.',
        );
        const fields = this._fields(value);
        ensure(typeof fields.title === 'string', 'Cada subtarea requiere un título.');
        return this._taskService.createNewTaskWithDefaults({
          title: fields.title!,
          additional: fields,
          workContextType: WorkContextType.PROJECT,
          workContextId: task.projectId || INBOX_PROJECT.id,
        });
      });
    } else {
      ensure(args['children'] === undefined, 'Archivar no admite subtareas nuevas.');
      ensure(
        ![task.id, ...task.subTaskIds].includes(state.currentTaskId || ''),
        'Detén el temporizador de esta tarea o de sus subtareas antes de archivar.',
      );
    }
    await authorize();
    this._ready();
    if (
      this._task(task.id) !== task ||
      subTasks.some((child) => this._task(child.id) !== child)
    )
      throw new PlannerError(
        'STALE_DATA',
        'La tarea o sus subtareas cambiaron antes de aplicar.',
      );
    validateExpected();
    if (command === 'archive')
      ensure(
        ![task.id, ...task.subTaskIds].includes(this._tasks().currentTaskId || ''),
        'Detén el temporizador antes de archivar.',
      );
    this._assertContext(args);
    let transitionStarted = false;
    const taskGuard = (): void => {
      this._ready();
      if (
        this._task(task.id) !== task ||
        subTasks.some((child) => this._task(child.id) !== child)
      )
        throw new PlannerError(
          'STALE_DATA',
          'La tarea cambió durante el archivo; se conserva la tarea activa.',
        );
      ensure(
        ![task.id, ...task.subTaskIds].includes(this._tasks().currentTaskId || ''),
        'Detén el temporizador antes de archivar.',
      );
    };
    try {
      if (command === 'split') {
        children.forEach((child, index) => {
          transitionStarted = true;
          this._store.dispatch(
            addSubTask({ task: child, parentId: task.id, isIgnoreShortSyntax: true }),
          );
          // The native first-child rule inherits a nonzero parent estimate.
          // An explicitly requested zero remains an intentional estimate.
          if (
            index === 0 &&
            (args['children'] as Array<Record<string, unknown>>)[0]['timeEstimate'] ===
              0 &&
            task.timeEstimate
          )
            this._taskService.update(child.id, { timeEstimate: 0 });
        });
      } else {
        await this._taskService.moveToArchive(
          { ...task, subTasks },
          {
            beforeWrite: authorize,
            atWrite: () => {
              taskGuard();
              this._assertContext(args);
              transitionStarted = true;
            },
            beforeRemove: taskGuard,
          },
        );
      }
      await flushPluginWrites(this._injector);
      return {
        status: 'applied',
        taskId: task.id,
        ...(command === 'split' ? { taskIds: children.map((child) => child.id) } : {}),
      };
    } catch (error) {
      if (!transitionStarted) {
        if (error instanceof PlannerError) throw error;
        throw new PlannerError(
          'DATA_UNAVAILABLE',
          'No se pudo comprobar la tarea antes de modificarla.',
        );
      }
      return {
        status: 'uncertain',
        code: 'OUTCOME_UNKNOWN',
        message:
          'La tarea puede haberse modificado parcialmente. Consulta el recibo antes de repetir.',
      };
    }
  }

  private _civilDays(profile: PlannerProfile): void {
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
  }

  private async _logTime(
    args: Record<string, unknown>,
    profile: PlannerProfile,
    authorize: () => Promise<void>,
  ): Promise<Record<string, unknown>> {
    this._civilDays(profile);
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
    await authorize();
    this._ready();
    this._civilDays(profile);
    if (this._task(task.id) !== task)
      throw new PlannerError(
        'STALE_DATA',
        'La tarea cambió antes de registrar el tiempo.',
      );
    (args['assertCurrent'] as (() => void) | undefined)?.();
    try {
      this._taskService.addTimeSpentAndSync(task, parsed.duration, parsed.date, true);
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
