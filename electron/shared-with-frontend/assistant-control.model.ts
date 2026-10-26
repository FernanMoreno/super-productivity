import { AssistantAccessScope } from './assistant-access.model';
import {
  REPEAT_PROPERTIES,
  repeatWritesNotes,
  validateRepeatAdvanced,
} from './assistant-repeat-control.model';
import {
  TASK_CONTROL_CONTRACTS,
  validateTaskControlArgs,
  taskControlExtraScopes,
} from './assistant-task-control.contract';
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
export const CONTROL_SETTINGS_SECTIONS = [
  'appFeatures',
  'localization',
  'misc',
  'tasks',
  'shortSyntax',
  'evaluation',
  'idle',
  'takeABreak',
  'pomodoro',
  'flowtime',
  'keyboard',
  'localBackup',
  'sound',
  'timeTracking',
  'reminder',
  'schedule',
  'focusMode',
  'taskWidget',
  'focusModeLocal',
] as const;
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
const repeatCycles = ['daily', 'weekly', 'monthly', 'yearly'];
export const CONTROL_REPEAT_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
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
  ...TASK_CONTROL_CONTRACTS,
  task_repeat: {
    commands: ['read', 'read_template', 'set', 'remove'],
    properties: {
      taskId: id,
      ...REPEAT_PROPERTIES,
      cycle: { type: 'string', enum: repeatCycles },
      every: { type: 'integer', minimum: 1, maximum: 99, default: 1 },
      weekdays: {
        type: 'array',
        items: { type: 'string', enum: CONTROL_REPEAT_WEEKDAYS },
        minItems: 1,
        maxItems: 7,
        uniqueItems: true,
      },
      startDay: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      expectedRevision: {
        anyOf: [{ type: 'string', maxLength: 4096 }, { type: 'null' }],
      },
    },
    baseScopes: ['tasks:read'],
    writeScopes: ['tasks:write'],
    description:
      'Read/set/remove the native repeating series of a top-level task. Set requires startDay, cycle, expectedRevision from read (null for no series), operationId. every defaults to 1; weekdays is weekly only. Optional advanced fields preserve when omitted; null clears optional values. repeatUntilDay is inclusive. template edits affect future occurrences; notes and subtask template replacement require write_notes. read_template requires read_notes; read omits all notes. Time/reminder edits default to future occurrences; applyTo current also changes the selected unfinished instance, preserving its day and estimate. Calendar changes retain native rescheduling behavior. remove requires revision and removes recurrence without deleting tasks. Read again after writing.',
  },
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
      section: { type: 'string', enum: CONTROL_SETTINGS_SECTIONS },
      includeNotesTemplate: { type: 'boolean' },
      changes: { type: 'object', maxProperties: 100 },
      expected: { type: 'object', maxProperties: 100 },
    },
    baseScopes: ['settings:read'],
    writeScopes: ['settings:write'],
    description:
      'Read/update built-in preferences across appFeatures, localization, misc, tasks, shortSyntax, evaluation, idle, takeABreak, pomodoro, flowtime, keyboard, localBackup, sound, timeTracking, reminder, schedule, focusMode, taskWidget and focusModeLocal. Read returns supported fields; update requires section, changes and matching expected current fields (null for absent). Durations are milliseconds; taskWidget and focusModeLocal remain local to this device. Set includeNotesTemplate=true on a read to include that protected field; it requires tasks:read_notes. Updating notesTemplate requires tasks:read_notes and tasks:write_notes. Never exposes sync credentials or changes assistant grants.',
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
  !['status', 'read', 'read_template'].includes(String(args['command']));
export const controlScopes = (
  tool: string,
  args: Record<string, unknown>,
): readonly AssistantAccessScope[] => {
  const contract = CONTROL_CONTRACTS[tool];
  if (!contract) return [];
  const settingsChanges = args['changes'];
  const changesNotesTemplate =
    tool === 'app_settings' &&
    args['command'] === 'update' &&
    args['section'] === 'tasks' &&
    !!settingsChanges &&
    typeof settingsChanges === 'object' &&
    !Array.isArray(settingsChanges) &&
    Object.hasOwn(settingsChanges, 'notesTemplate');
  const readsNotesTemplate =
    tool === 'app_settings' &&
    args['command'] === 'read' &&
    args['includeNotesTemplate'] === true;
  return [
    ...contract.baseScopes,
    ...taskControlExtraScopes(tool, args),
    ...(isControlMutation(tool, args) ? contract.writeScopes : []),
    ...(tool === 'task_notes' && args['command'] === 'read'
      ? ['tasks:read_notes' as const]
      : []),
    ...(tool === 'task_repeat' && args['command'] === 'read_template'
      ? ['tasks:read_notes' as const]
      : []),
    ...(tool === 'task_repeat' && args['command'] === 'set' && repeatWritesNotes(args)
      ? ['tasks:write_notes' as const]
      : []),
    ...(changesNotesTemplate ? (['tasks:read_notes', 'tasks:write_notes'] as const) : []),
    ...(readsNotesTemplate ? (['tasks:read_notes'] as const) : []),
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
  if (Object.hasOwn(TASK_CONTROL_CONTRACTS, tool))
    return validateTaskControlArgs(tool, args);
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
  if (tool === 'task_repeat') {
    if (!validId(args['taskId'])) return 'A taskId is required';
    if (command === 'read' || command === 'read_template') {
      if (Object.keys(args).some((key) => !['command', 'taskId'].includes(key)))
        return 'Read accepts only taskId';
    } else if (command === 'remove') {
      if (
        typeof args['expectedRevision'] !== 'string' ||
        !args['expectedRevision'] ||
        args['expectedRevision'].length > 4096 ||
        Object.keys(args).some(
          (key) =>
            !['command', 'taskId', 'expectedRevision', 'operationId'].includes(key),
        )
      )
        return 'Remove requires the existing revision only';
    } else {
      const day = args['startDay'];
      const weekdays = args['weekdays'];
      if (
        !repeatCycles.includes(String(args['cycle'])) ||
        (has(args, 'every') &&
          (!Number.isInteger(args['every']) ||
            (args['every'] as number) < 1 ||
            (args['every'] as number) > 99)) ||
        typeof day !== 'string' ||
        !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day + 'T12:00:00Z')) ||
        new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) !== day ||
        (args['expectedRevision'] !== null &&
          (typeof args['expectedRevision'] !== 'string' ||
            args['expectedRevision'].length > 4096)) ||
        (has(args, 'weekdays') &&
          (args['cycle'] !== 'weekly' ||
            !Array.isArray(weekdays) ||
            !weekdays.length ||
            weekdays.length > 7 ||
            new Set(weekdays).size !== weekdays.length ||
            !weekdays.every((v) => CONTROL_REPEAT_WEEKDAYS.includes(v))))
      )
        return 'A valid cycle, interval, startDay, revision and weekly weekdays are required';
      const invalid = validateRepeatAdvanced(args);
      if (invalid) return invalid;
    }
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
      (typeof section !== 'string' ||
        !(CONTROL_SETTINGS_SECTIONS as readonly string[]).includes(section))
    )
      return 'Unsupported settings section';
    if (
      has(args, 'includeNotesTemplate') &&
      (command !== 'read' ||
        typeof args['includeNotesTemplate'] !== 'boolean' ||
        (args['includeNotesTemplate'] === true &&
          section !== undefined &&
          section !== 'tasks'))
    )
      return 'includeNotesTemplate is only supported when reading all settings or tasks';
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
        return 'Changes and expected require the same nonempty field set';
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
