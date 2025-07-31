import { ParsedNode, TranslationResult } from '../types';
import { formatNumber } from './explanations';

export class SimplePostgreSQLTranslator {
  translate(rootNode: ParsedNode): TranslationResult {
    const executionOrder = this.collectNodesInExecutionOrder(rootNode);
    const summary = this.generateSimpleSummary(executionOrder);
    const steps = this.generateSimpleSteps(executionOrder);
    const warnings = this.collectWarnings(executionOrder);
    const recommendations = this.collectRecommendations(executionOrder);

    return {
      summary,
      steps,
      warnings,
      recommendations
    };
  }

  private collectNodesInExecutionOrder(node: ParsedNode): ParsedNode[] {
    const nodes: ParsedNode[] = [];
    
    const collect = (n: ParsedNode) => {
      // First collect all children (bottom-up)
      n.children.forEach(child => collect(child));
      // Then add this node
      nodes.push(n);
    };
    
    collect(node);
    return nodes;
  }

  private generateSimpleSummary(nodes: ParsedNode[]): string {
    const tables = new Set<string>();
    const indexes = new Set<string>();
    let hasParallel = false;
    let hasSort = false;
    let hasLimit = false;
    let totalCost = 0;

    nodes.forEach(node => {
      if (node.tableName) tables.add(node.tableName);
      if (node.indexName) indexes.add(node.indexName);
      if (node.operation?.includes('Parallel')) hasParallel = true;
      if (node.operation?.includes('Sort')) hasSort = true;
      if (node.operation?.includes('Limit')) hasLimit = true;
      if (node.cost?.total) totalCost = Math.max(totalCost, node.cost.total);
    });

    let summary = `This query accesses ${tables.size} table${tables.size !== 1 ? 's' : ''}: ${Array.from(tables).join(', ')}. `;
    
    if (indexes.size > 0) {
      summary += `It uses ${indexes.size} index${indexes.size !== 1 ? 'es' : ''}: ${Array.from(indexes).join(', ')}. `;
    }
    
    if (hasParallel) {
      summary += `The query uses parallel execution for better performance. `;
    }
    
    if (hasSort) {
      summary += `Results are sorted before returning. `;
    }
    
    if (hasLimit) {
      const limitNode = nodes.find(n => n.operation?.includes('Limit'));
      summary += `Output is limited to ${limitNode?.rows || 'a few'} rows. `;
    }
    
    if (totalCost > 10000) {
      summary += `Total cost: ${totalCost.toFixed(0)} (high).`;
    }

    return summary;
  }

  private generateSimpleSteps(nodes: ParsedNode[]): string[] {
    return nodes.map((node) => {
      const operation = node.operation || node.nodeType;
      const table = node.tableName ? ` on ${node.tableName}` : '';
      const indexInfo = node.indexName ? ` using index ${node.indexName}` : '';
      const rows = node.rows ? ` (${formatNumber(node.rows)} rows)` : '';
      const cost = node.cost?.total && node.cost.total > 100 ? ` [cost: ${node.cost.total.toFixed(0)}]` : '';
      
      let description = `${operation}${table}${indexInfo}${rows}${cost}`;
      
      // Add key details
      if (node.filter) {
        description += ` - Filter: ${this.simplifyFilter(node.filter)}`;
      }
      if (node.indexCond) {
        description += ` - Condition: ${this.simplifyFilter(node.indexCond)}`;
      }
      if (node.sortKey && node.sortKey.length > 0) {
        description += ` - Sort by: ${node.sortKey.join(', ')}`;
      }
      
      return description;
    });
  }

  private simplifyFilter(filter: string): string {
    return filter
      .replace(/\(\(/g, '(')
      .replace(/\)\)/g, ')')
      .replace(/::[\w\s]+/g, '') // Remove type casts
      .substring(0, 100) + (filter.length > 100 ? '...' : '');
  }

  private collectWarnings(nodes: ParsedNode[]): string[] {
    const warnings: string[] = [];
    
    nodes.forEach(node => {
      // High cost operations
      if (node.cost?.total && node.cost.total > 10000) {
        warnings.push(`High cost ${node.operation || node.nodeType}: ${node.cost.total.toFixed(0)}`);
      }
      
      // Large scans
      if (node.operation?.includes('Seq Scan') && node.rows && node.rows > 10000) {
        warnings.push(`Large sequential scan on ${node.tableName}: ${formatNumber(node.rows)} rows`);
      }
      
      // Filter after index
      if (node.operation?.includes('Index Scan') && node.filter) {
        warnings.push(`Additional filtering after index lookup on ${node.tableName}`);
      }
    });
    
    return [...new Set(warnings)];
  }

  private collectRecommendations(nodes: ParsedNode[]): string[] {
    const recommendations: string[] = [];
    
    nodes.forEach(node => {
      // Sequential scan with filter
      if (node.operation?.includes('Seq Scan') && node.filter && node.rows && node.rows > 1000) {
        recommendations.push(`Consider adding an index on ${node.tableName} for the filter conditions`);
      }
      
      // Very high cost operations
      if (node.cost?.total && node.cost.total > 50000) {
        recommendations.push(`Investigate optimizing the ${node.operation} operation (cost: ${node.cost.total.toFixed(0)})`);
      }
    });
    
    return [...new Set(recommendations)];
  }
}

export function translatePostgreSQLPlanSimple(rootNode: ParsedNode): TranslationResult {
  const translator = new SimplePostgreSQLTranslator();
  return translator.translate(rootNode);
}