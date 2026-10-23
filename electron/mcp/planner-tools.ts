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
  const extra = unknown(args, [
    'operationId',
    'taskId',
    'fields',
    'moveScope',
    'command',
    'children',
    'expected',
  ]);
  if (extra) return extra;
  if (
    args.expected !== undefined &&
    (!isRecord(args.expected) ||
      unknown(args.expected, [
        'isDone',
        'dueDay',
        'dueWithTime',
        'timeSpent',
        'timeEstimate',
        'subTaskIds',
      ]))
  )
    return 'expected must contain supported native snapshot fields';
  if (args.command !== undefined) {
    if (
      !['split', 'archive'].includes(String(args.command)) ||
      !validOperation(args.operationId) ||
      !validId(args.taskId)
    )
      return 'command requires split or archive, operationId and taskId';
    if (args.fields !== undefined || args.moveScope !== undefined)
      return 'Command does not accept fields or moveScope';
    if (args.command === 'archive')
      return args.children === undefined ? undefined : 'archive does not accept children';
    if (
      !Array.isArray(args.children) ||
      args.children.length < 2 ||
      args.children.length > 50 ||
      args.children.some(
        (child) =>
          !isRecord(child) ||
          unknown(child, ['title', 'timeEstimate']) ||
          typeof child.title !== 'string' ||
          !child.title.trim() ||
          child.title.length > 500 ||
          (child.timeEstimate !== undefined &&
            (typeof child.timeEstimate !== 'number' ||
              !Number.isSafeInteger(child.timeEstimate) ||
              child.timeEstimate < 0 ||
              child.timeEstimate > 365 * 86400000)),
      )
    )
      return 'split requires 2 to 50 children with title and optional integer timeEstimate milliseconds';
    return undefined;
  }
  if (args.children !== undefined || args.expected !== undefined)
    return 'children and expected require an explicit command';
  if (extra) return extra;
  if (
    args.moveScope !== undefined &&
    !['occurrence', 'series'].includes(String(args.moveScope))
  )
    return 'moveScope must be occurrence or series';
  if (
    !validOperation(args.operationId) ||
    (args.taskId !== undefined && !validId(args.taskId))
  )
    return 'operationId or taskId is invalid';
  const f = args.fields;
  if (
    !isRecord(f) ||
    !Object.keys(f).length ||
    unknown(f, [
      'title',
      'isDone',
      'timeEstimate',
      'projectId',
      'tagIds',
      'dueDay',
      'dueWithTime',
    ])
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
  if (f.dueDay !== undefined && f.dueWithTime !== undefined)
    return 'Choose dueDay or dueWithTime in one operation';
  if (
    f.dueWithTime !== undefined &&
    f.dueWithTime !== null &&
    (typeof f.dueWithTime !== 'number' ||
      !Number.isSafeInteger(f.dueWithTime) ||
      f.dueWithTime < 1 ||
      f.dueWithTime > 8640000000000000)
  )
    return 'dueWithTime must be a valid positive epoch millisecond timestamp or null';
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

const boundedInteger = (v: unknown, min: number, max: number): boolean =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const optionalIdError = (
  args: Record<string, unknown>,
  key: string,
): string | undefined =>
  args[key] !== undefined && !validId(args[key]) ? `${key} must be an id` : undefined;
const nextError = (args: Record<string, unknown>): string | undefined =>
  unknown(args, ['date', 'now', 'availableMinutes', 'contextAreaId', 'limit']) ||
  (args.date !== undefined && !validDay(args.date)
    ? 'date must be a calendar date'
    : undefined) ||
  (args.now !== undefined && !boundedInteger(args.now, 0, 8640000000000000)
    ? 'now must be epoch milliseconds'
    : undefined) ||
  (args.availableMinutes !== undefined && !boundedInteger(args.availableMinutes, 1, 1440)
    ? 'availableMinutes must be 1 to 1440'
    : undefined) ||
  (args.contextAreaId === null ? undefined : optionalIdError(args, 'contextAreaId')) ||
  (args.limit !== undefined && !boundedInteger(args.limit, 1, 3)
    ? 'limit must be 1 to 3'
    : undefined);
const reviewError = (args: Record<string, unknown>): string | undefined =>
  unknown(args, ['from', 'to', 'reviewId']) ||
  optionalIdError(args, 'reviewId') ||
  rangeError({ from: args.from, to: args.to });
const REVIEW_COMMANDS = ['start', 'decide', 'finish', 'task_state', 'preferences'];
const REVIEW_DECISIONS = [
  'keep',
  'reschedule',
  'split',
  'pause',
  'archive',
  'correct_time',
];
const reviewAdvanceError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, [
    'operationId',
    'expectedRevision',
    'command',
    'from',
    'to',
    'reviewId',
    'itemId',
    'decision',
    'taskId',
    'taskState',
    'preferences',
  ]);
  if (extra) return extra;
  if (
    !validOperation(args.operationId) ||
    typeof args.expectedRevision !== 'string' ||
    !args.expectedRevision ||
    args.expectedRevision.length > 200 ||
    !REVIEW_COMMANDS.includes(String(args.command))
  )
    return 'operationId, expectedRevision and supported command are required';
  if (args.command === 'start') return rangeError({ from: args.from, to: args.to });
  if (args.command === 'finish')
    return validId(args.reviewId) ? undefined : 'finish requires reviewId';
  if (args.command === 'decide')
    return validId(args.reviewId) &&
      validId(args.itemId) &&
      REVIEW_DECISIONS.includes(String(args.decision))
      ? undefined
      : 'decide requires reviewId, itemId and decision';
  if (args.command === 'task_state')
    return validId(args.taskId) &&
      ['active', 'paused', 'blocked'].includes(String(args.taskState))
      ? undefined
      : 'task_state requires taskId and taskState';
  const preferences = args.preferences;
  if (
    !isRecord(preferences) ||
    !Object.keys(preferences).length ||
    unknown(preferences, ['contextAreaId', 'availableMinutes'])
  )
    return 'preferences must contain supported preference fields';
  if (
    preferences.contextAreaId !== undefined &&
    preferences.contextAreaId !== null &&
    !validId(preferences.contextAreaId)
  )
    return 'contextAreaId must be an id or null';
  if (
    preferences.availableMinutes !== undefined &&
    preferences.availableMinutes !== null &&
    !boundedInteger(preferences.availableMinutes, 1, 1440)
  )
    return 'availableMinutes must be 1 to 1440 or null';
  return undefined;
};
const correctTimeError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, [
    'operationId',
    'activityId',
    'taskId',
    'date',
    'durationMs',
    'expectedDurationMs',
  ]);
  if (extra) return extra;
  if (
    !validOperation(args.operationId) ||
    !validId(args.activityId) ||
    !validId(args.taskId) ||
    !validDay(args.date)
  )
    return 'operationId, activityId, taskId and date are required';
  return boundedInteger(args.durationMs, 0, 86400000) &&
    boundedInteger(args.expectedDurationMs, 0, 86400000)
    ? undefined
    : 'durationMs and expectedDurationMs must be integer milliseconds from zero to 24 hours';
};
const adjustError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, ['proposalId', 'changes']);
  if (extra) return extra;
  if (
    !validId(args.proposalId) ||
    !Array.isArray(args.changes) ||
    !args.changes.length ||
    args.changes.length > MAX_SELECTION
  )
    return 'proposalId and 1 to 500 changes are required';
  const ids = new Set();
  for (const change of args.changes) {
    if (
      !isRecord(change) ||
      unknown(change, ['itemId', 'start', 'end']) ||
      !validId(change.itemId) ||
      ids.has(change.itemId) ||
      !boundedInteger(change.start, 1, 8640000000000000) ||
      (change.end !== undefined &&
        (!boundedInteger(change.end, 1, 8640000000000000) ||
          Number(change.end) <= Number(change.start)))
    )
      return 'changes require distinct itemId, epoch millisecond start and optional later end';
    ids.add(change.itemId);
  }
  return undefined;
};
const historyError = (args: Record<string, unknown>): string | undefined =>
  unknown(args, ['historyId', 'limit']) ||
  optionalIdError(args, 'historyId') ||
  (args.limit !== undefined && !boundedInteger(args.limit, 1, 100)
    ? 'limit must be 1 to 100'
    : undefined);
const undoError = (args: Record<string, unknown>): string | undefined => {
  const extra = unknown(args, ['historyId', 'selection']);
  if (extra) return extra;
  if (!validId(args.historyId)) return 'historyId is required';
  if (
    args.selection !== undefined &&
    (!Array.isArray(args.selection) ||
      !args.selection.length ||
      args.selection.length > MAX_SELECTION ||
      !args.selection.every(validId) ||
      new Set(args.selection).size !== args.selection.length)
  )
    return 'selection must contain 1 to 500 distinct change ids';
  return undefined;
};

interface PlannerToolOptions {
  name?: string;
  action:
    | 'activities'
    | 'query'
    | 'edit'
    | 'task'
    | 'log_time'
    | 'prepare'
    | 'apply'
    | 'operation_status'
    | 'next'
    | 'review'
    | 'review_advance'
    | 'correct_time'
    | 'proposal_adjust'
    | 'history'
    | 'prepare_undo';
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
    name: options.name ?? `planner_${options.action}`,
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
    if (options.action === 'operation_status') {
      const required = RECEIPT_SCOPES[String(args.action)];
      if (!required?.every((scope) => grantedScopes.includes(scope)))
        return fail('NOT_PERMITTED', 'The original operation permissions are required.');
    }
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
    if (
      options.action === 'operation_status' &&
      !RECEIPT_SCOPES[String(args.action)]?.every((scope) => getScopes().includes(scope))
    )
      return fail('NOT_PERMITTED', 'The original operation permissions were revoked.');
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
const RECEIPT_SCOPES: Record<string, readonly AssistantAccessScope[]> = {
  edit: ['planner:read', 'planner:write'],
  task: ['tasks:read', 'tasks:write'],
  log_time: [...QUERY_SCOPES, 'time:write'],
  apply: [...QUERY_SCOPES, 'planner:write'],
  review_advance: [...QUERY_SCOPES, 'planner:write'],
  correct_time: [...QUERY_SCOPES, 'time:write'],
};
export const PLANNER_TOOLS: ToolSpec[] = [
  plannerTool({
    action: 'operation_status',
    requiredScopes: ['planner:read'],
    description:
      'Reads a durable receipt by operationId without retrying a mutation. Requires permissions for the original action. Pending or absent receipts do not prove that a change was not applied.',
    properties: {
      operationId: operationSchema,
      action: {
        type: 'string',
        enum: ['edit', 'task', 'log_time', 'apply', 'review_advance', 'correct_time'],
      },
    },
    required: ['operationId', 'action'],
    validate: (args) =>
      unknown(args, ['action', 'operationId']) ||
      (!validOperation(args.operationId) ||
      !Object.hasOwn(RECEIPT_SCOPES, String(args.action))
        ? 'A valid operationId and original mutation action are required'
        : undefined),
  }),
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
      'Creates or updates a native task, or explicitly splits/archives an identified task with command. Split accepts 2–50 child titles and optional estimates; archive accepts no fields or children. Native services preserve invariants. Reuse operationId on retry.',
    properties: {
      operationId: operationSchema,
      taskId: idSchema,
      moveScope: { type: 'string', enum: ['occurrence', 'series'] },
      command: { type: 'string', enum: ['split', 'archive'] },
      expected: {
        type: 'object',
        properties: {
          isDone: { type: 'boolean' },
          dueDay: { anyOf: [dateSchema, { type: 'null' }] },
          dueWithTime: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          timeSpent: { type: 'integer', minimum: 0 },
          timeEstimate: { type: 'integer', minimum: 0 },
          subTaskIds: { type: 'array', items: idSchema },
        },
        additionalProperties: false,
      },
      children: {
        type: 'array',
        minItems: 2,
        maxItems: 50,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 500 },
            timeEstimate: { type: 'integer', minimum: 0, maximum: 365 * 86400000 },
          },
          required: ['title'],
          additionalProperties: false,
        },
      },
      fields: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          isDone: { type: 'boolean' },
          timeEstimate: { type: 'integer', minimum: 0, maximum: 365 * 86400000 },
          projectId: idSchema,
          tagIds: { type: 'array', items: idSchema, maxItems: 200, uniqueItems: true },
          dueDay: { anyOf: [dateSchema, { type: 'null' }] },
          dueWithTime: {
            anyOf: [
              { type: 'integer', minimum: 1, maximum: 8640000000000000 },
              { type: 'null' },
            ],
          },
        },
        additionalProperties: false,
        minProperties: 1,
      },
    },
    required: ['operationId'],
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
  plannerTool({
    action: 'next',
    requiredScopes: QUERY_SCOPES,
    description:
      'Recommends up to three next actions from current planner and native task data, with reasons. Does not start timers or modify tasks.',
    properties: {
      date: dateSchema,
      now: { type: 'integer', minimum: 0, maximum: 8640000000000000 },
      availableMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
      contextAreaId: { anyOf: [idSchema, { type: 'null' }] },
      limit: { type: 'integer', minimum: 1, maximum: 3 },
    },
    validate: nextError,
  }),
  plannerTool({
    action: 'review',
    requiredScopes: QUERY_SCOPES,
    description:
      'Reads a review interval and saved review progress without advancing or completing it.',
    properties: { ...rangeProperties, reviewId: idSchema },
    required: ['from', 'to'],
    validate: reviewError,
  }),
  plannerTool({
    action: 'review_advance',
    requiredScopes: [...QUERY_SCOPES, 'planner:write'],
    mutates: true,
    description:
      'Starts, advances or explicitly finishes a saved review against expectedRevision. Decisions and planner task states do not implicitly mutate native tasks. Reuse operationId on retry.',
    properties: {
      operationId: operationSchema,
      expectedRevision: { type: 'string', minLength: 1, maxLength: 200 },
      command: { type: 'string', enum: REVIEW_COMMANDS },
      ...rangeProperties,
      reviewId: idSchema,
      itemId: idSchema,
      decision: { type: 'string', enum: REVIEW_DECISIONS },
      taskId: idSchema,
      taskState: { type: 'string', enum: ['active', 'paused', 'blocked'] },
      preferences: {
        type: 'object',
        properties: {
          contextAreaId: { anyOf: [idSchema, { type: 'null' }] },
          availableMinutes: {
            anyOf: [{ type: 'integer', minimum: 1, maximum: 1440 }, { type: 'null' }],
          },
        },
        additionalProperties: false,
        minProperties: 1,
      },
    },
    required: ['operationId', 'expectedRevision', 'command'],
    validate: reviewAdvanceError,
  }),
  plannerTool({
    action: 'correct_time',
    requiredScopes: [...QUERY_SCOPES, 'time:write'],
    mutates: true,
    description:
      'Sets a native leaf task calendar-day total to durationMs, including zero, only if its total still equals expectedDurationMs. Requires its associated activityId. Uses native time validation and durable operationId; never writes parent aggregates.',
    properties: {
      operationId: operationSchema,
      activityId: idSchema,
      taskId: idSchema,
      date: dateSchema,
      durationMs: { type: 'integer', minimum: 0, maximum: 86400000 },
      expectedDurationMs: { type: 'integer', minimum: 0, maximum: 86400000 },
    },
    required: [
      'operationId',
      'activityId',
      'taskId',
      'date',
      'durationMs',
      'expectedDurationMs',
    ],
    validate: correctTimeError,
  }),
  plannerTool({
    action: 'proposal_adjust',
    requiredScopes: QUERY_SCOPES,
    description:
      'Adjusts proposed intervals by itemId and returns a newly validated proposal. start/end are epoch milliseconds. This changes no tasks or commitments; apply its selected changes explicitly.',
    properties: {
      proposalId: idSchema,
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_SELECTION,
        items: {
          type: 'object',
          properties: {
            itemId: idSchema,
            start: { type: 'integer', minimum: 1, maximum: 8640000000000000 },
            end: { type: 'integer', minimum: 1, maximum: 8640000000000000 },
          },
          required: ['itemId', 'start'],
          additionalProperties: false,
        },
      },
    },
    required: ['proposalId', 'changes'],
    validate: adjustError,
  }),
  plannerTool({
    action: 'history',
    name: 'planner_reorganizations',
    requiredScopes: QUERY_SCOPES,
    description:
      'Reads durable reorganization history, or one historyId, including confirmed and uncertain outcomes. Reading history never undoes or retries a change.',
    properties: {
      historyId: idSchema,
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    validate: historyError,
  }),
  plannerTool({
    action: 'prepare_undo',
    requiredScopes: QUERY_SCOPES,
    description:
      'Prepares a reviewable inverse proposal for historyId and optional selected change ids. Rejects incompatible later changes. Does not undo anything; apply selected proposal ids separately with planner_apply.',
    properties: {
      historyId: idSchema,
      selection: {
        type: 'array',
        items: idSchema,
        minItems: 1,
        maxItems: MAX_SELECTION,
        uniqueItems: true,
      },
    },
    required: ['historyId'],
    validate: undoError,
  }),
];
