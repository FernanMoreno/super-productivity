import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { emptyProfile } from '../src/model.mjs';
const html = await readFile(new URL('../dist/index.html', import.meta.url));
const server = createServer((_, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
      timezoneId: 'Europe/Madrid',
    }),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((profile) => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(
      new Date(),
    );
    const tasks = Array.from({ length: 32 }, (_, i) => ({
      id: 'native-' + i,
      title: 'Preparar la siguiente práctica del curso de redes',
      projectId: 'p',
      timeEstimate: 2700000,
      timeSpent: 0,
      timeSpentOnDay: {},
      tagIds: [],
      subTaskIds: [],
      dueDay: i === 0 ? day : undefined,
      isDone: false,
    }));
    window.nativeMutations = 0;
    window.pluginHooks = {};
    const cards = () =>
      tasks.map((t) => ({
        taskId: t.id,
        title: t.title,
        projectId: 'p',
        parentId: null,
        column: 'ready',
        timeEstimate: t.timeEstimate,
        timeSpent: 0,
        criteria: [],
        dependsOn: [],
        blockers: [],
        links: [],
        priority: 'normal',
        isDone: false,
      }));
    window.PluginAPI = {
      getTasks: async () => tasks,
      getArchivedTasks: async () => [],
      getAllProjects: async () => [{ id: 'p', title: 'Formación' }],
      getAllTags: async () => [],
      getCurrentLanguage: async () => localStorage.getItem('lang') || 'es',
      getAppState: async () => ({
        globalConfig: { misc: { startOfNextDayTime: '00:00' } },
      }),
      registerHook: async (name, fn) => (window.pluginHooks[name] = fn),
      loadSyncedData: async (key) =>
        localStorage.getItem('planner-' + key) ||
        (key === 'profile-v1' ? JSON.stringify(profile) : null),
      compareAndSwapSyncedData: async (old, value, key) => {
        if ((await window.PluginAPI.loadSyncedData(key)) !== old) return false;
        localStorage.setItem('planner-' + key, value);
        return true;
      },
      plannerOperation: async (action, args) => {
        if (action === 'calendar_snapshot')
          return { calendarEvents: [], calendarWarnings: [] };
        if (action === 'workflow_query')
          return {
            view: args.view,
            revision: 'r1',
            nativeRevision: 'n1',
            weekRevision: 'w1',
            cards: cards(),
            wip: { count: 0, limit: 2, overLimit: false },
            templates: [],
            issues: [],
            providers: [],
            days: [],
            proposal: { assignments: [], partial: true },
          };
        if (action === 'workflow_command') {
          window.nativeMutations++;
          return { status: 'applied', revision: 'r2', nativeRevision: 'n1' };
        }
        return {};
      },
      selectTask: async () => {},
    };
  }, emptyProfile());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  assert.equal(await page.locator('a[data-workspace-view]').count(), 6);
  const visibleSections = () =>
    page
      .locator('#workspace-content > section:not([hidden])')
      .evaluateAll((nodes) => nodes.map((n) => n.id));
  assert.deepEqual((await visibleSections()).sort(), ['now', 'today']);
  for (const [id, expected] of [
    ['workflow', ['workflow']],
    ['week', ['proposal-adjust', 'week']],
    ['goals', ['goals']],
    ['review', ['review']],
    ['settings', ['settings']],
  ]) {
    await page.locator(`a[data-workspace-view="${id}"]`).click();
    assert.deepEqual((await visibleSections()).sort(), expected);
    assert.equal(
      await page.locator(`a[data-workspace-view="${id}"]`).getAttribute('aria-current'),
      'page',
    );
    await page.waitForFunction(
      () => document.getElementById('workspace-heading').getBoundingClientRect().top >= 0,
    );
  }
  await page.locator('a[data-workspace-view="goals"]').click();
  const name = page.locator('form[data-form="new-area"] input[name="name"]');
  await name.fill('Borrador sin guardar');
  await page.locator('a[data-workspace-view="today"]').click();
  await page.locator('a[data-workspace-view="goals"]').click();
  assert.equal(await name.inputValue(), 'Borrador sin guardar');
  await page.goBack();
  assert.deepEqual((await visibleSections()).sort(), ['now', 'today']);
  await page.evaluate(() => {
    location.hash = 'history';
  });
  await page.locator('#history').waitFor();
  assert.deepEqual((await visibleSections()).sort(), ['history']);
  assert.equal(
    await page.evaluate(() => window.nativeMutations),
    0,
    'Navigation never mutates native tasks',
  );
  for (const theme of ['light', 'dark']) {
    await page.addStyleTag({
      content: `:root{--bg:${theme === 'light' ? '#f7f8fb' : '#17191e'};--card-bg:${theme === 'light' ? '#fff' : '#202329'};--text-color:${theme === 'light' ? '#242936' : '#edf0f5'};--text-color-muted:${theme === 'light' ? '#646e80' : '#abb4c5'};--divider-color:${theme === 'light' ? '#e3e7ef' : '#343943'};--c-primary:${theme === 'light' ? '#5268c9' : '#a6b5ff'};--color-warning:#b58130;--color-danger:#c95050;--color-success:#45866e;--s:8px;--s2:16px;--s3:24px;--s4:32px;--s-half:4px;--card-border-radius:12px;}`,
    });
    for (const width of [1280, 736, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width === 1280) {
        await page.locator('a[data-workspace-view="workflow"]').click();
        await page.locator('[data-wf-filter="project"]').selectOption('p');
        await page.locator('.workflow-board').waitFor();
        await page.waitForFunction(
          () =>
            document.getElementById('workspace-heading').getBoundingClientRect().top >= 0,
        );
        const density = await page.evaluate(() => ({
          top: document.querySelector('.workflow-board').getBoundingClientRect().top,
          card: document.querySelector('.workflow-card').getBoundingClientRect().height,
          height: document.documentElement.scrollHeight,
          columns: [...document.querySelectorAll('[data-wf-column]')].map((n) => ({
            h: n.clientHeight,
            scroll: n.scrollHeight,
            max: getComputedStyle(n).maxHeight,
            overflow: getComputedStyle(n).overflowY,
          })),
        }));
        await page.screenshot({ path: `/tmp/sp-workspace-board-${theme}.png` });
        assert(
          density.top < 500 && density.card < 200 && density.height <= 1200,
          JSON.stringify({ theme, density }),
        );
      }
      for (const id of ['today', 'workflow', 'week', 'goals', 'review', 'settings']) {
        await page.locator(`a[data-workspace-view="${id}"]`).click();
        if (id === 'week') {
          const explanation = page.locator('#week-content > details.workspace-context');
          await explanation.locator('summary').click();
          assert.equal(await explanation.evaluate((node) => node.open), true);
          await explanation.evaluate((node) => {
            window.openHelpBeforeRefresh = node;
          });
          await page.evaluate(() => window.dispatchEvent(new Event('focus')));
          await page.waitForFunction(() => !window.openHelpBeforeRefresh.isConnected);
          assert.equal(
            await explanation.evaluate((node) => node.open),
            true,
            'reading an explanation survives automatic refresh',
          );
          assert(
            await explanation.evaluate(
              (node) => parseFloat(getComputedStyle(node).borderTopWidth) > 0,
            ),
            'availability explanation uses the common text panel',
          );
          const explanationSize = await explanation.evaluate((node) => ({
            scroll: node.scrollWidth,
            client: node.clientWidth,
          }));
          assert(
            explanationSize.scroll <= explanationSize.client + 2,
            JSON.stringify(explanationSize),
          );
          await explanation.screenshot({
            path: `/tmp/sp-all-text-help-${theme}-${width}.png`,
          });
          await explanation.locator('summary').click();
          const day = page.locator('.calendar-day[open]').first();
          assert.equal(await day.getByRole('heading', { level: 4 }).count(), 4);
          await day.locator('summary').focus();
          await page.keyboard.press('Enter');
          assert.equal(await day.count(), 0, 'daily text panel closes with keyboard');
          await page.locator('.calendar-day').first().locator('summary').focus();
          await page.keyboard.press('Enter');
          const openDay = page.locator('.calendar-day[open]').first();
          const bounds = await openDay.evaluate((node) =>
            [...node.querySelectorAll('.text-result')].map((item) => ({
              left: item.getBoundingClientRect().left,
              right: item.getBoundingClientRect().right,
            })),
          );
          assert(
            bounds.every((item) => item.left >= 0 && item.right <= width + 2),
            JSON.stringify({ theme, width, bounds }),
          );
          if (width === 1280 || width === 360)
            await openDay.screenshot({
              path: `/tmp/sp-text-panels-${theme}-${width}.png`,
            });
        }
        const size = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        assert(
          size.scroll <= size.client + 2,
          JSON.stringify({ theme, width, id, size }),
        );
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.locator('a[data-workspace-view="today"]').click();
    await page.screenshot({ path: `/tmp/sp-workspace-${theme}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await page.screenshot({ path: '/tmp/sp-workspace-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'PASS workspace: six views, deep links/back, mounted dirty forms, no native writes, light/dark 1280/736/360px without page overflow.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
