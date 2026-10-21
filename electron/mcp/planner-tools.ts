import {
  AssistantAccessScope,
  ASSISTANT_PLANNER_PATH,
  ASSISTANT_CAPTURE_TIMEOUT_MS,
} from '../shared-with-frontend/assistant-access.model';
import {
  ToolSpec,
  isRecord,
  findUnknownArg,
  byteLength,
  MAX_RESPONSE_BYTES,
  ok,
  fail,
  invalid,
  failFromRenderer,
  UNTRUSTED_NOTE,
} from './mcp-tool-kit';

const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_SELECTION = 500;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const validDay = (v: unknown): v is string =>
  typeof v === 'string' &&
  new RegExp(DATE_PATTERN).test(v) &&
  !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) &&
  new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const validId = (v: unknown): v is string => typeof v === 'string' && ID_PATTERN.test(v);
const validOperation = (v: unknown): boolean =>
  typeof v === 'string' && OPERATION_PATTERN.test(v);
const unknown = (
  args: Record<string, unknown>,
  allowed: string[],
): string | undefined => {
  const key = findUnknownArg(args, allowed);
  return key ? `Unknown argument: ${key}` : undefined;
};

export const PLANNER_COMMAND_TYPES = [
  'activity.create',
  'activity.update',
  'activity.goals',
  'activity.state',
  'activity.completion',
  'activity.reorder',
  'commitment.create',
  'commitment.edit',
  'commitment.skip',
  'commitment.remove',
  'deadline.upsert',
  'deadline.remove',
  'preferences.update',
  'completeness.update',
  'exclusion.upsert',
  'exclusion.remove',
] as const;
const QUERY_SCOPES: readonly AssistantAccessScope[] = [
  'planner:read',
  'tasks:read',
  'tasks:read_history',
];
const idSchema = { type: 'string', pattern: ID_PATTERN.source, maxLength: 200 };
const operationSchema = {
  type: 'string',
  pattern: OPERATION_PATTERN.source,
  minLength: 8,
  maxLength: 80,
};
const dateSchema = { type: 'string', pattern: DATE_PATTERN };
const rangeProperties = { from: dateSchema, to: dateSchema };
const rangeError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, ['from', 'to']);
  if (extra) return extra;
  if (!validDay(args.from) || !validDay(args.to))
    return 'from and to must be valid YYYY-MM-DD calendar dates';
  const elapsed =
    Date.parse(`${args.to}T12:00:00Z`) - Date.parse(`${args.from}T12:00:00Z`);
  const dayDifference = elapsed / 86400000;
  const count = dayDifference + 1;
  return count < 1 || count > 93
    ? 'The range must contain 1 to 93 inclusive days'
    : undefined;
};
const editError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, ['operationId', 'baseRevision', 'command']);
  if (extra) return extra;
  if (!validOperation(args.operationId))
    return 'operationId must contain 8 to 80 letters, digits, underscores or hyphens';
  if (
    typeof args.baseRevision !== 'string' ||
    args.baseRevision.length < 1 ||
    args.baseRevision.length > 200
  )
    return 'baseRevision must be a nonempty revision of at most 200 characters';
  const c = args.command;
  if (
    !isRecord(c) ||
    unknown(c, ['type', 'payload']) ||
    !(PLANNER_COMMAND_TYPES as readonly unknown[]).includes(c.type) ||
    !isRecord(c.payload)
  )
    return 'command must contain a supported type and an object payload';
  if (byteLength(c.payload) > MAX_COMMAND_BYTES) return 'command.payload exceeds 64 KiB';
  return undefined;
};
const taskError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, ['operationId', 'taskId', 'fields']);
  if (extra) return extra;
  if (
    !validOperation(args.operationId) ||
    (args.taskId !== undefined && !validId(args.taskId))
  )
    return 'operationId or taskId is invalid';
  const f = args.fields;
  if (
    !isRecord(f) ||
    !Object.keys(f).length ||
    unknown(f, ['title', 'isDone', 'timeEstimate', 'projectId', 'tagIds', 'dueDay'])
  )
    return 'fields must contain supported native task fields';
  if (
    f.title !== undefined &&
    (typeof f.title !== 'string' || !f.title.trim() || f.title.length > 500)
  )
    return 'title must contain 1 to 500 characters';
  if (f.isDone !== undefined && typeof f.isDone !== 'boolean')
    return 'isDone must be a boolean';
  if (
    f.timeEstimate !== undefined &&
    (typeof f.timeEstimate !== 'number' ||
      !Number.isSafeInteger(f.timeEstimate) ||
      f.timeEstimate < 0 ||
      f.timeEstimate > 365 * 86400000)
  )
    return 'timeEstimate must be a nonnegative integer of milliseconds up to one year';
  if (f.projectId !== undefined && !validId(f.projectId))
    return 'projectId must be an id';
  if (
    f.tagIds !== undefined &&
    (!Array.isArray(f.tagIds) ||
      f.tagIds.length > 200 ||
      !f.tagIds.every(validId) ||
      new Set(f.tagIds).size !== f.tagIds.length ||
      f.tagIds.includes('TODAY'))
  )
    return 'tagIds must contain at most 200 distinct native tag ids; TODAY is virtual';
  if (f.dueDay !== undefined && f.dueDay !== null && !validDay(f.dueDay))
    return 'dueDay must be a calendar day or null';
  return undefined;
};
const timeError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, [
    'operationId',
    'activityId',
    'taskId',
    'date',
    'durationMs',
  ]);
  if (extra) return extra;
  if (
    !validOperation(args.operationId) ||
    !validId(args.activityId) ||
    !validId(args.taskId) ||
    !validDay(args.date)
  )
    return 'operationId, activityId, taskId or date is invalid';
  if (
    typeof args.durationMs !== 'number' ||
    !Number.isInteger(args.durationMs) ||
    args.durationMs < 1 ||
    args.durationMs > 86400000
  )
    return 'durationMs must be a positive integer of milliseconds up to 24 hours';
  return undefined;
};
const applyError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, ['operationId', 'proposalId', 'selection']);
  if (extra) return extra;
  if (!validOperation(args.operationId) || !validId(args.proposalId))
    return 'operationId or proposalId is invalid';
  if (
    !Array.isArray(args.selection) ||
    !args.selection.length ||
    args.selection.length > MAX_SELECTION ||
    !args.selection.every(validId) ||
    new Set(args.selection).size !== args.selection.length
  )
    return 'selection must contain 1 to 500 distinct proposed block ids';
  return undefined;
};

interface PlannerToolOptions {
  action: 'activities' | 'query' | 'edit' | 'task' | 'log_time' | 'prepare' | 'apply';
  requiredScopes: readonly AssistantAccessScope[];
  mutates?: boolean;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  validate: (args: Record<string, unknown>) => string | undefined;
}
const plannerTool = (options: PlannerToolOptions): ToolSpec => ({
  requiredScopes: options.requiredScopes,
  mutates: options.mutates,
  definition: {
    name: `planner_${options.action}`,
    description: options.description + ' ' + UNTRUSTED_NOTE,
    inputSchema: {
      type: 'object',
      properties: options.properties,
      ...(options.required ? { required: options.required } : {}),
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward, getScopes) => {
    const error = options.validate(args);
    if (error) return invalid(error);
    // Grants are main-owned. Never trust fields supplied by the caller, nor a
    // grant snapshot taken before validation. The renderer validates commands
    // again using the same domain rules as the planner UI.
    const grantedScopes = [...getScopes()];
    if (!options.requiredScopes.every((scope) => grantedScopes.includes(scope)))
      return fail('NOT_PERMITTED', 'This connection may not use this tool.');
    let reply;
    try {
      reply = await forward({
        method: 'POST',
        path: ASSISTANT_PLANNER_PATH,
        body: { action: options.action, params: args, grantedScopes },
        source: 'mcp',
        timeoutMs: ASSISTANT_CAPTURE_TIMEOUT_MS,
      });
    } catch {
      return options.mutates
        ? fail(
            'OUTCOME_UNKNOWN',
            'The change may have been saved. Retry only with the same operationId after checking its outcome.',
          )
        : fail('APP_UNAVAILABLE', 'Super Productivity could not handle the request.');
    }
    if (!reply.body.ok) return failFromRenderer(reply);
    if (!isRecord(reply.body.data))
      return fail('INTERNAL_ERROR', 'The planner returned an invalid result.');
    if (byteLength(reply.body.data) > MAX_RESPONSE_BYTES)
      return fail(
        'RESPONSE_TOO_LARGE',
        options.mutates
          ? 'The result is too large; the change may have been saved. Check before retrying.'
          : 'The result is too large; narrow the date range.',
      );
    return ok(reply.body.data);
  },
});
export const PLANNER_TOOLS: ToolSpec[] = [
  plannerTool({
    action: 'activities',
    requiredScopes: ['planner:read'],
    description:
      'Reads configured planner activities and their stable ids, without native task history or notes.',
    properties: {},
    validate: (args) => unknown(args, []),
  }),
  plannerTool({
    action: 'query',
    requiredScopes: QUERY_SCOPES,
    description:
      'Reads planner goals, commitments, availability and recorded task time for 1 to 93 inclusive calendar days. Includes archived task history; never task notes.',
    properties: rangeProperties,
    required: ['from', 'to'],
    validate: rangeError,
  }),
  plannerTool({
    action: 'edit',
    requiredScopes: ['planner:read', 'planner:write'],
    mutates: true,
    description:
      'Applies one typed planner configuration command against baseRevision. Use a stable operationId for retries. Stale revisions conflict; this never directly rewrites native tracking fields.',
    properties: {
      operationId: operationSchema,
      baseRevision: { type: 'string', minLength: 1, maxLength: 200 },
      command: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: PLANNER_COMMAND_TYPES },
          payload: { type: 'object' },
        },
        required: ['type', 'payload'],
        additionalProperties: false,
      },
    },
    required: ['operationId', 'baseRevision', 'command'],
    validate: editError,
  }),
  plannerTool({
    action: 'task',
    requiredScopes: ['tasks:read', 'tasks:write'],
    mutates: true,
    description:
      'Creates or updates a native task. Omit taskId to create; provide taskId to update. Uses native services and stable operationId; no time tracking internals or notes are accepted.',
    properties: {
      operationId: operationSchema,
      taskId: idSchema,
      fields: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          isDone: { type: 'boolean' },
          timeEstimate: { type: 'integer', minimum: 0, maximum: 365 * 86400000 },
          projectId: idSchema,
          tagIds: { type: 'array', items: idSchema, maxItems: 200, uniqueItems: true },
          dueDay: { anyOf: [dateSchema, { type: 'null' }] },
        },
        additionalProperties: false,
        minProperties: 1,
      },
    },
    required: ['operationId', 'fields'],
    validate: taskError,
  }),
  plannerTool({
    action: 'log_time',
    requiredScopes: [...QUERY_SCOPES, 'time:write'],
    mutates: true,
    description:
      'Adds recorded time to a native leaf task on a calendar date using the native tracking path, associated with activityId. durationMs is milliseconds. Reuse operationId when retrying; parents are aggregates.',
    properties: {
      operationId: operationSchema,
      activityId: idSchema,
      taskId: idSchema,
      date: dateSchema,
      durationMs: { type: 'integer', minimum: 1, maximum: 86400000 },
    },
    required: ['operationId', 'activityId', 'taskId', 'date', 'durationMs'],
    validate: timeError,
  }),
  plannerTool({
    action: 'prepare',
    requiredScopes: QUERY_SCOPES,
    description:
      'Prepares a reviewable scheduling proposal for 1 to 93 inclusive days without changing commitments or tasks. Returns proposalId and proposed block ids for explicit selection.',
    properties: rangeProperties,
    required: ['from', 'to'],
    validate: rangeError,
  }),
  plannerTool({
    action: 'apply',
    requiredScopes: [...QUERY_SCOPES, 'planner:write'],
    mutates: true,
    description:
      'Applies only selected block ids from a prepared proposal. Requires current grants and unchanged source data; stale proposals conflict. Reuse operationId for idempotent retries.',
    properties: {
      operationId: operationSchema,
      proposalId: idSchema,
      selection: {
        type: 'array',
        items: idSchema,
        minItems: 1,
        maxItems: MAX_SELECTION,
        uniqueItems: true,
      },
    },
    required: ['operationId', 'proposalId', 'selection'],
    validate: applyError,
  }),
];
