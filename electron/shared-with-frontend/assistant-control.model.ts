import { AssistantAccessScope } from './assistant-access.model';

export const ASSISTANT_CONTROL_PATH = '/assistant/control';
export interface AssistantControlContext {
  authorize: () => Promise<void>;
  markMutation: () => void;
}
export class ControlError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const CONTROL_SETTINGS_FIELDS: Record<
  string,
  Record<string, 'boolean' | 'duration'>
> = {
  misc: Object.fromEntries(
    [
      'isConfirmBeforeExit',
      'isConfirmBeforeExitWithoutFinishDay',
      'isMinimizeToTray',
      'isCheckForUpdates',
      'isDisableAnimations',
      'isVerticalActionBar',
      'isDisableCelebration',
      'isTrayShowCurrentCountdown',
      'isUseCustomWindowTitleBar',
    ].map((key) => [key, 'boolean']),
  ),
  tasks: Object.fromEntries(
    [
      'isAutoMarkParentAsDone',
      'isAutoAddWorkedOnToToday',
      'isConfirmBeforeDelete',
      'isTrayShowCurrent',
      'isMarkdownFormattingInNotesEnabled',
    ].map((key) => [key, 'boolean']),
  ),
  timeTracking: Object.fromEntries(
    [
      'isAutoStartNextTask',
      'isNotifyWhenTimeEstimateExceeded',
      'isTrackingReminderEnabled',
      'isTrackingReminderShowOnMobile',
      'isTrackingReminderNotify',
      'isTrackingReminderFocusWindow',
    ].map((key) => [key, 'boolean']),
  ),
  idle: {
    isEnableIdleTimeTracking: 'boolean',
    isOnlyOpenIdleWhenCurrentTask: 'boolean',
    isSuppressIdleDuringFocusMode: 'boolean',
    minIdleTime: 'duration',
  },
};
const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$', maxLength: 200 };
const operation = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{8,80}$',
  minLength: 8,
  maxLength: 80,
};
const text = { type: 'string', maxLength: 500 };
const notes = { type: 'string', maxLength: 8192 };
const duration = { type: 'integer', minimum: 0, maximum: 86400000 };
const fields = {
  type: 'object',
  properties: {
    title: text,
    icon: { type: 'string', maxLength: 100 },
    color: { type: 'string', maxLength: 100 },
  },
  additionalProperties: false,
  minProperties: 1,
};
export interface ControlContract {
  commands: readonly string[];
  properties: Record<string, unknown>;
  baseScopes: readonly AssistantAccessScope[];
  writeScopes: readonly AssistantAccessScope[];
  description: string;
}
export const CONTROL_CONTRACTS: Record<string, ControlContract> = {
  task_timer: {
    commands: ['status', 'start', 'pause', 'stop'],
    properties: { taskId: id, expectedCurrentTaskId: { anyOf: [id, { type: 'null' }] } },
    baseScopes: ['tasks:read'],
    writeScopes: ['timer:write'],
    description:
      'Inspect, start/resume or pause/stop the native task timer. Start may reopen/schedule a task or select a leaf subtask, as the native UI does. Pause and stop retain all recorded time. Writes require operationId.',
  },
  task_time: {
    commands: ['add', 'set'],
    properties: {
      taskId: id,
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      duration,
      expectedDuration: duration,
    },
    baseScopes: ['tasks:read', 'time:write'],
    writeScopes: [],
    description:
      'Add worked milliseconds or replace one day total using native services. Requires a leaf task, a non-future calendar date, operationId and optionally expectedDuration. set accepts zero. Never retries uncertain changes.',
  },
  task_notes: {
    commands: ['read', 'write'],
    properties: { taskId: id, notes, expectedNotes: notes },
    baseScopes: ['tasks:read'],
    writeScopes: ['tasks:write_notes'],
    description:
      'Read or replace task notes (at most 8192 characters). Separate read_notes/write_notes grants; writes accept expectedNotes and require operationId.',
  },
  project_manage: {
    commands: ['create', 'update', 'archive', 'reopen'],
    properties: { id, fields },
    baseScopes: ['tasks:read', 'projects:write'],
    writeScopes: [],
    description:
      'Create/edit a native project, archive or reopen it. fields contains only title, icon or color. No destructive project/task deletion. Requires operationId.',
  },
  tag_manage: {
    commands: ['create', 'update', 'delete'],
    properties: { id, fields },
    baseScopes: ['tasks:read', 'tags:write'],
    writeScopes: [],
    description:
      'Create/edit/delete an ordinary native tag through the native service; built-in tags are protected. Delete removes tag membership through normal application behavior. Requires operationId.',
  },
  idle_review: {
    commands: ['status', 'discard', 'track_break', 'track_task'],
    properties: {
      reviewId: id,
      expectedIdleTime: { type: 'integer', minimum: 0 },
      taskId: id,
    },
    baseScopes: ['idle:read'],
    writeScopes: ['idle:write', 'time:write'],
    description:
      'Inspect or explicitly resolve the actual pending idle dialog. Writes require reviewId and expectedIdleTime from a frozen review. track_task requires taskId and follows native behavior, including resuming that task. Never resolves the same review twice.',
  },
  app_settings: {
    commands: ['read', 'update'],
    properties: {
      section: { type: 'string', enum: Object.keys(CONTROL_SETTINGS_FIELDS) },
      changes: { type: 'object', maxProperties: 30 },
      expected: { type: 'object', maxProperties: 30 },
    },
    baseScopes: ['settings:read'],
    writeScopes: ['settings:write'],
    description:
      'Read/update supported misc, tasks, timeTracking and idle preferences only. Read returns supported fields; update requires section, changes and matching expected current fields (null for absent). Durations are milliseconds. Never exposes sync credentials or changes assistant grants.',
  },
  app_sync: {
    commands: ['status', 'run'],
    properties: {},
    baseScopes: ['sync:read'],
    writeScopes: ['sync:write'],
    description:
      'Inspect sync readiness or request one normal sync with the configured provider. No credential configuration or destructive force sync. Reports disabled, busy and errors truthfully. run requires operationId.',
  },
  app_update: {
    commands: ['status', 'check', 'install'],
    properties: {},
    baseScopes: ['updates:read'],
    writeScopes: ['updates:write'],
    description:
      'Inspect installed version/update capabilities or check native release availability. The current desktop app does not support automatic installation; install explicitly returns UNSUPPORTED. check/install require operationId. Never executes a shell or accepts download URLs.',
  },
  control_operation_status: {
    commands: ['status'],
    properties: {},
    baseScopes: ['tasks:read'],
    writeScopes: [],
    description:
      'Read a device-local control operation receipt by operationId without retrying. Requires all original command permissions. Pending means outcome unknown; never repeat with a new id to bypass it.',
  },
};
export const isControlMutation = (tool: string, args: Record<string, unknown>): boolean =>
  tool !== 'control_operation_status' &&
  !['status', 'read'].includes(String(args['command']));
export const controlScopes = (
  tool: string,
  args: Record<string, unknown>,
): readonly AssistantAccessScope[] => {
  const contract = CONTROL_CONTRACTS[tool];
  if (!contract) return [];
  return [
    ...contract.baseScopes,
    ...(isControlMutation(tool, args) ? contract.writeScopes : []),
    ...(tool === 'task_notes' && args['command'] === 'read'
      ? ['tasks:read_notes' as const]
      : []),
    ...(tool === 'idle_review' && args['command'] === 'track_task'
      ? ['tasks:read' as const]
      : []),
  ];
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const has = (v: object, k: string): boolean => Object.hasOwn(v, k);
const validId = (v: unknown): boolean =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
export const validateControlArgs = (
  tool: string,
  args: Record<string, unknown>,
): string | undefined => {
  const c = CONTROL_CONTRACTS[tool];
  if (!c) return 'Unknown control tool';
  const allowed = ['command', 'operationId', ...Object.keys(c.properties)];
  if (Object.keys(args).some((k) => !allowed.includes(k))) return 'Unknown argument';
  const command = String(args['command']);
  if (!c.commands.includes(command)) return 'Unsupported command';
  if (isControlMutation(tool, args) || tool === 'control_operation_status') {
    if (
      typeof args['operationId'] !== 'string' ||
      !/^[A-Za-z0-9_-]{8,80}$/.test(args['operationId'])
    )
      return 'A stable operationId of 8 to 80 safe characters is required';
  } else if (has(args, 'operationId')) return 'Read commands do not accept operationId';
  for (const key of ['taskId', 'id', 'reviewId'])
    if (has(args, key) && !validId(args[key])) return 'Invalid id';
  if (
    has(args, 'expectedCurrentTaskId') &&
    args['expectedCurrentTaskId'] !== null &&
    !validId(args['expectedCurrentTaskId'])
  )
    return 'Invalid expected current task';
  for (const key of ['duration', 'expectedDuration', 'expectedIdleTime'])
    if (
      has(args, key) &&
      (!Number.isSafeInteger(args[key]) ||
        (args[key] as number) < 0 ||
        (key !== 'expectedIdleTime' && (args[key] as number) > 86400000))
    )
      return 'Invalid millisecond duration';
  for (const key of ['notes', 'expectedNotes'])
    if (
      has(args, key) &&
      (typeof args[key] !== 'string' || (args[key] as string).length > 8192)
    )
      return 'Notes exceed 8192 characters or have invalid type';
  if (tool === 'task_timer') {
    if (command === 'start' ? !validId(args['taskId']) : has(args, 'taskId'))
      return 'Only start requires taskId';
    if (command === 'status' && has(args, 'expectedCurrentTaskId'))
      return 'Status accepts no expectation';
  }
  if (tool === 'task_time') {
    const day = args['date'];
    if (
      !validId(args['taskId']) ||
      typeof day !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day + 'T12:00:00Z')) ||
      new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day ||
      !has(args, 'duration') ||
      (command === 'add' && args['duration'] === 0)
    )
      return 'A task, valid date and duration are required';
  }
  if (
    tool === 'task_notes' &&
    (!validId(args['taskId']) ||
      (command === 'write'
        ? !has(args, 'notes')
        : has(args, 'notes') || has(args, 'expectedNotes')))
  )
    return 'Invalid notes command';
  if (tool === 'project_manage' || tool === 'tag_manage') {
    if (command === 'create' ? has(args, 'id') : !validId(args['id']))
      return 'Create omits id; other commands require id';
    if (['create', 'update'].includes(command)) {
      const f = args['fields'];
      if (
        !object(f) ||
        !Object.keys(f).length ||
        Object.keys(f).some(
          (k) =>
            !['title', 'icon', 'color'].includes(k) ||
            typeof f[k] !== 'string' ||
            (f[k] as string).length > (k === 'title' ? 500 : 100),
        )
      )
        return 'Only title, icon and color fields are accepted';
      if (
        (command === 'create' || has(f, 'title')) &&
        (typeof f['title'] !== 'string' || !f['title'].trim())
      )
        return 'Nonempty title required';
    } else if (has(args, 'fields')) return 'This command does not accept fields';
  }
  if (tool === 'idle_review') {
    if (command === 'status' && Object.keys(args).length !== 1)
      return 'Status accepts only command';
    if (
      command !== 'status' &&
      (!validId(args['reviewId']) || !has(args, 'expectedIdleTime'))
    )
      return 'Review id and expected idle time required';
    if (command === 'track_task' ? !validId(args['taskId']) : has(args, 'taskId'))
      return 'Only track_task accepts taskId';
  }
  if (tool === 'app_settings') {
    const section = args['section'];
    if (
      section !== undefined &&
      (typeof section !== 'string' || !has(CONTROL_SETTINGS_FIELDS, section))
    )
      return 'Unsupported settings section';
    if (command === 'read' && (has(args, 'changes') || has(args, 'expected')))
      return 'Read accepts no changes';
    if (command === 'update') {
      const changes = args['changes'],
        expected = args['expected'];
      if (
        typeof section !== 'string' ||
        !object(changes) ||
        !object(expected) ||
        !Object.keys(changes).length ||
        Object.keys(changes).sort().join() !== Object.keys(expected).sort().join()
      )
        return 'Changes and expected require the same nonempty set of supported fields';
      for (const key of Object.keys(changes)) {
        const kind = CONTROL_SETTINGS_FIELDS[section][key];
        const valid = (v: unknown): boolean =>
          kind === 'boolean'
            ? typeof v === 'boolean'
            : kind === 'duration' &&
              Number.isSafeInteger(v) &&
              (v as number) >= 60000 &&
              (v as number) <= 86400000;
        if (
          !has(CONTROL_SETTINGS_FIELDS[section], key) ||
          !valid(changes[key]) ||
          (expected[key] !== null && !valid(expected[key]))
        )
          return 'Unsupported settings field or value';
      }
    }
  }
  return undefined;
};
export const controlInputSchema = (
  tool: string,
): {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
} => {
  const c = CONTROL_CONTRACTS[tool];
  return {
    type: 'object',
    properties: {
      command: { type: 'string', enum: c.commands },
      operationId: operation,
      ...c.properties,
    },
    required:
      tool === 'control_operation_status' ? ['command', 'operationId'] : ['command'],
    additionalProperties: false,
  };
};
