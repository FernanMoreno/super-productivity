// TypeScript interfaces for the Obsidian Local REST API
// https://github.com/coddingtonbear/obsidian-local-rest-api

export interface ObsidianFileEntry {
  path: string;
  type: 'file' | 'directory';
  /** Last modified time as ISO string */
  modified?: string;
  size?: number;
}

export interface ObsidianDirectoryEntry {
  name: string;
  mtime: number;
}

export interface ObsidianDirectoryListing {
  files: ObsidianDirectoryEntry[];
}

export interface ObsidianSearchMatch {
  /** The file path relative to vault root */
  filename: string;
  /** Matched text excerpts with surrounding context */
  matches: Array<{
    match: { start: number; end: number };
    context: string;
  }>;
  score: number;
}

export interface ObsidianNoteJson {
  path: string;
  content: string;
  frontmatter?: Record<string, unknown>;
  tags?: string[];
  /** File stat */
  stat?: {
    ctime: number;
    mtime: number;
    size: number;
  };
}
