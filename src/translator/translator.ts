import { ParsedNode, TranslationResult } from '../types';
import { 
  getNodeExplanation, 
  detectPerformanceIssues, 
  generateRecommendations,
  ExecutionStep,
  formatNumber
} from './explanations';

export class PostgreSQLTranslator {
  translate(rootNode: ParsedNode): TranslationResult {
    const steps = this.generateExecutionSteps(rootNode);
    const allWarnings = this.collectAllWarnings(rootNode);
    const allRecommendations = this.collectAllRecommendations(rootNode);
    const summary = this.generateDetailedSummary(rootNode, steps);

    return {
      summary,
      steps: steps.map(step => this.formatDetailedStep(step)),
      warnings: allWarnings,
      recommendations: allRecommendations
    };
  }

  private generateExecutionSteps(node: ParsedNode): ExecutionStep[] {
    const steps: ExecutionStep[] = [];
    let stepCounter = 1;

    const processNode = (currentNode: ParsedNode, depth: number = 0): void => {
      // Process children first (bottom-up for PostgreSQL)
      currentNode.children.forEach(child => processNode(child, depth + 1));

      const explanation = getNodeExplanation(currentNode);
      const performanceIssues = detectPerformanceIssues(currentNode);

      steps.push({
        stepNumber: stepCounter++,
        description: explanation.description,
        nodeType: currentNode.nodeType || currentNode.operation || 'Unknown',
        tableName: currentNode.tableName,
        indexName: currentNode.indexName,
        estimatedRows: currentNode.rows,
        actualRows: currentNode.actualRows,
        cost: currentNode.cost?.total,
        performanceNotes: explanation.performanceNotes || [],
        warnings: [...(explanation.warnings || []), ...performanceIssues]
      });
    };

    processNode(node);
    return steps;
  }

  private generateDetailedSummary(rootNode: ParsedNode, steps: ExecutionStep[]): string {
    if (steps.length === 0) return "No execution steps found.";

    const parts: string[] = [];
    
    // Analyze the query structure from bottom to top
    const scanSteps = steps.filter(s => s.nodeType.includes('Scan'));
    const joinSteps = steps.filter(s => s.nodeType.includes('Loop') || s.nodeType.includes('Join'));
    const sortSteps = steps.filter(s => s.nodeType.includes('Sort'));
    const limitSteps = steps.filter(s => s.nodeType.includes('Limit'));
    const gatherSteps = steps.filter(s => s.nodeType.includes('Gather'));
    
    // Describe the data access pattern
    parts.push("This query executes as follows:");
    
    // 1. Initial table access
    if (scanSteps.length > 0) {
      const parallelScans = scanSteps.filter(s => s.nodeType.includes('Parallel'));
      const indexScans = scanSteps.filter(s => s.nodeType.includes('Index'));
      const seqScans = scanSteps.filter(s => s.nodeType.includes('Seq') && !s.nodeType.includes('Parallel'));
      
      if (parallelScans.length > 0) {
        const scan = parallelScans[0];
        parts.push(`1. Starts with a parallel sequential scan of the ${scan.tableName} table (expecting ${formatNumber(scan.estimatedRows)} rows)`);
      } else if (indexScans.length > 0) {
        const scan = indexScans[indexScans.length - 1]; // Get the first in execution order
        parts.push(`1. Begins by looking up rows in the ${scan.tableName} table using the ${scan.indexName} index`);
      } else if (seqScans.length > 0) {
        const scan = seqScans[0];
        parts.push(`1. Performs a sequential scan of the ${scan.tableName} table`);
      }
    }

    // 2. Joins
    if (joinSteps.length > 0) {
      const tables = [...new Set(scanSteps.slice(0, joinSteps.length + 1).map(s => s.tableName).filter(Boolean))];
      parts.push(`2. Joins data from ${tables.join(', ')} using ${joinSteps.length} nested loop operation${joinSteps.length > 1 ? 's' : ''}`);
    }

    // 3. Additional processing
    if (sortSteps.length > 0) {
      parts.push(`3. Sorts the combined results`);
    }

    // 4. Parallel gathering
    if (gatherSteps.length > 0) {
      parts.push(`4. Gathers and merges results from parallel workers`);
    }

    // 5. Final limiting
    if (limitSteps.length > 0) {
      parts.push(`5. Limits the final output to ${limitSteps[0].estimatedRows} rows`);
    }

    // Performance summary
    const totalCost = rootNode.cost?.total || 0;
    if (totalCost > 50000) {
      parts.push(`\nPerformance note: This is an expensive query with a total cost of ${totalCost.toFixed(0)} units.`);
    }

    return parts.join('\n');
  }

  private formatDetailedStep(step: ExecutionStep): string {
    const parts: string[] = [];
    
    // Main description
    parts.push(this.capitalizeFirst(step.description));
    
    // Add metrics in brackets
    const metrics: string[] = [];
    if (step.estimatedRows !== undefined) {
      metrics.push(`rows: ${formatNumber(step.estimatedRows)}`);
    }
    if (step.cost !== undefined) {
      metrics.push(`cost: ${step.cost.toFixed(0)}`);
    }
    
    if (metrics.length > 0) {
      parts[0] += ` [${metrics.join(', ')}]`;
    }
    
    // Add warnings
    if (step.cost && step.cost > 10000) {
      parts.push('⚠️ High cost operation');
    }
    
    // Add performance notes
    if (step.performanceNotes.length > 0) {
      parts.push(...step.performanceNotes.map(note => `• ${note}`));
    }
    
    return parts.join('\n');
  }

  private collectAllWarnings(node: ParsedNode): string[] {
    const warnings: string[] = [];
    
    const collectWarnings = (currentNode: ParsedNode): void => {
      const explanation = getNodeExplanation(currentNode);
      const performanceIssues = detectPerformanceIssues(currentNode);
      
      warnings.push(...(explanation.warnings || []), ...performanceIssues);
      
      currentNode.children.forEach(collectWarnings);
    };

    collectWarnings(node);
    return [...new Set(warnings)].filter(Boolean);
  }

  private collectAllRecommendations(node: ParsedNode): string[] {
    const recommendations: string[] = [];
    
    const collectRecommendations = (currentNode: ParsedNode): void => {
      const explanation = getNodeExplanation(currentNode);
      const nodeRecommendations = generateRecommendations(currentNode);
      
      recommendations.push(...(explanation.recommendations || []), ...nodeRecommendations);
      
      currentNode.children.forEach(collectRecommendations);
    };

    collectRecommendations(node);
    return [...new Set(recommendations)].filter(Boolean);
  }

  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

export function translatePostgreSQLPlan(rootNode: ParsedNode): TranslationResult {
  const translator = new PostgreSQLTranslator();
  return translator.translate(rootNode);
}