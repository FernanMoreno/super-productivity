import type { AssistantAccessScope } from './assistant-access.model';
import type { ControlContract } from './assistant-control.model';

const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$', maxLength: 200 };
const text = { type: 'string', minLength: 1, maxLength: 500 };
const stamp = { type: 'integer', minimum: 1, maximum: 8640000000000000 };
const nullable = (schema: object): object => ({ anyOf: [schema, { type: 'null' }] });
const day = { type: 'string', pattern: '^[1-9]\\d{3}-\\d{2}-\\d{2}$' };
const ids = { type: 'array', items: id, maxItems: 200, uniqueItems: true };
const metadata = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    title: text,
    timeEstimate: { type: 'integer', minimum: 0, maximum: 31536000000 },
    priority: { enum: [null, 1, 2, 3] },
    created: stamp,
    doneOn: stamp,
  },
};
const attachment = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    type: { enum: ['FILE', 'LINK', 'IMG', 'COMMAND', 'NOTE'] },
    title: { type: 'string', maxLength: 500 },
    path: { type: 'string', maxLength: 8192 },
    icon: { type: 'string', maxLength: 100 },
    originalImgPath: nullable({ type: 'string', maxLength: 8192 }),
  },
};
const common = { taskId: id, expectedRevision: { type: 'string', maxLength: 65536 } };
export const TASK_CONTROL_CONTRACTS: Record<string, ControlContract> = {
  task_manage: {
    commands: [
      'read',
      'update',
      'complete',
      'reopen',
      'wont_do',
      'schedule',
      'unschedule',
      'deadline',
      'clear_deadline',
      'move_project',
      'set_tags',
      'duplicate',
      'archive',
      'restore',
      'delete',
    ],
    properties: {
      ...common,
      location: { enum: ['active', 'archive'] },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
      offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      fields: metadata,
      day,
      at: stamp,
      remindAt: nullable(stamp),
      projectId: id,
      tagIds: ids,
      confirm: { type: 'boolean' },
    },
    baseScopes: ['tasks:read'],
    writeScopes: ['tasks:write'],
    description:
      'Read native task metadata and revision; omit taskId for a bounded list (location archive needs read_history). Every write requires taskId, expectedRevision and operationId. update accepts title, timeEstimate, priority (null clears), created and doneOn (done tasks only). schedule and deadline accept exactly one of day or at (Unix ms), optional remindAt (null clears); schedule and deadline are independent. move_project affects this instance and children, not the series. duplicate copies literal content and children with notes grants; resets tracking/history/recurrence. archive/restore preserve native children. delete requires confirm:true and deletes active task plus children. Read again after writes. No raw persisted fields.',
  },
  task_structure: {
    commands: ['read', 'add_subtask', 'reparent', 'detach', 'reorder', 'set_section'],
    properties: {
      ...common,
      title: text,
      parentId: id,
      afterTaskId: nullable(id),
      contextId: id,
      contextType: { enum: ['PROJECT', 'TAG'] },
      source: { enum: ['UNDONE', 'DONE', 'BACKLOG'] },
      target: { enum: ['UNDONE', 'DONE', 'BACKLOG'] },
      sectionId: nullable(id),
    },
    baseScopes: ['tasks:read'],
    writeScopes: ['tasks:write'],
    description:
      'Native single-level task structure. read requires taskId and returns contexts, list order, section ids and revision. Writes also require expectedRevision and operationId. add_subtask treats taskId as parent and requires literal title. reparent requires parentId and optional afterTaskId (null = first). detach inherits parent tags. reorder requires explicit contextId/contextType/source/target/afterTaskId for top-level lists; subtasks use parent order and afterTaskId. set_section requires explicit contextId/contextType and sectionId (null removes), optional afterTaskId. No active UI context is used.',
  },
  task_attachment: {
    commands: ['read', 'add', 'update', 'remove'],
    properties: {
      ...common,
      attachmentId: id,
      attachment,
      includeNotes: { type: 'boolean' },
    },
    baseScopes: ['tasks:read'],
    writeScopes: ['tasks:write', 'tasks:write_notes'],
    description:
      'Stored native attachment references only: FILE/LINK/IMG/COMMAND/NOTE. Never reads, uploads, fetches or executes targets. Read omits NOTE attachments unless includeNotes:true with read_notes. Writes require expectedRevision, operationId, write_notes; add requires attachment.type and path; update/remove require attachmentId. Attachment metadata is validated and unknown fields rejected.',
  },
};

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const has = (a: Record<string, unknown>, k: string): boolean => Object.hasOwn(a, k);
// The same compact schema subset is checked in Electron and the renderer.
const matches = (value: unknown, schema: Record<string, unknown>): boolean => {
  if (schema['anyOf'])
    return (schema['anyOf'] as Record<string, unknown>[]).some((s) => matches(value, s));
  if (schema['enum']) return (schema['enum'] as unknown[]).includes(value);
  if (schema['type'] === 'null') return value === null;
  if (schema['type'] === 'boolean') return typeof value === 'boolean';
  if (schema['type'] === 'string')
    return (
      typeof value === 'string' &&
      value.length <= Number(schema['maxLength'] ?? Infinity) &&
      value.length >= Number(schema['minLength'] ?? 0) &&
      (!schema['pattern'] || new RegExp(String(schema['pattern'])).test(value))
    );
  if (schema['type'] === 'integer')
    return (
      Number.isSafeInteger(value) &&
      Number(value) >= Number(schema['minimum']) &&
      Number(value) <= Number(schema['maximum'])
    );
  if (schema['type'] === 'array')
    return (
      Array.isArray(value) &&
      value.length <= Number(schema['maxItems']) &&
      new Set(value).size === value.length &&
      value.every((v) => matches(v, schema['items'] as Record<string, unknown>))
    );
  if (schema['type'] === 'object') {
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    return (
      object(value) &&
      Object.keys(value).length >= Number(schema['minProperties'] ?? 0) &&
      Object.keys(value).every((k) => has(props, k) && matches(value[k], props[k]))
    );
  }
  return false;
};
export const validateTaskControlArgs = (
  tool: string,
  args: Record<string, unknown>,
): string | undefined => {
  const contract = TASK_CONTROL_CONTRACTS[tool];
  if (!contract) return 'Unknown task control tool';
  const command = String(args['command']);
  if (!contract.commands.includes(command)) return 'Unsupported task command';
  for (const key of Object.keys(args)) {
    if (['command', 'operationId'].includes(key)) continue;
    if (
      !has(contract.properties, key) ||
      !matches(args[key], contract.properties[key] as Record<string, unknown>)
    )
      return 'Invalid task argument: ' + key;
  }
  if (has(args, 'day')) {
    const date = new Date(String(args['day']) + 'T12:00:00Z');
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== args['day']
    )
      return 'Invalid calendar day';
  }
  const allowed: Record<string, string[]> =
    tool === 'task_manage'
      ? {
          read: ['location', 'limit', 'offset'],
          update: ['fields'],
          complete: [],
          reopen: [],
          wont_do: [],
          schedule: ['day', 'at', 'remindAt'],
          unschedule: [],
          deadline: ['day', 'at', 'remindAt'],
          clear_deadline: [],
          move_project: ['projectId'],
          set_tags: ['tagIds'],
          duplicate: [],
          archive: [],
          restore: [],
          delete: ['confirm'],
        }
      : tool === 'task_structure'
        ? {
            read: [],
            add_subtask: ['title'],
            reparent: ['parentId', 'afterTaskId'],
            detach: [],
            reorder: ['contextId', 'contextType', 'source', 'target', 'afterTaskId'],
            set_section: ['contextId', 'contextType', 'sectionId', 'afterTaskId'],
          }
        : {
            read: ['includeNotes'],
            add: ['attachment'],
            update: ['attachment', 'attachmentId'],
            remove: ['attachmentId'],
          };
  const keys = [
    'command',
    'taskId',
    ...(command === 'read' ? [] : ['expectedRevision', 'operationId']),
    ...allowed[command],
  ];
  if (Object.keys(args).some((k) => !keys.includes(k)))
    return 'Argument does not apply to this command';
  if (
    (!has(args, 'taskId') && !(tool === 'task_manage' && command === 'read')) ||
    (command !== 'read' && !has(args, 'expectedRevision'))
  )
    return 'Task and expectedRevision required';
  if (has(args, 'expectedRevision') && !String(args['expectedRevision']).length)
    return 'Empty revision';
  if (
    command === 'read' &&
    has(args, 'taskId') &&
    (has(args, 'limit') || has(args, 'offset'))
  )
    return 'limit applies to lists only';
  const required: Record<string, string[]> = {
    update: [tool === 'task_attachment' ? 'attachment' : 'fields'],
    move_project: ['projectId'],
    set_tags: ['tagIds'],
    add_subtask: ['title'],
    reparent: ['parentId'],
    set_section: ['contextId', 'contextType', 'sectionId'],
    add: ['attachment'],
    remove: ['attachmentId'],
  };
  if ((required[command] || []).some((k) => !has(args, k)))
    return 'Missing command argument';
  if (tool === 'task_attachment' && command === 'update' && !has(args, 'attachmentId'))
    return 'attachmentId required';
  if (command === 'delete' && args['confirm'] !== true)
    return 'Delete requires confirm:true';
  if (['schedule', 'deadline'].includes(command)) {
    if (has(args, 'day') === has(args, 'at')) return 'Supply exactly one of day or at';
    if (
      has(args, 'remindAt') &&
      args['remindAt'] !== null &&
      Number(args['remindAt']) >
        Number(args['at'] ?? Date.parse(String(args['day']) + 'T23:59:59Z'))
    )
      return 'Reminder must not follow target';
    if (
      command === 'schedule' &&
      has(args, 'day') &&
      args['remindAt'] !== undefined &&
      args['remindAt'] !== null
    )
      return 'Scheduled reminders require at';
  }
  if (tool === 'task_attachment' && command === 'add') {
    const a = args['attachment'] as Record<string, unknown>;
    if (!has(a, 'type') || !has(a, 'path')) return 'Attachment type and path required';
  }
  if (has(args, 'title') && !String(args['title']).trim())
    return 'Nonempty title required';
  if (
    object(args['fields']) &&
    has(args['fields'], 'title') &&
    !String(args['fields']['title']).trim()
  )
    return 'Nonempty title required';
  return undefined;
};
export const taskControlExtraScopes = (
  tool: string,
  args: Record<string, unknown>,
): AssistantAccessScope[] => {
  const scopes: AssistantAccessScope[] = [];
  if (
    tool === 'task_manage' &&
    (args['location'] === 'archive' || args['command'] === 'restore')
  )
    scopes.push('tasks:read_history');
  if (tool === 'task_manage' && args['command'] === 'duplicate')
    scopes.push('tasks:capture', 'tasks:read_notes', 'tasks:write_notes');
  if (tool === 'task_structure' && args['command'] === 'add_subtask')
    scopes.push('tasks:capture');
  if (
    tool === 'task_attachment' &&
    args['command'] === 'read' &&
    args['includeNotes'] === true
  )
    scopes.push('tasks:read_notes');
  return scopes;
};
