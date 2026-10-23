import { AssistantAccessScope } from './assistant-access.model';

export const WORKFLOW_COMMAND_TYPES = [
  'task.move',
  'task.dependencies',
  'task.block',
  'task.unblock',
  'task.criteria',
  'task.priority',
  'task.review',
  'task.link',
  'task.unlink',
  'board.configure',
  'board.column.save',
  'board.column.reorder',
  'board.column.remove',
  'template.save',
  'template.remove',
  'template.apply',
  'week.apply',
  'integration.link',
  'integration.unlink',
  'integration.refresh',
  'integration.sync',
  'integration.move',
] as const;
export const WORKFLOW_VIEWS = [
  'board',
  'week',
  'review',
  'templates',
  'integrations',
  'receipt',
] as const;
export const workflowRequiredScopes = (
  action: string,
  params: Record<string, unknown>,
): readonly AssistantAccessScope[] => {
  const read: AssistantAccessScope[] = ['planner:read', 'tasks:read'];
  const command = params['command'] as { type?: string } | undefined;
  if (
    action === 'workflow_command' ||
    action === 'workflow_issue_read' ||
    action === 'workflow_issue_write'
  )
    read.push('planner:write', 'tasks:write');
  if (
    params['view'] === 'integrations' ||
    action === 'workflow_issue_query' ||
    command?.type?.startsWith('integration.') ||
    action === 'workflow_issue_read' ||
    action === 'workflow_issue_write'
  )
    read.push('issues:read');
  if (
    ['integration.sync', 'integration.move'].includes(command?.type || '') ||
    action === 'workflow_issue_write'
  )
    read.push('issues:write');
  return read;
};
