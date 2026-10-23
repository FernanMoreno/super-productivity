const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true });
const {
  workspaceLinks,
  projectEntryRoute,
  workspaceDestination,
  workspaceRequestRoute,
  isWorkspaceNavigation,
} = require('./workspace-navigation');
test('projects default to their own board while Inbox remains a capture list', () => {
  assert.equal(projectEntryRoute('alpha', true), '/project/alpha/board');
  assert.equal(projectEntryRoute('alpha', false), '/project/alpha/tasks');
  assert.equal(projectEntryRoute('INBOX', true, 'INBOX'), '/project/INBOX/tasks');
});
test('disabled calendar features have no links and project context is retained', () => {
  const links = workspaceLinks(
    'calendar',
    'alpha',
    { isPlannerEnabled: false, isSchedulerEnabled: false },
    true,
  );
  assert.deepEqual(
    links.map((x) => x.route),
    ['/calendar', '/calendar/plan-week'],
  );
  const project = workspaceLinks('project', 'alpha', {}, true);
  assert.ok(project.some((x) => x.route === '/project/alpha/tasks'));
  assert.ok(project.some((x) => x.route === '/project/alpha/calendar'));
});
test('plugin-dependent links disappear when the planner is not active', () => {
  assert.deepEqual(
    workspaceLinks('calendar', '', { isPlannerEnabled: true }, false).map((x) => x.route),
    ['/planner'],
  );
});

test('one matcher resolves project and global presentation without swallowing native deep links', () => {
  assert.deepEqual(workspaceDestination(['project', 'alpha', 'board']), {
    group: 'project',
    section: 'workflow',
    title: 'PROJECTS',
    id: 'alpha',
  });
  assert.equal(workspaceDestination(['project', 'alpha', 'tasks']), null);
  assert.equal(workspaceDestination(['project', 'alpha', 'history']), null);
  assert.equal(workspaceDestination(['plugins', 'personal-planner', 'index']), null);
  assert.equal(workspaceDestination(['review', 'issues']).section, 'workflow-review');
  assert.equal(workspaceDestination(['calendar', 'plan-week']).section, 'workflow-week');
});

test('embedded requests use native scoped routes and reject unknown destinations', () => {
  assert.equal(workspaceRequestRoute('workflow', 'alpha'), '/project/alpha/board');
  assert.equal(workspaceRequestRoute('templates', 'alpha'), '/project/alpha/templates');
  assert.equal(workspaceRequestRoute('week', 'alpha'), '/project/alpha/calendar');
  assert.equal(workspaceRequestRoute('workflow'), '/projects');
  assert.equal(workspaceRequestRoute('workflow-week'), '/calendar/plan-week');
  assert.equal(workspaceRequestRoute('delete-all'), null);
});

test('Today keeps native execution and adds availability as a secondary view', () => {
  assert.deepEqual(
    workspaceLinks('today', '', {}, true).map((x) => x.route),
    ['/tag/TODAY/tasks', '/today/plan'],
  );
  assert.deepEqual(
    workspaceLinks('today', '', {}, false).map((x) => x.route),
    ['/tag/TODAY/tasks'],
  );
  assert.equal(workspaceDestination(['today', 'plan']).section, 'today');
  assert.equal(workspaceDestination(['settings', 'diagnostics']).section, 'diagnostics');
});

test('reused workspace views retain drafts while native destinations destroy the iframe', () => {
  assert.equal(isWorkspaceNavigation('/calendar'), true);
  assert.equal(isWorkspaceNavigation('/review/issues?projectId=alpha'), true);
  assert.equal(isWorkspaceNavigation('/project/alpha/board?taskId=task-a'), true);
  assert.equal(isWorkspaceNavigation('/settings/diagnostics#details'), true);
  assert.equal(isWorkspaceNavigation('/planner'), false);
  assert.equal(isWorkspaceNavigation('/tag/TODAY/tasks'), false);
  assert.equal(isWorkspaceNavigation('/project/alpha/tasks'), false);
  assert.equal(isWorkspaceNavigation('/config'), false);
});
