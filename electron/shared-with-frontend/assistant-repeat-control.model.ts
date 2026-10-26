const nullable = (schema: Record<string, unknown>): Record<string, unknown> => ({
  anyOf: [schema, { type: 'null' }],
});
const day = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const title = { type: 'string', minLength: 1, maxLength: 500 };
const notes = { type: 'string', maxLength: 8192 };
const estimate = { type: 'integer', minimum: 0, maximum: 31536000000 };
const boolean = { type: 'boolean' };
export const REPEAT_REMINDERS = [
  'DoNotRemind',
  'AtStart',
  'm5',
  'm10',
  'm15',
  'm30',
  'h1',
];
export const REPEAT_PROPERTIES = {
  startTime: nullable({ type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
  reminder: nullable({ type: 'string', enum: REPEAT_REMINDERS }),
  repeatUntilDay: nullable(day),
  paused: boolean,
  skipOverdue: boolean,
  repeatFromCompletionDate: boolean,
  waitForCompletion: boolean,
  monthlyWeekOfMonth: nullable({ type: 'integer', enum: [-1, 1, 2, 3, 4] }),
  monthlyWeekday: nullable({ type: 'integer', minimum: 0, maximum: 6 }),
  monthlyLastDay: boolean,
  deletedInstanceDates: nullable({
    type: 'array',
    items: day,
    uniqueItems: true,
    maxItems: 1000,
  }),
  applyTo: { type: 'string', enum: ['future', 'current'], default: 'future' },
  template: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      title: nullable(title),
      timeEstimate: nullable(estimate),
      priority: nullable({ type: 'integer', enum: [1, 2, 3] }),
      tagIds: {
        type: 'array',
        items: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' },
        uniqueItems: true,
        maxItems: 100,
      },
      notes: nullable(notes),
      shouldInheritSubtasks: boolean,
      disableAutoUpdateSubtasks: boolean,
      subTaskTemplates: nullable({
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: { title, timeEstimate: estimate, notes },
        },
      }),
    },
  },
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const has = (v: object, key: string): boolean => Object.hasOwn(v, key);
const validDay = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[1-9]\d{3}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + 'T12:00:00Z')) &&
  new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v;
const validTitle = (v: unknown): boolean =>
  typeof v === 'string' && !!v.trim() && v.length <= 500;
const validNotes = (v: unknown): boolean => typeof v === 'string' && v.length <= 8192;
const validEstimate = (v: unknown): boolean =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 31536000000;
export const repeatWritesNotes = (args: Record<string, unknown>): boolean => {
  const template = args['template'];
  // Replacing templates may erase existing notes, even if the new entries omit them.
  return (
    object(template) && (has(template, 'notes') || has(template, 'subTaskTemplates'))
  );
};
export const validateRepeatAdvanced = (
  args: Record<string, unknown>,
): string | undefined => {
  for (const key of [
    'paused',
    'skipOverdue',
    'repeatFromCompletionDate',
    'waitForCompletion',
    'monthlyLastDay',
  ])
    if (has(args, key) && typeof args[key] !== 'boolean') return 'Invalid repeat boolean';
  if (
    has(args, 'startTime') &&
    args['startTime'] !== null &&
    (typeof args['startTime'] !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(args['startTime']))
  )
    return 'Invalid startTime';
  if (
    has(args, 'reminder') &&
    args['reminder'] !== null &&
    !REPEAT_REMINDERS.includes(String(args['reminder']))
  )
    return 'Invalid reminder';
  if (args['startTime'] === null && args['reminder'] != null)
    return 'A reminder requires a start time';
  if (
    has(args, 'repeatUntilDay') &&
    args['repeatUntilDay'] !== null &&
    (!validDay(args['repeatUntilDay']) ||
      args['repeatUntilDay'] < String(args['startDay']))
  )
    return 'Invalid inclusive repeat end day';
  if (has(args, 'applyTo') && !['future', 'current'].includes(String(args['applyTo'])))
    return 'Invalid applyTo';
  if (
    has(args, 'monthlyWeekOfMonth') &&
    args['monthlyWeekOfMonth'] !== null &&
    ![-1, 1, 2, 3, 4].includes(args['monthlyWeekOfMonth'] as number)
  )
    return 'Invalid monthly week';
  if (
    has(args, 'monthlyWeekday') &&
    args['monthlyWeekday'] !== null &&
    (!Number.isInteger(args['monthlyWeekday']) ||
      (args['monthlyWeekday'] as number) < 0 ||
      (args['monthlyWeekday'] as number) > 6)
  )
    return 'Invalid monthly weekday';
  if (
    ['monthlyWeekOfMonth', 'monthlyWeekday', 'monthlyLastDay'].some(
      (k) => args[k] != null && args[k] !== false,
    ) &&
    args['cycle'] !== 'monthly'
  )
    return 'Monthly anchors require monthly cycle';
  if (
    (args['monthlyWeekOfMonth'] != null) !== (args['monthlyWeekday'] != null) ||
    has(args, 'monthlyWeekOfMonth') !== has(args, 'monthlyWeekday')
  )
    return 'Set or clear both monthly anchor fields';
  if (args['monthlyLastDay'] === true && args['monthlyWeekOfMonth'] != null)
    return 'Monthly anchors are mutually exclusive';
  const dates = args['deletedInstanceDates'];
  if (
    has(args, 'deletedInstanceDates') &&
    dates !== null &&
    (!Array.isArray(dates) ||
      dates.length > 1000 ||
      new Set(dates).size !== dates.length ||
      !dates.every(validDay))
  )
    return 'Invalid exception dates';
  const template = args['template'];
  if (has(args, 'template')) {
    if (
      !object(template) ||
      !Object.keys(template).length ||
      Object.keys(template).some(
        (k) => !Object.hasOwn(REPEAT_PROPERTIES.template.properties, k),
      )
    )
      return 'Invalid template';
    for (const [key, value] of Object.entries(template)) {
      if (key === 'title' && value !== null && !validTitle(value))
        return 'Invalid template title';
      if (key === 'timeEstimate' && value !== null && !validEstimate(value))
        return 'Invalid template estimate';
      if (key === 'priority' && value !== null && ![1, 2, 3].includes(value as number))
        return 'Invalid template priority';
      if (key === 'notes' && value !== null && !validNotes(value))
        return 'Invalid template notes';
      if (
        ['shouldInheritSubtasks', 'disableAutoUpdateSubtasks'].includes(key) &&
        typeof value !== 'boolean'
      )
        return 'Invalid template inheritance';
      if (
        key === 'tagIds' &&
        (!Array.isArray(value) ||
          value.length > 100 ||
          new Set(value).size !== value.length ||
          !value.every((v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v)))
      )
        return 'Invalid template tags';
      if (
        key === 'subTaskTemplates' &&
        value !== null &&
        (!Array.isArray(value) ||
          value.length > 100 ||
          !value.every(
            (v) =>
              object(v) &&
              validTitle(v['title']) &&
              Object.keys(v).every((k) =>
                ['title', 'timeEstimate', 'notes'].includes(k),
              ) &&
              (!has(v, 'timeEstimate') || validEstimate(v['timeEstimate'])) &&
              (!has(v, 'notes') || validNotes(v['notes'])),
          ))
      )
        return 'Invalid subtask templates';
    }
  }
  return undefined;
};
