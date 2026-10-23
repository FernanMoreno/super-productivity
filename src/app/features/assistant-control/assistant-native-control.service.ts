import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  AssistantControlContext,
  ControlError,
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
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';

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
