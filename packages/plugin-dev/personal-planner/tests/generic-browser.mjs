import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { navigate, openGoals, openCalendar } from './navigation-helper.mjs';
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
  const context = await browser.newContext({ timezoneId: 'Europe/Madrid' }),
    page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.PluginAPI = {
      getTasks: async () => [],
      getArchivedTasks: async () => [],
      getAllProjects: async () => [],
      getAllTags: async () => [],
      getAppState: async () => ({
        globalConfig: { misc: { startOfNextDayTime: '00:00' } },
      }),
      loadSyncedData: async (key) =>
        localStorage.getItem(key === 'profile-v1' ? 'planner' : 'planner-' + key),
      compareAndSwapSyncedData: async (expected, value, key) => {
        if ((await window.PluginAPI.loadSyncedData(key)) !== expected) return false;
        localStorage.setItem(key === 'profile-v1' ? 'planner' : 'planner-' + key, value);
        return true;
      },
    };
  });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('planner')));
  const saved = () =>
    page.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  assert.match(await page.locator('#today-content').innerText(), /Empieza creando/);
  await page.locator('#day').fill('2027-02-01');
  const create = async (name) => {
    await navigate(page, 'goals');
    const form = page.locator('form[data-form="new-area"]');
    await form.locator('[name="name"]').fill(name);
    await form.getByRole('button', { name: 'Crear actividad', exact: true }).click();
    await saved();
  };
  await create('Actividad A');
  let p = await stored();
  const id = p.areas[0].id;
  await openGoals(page);
  let a = page.locator(`form[data-form="area"][data-id="${id}"]`);
  await a.locator('[name="dailyMinutes"]').fill('25');
  await a.locator('[name="applyFrom"]').fill('2027-02-01');
  await a.getByRole('button', { name: 'Guardar Actividad A', exact: true }).click();
  await saved();
  await create('Actividad B');
  await openGoals(page);
  const idB = (await stored()).areas.find((a) => a.name === 'Actividad B').id;
  await page.locator(`form[data-id="${idB}"] [data-action="area-up"]`).click();
  await saved();
  assert.equal((await stored()).areas.find((a) => a.id === idB).order, 0);
  await openGoals(page);
  a = page.locator(`form[data-form="area"][data-id="${id}"]`);
  await a.locator('[name="name"]').fill('Actividad renombrada');
  await a.locator('[name="state"]').selectOption('archived');
  await a.locator('[name="applyFrom"]').fill('2027-02-02');
  await a.getByRole('button', { name: 'Guardar Actividad A', exact: true }).click();
  await saved();
  assert.equal(
    (await stored()).areas.find((a) => a.name === 'Actividad renombrada').id,
    id,
  );
  await navigate(page, 'today');
  assert.match(await page.locator('#today-content').innerText(), /Actividad renombrada/);
  await page.locator('#day').fill('2027-02-02');
  assert.equal(await page.locator('#today-content .grid article').count(), 0);
  await page.locator('#day').fill('2027-02-01');
  assert.equal(await page.locator('#today-content .grid article').count(), 1);
  await openCalendar(page);
  let e = page.locator('form[data-form="event"]');
  await e.locator('[name="title"]').fill('Rutina ficticia');
  await e.locator('[name="kind"]').selectOption('busy');
  await e.locator('[name="start"]').fill('09:00');
  await e.locator('[name="end"]').fill('10:00');
  await e.locator('[name="startDate"]').fill('2027-01-01');
  await e.locator('[name="weekdays"][value="1"]').check();
  await e.getByRole('button', { name: 'Guardar bloque' }).click();
  await saved();
  const seriesId = (await stored()).commitments[0].id;
  await openCalendar(page);
  await page.locator(`[data-action="edit-event"][data-id="${seriesId}"]`).click();
  e = page.locator('form[data-form="event"]');
  await e.locator('[name="editScope"]').selectOption('future');
  await e.locator('[name="editDate"]').fill('2027-02-08');
  await e.locator('[name="start"]').fill('11:00');
  await e.locator('[name="end"]').fill('12:00');
  await e.getByRole('button', { name: 'Guardar bloque' }).click();
  await saved();
  await navigate(page, 'today');
  assert.match(await page.locator('#today-content').innerText(), /09:00–10:00/);
  await page.locator('#day').fill('2027-02-08');
  assert.match(await page.locator('#today-content').innerText(), /11:00–12:00/);
  await openCalendar(page);
  await page.locator(`[data-action="edit-event"][data-id="${seriesId}"]`).click();
  e = page.locator('form[data-form="event"]');
  await e.locator('[name="editScope"]').selectOption('occurrence');
  await e.locator('[name="editDate"]').fill('2027-02-01');
  await e.locator('[name="start"]').fill('13:00');
  await e.locator('[name="end"]').fill('14:00');
  await e.getByRole('button', { name: 'Guardar bloque' }).click();
  await saved();
  await navigate(page, 'today');
  await page.locator('#day').fill('2027-02-01');
  assert.match(await page.locator('#today-content').innerText(), /13:00–14:00/);
  await page.locator('#day').fill('2027-02-08');
  assert.match(await page.locator('#today-content').innerText(), /11:00–12:00/);
  await openCalendar(page);
  e = page.locator('form[data-form="event"]');
  await e.locator('[name="title"]').fill('Flexible independiente');
  await e.locator('[name="kind"]').selectOption('flexible');
  await e.locator('[name="scope"]').selectOption('personal');
  await e.locator('[name="date"]').fill('2027-02-08');
  await e.locator('[name="start"]').fill('16:00');
  await e.locator('[name="end"]').fill('17:00');
  await e.locator('[name="durationMinutes"]').fill('20');
  await e.getByRole('button', { name: 'Guardar bloque' }).click();
  await saved();
  const flexId = (await stored()).commitments.find((c) => c.kind === 'flexible').id;
  await navigate(page, 'week');
  await page.locator('[data-action="review-proposal"]').first().click();
  await openCalendar(page);
  e = page.locator('form[data-form="event"]');
  assert.equal(await e.locator('[name="sourceId"]').inputValue(), flexId);
  await e.getByRole('button', { name: 'Guardar bloque' }).click();
  await saved();
  assert.equal(
    (await stored()).commitments.find((c) => c.kind === 'study').sourceId,
    flexId,
  );
  assert.equal(await page.locator('[data-action="review-proposal"]').count(), 0);
  await page.reload();
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  assert.equal((await stored()).schemaVersion, 2);
  assert.equal((await stored()).commitments.length, 5);
  assert.deepEqual(errors, []);
  await context.close();
  const demo = await browser.newContext({ timezoneId: 'Europe/Madrid' }),
    demoPage = await demo.newPage();
  await demoPage.addInitScript(() => {
    window.PluginAPI = {
      getTasks: async () => [],
      getArchivedTasks: async () => [],
      getAllProjects: async () => [],
      getAllTags: async () => [],
      getAppState: async () => ({
        globalConfig: { misc: { startOfNextDayTime: '00:00' } },
      }),
      loadSyncedData: async (key) =>
        localStorage.getItem(key === 'profile-v1' ? 'planner' : 'planner-' + key),
      compareAndSwapSyncedData: async (expected, value, key) => {
        if ((await window.PluginAPI.loadSyncedData(key)) !== expected) return false;
        localStorage.setItem(key === 'profile-v1' ? 'planner' : 'planner-' + key, value);
        return true;
      },
    };
  });
  await demoPage.goto(`http://127.0.0.1:${server.address().port}`);
  await navigate(demoPage, 'settings');
  await demoPage.getByRole('button', { name: 'Cargar demostración ficticia' }).click();
  await demoPage
    .locator('#status')
    .filter({ hasText: 'Configuración guardada' })
    .waitFor();
  await navigate(demoPage, 'goals');
  assert.match(
    await demoPage.locator('#goals-content').innerText(),
    /Aprendizaje de ejemplo/,
  );
  await demo.close();
  console.log(
    'PASS navegador general: inicio vacío/demo, creación, objetivos con vigencia, orden, renombrado e id estable, archivo por fecha, edición de ocurrencia/futuras y persistencia. API simulada, datos ficticios.',
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
