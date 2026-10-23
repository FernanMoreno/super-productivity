import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(
  await readFile(new URL('../src/plugin.ts', import.meta.url), 'utf8'),
  { mode: 'transform' },
);
function fixture(initial = '# Existing\n- [ ] Retain this task\n') {
  let provider;
  const files = new Map([['Inbox.md', initial]]);
  const sources = new Map();
  const storage = new Map();
  const writes = [];
  let readStatus;
  let pauseRead;
  const context = vm.createContext({
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    URL,
    localStorage: {
      getItem: (k) => storage.get(k),
      setItem: (k, v) => storage.set(k, v),
    },
    PluginAPI: { registerIssueProvider: (p) => (provider = p) },
    fetch: async (url, opts) => {
      const u = new URL(url);
      const requestFiles = sources.get(u.host) || files;
      const path = decodeURIComponent(u.pathname.replace('/vault/', ''));
      let payload = {};
      let status = 200;
      if (opts.method === 'GET' && path.endsWith('.md') && pauseRead) {
        const pending = pauseRead;
        pauseRead = undefined;
        pending.enter();
        await pending.wait;
      }
      if (opts.method === 'PUT') {
        writes.push({ url, content: JSON.parse(opts.body).content });
        requestFiles.set(path, JSON.parse(opts.body).content);
      } else if (path === '' || path.endsWith('/'))
        payload = {
          files: [...requestFiles.keys()].map((name) => ({ name, mtime: Date.now() })),
        };
      else if (readStatus) {
        status = readStatus;
      } else if (requestFiles.has(path))
        payload = { content: requestFiles.get(path), mtime: Date.now() };
      else status = 404;
      return { ok: status === 200, status, json: async () => payload };
    },
  });
  vm.runInContext(source, context);
  const config = {
    baseUrl: 'http://fixture-a',
    apiKey: 'fixture',
    issueType: 'tasks',
    defaultNote: 'Inbox.md',
  };
  return {
    provider,
    config,
    files,
    sources,
    writes,
    storage,
    setReadStatus: (s) => {
      readStatus = s;
    },
    deferNextRead: () => {
      let enter, release;
      const entered = new Promise((r) => (enter = r));
      const wait = new Promise((r) => (release = r));
      pauseRead = { enter, wait };
      return { entered, release };
    },
  };
}
test('HTTP500 when reading default note rejects without overwriting', async () => {
  const f = fixture();
  f.setReadStatus(500);
  await assert.rejects(f.provider.createIssue('New', f.config, {}), /HTTP 500/);
  assert.equal(f.writes.length, 0);
  assert.match(f.files.get('Inbox.md'), /Retain/);
});
test('HTTP404 can initialize a new default note', async () => {
  const f = fixture();
  f.files.clear();
  await f.provider.createIssue('New', f.config, {});
  assert.equal(f.writes.length, 1);
  assert.match(f.files.get('Inbox.md'), /- \[ \] New %%sp-id:/);
});
test('both mode appends checkbox to configured default note', async () => {
  const f = fixture();
  const result = await f.provider.createIssue(
    'New',
    { ...f.config, issueType: 'both' },
    {},
  );
  assert.match(result.issueId, /^task::Inbox.md::sp-/);
  assert.match(f.files.get('Inbox.md'), /Retain/);
  assert.match(f.files.get('Inbox.md'), /New %%sp-id:/);
});
test('notes-only mode still creates a note', async () => {
  const f = fixture();
  const result = await f.provider.createIssue(
    'New',
    { ...f.config, issueType: 'notes' },
    {},
  );
  assert.match(result.issueId, /^note::New.md$/);
});
test('second backlog sync preserves markers and task identity', async () => {
  const f = fixture();
  const first = await f.provider.getNewIssuesForBacklog(f.config, {});
  const content = f.files.get('Inbox.md');
  const second = await f.provider.getNewIssuesForBacklog(f.config, {});
  assert.deepEqual(
    first.map((x) => x.id),
    second.map((x) => x.id),
  );
  assert.equal(f.files.get('Inbox.md'), content);
  assert.equal(f.writes.length, 1);
});
test('queued updates cannot replay against a different provider endpoint', async () => {
  const f = fixture('- [ ] Shared %%sp-id:1234abcd%%\n');
  f.setReadStatus(500);
  await f.provider.updateIssue(
    'task::Inbox.md::sp-1234abcd',
    { title: 'Changed' },
    f.config,
    {},
  );
  f.setReadStatus(undefined);
  await f.provider.searchIssues('', { ...f.config, baseUrl: 'http://fixture-b' }, {});
  assert.equal(f.writes.filter((x) => x.url.startsWith('http://fixture-b')).length, 0);
  assert.match(f.files.get('Inbox.md'), /Shared/);
});
test('queued updates replay only when their original endpoint is used', async () => {
  const f = fixture('- [ ] Shared %%sp-id:1234abcd%%\n');
  f.setReadStatus(500);
  await f.provider.updateIssue(
    'task::Inbox.md::sp-1234abcd',
    { title: 'Changed' },
    f.config,
    {},
  );
  f.setReadStatus(undefined);
  await f.provider.searchIssues('', { ...f.config, baseUrl: 'http://fixture-b' }, {});
  await f.provider.searchIssues('', f.config, {});
  assert.equal(f.writes.filter((x) => x.url.startsWith('http://fixture-a')).length, 1);
  assert.match(f.files.get('Inbox.md'), /Changed/);
});
test('unscoped legacy queue is never replayed', async () => {
  const f = fixture('- [ ] Shared %%sp-id:1234abcd%%\n');
  f.storage.set(
    'sp-obsidian-update-queue',
    JSON.stringify([
      {
        id: 'task::Inbox.md::sp-1234abcd',
        changes: { title: 'Wrong vault' },
        queuedAt: Date.now(),
      },
    ]),
  );
  await f.provider.searchIssues('', f.config, {});
  assert.equal(f.writes.length, 0);
  assert.match(f.files.get('Inbox.md'), /Shared/);
});
test('HTTP401 reading existing note also rejects without a PUT', async () => {
  const f = fixture();
  f.setReadStatus(401);
  await assert.rejects(f.provider.createIssue('New', f.config, {}), /HTTP 401/);
  assert.equal(f.writes.length, 0);
});

test('empty search recent cache never returns another provider endpoint results', async () => {
  const f = fixture('- [ ] Endpoint A %%sp-id:1234abcd%%\n');
  f.sources.set(
    'fixture-b',
    new Map([['Other.md', '- [ ] Endpoint B %%sp-id:abcd1234%%\n']]),
  );
  const first = await f.provider.searchIssues('', f.config, {});
  const second = await f.provider.searchIssues(
    '',
    { ...f.config, baseUrl: 'http://fixture-b' },
    {},
  );
  assert.equal(first.length, 1);
  assert.match(first[0].id, /task::Inbox.md::/);
  assert.equal(second.length, 1);
  assert.match(second[0].id, /task::Other.md::/);
  assert.match(second[0].title, /Endpoint B/);
});

test('notes-only refuses an existing same-name note without writing', async () => {
  const f = fixture();
  f.files.set('New.md', 'Existing note content');
  await assert.rejects(
    f.provider.createIssue('New', { ...f.config, issueType: 'notes' }, {}),
    /already exists/,
  );
  assert.equal(f.writes.length, 0);
  assert.equal(f.files.get('New.md'), 'Existing note content');
});
for (const status of [401, 500])
  test(`notes-only aborts creation on HTTP${status} without writing`, async () => {
    const f = fixture();
    f.setReadStatus(status);
    await assert.rejects(
      f.provider.createIssue('New', { ...f.config, issueType: 'notes' }, {}),
      new RegExp(`HTTP ${status}`),
    );
    assert.equal(f.writes.length, 0);
  });
for (const sameId of [true, false])
  test(`queue replay preserves ${sameId ? 'newer same-id' : 'different-id'} edits enqueued while applying`, async () => {
    const f = fixture(
      '- [ ] Shared %%sp-id:1234abcd%%\n- [ ] Other %%sp-id:abcd1234%%\n',
    );
    const oldId = 'task::Inbox.md::sp-1234abcd';
    const newId = sameId ? oldId : 'task::Inbox.md::sp-abcd1234';
    f.setReadStatus(500);
    await f.provider.updateIssue(oldId, { title: 'Earlier' }, f.config, {});
    f.setReadStatus(undefined);
    const pending = f.deferNextRead();
    const replay = f.provider.searchIssues('', f.config, {});
    await pending.entered;
    await f.provider.updateIssue(newId, { title: 'Newer' }, f.config, {});
    pending.release();
    await replay;
    const queue = [...f.storage.values()].flatMap((value) => JSON.parse(value));
    assert.ok(
      queue.some((entry) => entry.id === newId && entry.changes.title === 'Newer'),
    );
    await f.provider.searchIssues('', f.config, {});
    assert.match(f.files.get('Inbox.md'), /Newer/);
  });
test('same-source overlapping replays apply the queued write only once', async () => {
  const f = fixture('- [ ] Shared %%sp-id:1234abcd%%\n');
  f.setReadStatus(500);
  await f.provider.updateIssue(
    'task::Inbox.md::sp-1234abcd',
    { title: 'Earlier' },
    f.config,
    {},
  );
  f.setReadStatus(undefined);
  const pending = f.deferNextRead();
  const first = f.provider.searchIssues('', f.config, {});
  await pending.entered;
  const second = f.provider.searchIssues('', f.config, {});
  await new Promise((resolve) => setImmediate(resolve));
  pending.release();
  await Promise.all([first, second]);
  assert.equal(f.writes.length, 1);
});
