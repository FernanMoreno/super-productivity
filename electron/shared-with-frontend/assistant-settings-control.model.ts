import { MAX_BACKUP_FILES, MIN_BACKUP_FILES } from './backup-file-cleanup.util';
import { KEYBOARD_CONFIG_KEYS } from './keyboard-config.model';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export type ControlSettingsRule =
  | { type: 'boolean' }
  | { type: 'duration'; min?: number; max?: number; nullable?: boolean }
  | { type: 'number'; min: number; max: number; nullable?: boolean }
  | { type: 'string'; maxLength: number; nullable?: boolean }
  | { type: 'choice'; values: readonly (string | null)[] }
  | { type: 'time' }
  | { type: 'flowtimeRules'; nullable?: boolean };
const settingFields = (
  keys: readonly string[],
  rule: ControlSettingsRule,
): Record<string, ControlSettingsRule> =>
  Object.fromEntries(keys.map((key) => [key, rule]));
const settingBooleans = (keys: readonly string[]): Record<string, ControlSettingsRule> =>
  settingFields(keys, { type: 'boolean' });
const settingDurations = (
  keys: readonly string[],
  nullable = false,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): Record<string, ControlSettingsRule> =>
  settingFields(keys, {
    type: 'duration',
    min,
    max,
    nullable,
  });
const SETTING_LANGUAGE_CODES = [
  'ar',
  'cs',
  'de',
  'en',
  'es',
  'fa',
  'fi',
  'fr',
  'hr',
  'id',
  'it',
  'ja',
  'ko',
  'nb',
  'nl',
  'pl',
  'pt',
  'pt-br',
  'ru',
  'sk',
  'sv',
  'tr',
  'uk',
  'zh',
  'zh-tw',
  'ro',
  'ro-md',
  'vi',
];
const SETTING_DATE_TIME_LOCALES = [
  'en-us',
  'en-gb',
  'sv',
  'tr-tr',
  'de-de',
  'fr-fr',
  'es-es',
  'it-it',
  'pt-br',
  'ru-ru',
  'zh-cn',
  'ja-jp',
  'ko-kr',
  'uk-ua',
  'pl-pl',
  'cs-cz',
  'sk-sk',
  'ro-ro',
  'ro-md',
];
const SETTING_SOUND_OPTIONS = [
  null,
  'ding-small-bell.mp3',
  'copper-bell-ding.mp3',
  'done1.mp3',
  'done2.mp3',
  'done3.mp3',
  'done4.mp3',
  'done5.mp3',
  'done6.mp3',
  'done7.mp3',
] as const;
const SETTING_TASK_REMINDER_OPTIONS = [
  'DoNotRemind',
  'AtStart',
  'm5',
  'm10',
  'm15',
  'm30',
  'h1',
] as const;

export const CONTROL_SETTINGS_FIELDS: Record<
  string,
  Record<string, ControlSettingsRule>
> = {
  appFeatures: settingBooleans([
    'isPlannerEnabled',
    'isSchedulerEnabled',
    'isBoardsEnabled',
    'isHabitsEnabled',
    'isTimeTrackingEnabled',
    'isFocusModeEnabled',
    'isFinishDayEnabled',
    'isIssuesPanelEnabled',
    'isProjectNotesEnabled',
    'isSyncIconEnabled',
    'isSearchEnabled',
    'isDonatePageEnabled',
  ]),
  localization: {
    lng: { type: 'choice', values: [null, ...SETTING_LANGUAGE_CODES] },
    firstDayOfWeek: { type: 'number', min: 0, max: 6, nullable: true },
    dateTimeLocale: { type: 'choice', values: [null, ...SETTING_DATE_TIME_LOCALES] },
  },
  misc: {
    ...settingBooleans([
      'isConfirmBeforeExit',
      'isConfirmBeforeExitWithoutFinishDay',
      'isMinimizeToTray',
      'isCheckForUpdates',
      'isDisableAnimations',
      'isVerticalActionBar',
      'isDisableCelebration',
      'isShowProductivityTipLonger',
      'isTrayShowCurrentCountdown',
      'isUseCustomWindowTitleBar',
    ]),
    startOfNextDayTime: { type: 'time' },
  },
  tasks: {
    ...settingBooleans([
      'isAutoMarkParentAsDone',
      'isAutoAddWorkedOnToToday',
      'isConfirmBeforeDelete',
      'isTrayShowCurrent',
      'isMarkdownFormattingInNotesEnabled',
    ]),
    notesTemplate: { type: 'string', maxLength: 8192 },
    priorityIconPreset: { type: 'choice', values: ['chevrons', 'numbers'] },
  },
  shortSyntax: {
    ...settingBooleans([
      'isEnableProject',
      'isEnableDue',
      'isEnableDeadline',
      'isEnableTag',
    ]),
    urlBehavior: {
      type: 'choice',
      values: ['keep', 'extract', 'keep-and-attach'],
    },
  },
  evaluation: settingBooleans(['isHideEvaluationSheet']),
  idle: {
    ...settingBooleans([
      'isEnableIdleTimeTracking',
      'isOnlyOpenIdleWhenCurrentTask',
      'isSuppressIdleDuringFocusMode',
    ]),
    ...settingDurations(['minIdleTime'], false, 60000, 86400000),
  },
  takeABreak: {
    ...settingBooleans([
      'isTakeABreakEnabled',
      'isLockScreen',
      'isTimedFullScreenBlocker',
      'isFocusWindow',
    ]),
    ...settingDurations([
      'timedFullScreenBlockerDuration',
      'takeABreakMinWorkingTime',
      'takeABreakSnoozeTime',
    ]),
    takeABreakMessage: { type: 'string', maxLength: 8192 },
  },
  pomodoro: {
    ...settingDurations(['duration', 'breakDuration', 'longerBreakDuration'], true),
    cyclesBeforeLongerBreak: {
      type: 'number',
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      nullable: true,
    },
  },
  flowtime: {
    isBreakEnabled: { type: 'boolean' },
    breakMode: { type: 'choice', values: [null, 'ratio', 'rule'] },
    breakPercentage: { type: 'number', min: 1, max: 100, nullable: true },
    breakRules: { type: 'flowtimeRules', nullable: true },
  },
  keyboard: settingFields(KEYBOARD_CONFIG_KEYS, {
    type: 'string',
    maxLength: 100,
    nullable: true,
  }),
  localBackup: {
    isEnabled: { type: 'boolean' },
    maxBackupFiles: {
      type: 'number',
      min: MIN_BACKUP_FILES,
      max: MAX_BACKUP_FILES,
      nullable: true,
    },
  },
  sound: {
    volume: { type: 'number', min: 0, max: 100 },
    isIncreaseDoneSoundPitch: { type: 'boolean' },
    doneSound: { type: 'choice', values: SETTING_SOUND_OPTIONS },
    breakReminderSound: { type: 'choice', values: SETTING_SOUND_OPTIONS },
    trackTimeSound: { type: 'choice', values: SETTING_SOUND_OPTIONS },
  },
  timeTracking: {
    ...settingBooleans([
      'isAutoStartNextTask',
      'isNotifyWhenTimeEstimateExceeded',
      'isTrackingReminderEnabled',
      'isTrackingReminderShowOnMobile',
      'isTrackingReminderNotify',
      'isTrackingReminderFocusWindow',
    ]),
    ...settingDurations(['defaultEstimate', 'defaultEstimateSubTasks'], true),
    ...settingDurations(['trackingReminderMinTime']),
  },
  reminder: {
    ...settingBooleans([
      'isCountdownBannerEnabled',
      'disableReminders',
      'isFocusWindow',
      'useAlarmStyleReminders',
      'notifyOnDueDate',
    ]),
    ...settingDurations(['countdownDuration']),
    defaultTaskRemindOption: {
      type: 'choice',
      values: SETTING_TASK_REMINDER_OPTIONS,
    },
    dueDateNotificationHour: {
      type: 'number',
      min: 0,
      max: 23,
      nullable: true,
    },
  },
  schedule: {
    ...settingBooleans(['isWorkStartEndEnabled', 'isLunchBreakEnabled']),
    workStart: { type: 'time' },
    workEnd: { type: 'time' },
    lunchBreakStart: { type: 'time' },
    lunchBreakEnd: { type: 'time' },
  },
  focusMode: {
    ...settingBooleans([
      'autoStartFocusOnPlay',
      'isPauseTrackingDuringBreak',
      'isShowPreparation',
      'isManualBreakStart',
    ]),
    focusModeSound: { type: 'choice', values: ['off', 'tick', 'whiteNoise'] },
    focusModeSoundVolume: { type: 'number', min: 0, max: 100, nullable: true },
  },
  taskWidget: {
    ...settingBooleans(['isEnabled', 'isAlwaysShow']),
    opacity: { type: 'number', min: 10, max: 100 },
  },
  focusModeLocal: settingBooleans(['isLoopBreakEndAlarm']),
};

export const isValidControlSettingValue = (
  section: string,
  key: string,
  value: unknown,
): boolean => {
  const rule = CONTROL_SETTINGS_FIELDS[section]?.[key];
  if (!rule) return false;
  if (value === null) {
    return (
      (rule.type === 'choice' && rule.values.includes(null)) ||
      ('nullable' in rule && !!rule.nullable)
    );
  }
  switch (rule.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'duration':
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isSafeInteger(value) &&
        value >= (rule.min ?? 0) &&
        value <= (rule.max ?? Number.MAX_SAFE_INTEGER)
      );
    case 'string':
      return typeof value === 'string' && value.length <= rule.maxLength;
    case 'choice':
      return typeof value === 'string' && rule.values.includes(value);
    case 'time':
      return (
        typeof value === 'string' && /^(?:[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/.test(value)
      );
    case 'flowtimeRules':
      return (
        Array.isArray(value) &&
        value.length <= 100 &&
        value.every((ruleValue) => {
          if (!object(ruleValue)) return false;
          const keys = Object.keys(ruleValue);
          const min = ruleValue['minDuration'];
          const max = ruleValue['maxDuration'];
          const pause = ruleValue['breakDuration'];
          return (
            keys.length === 3 &&
            keys.every((field) =>
              ['minDuration', 'maxDuration', 'breakDuration'].includes(field),
            ) &&
            Number.isSafeInteger(min) &&
            (min as number) >= 0 &&
            (min as number) <= 28800000 &&
            (max === null ||
              (Number.isSafeInteger(max) &&
                (max as number) >= Math.max(60000, min as number) &&
                (max as number) <= 28800000)) &&
            Number.isSafeInteger(pause) &&
            (pause as number) >= 60000 &&
            (pause as number) <= Number.MAX_SAFE_INTEGER
          );
        })
      );
  }
  return false;
};

export const validateControlSettingsArgs = (
  args: Record<string, unknown>,
): string | undefined => {
  if (args['command'] !== 'update') return undefined;
  const section = args['section'];
  if (typeof section !== 'string') return 'Unsupported settings fields or values';
  const fields = CONTROL_SETTINGS_FIELDS[section];
  const changes = args['changes'];
  const expected = args['expected'];
  if (
    !fields ||
    !object(changes) ||
    !object(expected) ||
    !Object.keys(changes).length ||
    Object.keys(changes).sort().join() !== Object.keys(expected).sort().join() ||
    Object.entries(changes).some(([key, value]) => {
      if (!Object.hasOwn(fields, key)) return true;
      return (
        !isValidControlSettingValue(section, key, value) ||
        (expected[key] !== null &&
          !isValidControlSettingValue(section, key, expected[key]))
      );
    })
  )
    return 'Unsupported settings fields or values';
  return undefined;
};
