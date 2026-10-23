/**
 * Obsidian Issue Provider Plugin for Super Productivity
 *
 * Provides 2-way sync between SP tasks and Obsidian. Communication goes
 * through a local HTTP server running inside Obsidian:
 *
 *   - Recommended: obsidian-sp-provider (https://codeberg.org/sinenomine/obsidian-sp-provider)
 *     Plain HTTP on port 27124, no TLS certificate issues.
 *   - Alternative: Local REST API community plugin (https://github.com/coddingtonbear/obsidian-local-rest-api)
 *     Enable HTTP mode (port 27124) to avoid TLS cert issues.
 *
 * Two issue source types are supported:
 *   - tasks  Markdown checkboxes (- [ ] …) found within notes
 *   - notes  Individual notes/pages treated as issues
 *   - both   A union of the above (configurable per provider instance)
 *
 * Stable task IDs
 * ───────────────
 * Task IDs are based on an invisible marker embedded in the task line using
 * Obsidian's comment syntax:
 *
 *   - [ ] Fix login bug %%sp-id:a1b2c3d4%%
 *
 * The %%...%% block is hidden in Obsidian's reading/preview mode. The 8-char
 * hex token is the stable identifier. This means renaming a task in SP (or
 * in Obsidian) does not break the link, because the ID is the marker, not
 * the text. Markers are embedded automatically the first time a task is
 * returned from searchIssues or createIssue.
 *
 * Backwards compatibility: tasks that pre-date the marker system are
 * identified by their text (old-style IDs: `task::{path}::{text}`). They
 * continue to work but will not survive a title rename until their marker
 * is embedded.
 */

import type {
  IssueProviderPluginDefinition,
  PluginFieldMapping,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from './plugin-api';

import type {
  ObsidianDirectoryListing,
  ObsidianDirectoryEntry,
  ObsidianSearchMatch,
} from './obsidian-api';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

// ─── Config ───────────────────────────────────────────────────────────────────

type IssueType = 'tasks' | 'notes' | 'both';

/**
 * Which SP tags a checkbox task gets, derived from where it sits in the vault:
 *   - none           No tags (default)
 *   - title          Note name without extension            ("Work")
 *   - path           Vault-relative path without .md        ("Projects/Work")
 *   - title+heading  Note name plus the nearest heading above the task
 *                    ("Work", "Week 3"); no heading above → note name only
 */
type TagMode = 'none' | 'title' | 'path' | 'title+heading';

const TAG_MODES: readonly TagMode[] = ['none', 'title', 'path', 'title+heading'];

interface ObsidianConfig {
  baseUrl: string;
  apiKey: string;
  vaultFolder: string;
  issueType: IssueType;
  defaultNote: string;
  tagMode: TagMode;
  /** Longest heading tag (in characters); longer headings are shortened. */
  headingTagMaxLength: number;
  pollInterval?: number;
}

const DEFAULT_HEADING_TAG_MAX_LENGTH = 30;

/** The subset of config that decides which labels a checkbox task gets. */
type TagCfg = Pick<ObsidianConfig, 'tagMode' | 'headingTagMaxLength'>;

const DEFAULT_POLL_INTERVAL_MS = 30000;

// ─── ID helpers ────────────────────────────────────────────────────────────────

//
//  Marker-based task ID (new):  "task::{notePath}::sp-{8hexChars}"
//  Text-based task ID (legacy): "task::{notePath}::{taskText}"
//  Note ID:                     "note::{notePath}"
//
//  Marker IDs are stable across renames because they key off an embedded
//  %%sp-id:XXXXXXXX%% comment in the task line, not the task text.
//  Text-based IDs are kept for backwards compatibility only.

const TASK_PREFIX = 'task::';
const NOTE_PREFIX = 'note::';
const MARKER_KEY_PREFIX = 'sp-';

/** Regex that matches the embedded marker anywhere in a task line. */
const SP_MARKER_RE = /%%sp-id:([0-9a-f]{8})%%/;

/** Generate a random 8-char hex marker ID (avoids crypto.getRandomValues for sandbox compat). */
function genMarkerId(): string {
  return Math.floor(Math.random() * 0x100000000)
    .toString(16)
    .padStart(8, '0')
    .slice(-8);
}

function makeMarker(id: string): string {
  return `%%sp-id:${id}%%`;
}

/** Build a marker-based task ID. */
function makeTaskIdFromMarker(path: string, markerId: string): string {
  return `${TASK_PREFIX}${path}::${MARKER_KEY_PREFIX}${markerId}`;
}

/** Build a legacy text-based task ID (used only for backwards compat). */
function makeTaskIdFromText(path: string, text: string): string {
  return `${TASK_PREFIX}${path}::${text}`;
}

function makeNoteId(path: string): string {
  return `${NOTE_PREFIX}${path}`;
}

interface ParsedId {
  type: 'task' | 'note';
  path: string;
  /** Present when type === 'task'. Starts with MARKER_KEY_PREFIX for marker IDs. */
  taskKey: string;
}

function parseId(id: string): ParsedId {
  if (id.startsWith(TASK_PREFIX)) {
    const rest = id.slice(TASK_PREFIX.length);
    const sep = rest.indexOf('::');
    return { type: 'task', path: rest.slice(0, sep), taskKey: rest.slice(sep + 2) };
  }
  return { type: 'note', path: id.slice(NOTE_PREFIX.length), taskKey: '' };
}

function isMarkerKey(taskKey: string): boolean {
  return taskKey.startsWith(MARKER_KEY_PREFIX);
}

function markerIdFromKey(taskKey: string): string {
  return taskKey.slice(MARKER_KEY_PREFIX.length);
}

// ─── Checkbox / task-text utilities ────────────────────────────────────────

/** Matches `- [ ] text`, `- [x] text`, `* [ ] text`, `* [x] text` */
const CHECKBOX_RE = /^(\s*[-*]\s+\[)([^\]]*?)(\]\s+)(.*)/;

function isChecked(line: string): boolean {
  const m = CHECKBOX_RE.exec(line);
  return !!m && m[2].trim().toLowerCase() === 'x';
}

/**
 * Return the visible task text (marker stripped) and the embedded marker ID
 * (or null if no marker is present).
 */
function parseTaskLine(line: string): { text: string; markerId: string | null } | null {
  const m = CHECKBOX_RE.exec(line);
  if (!m) return null;
  const raw = m[4];
  const markerMatch = SP_MARKER_RE.exec(raw);
  const markerId = markerMatch ? markerMatch[1] : null;
  const text = raw.replace(SP_MARKER_RE, '').trim();
  return { text, markerId };
}

function setCheckboxState(line: string, done: boolean): string {
  return line.replace(CHECKBOX_RE, (_full, pre, _mark, mid, text) => {
    return `${pre}${done ? 'x' : ' '}${mid}${text}`;
  });
}

/**
 * Replace the visible task text, preserving any existing %%sp-id:%% marker.
 * If embedMarkerId is provided and no marker exists yet, it is appended.
 */
function setTaskText(line: string, newText: string, embedMarkerId?: string): string {
  return line.replace(CHECKBOX_RE, (_full, pre, mark, mid, oldRaw) => {
    const existingMarker = SP_MARKER_RE.exec(oldRaw);
    const markerSuffix = existingMarker
      ? ` ${existingMarker[0]}`
      : embedMarkerId
        ? ` ${makeMarker(embedMarkerId)}`
        : '';
    return `${pre}${mark}${mid}${newText}${markerSuffix}`;
  });
}

/**
 * Append a marker to a line that doesn't have one yet.
 * Returns the modified line.
 */
function embedMarkerInLine(line: string, markerId: string): string {
  return line.trimEnd() + ` ${makeMarker(markerId)}`;
}

// ─── Frontmatter helpers ───────────────────────────────────────────────────────

/** Extract the raw YAML block from markdown frontmatter (between --- delimiters). */
function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) return result;
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

function noteTitleFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}

/**
 * Labels for a checkbox task derived from the note it lives in. SP maps these
 * to tags by title via the `tagIds` field mapping (see fieldMappings below).
 */
function noteLabels(path: string, mode: TagMode): string[] {
  switch (mode) {
    case 'title':
    case 'title+heading':
      return [noteTitleFromPath(path)];
    case 'path':
      return [path.replace(/\.md$/i, '')];
    default:
      return [];
  }
}

function includesHeadingTag(mode: TagMode): boolean {
  return mode === 'title+heading';
}

// ─── Heading helpers ──────────────────────────────────────────────────────────

/** Matches ATX headings (`# Title`, `## Title ##`). Group 2 = heading text. */
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** Reduce a heading to plain text usable as a tag title. */
function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[target|alias]] → alias
    .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[target]] → target
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url) → text
    .replace(/[*_`~]+/g, '') // emphasis markers
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * For every line, the text of the nearest heading above (or on) it, or null
 * when no heading precedes it. Headings inside YAML frontmatter and fenced
 * code blocks are ignored. Computed in one forward pass so callers that walk
 * the lines can look up `headings[i]` for each task line.
 */
function nearestHeadings(lines: string[]): (string | null)[] {
  const result: (string | null)[] = new Array(lines.length).fill(null);
  let current: string | null = null;
  let inFence = false;
  let inFrontmatter = lines.length > 0 && /^---\s*$/.test(lines[0]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFrontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) inFrontmatter = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      const m = HEADING_RE.exec(line);
      if (m) {
        const text = cleanHeadingText(m[2]);
        if (text) current = text;
      }
    }
    result[i] = current;
  }
  return result;
}

// ─── Task nesting helpers ─────────────────────────────────────────────────────

/** Leading indentation of a line in columns; a tab counts as 4. */
function indentWidth(line: string): number {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

/** A flush-left line that is not a list item ends a task list. */
const LIST_ITEM_RE = /^\s*([-*+]|\d+[.)])\s/;

/**
 * For every line, the index of the top-level task line it is nested under
 * (by indentation), or null when the line is not a nested task.
 *
 * SP supports a single level of subtasks, so every descendant is attributed
 * to the root task of its list rather than to its direct parent:
 *
 *   - [ ] A            → top level
 *       - [ ] B        → subtask of A
 *           - [ ] C    → subtask of A (not of B)
 *       - [ ] D        → subtask of A
 *
 * A heading, a code fence or a flush-left non-list line ends the list.
 */
function rootTaskLines(lines: string[]): (number | null)[] {
  const result = new Array<number | null>(lines.length).fill(null);
  const stack: { indent: number; rootIdx: number }[] = [];
  let inFence = false;
  let inFrontmatter = lines.length > 0 && /^---\s*$/.test(lines[0]);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFrontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) inFrontmatter = false;
      continue;
    }
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      stack.length = 0;
      continue;
    }
    if (inFence) continue;

    if (CHECKBOX_RE.test(line)) {
      const indent = indentWidth(line);
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const rootIdx = stack.length ? stack[stack.length - 1].rootIdx : i;
      if (stack.length) result[i] = rootIdx;
      stack.push({ indent, rootIdx });
      continue;
    }

    if (HEADING_RE.test(line) || (/^\S/.test(line) && !LIST_ITEM_RE.test(line))) {
      stack.length = 0;
    }
  }
  return result;
}

/**
 * Issue id of the root task that line `i` is nested under, or null when it is
 * a top-level task. The root needs a marker for a stable id; when it has none
 * and `allowEmbed` is set, one is embedded in `lines` (the caller must then
 * write the note back). `embedded` reports whether that happened.
 */
function rootIssueId(
  lines: string[],
  roots: (number | null)[],
  i: number,
  path: string,
  allowEmbed: boolean,
): { id: string | null; embedded: boolean } {
  const rootIdx = roots[i];
  if (rootIdx === null) return { id: null, embedded: false };
  const root = parseTaskLine(lines[rootIdx]);
  if (!root) return { id: null, embedded: false };
  if (root.markerId)
    return { id: makeTaskIdFromMarker(path, root.markerId), embedded: false };
  if (!allowEmbed) return { id: null, embedded: false };
  const markerId = genMarkerId();
  lines[rootIdx] = embedMarkerInLine(lines[rootIdx], markerId);
  return { id: makeTaskIdFromMarker(path, markerId), embedded: true };
}

/**
 * Splits a heading from its explanatory tail: `Week 5: Interviews`,
 * `Week 5 - Interviews`, `Week 5 – Interviews`, `Week 5 | Interviews`,
 * `Week 5 (draft)`. Dashes only count when surrounded by whitespace, and a
 * colon only when followed by whitespace, so `Week 3-4` and `10:30` survive.
 */
const HEADING_SEPARATOR_RE = /\s*(?::\s|\s[-–—]\s|\||\()/;

/**
 * Turn a heading into something short enough to be a tag:
 *   1. keep only the part before the first separator (see HEADING_SEPARATOR_RE)
 *   2. if that is still longer than maxLength, cut to the last whole word that
 *      fits (or hard-cut a single overlong word)
 * Returns '' when nothing usable is left.
 */
function shortenHeading(text: string, maxLength: number): string {
  let out = text.trim();
  const sep = HEADING_SEPARATOR_RE.exec(out);
  if (sep && sep.index > 0) {
    out = out.slice(0, sep.index).trim();
  }
  if (out.length > maxLength) {
    const cut = out.slice(0, maxLength);
    const lastSpace = cut.search(/\s\S*$/);
    out = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
  }
  // Drop dangling punctuation left by a cut ("Week 5," → "Week 5").
  return out.replace(/[\s,;:.\-–—]+$/, '');
}

/**
 * All labels for a checkbox task: the source-note label(s) plus, when enabled,
 * the (shortened) nearest heading above the task. Duplicates are dropped so a
 * task right under a `# Planning` title in `Planning.md` gets one `Planning` tag.
 */
function taskLabels(path: string, heading: string | null, tagCfg: TagCfg): string[] {
  const labels = noteLabels(path, tagCfg.tagMode);
  if (includesHeadingTag(tagCfg.tagMode) && heading) {
    const tag = shortenHeading(heading, tagCfg.headingTagMaxLength);
    if (tag && !labels.includes(tag)) labels.push(tag);
  }
  return labels;
}

function obsidianUri(path: string): string {
  return `obsidian://open?file=${encodeURIComponent(path)}`;
}

/** Encode a vault-relative path for use in a URL, preserving `/` separators. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

// ─── Config accessor ────────────────────────────────────────────────────

/** Form inputs arrive as strings; accept a positive integer or fall back. */
function positiveIntOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

const cfg = (config: Record<string, unknown>): ObsidianConfig => {
  const c = config as unknown as ObsidianConfig;
  return {
    baseUrl: (c.baseUrl || 'http://127.0.0.1:27124').replace(/\/$/, ''),
    apiKey: c.apiKey || '',
    vaultFolder: (c.vaultFolder || '').replace(/\/$/, ''),
    issueType: (c.issueType as IssueType) || 'both',
    defaultNote: c.defaultNote || 'Inbox.md',
    tagMode: TAG_MODES.includes(c.tagMode) ? c.tagMode : 'none',
    headingTagMaxLength: positiveIntOr(
      c.headingTagMaxLength,
      DEFAULT_HEADING_TAG_MAX_LENGTH,
    ),
    pollInterval: c.pollInterval as number | undefined,
  };
};

function getPollInterval(config: Record<string, unknown>): number {
  const interval = cfg(config).pollInterval;
  return interval || DEFAULT_POLL_INTERVAL_MS;
}

// ─── HTTP helpers ──────────────────────────────────────────────────────

//
// We use the native fetch() API directly rather than PluginHttp because
// PluginHttp blocks requests to localhost/127.0.0.1 by design. fetch() is
// available in Electron's renderer process and has no such restriction.

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/** Thrown for non-2xx responses so callers can tell a 404 from an outage. */
class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

function isNotFound(e: unknown): boolean {
  return e instanceof HttpStatusError && e.status === 404;
}

async function obsidianFetch<T>(
  method: string,
  url: string,
  apiKey: string,
  body?: unknown,
): Promise<T> {
  const opts = {
    method,
    headers: authHeaders(apiKey),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  let resp = await fetch(url, opts);
  for (const delay of [500, 1500]) {
    if (resp.status !== 429) break;
    await new Promise((r) => setTimeout(r, delay));
    resp = await fetch(url, opts);
  }

  if (!resp.ok) throw new HttpStatusError(resp.status);
  return resp.json() as Promise<T>;
}

async function getFileData(
  baseUrl: string,
  apiKey: string,
  path: string,
): Promise<{ content: string; mtime: number }> {
  const url = `${baseUrl}/vault/${encodePath(path)}`;
  const result = await obsidianFetch<{ content: string; mtime: number }>(
    'GET',
    url,
    apiKey,
  );
  return { content: result?.content ?? '', mtime: result?.mtime ?? Date.now() };
}

async function getFileContent(
  baseUrl: string,
  apiKey: string,
  path: string,
  _http: PluginHttp,
): Promise<string> {
  return (await getFileData(baseUrl, apiKey, path)).content;
}

async function putFileContent(
  baseUrl: string,
  apiKey: string,
  path: string,
  content: string,
  _http: PluginHttp,
): Promise<void> {
  const url = `${baseUrl}/vault/${encodePath(path)}`;
  await obsidianFetch<unknown>('PUT', url, apiKey, { content });
}

// ─── Offline update queue ─────────────────────────────────────────────

interface QueuedUpdate {
  id: string;
  changes: Record<string, unknown>;
  queuedAt: number;
}

const QUEUE_KEY = 'sp-obsidian-update-queue';
const QUEUE_MAX = 100;
const QUEUE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// A queue belongs to one endpoint and configured source. Never replay the
// legacy unscoped queue: its destination cannot be recovered safely.
function sourceKey(config: Record<string, unknown>): string {
  const c = cfg(config);
  return JSON.stringify([c.baseUrl, c.vaultFolder, c.defaultNote, c.issueType]);
}

function queueKey(config: Record<string, unknown>): string {
  return `${QUEUE_KEY}:${sourceKey(config)}`;
}

function loadQueue(config: Record<string, unknown>): QueuedUpdate[] {
  try {
    const raw = localStorage.getItem(queueKey(config));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as QueuedUpdate[]).filter(
      (e) => e && typeof e.id === 'string' && now - (e.queuedAt ?? 0) < QUEUE_TTL_MS,
    );
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedUpdate[], config: Record<string, unknown>): void {
  try {
    localStorage.setItem(queueKey(config), JSON.stringify(queue.slice(0, QUEUE_MAX)));
  } catch {
    // localStorage unavailable – best effort
  }
}

function enqueueUpdate(
  id: string,
  changes: Record<string, unknown>,
  config: Record<string, unknown>,
): void {
  const queue = loadQueue(config);
  const idx = queue.findIndex((e) => e.id === id);
  if (idx >= 0) {
    // Merge with existing entry (last write wins per field)
    queue[idx] = {
      id,
      changes: { ...queue[idx].changes, ...changes },
      queuedAt: Date.now(),
    };
  } else {
    queue.push({ id, changes, queuedAt: Date.now() });
  }
  saveQueue(queue, config);
}

async function applyUpdate(
  id: string,
  changes: Record<string, unknown>,
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<void> {
  const { baseUrl, apiKey } = cfg(config);
  const parsed = parseId(id);
  const content = await getFileContent(baseUrl, apiKey, parsed.path, http);
  const lines = content.split('\n');
  let changed = false;

  if (parsed.type === 'task') {
    const idx = findTaskLineIndex(lines, parsed.taskKey);
    if (idx !== -1) {
      if ('state' in changes) {
        lines[idx] = setCheckboxState(lines[idx], changes.state === 'completed');
        changed = true;
      }
      if ('title' in changes && typeof changes.title === 'string') {
        lines[idx] = setTaskText(lines[idx], changes.title as string);
        changed = true;
      }
    }
  } else {
    if ('state' in changes) {
      const isCompleted = changes.state === 'completed';
      const hasFm = /^---\n/.test(content);
      if (hasFm) {
        const updated = content.replace(
          /^(---\n[\s\S]*?)(completed:\s*\S+\n?)?(\n?---)/,
          (_full, open, _old, close) => `${open}completed: ${isCompleted}\n${close}`,
        );
        if (updated !== content) {
          await putFileContent(baseUrl, apiKey, parsed.path, updated, http);
          return;
        }
      } else {
        await putFileContent(
          baseUrl,
          apiKey,
          parsed.path,
          `---\ncompleted: ${isCompleted}\n---\n\n${content}`,
          http,
        );
        return;
      }
    }
  }

  if (changed) {
    await putFileContent(baseUrl, apiKey, parsed.path, lines.join('\n'), http);
  }
}

const queueFlights = new Map<string, Promise<void>>();

async function processQueue(
  config: Record<string, unknown>,
  http: PluginHttp,
): Promise<void> {
  const key = sourceKey(config);
  const existing = queueFlights.get(key);
  if (existing) return existing;

  const replay = (async () => {
    const queue = loadQueue(config);
    const applied = new Map<string, string>();
    for (const entry of queue) {
      try {
        await applyUpdate(entry.id, entry.changes, config, http);
        applied.set(entry.id, JSON.stringify(entry));
      } catch {
        // Keep failed entries and any newer edits for the next replay.
      }
    }
    // Re-read after awaits: enqueues may have added or replaced entries.
    // Remove only the exact snapshots that were successfully applied.
    const remaining = loadQueue(config).filter(
      (entry) => applied.get(entry.id) !== JSON.stringify(entry),
    );
    saveQueue(remaining, config);
  })();
  queueFlights.set(key, replay);
  try {
    await replay;
  } finally {
    queueFlights.delete(key);
  }
}

// ─── Issue builders ─────────────────────────────────────────────

function issueFromTask(
  path: string,
  taskText: string,
  done: boolean,
  markerId: string | null,
  mtime: number,
  labels: string[],
  heading: string | null,
  relatedTo: string | null,
): PluginIssue {
  const id = markerId
    ? makeTaskIdFromMarker(path, markerId)
    : makeTaskIdFromText(path, taskText);
  return {
    id,
    title: taskText,
    body: '',
    url: obsidianUri(path),
    state: done ? 'completed' : 'open',
    lastUpdated: mtime,
    labels,
    notePath: path,
    // Full (unshortened) nearest heading, shown in the SP task details panel.
    heading: heading ?? undefined,
    // Issue id of the top-level task this one is indented under (see the
    // related_to field mapping). SP attaches the task as a subtask of it.
    ...(relatedTo ? { related_to: relatedTo } : {}),
  };
}

/** Build the issue for the checkbox task on `lines[idx]` of `path` (read-only). */
function taskIssueAtLine(
  path: string,
  lines: string[],
  idx: number,
  mtime: number,
  tagCfg: TagCfg,
): PluginIssue {
  const taskParsed = parseTaskLine(lines[idx])!;
  const heading = nearestHeadings(lines)[idx];
  // Read-only here: a root without a marker simply yields no link.
  const root = rootIssueId(lines, rootTaskLines(lines), idx, path, false);
  return issueFromTask(
    path,
    taskParsed.text,
    isChecked(lines[idx]),
    taskParsed.markerId,
    mtime,
    taskLabels(path, heading, tagCfg),
    heading,
    root.id,
  );
}

// ─── Change detection ─────────────────────────────────────────────────────────

/**
 * SP treats an issue as changed whenever `lastUpdated` grows, and then
 * announces "updated data" and flags the task, even if nothing it pulls has
 * actually changed. The only timestamp a task line has is its note's mtime,
 * which moves on every edit anywhere in the note. To keep an unrelated edit
 * from flagging every task in that note, remember what each task looked like
 * when it was last reported and keep reporting that same timestamp until the
 * task's own content changes. In-memory only: after an SP restart the first
 * poll behaves as before, then it settles.
 */
interface ReportedTask {
  signature: string;
  lastUpdated: number;
}

const reportedTasks = new Map<string, ReportedTask>();

/** Everything SP can pull or display for a task; a change here is a real update. */
function taskSignature(issue: PluginIssue): string {
  return JSON.stringify([
    issue.title,
    issue.state,
    issue.labels ?? [],
    issue.heading ?? '',
    issue.related_to ?? '',
  ]);
}

function withStableLastUpdated(issue: PluginIssue): PluginIssue {
  const signature = taskSignature(issue);
  const prev = reportedTasks.get(issue.id);
  if (prev && prev.signature === signature) {
    return { ...issue, lastUpdated: prev.lastUpdated };
  }
  reportedTasks.set(issue.id, {
    signature,
    lastUpdated: issue.lastUpdated ?? Date.now(),
  });
  return issue;
}

/**
 * Issue ids already reported as deleted in this SP session. SP either removed
 * the task on that report or, when time was tracked on it, is showing a
 * warning with a Delete button. Reporting again every poll would re-open
 * that warning every 30 s, so later polls fail quietly instead (see getById).
 */
const reportedDeleted = new Set<string>();

/**
 * Issue state reported when a task line no longer exists anywhere in the
 * vault. Listed in `deletedStates`, so SP removes the linked task (or, when
 * time was tracked on it, warns and offers to remove it).
 */
const DELETED_STATE = 'deleted';

function deletedTaskIssue(issueId: string, path: string, taskKey: string): PluginIssue {
  return {
    id: issueId,
    title: taskKey,
    body: '',
    url: obsidianUri(path),
    state: DELETED_STATE,
    lastUpdated: Date.now(),
    notePath: path,
  };
}

/**
 * Look for a task marker anywhere in the vault. Used when a task line is no
 * longer where SP last saw it: if the marker turns up in another note, the
 * task was moved and the issue is rebuilt from its new location.
 *
 * Only a clean "not found" yields null. A failing search or an unreadable
 * candidate note throws, so a transient outage can never be mistaken for a
 * deletion.
 */
async function findTaskByMarker(
  baseUrl: string,
  apiKey: string,
  markerId: string,
  excludePath: string,
  tagCfg: TagCfg,
): Promise<PluginIssue | null> {
  const searchUrl = `${baseUrl}/search/simple/?query=${encodeURIComponent(makeMarker(markerId))}&contextLength=0`;
  const raw = await obsidianFetch<ObsidianSearchMatch[]>('POST', searchUrl, apiKey);
  const matches = Array.isArray(raw) ? raw : [];

  for (const match of matches) {
    const path = match.filename;
    if (path === excludePath || !path.endsWith('.md')) continue;
    let file: { content: string; mtime: number };
    try {
      file = await getFileData(baseUrl, apiKey, path);
    } catch (e) {
      if (isNotFound(e)) continue; // vanished between search and read
      throw e;
    }
    const lines = file.content.split('\n');
    const idx = findTaskLineIndex(lines, `${MARKER_KEY_PREFIX}${markerId}`);
    if (idx !== -1) return taskIssueAtLine(path, lines, idx, file.mtime, tagCfg);
  }
  return null;
}

function issueFromNote(path: string, content: string, mtime: number): PluginIssue {
  const fm = parseFrontmatter(content);
  const title = noteTitleFromPath(path);
  const bodyLines = content
    .replace(/^---[\s\S]*?---\n?/, '')
    .replace(/^#\s+.+\n?/m, '')
    .trim();

  // Collect #tags from frontmatter
  const labels: string[] = fm['tags']
    ? fm['tags']
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, '').trim())
        .filter(Boolean)
    : [];

  return {
    id: makeNoteId(path),
    title,
    body: bodyLines,
    url: obsidianUri(path),
    state: fm['completed'] === 'true' ? 'completed' : 'open',
    lastUpdated: mtime,
    dueOn: fm['due'] || fm['due_date'] || undefined,
    labels,
    notePath: path,
  };
}

// ─── Search helpers ─────────────────────────────────────────────

const RECENT_ISSUES_LIMIT = 10;

/** Safety cap on how many files a backlog import will scan in one pass. */
const BACKLOG_FILE_LIMIT = 500;

/**
 * Find the index of the line that contains the given marker or matches the
 * given legacy text key.
 * Returns -1 if not found.
 */
function findTaskLineIndex(lines: string[], taskKey: string): number {
  if (isMarkerKey(taskKey)) {
    const markerId = markerIdFromKey(taskKey);
    for (let i = 0; i < lines.length; i++) {
      const m = SP_MARKER_RE.exec(lines[i]);
      if (m && m[1] === markerId) return i;
    }
  } else {
    // Legacy text-based lookup
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseTaskLine(lines[i]);
      if (parsed && parsed.text === taskKey) return i;
    }
  }

  return -1;
}

/**
 * Build a set of recently modified vault items (notes or incomplete tasks).
 * Items that are older than a month are not considered.
 */
async function recentIssues(
  baseUrl: string,
  apiKey: string,
  vaultFolder: string,
  issueType: IssueType,
  tagCfg: TagCfg,
  _http: PluginHttp,
): Promise<PluginSearchResult[]> {
  const folderPath = vaultFolder;
  const listUrl = `${baseUrl}/vault/${folderPath ? encodePath(folderPath) + '/' : ''}`;

  let entries: ObsidianDirectoryEntry[] = [];
  try {
    const raw = await obsidianFetch<ObsidianDirectoryListing>('GET', listUrl, apiKey);
    // Server returns files sorted newest-first; take top N
    entries = (raw.files ?? [])
      .filter((f) => f.name.endsWith('.md'))
      .slice(0, RECENT_ISSUES_LIMIT);
  } catch {
    return [];
  }

  const results: PluginSearchResult[] = [];

  for (const entry of entries) {
    const relativePath = entry.name;
    const fullPath = folderPath ? `${folderPath}/${relativePath}` : relativePath;

    if (issueType === 'notes' || issueType === 'both') {
      results.push({
        id: makeNoteId(fullPath),
        title: noteTitleFromPath(fullPath),
        url: obsidianUri(fullPath),
        status: 'open',
      });
    }

    if (issueType === 'tasks' || issueType === 'both') {
      try {
        const content = await getFileContent(baseUrl, apiKey, fullPath, _http);
        const lines = content.split('\n');
        const headings = nearestHeadings(lines);
        const roots = rootTaskLines(lines);
        let fileModified = false;

        for (let i = 0; i < lines.length; i++) {
          const parsed = parseTaskLine(lines[i]);
          if (!parsed || isChecked(lines[i])) continue;

          let markerId = parsed.markerId;
          if (!markerId) {
            markerId = genMarkerId();
            lines[i] = embedMarkerInLine(lines[i], markerId);
            fileModified = true;
          }
          const root = rootIssueId(lines, roots, i, fullPath, true);
          if (root.embedded) fileModified = true;

          results.push({
            id: makeTaskIdFromMarker(fullPath, markerId),
            title: `${parsed.text} (${noteTitleFromPath(fullPath)})`,
            url: obsidianUri(fullPath),
            status: 'open',
            labels: taskLabels(fullPath, headings[i], tagCfg),
            ...(root.id ? { related_to: root.id } : {}),
          });
        }

        if (fileModified) {
          await putFileContent(baseUrl, apiKey, fullPath, lines.join('\n'), _http);
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return results;
}

// ─── Plugin registration ────────────────────────────────────────

interface RecentCache {
  sourceKey: string;
  results: PluginSearchResult[];
  fetchedAt: number;
}

const state = {
  lastSync: 0,
  recentCache: null as RecentCache | null,
};

PluginAPI.registerIssueProvider({
  // ── Config form ───────────────────────────────────────────

  configFields: [
    {
      key: 'baseUrl',
      type: 'input',
      label: 'Base URL',
      required: true,
    },
    {
      key: 'baseUrlHelp',
      type: 'link',
      label:
        'Install the Super Productivity provider plugin for Obsidian to get a Base URL and API Key',
      url: 'https://codeberg.org/sinenomine/obsidian-sp-provider',
    },
    {
      key: 'apiKey',
      type: 'password',
      label: 'API Key',
      required: true,
    },
    {
      key: 'apiKeyHelp',
      type: 'link',
      label: 'Find your API key in Obsidian → Settings → Super Productivity provider',
      url: 'https://codeberg.org/sinenomine/obsidian-sp-provider',
    },
    {
      key: 'issueType',
      type: 'select',
      label: 'Issue source',
      required: true,
      options: [
        { label: 'Checkbox tasks & notes', value: 'both' },
        { label: 'Checkbox tasks only', value: 'tasks' },
        { label: 'Notes only', value: 'notes' },
      ],
    },
    {
      key: 'vaultFolder',
      type: 'input',
      label: 'Vault folder (optional – limits search scope)',
      required: false,
    },
    {
      key: 'tagMode',
      type: 'select',
      label: 'Tag tasks with',
      required: false,
      options: [
        { label: 'Off', value: 'none' },
        { label: 'Note name (e.g. "Work")', value: 'title' },
        { label: 'Note path (e.g. "Projects/Work")', value: 'path' },
        {
          label: 'Note name + nearest heading (e.g. "Work", "Week 3")',
          value: 'title+heading',
        },
      ],
    },
    {
      key: 'headingTagMaxLength',
      type: 'input',
      label: 'Max heading tag length (default 30)',
      required: false,
      pattern: '^[1-9][0-9]*$',
    },
    {
      key: 'defaultNote',
      type: 'input',
      label: 'Default note for new tasks (e.g. Inbox.md)',
      required: false,
      advanced: true,
    },
    {
      key: 'pollInterval',
      type: 'input',
      label:
        "Write debounce interval (ms, default 30000) — controls how often queued changes are flushed to Obsidian. Note: SP's read polling rate is configured in SP's own settings, not here.",
      required: false,
      advanced: true,
    },
    {
      key: 'moreInfo',
      type: 'link',
      label: 'Documentation & source code',
      url: 'https://codeberg.org/sinenomine/sp-obsidian',
      advanced: true,
    },
  ],

  // ── Auth headers ────────────────────────────────────

  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const { apiKey } = cfg(config);
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  },

  // ── Connection test ─────────────────────────────────

  async testConnection(
    config: Record<string, unknown>,
    _http: PluginHttp,
  ): Promise<boolean> {
    try {
      const { baseUrl, apiKey } = cfg(config);
      await obsidianFetch('GET', `${baseUrl}/`, apiKey);
      return true;
    } catch (err) {
      console.error('[sp-obsidian] testConnection failed', err);
      return false;
    }
  },

  // ── Issue search ─────────────────────────────────

  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    state.lastSync = Date.now();
    const c = cfg(config);
    const { baseUrl, apiKey, vaultFolder, issueType } = c;
    const term = (searchTerm || '').trim();
    const results: PluginSearchResult[] = [];

    if (!term) {
      await processQueue(config, http);
      const now = Date.now();
      const ttl = getPollInterval(config);
      const cacheSourceKey = sourceKey(config);
      if (
        state.recentCache &&
        state.recentCache.sourceKey === cacheSourceKey &&
        now - state.recentCache.fetchedAt < ttl
      ) {
        return state.recentCache.results;
      }
      const results = await recentIssues(
        baseUrl,
        apiKey,
        vaultFolder,
        issueType,
        c,
        http,
      );
      state.recentCache = { sourceKey: cacheSourceKey, results, fetchedAt: now };
      return results;
    }

    // Try the server-side search endpoint first
    let filePaths: string[] = [];
    let serverSearched = false;
    try {
      const searchUrl = `${baseUrl}/search/simple/?query=${encodeURIComponent(term)}&contextLength=200`;
      const raw = await obsidianFetch<ObsidianSearchMatch[]>('POST', searchUrl, apiKey);
      if (Array.isArray(raw) && raw.length > 0) {
        filePaths = raw.map((m) => m.filename);
        serverSearched = true;
      }
    } catch {
      // endpoint unavailable — fall through to client-side fallback
    }

    // Fallback: list the vault directory and search client-side
    if (!serverSearched) {
      const folderPath = vaultFolder || '';
      const listUrl = `${baseUrl}/vault/${folderPath ? encodePath(folderPath) + '/' : ''}`;
      try {
        const raw = await obsidianFetch<ObsidianDirectoryListing>('GET', listUrl, apiKey);
        filePaths = (raw.files ?? [])
          .filter((f) => f.name.endsWith('.md'))
          .slice(0, RECENT_ISSUES_LIMIT)
          .map((f) => (folderPath ? `${folderPath}/${f.name}` : f.name));
      } catch {
        return [];
      }
    }

    // Apply vault folder scope to server-search results
    const scopedPaths =
      vaultFolder && serverSearched
        ? filePaths.filter((p) => p.startsWith(vaultFolder + '/') || p === vaultFolder)
        : filePaths;

    for (const path of scopedPaths) {
      const nameMatches = noteTitleFromPath(path)
        .toLowerCase()
        .includes(term.toLowerCase());

      if (issueType === 'notes' || issueType === 'both') {
        if (serverSearched || nameMatches) {
          results.push({
            id: makeNoteId(path),
            title: noteTitleFromPath(path),
            url: obsidianUri(path),
            status: 'open',
          });
        }
      }

      if (issueType === 'tasks' || issueType === 'both') {
        try {
          const content = await getFileContent(baseUrl, apiKey, path, http);
          const lines = content.split('\n');
          const headings = nearestHeadings(lines);
          const roots = rootTaskLines(lines);
          let fileModified = false;

          for (let i = 0; i < lines.length; i++) {
            const parsed = parseTaskLine(lines[i]);
            if (!parsed) continue;
            const { text, markerId: existingMarker } = parsed;

            // In fallback mode, filter by task text or note name matching the term
            if (
              !serverSearched &&
              !nameMatches &&
              !text.toLowerCase().includes(term.toLowerCase())
            )
              continue;

            let markerId = existingMarker;
            if (!markerId) {
              markerId = genMarkerId();
              lines[i] = embedMarkerInLine(lines[i], markerId);
              fileModified = true;
            }
            const root = rootIssueId(lines, roots, i, path, true);
            if (root.embedded) fileModified = true;

            results.push({
              id: makeTaskIdFromMarker(path, markerId),
              title: `${text} (${noteTitleFromPath(path)})`,
              url: obsidianUri(path),
              status: isChecked(lines[i]) ? 'completed' : 'open',
              labels: taskLabels(path, headings[i], c),
              ...(root.id ? { related_to: root.id } : {}),
            });
          }

          if (fileModified) {
            await putFileContent(baseUrl, apiKey, path, lines.join('\n'), http);
          }
        } catch {
          // Skip files that can't be fetched
        }
      }
    }

    return results;
  },

  // ── Fetch full issue details ─────────────────────────

  async getById(
    issueId: string,
    config: Record<string, unknown>,
    _http: PluginHttp,
  ): Promise<PluginIssue> {
    const c = cfg(config);
    const { baseUrl, apiKey } = c;
    const parsed = parseId(issueId);

    if (parsed.type === 'note') {
      // A missing note throws, so SP leaves the task untouched: the note may
      // simply have been renamed, and there is no marker to find it by.
      const { content, mtime } = await getFileData(baseUrl, apiKey, parsed.path);
      return issueFromNote(parsed.path, content, mtime);
    }

    let file: { content: string; mtime: number } | null = null;
    try {
      file = await getFileData(baseUrl, apiKey, parsed.path);
    } catch (e) {
      // A missing note is handled like a missing line below. Anything else
      // (connection problems, auth) propagates so SP leaves the task untouched.
      if (!isNotFound(e)) throw e;
    }

    if (file) {
      const lines = file.content.split('\n');
      const idx = findTaskLineIndex(lines, parsed.taskKey);
      if (idx !== -1) {
        reportedDeleted.delete(issueId); // back (undo) → a later deletion counts again
        return withStableLastUpdated(
          taskIssueAtLine(parsed.path, lines, idx, file.mtime, c),
        );
      }
    }

    if (!isMarkerKey(parsed.taskKey)) {
      // Legacy text-based id: the line was renamed or removed and there is no
      // marker to search for. Fail the refresh so SP keeps the task as it is.
      throw new Error(
        `[sp-obsidian] task "${parsed.taskKey}" not found in ${parsed.path}`,
      );
    }

    // The line is gone from its note. The marker travels with a moved line, so
    // look for it across the vault before concluding the task was deleted.
    const moved = await findTaskByMarker(
      baseUrl,
      apiKey,
      markerIdFromKey(parsed.taskKey),
      parsed.path,
      c,
    );
    if (moved) {
      // Report it under its new path with a fresh timestamp so SP applies the
      // change immediately and re-links the task to the new issue id.
      reportedDeleted.delete(issueId);
      return { ...moved, lastUpdated: Date.now() };
    }

    if (reportedDeleted.has(issueId)) {
      // Already told SP once this session. Failing the refresh keeps SP from
      // repeating its warning and from touching the task.
      throw new Error(`[sp-obsidian] ${issueId} already reported as deleted`);
    }
    reportedDeleted.add(issueId);
    return deletedTaskIssue(issueId, parsed.path, parsed.taskKey);
  },

  // ── Issue permalink ─────────────────────────────

  getIssueLink(issueId: string): string {
    const parsed = parseId(issueId);
    return obsidianUri(parsed.path);
  },

  // ── Push changes from SP → Obsidian ───────────────────────

  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const interval = getPollInterval(config);
    const now = Date.now();
    const timeSinceLastSync = now - state.lastSync;

    if (timeSinceLastSync >= interval && !queueFlights.has(sourceKey(config))) {
      state.lastSync = now;
      try {
        await applyUpdate(id, changes, config, http);
      } catch {
        enqueueUpdate(id, changes, config);
      }
    } else {
      enqueueUpdate(id, changes, config);
    }
  },

  // ── Create a new issue in Obsidian ───────────────────

  async createIssue(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueNumber: number; issueData: PluginIssue }> {
    const c = cfg(config);
    const { baseUrl, apiKey, issueType, vaultFolder, defaultNote } = c;

    if (issueType === 'notes') {
      // Create a new markdown note
      const folder = vaultFolder ? `${vaultFolder}/` : '';
      const safeName = title.replace(/[\\/:*?"<>|]/g, '-');
      const path = `${folder}${safeName}.md`;
      const noteContent = `# ${title}\n`;
      try {
        await getFileData(baseUrl, apiKey, path);
        throw new Error(`[sp-obsidian] Note already exists: ${path}`);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      await putFileContent(baseUrl, apiKey, path, noteContent, http);

      const issueData: PluginIssue = {
        id: makeNoteId(path),
        title,
        body: '',
        url: obsidianUri(path),
        state: 'open',
        lastUpdated: Date.now(),
      };
      return {
        issueId: issueData.id,
        issueNumber: Math.abs(hashCode(path)),
        issueData,
      };
    }

    // Tasks mode: append checkbox to the default note
    const notePath = defaultNote || 'Inbox.md';
    let existing = '';
    try {
      existing = await getFileContent(baseUrl, apiKey, notePath, http);
    } catch (error) {
      // Only a confirmed missing note permits initialization. Auth failures,
      // outages and server errors must not replace existing vault content.
      if (!isNotFound(error)) throw error;
    }
    const markerId = genMarkerId();
    const taskLine = `- [ ] ${title} ${makeMarker(markerId)}`;
    const newContent = existing
      ? `${existing.trimEnd()}\n${taskLine}\n`
      : `${taskLine}\n`;
    await putFileContent(baseUrl, apiKey, notePath, newContent, http);

    // The task is appended at the end, so its nearest heading is the last one
    // in the note. Report the same labels getById will, so the first refresh
    // does not see a label change and replace the task's tags.
    const newLines = newContent.split('\n');
    const heading = nearestHeadings(newLines)[newLines.length - 1];

    const issueData = issueFromTask(
      notePath,
      title,
      false,
      markerId,
      Date.now(),
      taskLabels(notePath, heading, c),
      heading,
      null, // appended flush-left, so never nested
    );
    return {
      issueId: issueData.id,
      issueNumber: Math.abs(hashCode(issueData.id)),
      issueData,
    };
  },

  // ── Backlog import ─────────────────────────────

  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
    const c = cfg(config);
    const { baseUrl, apiKey, vaultFolder, issueType } = c;
    const folderPath = vaultFolder || '';
    // Recurse into subfolders so nested tasks are imported, not just the direct
    // files in the configured folder. Providers that don't understand the flag
    // simply ignore it and return the flat (non-recursive) listing.
    const listUrl = `${baseUrl}/vault/${folderPath ? encodePath(folderPath) + '/' : ''}?recursive=true`;

    let entries: ObsidianDirectoryEntry[] = [];
    try {
      const raw = await obsidianFetch<ObsidianDirectoryListing>('GET', listUrl, apiKey);
      entries = (raw.files ?? [])
        .filter((f) => f.name.endsWith('.md'))
        .slice(0, BACKLOG_FILE_LIMIT);
    } catch {
      return [];
    }

    const results: PluginSearchResult[] = [];

    for (const entry of entries) {
      const relativePath = entry.name;
      const fullPath = folderPath ? `${folderPath}/${relativePath}` : relativePath;

      if (issueType === 'notes' || issueType === 'both') {
        results.push({
          id: makeNoteId(fullPath),
          title: noteTitleFromPath(fullPath),
          url: obsidianUri(fullPath),
          status: 'open',
        });
      }

      if (issueType === 'tasks' || issueType === 'both') {
        try {
          const content = await getFileContent(baseUrl, apiKey, fullPath, http);
          const lines = content.split('\n');
          const headings = nearestHeadings(lines);
          const roots = rootTaskLines(lines);
          let fileModified = false;

          for (let i = 0; i < lines.length; i++) {
            const parsed = parseTaskLine(lines[i]);
            if (!parsed || isChecked(lines[i])) continue;

            let { markerId } = parsed;
            if (!markerId) {
              markerId = genMarkerId();
              lines[i] = embedMarkerInLine(lines[i], markerId);
              fileModified = true;
            }
            const root = rootIssueId(lines, roots, i, fullPath, true);
            if (root.embedded) fileModified = true;

            results.push({
              id: makeTaskIdFromMarker(fullPath, markerId),
              title: `${parsed.text} (${noteTitleFromPath(fullPath)})`,
              url: obsidianUri(fullPath),
              status: 'open',
              labels: taskLabels(fullPath, headings[i], c),
              ...(root.id ? { related_to: root.id } : {}),
            });
          }

          if (fileModified) {
            await putFileContent(baseUrl, apiKey, fullPath, lines.join('\n'), http);
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    return results;
  },

  // ── Display fields shown in the SP task panel ─────────────

  issueDisplay: [
    { field: 'title', label: 'Note / Task', type: 'link', linkField: 'url' },
    { field: 'heading', label: 'Heading', type: 'text', hideEmpty: true },
    { field: 'state', label: 'Status', type: 'text' },
    { field: 'dueOn', label: 'Due Date', type: 'date', hideEmpty: true },
    { field: 'labels', label: 'Tags', type: 'list', hideEmpty: true },
    { field: 'notePath', label: 'Path', type: 'text', hideEmpty: true },
    { field: 'body', label: 'Content', type: 'markdown', hideEmpty: true },
  ],

  // ── Remote deletion ─────────────────────────────
  //
  // getById reports this state when a task line is gone from the vault; SP
  // then removes the task (or warns first when time was tracked on it).

  deletedStates: [DELETED_STATE],

  // ── 2-way sync mappings ─────────────────────────────

  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'state',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): string => (taskValue ? 'completed' : 'open'),
      toTaskValue: (issueValue: unknown): boolean => issueValue === 'completed',
    },
    {
      taskField: 'title',
      issueField: 'title',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): string => taskValue as string,
      toTaskValue: (issueValue: unknown): string => issueValue as string,
    },
    {
      taskField: 'notes',
      issueField: 'body',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string =>
        (taskValue as string | undefined) ?? '',
      toTaskValue: (issueValue: unknown): string =>
        (issueValue as string | undefined) ?? '',
    },
    {
      // SP matches labels to tags by title. For checkbox tasks the label is
      // the source note and/or nearest heading (see tagMode); for notes it is the frontmatter
      // `tags` list. Missing tags are only created when the user enables
      // "Auto-create tags" in the provider settings (SP adds that checkbox
      // automatically for providers with a tagIds mapping). Pushing tags
      // back to Obsidian is not supported, so pull-only.
      taskField: 'tagIds',
      issueField: 'labels',
      defaultDirection: 'pullOnly',
      toIssueValue: (taskValue: unknown): string[] =>
        Array.isArray(taskValue) ? (taskValue as string[]) : [],
      toTaskValue: (issueValue: unknown): string[] =>
        Array.isArray(issueValue) ? (issueValue as string[]) : [],
    },
    {
      // Nested checkbox tasks become SP subtasks. On import SP passes every
      // mapped field to the new task, and a `related_to` value makes SP attach
      // the task as a subtask of the existing task with that issue id (the
      // same mechanism its CalDAV provider uses). Direction is 'off' so the
      // refresh path never touches it; it only matters at import time.
      taskField: 'related_to',
      issueField: 'related_to',
      defaultDirection: 'off',
      toIssueValue: (taskValue: unknown): string | undefined =>
        typeof taskValue === 'string' ? taskValue : undefined,
      toTaskValue: (issueValue: unknown): string | undefined =>
        typeof issueValue === 'string' ? issueValue : undefined,
    },
  ] satisfies PluginFieldMapping[],

  // ── Values the sync engine compares to detect changes ───────────

  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      state: issue.state,
      title: issue.title,
      body: issue.body,
      labels: issue.labels ?? [],
    };
  },
});

// ─── Utilities ───────────────────────────────────

/** Simple string hash for generating stable numeric issue numbers. */
function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}
