import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  AssistantControlContext,
  ControlError,
  CONTROL_REPEAT_WEEKDAYS,
  validateControlArgs,
} from '../../../../electron/shared-with-frontend/assistant-control.model';
import { DateService } from '../../core/date/date.service';
import { parseTimeSpentBody } from '../../core/electron/local-rest-api-task-time';
import {
  DEFAULT_PROJECT,
  INBOX_PROJECT,
  LEGACY_NO_LIST_TAG_ID,
} from '../project/project.const';
import { Project } from '../project/project.model';
import { ProjectService } from '../project/project.service';
import { archiveProject } from '../project/store/project.actions';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import { SYSTEM_TAG_IDS } from '../tag/tag.const';
import { TagService } from '../tag/tag.service';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { Task, TaskReminderOptionId } from '../tasks/task.model';
import { PlannerActions } from '../planner/store/planner.actions';
import { TaskService } from '../tasks/task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { selectTaskRepeatCfgFeatureState } from '../task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  DEFAULT_TASK_REPEAT_CFG,
  RepeatCycleOption,
  TaskRepeatCfgCopy,
  TASK_REPEAT_WEEKDAY_MAP,
} from '../task-repeat-cfg/task-repeat-cfg.model';
import { getIntervalRepeatUpdates } from '../task-repeat-cfg/dialog-edit-task-repeat-cfg/get-interval-repeat-updates';
import { getDefaultSkipOverdue } from '../task-repeat-cfg/dialog-edit-task-repeat-cfg/get-default-skip-overdue';
import { dateStrToUtcDate } from '../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../util/get-db-date-str';
import { getRepeatDueWithTime } from '../task-repeat-cfg/store/get-repeat-due-with-time.util';
import { TODAY_TAG } from '../tag/tag.const';
import { millisecondsDiffToRemindOption } from '../tasks/util/remind-option-to-milliseconds';

const requireValue: (value: unknown, code: string, message: string) => asserts value = (
  value,
  code,
  message,
) => {
  if (!value) throw new ControlError(code, message);
};
const has = (args: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(args, key);

/** Native operations only; the coordinator owns grants, receipts and durable flushes. */
@Injectable({ providedIn: 'root' })
export class AssistantNativeControlService {
  private readonly _store = inject(Store);
  private readonly _tasks = this._store.selectSignal(selectTaskFeatureState);
  private readonly _projectState = this._store.selectSignal(selectProjectFeatureState);
  private readonly _taskService = inject(TaskService);
  private readonly _projects = inject(ProjectService);
  private readonly _tags = inject(TagService);
  private readonly _date = inject(DateService);
  private readonly _repeat = inject(TaskRepeatCfgService);
  private readonly _repeatState = this._store.selectSignal(
    selectTaskRepeatCfgFeatureState,
  );

  async run(
    tool: string,
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    switch (tool) {
      case 'task_timer':
        return this._timer(args, context);
      case 'task_time':
        return this._time(args, context);
      case 'task_notes':
        return this._notes(args, context);
      case 'task_repeat':
        return this._taskRepeat(args, context);
      case 'project_manage':
        return this._project(args, context);
      case 'tag_manage':
        return this._tag(args, context);
      default:
        throw new ControlError('INVALID_ARGUMENTS', 'Unsupported native tool.');
    }
  }

  private _task(id: unknown): Task {
    const task = Object.values(this._tasks().entities).find((item) => item?.id === id);
    requireValue(task, 'TASK_NOT_FOUND', 'Active task not found.');
    return task;
  }

  private _unchanged(task: Task): void {
    requireValue(this._task(task.id) === task, 'STALE_DATA', 'The task changed.');
  }

  private async _timer(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const currentTaskId = this._tasks().currentTaskId;
    const result = (): Record<string, unknown> => ({
      currentTaskId: this._tasks().currentTaskId,
    });
    if (args['command'] === 'status') return result();
    requireValue(
      ['start', 'pause', 'stop'].includes(String(args['command'])),
      'INVALID_ARGUMENTS',
      'Unsupported timer command.',
    );
    requireValue(
      !has(args, 'expectedCurrentTaskId') ||
        args['expectedCurrentTaskId'] === currentTaskId,
      'STALE_DATA',
      'The tracked task changed.',
    );
    const task = args['command'] === 'start' ? this._task(args['taskId']) : undefined;
    const checkTracking = (): void => {
      if (task)
        requireValue(
          this._taskService.isTimeTrackingEnabled(),
          'TRACKING_DISABLED',
          'Time tracking is disabled in application settings.',
        );
    };
    checkTracking();
    if ((task && task.id === currentTaskId) || (!task && !currentTaskId)) return result();
    await context.authorize();
    checkTracking();
    requireValue(
      this._tasks().currentTaskId === currentTaskId,
      'STALE_DATA',
      'The tracked task changed.',
    );
    if (task) this._unchanged(task);
    context.markMutation();
    if (task) this._taskService.setCurrentId(task.id);
    else this._taskService.pauseCurrent();
    return result();
  }

  private async _time(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    requireValue(
      args['command'] === 'add' || args['command'] === 'set',
      'INVALID_ARGUMENTS',
      'Unsupported time command.',
    );
    const today = this._date.todayStr();
    const parsed = parseTimeSpentBody(
      { date: args['date'], duration: args['duration'] },
      today,
      args['command'] === 'set' ? 'PUT' : 'POST',
    );
    if ('error' in parsed) throw new ControlError('INVALID_ARGUMENTS', parsed.error);
    const task = this._task(args['taskId']);
    requireValue(!task.subTaskIds.length, 'INVALID_ARGUMENTS', 'Log time on a subtask.');
    const previous = task.timeSpentOnDay?.[parsed.date] || 0;
    requireValue(
      !has(args, 'expectedDuration') || args['expectedDuration'] === previous,
      'STALE_DATA',
      'The recorded duration changed.',
    );
    const duration =
      args['command'] === 'set' ? parsed.duration : previous + parsed.duration;
    requireValue(duration <= 86400000, 'INVALID_ARGUMENTS', 'A day cannot exceed 24h.');
    const result = { taskId: task.id, date: parsed.date, duration };
    if (
      duration === previous &&
      !(duration === 0 && has(task.timeSpentOnDay, parsed.date))
    )
      return result;
    await context.authorize();
    this._unchanged(task);
    requireValue(
      this._date.todayStr() === today,
      'STALE_DATA',
      'The logical day changed.',
    );
    context.markMutation();
    if (args['command'] === 'add') {
      this._taskService.addTimeSpentAndSync(task, parsed.duration, parsed.date, true);
    } else {
      const timeSpentOnDay = { ...task.timeSpentOnDay };
      if (duration === 0) delete timeSpentOnDay[parsed.date];
      else timeSpentOnDay[parsed.date] = duration;
      this._taskService.update(task.id, { timeSpentOnDay });
    }
    return result;
  }

  private async _notes(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const task = this._task(args['taskId']);
    const previous = task.notes || '';
    if (args['command'] === 'read')
      return {
        taskId: task.id,
        notes: previous.slice(0, 8192),
        truncated: previous.length > 8192,
      };
    requireValue(
      args['command'] === 'write' &&
        typeof args['notes'] === 'string' &&
        args['notes'].length <= 8192,
      'INVALID_ARGUMENTS',
      'Notes must be a string of at most 8192 characters.',
    );
    requireValue(
      !has(args, 'expectedNotes') || args['expectedNotes'] === previous,
      'STALE_DATA',
      'The notes changed.',
    );
    const result = { taskId: task.id, updated: args['notes'] !== previous };
    if (!result.updated) return result;
    await context.authorize();
    this._unchanged(task);
    context.markMutation();
    this._taskService.update(task.id, { notes: args['notes'] });
    return result;
  }

  private async _taskRepeat(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const invalid = validateControlArgs('task_repeat', args);
    requireValue(!invalid, 'INVALID_ARGUMENTS', invalid || 'Invalid repeat command.');
    const task = this._task(args['taskId']);
    requireValue(
      !task.parentId,
      'INVALID_ARGUMENTS',
      'Configure repetition on the parent task.',
    );
    const cfg = task.repeatCfgId
      ? this._repeatState().entities[task.repeatCfgId]
      : undefined;
    requireValue(
      !task.repeatCfgId || cfg,
      'DATA_UNAVAILABLE',
      'Repeat configuration is missing.',
    );
    const schedule = cfg
      ? {
          cycle: cfg.repeatCycle.toLowerCase(),
          every: cfg.repeatEvery,
          weekdays:
            cfg.repeatCycle === 'WEEKLY'
              ? CONTROL_REPEAT_WEEKDAYS.filter((_, i) => cfg[TASK_REPEAT_WEEKDAY_MAP[i]])
              : undefined,
          startDay: cfg.startDate ?? null,
          startTime: cfg.startTime ?? null,
          reminder: cfg.remindAt ?? null,
          isPaused: cfg.isPaused,
          paused: cfg.isPaused,
          repeatUntilDay: cfg.repeatUntilDay ?? null,
          repeatFromCompletionDate: cfg.repeatFromCompletionDate ?? false,
          waitForCompletion: cfg.waitForCompletion ?? false,
          skipOverdue: cfg.skipOverdue ?? false,
          monthlyWeekOfMonth: cfg.monthlyWeekOfMonth ?? null,
          monthlyWeekday: cfg.monthlyWeekday ?? null,
          monthlyLastDay: cfg.monthlyLastDay ?? false,
          deletedInstanceDates: cfg.deletedInstanceDates ?? [],
        }
      : null;
    // Include private content in the concurrency token without exposing it in tasks:read.
    const digest = cfg
      ? await globalThis.crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(cfg)),
        )
      : null;
    const revision = digest
      ? Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
      : null;
    const template = cfg
      ? {
          title: cfg.title,
          timeEstimate: cfg.defaultEstimate ?? null,
          priority: cfg.priority ?? null,
          tagIds: cfg.tagIds,
          shouldInheritSubtasks: cfg.shouldInheritSubtasks ?? false,
          disableAutoUpdateSubtasks: cfg.disableAutoUpdateSubtasks ?? false,
          subTaskTemplates:
            cfg.subTaskTemplates?.map(({ title, timeEstimate, notes }) => ({
              title,
              timeEstimate: timeEstimate ?? 0,
              ...(args['command'] === 'read_template' ? { notes: notes ?? '' } : {}),
            })) ?? [],
          ...(args['command'] === 'read_template' ? { notes: cfg.notes ?? '' } : {}),
        }
      : null;
    if (args['command'] === 'read' || args['command'] === 'read_template')
      return {
        taskId: task.id,
        repeatCfgId: cfg?.id || null,
        schedule,
        template,
        revision,
        dueDay: task.dueDay || null,
        dueWithTime: task.dueWithTime || null,
      };
    requireValue(
      args['expectedRevision'] === revision,
      'STALE_DATA',
      'The repeat schedule changed.',
    );
    if (args['command'] === 'remove') {
      requireValue(cfg, 'INVALID_ARGUMENTS', 'No repeating series exists.');
      await context.authorize();
      this._unchanged(task);
      requireValue(
        this._repeatState().entities[cfg.id] === cfg,
        'STALE_DATA',
        'The repeat configuration changed.',
      );
      context.markMutation();
      this._repeat.deleteTaskRepeatCfg(cfg.id);
      return { taskId: task.id, repeatCfgId: null };
    }
    requireValue(
      cfg || !task.isDone,
      'INVALID_ARGUMENTS',
      'Create a series from an unfinished task.',
    );
    const changes: Partial<TaskRepeatCfgCopy> = getIntervalRepeatUpdates(
      String(args['cycle']).toUpperCase() as RepeatCycleOption,
      (args['every'] as number | undefined) ?? 1,
      dateStrToUtcDate(args['startDay'] as string),
    );
    // The interval helper resets anchors; omitted advanced fields must retain them.
    if (cfg && cfg.repeatCycle === 'MONTHLY' && args['cycle'] === 'monthly') {
      delete changes.monthlyWeekOfMonth;
      delete changes.monthlyWeekday;
      delete changes.monthlyLastDay;
    }
    if (args['weekdays'])
      Object.assign(
        changes,
        Object.fromEntries(
          TASK_REPEAT_WEEKDAY_MAP.map((key, i) => [
            key,
            (args['weekdays'] as string[]).includes(CONTROL_REPEAT_WEEKDAYS[i]),
          ]),
        ),
      );
    const advanced: Record<string, keyof TaskRepeatCfgCopy> = {
      startTime: 'startTime',
      reminder: 'remindAt',
      repeatUntilDay: 'repeatUntilDay',
      paused: 'isPaused',
      skipOverdue: 'skipOverdue',
      repeatFromCompletionDate: 'repeatFromCompletionDate',
      waitForCompletion: 'waitForCompletion',
      monthlyWeekOfMonth: 'monthlyWeekOfMonth',
      monthlyWeekday: 'monthlyWeekday',
      monthlyLastDay: 'monthlyLastDay',
      deletedInstanceDates: 'deletedInstanceDates',
    };
    for (const [input, field] of Object.entries(advanced))
      if (Object.hasOwn(args, input))
        Object.assign(changes, { [field]: args[input] ?? undefined });
    if (args['startTime'] === null) Object.assign(changes, { remindAt: undefined });
    if (args['monthlyLastDay'] === true)
      Object.assign(changes, {
        monthlyWeekOfMonth: undefined,
        monthlyWeekday: undefined,
      });
    if (args['monthlyWeekOfMonth'] != null)
      Object.assign(changes, { monthlyLastDay: undefined });
    const inputTemplate = args['template'] as Record<string, unknown> | undefined;
    if (inputTemplate)
      for (const [key, value] of Object.entries(inputTemplate))
        Object.assign(changes, {
          [key === 'timeEstimate' ? 'defaultEstimate' : key]:
            value === null && !['title', 'priority'].includes(key) ? undefined : value,
        });
    const effective = {
      startTime: task.dueWithTime
        ? new Date(task.dueWithTime).toTimeString().slice(0, 5)
        : undefined,
      ...cfg,
      ...changes,
    };
    if (effective.startTime && !effective.remindAt) {
      effective.remindAt = TaskReminderOptionId.DoNotRemind;
      Object.assign(changes, { remindAt: effective.remindAt });
    }
    requireValue(
      !effective.remindAt || !!effective.startTime,
      'INVALID_ARGUMENTS',
      'A reminder requires a start time.',
    );
    requireValue(
      !effective.repeatUntilDay ||
        effective.repeatUntilDay >= (args['startDay'] as string),
      'INVALID_ARGUMENTS',
      'End day precedes start day.',
    );
    const checkReferences = (): void => {
      if (task.projectId)
        requireValue(
          this._projectState().entities[task.projectId] &&
            !this._projectState().entities[task.projectId]?.isArchived,
          'INVALID_ARGUMENTS',
          'The task project is unavailable.',
        );
      if (inputTemplate?.['tagIds'])
        for (const tagId of inputTemplate['tagIds'] as string[])
          requireValue(
            !SYSTEM_TAG_IDS.has(tagId) &&
              this._tags.tags().some((tag) => tag.id === tagId),
            'INVALID_ARGUMENTS',
            'Template tags must be existing ordinary tags.',
          );
    };
    checkReferences();
    const changesTime =
      Object.hasOwn(args, 'startTime') || Object.hasOwn(args, 'reminder');
    if (args['applyTo'] === 'current' && changesTime)
      requireValue(
        !task.isDone && !!(task.dueDay || task.dueWithTime),
        'INVALID_ARGUMENTS',
        'Current time edits require an unfinished scheduled task.',
      );
    // Only changed fields may reach the native scheduling effect (UI issue #7373).
    if (cfg)
      for (const key of Object.keys(changes) as (keyof TaskRepeatCfgCopy)[])
        if (JSON.stringify(cfg[key]) === JSON.stringify(changes[key]))
          delete changes[key];
    await context.authorize();
    this._unchanged(task);
    requireValue(
      !cfg || this._repeatState().entities[cfg.id] === cfg,
      'STALE_DATA',
      'The repeat configuration changed.',
    );
    checkReferences();
    context.markMutation();
    let repeatCfgId: string;
    if (cfg) {
      // Native effects reschedule the unfinished instance; completed history stays intact.
      this._repeat.updateTaskRepeatCfg(cfg.id, changes);
      repeatCfgId = cfg.id;
    } else {
      const startTime = task.dueWithTime
        ? new Date(task.dueWithTime).toTimeString().slice(0, 5)
        : undefined;
      const created = {
        ...DEFAULT_TASK_REPEAT_CFG,
        title: task.title,
        notes: task.notes,
        tagIds: task.tagIds.filter((tag) => tag !== TODAY_TAG.id),
        defaultEstimate: task.timeEstimate,
        priority: task.priority,
        shouldInheritSubtasks: task.subTaskIds.length > 0,
        startTime,
        remindAt: task.dueWithTime
          ? millisecondsDiffToRemindOption(task.dueWithTime, task.remindAt)
          : undefined,
        ...changes,
      };
      repeatCfgId = this._repeat.addTaskRepeatCfgToTask(task.id, task.projectId || null, {
        ...created,
        skipOverdue: Object.hasOwn(args, 'skipOverdue')
          ? created.skipOverdue
          : getDefaultSkipOverdue(created),
      });
    }
    if (args['applyTo'] === 'current' && changesTime) {
      // Re-read after native calendar effects; time edits retain the selected occurrence's day.
      const current = this._task(task.id);
      const dayOffset = this._date.getStartOfNextDayDiffMs();
      const day = task.dueWithTime
        ? getDbDateStr(new Date(task.dueWithTime - dayOffset))
        : task.dueDay || this._date.todayStr();
      if (effective.startTime) {
        this._taskService.reScheduleTask({
          task: current,
          due: getRepeatDueWithTime(
            effective.startTime,
            new Date(day + 'T12:00:00'),
            dayOffset,
          ),
          remindCfg: effective.remindAt || TaskReminderOptionId.DoNotRemind,
          isMoveToBacklog: false,
        });
      } else {
        this._store.dispatch(
          PlannerActions.planTaskForDay({
            task: current,
            day,
            isShowSnack: false,
          }),
        );
      }
    }
    return {
      taskId: task.id,
      repeatCfgId,
      timeAppliedTo: changesTime ? (args['applyTo'] ?? 'future') : null,
    };
  }

  private _fields(args: Record<string, unknown>): {
    title?: string;
    icon?: string;
    color?: string;
  } {
    const fields = args['fields'];
    requireValue(
      !!fields && typeof fields === 'object' && !Array.isArray(fields),
      'INVALID_ARGUMENTS',
      'Entity fields are required.',
    );
    const entries = Object.entries(fields);
    requireValue(
      entries.length &&
        entries.every(
          ([key, value]) =>
            ['title', 'icon', 'color'].includes(key) &&
            typeof value === 'string' &&
            value.length <= 500 &&
            (key !== 'title' || !!value.trim()),
        ),
      'INVALID_ARGUMENTS',
      'Unsupported entity field or value.',
    );
    return fields;
  }

  private async _project(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const command = String(args['command']);
    requireValue(
      ['create', 'update', 'archive', 'reopen'].includes(command),
      'INVALID_ARGUMENTS',
      'Unsupported project command.',
    );
    const fields = ['create', 'update'].includes(command) ? this._fields(args) : {};
    requireValue(
      command !== 'create' || fields.title,
      'INVALID_ARGUMENTS',
      'A project title is required.',
    );
    const id = args['id'];
    const findProject = (): Project | undefined =>
      Object.values(this._projectState().entities).find((item) => item?.id === id);
    const project = command === 'create' ? undefined : findProject();
    requireValue(
      command === 'create' || project,
      'PROJECT_NOT_FOUND',
      'Project not found.',
    );
    requireValue(
      command !== 'archive' || id !== INBOX_PROJECT.id,
      'INVALID_ARGUMENTS',
      'Inbox cannot be archived.',
    );
    await context.authorize();
    if (project) {
      // list() excludes archived projects, so inspect the complete entity state.
      const current = findProject();
      requireValue(current === project, 'STALE_DATA', 'The project changed.');
    }
    context.markMutation();
    if (command === 'archive') this._store.dispatch(archiveProject({ id: project!.id }));
    else if (command === 'reopen') this._projects.reopen(project!.id, project);
    else {
      const { color, ...basic } = fields;
      const changes: Partial<Project> = {
        ...basic,
        ...(color !== undefined
          ? { theme: { ...(project?.theme ?? DEFAULT_PROJECT.theme), primary: color } }
          : {}),
      };
      if (command === 'create')
        return { id: this._projects.add(changes), title: fields.title };
      this._projects.update(project!.id, changes, true);
    }
    return { id: project!.id, command };
  }

  private async _tag(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const command = String(args['command']);
    requireValue(
      ['create', 'update', 'delete'].includes(command),
      'INVALID_ARGUMENTS',
      'Unsupported tag command.',
    );
    const fields = command === 'delete' ? {} : this._fields(args);
    requireValue(
      command !== 'create' || fields.title,
      'INVALID_ARGUMENTS',
      'A tag title is required.',
    );
    const id = args['id'];
    requireValue(
      !SYSTEM_TAG_IDS.has(String(id)) && id !== LEGACY_NO_LIST_TAG_ID,
      'INVALID_ARGUMENTS',
      'System tags cannot be changed.',
    );
    const tag =
      command === 'create' ? undefined : this._tags.tags().find((item) => item.id === id);
    requireValue(command === 'create' || tag, 'TAG_NOT_FOUND', 'Tag not found.');
    await context.authorize();
    if (tag)
      requireValue(
        this._tags.tags().find((item) => item.id === id) === tag,
        'STALE_DATA',
        'The tag changed.',
      );
    context.markMutation();
    if (command === 'create')
      return { id: this._tags.addTag(fields), title: fields.title };
    if (command === 'delete') this._tags.deleteTag(tag!.id);
    else this._tags.updateTag(tag!.id, fields);
    return { id: tag!.id, command };
  }
}
