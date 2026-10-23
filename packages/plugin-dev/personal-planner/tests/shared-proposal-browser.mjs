import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { navigate, openDiagnostics } from './navigation-helper.mjs';
import { emptyProfile, createArea } from '../src/model.mjs';

const html = await readFile(new URL('../dist/index.html', import.meta.url));
const server = createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
const errors = [];
async function fixture(mode) {
  const context = await browser.newContext({ timezoneId: 'Europe/Madrid' });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  const profile = emptyProfile();
  profile.areas = [createArea('Actividad ficticia', 'fictitious-area')];
  await page.addInitScript(
    ({ profile, mode }) => {
      const native = [
        {
          id: 'fictitious-task',
          title: 'Tarea ficticia',
          projectId: 'fictitious-project',
          tagIds: [],
          parentId: null,
          subTaskIds: [],
          timeEstimate: 900000,
          timeSpent: 0,
          timeSpentOnDay: {},
          isDone: false,
        },
      ];
      localStorage.setItem('profile-v1', JSON.stringify(profile));
      localStorage.setItem('native-tasks', JSON.stringify(native));
      window.fixtureCalls = [];
      window.fixtureReads = [];
      window.fixtureWrites = [];
      window.PluginAPI = {
        getTasks: async () => JSON.parse(localStorage.getItem('native-tasks')),
        getArchivedTasks: async () => [],
        getAllProjects: async () => [
          { id: 'fictitious-project', title: 'Proyecto ficticio' },
        ],
        getAllTags: async () => [],
        getAppState: async () => ({
          globalConfig: { misc: { startOfNextDayTime: '00:00' } },
        }),
        loadSyncedData: async (key) => {
          window.fixtureReads.push(key);
          return localStorage.getItem(key);
        },
        compareAndSwapSyncedData: async (expected, value, key) => {
          if (localStorage.getItem(key) !== expected) return false;
          window.fixtureWrites.push(key);
          localStorage.setItem(key, value);
          return true;
        },
        registerHook: () => {},
        plannerOperation: async (action, params) => {
          window.fixtureCalls.push({ action, params: structuredClone(params) });
          if (action === 'calendar_snapshot')
            return { calendarEvents: [], calendarWarnings: [] };
          if (action === 'history') return { entries: [] };
          if (action === 'proposal_adjust') {
            return { ...window.fixtureProposal, proposalId: 'adjusted-proposal' };
          }
          if (action === 'prepare') {
            const date = params.from;
            const start = Date.parse(date + 'T10:00:00+01:00');
            return (window.fixtureProposal = {
              proposalId: 'fictitious-proposal',
              expiresAt: Date.now() + 900000,
              proposals: [
                {
                  id: 'native-choice',
                  target: 'native-task',
                  taskId: 'fictitious-task',
                  title: 'Reubicar tarea ficticia',
                  date,
                  interval: [start, start + 900000],
                  reason: 'Alternativa ficticia dentro de disponibilidad conocida.',
                },
                {
                  id: 'planner-choice',
                  target: 'commitment',
                  areaId: 'fictitious-area',
                  title: 'Reservar bloque ficticio',
                  date,
                  interval: [start + 1800000, start + 2700000],
                  reason: 'Objetivo ficticio pendiente; requiere revisión.',
                },
              ],
            });
          }
          if (action !== 'apply') throw Error('Unexpected fixture action');
          if (mode === 'deferred') {
            return new Promise((resolve) => {
              window.fixtureReleaseApply ||= [];
              window.fixtureReleaseApply.push(() =>
                resolve({ status: 'applied', operationId: params.operationId }),
              );
            });
          }
          if (mode !== 'applied') {
            localStorage.setItem(
              'op-' + params.operationId,
              JSON.stringify({
                action: 'apply',
                signature: 'a'.repeat(64),
                status: 'pending',
                createdAt: Date.now(),
              }),
            );
            if (mode === 'disconnected')
              throw Error('Conexión perdida después de enviar el cambio ficticio.');
            return {
              status: 'uncertain',
              code: 'OUTCOME_UNKNOWN',
              message: 'Resultado incierto ficticio.',
            };
          }
          const tasks = JSON.parse(localStorage.getItem('native-tasks'));
          if (params.selection.includes('native-choice'))
            tasks[0].dueWithTime = Date.now();
          localStorage.setItem('native-tasks', JSON.stringify(tasks));
          return { status: 'applied', operationId: params.operationId };
        },
      };
    },
    { profile, mode },
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
  await navigate(page, 'week');
  return { page, context };
}
try {
  {
    const { page, context } = await fixture('applied');
    const before = await page.evaluate(() => ({
      profile: localStorage.getItem('profile-v1'),
      tasks: localStorage.getItem('native-tasks'),
    }));
    await page.locator('[data-action="prepare-shared"]').click();
    const review = page.locator('form[data-guided="apply-proposal"]');
    await review.waitFor();
    assert.equal(await review.locator('input[name="selection"]').count(), 2);
    assert.equal(await review.locator('input:checked').count(), 0);
    assert.match(await review.innerText(), /Calendario nativo/);
    assert.match(await review.innerText(), /Bloque del planificador/);
    assert.match(await review.innerText(), /requiere revisión/);
    assert.deepEqual(
      await page.evaluate(() => ({
        profile: localStorage.getItem('profile-v1'),
        tasks: localStorage.getItem('native-tasks'),
      })),
      before,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixtureWrites.filter((key) => key !== 'ui-state-v1'),
      ),
      [],
    );
    await review.getByRole('button', { name: 'Aplicar selección revisada' }).click();
    await page.locator('#error:not([hidden])').waitFor();
    assert.match(await page.locator('#error').innerText(), /Selecciona/);
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'apply').length,
      ),
      0,
    );
    await review.locator('input[value="native-choice"]').check();
    await review.getByRole('button', { name: 'Aplicar selección revisada' }).click();
    await page
      .locator('#guided-proposal')
      .filter({ hasText: 'Operación confirmada.' })
      .waitFor();
    const applied = await page.evaluate(() =>
      window.fixtureCalls.filter((c) => c.action === 'apply'),
    );
    assert.equal(applied.length, 1);
    assert.deepEqual(applied[0].params.selection, ['native-choice']);
    assert.equal(applied[0].params.proposalId, 'fictitious-proposal');
    assert.match(applied[0].params.operationId, /^[A-Za-z0-9_-]{8,80}$/);
    assert.equal(
      await page.evaluate(() => localStorage.getItem('profile-v1')),
      before.profile,
    );
    await context.close();
  }
  {
    const { page, context } = await fixture('applied');
    await page.locator('[data-action="prepare-shared"]').click();
    const adjustments = page.locator('[data-guided="adjust-proposal"]');
    await adjustments.locator('button').click();
    await page
      .locator('#guided-adjust-status')
      .filter({ hasText: 'Sin ajustes' })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'proposal_adjust').length,
      ),
      0,
    );
    await adjustments.locator('[name="start:native-choice"]').fill('11:00');
    await adjustments.locator('[name="end:native-choice"]').fill('11:30');
    await adjustments.locator('button').click();
    await page.waitForFunction(() =>
      window.fixtureCalls.some((c) => c.action === 'proposal_adjust'),
    );
    const adjusted = await page.evaluate(() =>
      window.fixtureCalls.find((c) => c.action === 'proposal_adjust'),
    );
    assert.deepEqual(
      adjusted.params.changes.map((c) => c.itemId),
      ['native-choice'],
    );
    assert.equal(adjusted.params.proposalId, 'fictitious-proposal');
    await context.close();
  }
  {
    const { page, context } = await fixture('uncertain');
    await page.locator('[data-action="prepare-shared"]').click();
    const review = page.locator('[data-guided="apply-proposal"]');
    await review.locator('[value="native-choice"]').check();
    await review.locator('button').click();
    await page.locator('#error:not([hidden])').waitFor();
    const pending = await page.evaluate(
      () => JSON.parse(localStorage.getItem('ui-state-v1')).pending[0],
    );
    assert.ok(pending.operationId);
    await page.reload();
    await page.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
    await page
      .locator('#guided-pending')
      .filter({ hasText: pending.operationId })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'apply').length,
      ),
      0,
    );
    await page.locator('[data-action="prepare-shared"]').click();
    await page.locator('#error:not([hidden])').waitFor();
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'prepare').length,
      ),
      0,
    );
    await page.locator('[data-action="guided-acknowledge"]').click();
    await page.waitForFunction(
      () => !document.querySelector('[data-action="guided-acknowledge"]'),
    );
    const closed = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('ui-state-v1')).closedNotices.at(-1),
    );
    assert.equal(closed.operationId, pending.operationId);
    assert.equal(closed.acknowledgement, 'manual-result-checked');
    const receipt = await page.evaluate(
      (id) => JSON.parse(localStorage.getItem('op-' + id)),
      pending.operationId,
    );
    assert.equal(
      receipt.status,
      'pending',
      'manual acknowledgement must not forge an application receipt',
    );
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'apply').length,
      ),
      0,
    );
    await context.close();
  }
  for (const mode of ['uncertain', 'disconnected']) {
    const { page, context } = await fixture(mode);
    await page.locator('[data-action="prepare-shared"]').click();
    const review = page.locator('form[data-guided="apply-proposal"]');
    await review.locator('input[value="planner-choice"]').check();
    await review.getByRole('button', { name: 'Aplicar selección revisada' }).click();
    await page.locator('#error:not([hidden])').waitFor();
    const calls = await page.evaluate(() =>
      window.fixtureCalls.filter((c) => c.action === 'apply'),
    );
    assert.equal(calls.length, 1);
    const operationId = calls[0].params.operationId;
    assert.match(await page.locator('#error').innerText(), new RegExp(operationId));
    assert.equal(
      await review
        .getByRole('button', { name: 'Aplicar selección revisada' })
        .isDisabled(),
      true,
    );
    // Keep the action focusable when the UI explains why the receipt blocks it.
    await page.locator('[data-action="prepare-shared"]').click();
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'prepare').length,
      ),
      1,
    );
    assert.equal(
      await review.locator('input[value="planner-choice"]').isDisabled(),
      true,
    );
    await openDiagnostics(page);
    const receipt = page.locator('form[data-form="operation-status"]');
    await receipt.locator('[name="action"]').selectOption('apply');
    await receipt.locator('[name="operationId"]').fill(operationId);
    await receipt
      .getByRole('button', { name: 'Consultar recibo sin repetir cambios' })
      .click();
    await page
      .locator('#operation-result')
      .filter({ hasText: 'OUTCOME_UNKNOWN' })
      .waitFor();
    assert.match(
      await page.locator('#operation-result').innerText(),
      /Resultado incierto/,
    );
    assert.ok(
      await page.evaluate(
        (key) => window.fixtureReads.includes(key),
        'op-' + operationId,
      ),
    );
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'apply').length,
      ),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'prepare').length,
      ),
      1,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.fixtureWrites.filter((key) => key !== 'ui-state-v1'),
      ),
      [],
    );
    // A later native confirmation permits a fresh proposal; it never reapplies the old one.
    await page.evaluate((operationId) => {
      const key = 'op-' + operationId;
      const stored = JSON.parse(localStorage.getItem(key));
      stored.result = { status: 'applied' };
      localStorage.setItem(key, JSON.stringify(stored));
    }, operationId);
    await receipt
      .getByRole('button', { name: 'Consultar recibo sin repetir cambios' })
      .click();
    await page
      .locator('#operation-result')
      .filter({ hasText: 'Cambio confirmado' })
      .waitFor();
    await navigate(page, 'week');
    await page.locator('[data-action="prepare-shared"]').click();
    await page
      .locator('form[data-guided="apply-proposal"] input[value="native-choice"]')
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'prepare').length,
      ),
      2,
    );
    assert.equal(
      await page.evaluate(
        () => window.fixtureCalls.filter((c) => c.action === 'apply').length,
      ),
      1,
    );
    await context.close();
  }
  {
    const { page, context } = await fixture('deferred');
    await page.locator('[data-action="prepare-shared"]').click();
    const review = page.locator('form[data-guided="apply-proposal"]');
    await review.locator('input[value="native-choice"]').check();
    await review.getByRole('button', { name: 'Aplicar selección revisada' }).click();
    await page.waitForFunction(() =>
      window.fixtureCalls.some((call) => call.action === 'apply'),
    );
    // A programmatic second submit must be rejected even if disabled controls are bypassed.
    const lockedDuringPending = await review
      .locator('input[value="native-choice"]')
      .isDisabled();
    await page.evaluate(() => {
      document
        .querySelector('form[data-guided="apply-proposal"]')
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      document.querySelector('[data-action="prepare-shared"]').click();
    });
    const duringPending = await page.evaluate(() => ({
      prepare: window.fixtureCalls.filter((call) => call.action === 'prepare').length,
      apply: window.fixtureCalls.filter((call) => call.action === 'apply').length,
    }));
    assert.deepEqual(
      { ...duringPending, lockedDuringPending },
      { prepare: 1, apply: 1, lockedDuringPending: true },
      'An in-flight native application must lock selection, preparation and duplicate submissions.',
    );
    await page.evaluate(() => window.fixtureReleaseApply.forEach((release) => release()));
    await page
      .locator('#guided-proposal')
      .filter({ hasText: 'Operación confirmada.' })
      .waitFor();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS API simulada: preparación sin cambios ni selección implícita; selección explícita de destino nativo; resultado incierto bloquea reintentos y nueva propuesta; recibo pendiente consultado sin modificar datos.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
