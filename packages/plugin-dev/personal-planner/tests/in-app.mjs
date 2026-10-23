import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { localDay } from '../src/schedule.mjs';
const url = process.env.PLANNER_APP_URL || 'http://127.0.0.1:4255';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ timezoneId: 'Europe/Madrid' }),
    page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    for (const key of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(key, 'true');
  });
  await page.goto(`${url}/#/config`, { timeout: 60000 });
  await page.locator('.page-settings').waitFor({ timeout: 60000 });
  await page.getByRole('tab').filter({ hasText: 'Plugins' }).click();
  await page
    .locator('input[type="file"][accept=".zip"]')
    .setInputFiles(
      fileURLToPath(new URL('../dist/personal-planner.zip', import.meta.url)),
    );
  await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
  const card = page
    .locator('plugin-management mat-card')
    .filter({ hasText: 'Mi planificación' });
  await card.waitFor();
  const toggle = card.getByRole('switch');
  if ((await toggle.getAttribute('aria-checked')) === 'false') await toggle.click();
  await page.goto(`${url}/#/plugins/personal-planner/index`);
  const frame = page.frameLocator('plugin-index iframe');
  await frame.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  assert.match(
    await frame.locator('#today-content').innerText(),
    /No hay tareas previstas/,
  );
  const date = localDay();
  const ids = await frame.locator('body').evaluate(async (_, date) => {
    const api = window.PluginAPI;
    const tagId = await api.addTag({ title: 'Área ficticia de prueba' });
    const taskId = await api.addTask({
      title: 'Tarea ficticia de integración',
      tagIds: [tagId],
      dueDay: date,
      timeEstimate: 1200000,
    });
    return { tagId, taskId };
  }, date);
  await frame.locator('#refresh').click();
  await frame
    .getByRole('button', { name: 'Tarea ficticia de integración', exact: true })
    .waitFor();
  await frame
    .locator('form[data-form="new-area"] input[name="name"]')
    .fill('Actividad ficticia');
  await frame.getByRole('button', { name: 'Crear actividad', exact: true }).click();
  await frame.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  await frame
    .locator('summary')
    .filter({ hasText: 'Actividades, objetivos y organización' })
    .click();
  const area = frame.locator('form[data-form="area"]');
  await area.locator('[name="tagIds"]').selectOption(ids.tagId);
  await area.locator('[name="dailyMinutes"]').fill('45');
  await area
    .getByRole('button', { name: 'Guardar Actividad ficticia', exact: true })
    .click();
  await frame.locator('#status').filter({ hasText: 'Configuración guardada' }).waitFor();
  // Reopen the real app: metadata, ZIP assets, tasks and profile must survive its IndexedDB reload.
  await page.reload();
  await frame.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  assert.equal(await area.locator('[name="dailyMinutes"]').inputValue(), '45');
  assert.match(
    await frame.locator('#today-content').innerText(),
    /0 min registrados \/ 45 min/,
  );
  // Record through the native timer, never by mutating internal time fields.
  await page.goto(`${url}/#/tag/TODAY/tasks`);
  const row = page
    .locator('task')
    .filter({ hasText: 'Tarea ficticia de integración' })
    .first();
  await row.waitFor();
  await row.hover();
  await row.locator('.start-task-btn').click();
  await page.waitForTimeout(2200);
  await row
    .locator('button')
    .filter({ has: page.locator('mat-icon', { hasText: 'pause' }) })
    .click();
  await page.goto(`${url}/#/plugins/personal-planner/index`);
  await frame.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  const tracked = await frame
    .locator('body')
    .evaluate(
      async (_, id) => (await window.PluginAPI.getTasks()).find((t) => t.id === id),
      ids.taskId,
    );
  assert.ok(tracked.timeSpent > 0);
  assert.ok(tracked.timeSpentOnDay[date] > 0);
  await frame
    .getByRole('button', { name: 'Tarea ficticia de integración', exact: true })
    .click();
  for (const mode of ['dark', 'light']) {
    await page.goto(`${url}/#/config`);
    await page
      .locator(`.dark-mode-select mat-button-toggle[value="${mode}"] button`)
      .click();
    await page.goto(`${url}/#/plugins/personal-planner/index`);
    await frame.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
    const injected = await frame
      .locator('body')
      .evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--is-dark-theme')
          .trim(),
      );
    assert.equal(injected, mode === 'dark' ? '1' : '0');
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS aplicación real: ZIP importado y activado, tareas/etiquetas vía bridge real, perfil conservado al recargar IndexedDB, tiempo creado con temporizador nativo y leído por API, detalle nativo abierto, temas claro y oscuro del anfitrión. Datos ficticios en contexto aislado.',
  );
  await context.close();
} finally {
  await browser.close();
}
