import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { emptyProfile, createArea } from '../src/model.mjs';
const html = await readFile(new URL('../dist/index.html', import.meta.url));
const server = createServer((_, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    timezoneId: 'Europe/Madrid',
    viewport: { width: 1100, height: 800 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const profile = emptyProfile();
  profile.areas.push(createArea('Idioma ficticio', 'language'));
  profile.areas.find((a) => a.id === 'language').tagIds = ['language'];
  profile.areas.find((a) => a.id === 'language').dailyMinutes = 45;
  await page.addInitScript(
    ({ profile }) => {
      const task = (id, fields = {}) => ({
        id,
        title: id,
        timeSpent: 0,
        timeEstimate: 0,
        isDone: false,
        projectId: 'p',
        tagIds: [],
        subTaskIds: [],
        timeSpentOnDay: {},
        ...fields,
      });
      window.PluginAPI = {
        getTasks: async () => {
          if (localStorage.getItem('fail-tasks')) throw Error('denied');
          return localStorage.getItem('empty')
            ? []
            : [
                task('Ficticia <img src=x onerror=alert(1)>', {
                  tagIds: ['language'],
                  dueDay: '2027-02-01',
                  timeEstimate: 3600000,
                  timeSpent: 600000,
                  timeSpentOnDay: { '2027-02-01': 600000 },
                }),
              ];
        },
        getArchivedTasks: async () => [
          task('Archivo ficticio', {
            tagIds: ['language'],
            timeSpent: 300000,
            timeSpentOnDay: { '2027-02-01': 300000 },
          }),
        ],
        getAllProjects: async () => [{ id: 'p', title: 'Proyecto ficticio' }],
        getAllTags: async () => [{ id: 'language', title: 'Etiqueta ficticia' }],
        getAppState: async () => ({
          globalConfig: { misc: { startOfNextDayTime: '00:00' } },
        }),
        loadSyncedData: async () =>
          localStorage.getItem('planner') || JSON.stringify(profile),
        persistDataSynced: async (v) => {
          if (localStorage.getItem('fail-save')) throw Error('denied');
          localStorage.setItem('planner', v);
        },
        selectTask: async (id) => {
          window.selected = id;
        },
      };
    },
    { profile },
  );
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  await page.locator('#day').fill('2027-02-01');
  assert.match(await page.locator('#today-content').innerText(), /15 min registrados/);
  assert.equal(await page.locator('#today-content img').count(), 0);
  await page
    .getByRole('button', { name: 'Ficticia <img src=x onerror=alert(1)>' })
    .click();
  assert.match(await page.evaluate(() => window.selected), /Ficticia/);
  const area = page.locator('form[data-form="area"][data-id="language"]');
  await page
    .locator('summary')
    .filter({ hasText: 'Actividades, objetivos y organización' })
    .click();
  await area.locator('[name="dailyMinutes"]').fill('50');
  await area
    .getByRole('button', { name: 'Guardar Idioma ficticio', exact: true })
    .click();
  await page.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  await page.reload();
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  assert.equal(await area.locator('[name="dailyMinutes"]').inputValue(), '45');
  await page.locator('#day').fill('2027-02-01');
  assert.equal(await area.locator('[name="dailyMinutes"]').inputValue(), '50');
  await page
    .locator('summary')
    .filter({ hasText: 'Compromisos, disponibilidad y recurrencias' })
    .click();
  const form = page.locator('form[data-form="event"]');
  await form.locator('[name="title"]').fill('Extra ficticio');
  await form.locator('[name="kind"]').selectOption('extra');
  await form.locator('[name="date"]').fill('2027-02-01');
  await form.locator('[name="start"]').fill('09:00');
  await form.locator('[name="end"]').fill('11:00');
  await form.getByRole('button', { name: 'Guardar bloque' }).click();
  await page.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  assert.match(await page.locator('#today-content').innerText(), /Extra ficticio/);
  assert.match(
    await page.locator('#week-content tbody tr').first().innerText(),
    /1320 min/,
  );
  await page
    .locator('summary')
    .filter({ hasText: 'Compromisos, disponibilidad y recurrencias' })
    .click();
  await page.locator('[data-action="remove-event"]').click();
  await page.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  assert.match(
    await page.locator('#week-content tbody tr').first().innerText(),
    /1440 min/,
  );
  await page.evaluate(() => localStorage.setItem('fail-save', '1'));
  await page
    .locator('summary')
    .filter({ hasText: 'Actividades, objetivos y organización' })
    .click();
  await area.locator('[name="dailyMinutes"]').fill('70');
  await area
    .getByRole('button', { name: 'Guardar Idioma ficticio', exact: true })
    .click();
  await page.locator('#error:not([hidden])').waitFor();
  assert.match(await page.locator('#error').innerText(), /No se pudo guardar/);
  assert.equal(await area.locator('[name="dailyMinutes"]').inputValue(), '70');
  await page.evaluate(() => {
    localStorage.removeItem('fail-save');
    localStorage.setItem('fail-tasks', '1');
  });
  await page.locator('#refresh').click();
  await page.locator('#error:not([hidden])').waitFor();
  assert.match(await page.locator('#error').innerText(), /No se pueden leer las tareas/);
  await page.evaluate(() => {
    localStorage.removeItem('fail-tasks');
    localStorage.setItem('empty', '1');
  });
  await page.reload();
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  assert.match(
    await page.locator('#today-content').innerText(),
    /No hay tareas previstas/,
  );
  for (const background of ['rgb(250, 250, 250)', 'rgb(25, 25, 25)']) {
    await page.addStyleTag({
      content: `:root{--bg:${background};--card-bg:${background};--text-color:${background.startsWith('rgb(25,') ? 'white' : 'black'};--divider-color:gray;--c-primary:dodgerblue}`,
    });
    assert.equal(
      await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor),
      background,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.tagName), 'BODY');
  assert.deepEqual(errors, []);
  await context.close();
  const missing = await browser.newPage();
  await missing.goto(url);
  await missing.locator('#error:not([hidden])').waitFor();
  assert.match(await missing.locator('#error').innerText(), /PluginAPI no disponible/);
  await missing.close();
  console.log(
    'PASS navegador con API simulada: datos, archivo, escape HTML, persistencia, extra añadido/quitado, error de guardado/lectura, vacíos, temas, móvil, teclado y API ausente.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
