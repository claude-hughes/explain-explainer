import { ParsedNode, ParseResult } from '../types';
import { ParserLine, PostgresNodePattern } from './parser-types';

export class PostgresExplainParser {
  private patterns: PostgresNodePattern[] = [
    {
      pattern: /^(.+?)\s+\(cost=(\d+\.?\d*?)\.\.(\d+\.?\d*?)\s+rows=(\d+)\s+width=(\d+)\)(?:\s+\(actual time=(\d+\.?\d*?)\.\.(\d+\.?\d*?)\s+rows=(\d+)\s+loops=(\d+)\))?$/,
      extractor: (match) => ({
        nodeType: match[1].trim(),
        cost: {
          startup: parseFloat(match[2]),
          total: parseFloat(match[3])
        },
        rows: parseInt(match[4]),
        width: parseInt(match[5]),
        actualTime: match[6] ? {
          startup: parseFloat(match[6]),
          total: parseFloat(match[7])
        } : undefined,
        actualRows: match[8] ? parseInt(match[8]) : undefined,
        loops: match[9] ? parseInt(match[9]) : undefined
      })
    },
    {
      pattern: /^(.+?)\s+\(cost=(\d+\.?\d*?)\.\.(\d+\.?\d*?)\s+rows=(\d+)\s+width=(\d+)\)$/,
      extractor: (match) => ({
        nodeType: match[1].trim(),
        cost: {
          startup: parseFloat(match[2]),
          total: parseFloat(match[3])
        },
        rows: parseInt(match[4]),
        width: parseInt(match[5])
      })
    },
    {
      pattern: /^(.+?)\s+\(never executed\)/,
      extractor: (match) => ({
        nodeType: match[1].trim(),
        actualRows: 0,
        loops: 0
      })
    }
  ];

  private propertyPatterns = [
    {
      pattern: /^Sort Key:\s*(.+)$/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.sortKey = match[1].split(',').map(key => key.trim());
      }
    },
    {
      pattern: /^Group Key:\s*(.+)$/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.groupKey = match[1].split(',').map(key => key.trim());
      }
    },
    {
      pattern: /^Filter:\s*(.+)$/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.filter = match[1];
      }
    },
    {
      pattern: /^Index Cond:\s*(.+)$/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.indexCond = match[1];
      }
    },
    {
      pattern: /^Join Filter:\s*(.+)$/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.joinCond = match[1];
      }
    },
    {
      pattern: /^Hash Cond:\s*(.+)$/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.hashCond = match[1];
      }
    },
    {
      pattern: /^Workers Planned:\s*(\d+)$/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.workers = parseInt(match[1]);
      }
    },
    {
      pattern: /^Buffers:\s*shared hit=(\d+)(?:\s+read=(\d+))?(?:\s+dirtied=(\d+))?(?:\s+written=(\d+))?/,
      extractor: (match: RegExpMatchArray, node: ParsedNode) => {
        node.buffers = {
          shared: {
            hit: parseInt(match[1]),
            read: match[2] ? parseInt(match[2]) : undefined,
            dirtied: match[3] ? parseInt(match[3]) : undefined,
            written: match[4] ? parseInt(match[4]) : undefined
          }
        };
      }
    }
  ];

  parse(explainText: string): ParseResult {
    try {
      const lines = this.parseLines(explainText);
      const root = this.buildTree(lines);
      const { planningTime, executionTime } = this.extractTimings(explainText);

      return {
        databaseType: 'postgresql',
        root,
        planningTime,
        executionTime
      };
    } catch (error) {
      return {
        databaseType: 'postgresql',
        root: null,
        error: error instanceof Error ? error.message : 'Unknown parsing error'
      };
    }
  }

  private parseLines(text: string): ParserLine[] {
    const lines = text.split('\n');
    const parsed: ParserLine[] = [];

    for (const line of lines) {
      if (line.trim() === '') continue;
      
      const indent = this.calculateIndent(line);
      const content = line.trim();
      
      if (content && !content.startsWith('Planning Time:') && !content.startsWith('Execution Time:')) {
        parsed.push({
          indent,
          content,
          raw: line
        });
      }
    }

    return parsed;
  }

  private calculateIndent(line: string): number {
    let indent = 0;
    for (const char of line) {
      if (char === ' ') {
        indent++;
      } else if (char === '\t') {
        indent += 4;
      } else {
        break;
      }
    }
    return indent;
  }

  private buildTree(lines: ParserLine[]): ParsedNode | null {
    if (lines.length === 0) return null;

    const stack: { node: ParsedNode; indent: number }[] = [];
    let root: ParsedNode | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const node = this.parseNode(line);

      if (!node) continue;

      if (root === null) {
        root = node;
        stack.push({ node, indent: line.indent });
        continue;
      }

      while (stack.length > 0 && stack[stack.length - 1].indent >= line.indent) {
        stack.pop();
      }

      if (stack.length > 0) {
        stack[stack.length - 1].node.children.push(node);
      }

      stack.push({ node, indent: line.indent });

      let j = i + 1;
      while (j < lines.length && lines[j].indent > line.indent && !this.isNodeLine(lines[j])) {
        this.parseNodeProperty(lines[j], node);
        j++;
      }
      i = j - 1;
    }

    return root;
  }

  private parseNode(line: ParserLine): ParsedNode | null {
    let content = line.content;
    
    if (!this.isNodeLine(line)) {
      return null;
    }

    // Remove arrow prefix if present
    content = content.replace(/^->\s*/, '');

    let baseNode: Partial<ParsedNode> = {
      nodeType: content,
      children: [],
      raw: line.raw
    };

    for (const pattern of this.patterns) {
      const match = content.match(pattern.pattern);
      if (match) {
        const extracted = pattern.extractor(match);
        baseNode = { ...baseNode, ...extracted };
        break;
      }
    }

    const node = baseNode as ParsedNode;

    this.extractTableAndIndexInfo(node);

    return node;
  }

  private isNodeLine(line: ParserLine): boolean {
    const content = line.content;
    
    // First check if it's a property line
    const propertyIndicators = [
      /^Sort Key:/,
      /^Group Key:/,
      /^Filter:/,
      /^Index Cond:/,
      /^Join Filter:/,
      /^Hash Cond:/,
      /^Workers Planned:/,
      /^Workers Launched:/,
      /^Buffers:/,
      /^Rows Removed by/
    ];
    
    if (propertyIndicators.some(pattern => pattern.test(content))) {
      return false;
    }
    
    const nodeIndicators = [
      '(cost=',
      '(never executed)',
      '->',
      /^[A-Z][a-zA-Z\s]+\s*\(/,
      /^Limit\s/,
      /^Sort\s/,
      /^Hash\s/,
      /^Nested Loop\s/,
      /^Merge\s/,
      /^Aggregate\s/,
      /^Group\s/,
      /^Unique\s/,
      /^Subquery Scan\s/,
      /^Seq Scan\s/,
      /^Index\s/,
      /^Bitmap\s/,
      /^CTE Scan\s/,
      /^Foreign Scan\s/,
      /^Custom Scan\s/,
      /^Gather\s/,
      /^Parallel\s/
    ];

    return nodeIndicators.some(indicator => {
      if (typeof indicator === 'string') {
        return content.includes(indicator);
      } else {
        return indicator.test(content);
      }
    });
  }

  private parseNodeProperty(line: ParserLine, node: ParsedNode): void {
    const content = line.content;

    for (const pattern of this.propertyPatterns) {
      const match = content.match(pattern.pattern);
      if (match) {
        pattern.extractor(match, node);
        return;
      }
    }
  }

  private extractTableAndIndexInfo(node: ParsedNode): void {
    const nodeType = node.nodeType;

    const tableMatches = [
      /on\s+(\w+)(?:\s+(\w+))?$/,
      /Seq Scan on\s+(\w+)(?:\s+(\w+))?/,
      /Index.*Scan.*on\s+(\w+)(?:\s+(\w+))?/,
      /Bitmap.*Scan on\s+(\w+)(?:\s+(\w+))?/
    ];

    for (const pattern of tableMatches) {
      const match = nodeType.match(pattern);
      if (match) {
        node.tableName = match[1];
        if (match[2]) {
          node.alias = match[2];
        }
        break;
      }
    }

    const indexMatches = [
      /Index.*Scan using\s+(\w+)/,
      /Bitmap Index Scan on\s+(\w+)/
    ];

    for (const pattern of indexMatches) {
      const match = nodeType.match(pattern);
      if (match) {
        node.indexName = match[1];
        break;
      }
    }

    const operationPatterns = [
      { pattern: /^(Seq Scan)/, operation: 'Seq Scan' },
      { pattern: /^(Index Scan)/, operation: 'Index Scan' },
      { pattern: /^(Index Only Scan)/, operation: 'Index Only Scan' },
      { pattern: /^(Bitmap Heap Scan)/, operation: 'Bitmap Heap Scan' },
      { pattern: /^(Bitmap Index Scan)/, operation: 'Bitmap Index Scan' },
      { pattern: /^(Nested Loop)/, operation: 'Nested Loop' },
      { pattern: /^(Hash Join)/, operation: 'Hash Join' },
      { pattern: /^(Merge Join)/, operation: 'Merge Join' },
      { pattern: /^(Sort)/, operation: 'Sort' },
      { pattern: /^(Hash)/, operation: 'Hash' },
      { pattern: /^(Aggregate)/, operation: 'Aggregate' },
      { pattern: /^(Limit)/, operation: 'Limit' },
      { pattern: /^(Gather)/, operation: 'Gather' },
      { pattern: /^(Gather Merge)/, operation: 'Gather Merge' },
      { pattern: /^(Parallel Seq Scan)/, operation: 'Parallel Seq Scan' }
    ];

    for (const { pattern, operation } of operationPatterns) {
      if (pattern.test(nodeType)) {
        node.operation = operation;
        break;
      }
    }
  }

  private extractTimings(text: string): { planningTime?: number; executionTime?: number } {
    const planningMatch = text.match(/Planning Time:\s*(\d+\.?\d*)\s*ms/);
    const executionMatch = text.match(/Execution Time:\s*(\d+\.?\d*)\s*ms/);

    return {
      planningTime: planningMatch ? parseFloat(planningMatch[1]) : undefined,
      executionTime: executionMatch ? parseFloat(executionMatch[1]) : undefined
    };
  }
}

export function parsePostgresExplain(explainText: string): ParseResult {
  const parser = new PostgresExplainParser();
  return parser.parse(explainText);
}