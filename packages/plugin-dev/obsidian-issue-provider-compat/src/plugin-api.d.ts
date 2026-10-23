// Local copy of issue-provider types from @super-productivity/plugin-api
// (the published npm package does not yet export these)

export interface PluginSearchResult {
  id: string;
  title: string;
  url?: string;
  status?: string;
  assignee?: string;
  /** Labels/tags used by tagIds field mappings during initial import */
  labels?: string[];
  /** Issue id of the parent issue; SP adds the task as a subtask of it when
   *  a `related_to` field mapping exists and the parent task is present. */
  related_to?: string;
}

export interface PluginIssue {
  id: string;
  title: string;
  body?: string;
  url?: string;
  state?: string;
  lastUpdated?: number;
  assignee?: string;
  labels?: string[];
  related_to?: string;
  [key: string]: unknown;
}

export type PluginSyncDirection = 'off' | 'pullOnly' | 'pushOnly' | 'both';

export interface PluginFieldMapping {
  /**
   * `tagIds` maps Super Productivity tags by title/label, not by internal tag id:
   * - `toIssueValue` receives a sorted string[] of local tag titles.
   * - `toTaskValue` must return a string[] of tag titles/labels to match or create locally.
   *
   * `related_to` is not part of the published plugin API but is accepted by
   * SP's IssueTask model: on import SP passes every mapped field through, and
   * a `related_to` issue id makes it add the task as a subtask of the task
   * linked to that issue (verified against SP 19.0.1).
   */
  taskField:
    | 'isDone'
    | 'title'
    | 'notes'
    | 'dueDay'
    | 'dueWithTime'
    | 'timeEstimate'
    | 'tagIds'
    | 'related_to';
  issueField: string;
  defaultDirection: PluginSyncDirection;
  toIssueValue(
    taskValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
  toTaskValue(
    issueValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
}

export interface PluginFormField {
  key: string;
  type: 'input' | 'password' | 'textarea' | 'checkbox' | 'select' | 'link';
  label: string;
  required?: boolean;
  options?: { label: string; value: string }[];
  url?: string;
  pattern?: string;
  advanced?: boolean;
}

export interface PluginHttpOptions {
  params?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
}

export interface PluginHttp {
  get<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
  post<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  put<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  patch<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  delete<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
}

export interface PluginIssueField {
  field: string;
  label: string;
  type?: 'text' | 'markdown' | 'link' | 'date' | 'list';
  linkField?: string;
  hideEmpty?: boolean;
}

export interface PluginCommentsConfig {
  authorField?: string;
  bodyField?: string;
  createdField?: string;
  avatarField?: string;
  sortField?: string;
}

export interface IssueProviderPluginDefinition {
  configFields: PluginFormField[];
  getHeaders(
    config: Record<string, unknown>,
  ): Record<string, string> | Promise<Record<string, string>>;
  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue>;
  getIssueLink(issueId: string, config: Record<string, unknown>): string;
  testConnection?(config: Record<string, unknown>, http: PluginHttp): Promise<boolean>;
  getNewIssuesForBacklog?(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  issueDisplay: PluginIssueField[];
  commentsConfig?: PluginCommentsConfig;
  fieldMappings?: PluginFieldMapping[];
  updateIssue?(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void>;
  createIssue?(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueNumber: number; issueData: PluginIssue }>;
  extractSyncValues?(issue: PluginIssue): Record<string, unknown>;
  /** Issue states that indicate the issue was deleted remotely; SP removes the
   *  linked task (after a warning when time was tracked on it). */
  deletedStates?: string[];
}
