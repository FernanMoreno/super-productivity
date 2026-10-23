import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { IssueProvider } from '../../features/issue/issue.model';
import { selectEnabledIssueProviders } from '../../features/issue/store/issue-provider.selectors';
import { IssueService } from '../../features/issue/issue.service';
import { JiraApiService } from '../../features/issue/providers/jira/jira-api.service';
import { JiraOriginalTransition } from '../../features/issue/providers/jira/jira-api-responses';
import { IssueSyncAdapterResolverService } from '../../features/issue/two-way-sync/issue-sync-adapter-resolver.service';
import { TaskService } from '../../features/tasks/task.service';
import { Task } from '../../features/tasks/task.model';
import { PluginIssueProviderRegistryService } from '../issue-provider/plugin-issue-provider-registry.service';
import { WorkflowTrelloService } from './workflow-trello.service';

export interface WorkflowIntegrationOptions {
  authorize: () => Promise<void>;
  beforeMutation?: () => Promise<void>;
  atMutation?: () => void;
  didMutate?: () => void;
}

export class WorkflowIntegrationError extends Error {
  constructor(readonly code: string) {
    // Provider errors may contain credentials or user content. Never forward them.
    super(`Integration operation failed (${code})`);
    this.name = 'WorkflowIntegrationError';
  }
}

interface RemoteIssue {
  id: string;
  status: string;
  statusName: string;
  url: string;
  boardId?: string;
  listId?: string;
}

const fail = (code: string): never => {
  throw new WorkflowIntegrationError(code);
};
const required = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    return fail('INVALID_COMMAND');
  return value;
};

/** Native providers own credentials and transport; the workflow only projects identity/status. */
@Injectable({ providedIn: 'root' })
export class WorkflowIntegrationService {
  private readonly _providers = inject(Store).selectSignal(selectEnabledIssueProviders);
  private readonly _issues = inject(IssueService);
  private readonly _tasks = inject(TaskService);
  private readonly _jira = inject(JiraApiService);
  private readonly _adapters = inject(IssueSyncAdapterResolverService);
  private readonly _registry = inject(PluginIssueProviderRegistryService);
  private readonly _trello = inject(WorkflowTrelloService);

  async query(
    taskId?: string,
    authorize: () => Promise<void> = async () => {},
  ): Promise<Record<string, unknown>> {
    await authorize();
    const providers = this._providers()
      .filter((p) => this._supported(p))
      .map((p) => ({
        id: p.id,
        provider: p.issueProviderKey === 'JIRA' ? 'jira' : 'trello',
        name: p.issueProviderKey === 'JIRA' ? 'Jira' : 'Trello',
        capabilities:
          p.issueProviderKey === 'JIRA'
            ? ['link', 'refresh', 'transitions']
            : ['link', 'refresh', 'open', 'closed', 'lists'],
      }));
    if (!taskId) return { providers };
    const task = await this._task(taskId);
    await authorize();
    if (!task.issueId || !task.issueProviderId)
      return { providers, taskId, linked: false };
    const provider = this._provider(task.issueProviderId);
    this._assertAssociation(task, provider);
    const remote = await this._remote(provider, task.issueId, authorize);
    const statuses =
      provider.issueProviderKey === 'JIRA'
        ? (await this._transitions(provider, remote.id, authorize)).map((t) => ({
            id: t.to.id,
            name: t.to.name,
            supported:
              provider.issueProviderKey === 'JIRA' &&
              provider.isTransitionIssuesEnabled === true &&
              !this._needsFields(t),
          }))
        : ['open', 'closed'].map((id) => ({
            id,
            name: id,
            supported: this._trelloPushEnabled(provider),
          }));
    await authorize();
    const lists =
      provider.issueProviderKey === 'TRELLO'
        ? await this._trello
            .lists(provider, remote, authorize)
            .catch(() => fail('REMOTE_READ_FAILED'))
        : undefined;
    await authorize();
    return {
      providers,
      taskId,
      linked: true,
      providerId: provider.id,
      provider: provider.issueProviderKey === 'TRELLO' ? 'trello' : 'jira',
      ...remote,
      statuses,
      ...(lists
        ? {
            lists: lists.map((list) => ({
              ...list,
              supported: this._trelloPushEnabled(provider) && remote.status === 'open',
            })),
            moveSupported:
              this._trelloPushEnabled(provider) &&
              remote.status === 'open' &&
              !!remote.boardId &&
              !!remote.listId,
          }
        : {}),
    };
  }

  async execute(
    command: { type: string; payload: Record<string, unknown> },
    options: WorkflowIntegrationOptions,
  ): Promise<Record<string, unknown>> {
    const { authorize } = options;
    await authorize();
    const payload = command.payload;
    const taskId = required(payload['taskId']);
    const task = await this._task(taskId);
    await authorize();
    if (command.type === 'integration.unlink') {
      await this._unchanged(task);
      await this._beforeMutation(options);
      options.atMutation?.();
      this._tasks.update(taskId, {
        // Empty identities survive JSON replay; optional undefined patches do not.
        issueId: '',
        issueProviderId: '',
        issueLastUpdated: null,
        issueLastSyncedValues: {},
        issueWasUpdated: false,
      });
      options.didMutate?.();
      return { taskId, linked: false };
    }
    if (
      ![
        'integration.link',
        'integration.refresh',
        'integration.sync',
        'integration.move',
      ].includes(command.type)
    )
      return fail('INVALID_COMMAND');
    const isLink = command.type === 'integration.link';
    if (isLink && task.issueId) return fail('ALREADY_LINKED');
    const provider = this._provider(
      required(isLink ? payload['providerId'] : task.issueProviderId),
    );
    if (!isLink) this._assertAssociation(task, provider);
    const remote = await this._remote(
      provider,
      required(isLink ? payload['issueId'] : task.issueId),
      authorize,
    );
    await authorize();
    if (isLink) {
      const duplicate = await this._tasks.checkForTaskWithIssueEverywhere(
        remote.id,
        provider.issueProviderKey,
        provider.id,
      );
      await authorize();
      if (duplicate && duplicate.task.id !== taskId) return fail('DUPLICATE_ISSUE');
    }
    let finalRemote = remote;
    let remoteWriteStarted = false;
    if (command.type === 'integration.move') {
      if (
        Object.keys(payload).some(
          (key) =>
            !['taskId', 'targetListId', 'expectedListId', 'expectedBoardId'].includes(
              key,
            ),
        )
      )
        return fail('INVALID_COMMAND');
      if (provider.issueProviderKey !== 'TRELLO' || !remote.boardId || !remote.listId)
        return fail('UNSUPPORTED_STATUS');
      if (
        payload['expectedListId'] !== remote.listId ||
        payload['expectedBoardId'] !== remote.boardId
      )
        return fail('STALE_REMOTE');
      if (!this._trelloPushEnabled(provider)) return fail('SYNC_DISABLED');
      if (remote.status !== 'open') return fail('ARCHIVED_CARD');
      const target = required(payload['targetListId']);
      const lists = await this._trello
        .lists(provider, remote, authorize)
        .catch(() => fail('REMOTE_READ_FAILED'));
      if (!lists.some((list) => list.id === target)) return fail('INVALID_DESTINATION');
      if (target !== remote.listId) {
        try {
          await this._trello.move(provider, remote, target, async () => {
            await this._unchanged(task);
            await this._beforeMutation(options);
            if (this._provider(provider.id) !== provider) return fail('STALE_NATIVE');
            options.atMutation?.();
            remoteWriteStarted = true;
          });
          finalRemote = await this._remote(provider, remote.id, authorize);
          if (
            finalRemote.listId !== target ||
            finalRemote.boardId !== remote.boardId ||
            finalRemote.status !== remote.status
          )
            return fail('UNCERTAIN');
          await authorize();
        } catch {
          return fail(remoteWriteStarted ? 'UNCERTAIN' : 'REMOTE_MOVE_REJECTED');
        }
      }
    }
    if (command.type === 'integration.sync') {
      if (
        provider.issueProviderKey === 'JIRA' &&
        provider.isTransitionIssuesEnabled !== true
      )
        return fail('SYNC_DISABLED');
      const target = required(payload['targetStatus']);
      if (
        payload['expectedRemoteStatus'] !== undefined &&
        payload['expectedRemoteStatus'] !== remote.status
      )
        return fail('STALE_REMOTE');
      if (provider.issueProviderKey === 'TRELLO' && !['open', 'closed'].includes(target))
        return fail('UNSUPPORTED_STATUS');
      if (target !== remote.status) {
        const write = await this._prepareWrite(provider, remote.id, target, authorize);
        await this._unchanged(task);
        await this._beforeMutation(options);
        if (this._provider(provider.id) !== provider) return fail('STALE_NATIVE');
        // A rejected write or verification read may have reached the remote server.
        // Keep the coordinator's pending receipt; never automatically retry it.
        options.atMutation?.();
        try {
          remoteWriteStarted = true;
          await write();
          finalRemote = await this._remote(provider, remote.id, authorize);
          if (finalRemote.status !== target) return fail('UNCERTAIN');
          await authorize();
        } catch {
          return fail('UNCERTAIN');
        }
      }
    }
    try {
      await this._unchanged(task);
      await this._beforeMutation(options);
      if (this._provider(provider.id) !== provider) return fail('STALE_NATIVE');
      // Bookkeeping excludes title/content and prevents generic two-way effects
      // from turning the explicit refresh into an unrequested remote push.
      options.atMutation?.();
      this._tasks.update(taskId, {
        ...(isLink
          ? {
              issueId: finalRemote.id,
              issueProviderId: provider.id,
              issueType: provider.issueProviderKey,
            }
          : {}),
        issueWasUpdated: false,
      });
      options.didMutate?.();
      return { taskId, providerId: provider.id, linked: true, ...finalRemote };
    } catch (error) {
      if (remoteWriteStarted) return fail('UNCERTAIN');
      throw error;
    }
  }

  private _supported(provider: IssueProvider): boolean {
    return (
      provider.isEnabled &&
      (provider.issueProviderKey === 'JIRA' ||
        (provider.issueProviderKey === 'TRELLO' &&
          this._registry.hasProvider('TRELLO') &&
          !!this._adapters.getAdapter('TRELLO')))
    );
  }

  private _provider(id: string): IssueProvider {
    const provider = this._providers().find((p) => p.id === id && this._supported(p));
    return provider ?? fail('PROVIDER_UNAVAILABLE');
  }

  private async _task(id: string): Promise<Task> {
    const task = await firstValueFrom(this._tasks.getByIdOnce$(id));
    return task ?? fail('TASK_NOT_FOUND');
  }

  private _assertAssociation(task: Task, provider: IssueProvider): void {
    if (
      !task.issueId ||
      task.issueType !== provider.issueProviderKey ||
      task.issueProviderId !== provider.id
    )
      fail('INVALID_LINK');
  }

  private async _unchanged(task: Task): Promise<void> {
    const current = await this._task(task.id);
    if (
      current.issueId !== task.issueId ||
      current.issueType !== task.issueType ||
      current.issueProviderId !== task.issueProviderId
    )
      fail('STALE_NATIVE');
  }

  private async _beforeMutation(options: WorkflowIntegrationOptions): Promise<void> {
    await options.authorize();
    if (options.beforeMutation) await options.beforeMutation();
  }

  private async _remote(
    provider: IssueProvider,
    id: string,
    authorize: () => Promise<void>,
  ): Promise<RemoteIssue> {
    await authorize();
    this._provider(provider.id);
    let data: Record<string, unknown>;
    try {
      const issue = await this._issues.getById(
        provider.issueProviderKey,
        id,
        provider.id,
      );
      if (!issue) return fail('ISSUE_NOT_FOUND');
      data = issue as unknown as Record<string, unknown>;
    } catch {
      return fail('REMOTE_READ_FAILED');
    }
    await authorize();
    if (provider.issueProviderKey === 'JIRA') {
      const canonical = required(data['id']);
      if (!/^\d+$/.test(canonical)) return fail('INVALID_REMOTE');
      const status = data['status'] as { id?: unknown; name?: unknown } | undefined;
      const key = required(data['key']);
      await authorize();
      const url = await this._safeLink(provider, key);
      await authorize();
      return {
        id: canonical,
        status: required(status?.id),
        statusName: typeof status?.name === 'string' ? status.name : '',
        url,
      };
    }
    // The shipped adapter maps the Trello API's shortLink to issue.id.
    const canonical = required(data['shortLink'] ?? data['id']);
    if (!/^[a-zA-Z0-9]+$/.test(canonical)) return fail('INVALID_REMOTE');
    const status = required(data['state']);
    if (!['open', 'closed'].includes(status)) return fail('UNSUPPORTED_STATUS');
    return {
      id: canonical,
      status,
      statusName: status,
      url: `https://trello.com/c/${canonical}`,
      ...(typeof data['idBoard'] === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(data['idBoard'])
        ? { boardId: data['idBoard'] }
        : {}),
      ...(typeof data['idList'] === 'string' &&
      /^[A-Za-z0-9_-]{1,128}$/.test(data['idList'])
        ? { listId: data['idList'] }
        : {}),
    };
  }

  private async _safeLink(provider: IssueProvider, key: string): Promise<string> {
    try {
      const url = new URL(
        await this._issues.issueLink(provider.issueProviderKey, key, provider.id),
      );
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return '';
      return url.toString();
    } catch {
      return '';
    }
  }

  private async _transitions(
    provider: IssueProvider,
    id: string,
    authorize: () => Promise<void>,
  ): Promise<JiraOriginalTransition[]> {
    if (provider.issueProviderKey !== 'JIRA') return fail('UNSUPPORTED_STATUS');
    await authorize();
    let transitions: JiraOriginalTransition[];
    try {
      transitions = await firstValueFrom(
        this._jira.getTransitionsForIssue$(id, provider),
      );
    } catch {
      return fail('REMOTE_READ_FAILED');
    }
    await authorize();
    return transitions;
  }

  private _needsFields(transition: JiraOriginalTransition): boolean {
    return Object.values(transition.fields ?? {}).some(
      (field) =>
        !!field &&
        typeof field === 'object' &&
        (field as { required?: boolean }).required === true,
    );
  }

  private _trelloPushEnabled(provider: IssueProvider): boolean {
    if (provider.issueProviderKey !== 'TRELLO') return false;
    const configured = provider.pluginConfig?.['twoWaySync'];
    if (configured !== undefined) {
      if (!configured || typeof configured !== 'object' || Array.isArray(configured))
        return false;
      const direction = (configured as Record<string, unknown>)['isDone'];
      if (
        direction !== undefined &&
        !['off', 'pullOnly', 'pushOnly', 'both'].includes(String(direction))
      )
        return false;
    }
    const adapter = this._adapters.getAdapter('TRELLO');
    const mapping = adapter?.getFieldMappings().find((m) => m.taskField === 'isDone');
    const direction =
      adapter?.getSyncConfig(provider).isDone ?? mapping?.defaultDirection;
    return !!mapping && (direction === 'both' || direction === 'pushOnly');
  }

  private async _prepareWrite(
    provider: IssueProvider,
    id: string,
    target: string,
    authorize: () => Promise<void>,
  ): Promise<() => Promise<unknown>> {
    if (provider.issueProviderKey === 'JIRA') {
      const transition = (await this._transitions(provider, id, authorize)).find(
        (t) => t.to.id === target && !this._needsFields(t),
      );
      if (!transition) return fail('UNSUPPORTED_STATUS');
      return () =>
        firstValueFrom(this._jira.transitionIssue$(id, transition.id, provider));
    }
    if (!this._trelloPushEnabled(provider)) return fail('SYNC_DISABLED');
    const adapter = this._adapters.getAdapter('TRELLO')!;
    const mapping = adapter.getFieldMappings().find((m) => m.taskField === 'isDone')!;
    const value = mapping.toIssueValue(target === 'closed', { issueId: id });
    return () => adapter.pushChanges(id, { [mapping.issueField]: value }, provider);
  }
}
