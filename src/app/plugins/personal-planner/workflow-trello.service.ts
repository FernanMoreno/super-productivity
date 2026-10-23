import { inject, Injectable } from '@angular/core';
import { IssueProvider } from '../../features/issue/issue.model';
import { PluginHttpService } from '../issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../issue-provider/plugin-issue-provider-registry.service';
import {
  PluginHttpOptions,
  PluginHttp,
  IssueProviderPluginDefinition,
} from '../issue-provider/plugin-issue-provider.model';

interface Location {
  id: string;
  boardId?: string;
  listId?: string;
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (): never => {
  throw new Error('Trello list operation unavailable');
};

/** Reuse the registered native provider; credentials never enter workflow results. */
@Injectable({ providedIn: 'root' })
export class WorkflowTrelloService {
  private readonly _registry = inject(PluginIssueProviderRegistryService);
  private readonly _http = inject(PluginHttpService);

  private _client(provider: IssueProvider): {
    definition: IssueProviderPluginDefinition;
    config: Record<string, unknown>;
    http: PluginHttp;
  } {
    if (provider.issueProviderKey !== 'TRELLO') return fail();
    const registered = this._registry.getProvider('TRELLO');
    if (!registered) return fail();
    const config = provider.pluginConfig || {};
    const http = this._http.createHttpHelper(
      () => registered.definition.getHeaders(config),
      { allowPrivateNetwork: registered.allowPrivateNetwork },
    );
    return { definition: registered.definition, config, http };
  }

  async lists(
    provider: IssueProvider,
    remote: Location,
    authorize: () => Promise<void>,
  ): Promise<{ id: string; name: string }[]> {
    if (!validId(remote.boardId) || !validId(remote.listId)) return [];
    await authorize();
    const { definition, config, http } = this._client(provider);
    const field = definition.configFields.find((item) => item.key === 'defaultListId');
    if (!field?.loadOptions) return [];
    const options = await field.loadOptions({ ...config, boardId: remote.boardId }, http);
    await authorize();
    if (!Array.isArray(options)) return [];
    return options
      .filter((option) => validId(option.value) && typeof option.label === 'string')
      .slice(0, 500)
      .map((option) => ({ id: option.value, name: option.label.slice(0, 500) }));
  }

  async move(
    provider: IssueProvider,
    remote: Location,
    targetListId: string,
    beforePut: () => Promise<void>,
  ): Promise<void> {
    if (![remote.id, remote.boardId, remote.listId, targetListId].every(validId))
      return fail();
    const { definition, config, http } = this._client(provider);
    if (!definition.updateIssue) return fail();
    const guarded = {
      ...http,
      post: async (): Promise<never> => fail(),
      patch: async (): Promise<never> => fail(),
      delete: async (): Promise<never> => fail(),
      request: async (): Promise<never> => fail(),
      put: async <T>(
        url: string,
        body: unknown,
        options?: PluginHttpOptions,
      ): Promise<T> => {
        // The explicit move permits exactly this card/list write. Reauthorize
        // after the provider's asynchronous preflight, at the actual dispatch.
        if (
          url !== `https://api.trello.com/1/cards/${remote.id}` ||
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length !== 1 ||
          (body as Record<string, unknown>)['idList'] !== targetListId
        )
          return fail();
        await beforePut();
        return http.put<T>(url, body, options);
      },
    };
    await definition.updateIssue(
      remote.id,
      {
        idList: targetListId,
        expectedListId: remote.listId,
        expectedBoardId: remote.boardId,
      },
      config,
      guarded,
    );
  }
}
