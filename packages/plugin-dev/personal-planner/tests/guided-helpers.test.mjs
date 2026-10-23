import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmed, pendingOperation, proposalChanges } from '../src/guided-state.mjs';
import {
  initializeI18n,
  html,
  tr,
  displayClock,
  wallClock,
  translationKey,
} from '../src/i18n.mjs';
import { proposalReviewHTML } from '../src/forms.mjs';
import { translations } from '../src/translations.mjs';
import { readFile } from 'node:fs/promises';

test('host language/translations are reused, dynamic user text stays intact and language changes refresh', async () => {
  let language = 'en',
    hook,
    changed = 0;
  const en = JSON.parse(await readFile(new URL('../src/i18n/en.json', import.meta.url)));
  const es = JSON.parse(await readFile(new URL('../src/i18n/es.json', import.meta.url)));
  await initializeI18n(
    {
      getCurrentLanguage: async () => language,
      translate: async (key) => (language === 'en' ? en : es)[key] || key,
      registerHook: async (name, cb) => {
        assert.equal(name, 'languageChange');
        hook = cb;
      },
    },
    () => changed++,
  );
  assert.equal(tr('Revisión'), 'Review');
  const title = 'Configuración';
  assert.equal(
    html`<h3>Configuración</h3>
      <p>${title}</p>`.replace(/>\s+</g, '><'),
    '<h3>Settings</h3><p>Configuración</p>',
  );
  assert.match(
    displayClock(Date.UTC(2026, 10, 2, 14), 'Europe/Madrid', '12h'),
    /03:00.*PM/,
  );
  assert.equal(wallClock(Date.UTC(2026, 10, 2, 14), 'Europe/Madrid'), '15:00');
  language = 'es';
  await hook();
  assert.equal(tr('Revisión'), 'Revisión');
  assert.equal(changed, 1);
  assert.equal(Object.keys(en).length, Object.keys(translations).length);
  for (const key of Object.keys(translations))
    assert.ok(en[translationKey(key)] && es[translationKey(key)]);
});

test('pending records are cloneable and uncertain/missing receipts never count as confirmation', () => {
  const params = { fields: { title: 'Ficticia' } };
  const entry = pendingOperation('task', params, 'fictitious-operation');
  params.fields.title = 'Cambiada';
  assert.equal(entry.params.fields.title, 'Ficticia');
  assert.equal(confirmed({ status: 'uncertain' }), false);
  assert.equal(confirmed({ status: 'not_found' }), false);
  for (const status of ['applied', 'rejected', 'conflict'])
    assert.equal(confirmed({ status }), true);
});

test('proposal edits use civil epochs and reject ambiguous DST times', () => {
  const form = new Map([
    ['date:p', '2026-11-02'],
    ['start:p', '09:00'],
    ['end:p', '09:30'],
  ]);
  const proposal = { proposals: [{ id: 'p', date: '2026-11-02', interval: [1, 2] }] };
  assert.deepEqual(proposalChanges(form, proposal, 'Europe/Madrid'), [
    { itemId: 'p', start: Date.UTC(2026, 10, 2, 8), end: Date.UTC(2026, 10, 2, 8, 30) },
  ]);
  form.set('date:p', '2026-10-25');
  form.set('start:p', '02:30');
  assert.throws(() => proposalChanges(form, proposal, 'Europe/Madrid'), /ambigua/);
});

test('undo of an unscheduled native task remains selectable without an interval', () => {
  const html = proposalReviewHTML(
    {
      proposals: [
        {
          id: 'undo',
          target: 'native-task',
          title: 'Ejemplo',
          interval: null,
          selectable: true,
          reason: 'Desprogramar',
        },
      ],
    },
    String,
  );
  assert.match(html, /name="selection"/);
  assert.match(html, /value="undo"/);
  assert.equal(
    (html.match(/<label>/g) || []).length,
    (html.match(/<\/label>/g) || []).length,
  );
});

test('only changed alternatives are adjusted; unedited seconds are preserved and untouched overlapping alternatives are omitted', () => {
  const start = Date.UTC(2026, 10, 2, 8, 0, 45),
    end = start + 1800000;
  const proposal = {
    proposals: [
      { id: 'a', date: '2026-11-02', interval: [start, end] },
      { id: 'b', date: '2026-11-02', interval: [start, end] },
    ],
  };
  const form = new Map([
    ['date:a', '2026-11-02'],
    ['start:a', '09:00'],
    ['end:a', '09:30'],
    ['date:b', '2026-11-02'],
    ['start:b', '09:00'],
    ['end:b', '09:30'],
  ]);
  assert.deepEqual(proposalChanges(form, proposal, 'Europe/Madrid'), []);
  form.set('start:a', '10:00');
  form.set('end:a', '10:30');
  assert.deepEqual(proposalChanges(form, proposal, 'Europe/Madrid'), [
    { itemId: 'a', start: Date.UTC(2026, 10, 2, 9), end: Date.UTC(2026, 10, 2, 9, 30) },
  ]);
});

test('adapter reuses native calendar snapshot and makes access failures explicit', async () => {
  const { createAdapter } = await import('../src/adapter.mjs');
  let denied = false;
  const event = {
    id: 'fictional-calendar',
    title: 'Compromiso ficticio',
    start: Date.UTC(2026, 10, 2, 9),
    duration: 3600000,
  };
  const adapter = createAdapter({
    getTasks: async () => [],
    getArchivedTasks: async () => [],
    getAllProjects: async () => [],
    getAllTags: async () => [],
    getAppState: async () => ({
      globalConfig: { misc: { startOfNextDayTime: '00:00' } },
    }),
    plannerOperation: async (action) => {
      assert.equal(action, 'calendar_snapshot');
      if (denied) throw Error('not permitted');
      return {
        calendarEvents: [event],
        calendarWarnings: ['Cobertura ficticia parcial.'],
      };
    },
  });
  const snapshot = await adapter.snapshot();
  assert.deepEqual(snapshot.calendarEvents, [event]);
  assert.ok(snapshot.warnings.includes('Cobertura ficticia parcial.'));
  denied = true;
  const partial = await adapter.snapshot();
  assert.deepEqual(partial.calendarEvents, []);
  assert.ok(
    partial.warnings.some((warning) =>
      warning.includes('Calendarios nativos no disponibles'),
    ),
  );
});

test('Today uses shared time reliability rules instead of inventing zero for an empty daily map', async () => {
  const { taskDailyMinutes } = await import('../src/guided-state.mjs');
  const { taskSnapshot } = await import('../src/metrics.mjs');
  const task = {
    id: 'legacy-task',
    timeSpent: 60000,
    timeSpentOnDay: {},
    subTaskIds: [],
  };
  const snapshot = { ...taskSnapshot([task], []), civilDaysReliable: true };
  assert.equal(taskDailyMinutes(snapshot, task, '2026-11-02'), null);
  const known = { ...task, timeSpentOnDay: { '2026-11-01': 60000 } };
  assert.equal(taskDailyMinutes(snapshot, known, '2026-11-02'), 0);
  assert.equal(
    taskDailyMinutes({ ...snapshot, civilDaysReliable: false }, known, '2026-11-02'),
    null,
  );
});
