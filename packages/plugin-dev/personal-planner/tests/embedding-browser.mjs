import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { emptyProfile, createArea } from '../src/model.mjs';
const html = await readFile(new URL('../dist/index.html', import.meta.url));
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(
    req.url === '/parent' ? '<iframe title="Planner" src="/plugin"></iframe>' : html,
  );
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(
    (profile) => {
      window.nativeMutations = 0;
      profile.commitments = [
        {
          id: 'draft-event',
          title: 'Bloque existente',
          kind: 'busy',
          weekdays: [1],
          date: '',
          start: '09:00',
          end: '10:00',
          excludedDates: [],
        },
      ];
      profile.deadlines = [
        { id: 'draft-deadline', title: 'Entrega existente', date: '2026-10-30' },
      ];
      const storage = new Map([['profile-v1', JSON.stringify(profile)]]);
      window.PluginAPI = {
        getTasks: async () => [],
        getArchivedTasks: async () => [],
        getAllProjects: async () => [{ id: 'p', title: 'Proyecto de prueba' }],
        getAllTags: async () => [],
        getCurrentLanguage: async () => 'es',
        getAppState: async () => ({
          globalConfig: { misc: { startOfNextDayTime: '00:00' } },
        }),
        registerHook: async () => {},
        loadSyncedData: async (key) => storage.get(key) ?? null,
        compareAndSwapSyncedData: async (expected, value, key) => {
          if ((storage.get(key) ?? null) !== expected) return false;
          storage.set(key, value);
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
              cards: [],
              columns: [],
              wip: { count: 0, limit: 2 },
              templates: [],
              issues: [],
            };
          window.nativeMutations++;
          return {};
        },
      };
    },
    {
      ...emptyProfile(),
      areas: [
        {
          ...createArea('Objetivo del proyecto', 'seed-goal'),
          dailyMinutes: 30,
          projectIds: ['p'],
        },
      ],
    },
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/parent`);
  const frame = page.frameLocator('iframe');
  await frame.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  await page.evaluate(() => {
    window.presentationMessages = [];
    window.addEventListener('message', (event) => {
      if (event.source === document.querySelector('iframe').contentWindow)
        window.presentationMessages.push(event.data);
    });
  });
  const navigate = (section) =>
    page.evaluate(
      (section) =>
        document.querySelector('iframe').contentWindow.postMessage(
          {
            type: 'personal-planner:navigate',
            section,
            projectId: 'p',
            embedded: true,
          },
          location.origin,
        ),
      section,
    );
  await navigate('goals');
  await frame.locator('body.workspace-embedded').waitFor();
  assert.equal(await frame.locator('#workspace-sidebar').isVisible(), false);
  await frame
    .locator('#goals form[data-form="new-area"] input[name="name"]')
    .fill('Borrador conservado');
  await page.waitForFunction(() =>
    window.presentationMessages.some(
      (message) => message.type === 'personal-planner:state' && message.dirty === true,
    ),
  );
  await navigate('week');
  await frame.locator('#week').waitFor();
  assert.equal(await frame.locator('#week #event-editor').count(), 1);
  await navigate('goals');
  await frame.locator('#goals').waitFor();
  assert.equal(
    await frame.locator('#goals input[name="name"]').first().inputValue(),
    'Borrador conservado',
  );
  await navigate('week');
  await frame.locator('#week').waitFor();
  await frame
    .locator('#calendar-management > details > summary')
    .filter({ hasText: 'Compromisos, disponibilidad y recurrencias' })
    .click();
  await frame.locator('[data-action="edit-event"][data-id="draft-event"]').click();
  await frame
    .locator('[data-form="event"] [name="title"]')
    .fill('Cambio de bloque sin guardar');
  const deadlineGroup = frame
    .locator('#calendar-management > details')
    .filter({ hasText: 'Entregas e hitos' });
  await deadlineGroup.locator('summary').click();
  await frame
    .locator('[data-action="edit-deadline"][data-id="deadline:draft-deadline"]')
    .click();
  await navigate('settings');
  await frame.locator('[data-form="preferences"] [name="transitionMinutes"]').fill('5');
  await frame.locator('[data-form="preferences"] button').click();
  await frame.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  await navigate('goals');
  await frame.locator('#goals').waitFor();
  assert.equal(
    await frame.locator('#goals input[name="name"]').first().inputValue(),
    'Borrador conservado',
    'saving preferences must preserve an unrelated goal draft',
  );
  await navigate('week');
  await frame.locator('#week').waitFor();
  assert.equal(
    await frame.locator('[data-form="event"]').getAttribute('data-id'),
    'draft-event',
    'existing event draft retains its identity across unrelated save',
  );
  assert.equal(
    await frame.locator('[data-form="event"] [name="title"]').inputValue(),
    'Cambio de bloque sin guardar',
  );
  assert.equal(
    await frame.locator('[data-form="deadline"]').getAttribute('data-id'),
    'draft-deadline',
    'untouched seeded deadline editor remains open',
  );
  await navigate('goals');
  await frame.locator('#goals').waitFor();
  await frame
    .locator('body')
    .evaluate(() =>
      window.postMessage(
        { type: 'personal-planner:navigate', section: 'settings', embedded: true },
        '*',
      ),
    );
  assert.equal(
    await frame.locator('#goals').isVisible(),
    true,
    'self/sibling messages cannot replace parent context',
  );
  await navigate('does-not-exist');
  assert.equal(await frame.locator('#goals').isVisible(), true);
  await page.evaluate(() =>
    document
      .querySelector('iframe')
      .contentWindow.postMessage(
        { type: 'personal-planner:discard-draft', scope: 'workflow' },
        location.origin,
      ),
  );
  assert.equal(
    await frame.locator('#goals input[name="name"]').first().inputValue(),
    'Borrador conservado',
    'discarding workflow leaves unrelated profile draft intact',
  );
  await frame.locator('body').evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('planner:workspace-request', {
        cancelable: true,
        detail: { section: 'templates', projectId: 'p' },
      }),
    ),
  );
  await page.waitForFunction(() =>
    window.presentationMessages.some(
      (message) =>
        message.type === 'personal-planner:request-navigation' &&
        message.section === 'templates' &&
        message.projectId === 'p',
    ),
  );
  assert.equal(
    await frame.locator('#goals').isVisible(),
    true,
    'embedded requests wait for native guarded route',
  );
  await page.evaluate(() =>
    document
      .querySelector('iframe')
      .contentWindow.postMessage(
        { type: 'personal-planner:discard-draft', scope: 'all' },
        location.origin,
      ),
  );
  await frame.locator('#goals input[name="name"]').first().waitFor();
  assert.equal(await frame.locator('#goals input[name="name"]').first().inputValue(), '');
  await navigate('week');
  await frame.locator('#week').waitFor();
  await frame.locator('[data-action="review-proposal"]:visible').first().click();
  await frame.locator('[data-form="event"]').waitFor();
  const proposalTitle = await frame
    .locator('[data-form="event"] [name="title"]')
    .inputValue();
  await navigate('settings');
  await frame.locator('[data-form="preferences"] [name="sessionMinutes"]').fill('30');
  await frame.locator('[data-form="preferences"] button').click();
  await frame.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  await navigate('week');
  await frame.locator('#week').waitFor();
  assert.equal(
    await frame.locator('[data-form="event"] [name="title"]').inputValue(),
    proposalTitle,
    'untouched proposal-prefilled editor survives unrelated save',
  );
  await frame
    .locator('[data-form="event"] button')
    .filter({ hasText: 'Guardar bloque' })
    .click();
  await frame.locator('#error').filter({ hasText: 'Propuesta obsoleta' }).waitFor();
  await page.evaluate(() =>
    document
      .querySelector('iframe')
      .contentWindow.postMessage(
        { type: 'personal-planner:discard-draft', scope: 'all' },
        location.origin,
      ),
  );
  await navigate('goals');
  await frame.locator('#goals').waitFor();
  await frame
    .locator('#goals [data-form="new-area"] [name="name"]')
    .fill('Guardado después de preferencias');
  await frame.locator('#goals [data-form="new-area"] button').click();
  await frame.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  const savedProfile = await frame
    .locator('body')
    .evaluate(async () =>
      JSON.parse(await window.PluginAPI.loadSyncedData('profile-v1')),
    );
  assert.equal(savedProfile.preferences.transitionMinutes, 5);
  assert(
    savedProfile.areas.some((area) => area.name === 'Guardado después de preferencias'),
  );
  await navigate('templates');
  await frame.locator('body[data-workspace-view="templates"]').waitFor();
  assert.equal(await frame.locator('body').evaluate(() => window.nativeMutations), 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS embedded workspace: parent-only routing, contextual editors, preserved drafts, no native writes.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
