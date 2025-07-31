export type DatabaseType = 'postgresql' | 'mysql' | 'unknown';

export interface ParsedNode {
  nodeType: string;
  operation?: string;
  tableName?: string;
  indexName?: string;
  alias?: string;
  cost?: {
    startup: number;
    total: number;
  };
  actualTime?: {
    startup: number;
    total: number;
  };
  rows?: number;
  actualRows?: number;
  width?: number;
  loops?: number;
  workers?: number;
  buffers?: {
    shared?: {
      hit?: number;
      read?: number;
      dirtied?: number;
      written?: number;
    };
    temp?: {
      read?: number;
      written?: number;
    };
  };
  filter?: string;
  indexCond?: string;
  joinCond?: string;
  hashCond?: string;
  sortKey?: string[];
  groupKey?: string[];
  batches?: number;
  buckets?: number;
  memoryUsage?: string;
  diskUsage?: string;
  children: ParsedNode[];
  raw: string;
}

export interface ParseResult {
  databaseType: DatabaseType;
  root: ParsedNode | null;
  planningTime?: number;
  executionTime?: number;
  error?: string;
}

export interface TranslationResult {
  summary: string;
  steps: string[];
  warnings: string[];
  recommendations: string[];
}