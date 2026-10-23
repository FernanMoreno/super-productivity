import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of, throwError } from 'rxjs';
import { IssueService } from '../../features/issue/issue.service';
import { TaskService } from '../../features/tasks/task.service';
import { JiraApiService } from '../../features/issue/providers/jira/jira-api.service';
import { IssueSyncAdapterResolverService } from '../../features/issue/two-way-sync/issue-sync-adapter-resolver.service';
import { PluginIssueProviderRegistryService } from '../issue-provider/plugin-issue-provider-registry.service';
import { WorkflowIntegrationService } from './workflow-integration.service';
import { PluginHttpService } from '../issue-provider/plugin-http.service';
import {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '../issue-provider/plugin-issue-provider.model';

describe('WorkflowIntegrationService', () => {
  let actualTrello: IssueProviderPluginDefinition;
  beforeAll(async () => {
    const scope = globalThis as unknown as Record<string, unknown>;
    const previous = scope['PluginAPI'];
    scope['PluginAPI'] = {
      registerIssueProvider: (definition: IssueProviderPluginDefinition) => {
        actualTrello = definition;
      },
      translate: (key: string) => key,
    };
    try {
      await import('../../../../packages/plugin-dev/trello-issue-provider/src/plugin');
    } finally {
      scope['PluginAPI'] = previous;
    }
  });
  let service: WorkflowIntegrationService;
  let task: Record<string, unknown>;
  let issue: Record<string, unknown>;
  let providers: Record<string, unknown>[];
  let revoked: boolean;
  const authorize = async (): Promise<void> => {
    if (revoked) throw new Error('revoked');
  };
  let update: jasmine.Spy;
  let duplicate: jasmine.Spy;
  let fetchIssue: jasmine.Spy;
  let transition: jasmine.Spy;
  let transitions: jasmine.Spy;
  let push: jasmine.Spy;
  let direction: string;
  let lists: jasmine.Spy;
  let moveIssue: jasmine.Spy;
  let httpPut: jasmine.Spy;

  beforeEach(() => {
    task = { id: 'task', title: 'Keep my title', isDone: false };
    issue = {
      id: '123',
      key: 'ABC-1',
      status: { id: '1', name: 'Open' },
      secret: 'SECRET',
    };
    providers = [
      {
        id: 'jira',
        issueProviderKey: 'JIRA',
        isEnabled: true,
        isTransitionIssuesEnabled: true,
        token: 'SECRET',
      },
    ];
    revoked = false;
    direction = 'both';
    lists = jasmine
      .createSpy('lists')
      .and.resolveTo([{ label: 'Doing', value: 'list-b' }]);
    httpPut = jasmine.createSpy('httpPut').and.callFake(async (_url, body) => {
      issue = { ...issue, idList: body.idList };
    });
    moveIssue = jasmine
      .createSpy('moveIssue')
      .and.callFake(async (id, changes, _config, http) =>
        http.put(`https://api.trello.com/1/cards/${id}`, { idList: changes.idList }),
      );
    update = jasmine.createSpy('update');
    duplicate = jasmine.createSpy('duplicate').and.resolveTo(null);
    fetchIssue = jasmine.createSpy('fetchIssue').and.callFake(async () => issue);
    transition = jasmine.createSpy('transition').and.callFake(() => {
      issue = { ...issue, status: { id: '2', name: 'Done' } };
      return of({});
    });
    transitions = jasmine
      .createSpy('transitions')
      .and.returnValue(
        of([{ id: '31', name: 'Finish', to: { id: '2', name: 'Done' }, fields: {} }]),
      );
    push = jasmine.createSpy('push').and.callFake(async () => {
      issue = { ...issue, state: 'closed' };
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: Store, useValue: { selectSignal: () => () => providers } },
        {
          provide: TaskService,
          useValue: {
            getByIdOnce$: () => of(task),
            update,
            checkForTaskWithIssueEverywhere: duplicate,
          },
        },
        {
          provide: IssueService,
          useValue: {
            getById: fetchIssue,
            issueLink: async () => 'https://example.test/issue',
          },
        },
        {
          provide: JiraApiService,
          useValue: {
            getTransitionsForIssue$: transitions,
            transitionIssue$: transition,
          },
        },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: {
            hasProvider: () => true,
            getProvider: () => ({
              definition: {
                configFields: [{ key: 'defaultListId', loadOptions: lists }],
                getHeaders: () => ({ Authorization: 'SECRET' }),
                updateIssue: moveIssue,
              },
            }),
          },
        },
        {
          provide: PluginHttpService,
          useValue: { createHttpHelper: () => ({ put: httpPut }) },
        },
        {
          provide: IssueSyncAdapterResolverService,
          useValue: {
            getAdapter: () => ({
              fetchIssue,
              pushChanges: push,
              getSyncConfig: () => ({ isDone: direction }),
              getFieldMappings: () => [
                {
                  taskField: 'isDone',
                  issueField: 'state',
                  defaultDirection: 'both',
                  toIssueValue: (done: boolean) => (done ? 'closed' : 'open'),
                },
              ],
            }),
          },
        },
      ],
    });
    service = TestBed.inject(WorkflowIntegrationService);
  });
  const command = (
    type: string,
    payload: Record<string, unknown>,
  ): { type: string; payload: Record<string, unknown> } => ({ type, payload });
  const linked = (): void => {
    task = { ...task, issueId: '123', issueType: 'JIRA', issueProviderId: 'jira' };
  };
  const linkedTrello = (): void => {
    providers = [
      {
        id: 'trello',
        issueProviderKey: 'TRELLO',
        isEnabled: true,
        pluginConfig: { token: 'SECRET', apiKey: 'SECRET', boardId: 'configured-board' },
      },
    ];
    task = {
      ...task,
      issueId: 'short123',
      issueType: 'TRELLO',
      issueProviderId: 'trello',
    };
    issue = { id: 'short123', state: 'open', idBoard: 'board-a', idList: 'list-a' };
  };
  const move = (): { type: string; payload: Record<string, unknown> } =>
    command('integration.move', {
      taskId: 'task',
      targetListId: 'list-b',
      expectedListId: 'list-a',
      expectedBoardId: 'board-a',
    });

  it('discovers Trello lists using the linked card board without exposing credentials', async () => {
    linkedTrello();
    const result = await service.query('task', authorize);
    expect(result['boardId']).toBe('board-a');
    expect(result['listId']).toBe('list-a');
    expect(result['lists']).toEqual([{ id: 'list-b', name: 'Doing', supported: true }]);
    expect(lists.calls.mostRecent().args[0].boardId).toBe('board-a');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it('moves only list membership and verifies the resulting remote board and list', async () => {
    linkedTrello();
    const result = await service.execute(move(), { authorize });
    expect(moveIssue.calls.mostRecent().args.slice(0, 2)).toEqual([
      'short123',
      { idList: 'list-b', expectedListId: 'list-a', expectedBoardId: 'board-a' },
    ]);
    expect(httpPut).toHaveBeenCalledWith(
      'https://api.trello.com/1/cards/short123',
      { idList: 'list-b' },
      undefined,
    );
    expect(result['listId']).toBe('list-b');
    expect(result['status']).toBe('open');
    expect(update.calls.mostRecent().args[1]).toEqual({ issueWasUpdated: false });
  });
  it('composes the actual Trello plugin with host discovery, preflight, write fence and verification', async () => {
    linkedTrello();
    issue = {
      id: 'long-id',
      shortLink: 'short123',
      name: 'Remote title',
      closed: false,
      idBoard: 'board-a',
      idList: 'list-a',
    };
    const get = jasmine.createSpy('httpGet').and.callFake(async (url: string) => {
      if (url.endsWith('/boards/board-a/lists'))
        return [{ id: 'list-b', name: 'Doing', closed: false, idBoard: 'board-a' }];
      if (url.endsWith('/lists/list-b')) return { idBoard: 'board-a', closed: false };
      return { ...issue };
    });
    const http = { get, put: httpPut } as unknown as PluginHttp;
    spyOn(TestBed.inject(PluginHttpService), 'createHttpHelper').and.returnValue(http);
    const registered = TestBed.inject(PluginIssueProviderRegistryService).getProvider(
      'TRELLO',
    )!;
    spyOn(
      TestBed.inject(PluginIssueProviderRegistryService),
      'getProvider',
    ).and.returnValue({ ...registered, definition: actualTrello });
    fetchIssue.and.callFake(async () => actualTrello.getById('short123', {}, http));
    const available = await service.query('task', authorize);
    expect(available['lists']).toEqual([
      { id: 'list-b', name: 'Doing', supported: true },
    ]);
    const atMutation = jasmine.createSpy('atMutation');
    const result = await service.execute(move(), { authorize, atMutation });
    expect(httpPut).toHaveBeenCalledOnceWith(
      'https://api.trello.com/1/cards/short123',
      { idList: 'list-b' },
      undefined,
    );
    expect(result['listId']).toBe('list-b');
    expect(result['status']).toBe('open');
    expect(atMutation).toHaveBeenCalled();
    expect(update.calls.mostRecent().args[1]).toEqual({ issueWasUpdated: false });
  });
  it('rejects stale Trello list or board snapshots before writing', async () => {
    linkedTrello();
    for (const change of [
      { expectedListId: 'old-list' },
      { expectedBoardId: 'old-board' },
    ]) {
      const request = move();
      Object.assign(request.payload, change);
      await expectAsync(service.execute(request, { authorize })).toBeRejectedWith(
        jasmine.objectContaining({ code: 'STALE_REMOTE' }),
      );
    }
    expect(httpPut).not.toHaveBeenCalled();
  });
  it('rejects unavailable destinations, archived cards and disabled Trello pushes', async () => {
    linkedTrello();
    lists.and.resolveTo([]);
    await expectAsync(service.execute(move(), { authorize })).toBeRejected();
    lists.and.resolveTo([{ label: 'Doing', value: 'list-b' }]);
    issue['state'] = 'closed';
    await expectAsync(service.execute(move(), { authorize })).toBeRejected();
    issue['state'] = 'open';
    direction = 'pullOnly';
    await expectAsync(service.execute(move(), { authorize })).toBeRejected();
    expect(httpPut).not.toHaveBeenCalled();
  });
  it('reauthorizes after provider preflight immediately before the Trello PUT', async () => {
    linkedTrello();
    moveIssue.and.callFake(async (id, changes, _config, http) => {
      revoked = true;
      await http.put(`https://api.trello.com/1/cards/${id}`, { idList: changes.idList });
    });
    const atMutation = jasmine.createSpy('atMutation');
    await expectAsync(service.execute(move(), { authorize, atMutation })).toBeRejected();
    expect(httpPut).not.toHaveBeenCalled();
    expect(atMutation).not.toHaveBeenCalled();
  });
  it('keeps an uncertain outcome after an unverified Trello list write', async () => {
    linkedTrello();
    httpPut.and.callFake(async () => {
      throw new Error('SECRET');
    });
    await expectAsync(service.execute(move(), { authorize })).toBeRejectedWith(
      jasmine.objectContaining({ code: 'UNCERTAIN' }),
    );
    expect(update).not.toHaveBeenCalled();
  });
  it('treats wrong post-write list, board or archived state as uncertain', async () => {
    for (const result of [
      { idList: 'wrong' },
      { idList: 'list-b', idBoard: 'wrong' },
      { idList: 'list-b', state: 'closed' },
    ]) {
      linkedTrello();
      httpPut.and.callFake(async () => {
        issue = { ...issue, ...result };
      });
      await expectAsync(service.execute(move(), { authorize })).toBeRejectedWith(
        jasmine.objectContaining({ code: 'UNCERTAIN' }),
      );
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('projects configured metadata without secrets and rejects unsupported providers', async () => {
    expect(JSON.stringify(await service.query())).not.toContain('SECRET');
    await expectAsync(
      service.execute(
        command('integration.link', {
          taskId: 'task',
          providerId: 'unknown',
          issueId: 'ABC-1',
        }),
        { authorize },
      ),
    ).toBeRejected();
    expect(fetchIssue).not.toHaveBeenCalled();
  });
  it('links canonical Jira identity without changing the native title', async () => {
    await service.execute(
      command('integration.link', {
        taskId: 'task',
        providerId: 'jira',
        issueId: 'ABC-1',
      }),
      { authorize },
    );
    expect(duplicate).toHaveBeenCalledWith('123', 'JIRA', 'jira');
    expect(update).toHaveBeenCalledWith(
      'task',
      jasmine.objectContaining({ issueId: '123', issueProviderId: 'jira' }),
    );
    expect(update.calls.mostRecent().args[1].title).toBeUndefined();
    expect(JSON.stringify(update.calls.mostRecent().args[1])).not.toContain('SECRET');
  });
  it('rejects active and archived duplicate associations', async () => {
    for (const isFromArchive of [false, true]) {
      duplicate.and.resolveTo({ task: { id: 'other' }, isFromArchive });
      await expectAsync(
        service.execute(
          command('integration.link', {
            taskId: 'task',
            providerId: 'jira',
            issueId: 'ABC-1',
          }),
          { authorize },
        ),
      ).toBeRejected();
    }
    expect(update).not.toHaveBeenCalled();
  });
  it('rechecks authorization after reads before a native mutation', async () => {
    fetchIssue.and.callFake(async () => {
      revoked = true;
      return issue;
    });
    await expectAsync(
      service.execute(
        command('integration.link', {
          taskId: 'task',
          providerId: 'jira',
          issueId: 'ABC-1',
        }),
        { authorize },
      ),
    ).toBeRejected();
    expect(update).not.toHaveBeenCalled();
  });
  it('checks fresh Jira transitions and confirms the resulting remote status', async () => {
    linked();
    const result = await service.execute(
      command('integration.sync', {
        taskId: 'task',
        targetStatus: '2',
        expectedRemoteStatus: '1',
      }),
      { authorize },
    );
    expect(transitions).toHaveBeenCalledWith('123', providers[0]);
    expect(transition).toHaveBeenCalledWith('123', '31', providers[0]);
    expect(result['status']).toBe('2');
  });
  it('honors disabled and absent Jira transition settings in reads and writes', async () => {
    linked();
    for (const setting of [false, undefined]) {
      providers[0]['isTransitionIssuesEnabled'] = setting;
      const result = await service.query('task', authorize);
      expect(result['statuses']).toEqual([{ id: '2', name: 'Done', supported: false }]);
      await expectAsync(
        service.execute(
          command('integration.sync', { taskId: 'task', targetStatus: '2' }),
          { authorize },
        ),
      ).toBeRejectedWith(jasmine.objectContaining({ code: 'SYNC_DISABLED' }));
    }
    expect(transition).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('projects only HTTPS links without credentials or query strings', async () => {
    const issues = TestBed.inject(IssueService);
    linked();
    const link = spyOn(issues, 'issueLink');
    for (const url of [
      'http://example.test/issue',
      'https://user:SECRET@example.test/issue',
      'https://example.test/issue?token=SECRET',
    ]) {
      link.and.resolveTo(url);
      const result = await service.query('task', authorize);
      expect(result['url']).toBe('');
      expect(JSON.stringify(result)).not.toContain('SECRET');
    }
    link.and.resolveTo('https://example.test/issue');
    expect((await service.query('task', authorize))['url']).toBe(
      'https://example.test/issue',
    );
    expect(update).not.toHaveBeenCalled();
  });
  it('rechecks authorization after fetching allowed transitions', async () => {
    linked();
    transitions.and.callFake(() => {
      revoked = true;
      return of([{ id: '31', to: { id: '2' }, fields: {} }]);
    });
    await expectAsync(
      service.execute(
        command('integration.sync', { taskId: 'task', targetStatus: '2' }),
        { authorize },
      ),
    ).toBeRejected();
    expect(transition).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('leaves an uncertain outcome if authorization is revoked after the remote write', async () => {
    linked();
    transition.and.callFake(() => {
      revoked = true;
      return of({});
    });
    await expectAsync(
      service.execute(
        command('integration.sync', { taskId: 'task', targetStatus: '2' }),
        { authorize },
      ),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'UNCERTAIN' }));
    expect(update).not.toHaveBeenCalled();
  });
  it('does not apply a delayed refresh to a relinked task', async () => {
    linked();
    fetchIssue.and.callFake(async () => {
      task = { ...task, issueId: '456' };
      return issue;
    });
    await expectAsync(
      service.execute(command('integration.refresh', { taskId: 'task' }), { authorize }),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'STALE_NATIVE' }));
    expect(update).not.toHaveBeenCalled();
  });
  it('redacts remote errors and refresh never pushes a remote change', async () => {
    linked();
    fetchIssue.and.rejectWith(new Error('SECRET'));
    await expectAsync(
      service.execute(command('integration.refresh', { taskId: 'task' }), { authorize }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        code: 'REMOTE_READ_FAILED',
        message: 'Integration operation failed (REMOTE_READ_FAILED)',
      }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(transition).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
  it('unlinks using JSON-durable empty native identities and makes no network request', async () => {
    linked();
    await service.execute(command('integration.unlink', { taskId: 'task' }), {
      authorize,
    });
    const patch = JSON.parse(JSON.stringify(update.calls.mostRecent().args[1]));
    expect(patch.issueId).toBe('');
    expect(patch.issueProviderId).toBe('');
    expect(patch.issueLastSyncedValues).toEqual({});
    expect(patch.title).toBeUndefined();
    expect(fetchIssue).not.toHaveBeenCalled();
  });
  it('runs the mutation fence after the final task read', async () => {
    const beforeMutation = jasmine.createSpy('beforeMutation').and.callFake(async () => {
      revoked = true;
      throw new Error('revoked');
    });
    await expectAsync(
      service.execute(
        command('integration.link', {
          taskId: 'task',
          providerId: 'jira',
          issueId: 'ABC-1',
        }),
        { authorize, beforeMutation },
      ),
    ).toBeRejected();
    expect(beforeMutation).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
  it('uses a synchronous final mutation fence and reports native writes', async () => {
    const atMutation = jasmine.createSpy('atMutation').and.throwError('stale');
    const didMutate = jasmine.createSpy('didMutate');
    await expectAsync(
      service.execute(command('integration.unlink', { taskId: 'task' }), {
        authorize,
        atMutation,
        didMutate,
      }),
    ).toBeRejected();
    expect(update).not.toHaveBeenCalled();
    expect(didMutate).not.toHaveBeenCalled();
    atMutation.and.stub();
    await service.execute(command('integration.unlink', { taskId: 'task' }), {
      authorize,
      atMutation,
      didMutate,
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(didMutate).toHaveBeenCalledTimes(1);
  });
  it('rejects Jira transitions needing unsupported extra fields', async () => {
    linked();
    transitions.and.returnValue(
      of([{ id: '31', to: { id: '2' }, fields: { resolution: { required: true } } }]),
    );
    await expectAsync(
      service.execute(
        command('integration.sync', { taskId: 'task', targetStatus: '2' }),
        { authorize },
      ),
    ).toBeRejected();
    expect(transition).not.toHaveBeenCalled();
  });
  it('returns an uncertain safe error for an unconfirmed remote write', async () => {
    linked();
    transition.and.returnValue(throwError(() => new Error('SECRET')));
    await expectAsync(
      service.execute(
        command('integration.sync', { taskId: 'task', targetStatus: '2' }),
        { authorize },
      ),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'UNCERTAIN' }));
    expect(update).not.toHaveBeenCalled();
  });
  it('uses Trello shortLink identity and rejects disabled pushes and list moves', async () => {
    providers = [
      { id: 'trello', issueProviderKey: 'TRELLO', isEnabled: true, pluginConfig: {} },
    ];
    issue = { id: 'long-id', shortLink: 'short123', state: 'open' };
    await service.execute(
      command('integration.link', {
        taskId: 'task',
        providerId: 'trello',
        issueId: 'short123',
      }),
      { authorize },
    );
    expect(update.calls.mostRecent().args[1].issueId).toBe('short123');
    task = {
      ...task,
      issueId: 'short123',
      issueType: 'TRELLO',
      issueProviderId: 'trello',
    };
    direction = 'pullOnly';
    await expectAsync(
      service.execute(
        command('integration.sync', { taskId: 'task', targetStatus: 'closed' }),
        { authorize },
      ),
    ).toBeRejected();
    direction = 'both';
    await expectAsync(
      service.execute(
        command('integration.sync', { taskId: 'task', targetStatus: 'list-123' }),
        { authorize },
      ),
    ).toBeRejected();
    expect(push).not.toHaveBeenCalled();
    providers[0]['pluginConfig'] = { twoWaySync: { isDone: 'invalid' } };
    await expectAsync(
      service.execute(
        command('integration.sync', { taskId: 'task', targetStatus: 'closed' }),
        { authorize },
      ),
    ).toBeRejectedWith(jasmine.objectContaining({ code: 'SYNC_DISABLED' }));
    expect(push).not.toHaveBeenCalled();
    providers[0]['pluginConfig'] = { twoWaySync: { isDone: 'both' } };
    await service.execute(
      command('integration.sync', { taskId: 'task', targetStatus: 'closed' }),
      { authorize },
    );
    expect(push).toHaveBeenCalledWith('short123', { state: 'closed' }, providers[0]);
  });
});
