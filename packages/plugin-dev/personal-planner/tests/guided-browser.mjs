import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { navigate } from './navigation-helper.mjs';
import { emptyProfile, createArea } from '../src/model.mjs';
import { localDay, weekDays, addDays } from '../src/schedule.mjs';
import { taskSnapshot } from '../src/metrics.mjs';
import { createPlannerOperations } from '../../../personal-planner-core/operations.mjs';

const html = await readFile(new URL('../dist/index.html', import.meta.url));
const catalogs = Object.fromEntries(
  await Promise.all(
    ['es', 'en'].map(async (language) => [
      language,
      JSON.parse(
        await readFile(new URL('../src/i18n/' + language + '.json', import.meta.url)),
      ),
    ]),
  ),
);
const server = createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
const context = await browser.newContext({ timezoneId: 'Europe/Madrid' });
const page = await context.newPage(),
  errors = [],
  calls = [],
  storage = new Map();
page.on('pageerror', (error) => errors.push(error.message));
const day = localDay(Date.now(), 'Europe/Madrid'),
  week = weekDays(day, 1);
const profile = emptyProfile();
profile.areas = [
  { ...createArea('Área ficticia', 'a'), projectIds: ['p'], dailyMinutes: 30 },
];
storage.set('profile-v1', JSON.stringify(profile));
let task = {
  id: 't',
  title: 'Configuración',
  projectId: 'p',
  tagIds: [],
  parentId: null,
  subTaskIds: [],
  isDone: false,
  timeEstimate: 1800000,
  timeSpent: 600000,
  timeSpentOnDay: { [day]: 600000 },
  dueDay: day,
};
let nativeVersion = 0;
let subtasks = [];
let failUiWrite = false;
const operations = createPlannerOperations({
  read: async (key) => storage.get(key) ?? null,
  cas: async (key, expected, value, guard) => {
    guard?.();
    if ((storage.get(key) ?? null) !== expected) return false;
    storage.set(key, value);
    return true;
  },
  snapshot: async () => {
    const version = nativeVersion;
    return Object.assign(taskSnapshot([task, ...subtasks], []), {
      civilDaysReliable: true,
      timezone: 'Europe/Madrid',
      weekStartsOn: 1,
      projects: [{ id: 'p', title: 'Proyecto ficticio' }],
      assertCurrent: () => {
        if (version !== nativeVersion) throw Error('stale fixture');
      },
    });
  },
  native: async (action, args) => {
    if (action === 'correct_time') {
      const original = [task, ...subtasks].find((t) => t.id === args.taskId);
      assert.ok(original);
      assert.equal(args.expectedDurationMs, original.timeSpentOnDay[args.date] || 0);
      const updated = {
        ...original,
        timeSpentOnDay: { ...original.timeSpentOnDay, [args.date]: args.durationMs },
        timeSpent: original.timeSpent - (args.expectedDurationMs || 0) + args.durationMs,
      };
      if (task.id === args.taskId) task = updated;
      else subtasks = subtasks.map((t) => (t.id === args.taskId ? updated : t));
      nativeVersion++;
      return { status: 'applied', taskId: args.taskId };
    }
    if (action === 'schedule') {
      for (const entry of args.entries)
        task = { ...task, dueDay: undefined, dueWithTime: entry.dueWithTime };
      nativeVersion++;
      return { status: 'applied', taskIds: [task.id] };
    }
    throw Error('Unexpected fixture native action ' + action);
  },
});
const methods = {
  next: 'next',
  review: 'review',
  review_advance: 'reviewAdvance',
  correct_time: 'correctTime',
  history: 'history',
  prepare_undo: 'prepareUndo',
  proposal_adjust: 'adjustProposal',
  apply: 'apply',
  prepare: 'prepare',
  operation_status: 'operationStatus',
};
await page.exposeFunction('fixtureRead', async (name, key) => {
  if (name === 'load') return storage.get(key) ?? null;
  if (name === 'tasks') return [task, ...subtasks];
  throw Error('Unknown fixture read');
});
await page.exposeFunction('fixtureCas', async (expected, value, key) => {
  if (failUiWrite && key === 'ui-state-v1') throw Error('fixture UI disk error');
  if ((storage.get(key) ?? null) !== expected) return false;
  storage.set(key, value);
  return true;
});
await page.exposeFunction('fixtureOperation', async (action, params) => {
  calls.push({ action, params: structuredClone(params) });
  if (action === 'calendar_snapshot') return { calendarEvents: [], calendarWarnings: [] };
  const method = methods[action];
  if (!method) throw Error('Unknown fixture action ' + action);
  return operations[method](params);
});
await page.addInitScript(
  ({ catalogs }) => {
    window.fixtureLanguage = 'en';
    window.fixtureSelected = [];
    window.PluginAPI = {
      getTasks: () => window.fixtureRead('tasks'),
      getArchivedTasks: async () => [],
      getAllProjects: async () => [{ id: 'p', title: 'Proyecto ficticio' }],
      getAllTags: async () => [],
      getAppState: async () => ({
        globalConfig: { misc: { startOfNextDayTime: '00:00' } },
      }),
      loadSyncedData: (key) => window.fixtureRead('load', key),
      compareAndSwapSyncedData: (expected, value, key) =>
        window.fixtureCas(expected, value, key),
      plannerOperation: (action, params) => window.fixtureOperation(action, params),
      selectTask: async (id) => {
        window.fixtureSelected.push(id);
      },
      getCurrentLanguage: async () => window.fixtureLanguage,
      translate: async (key) => catalogs[window.fixtureLanguage][key] || key,
      registerHook: (name, callback) => {
        if (name === 'languageChange') window.fixtureLanguageHook = callback;
      },
    };
  },
  { catalogs },
);
async function openTimeEditor(form) {
  await form.waitFor({ state: 'attached' });
  const editor = form.locator('xpath=ancestor::details[1]');
  if (!(await editor.evaluate((element) => element.open))) {
    await editor.locator(':scope > summary').click();
  }
  await form.waitFor({ state: 'visible' });
}

try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#status').filter({ hasText: 'Data refreshed' }).waitFor();
  await navigate(page, 'review');
  assert.equal(await page.locator('#workspace-heading').innerText(), 'Review');
  await navigate(page, 'today');
  assert.equal(
    await page.locator('#today-content button[data-action="task"]').innerText(),
    'Configuración',
  );
  await page.evaluate(async () => {
    window.fixtureLanguage = 'es';
    await window.fixtureLanguageHook();
  });
  await navigate(page, 'review');
  await page.locator('#workspace-heading').filter({ hasText: 'Revisión' }).waitFor();
  await page.locator('[data-guided="review-load"] [name="from"]').fill(week[0]);
  await page.locator('[data-guided="review-load"] [name="to"]').fill(week[6]);
  await page.locator('[data-guided="review-load"] button').click();
  await page.locator('[data-action="guided-start-review"]').click();
  await page.locator('[data-action="guided-finish-review"]').waitFor();
  assert.equal(
    await page.locator('form[data-guided="correct-time"]').first().isVisible(),
    false,
    'time corrections remain collapsed until explicitly opened',
  );
  const initialDecision = page.locator('form[data-guided="review-decision"]').first();
  assert.equal(
    await initialDecision.locator('[name="date"]').isVisible(),
    false,
    'date is shown only for rescheduling',
  );
  assert.equal(
    await initialDecision.locator('[name="children"]').isVisible(),
    false,
    'children are shown only for splitting',
  );

  const uiState = JSON.parse(storage.get('ui-state-v1'));
  assert.ok(uiState.reviewId, 'review identifier must be persisted');
  assert.ok(storage.get('workbench-v1'), 'actual shared review state must persist');
  await page
    .locator('[data-guided="review-load"] [name="from"]')
    .fill(addDays(week[0], 7));
  await page.locator('[data-guided="review-load"] [name="to"]').fill(addDays(week[6], 7));
  await page.locator('[data-guided="review-load"] button').click();
  await page.locator('[data-action="guided-start-review"]').waitFor();
  assert.equal(
    calls.filter((c) => c.action === 'review').at(-1).params.reviewId,
    undefined,
    'another week must not reuse an incompatible review identifier',
  );
  await page.locator('[data-guided="review-load"] [name="from"]').fill(week[0]);
  await page.locator('[data-guided="review-load"] [name="to"]').fill(week[6]);
  await page.locator('[data-guided="review-load"] button').click();
  await page.locator('[data-action="guided-finish-review"]').waitFor();
  assert.equal(
    JSON.parse(storage.get('ui-state-v1')).reviewId,
    uiState.reviewId,
    'returning to the week resumes its unfinished review',
  );

  const row = page
    .locator('#review-content tbody tr')
    .filter({ hasText: day })
    .locator('form[data-guided="correct-time"]')
    .first();
  failUiWrite = true;
  await openTimeEditor(row);
  await row.locator('[name="minutes"]').fill('0');
  await row.locator('button').click();
  await page.locator('#error').filter({ hasText: 'No se envió' }).waitFor();
  assert.equal(
    calls.filter((c) => c.action === 'correct_time').length,
    0,
    'failed UI persistence must stop before dispatch',
  );
  await page.locator('[data-action="guided-close-unsent"]').click();
  await page.locator('#error').filter({ hasText: 'fixture UI disk error' }).waitFor();
  assert.equal(
    await page.locator('[data-action="guided-close-unsent"]').count(),
    1,
    'failed notice closure preserves the unsent identifier',
  );
  failUiWrite = false;
  await page.locator('[data-action="guided-close-unsent"]').click();
  await page.waitForFunction(
    () => !document.querySelector('[data-action="guided-close-unsent"]'),
  );
  assert.equal(
    JSON.parse(storage.get('ui-state-v1')).closedNotices.at(-1).acknowledgement,
    'not-dispatched',
  );
  await page.reload();
  await page.locator('#review-content table').waitFor();
  assert.equal(
    calls.filter((c) => c.action === 'correct_time').length,
    0,
    'reopening a discarded unsent attempt never dispatches it',
  );
  await page.evaluate(async () => {
    window.fixtureLanguage = 'es';
    await window.fixtureLanguageHook();
  });
  await openTimeEditor(row);
  await row.locator('[name="minutes"]').fill('0');
  await row.locator('button').click();
  await page.waitForFunction(
    () => !document.querySelector('form[data-guided="correct-time"] button')?.disabled,
  );
  assert.equal(
    task.timeSpentOnDay[day],
    0,
    'absolute correction to zero uses native operation',
  );
  assert.equal(calls.filter((c) => c.action === 'correct_time').length, 1);
  assert.equal(
    calls.find((c) => c.action === 'correct_time').params.expectedDurationMs,
    600000,
  );
  const beforeReloadMutations = calls.filter((c) =>
    ['correct_time', 'review_advance', 'apply'].includes(c.action),
  ).length;
  await page.reload();
  await page.locator('#status').filter({ hasText: 'Data refreshed' }).waitFor();
  await page.locator('#review-content table').waitFor();
  assert.equal(
    calls.filter((c) => ['correct_time', 'review_advance', 'apply'].includes(c.action))
      .length,
    beforeReloadMutations,
    'reopening only resumes reads',
  );
  const nextForm = page.locator('[data-guided="next"]');
  await navigate(page, 'today');
  await page.locator('.workspace-next-options > summary').click();
  await nextForm.locator('[name="availableMinutes"]').fill('60');
  await nextForm.locator('button').click();
  await page.locator('#now-content article').first().waitFor();
  assert.ok((await page.locator('#now-content .grid article').count()) <= 3);
  await page.locator('[data-action="guided-block-task"]').first().click();
  await page.locator('#now-content').filter({ hasText: 'Settings saved' }).waitFor();
  assert.equal(JSON.parse(storage.get('workbench-v1')).taskMeta.t.state, 'blocked');
  await navigate(page, 'history');
  await page.locator('[data-action="guided-history"]').click();
  await page
    .locator('#history-content')
    .filter({ hasText: 'No reorganizations recorded' })
    .waitFor();
  task = { ...task, subTaskIds: ['child-fictitious'] };
  subtasks = [
    {
      ...task,
      id: 'child-fictitious',
      title: 'Subtarea ficticia',
      parentId: 't',
      subTaskIds: [],
      timeEstimate: 900000,
      timeSpent: 0,
      timeSpentOnDay: {},
    },
  ];
  nativeVersion++;
  await navigate(page, 'review');
  await page.locator('[data-guided="review-load"] button').click();
  await page
    .locator('#review-content')
    .getByText('Original plan for a split task; time is logged only on subtasks', {
      exact: false,
    })
    .first()
    .waitFor();
  const parentRow = page
    .locator('#review-content tbody tr')
    .filter({ hasText: 'Configuración' });
  assert.equal(
    await parentRow.locator('form[data-guided="correct-time"]').count(),
    0,
    'aggregate parent cannot be corrected as a leaf',
  );
  assert.ok(
    await parentRow.getByText('Logged only on subtasks', { exact: true }).count(),
  );
  // Capture real unclassified review issues, then link their activities before
  // correcting time. The review items remain immutable across the profile edit.
  task = {
    ...task,
    id: 'task-A',
    title: 'Task A fixture',
    parentId: null,
    subTaskIds: [],
    timeSpent: 0,
    timeSpentOnDay: {},
    timeEstimate: 60000,
  };
  subtasks = [{ ...task, id: 'task-B', title: 'Task B fixture' }];
  storage.set('profile-v1', JSON.stringify({ ...profile, areas: [] }));
  nativeVersion++;
  const correctionFrom = addDays(week[0], -7);
  const newReview = await operations.review({ from: correctionFrom, to: week[6] });
  const started = await operations.reviewAdvance({
    operationId: 'review-correction-correlation',
    expectedRevision: newReview.revision,
    command: 'start',
    from: correctionFrom,
    to: week[6],
  });
  assert.equal(started.status, 'applied');
  storage.set('profile-v1', JSON.stringify(profile));
  storage.set(
    'ui-state-v1',
    JSON.stringify({
      pending: [],
      from: correctionFrom,
      to: week[6],
      reviewId: started.reviewId,
    }),
  );
  await page.reload();
  await page.locator('[data-action="guided-finish-review"]').waitFor();
  const issueA = 'unclassified:task-A';
  const decisionA = page.locator(
    'form[data-guided="review-decision"][data-item="' + issueA + '"]',
  );
  await decisionA.locator('[name="decision"]').selectOption('correct_time');
  await decisionA.locator('button').click();
  assert.equal(
    await page
      .locator('#review-content tbody tr')
      .filter({ hasText: 'Task A fixture' })
      .locator('form[data-guided="correct-time"]')
      .first()
      .isVisible(),
    true,
    'choosing a time correction opens the matching task editor',
  );

  const rowB = page
    .locator('#review-content tbody tr')
    .filter({ hasText: 'Task B fixture' })
    .locator('form[data-guided="correct-time"]')
    .first();
  await openTimeEditor(rowB);
  await rowB.locator('[name="minutes"]').fill('10');
  await rowB.locator('button').click();
  await page.waitForFunction(
    () => !document.querySelector('form[data-guided="correct-time"] button')?.disabled,
  );
  assert.equal(
    subtasks[0].timeSpentOnDay[day],
    600000,
    'the chosen B correction must complete',
  );
  const decisions = JSON.parse(storage.get('workbench-v1')).sessions[started.reviewId]
    .decisions;
  assert.equal(
    decisions[issueA],
    undefined,
    'correcting task B must not mark the pending task A issue reviewed',
  );
  const rowA = page
    .locator('#review-content tbody tr')
    .filter({ hasText: 'Task A fixture' })
    .locator('form[data-guided="correct-time"]')
    .first();
  await openTimeEditor(rowA);
  await rowA.locator('[name="minutes"]').fill('5');
  await rowA.locator('button').click();
  await page.waitForFunction(
    () => !document.querySelector('form[data-guided="correct-time"] button')?.disabled,
  );
  assert.equal(
    JSON.parse(storage.get('workbench-v1')).sessions[started.reviewId].decisions[issueA]
      .decision,
    'correct_time',
    'matching A correction marks exactly its review issue',
  );
  const issueB = 'unclassified:task-B';
  const decisionB = page.locator(
    'form[data-guided="review-decision"][data-item="' + issueB + '"]',
  );
  await decisionB.locator('[name="decision"]').selectOption('correct_time');
  await decisionB.locator('button').click();
  await page.locator('[data-action="guided-cancel-correction"]').click();
  await openTimeEditor(rowB);
  await rowB.locator('[name="minutes"]').fill('15');
  await rowB.locator('button').click();
  await page.waitForFunction(
    () => !document.querySelector('form[data-guided="correct-time"] button')?.disabled,
  );
  assert.equal(
    JSON.parse(storage.get('workbench-v1')).sessions[started.reviewId].decisions[issueB],
    undefined,
    'cancelled correction intent never marks the issue',
  );
  await decisionB.locator('[name="decision"]').selectOption('correct_time');
  await decisionB.locator('button').click();
  await page
    .locator('[data-guided="review-load"] [name="from"]')
    .fill(addDays(week[0], 7));
  await page.locator('[data-guided="review-load"] [name="to"]').fill(addDays(week[6], 7));
  await page.locator('[data-guided="review-load"] button').click();
  await page.locator('[data-action="guided-start-review"]').waitFor();
  await page.locator('[data-guided="review-load"] [name="from"]').fill(correctionFrom);
  await page.locator('[data-guided="review-load"] [name="to"]').fill(week[6]);
  await page.locator('[data-guided="review-load"] button').click();
  await page.locator('[data-action="guided-finish-review"]').waitFor();
  await openTimeEditor(rowB);
  await rowB.locator('[name="minutes"]').fill('20');
  await rowB.locator('button').click();
  await page.waitForFunction(
    () => !document.querySelector('form[data-guided="correct-time"] button')?.disabled,
  );
  assert.equal(
    JSON.parse(storage.get('workbench-v1')).sessions[started.reviewId].decisions[issueB],
    undefined,
    'changing the review interval clears the old correction intent',
  );
  const previousDay = addDays(day, -1);
  subtasks = [
    {
      ...subtasks[0],
      timeSpent: subtasks[0].timeSpent + 60000,
      timeSpentOnDay: { ...subtasks[0].timeSpentOnDay, [previousDay]: 60000 },
    },
  ];
  nativeVersion++;
  await page.locator('[data-guided="review-load"] button').click();
  await page
    .locator('form[data-guided="correct-time"]')
    .filter({ has: page.locator('[value="1"]') })
    .first()
    .waitFor({ state: 'attached' });
  await decisionB.locator('[name="decision"]').selectOption('correct_time');
  await decisionB.locator('button').click();
  const previousB = page
    .locator('#review-content tbody tr')
    .filter({ hasText: 'Task B fixture' })
    .filter({ hasText: previousDay })
    .locator('form[data-guided="correct-time"]');
  await openTimeEditor(previousB);
  await previousB.locator('[name="minutes"]').fill('2');
  await previousB.locator('button').click();
  await page.waitForFunction(
    () => !document.querySelector('form[data-guided="correct-time"] button')?.disabled,
  );
  assert.equal(
    JSON.parse(storage.get('workbench-v1')).sessions[started.reviewId].decisions[issueB],
    undefined,
    'correcting another date of the same task does not consume the pending row intention',
  );

  assert.deepEqual(errors, []);
  console.log(
    'PASS browser + real pure operations / simulated native services: host en/es, unchanged user names, review persisted/resumed without writes, correction to zero with expected old value, context options/manual block, history empty state.',
  );
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
