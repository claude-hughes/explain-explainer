import { ParsedNode } from '../types';

export interface NodeExplanation {
  description: string;
  performanceNotes?: string[];
  warnings?: string[];
  recommendations?: string[];
}

export interface ExecutionStep {
  stepNumber: number;
  description: string;
  nodeType: string;
  tableName?: string;
  indexName?: string;
  estimatedRows?: number;
  actualRows?: number;
  cost?: number;
  performanceNotes: string[];
  warnings: string[];
}

const NODE_DESCRIPTIONS: Record<string, (node: ParsedNode) => NodeExplanation> = {
  'Seq Scan': (node) => ({
    description: `perform a sequential scan on the ${node.tableName} table${node.filter ? ', filtering for rows where ' + formatFilter(node.filter) : ''}`,
    performanceNotes: [
      `This will scan approximately ${formatNumber(node.rows)} rows`,
      node.actualRows ? `Actually scanned ${formatNumber(node.actualRows)} rows` : undefined
    ].filter(Boolean) as string[],
    warnings: node.rows && node.rows > 10000 ? ['Large table scan - consider adding an index'] : [],
    recommendations: node.rows && node.rows > 10000 && node.filter ? 
      [`Consider adding an index on the filtered columns: ${extractFilterColumns(node.filter)}`] : []
  }),

  'Parallel Seq Scan': (node) => ({
    description: `perform a parallel sequential scan on the ${node.tableName} table using ${node.workers || 1} worker process${(node.workers || 1) > 1 ? 'es' : ''}${node.filter ? ', filtering for rows where ' + formatFilter(node.filter) : ''}`,
    performanceNotes: [
      `This will scan approximately ${formatNumber(node.rows)} rows across ${node.workers || 1} worker${(node.workers || 1) > 1 ? 's' : ''}`,
      node.actualRows ? `Actually scanned ${formatNumber(node.actualRows)} rows` : undefined
    ].filter(Boolean) as string[],
    warnings: node.rows && node.rows > 50000 ? ['Very large parallel table scan'] : [],
    recommendations: node.filter ? 
      [`Consider adding an index on the filtered columns: ${extractFilterColumns(node.filter)}`] : []
  }),

  'Index Scan': (node) => ({
    description: `look up rows using the ${node.indexName} index${node.indexCond ? ' where ' + formatCondition(node.indexCond) : ''}${node.filter ? ', then filter for rows where ' + formatFilter(node.filter) : ''}`,
    performanceNotes: [
      `Expected to find ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      node.actualRows ? `Actually found ${formatNumber(node.actualRows)} row${node.actualRows === 1 ? '' : 's'}` : undefined
    ].filter(Boolean) as string[],
    warnings: node.filter ? ['Additional filtering after index lookup may indicate a suboptimal index'] : [],
    recommendations: node.filter ? 
      [`Consider a composite index including: ${extractFilterColumns(node.filter)}`] : []
  }),

  'Index Only Scan': (node) => ({
    description: `perform an index-only scan using the ${node.indexName} index${node.indexCond ? ' where ' + formatCondition(node.indexCond) : ''}`,
    performanceNotes: [
      `This efficient scan will read only from the index, not the table`,
      `Expected to find ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`
    ],
    warnings: [],
    recommendations: []
  }),

  'Bitmap Heap Scan': (node) => ({
    description: `scan the ${node.tableName} table using a bitmap to efficiently locate matching rows${node.filter ? ', filtering for rows where ' + formatFilter(node.filter) : ''}`,
    performanceNotes: [
      `Expected to find ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      'Uses a bitmap to avoid random I/O'
    ],
    warnings: [],
    recommendations: []
  }),

  'Bitmap Index Scan': (node) => ({
    description: `build a bitmap using the ${node.indexName} index${node.indexCond ? ' for rows where ' + formatCondition(node.indexCond) : ''}`,
    performanceNotes: [
      'Creates a bitmap of matching row locations for efficient heap access'
    ],
    warnings: [],
    recommendations: []
  }),

  'Nested Loop': (node) => ({
    description: 'join the results using a nested loop',
    performanceNotes: [
      `Expected to produce ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      node.actualRows ? `Actually produced ${formatNumber(node.actualRows)} row${node.actualRows === 1 ? '' : 's'}` : undefined
    ].filter(Boolean) as string[],
    warnings: node.rows && node.rows > 1000 ? ['Large nested loop join - consider if a hash join would be more efficient'] : [],
    recommendations: []
  }),

  'Hash Join': (node) => ({
    description: `join the results using a hash join${node.hashCond ? ' on ' + formatCondition(node.hashCond) : ''}`,
    performanceNotes: [
      `Expected to produce ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      'Builds a hash table from the smaller input for efficient lookups'
    ],
    warnings: [],
    recommendations: []
  }),

  'Merge Join': (node) => ({
    description: `join the results using a merge join${node.joinCond ? ' on ' + formatCondition(node.joinCond) : ''}`,
    performanceNotes: [
      `Expected to produce ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      'Both inputs must be sorted on the join key'
    ],
    warnings: [],
    recommendations: []
  }),

  'Sort': (node) => ({
    description: `sort the results${node.sortKey ? ' by ' + formatSortKeys(node.sortKey) : ''}`,
    performanceNotes: [
      `Sorting ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      node.memoryUsage ? `Memory usage: ${node.memoryUsage}` : undefined,
      node.diskUsage ? `Disk usage: ${node.diskUsage}` : undefined
    ].filter(Boolean) as string[],
    warnings: node.diskUsage ? ['Sort spilled to disk - consider increasing work_mem'] : [],
    recommendations: node.diskUsage ? ['Increase work_mem to avoid disk-based sorting'] : []
  }),

  'Limit': (node) => ({
    description: `limit the results to ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
    performanceNotes: [],
    warnings: [],
    recommendations: []
  }),

  'Gather': (node) => ({
    description: 'gather results from parallel worker processes',
    performanceNotes: [
      `Collecting results from ${node.workers || 1} worker process${(node.workers || 1) > 1 ? 'es' : ''}`
    ],
    warnings: [],
    recommendations: []
  }),

  'Gather Merge': (node) => ({
    description: 'gather and merge sorted results from parallel worker processes',
    performanceNotes: [
      `Merging sorted results from ${node.workers || 1} worker process${(node.workers || 1) > 1 ? 'es' : ''}`,
      'Maintains sort order while combining parallel results'
    ],
    warnings: [],
    recommendations: []
  }),

  'Aggregate': (node) => ({
    description: `compute aggregate functions${node.groupKey ? ' grouped by ' + formatGroupKeys(node.groupKey) : ''}`,
    performanceNotes: [
      `Processing ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`
    ],
    warnings: [],
    recommendations: []
  }),

  'HashAggregate': (node) => ({
    description: `compute aggregate functions using hash grouping${node.groupKey ? ' grouped by ' + formatGroupKeys(node.groupKey) : ''}`,
    performanceNotes: [
      `Processing ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      'Uses hash table for efficient grouping'
    ],
    warnings: [],
    recommendations: []
  }),

  'GroupAggregate': (node) => ({
    description: `compute aggregate functions on pre-sorted groups${node.groupKey ? ' grouped by ' + formatGroupKeys(node.groupKey) : ''}`,
    performanceNotes: [
      `Processing ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`,
      'Input must be sorted by group keys'
    ],
    warnings: [],
    recommendations: []
  }),

  'Unique': (node) => ({
    description: 'remove duplicate rows',
    performanceNotes: [
      `Processing ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`
    ],
    warnings: [],
    recommendations: []
  }),

  'Subquery Scan': (node) => ({
    description: `scan the results of a subquery${node.alias ? ` (aliased as ${node.alias})` : ''}`,
    performanceNotes: [
      `Expected to produce ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`
    ],
    warnings: [],
    recommendations: []
  })
};

export function getNodeExplanation(node: ParsedNode): NodeExplanation {
  const explainer = NODE_DESCRIPTIONS[node.nodeType] || NODE_DESCRIPTIONS[node.operation || ''];
  
  if (explainer) {
    return explainer(node);
  }

  return {
    description: `perform a ${node.nodeType || node.operation} operation${node.tableName ? ` on ${node.tableName}` : ''}`,
    performanceNotes: node.rows ? [`Expected to process ${formatNumber(node.rows)} row${node.rows === 1 ? '' : 's'}`] : [],
    warnings: [],
    recommendations: []
  };
}

function formatFilter(filter: string): string {
  return filter
    .replace(/\(\(\(/g, '(')
    .replace(/\)\)\)/g, ')')
    .replace(/::[\w\s\[\]']+/g, '')
    .replace(/'/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCondition(condition: string): string {
  return condition
    .replace(/\(\(\(/g, '(')
    .replace(/\)\)\)/g, ')')
    .replace(/::[\w\s\[\]']+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatSortKeys(sortKeys: string[]): string {
  return sortKeys.map(key => {
    const parts = key.trim().split(/\s+/);
    const column = parts[0];
    const direction = parts[1];
    
    if (direction === 'DESC') {
      return `${column} (descending)`;
    } else if (direction === 'ASC') {
      return `${column} (ascending)`;
    } else {
      return column;
    }
  }).join(', ');
}

function formatGroupKeys(groupKeys: string[]): string {
  return groupKeys.join(', ');
}

function formatNumber(num?: number): string {
  if (num === undefined || num === null) return '0';
  if (num < 1000) return num.toString();
  if (num < 1000000) return `${(num / 1000).toFixed(1)}K`;
  return `${(num / 1000000).toFixed(1)}M`;
}

function extractFilterColumns(filter: string): string {
  const columnPatterns = [
    /(\w+\.\w+)/g,
    /(\w+)(?=\s*[<>=!@~])/g,
    /(\w+)(?=\s+IS\s)/gi,
    /(\w+)(?=\s+ANY\s)/gi
  ];
  
  const columns = new Set<string>();
  
  for (const pattern of columnPatterns) {
    const matches = filter.match(pattern) || [];
    matches.forEach(match => {
      if (!match.match(/^(null|true|false|\d+)$/i)) {
        columns.add(match);
      }
    });
  }
  
  return Array.from(columns).join(', ');
}

export function detectPerformanceIssues(node: ParsedNode): string[] {
  const issues: string[] = [];
  
  if (node.nodeType === 'Seq Scan' && node.rows && node.rows > 10000) {
    issues.push(`Large sequential scan on ${node.tableName} (${formatNumber(node.rows)} rows)`);
  }
  
  if (node.nodeType === 'Parallel Seq Scan' && node.rows && node.rows > 50000) {
    issues.push(`Very large parallel sequential scan on ${node.tableName} (${formatNumber(node.rows)} rows)`);
  }
  
  if (node.nodeType === 'Nested Loop' && node.rows && node.rows > 1000) {
    issues.push(`Large nested loop join producing ${formatNumber(node.rows)} rows`);
  }
  
  if (node.nodeType === 'Sort' && node.diskUsage) {
    issues.push(`Sort operation spilled to disk (${node.diskUsage})`);
  }
  
  if (node.cost && node.cost.total > 10000) {
    issues.push(`High cost operation: ${node.nodeType} (cost: ${node.cost.total.toFixed(2)})`);
  }
  
  if (node.actualRows && node.rows && Math.abs(node.actualRows - node.rows) / node.rows > 0.5) {
    issues.push(`Row estimate significantly off: estimated ${formatNumber(node.rows)}, actual ${formatNumber(node.actualRows)}`);
  }
  
  return issues;
}

export function generateRecommendations(node: ParsedNode): string[] {
  const recommendations: string[] = [];
  
  if (node.nodeType === 'Seq Scan' && node.filter && node.rows && node.rows > 1000) {
    const columns = extractFilterColumns(node.filter);
    if (columns) {
      recommendations.push(`Add an index on ${node.tableName}(${columns}) to avoid sequential scan`);
    }
  }
  
  if (node.nodeType === 'Index Scan' && node.filter) {
    const columns = extractFilterColumns(node.filter);
    if (columns) {
      recommendations.push(`Consider a composite index including filtered columns: ${columns}`);
    }
  }
  
  if (node.nodeType === 'Sort' && node.diskUsage) {
    recommendations.push('Increase work_mem to avoid disk-based sorting');
  }
  
  if (node.nodeType === 'Nested Loop' && node.rows && node.rows > 1000) {
    recommendations.push('Consider if statistics are up to date - large nested loops may indicate outdated statistics');
  }
  
  if (node.actualRows && node.rows && Math.abs(node.actualRows - node.rows) / node.rows > 0.5) {
    recommendations.push('Update table statistics with ANALYZE to improve query planning');
  }
  
  return recommendations;
}