import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import {
  AssistantControlContext,
  ControlError,
} from '../../../../electron/shared-with-frontend/assistant-control.model';
import { validateTaskControlArgs } from '../../../../electron/shared-with-frontend/assistant-task-control.contract';
import { DateService } from '../../core/date/date.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { ProjectService } from '../project/project.service';
import { selectProjectFeatureState } from '../project/store/project.selectors';
import {
  moveProjectTaskInBacklogList,
  moveProjectTaskToBacklogList,
  moveProjectTaskToRegularList,
} from '../project/store/project.actions';
import { SectionService } from '../section/section.service';
import { selectSectionFeatureState } from '../section/store/section.selectors';
import { SYSTEM_TAG_IDS } from '../tag/tag.const';
import { TagService } from '../tag/tag.service';
import { selectTagFeatureState } from '../tag/store/tag.reducer';
import { addSubTask, moveSubTask } from '../tasks/store/task.actions';
import { selectTaskFeatureState } from '../tasks/store/task.selectors';
import { DropListModelSource, Task, TaskWithSubTasks } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { TaskAttachmentService } from '../tasks/task-attachment/task-attachment.service';
import { TaskAttachment } from '../tasks/task-attachment/task-attachment.model';
import { getWontDoChanges, isWontDoTask } from '../tasks/util/is-wont-do-task';
import { moveTaskInTodayList } from '../work-context/store/work-context-meta.actions';
import { WorkContextType } from '../work-context/work-context.model';

const requireValue: (v: unknown, code: string, message: string) => asserts v = (
  v,
  code,
  message,
) => {
  if (!v) throw new ControlError(code, message);
};
const has = (a: Record<string, unknown>, k: string): boolean => Object.hasOwn(a, k);
const check = (v: unknown, message: string): void =>
  requireValue(v, 'INVALID_ARGUMENTS', message);
// Tracking ticks must not invalidate metadata CAS. The digest never exposes notes.
const revisionData = (task: Task): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(task)
      .filter(([key]) => !['timeSpent', 'timeSpentOnDay', 'modified'].includes(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
const digest = async (data: unknown): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(data)),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');

/** Native task parity. The route owns authorization scopes, receipts and durable flushes. */
@Injectable({ providedIn: 'root' })
export class AssistantTaskControlService {
  private readonly _store = inject(Store);
  private readonly _tasks = this._store.selectSignal(selectTaskFeatureState);
  private readonly _projectsState = this._store.selectSignal(selectProjectFeatureState);
  private readonly _sections = this._store.selectSignal(selectSectionFeatureState);
  private readonly _tagState = this._store.selectSignal(selectTagFeatureState);
  private readonly _taskService = inject(TaskService);
  private readonly _projects = inject(ProjectService);
  private readonly _tags = inject(TagService);
  private readonly _date = inject(DateService);
  private readonly _archive = inject(ArchiveStoreService);
  private readonly _attachments = inject(TaskAttachmentService);
  private readonly _sectionService = inject(SectionService);

  private _task(id: unknown): Task {
    const task = typeof id === 'string' ? this._tasks().entities[id] : undefined;
    requireValue(task, 'TASK_NOT_FOUND', 'Active task not found.');
    return task;
  }

  private _tree(
    task: Task,
    tasks: readonly Task[] = Object.values(this._tasks().entities).filter(
      (t): t is Task => !!t,
    ),
  ): TaskWithSubTasks {
    const subTasks = task.subTaskIds.map((id) => tasks.find((t) => t.id === id));
    check(
      subTasks.every((t) => !!t && t.parentId === task.id && !t.subTaskIds.length),
      'Task children are missing or inconsistent.',
    );
    return { ...task, subTasks: subTasks as Task[] };
  }

  private _revision(task: Task, all?: readonly Task[]): Promise<string> {
    const tree = this._tree(task, all);
    const parent = task.parentId
      ? all
        ? all.find((t) => t.id === task.parentId)
        : this._tasks().entities[task.parentId]
      : undefined;
    return digest({
      task: revisionData(task),
      children: tree.subTasks.map(revisionData),
      parent: parent && revisionData(parent),
      project: this._projectsState().entities[task.projectId],
      tags: Object.values(this._tagState().entities).filter(
        (tag) => tag && (task.tagIds.includes(tag.id) || tag.id === 'TODAY'),
      ),
      today: this._date.todayStr(),
      sections: Object.values(this._sections().entities).filter(
        (s) => s?.contextId === task.projectId || s?.contextId === 'TODAY',
      ),
    });
  }

  private async _view(
    task: Task,
    all?: readonly Task[],
  ): Promise<Record<string, unknown>> {
    const keys = [
      'id',
      'title',
      'projectId',
      'tagIds',
      'parentId',
      'subTaskIds',
      'isDone',
      'created',
      'doneOn',
      'wontDoOn',
      'timeEstimate',
      'priority',
      'dueDay',
      'dueWithTime',
      'remindAt',
      'deadlineDay',
      'deadlineWithTime',
      'deadlineRemindAt',
      'repeatCfgId',
    ];
    return {
      ...Object.fromEntries(Object.entries(task).filter(([key]) => keys.includes(key))),
      revision: await this._revision(task, all),
    };
  }

  async run(
    tool: string,
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const invalid = validateTaskControlArgs(tool, args);
    requireValue(!invalid, 'INVALID_ARGUMENTS', invalid || 'Invalid task command.');
    if (
      tool === 'task_manage' &&
      (args['location'] === 'archive' || args['command'] === 'restore')
    )
      return this._archived(args, context);
    if (tool === 'task_manage' && args['command'] === 'read' && !args['taskId']) {
      const all = Object.values(this._tasks().entities).filter(
        (t): t is Task => !!t && !this._projectsState().entities[t.projectId]?.isArchived,
      );
      const limit = Number(args['limit'] ?? 100);
      const offset = Number(args['offset'] ?? 0);
      return {
        tasks: await Promise.all(
          all.slice(offset, offset + limit).map((task) => this._view(task)),
        ),
        total: all.length,
        truncated: all.length > offset + limit,
        nextOffset: all.length > offset + limit ? offset + limit : null,
      };
    }
    const task = this._task(args['taskId']);
    requireValue(
      !this._projectsState().entities[task.projectId]?.isArchived,
      'TASK_NOT_FOUND',
      'Reopen the archived project before accessing its active tasks.',
    );
    if (args['command'] === 'read') {
      if (tool === 'task_structure') return this._structureView(task);
      if (tool === 'task_attachment')
        return {
          taskId: task.id,
          revision: await this._revision(task),
          attachments: task.attachments.filter(
            (a) => a.type !== 'NOTE' || args['includeNotes'] === true,
          ),
        };
      return this._view(task);
    }
    const tree = this._tree(task);
    const parent = task.parentId ? this._task(task.parentId) : undefined;
    const revision = await this._revision(task);
    requireValue(
      args['expectedRevision'] === revision,
      'STALE_DATA',
      'Task revision changed; read again.',
    );
    const projects = this._projectsState(),
      sections = this._sections(),
      tags = this._tagState(),
      today = this._date.todayStr();
    const unchanged = (): void => {
      requireValue(
        this._tasks().entities[task.id] === task &&
          tree.subTasks.every((t) => this._tasks().entities[t.id] === t) &&
          (!parent || this._tasks().entities[parent.id] === parent) &&
          this._projectsState() === projects &&
          this._sections() === sections &&
          this._tagState() === tags &&
          this._date.todayStr() === today,
        'STALE_DATA',
        'Task or context changed during authorization.',
      );
    };
    unchanged();
    await context.authorize();
    unchanged();
    if (tool === 'task_attachment') return this._attachment(task, args, context);
    if (tool === 'task_structure') return this._structure(task, args, context);
    return this._manage(tree, args, context, unchanged);
  }

  private _availableProject(id: string): void {
    check(
      this._projects.list().some((p) => p.id === id && !p.isArchived),
      'Project is missing or archived.',
    );
  }

  private _inTag(task: Task, tagId: string): boolean {
    return tagId === 'TODAY'
      ? task.dueWithTime
        ? this._date.isToday(task.dueWithTime)
        : task.dueDay === this._date.todayStr()
      : task.tagIds.includes(tagId);
  }

  private _context(
    task: Task,
    id: string,
    type: WorkContextType,
  ): { taskIds: string[]; backlogTaskIds: string[]; isEnableBacklog: boolean } {
    if (type === WorkContextType.PROJECT) {
      const project = this._projectsState().entities[id];
      check(
        !!project && !project.isArchived && task.projectId === id,
        'Project context is unavailable for this task.',
      );
      return {
        taskIds: project!.taskIds,
        backlogTaskIds: project!.backlogTaskIds,
        isEnableBacklog: !!project!.isEnableBacklog,
      };
    }
    const tag = this._tagState().entities[id];
    check(
      type === WorkContextType.TAG && !!tag && this._inTag(task, id),
      'Tag context is unavailable for this task.',
    );
    return { taskIds: tag!.taskIds, backlogTaskIds: [], isEnableBacklog: false };
  }

  private async _structureView(task: Task): Promise<Record<string, unknown>> {
    const contexts = task.parentId
      ? []
      : [
          { id: task.projectId, type: WorkContextType.PROJECT },
          ...Object.values(this._tagState().entities)
            .filter((tag) => tag && this._inTag(task, tag.id))
            .map((tag) => ({ id: tag!.id, type: WorkContextType.TAG })),
        ].map(({ id, type }) => ({
          contextId: id,
          contextType: type,
          ...this._context(task, id, type),
          sections: Object.values(this._sections().entities)
            .filter((s) => s?.contextId === id && s.contextType === type)
            .map((s) => ({ id: s!.id, title: s!.title, taskIds: s!.taskIds })),
        }));
    return {
      taskId: task.id,
      parentId: task.parentId ?? null,
      siblingIds: task.parentId ? this._task(task.parentId).subTaskIds : [],
      contexts,
      revision: await this._revision(task),
    };
  }

  private async _manage(
    task: TaskWithSubTasks,
    args: Record<string, unknown>,
    context: AssistantControlContext,
    unchanged: () => void,
  ): Promise<Record<string, unknown>> {
    const command = String(args['command']);
    const result: Record<string, unknown> = { taskId: task.id, command };
    switch (command) {
      case 'update': {
        const fields = { ...(args['fields'] as Partial<Task>) };
        check(
          !has(fields, 'timeEstimate') || !task.subTaskIds.length,
          'Parent estimates are calculated from children.',
        );
        check(
          !has(fields, 'doneOn') || task.isDone,
          'Only finished tasks have a completion timestamp.',
        );
        if (has(fields, 'doneOn') && isWontDoTask(task)) fields.wontDoOn = fields.doneOn;
        context.markMutation();
        if (has(fields, 'title'))
          this._store.dispatch(
            TaskSharedActions.updateTask({
              task: { id: task.id, changes: fields },
              isIgnoreShortSyntax: true,
            }),
          );
        else this._taskService.update(task.id, fields);
        break;
      }
      case 'complete':
        context.markMutation();
        this._taskService.setDone(task.id);
        break;
      case 'reopen':
        context.markMutation();
        this._taskService.setUnDone(task.id);
        break;
      case 'wont_do':
        context.markMutation();
        this._taskService.update(task.id, getWontDoChanges(Date.now()));
        break;
      case 'schedule': {
        const remindAt = has(args, 'remindAt')
          ? ((args['remindAt'] as number | null) ?? undefined)
          : typeof task.remindAt === 'number' &&
              typeof task.dueWithTime === 'number' &&
              args['at']
            ? Number(args['at']) - (task.dueWithTime - task.remindAt)
            : undefined;
        check(
          remindAt === undefined ||
            (Number.isSafeInteger(remindAt) &&
              remindAt > 0 &&
              remindAt <= Number(args['at'])),
          'Preserved reminder is invalid; explicitly clear it.',
        );
        context.markMutation();
        if (args['day'])
          this._store.dispatch(
            PlannerActions.planTaskForDay({
              task,
              day: String(args['day']),
              isShowSnack: false,
            }),
          );
        else
          this._store.dispatch(
            (task.dueWithTime
              ? TaskSharedActions.reScheduleTaskWithTime
              : TaskSharedActions.scheduleTaskWithTime)({
              task,
              dueWithTime: Number(args['at']),
              remindAt,
              isMoveToBacklog: false,
            }),
          );
        break;
      }
      case 'unschedule':
        context.markMutation();
        this._store.dispatch(
          TaskSharedActions.unscheduleTask({
            id: task.id,
            today: this._date.todayStr(),
            isSkipToast: true,
            isLeaveInToday: false,
          }),
        );
        break;
      case 'deadline': {
        const remindAt = has(args, 'remindAt')
          ? (args['remindAt'] ?? undefined)
          : (task.deadlineRemindAt ?? undefined);
        check(
          remindAt === undefined ||
            Number(remindAt) <=
              Number(args['at'] ?? Date.parse(String(args['day']) + 'T23:59:59Z')),
          'Preserved reminder would follow the deadline; explicitly clear it.',
        );
        context.markMutation();
        this._store.dispatch(
          TaskSharedActions.setDeadline({
            taskId: task.id,
            deadlineDay: args['day'] as string | undefined,
            deadlineWithTime: args['at'] as number | undefined,
            deadlineRemindAt: remindAt as number | undefined,
            autoPlanToday: this._date.todayStr(),
            autoPlanStartOfNextDayDiffMs: this._date.getStartOfNextDayDiffMs(),
            isSkipSnack: true,
          }),
        );
        break;
      }
      case 'clear_deadline':
        context.markMutation();
        this._store.dispatch(
          TaskSharedActions.removeDeadline({ taskId: task.id, isSkipSnack: true }),
        );
        break;
      case 'move_project':
        check(!task.parentId, 'Move the parent task to move this subtask project.');
        this._availableProject(String(args['projectId']));
        context.markMutation();
        this._taskService.moveToProject(task, String(args['projectId']));
        break;
      case 'set_tags': {
        check(!task.parentId, 'Subtask tags are inherited from the parent.');
        const ids = args['tagIds'] as string[];
        check(
          ids.every(
            (id) => !SYSTEM_TAG_IDS.has(id) && this._tags.tags().some((t) => t.id === id),
          ),
          'Use existing ordinary tags only.',
        );
        context.markMutation();
        this._taskService.updateTags(task, ids);
        break;
      }
      case 'duplicate': {
        check(
          !task.parentId && !task.isDone,
          'Native duplication requires an unfinished top-level task.',
        );
        this._availableProject(task.projectId);
        const copy = this._copy(task, task.title + ' (copy)');
        context.markMutation();
        this._store.dispatch(
          TaskSharedActions.addTask({
            task: copy,
            workContextId: task.projectId,
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: false,
            isIgnoreShortSyntax: true,
          }),
        );
        for (const child of task.subTasks) {
          const newChild = this._copy(child, child.title, copy.id);
          this._store.dispatch(
            addSubTask({ task: newChild, parentId: copy.id, isIgnoreShortSyntax: true }),
          );
          if (newChild.dueDay)
            this._store.dispatch(
              PlannerActions.planTaskForDay({ task: newChild, day: newChild.dueDay }),
            );
        }
        result['taskId'] = copy.id;
        break;
      }
      case 'archive':
        check(!task.parentId, 'Archive the parent and its children together.');
        await this._taskService.moveToArchive(task, {
          beforeWrite: async () => {
            await context.authorize();
            unchanged();
          },
          atWrite: () => {
            unchanged();
            context.markMutation();
          },
          beforeRemove: unchanged,
        });
        break;
      case 'delete':
        context.markMutation();
        this._taskService.remove(task);
        break;
      default:
        throw new ControlError('INVALID_ARGUMENTS', 'Unsupported task command.');
    }
    return result;
  }

  private _copy(source: Task, title: string, parentId?: string): Task {
    return this._taskService.createNewTaskWithDefaults({
      title,
      workContextId: source.projectId,
      workContextType: WorkContextType.PROJECT,
      additional: {
        projectId: source.projectId,
        parentId,
        notes: source.notes,
        priority: source.priority,
        tagIds: parentId ? [] : source.tagIds,
        timeEstimate: source.subTaskIds.length ? 0 : source.timeEstimate,
        dueDay: source.dueDay,
        dueWithTime: source.dueWithTime,
        ...(parentId
          ? { isDone: source.isDone, doneOn: source.doneOn, wontDoOn: source.wontDoOn }
          : {}),
      },
    });
  }

  private _attachment(
    task: Task,
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Record<string, unknown> {
    const id = String(args['attachmentId']);
    if (args['command'] !== 'add')
      check(
        task.attachments.some((a) => a.id === id),
        'Attachment not found.',
      );
    context.markMutation();
    if (args['command'] === 'add')
      this._attachments.addAttachment(task.id, {
        ...(args['attachment'] as TaskAttachment),
        id: null,
      });
    else if (args['command'] === 'update')
      this._attachments.updateAttachment(
        task.id,
        id,
        args['attachment'] as Partial<TaskAttachment>,
      );
    else this._attachments.deleteAttachment(task.id, id);
    return { taskId: task.id, command: args['command'] };
  }

  private _structure(
    task: Task,
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Record<string, unknown> {
    const afterTaskId = (args['afterTaskId'] as string | null | undefined) ?? null;
    const command = String(args['command']);
    let action;
    if (command === 'add_subtask') {
      check(!task.parentId, 'Nested subtasks are unsupported.');
      this._availableProject(task.projectId);
      const child = this._taskService.createNewTaskWithDefaults({
        title: String(args['title']),
        workContextId: task.projectId,
        workContextType: WorkContextType.PROJECT,
        additional: { parentId: task.id, projectId: task.projectId, tagIds: [] },
      });
      context.markMutation();
      this._store.dispatch(
        addSubTask({ task: child, parentId: task.id, isIgnoreShortSyntax: true }),
      );
      return { taskId: child.id, parentId: task.id };
    }
    if (command === 'reparent') {
      const parent = this._task(args['parentId']);
      this._availableProject(parent.projectId);
      check(
        parent.id !== task.id &&
          !parent.parentId &&
          !task.subTaskIds.length &&
          !task.repeatCfgId,
        'Only a non-repeating leaf can become a subtask of a different top-level task.',
      );
      check(
        afterTaskId === null ||
          (afterTaskId !== task.id && parent.subTaskIds.includes(afterTaskId)),
        'Invalid sibling anchor.',
      );
      action = task.parentId
        ? moveSubTask({
            taskId: task.id,
            srcTaskId: task.parentId,
            targetTaskId: parent.id,
            afterTaskId,
          })
        : TaskSharedActions.convertToSubTask({
            taskId: task.id,
            targetParentId: parent.id,
            afterTaskId,
          });
    } else if (command === 'detach') {
      check(!!task.parentId, 'Task is already top-level.');
      const parent = this._task(task.parentId);
      action = TaskSharedActions.convertToMainTask({
        task,
        parentTagIds: parent.tagIds,
        isPlanForToday: false,
        today: this._date.todayStr(),
        modified: Date.now(),
      });
    } else if (command === 'reorder' && task.parentId) {
      const parent = this._task(task.parentId);
      check(
        afterTaskId === null ||
          (afterTaskId !== task.id && parent.subTaskIds.includes(afterTaskId)),
        'Invalid sibling anchor.',
      );
      check(
        !['contextId', 'contextType', 'source', 'target'].some((key) => has(args, key)),
        'Subtask reorder uses parent order only.',
      );
      action = moveSubTask({
        taskId: task.id,
        srcTaskId: parent.id,
        targetTaskId: parent.id,
        afterTaskId,
      });
    } else if (command === 'set_section') {
      this._setSection(task, args, context, afterTaskId);
      return { taskId: task.id, command };
    } else {
      check(command === 'reorder' && !task.parentId, 'Unsupported structure command.');
      check(
        ['contextId', 'contextType', 'source', 'target', 'afterTaskId'].every((key) =>
          has(args, key),
        ),
        'Explicit list context and anchor required.',
      );
      const workContextId = String(args['contextId']);
      const workContextType = args['contextType'] as WorkContextType;
      const src = args['source'] as DropListModelSource,
        target = args['target'] as DropListModelSource;
      const list = this._context(task, workContextId, workContextType);
      check(
        (src !== 'BACKLOG' && target !== 'BACKLOG') || list.isEnableBacklog,
        'Project backlog is disabled.',
      );
      check(
        workContextType === WorkContextType.PROJECT ||
          (src !== 'BACKLOG' && target !== 'BACKLOG'),
        'Tag contexts have no backlog.',
      );
      const sourceIds = src === 'BACKLOG' ? list.backlogTaskIds : list.taskIds;
      const targetIds = target === 'BACKLOG' ? list.backlogTaskIds : list.taskIds;
      check(
        sourceIds.includes(task.id) &&
          (afterTaskId === null ||
            (afterTaskId !== task.id && targetIds.includes(afterTaskId))),
        'Invalid list membership or anchor.',
      );
      const fields = { taskId: task.id, afterTaskId, workContextId };
      if (src === 'BACKLOG' && target === 'BACKLOG')
        action = moveProjectTaskInBacklogList(fields);
      else if (target === 'BACKLOG') action = moveProjectTaskToBacklogList(fields);
      else if (src === 'BACKLOG')
        action = moveProjectTaskToRegularList({ ...fields, src, target });
      else action = moveTaskInTodayList({ ...fields, workContextType, src, target });
    }
    context.markMutation();
    this._store.dispatch(action);
    return { taskId: task.id, command };
  }

  private _setSection(
    task: Task,
    args: Record<string, unknown>,
    context: AssistantControlContext,
    afterTaskId: string | null,
  ): void {
    check(!task.parentId, 'Sections contain top-level tasks only.');
    const contextId = String(args['contextId']),
      contextType = args['contextType'] as WorkContextType;
    const list = this._context(task, contextId, contextType);
    check(
      contextType === WorkContextType.PROJECT || contextId === 'TODAY',
      'Sections belong to projects or Today only.',
    );
    const sections = Object.values(this._sections().entities).filter(
      (s) => s?.contextId === contextId && s.contextType === contextType,
    );
    const source = sections.find((s) => s?.taskIds.includes(task.id));
    const target =
      args['sectionId'] === null
        ? undefined
        : sections.find((s) => s?.id === args['sectionId']);
    check(args['sectionId'] === null || !!target, 'Section not found in context.');
    const targetIds = target?.taskIds ?? list.taskIds;
    check(
      afterTaskId === null ||
        (afterTaskId !== task.id && targetIds.includes(afterTaskId)),
      'Invalid section anchor.',
    );
    check(!!target || !!source, 'Task is already outside sections.');
    context.markMutation();
    if (target)
      this._sectionService.addTaskToSection(
        target.id,
        task.id,
        afterTaskId,
        source?.id ?? null,
      );
    else
      this._sectionService.removeTaskFromSection(
        source!.id,
        task.id,
        contextId,
        contextType,
        afterTaskId,
      );
  }

  private async _archived(
    args: Record<string, unknown>,
    context: AssistantControlContext,
  ): Promise<Record<string, unknown>> {
    const version = this._archive.mutationVersion;
    requireValue(!this._archive.mutationPending, 'APP_BUSY', 'Archive is being written.');
    const all = await this._taskService.getArchivedTasks();
    const task = all.find((t) => t.id === args['taskId']);
    if (args['command'] === 'read') {
      if (args['taskId']) {
        requireValue(task, 'TASK_NOT_FOUND', 'Archived task not found.');
        return { ...(await this._view(task, all)), location: 'archive' };
      }
      const limit = Number(args['limit'] ?? 100);
      const offset = Number(args['offset'] ?? 0);
      return {
        tasks: await Promise.all(
          all.slice(offset, offset + limit).map((t) => this._view(t, all)),
        ),
        total: all.length,
        truncated: all.length > offset + limit,
        nextOffset: all.length > offset + limit ? offset + limit : null,
        location: 'archive',
      };
    }
    check(
      args['command'] === 'restore',
      'Restore archived tasks before editing or deleting them.',
    );
    requireValue(task, 'TASK_NOT_FOUND', 'Archived task not found.');
    check(!task.parentId, 'Restore the archived parent with its children.');
    const tree = this._tree(task, all);
    requireValue(
      args['expectedRevision'] === (await this._revision(task, all)),
      'STALE_DATA',
      'Archived task changed.',
    );
    this._availableProject(task.projectId);
    const projects = this._projectsState(),
      sections = this._sections();
    await context.authorize();
    requireValue(
      this._archive.mutationVersion === version &&
        !this._archive.mutationPending &&
        this._projectsState() === projects &&
        this._sections() === sections &&
        [task, ...tree.subTasks].every((t) => !this._tasks().entities[t.id]),
      'STALE_DATA',
      'Archive or target changed during authorization.',
    );
    context.markMutation();
    this._taskService.restoreTask(task, tree.subTasks);
    return { taskId: task.id, command: 'restore' };
  }
}
