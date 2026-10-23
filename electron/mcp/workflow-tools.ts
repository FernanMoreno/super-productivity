import { ASSISTANT_PLANNER_PATH } from '../shared-with-frontend/assistant-access.model';
import {
  WORKFLOW_COMMAND_TYPES,
  WORKFLOW_VIEWS,
  workflowRequiredScopes,
} from '../shared-with-frontend/workflow-contract.model';
import {
  ToolSpec,
  UNTRUSTED_NOTE,
  isRecord,
  byteLength,
  MAX_RESPONSE_BYTES,
  ok,
  fail,
  invalid,
  findUnknownArg,
} from './mcp-tool-kit';

const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$', maxLength: 200 };
const op = { type: 'string', pattern: '^[A-Za-z0-9_-]{8,80}$', maxLength: 80 };
const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const text = { type: 'string', minLength: 1, maxLength: 500 };
const revisionSchema = { type: 'string', minLength: 1, maxLength: 200 };
const shape = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const criteria = {
  type: 'array',
  maxItems: 50,
  items: shape({ id, text: { ...text, maxLength: 1000 }, isDone: { type: 'boolean' } }),
};
const provider = { type: 'string', enum: ['trello', 'jira'] };
const trelloId = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$', maxLength: 128 };
const url = { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 };
// Keys are the public wire command names, shared with the native workflow validator.
/* eslint-disable @typescript-eslint/naming-convention */
const payloadSchemas: Record<string, Record<string, unknown>> = {
  'task.move': shape(
    {
      taskId: id,
      column: {
        type: 'string',
        enum: ['inbox', 'ready', 'in_progress', 'blocked', 'done'],
      },
      columnId: id,
    },
    ['taskId', 'column'],
  ),
  'task.dependencies': shape({
    taskId: id,
    dependsOn: { type: 'array', items: id, maxItems: 50, uniqueItems: true },
  }),
  'task.block': shape(
    { taskId: id, reason: { ...text, maxLength: 2000 }, reviewOn: day },
    ['taskId', 'reason'],
  ),
  'task.unblock': shape({ taskId: id }),
  'task.criteria': shape({ taskId: id, criteria }),
  'task.priority': shape({
    taskId: id,
    priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
  }),
  'task.review': shape({ taskId: id, date: day }),
  'task.link': shape({ taskId: id, provider, externalId: id, url }),
  'task.unlink': shape({ taskId: id, provider, url }),
  'board.configure': shape(
    { wipLimit: { type: 'integer', minimum: 1, maximum: 20 }, projectId: id },
    ['wipLimit'],
  ),
  'board.column.save': shape({
    projectId: id,
    column: shape({
      id,
      title: text,
      status: {
        type: 'string',
        enum: ['inbox', 'ready', 'in_progress', 'blocked', 'done'],
      },
    }),
  }),
  'board.column.reorder': shape({
    projectId: id,
    columnIds: { type: 'array', items: id, minItems: 1, maxItems: 50, uniqueItems: true },
  }),
  'board.column.remove': shape({ projectId: id, columnId: id, targetColumnId: id }, [
    'projectId',
    'columnId',
  ]),
  'template.save': shape({
    template: shape({
      id,
      title: text,
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: shape({
          title: text,
          timeEstimate: { type: 'integer', minimum: 0, maximum: 86400000 },
        }),
      },
      criteria,
    }),
  }),
  'template.remove': shape({ templateId: id }),
  'template.apply': shape({ templateId: id, projectId: id, title: text }, [
    'templateId',
    'projectId',
  ]),
  'week.apply': shape(
    {
      assignments: {
        type: 'array',
        minItems: 1,
        maxItems: 500,
        items: shape({ taskId: id, date: day }),
      },
      weekRevision: revisionSchema,
      allowPartial: { type: 'boolean' },
    },
    ['assignments', 'weekRevision'],
  ),
  'integration.link': shape({
    taskId: id,
    providerId: id,
    issueId: { ...text, maxLength: 256 },
  }),
  'integration.unlink': shape({ taskId: id }),
  'integration.refresh': shape({ taskId: id }),
  'integration.move': shape({
    taskId: id,
    targetListId: trelloId,
    expectedListId: trelloId,
    expectedBoardId: trelloId,
  }),
  'integration.sync': shape(
    {
      taskId: id,
      targetStatus: { ...text, maxLength: 256 },
      expectedRemoteStatus: { ...text, maxLength: 256 },
    },
    ['taskId', 'targetStatus'],
  ),
};
/* eslint-enable @typescript-eslint/naming-convention */
const queryProperties = {
  view: { type: 'string', enum: WORKFLOW_VIEWS },
  projectId: id,
  taskId: id,
  taskIds: { type: 'array', items: id, maxItems: 500 },
  date: day,
  from: day,
  to: day,
  limit: { type: 'integer', minimum: 1, maximum: 500 },
  includeSubtasks: { type: 'boolean' },
  operationId: op,
};
const commandProperties = {
  operationId: op,
  baseRevision: { type: 'string', minLength: 1, maxLength: 200 },
  nativeRevision: { type: 'string', minLength: 1, maxLength: 200 },
  command: {
    type: 'object',
    required: ['type', 'payload'],
    properties: {
      type: { type: 'string', enum: WORKFLOW_COMMAND_TYPES },
      payload: { type: 'object' },
    },
    additionalProperties: false,
    oneOf: WORKFLOW_COMMAND_TYPES.map((type) =>
      shape({ type: { const: type }, payload: payloadSchemas[type] }),
    ),
  },
};
const validate = (action: string, args: Record<string, unknown>): boolean => {
  if (
    byteLength(args) > 65536 ||
    findUnknownArg(
      args,
      Object.keys(action === 'workflow_query' ? queryProperties : commandProperties),
    )
  )
    return false;
  if (action === 'workflow_command') {
    const c = args['command'];
    return (
      typeof args['operationId'] === 'string' &&
      /^[A-Za-z0-9_-]{8,80}$/.test(args['operationId']) &&
      ['baseRevision', 'nativeRevision'].every(
        (k) =>
          typeof args[k] === 'string' &&
          (args[k] as string).length > 0 &&
          (args[k] as string).length <= 200,
      ) &&
      isRecord(c) &&
      !findUnknownArg(c, ['type', 'payload']) &&
      (WORKFLOW_COMMAND_TYPES as readonly unknown[]).includes(c['type']) &&
      isRecord(c['payload']) &&
      (c['type'] !== 'integration.move' ||
        (!findUnknownArg(c['payload'], [
          'taskId',
          'targetListId',
          'expectedListId',
          'expectedBoardId',
        ]) &&
          typeof c['payload']['taskId'] === 'string' &&
          /^[A-Za-z0-9_-]{1,200}$/.test(c['payload']['taskId']) &&
          ['targetListId', 'expectedListId', 'expectedBoardId'].every(
            (key) =>
              typeof c['payload'][key] === 'string' &&
              /^[A-Za-z0-9_-]{1,128}$/.test(c['payload'][key] as string),
          )))
    );
  }
  if (!(WORKFLOW_VIEWS as readonly unknown[]).includes(args['view'])) return false;
  for (const k of ['projectId', 'taskId'])
    if (
      args[k] !== undefined &&
      (typeof args[k] !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(args[k] as string))
    )
      return false;
  for (const k of ['date', 'from', 'to'])
    if (
      args[k] !== undefined &&
      (typeof args[k] !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(args[k] as string) ||
        Number.isNaN(Date.parse(args[k] + 'T12:00:00Z')) ||
        new Date(args[k] + 'T12:00:00Z').toISOString().slice(0, 10) !== args[k])
    )
      return false;
  if (
    args['limit'] !== undefined &&
    (!Number.isInteger(args['limit']) ||
      Number(args['limit']) < 1 ||
      Number(args['limit']) > 500)
  )
    return false;
  if (
    args['includeSubtasks'] !== undefined &&
    typeof args['includeSubtasks'] !== 'boolean'
  )
    return false;
  if (
    args['taskIds'] !== undefined &&
    (!Array.isArray(args['taskIds']) ||
      args['taskIds'].length > 500 ||
      !args['taskIds'].every(
        (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v),
      ))
  )
    return false;
  return (
    args['view'] !== 'receipt' ||
    (typeof args['operationId'] === 'string' &&
      /^[A-Za-z0-9_-]{8,80}$/.test(args['operationId']))
  );
};
export const WORKFLOW_TOOLS: ToolSpec[] = ['workflow_query', 'workflow_command'].map(
  (action) => ({
    requiredScopes: workflowRequiredScopes(action, {}),
    mutates: action === 'workflow_command',
    definition: {
      name: action,
      description:
        (action === 'workflow_query'
          ? 'Read native-task Kanban, templates, capacity-aware week, review, configured integrations or durable operation receipt.'
          : 'Apply an explicit task workflow command using fresh revision/nativeRevision. No timer starts on card movement. Keep operationId on timeout and inspect receipt; never retry with a new ID. Integration sync is explicit and needs separate issue permissions.') +
        ' ' +
        UNTRUSTED_NOTE,
      inputSchema: {
        type: 'object',
        properties: action === 'workflow_query' ? queryProperties : commandProperties,
        required:
          action === 'workflow_query'
            ? ['view']
            : ['operationId', 'baseRevision', 'nativeRevision', 'command'],
        additionalProperties: false,
      },
    },
    run: async (args, _scopes, forward, getScopes) => {
      if (!validate(action, args))
        return invalid(
          'Invalid workflow arguments. Read a fresh view before submitting a bounded command.',
        );
      const required = workflowRequiredScopes(action, args);
      if (!required.every((s) => getScopes().includes(s)))
        return fail('NOT_PERMITTED', 'Workflow permissions unavailable.');
      let reply;
      try {
        reply = await forward({
          method: 'POST',
          path: ASSISTANT_PLANNER_PATH,
          body: { action, params: args, grantedScopes: [...getScopes()] },
          source: 'mcp',
          timeoutMs: 45000,
        });
      } catch {
        return fail(
          action === 'workflow_command' ? 'OUTCOME_UNKNOWN' : 'APP_UNAVAILABLE',
          'No confirmed workflow result; inspect the operation receipt before retrying.',
        );
      }
      if (action === 'workflow_query' && !required.every((s) => getScopes().includes(s)))
        return fail('NOT_PERMITTED', 'Workflow permissions revoked.');
      if (!reply.body.ok || !isRecord(reply.body.data))
        return fail(
          action === 'workflow_command' ? 'OUTCOME_UNKNOWN' : 'DATA_UNAVAILABLE',
          'Workflow result unavailable.',
        );
      const data = { ...reply.body.data };
      if (args['view'] === 'receipt') {
        if (
          !Array.isArray(data['_requiredScopes']) ||
          !data['_requiredScopes'].every((s) => getScopes().includes(s))
        )
          return fail('NOT_PERMITTED', 'Original operation permissions unavailable.');
        delete data['_requiredScopes'];
        delete data['requiredAction'];
      }
      if (byteLength(data) > MAX_RESPONSE_BYTES)
        return fail(
          'RESPONSE_TOO_LARGE',
          'Narrow the workflow query. Mutation outcome may require receipt inspection.',
        );
      return ok(data);
    },
  }),
);
