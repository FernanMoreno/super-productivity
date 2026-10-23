const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({
  transpileOnly: true,
  preferTsExts: true,
  compilerOptions: {
    module: 'Node16',
    moduleResolution: 'Node16',
    verbatimModuleSyntax: false,
  },
});
// Browser error reporting is unrelated to the pure calendar boundaries under test.
require.cache[require.resolve('../../util/dev-error.ts')] = {
  exports: {
    devError(message) {
      throw new Error(message);
    },
  },
};
const { projectTaskDateGroups } = require('./project-task-date-groups');
const today = '2026-10-22';
test('separates today, future dates and unscheduled tasks without changing their identities', () => {
  const tasks = [
    { id: 'none' },
    { id: 'future', dueDay: '2026-10-24' },
    { id: 'today', dueDay: today },
    { id: 'next', dueDay: '2026-10-23' },
    { id: 'today2', dueDay: today },
  ];
  const groups = projectTaskDateGroups(tasks, today, 0);
  assert.deepEqual(
    groups.map((g) => [g.kind, g.key, g.tasks.map((t) => t.id)]),
    [
      ['today', today, ['today', 'today2']],
      ['scheduled', '2026-10-23', ['next']],
      ['scheduled', '2026-10-24', ['future']],
      ['unscheduled', 'unscheduled', ['none']],
    ],
  );
  assert.equal(groups[0].tasks[0], tasks[2]);
  assert.equal(tasks[0].id, 'none');
  assert.equal(
    new Set(groups.flatMap((g) => g.tasks.map((t) => t.id))).size,
    tasks.length,
  );
});
test('uses the application logical day for timed tasks and preserves date-only dates', () => {
  const groups = projectTaskDateGroups(
    [
      { id: 'late', dueWithTime: new Date(2026, 9, 23, 1).getTime() },
      { id: 'next', dueWithTime: new Date(2026, 9, 23, 5).getTime() },
      { id: 'dated', dueDay: '2026-10-23' },
    ],
    today,
    4 * 60 * 60 * 1000,
  );
  assert.deepEqual(
    groups.map((g) => [g.key, g.tasks.map((t) => t.id)]),
    [
      [today, ['late']],
      ['2026-10-23', ['next', 'dated']],
    ],
  );
});
test('omits empty groups and responds to replanning', () => {
  assert.deepEqual(projectTaskDateGroups([], today, 0), []);
  const task = { id: 'task', dueDay: today };
  assert.equal(projectTaskDateGroups([task], today, 0)[0].kind, 'today');
  assert.equal(
    projectTaskDateGroups([{ ...task, dueDay: '2026-10-24' }], today, 0)[0].key,
    '2026-10-24',
  );
});
