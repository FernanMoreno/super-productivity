import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Store } from '@ngrx/store';
import { LocalRestApiPlannerRoutesService } from './local-rest-api-planner-routes.service';
import { PluginUserPersistenceService } from '../plugin-user-persistence.service';
import { TaskService } from '../../features/tasks/task.service';
import { TaskArchiveService } from '../../features/archive/task-archive.service';
import { ArchiveStoreService } from '../../op-log/persistence/archive-store.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { ProjectService } from '../../features/project/project.service';
import { TagService } from '../../features/tag/tag.service';
import { TaskMoveToProjectService } from '../../features/tasks/task-move-to-project.service';
import { DateService } from '../../core/date/date.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { OperationCaptureService } from '../../op-log/capture/operation-capture.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { DEFAULT_TASK } from '../../features/tasks/task.model';
import { AssistantAccessScope } from '../../../../electron/shared-with-frontend/assistant-access.model';
import { LocalRestApiRequestPayload } from '../../../../electron/shared-with-frontend/local-rest-api.model';

describe('LocalRestApiPlannerRoutesService', () => {
  const grants: AssistantAccessScope[] = [
    'planner:read',
    'planner:write',
    'tasks:read',
    'tasks:read_history',
    'tasks:write',
    'time:write',
  ];
  let service: LocalRestApiPlannerRoutesService;
  let storage: Map<string, string>;
  let access: AssistantAccessScope[];
  let taskState: ReturnType<typeof signal>;
  let dispatch: jasmine.Spy;
  let addTime: jasmine.Spy;
  let archiveLoad: jasmine.Spy;
  let flush: jasmine.Spy;
  let archive: { mutationVersion: number; mutationPending: boolean };
  let onBeforeCas: ((key: string) => void) | undefined;
  const request = (
    action: string,
    params: Record<string, unknown> = {},
    source: 'mcp' | undefined = 'mcp',
  ): LocalRestApiRequestPayload => ({
    requestId: 'test',
    method: 'POST',
    path: '/assistant/planner',
    query: {},
    source,
    body: { action, params, grantedScopes: grants },
  });
  const data = async (
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const result = await service.handle(request(action, params));
    if (!result?.body.ok) throw Error('route failed');
    return result.body.data as Record<string, unknown>;
  };
  beforeEach(() => {
    storage = new Map();
    onBeforeCas = undefined;
    access = [...grants];
    taskState = signal({
      ids: ['task-example'],
      entities: {
        ['task-example']: {
          ...DEFAULT_TASK,
          id: 'task-example',
          title: 'Ficticia',
          projectId: 'INBOX_PROJECT',
          tagIds: ['tag-example'],
        },
      },
    });
    dispatch = jasmine.createSpy('dispatch');
    addTime = jasmine.createSpy('addTimeSpentAndSync');
    archiveLoad = jasmine.createSpy().and.resolveTo({ ids: [], entities: {} });
    flush = jasmine.createSpy().and.resolveTo();
    archive = { mutationVersion: 0, mutationPending: false };
    (window as unknown as { ea: unknown }).ea = {
      getAssistantAccessState: async () => ({ isEnabled: true, scopes: access }),
    };
    TestBed.configureTestingModule({
      providers: [
        LocalRestApiPlannerRoutesService,
        { provide: Store, useValue: { selectSignal: () => taskState, dispatch } },
        {
          provide: PluginUserPersistenceService,
          useValue: {
            loadPluginUserData: async (key: string) => storage.get(key) ?? null,
            compareAndSwapPluginUserData: async (
              key: string,
              expected: string | null,
              next: string,
              before?: () => Promise<void>,
              atDispatch?: () => void,
            ) => {
              onBeforeCas?.(key);
              await before?.();
              atDispatch?.();
              if ((storage.get(key) ?? null) !== expected) return false;
              storage.set(key, next);
              return true;
            },
          },
        },
        {
          provide: TaskService,
          useValue: {
            addTimeSpentAndSync: addTime,
            createNewTaskWithDefaults: ({
              title,
              additional,
            }: {
              title: string;
              additional: object;
            }) => ({ ...DEFAULT_TASK, id: 'created-task', title, ...additional }),
            update: jasmine.createSpy(),
          },
        },
        { provide: TaskArchiveService, useValue: { load: archiveLoad } },
        { provide: ArchiveStoreService, useValue: archive },
        {
          provide: GlobalConfigService,
          useValue: {
            cfg: signal({
              misc: { startOfNextDayTime: '00:00' },
              timeTracking: { defaultEstimate: 0 },
            }),
          },
        },
        {
          provide: ProjectService,
          useValue: {
            list: () => [
              { id: 'INBOX_PROJECT', isArchived: false },
              { id: 'project-other', isArchived: false },
            ],
          },
        },
        { provide: TagService, useValue: { tags: () => [{ id: 'tag-example' }] } },
        {
          provide: TaskMoveToProjectService,
          useValue: { moveToProject: jasmine.createSpy().and.resolveTo(true) },
        },
        { provide: DateService, useValue: { todayStr: () => '2026-11-02' } },
        {
          provide: HydrationStateService,
          useValue: { isApplyingRemoteOps: () => false },
        },
        {
          provide: OperationCaptureService,
          useValue: { hasUnrecoveredPersistFailure: () => false },
        },
        { provide: OperationWriteFlushService, useValue: { flushPendingWrites: flush } },
      ],
    });
    service = TestBed.inject(LocalRestApiPlannerRoutesService);
  });
  afterEach(() => delete (window as unknown as { ea?: unknown }).ea);
  it('is inaccessible over plain REST and rejects scopes supplied without a live main grant', async () => {
    const rest = request('activities');
    delete rest.source;
    expect(await service.handle(rest)).toBeUndefined();
    access = [];
    const result = await service.handle(request('activities'));
    expect(result?.body.ok).toBeFalse();
    expect(storage.size).toBe(0);
  });
  it('does not expose profile import through MCP or misreport archive access failures', async () => {
    const initial = await data('activities');
    const blocked = await data('edit', {
      operationId: 'blocked-profile-import',
      baseRevision: initial['revision'],
      command: { type: 'profile.replace', payload: initial['profile'] },
    });
    expect(blocked['status']).toBe('rejected');
    expect(storage.size).toBe(0);
    archiveLoad.and.rejectWith(Error('archive denied'));
    const unavailable = await data('query', { from: '2026-11-02', to: '2026-11-02' });
    expect(unavailable['code']).toBe('DATA_UNAVAILABLE');
  });

  it('starts empty and journals edits separately from the profile', async () => {
    const current = await data('activities');
    expect((current['profile'] as { areas: unknown[] }).areas.length).toBe(0);
    const args = {
      operationId: 'create-activity-op',
      baseRevision: current['revision'],
      command: {
        type: 'activity.create',
        payload: { id: 'activity-example', name: 'Ejemplo' },
      },
    };
    expect((await data('edit', args))['status']).toBe('applied');
    expect((await data('edit', args))['replayed']).toBeTrue();
    expect(storage.has('personal-planner:profile-v1')).toBeTrue();
    expect(storage.has('personal-planner:op-create-activity-op')).toBeTrue();
  });
  it('rejects unsafe native fields and records time only through the native path once', async () => {
    const initial = await data('activities');
    await data('edit', {
      operationId: 'create-area-for-time',
      baseRevision: initial['revision'],
      command: {
        type: 'activity.create',
        payload: { id: 'activity-example', name: 'Ejemplo' },
      },
    });
    const timezoneRevision = await data('activities');
    await data('edit', {
      operationId: 'align-timezone-op',
      baseRevision: timezoneRevision['revision'],
      command: {
        type: 'preferences.update',
        payload: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
    });
    const current = await data('activities');
    await data('edit', {
      operationId: 'associate-area-op',
      baseRevision: current['revision'],
      command: {
        type: 'activity.update',
        payload: { id: 'activity-example', updates: { tagIds: ['tag-example'] } },
      },
    });
    expect(
      (
        await data('task', {
          operationId: 'invalid-task-fields',
          fields: { timeSpent: 123 },
        })
      )['status'],
    ).toBe('rejected');
    const args = {
      operationId: 'record-time-example',
      activityId: 'activity-example',
      taskId: 'task-example',
      date: '2026-11-01',
      durationMs: 60000,
    };
    expect((await data('log_time', args))['status']).toBe('applied');
    expect((await data('log_time', args))['replayed']).toBeTrue();
    expect(addTime).toHaveBeenCalledTimes(1);
    expect(addTime.calls.mostRecent().args.slice(1)).toEqual([60000, '2026-11-01']);
    expect(flush).toHaveBeenCalled();
  });
  it('queries archived time without returning task notes and rejects stale archive reads', async () => {
    archiveLoad.and.resolveTo({
      ids: ['archived-example'],
      entities: {
        ['archived-example']: {
          ...DEFAULT_TASK,
          id: 'archived-example',
          title: 'Archivo',
          notes: 'Private note',
          timeSpent: 60000,
          timeSpentOnDay: { ['2026-11-02']: 60000 },
          dueDay: '2026-11-02',
        },
      },
    });
    const result = await data('query', { from: '2026-11-02', to: '2026-11-02' });
    expect(JSON.stringify(result)).not.toContain('Private note');
    expect(JSON.stringify(result)).toContain('archived-example');
    archiveLoad.and.callFake(async () => {
      archive.mutationVersion++;
      return { ids: [], entities: {} };
    });
    const rejected = await service.handle(
      request('prepare', { from: '2026-11-02', to: '2026-11-02' }),
    );
    expect(rejected?.body.ok).toBeTrue();
    if (rejected?.body.ok)
      expect((rejected.body.data as { code: string }).code).toBe('STALE_PLAN');
  });
  it('creates literal native tasks without parsing short syntax or leaking task data', async () => {
    const args = {
      operationId: 'literal-task-create',
      fields: { title: 'Ejemplo #literal +literal' },
    };
    const result = await data('task', args);
    expect(result['status']).toBe('applied');
    expect(result['taskId']).toBe('created-task');
    expect(result['profile']).toBeUndefined();
    expect(result['task']).toBeUndefined();
    const action = dispatch.calls.mostRecent().args[0];
    expect(action.isIgnoreShortSyntax).toBeTrue();
    expect(action.task.title).toBe(args.fields.title);
    expect(action.workContextId).toBe('INBOX_PROJECT');
    await data('task', args);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('rejects recorded time when the configured calendar cannot certify host civil days', async () => {
    const current = await data('activities');
    await data('edit', {
      operationId: 'incompatible-zone-op',
      baseRevision: current['revision'],
      command: {
        type: 'preferences.update',
        payload: {
          timezone:
            Intl.DateTimeFormat().resolvedOptions().timeZone === 'Pacific/Honolulu'
              ? 'Europe/Madrid'
              : 'Pacific/Honolulu',
        },
      },
    });
    const result = await data('log_time', {
      operationId: 'incompatible-time-op',
      activityId: 'activity-example',
      taskId: 'task-example',
      date: '2026-11-01',
      durationMs: 60000,
    });
    expect(result['status']).toBe('rejected');
    expect(addTime).not.toHaveBeenCalled();
  });

  it('rejects time writes to parent tasks without touching native tracking', async () => {
    const initial = await data('activities');
    storage.set(
      'personal-planner:profile-v1',
      JSON.stringify({
        ...(initial['profile'] as object),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    );
    taskState.set({
      ids: ['task-example'],
      entities: {
        ['task-example']: {
          ...DEFAULT_TASK,
          id: 'task-example',
          subTaskIds: ['child-example'],
        },
      },
    });
    const result = await data('log_time', {
      operationId: 'parent-time-rejected',
      activityId: 'activity-example',
      taskId: 'task-example',
      date: '2026-11-01',
      durationMs: 60000,
    });
    expect(result['status']).toBe('rejected');
    expect(addTime).not.toHaveBeenCalled();
    expect(result['message']).toContain('superior');
  });

  it('rechecks apply permissions during the final CAS instead of accepting edit-only grants', async () => {
    const initial = await data('activities');
    await data('edit', {
      operationId: 'create-proposed-area',
      baseRevision: initial['revision'],
      command: {
        type: 'activity.create',
        payload: { id: 'activity-example', name: 'Ejemplo' },
      },
    });
    const current = await data('activities');
    await data('edit', {
      operationId: 'set-proposed-goals',
      baseRevision: current['revision'],
      command: {
        type: 'activity.goals',
        payload: {
          id: 'activity-example',
          from: '2026-01-01',
          goals: { dailyMinutes: 30, weeklyMinutes: null, targetHours: null },
        },
      },
    });
    const plan = await data('prepare', { from: '2026-11-02', to: '2026-11-02' });
    const proposals = plan['proposals'] as { id: string; interval: unknown }[];
    onBeforeCas = (key) => {
      if (key === 'personal-planner:profile-v1')
        access = access.filter((scope) => scope !== 'tasks:read_history');
    };
    const result = await data('apply', {
      operationId: 'revoked-apply-op',
      proposalId: plan['proposalId'],
      selection: [proposals.find((item) => item.interval)!.id],
    });
    expect(result['status']).toBe('rejected');
    expect(result['code']).toBe('NOT_PERMITTED');
    const stored = JSON.parse(storage.get('personal-planner:profile-v1')!);
    expect(stored.commitments.length).toBe(0);
  });

  it('requires explicit scope before moving a recurring task', async () => {
    taskState.set({
      ids: ['task-example'],
      entities: {
        ['task-example']: {
          ...DEFAULT_TASK,
          id: 'task-example',
          title: 'Ficticia',
          projectId: 'INBOX_PROJECT',
          repeatCfgId: 'repeat-example',
        },
      },
    });
    const result = await data('task', {
      operationId: 'reject-series-project-move',
      taskId: 'task-example',
      fields: { projectId: 'project-other' },
    });
    expect(result['status']).toBe('rejected');
    expect(result['code']).toBe('INVALID_ARGUMENTS');
    expect(TestBed.inject(TaskMoveToProjectService).moveToProject).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('uses TaskService.update for native tag and status changes on a subtask', async () => {
    taskState.set({
      ids: ['task-example'],
      entities: {
        ['task-example']: {
          ...DEFAULT_TASK,
          id: 'task-example',
          parentId: 'parent-example',
          projectId: 'INBOX_PROJECT',
        },
      },
    });
    const result = await data('task', {
      operationId: 'native-subtask-tag-update',
      taskId: 'task-example',
      fields: { tagIds: ['tag-example'], isDone: false },
    });
    expect(result['status']).toBe('applied');
    expect(TestBed.inject(TaskService).update).toHaveBeenCalledOnceWith('task-example', {
      tagIds: ['tag-example'],
      isDone: false,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('changes a timed task to a day-only native plan', async () => {
    taskState.set({
      ids: ['task-example'],
      entities: {
        ['task-example']: {
          ...DEFAULT_TASK,
          id: 'task-example',
          projectId: 'INBOX_PROJECT',
          dueWithTime: Date.UTC(2026, 10, 2, 10),
        },
      },
    });
    const result = await data('task', {
      operationId: 'reject-timed-task-day-change',
      taskId: 'task-example',
      fields: { dueDay: '2026-11-04' },
    });
    expect(result['status']).toBe('applied');
    expect(TestBed.inject(TaskService).update).not.toHaveBeenCalled();
    expect(dispatch.calls.mostRecent().args[0].type).toBe('[Planner] Plan Task for Day');
    expect(dispatch.calls.mostRecent().args[0].day).toBe('2026-11-04');
  });

  it('does not confirm a native mutation when durable flushing fails', async () => {
    flush.and.rejectWith(Error('disk failure'));
    const result = await data('task', {
      operationId: 'create-with-disk-failure',
      fields: { title: 'Ficticia' },
    });
    expect(result['status']).toBe('uncertain');
    expect(
      (
        await data('task', {
          operationId: 'create-with-disk-failure',
          fields: { title: 'Ficticia' },
        })
      )['status'],
    ).toBe('uncertain');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
