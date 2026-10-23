import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { emptyProfile, createArea } from '../src/model.mjs';
const html = await readFile(new URL('../dist/index.html', import.meta.url));
const server = createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ timezoneId: 'Europe/Madrid' }),
    page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const profile = emptyProfile();
  profile.areas = [{ ...createArea('Inicial ficticia', 'a'), dailyMinutes: 30 }];
  await page.addInitScript(
    ({ profile }) => {
      const handlers = [];
      window.externalChange = (name) => {
        const profile = JSON.parse(localStorage.getItem('profile-v1'));
        profile.areas[0].name = name;
        localStorage.setItem('profile-v1', JSON.stringify(profile));
        handlers.forEach((handler) => handler());
      };
      localStorage.setItem(
        'profile-v1',
        localStorage.getItem('profile-v1') || JSON.stringify(profile),
      );
      window.PluginAPI = {
        getTasks: async () => JSON.parse(localStorage.getItem('native-tasks') || '[]'),
        getArchivedTasks: async () => [],
        getAllProjects: async () => [],
        getAllTags: async () => [],
        getAppState: async () => ({
          globalConfig: { misc: { startOfNextDayTime: '00:00' } },
        }),
        loadSyncedData: async (key) => localStorage.getItem(key),
        compareAndSwapSyncedData: async (expected, value, key) => {
          if (localStorage.getItem(key) !== expected) return false;
          localStorage.setItem(key, value);
          handlers.forEach((handler) => handler());
          return true;
        },
        registerHook: (name, handler) => handlers.push(handler),
      };
    },
    { profile },
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  await page.evaluate(() => window.externalChange('Cambio externo limpio'));
  await page.waitForFunction(
    () =>
      document.querySelector('form[data-id="a"] [name="name"]').value ===
      'Cambio externo limpio',
  );
  const summary = page
    .locator('summary')
    .filter({ hasText: 'Actividades, objetivos y organización' });
  if (!(await summary.evaluate((el) => el.parentElement.open))) await summary.click();
  const area = page.locator('form[data-id="a"]');
  await area.locator('[name="name"]').fill('Borrador local');
  await page.evaluate(() => window.externalChange('Cambio externo mientras edito'));
  await page.locator('[data-action="reload-settings"]').waitFor();
  assert.equal(await area.locator('[name="name"]').inputValue(), 'Borrador local');
  assert.match(
    await page.locator('#goals-content').innerText(),
    /Cambio externo mientras edito/,
  );
  await area
    .getByRole('button', { name: 'Guardar Cambio externo limpio', exact: true })
    .click();
  await page.locator('#error:not([hidden])').waitFor();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('profile-v1')).areas[0].name,
    ),
    'Cambio externo mientras edito',
  );
  assert.equal(await area.locator('[name="name"]').inputValue(), 'Borrador local');
  await page.locator('[data-action="reload-settings"]').click();
  await page.waitForFunction(
    () =>
      document.querySelector('form[data-id="a"] [name="name"]').value ===
      'Cambio externo mientras edito',
  );
  // Prepare a displayed suggestion, then change native tasks before accepting its review form.
  await page.locator('[data-action="review-proposal"]:visible').first().click();
  await page.evaluate(() =>
    localStorage.setItem(
      'native-tasks',
      JSON.stringify([
        {
          id: 'changed-native',
          title: 'Nueva ficticia',
          isDone: false,
          projectId: null,
          tagIds: [],
          parentId: null,
          subTaskIds: [],
          timeEstimate: 1800000,
          timeSpent: 0,
          dueDay: document.querySelector('#day').value,
        },
      ]),
    ),
  );
  await page
    .locator('form[data-form="event"]')
    .getByRole('button', { name: 'Guardar bloque', exact: true })
    .click();
  await page.locator('#error:not([hidden])').waitFor();
  assert.match(await page.locator('#error').innerText(), /Propuesta obsoleta/);
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('profile-v1')).commitments.length,
    ),
    0,
  );
  await page.locator('#refresh').click();
  await page.getByRole('button', { name: 'Nueva ficticia', exact: true }).waitFor();
  assert.match(
    await page.locator('form[data-form="event"] [name="title"]').inputValue(),
    /Cambio externo/,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS API simulada: cambios externos visibles, borrador y revisión protegidos, CAS obsoleto rechazado y propuesta invalidada por cambios de tareas nativas.',
  );
  await context.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
