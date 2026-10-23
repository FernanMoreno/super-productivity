import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  IssueProviderPluginDefinition,
  PluginHttp,
} from '@super-productivity/plugin-api';

let definition: IssueProviderPluginDefinition;

beforeAll(async () => {
  (globalThis as unknown as { PluginAPI: unknown }).PluginAPI = {
    registerIssueProvider: vi.fn((def: IssueProviderPluginDefinition) => {
      definition = def;
    }),
    translate: (key: string) => key,
  };
  await import('./plugin');
});

const trelloCard = {
  id: 'card-id',
  idShort: 42,
  shortLink: 'abc123',
  name: 'Test card',
  desc: 'Card description',
  url: 'https://trello.com/c/abc123',
  due: null,
  closed: false,
  idBoard: 'board-id',
  idList: 'list-id',
  dateLastActivity: '2026-08-01T12:00:00.000Z',
};

describe('Trello issue provider write operations', () => {
  const move = {
    idList: 'next-list',
    expectedListId: 'list-id',
    expectedBoardId: 'board-id',
  };
  const movementHttp = (card = {}, list = {}) => ({
    get: vi
      .fn()
      .mockResolvedValueOnce({ ...trelloCard, ...card })
      .mockResolvedValueOnce({
        id: 'next-list',
        idBoard: 'board-id',
        closed: false,
        ...list,
      }),
    put: vi.fn().mockResolvedValue(undefined),
  });

  it('exposes current board and list without changing card identity', async () => {
    const get = vi.fn().mockResolvedValue(trelloCard);
    const issue = await definition.getById('abc123', {}, {
      get,
    } as unknown as PluginHttp);
    expect(issue).toMatchObject({ id: 'abc123', idBoard: 'board-id', idList: 'list-id' });
  });

  it('revalidates the card and destination before moving only its list', async () => {
    const http = movementHttp();
    await definition.updateIssue!('abc123', move, {}, http as unknown as PluginHttp);
    expect(http.get.mock.calls).toEqual([
      [
        'https://api.trello.com/1/cards/abc123',
        { params: { fields: 'idBoard,idList,closed' } },
      ],
      [
        'https://api.trello.com/1/lists/next-list',
        { params: { fields: 'idBoard,closed' } },
      ],
    ]);
    expect(http.put).toHaveBeenCalledExactlyOnceWith(
      'https://api.trello.com/1/cards/abc123',
      { idList: 'next-list' },
    );
    expect(http.get.mock.invocationCallOrder[1]).toBeLessThan(
      http.put.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [{ idBoard: 'other-board' }, {}],
    [{ idList: 'other-list' }, {}],
    [{ closed: true }, {}],
    [{ closed: undefined }, {}],
    [{}, { closed: true }],
    [{}, { closed: undefined }],
    [{}, { idBoard: 'other-board' }],
  ])('rejects stale or archived card/list state %j %j', async (card, list) => {
    const http = movementHttp(card, list);
    await expect(
      definition.updateIssue!('abc123', move, {}, http as unknown as PluginHttp),
    ).rejects.toThrow();
    expect(http.put).not.toHaveBeenCalled();
  });

  it.each([
    { idList: 'next-list' },
    { ...move, expectedListId: undefined },
    { ...move, expectedBoardId: undefined },
    { ...move, state: 'closed' },
    { ...move, title: 'Changed' },
    { ...move, idList: '' },
    { ...move, idList: 'a/b' },
    { ...move, idList: 'a?b' },
    { ...move, idList: 'x'.repeat(129) },
    { ...move, expectedListId: 'a%2Fb' },
    { ...move, expectedBoardId: 123 },
    { expectedListId: 'list-id', expectedBoardId: 'board-id' },
  ])('rejects malformed or mixed movement before HTTP: %j', async (changes) => {
    const http = movementHttp();
    await expect(
      definition.updateIssue!('abc123', changes, {}, http as unknown as PluginHttp),
    ).rejects.toThrow();
    expect(http.get).not.toHaveBeenCalled();
    expect(http.put).not.toHaveBeenCalled();
  });

  it.each(['', 'abc/def', 'abc?def', 'abc#def', 'x'.repeat(129)])(
    'rejects malformed moving card id %j before HTTP',
    async (id) => {
      const http = movementHttp();
      await expect(
        definition.updateIssue!(id, move, {}, http as unknown as PluginHttp),
      ).rejects.toThrow();
      expect(http.get).not.toHaveBeenCalled();
      expect(http.put).not.toHaveBeenCalled();
    },
  );

  it('accepts URL-safe identifiers without changing request segments', async () => {
    const http = movementHttp();
    await definition.updateIssue!('abc_123-X', move, {}, http as unknown as PluginHttp);
    expect(http.put).toHaveBeenCalledWith('https://api.trello.com/1/cards/abc_123-X', {
      idList: 'next-list',
    });
  });

  it('does not write if remote validation fails', async () => {
    const http = movementHttp();
    http.get.mockReset().mockRejectedValue(new Error('Forbidden'));
    await expect(
      definition.updateIssue!('abc123', move, {}, http as unknown as PluginHttp),
    ).rejects.toThrow('Forbidden');
    expect(http.put).not.toHaveBeenCalled();
  });

  it('updates card status and title', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const http = { put } as unknown as PluginHttp;

    await definition.updateIssue!(
      'abc123',
      {
        state: 'closed',
        title: 'Renamed card',
      },
      {},
      http,
    );

    expect(put).toHaveBeenCalledWith('https://api.trello.com/1/cards/abc123', {
      closed: true,
      name: 'Renamed card',
    });
  });

  it('reopens a card when the issue state is open', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const http = { put } as unknown as PluginHttp;

    await definition.updateIssue!('abc123', { state: 'open' }, {}, http);

    expect(put).toHaveBeenCalledWith('https://api.trello.com/1/cards/abc123', {
      closed: false,
    });
  });

  it('creates a card in the configured default list', async () => {
    const post = vi.fn().mockResolvedValue(trelloCard);
    const http = { post } as unknown as PluginHttp;

    const result = await definition.createIssue!(
      'Test card',
      { defaultListId: 'list-id' },
      http,
    );

    expect(post).toHaveBeenCalledWith('https://api.trello.com/1/cards', {
      name: 'Test card',
      idList: 'list-id',
    });
    expect(result).toMatchObject({
      issueId: 'abc123',
      issueData: {
        id: 'abc123',
        title: 'Test card',
        body: 'Card description',
        state: 'open',
      },
    });
  });

  it('falls back to the first open board list when defaultListId is unset', async () => {
    const get = vi.fn().mockResolvedValue([
      { id: 'first-open-list', name: 'Backlog' },
      { id: 'second-list', name: 'In Progress' },
    ]);
    const post = vi.fn().mockResolvedValue(trelloCard);
    const http = { get, post } as unknown as PluginHttp;

    const result = await definition.createIssue!(
      'Test card',
      { boardId: 'board-id' },
      http,
    );

    expect(get).toHaveBeenCalledWith('https://api.trello.com/1/boards/board-id/lists', {
      params: { filter: 'open', fields: 'name,id' },
    });
    expect(post).toHaveBeenCalledWith('https://api.trello.com/1/cards', {
      name: 'Test card',
      idList: 'first-open-list',
    });
    expect(result.issueId).toBe('abc123');
  });

  it('throws when defaultListId is unset and board has no open lists', async () => {
    const get = vi.fn().mockResolvedValue([]);
    const post = vi.fn();
    const http = { get, post } as unknown as PluginHttp;

    await expect(
      definition.createIssue!('Test card', { boardId: 'board-id' }, http),
    ).rejects.toThrow('ERRORS.DEFAULT_LIST_ID_REQUIRED');
    expect(post).not.toHaveBeenCalled();
  });

  it('throws when both defaultListId and boardId are missing', async () => {
    const post = vi.fn();
    const http = { post } as unknown as PluginHttp;

    await expect(definition.createIssue!('Test card', {}, http)).rejects.toThrow(
      'ERRORS.DEFAULT_LIST_ID_REQUIRED',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('does not expose deleteIssue to avoid unconditional remote archival', () => {
    expect(definition.deleteIssue).toBeUndefined();
  });

  it('exposes configurable mappings for status and title', () => {
    expect(definition.fieldMappings).toEqual([
      expect.objectContaining({
        taskField: 'isDone',
        issueField: 'state',
        defaultDirection: 'pullOnly',
      }),
      expect.objectContaining({
        taskField: 'title',
        issueField: 'title',
        defaultDirection: 'pullOnly',
      }),
    ]);
  });

  it('loads open lists for the configured board', async () => {
    const get = vi.fn().mockResolvedValue([
      { id: 'list-1', name: 'To Do' },
      { id: 'list-2', name: 'Doing' },
    ]);
    const http = { get } as unknown as PluginHttp;
    const defaultListField = definition.configFields.find(
      (f) => f.key === 'defaultListId',
    );
    expect(defaultListField?.type).toBe('select');
    expect(defaultListField?.loadOptions).toBeDefined();

    const options = await defaultListField!.loadOptions!(
      { apiKey: 'key', token: 'token', boardId: 'board-1' },
      http,
    );

    expect(get).toHaveBeenCalledWith('https://api.trello.com/1/boards/board-1/lists', {
      params: { filter: 'open', fields: 'name,id' },
    });
    expect(options).toEqual([
      { label: 'To Do', value: 'list-1' },
      { label: 'Doing', value: 'list-2' },
    ]);
  });

  it('returns empty list options when credentials or boardId are missing', async () => {
    const get = vi.fn();
    const http = { get } as unknown as PluginHttp;
    const defaultListField = definition.configFields.find(
      (f) => f.key === 'defaultListId',
    );

    const optionsWithoutBoard = await defaultListField!.loadOptions!(
      { apiKey: 'key', token: 'token' },
      http,
    );
    expect(optionsWithoutBoard).toEqual([]);

    const optionsWithoutAuth = await defaultListField!.loadOptions!(
      { boardId: 'board-1' },
      http,
    );
    expect(optionsWithoutAuth).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});
