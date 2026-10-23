export type WorkspaceGroup =
  | 'project'
  | 'calendar'
  | 'review'
  | 'reports'
  | 'goals'
  | 'library'
  | 'projects'
  | 'settings'
  | 'today';
export interface WorkspaceLink {
  label: string;
  route: string;
}
export const projectEntryRoute = (
  id: string,
  planner: boolean,
  inboxId = 'INBOX_PROJECT',
): string => `/project/${id}/${planner && id !== inboxId ? 'board' : 'tasks'}`;

export const workspaceLinks = (
  group: WorkspaceGroup,
  projectId: string,
  features: { isPlannerEnabled?: boolean; isSchedulerEnabled?: boolean },
  planner: boolean,
): WorkspaceLink[] => {
  const link = (label: string, route: string): WorkspaceLink => ({
    label: `AW.${label}`,
    route,
  });
  switch (group) {
    case 'today':
      return [
        link('TASKS', '/tag/TODAY/tasks'),
        ...(planner ? [link('AGENDA', '/today/plan')] : []),
      ];
    case 'project':
      return [
        ...(planner ? [link('BOARD', `/project/${projectId}/board`)] : []),
        link('LIST', `/project/${projectId}/tasks`),
        ...(planner
          ? [
              link('CALENDAR', `/project/${projectId}/calendar`),
              link('TEMPLATES', `/project/${projectId}/templates`),
            ]
          : []),
        link('HISTORY', `/project/${projectId}/history`),
        link('METRICS', `/project/${projectId}/metrics`),
      ];
    case 'calendar':
      return [
        ...(features.isPlannerEnabled ? [link('DAY_PLAN', '/planner')] : []),
        ...(features.isSchedulerEnabled ? [link('TIME_GRID', '/schedule')] : []),
        ...(planner
          ? [link('CAPACITY', '/calendar'), link('PLAN_WEEK', '/calendar/plan-week')]
          : []),
      ];
    case 'review':
      return planner
        ? [
            link('GUIDED_REVIEW', '/review'),
            link('PENDING', '/review/issues'),
            link('CHANGES', '/review/changes'),
          ]
        : [];
    case 'settings':
      return [
        link('SETTINGS', '/config'),
        ...(planner
          ? [
              link('CONNECTIONS', '/settings/integrations'),
              link('PREFERENCES', '/settings/planner'),
              link('DIAGNOSTICS', '/settings/diagnostics'),
            ]
          : []),
      ];
    case 'projects':
      return [link('PROJECTS', '/projects'), link('ARCHIVED', '/archived-projects')];
    default:
      return [];
  }
};

/** One route configuration keeps the iframe/editor mounted between workspace views. */
export const workspaceDestination = (
  segments: string[],
): { group: WorkspaceGroup; section: string; title: string; id?: string } | null => {
  if (segments[0] === 'project' && segments.length === 3 && segments[1]) {
    const sections: Record<string, string> = {
      board: 'workflow',
      calendar: 'week',
      templates: 'templates',
    };
    const section = sections[segments[2]];
    return section
      ? { group: 'project', section, title: 'PROJECTS', id: segments[1] }
      : null;
  }
  const paths = new Map<string, [WorkspaceGroup, string, string]>([
    ['today/plan', ['today', 'today', 'TODAY']],
    ['projects', ['projects', 'workflow', 'PROJECTS']],
    ['calendar', ['calendar', 'week', 'CALENDAR']],
    ['calendar/plan-week', ['calendar', 'workflow-week', 'CALENDAR']],
    ['review', ['review', 'review', 'REVIEW']],
    ['review/issues', ['review', 'workflow-review', 'REVIEW']],
    ['review/changes', ['review', 'history', 'REVIEW']],
    ['goals', ['goals', 'goals', 'GOALS']],
    ['templates', ['library', 'templates', 'TEMPLATES']],
    ['settings/integrations', ['settings', 'integrations', 'CONNECTIONS']],
    ['settings/planner', ['settings', 'settings', 'PREFERENCES']],
    ['settings/diagnostics', ['settings', 'diagnostics', 'DIAGNOSTICS']],
  ]);
  const value = paths.get(segments.join('/'));
  return value ? { group: value[0], section: value[1], title: value[2] } : null;
};

export const workspaceRequestRoute = (
  section: string,
  projectId?: string,
): string | null => {
  if (projectId && ['workflow', 'week', 'templates'].includes(section)) {
    const view = { workflow: 'board', week: 'calendar', templates: 'templates' }[section];
    return `/project/${encodeURIComponent(projectId)}/${view}`;
  }
  const routes = new Map([
    ['workflow', '/projects'],
    ['week', '/calendar'],
    ['workflow-week', '/calendar/plan-week'],
    ['templates', '/templates'],
    ['review', '/review'],
    ['workflow-review', '/review/issues'],
    ['history', '/review/changes'],
    ['goals', '/goals'],
    ['settings', '/settings/planner'],
    ['integrations', '/settings/integrations'],
    ['diagnostics', '/settings/diagnostics'],
    ['today', '/tag/TODAY/tasks'],
  ]);
  return routes.get(section) || null;
};

/** All workspace URLs share one route configuration and preserve the iframe. */
export const isWorkspaceNavigation = (url: string): boolean =>
  workspaceDestination(url.split(/[?#]/, 1)[0].split('/').filter(Boolean)) !== null;
