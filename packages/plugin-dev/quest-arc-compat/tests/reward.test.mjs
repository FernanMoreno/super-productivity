import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

test('patch refuses missing or ambiguous upstream code', async () => {
  const { patchBackground } = await import('../scripts/patch.mjs');
  assert.throws(() => patchBackground('unknown version'), /exactly one/);
  const site = 'if(0===p){const{xp:e}=n(t.title);p=e||10,';
  assert.throws(() => patchBackground(site + site), /exactly one/);
});

async function runtime(saved, templates = []) {
  const files = unzipSync(
    await readFile(new URL('../vendor/quest-arc-2.2.0.zip', import.meta.url)),
  );
  let source = strFromU8(files['plugin.js']);
  if (!process.env.QUEST_ARC_UNPATCHED) {
    const { patchBackground } = await import('../scripts/patch.mjs');
    source = patchBackground(source);
  }
  const hooks = {},
    tasks = [...templates],
    projects = [
      { id: 'normal', title: 'Normal' },
      { id: 'template', title: '📜 Test quest' },
    ],
    errors = [],
    pending = new Set();
  let onMessage,
    serial = 0,
    persisted = saved;
  const api = {
    log: {
      info() {},
      warn() {},
      error(...args) {
        errors.push(args);
      },
    },
    loadSyncedData: async () => saved,
    persistDataSynced: async (value) => {
      persisted = value;
    },
    registerHook: (name, handler) => {
      hooks[name] = handler;
    },
    onMessage: (handler) => {
      onMessage = handler;
    },
    registerHeaderButton() {},
    showIndexHtmlAsView() {},
    showSnack() {},
    getTasks: async () => tasks,
    getAllProjects: async () => projects,
    getAllTags: async () => [],
    addProject: async (p) => {
      const id = 'p' + ++serial;
      projects.push({ ...p, id });
      return id;
    },
    addTask: async (t) => {
      const id = 't' + ++serial;
      tasks.push({ ...t, id, isDone: false, subTaskIds: [], tagIds: [] });
      return id;
    },
    updateTask: async (id, update) =>
      Object.assign(
        tasks.find((t) => t.id === id),
        update,
      ),
    updateProject: async (id, update) =>
      Object.assign(
        projects.find((p) => p.id === id),
        update,
      ),
  };
  const context = vm.createContext({
    console,
    Date,
    Math,
    PluginAPI: api,
    setTimeout: (cb) => {
      const timer = setTimeout(() => {
        pending.delete(timer);
        cb();
      }, 1);
      pending.add(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      clearTimeout(timer);
      pending.delete(timer);
    },
    btoa: (s) => Buffer.from(s).toString('base64'),
    document: { body: {}, getElementById: () => null, querySelectorAll: () => [] },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    BroadcastChannel: class {
      postMessage() {}
    },
  });
  vm.runInContext(source, context);
  await new Promise((resolve) => setTimeout(resolve, 10));
  return {
    tasks,
    projects,
    errors,
    hooks,
    message: (value) => onMessage(value),
    state: () => onMessage({ type: 'REQUEST_SYNC' }),
    persisted: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return persisted;
    },
  };
}

for (const [label, suffix, expected] of [
  ['custom reward', ' [XP:25]', 25],
  ['explicit zero', ' [XP:0]', 0],
  ['default reward', '', 10],
]) {
  test(`compiled quest uses ${label} and persists it`, async () => {
    const r = await runtime(undefined, [
      {
        id: 'step',
        title: 'Read a chapter' + suffix,
        projectId: 'template',
        isDone: false,
        tagIds: [],
        subTaskIds: [],
      },
    ]);
    const result = await r.message({
      type: 'START_QUEST',
      payload: { storyId: 'template' },
    });
    assert.equal(result.success, true);
    const active = (await r.state()).activeStory.id;
    const task = r.tasks.find((t) => t.projectId === active);
    assert(task);
    assert(!task.title.includes('[XP:'));
    if (suffix)
      assert.equal(
        JSON.parse(task.notes.match(/```json\s*([\s\S]*?)\s*```/)[1]).reward.xp,
        expected,
      );
    task.isDone = true;
    await r.hooks.taskComplete({ task });
    assert.equal((await r.state()).profile.xp, expected);
    const stored = await r.persisted();
    assert.equal(JSON.parse(stored).profile.xp, expected);
    const reloaded = await runtime(stored);
    assert.equal((await reloaded.state()).profile.xp, expected);
    assert.equal(r.errors.length, 0);
    assert.equal(reloaded.errors.length, 0);
  });
}

test('existing compiled notes keep their reward when title is already clean', async () => {
  const r = await runtime();
  const task = {
    id: 'existing',
    title: 'Existing task #QuestArc',
    projectId: 'normal',
    isDone: true,
    notes:
      'User notes\n\n```json\n' +
      JSON.stringify({
        meta: { type: 'SIMPLE', version: 1, originalTitle: 'Existing task [XP:25]' },
        reward: { xp: 25 },
      }) +
      '\n```',
  };
  r.tasks.push(task);
  await r.hooks.taskComplete({ task });
  assert.equal((await r.state()).profile.xp, 25);
  assert(task.notes.startsWith('User notes'));
});

for (const [title, expected] of [
  ['Ordinary task', 10],
  ['Direct task [XP:25]', 25],
]) {
  test(`non-template task: ${title}`, async () => {
    const r = await runtime();
    const task = {
      id: 'direct',
      title,
      projectId: 'normal',
      isDone: true,
      subTaskIds: [],
      tagIds: [],
    };
    r.tasks.push(task);
    await r.hooks.taskComplete({ task });
    assert.equal((await r.state()).profile.xp, expected);
  });
}
