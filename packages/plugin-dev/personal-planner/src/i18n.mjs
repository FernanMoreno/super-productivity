import { translations } from './translations.mjs';
let language = 'es';
let resolved = new Map();
let api;
export const translationKey = (text) => {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return 'M_' + (hash >>> 0).toString(16);
};
export const locale = () => language;
export function tr(source) {
  if (typeof source !== 'string') return source;
  const original = source.trim();
  const text = original.replace(/\s+/g, ' ');
  const prefix = source.slice(0, source.indexOf(original));
  const translated =
    resolved.get(text) ||
    (language.startsWith('es') ? original : translations[text] || original);
  return prefix + translated + source.slice(prefix.length + original.length);
}
// Only template literals' static fragments are translated. Interpolated user
// names, notes and identifiers are never sent to the translation service.
export function html(strings, ...values) {
  return strings
    .map(
      (part, i) =>
        part.replace(
          /(^|>)([^<>]+)(?=<|$)/g,
          (_, boundary, text) => boundary + tr(text),
        ) + (i < values.length ? values[i] : ''),
    )
    .join('');
}
export async function initializeI18n(pluginApi, changed = () => {}) {
  api = pluginApi;
  const reload = async () => {
    try {
      language = (await api.getCurrentLanguage()) || 'en';
    } catch {
      language = 'es';
    }
    resolved = new Map();
    if (typeof api?.translate === 'function') {
      const entries = await Promise.all(
        Object.keys(translations).map(async (source) => {
          const key = translationKey(source);
          try {
            const value = await api.translate(key);
            return [source, value !== key ? value : null];
          } catch {
            return [source, null];
          }
        }),
      );
      resolved = new Map(entries.filter(([, value]) => value));
    }
    if (typeof document !== 'undefined') document.documentElement.lang = language;
  };
  await reload();
  try {
    await api?.registerHook?.('languageChange', async () => {
      await reload();
      changed();
    });
  } catch {
    /* Existing panel reload also reads the host language. */
  }
}
export function wallClock(epoch, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(epoch);
}
export function displayClock(epoch, timezone, hourFormat = '24h') {
  return new Intl.DateTimeFormat(locale(), {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: hourFormat === '12h',
  }).format(epoch);
}
